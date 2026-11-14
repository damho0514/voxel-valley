import type { ThermalState } from '../../modules/vv-thermal';

/*
 * Frame pacing: how often the game actually draws. Drawing fewer frames is the cheapest way to
 * keep a phone cool without losing picture quality (resolution and effects stay as they are).
 *
 *  - Never above 60 fps, even on 90/120 Hz screens (twice the heat for little gain here).
 *  - 30 fps when nothing is happening (no touch, not moving, no burst running) for 3 s, 20 fps
 *    after 20 s; straight back to 60 on the next touch.
 *  - Heat: battery saver or a hot phone (OS thermal state, Android headroom forecast) caps the
 *    rate at 30 (20 when critical) before the OS throttles the chip and dims the screen; a warm
 *    one idles down after 1 s instead of 3.
 *  - Struggling: if frames keep taking most of the 60 fps budget, it settles at a steady 30
 *    rather than a hot, juddery 40–55, and tries 60 again once frames are cheap.
 *
 * Frames are whole multiples of the screen's refresh (every 2nd vsync = 30 on 60 Hz, every 4th on
 * 120 Hz), so motion stays even. Usage in the requestAnimationFrame loop:
 *
 *   if (!pacer.shouldRender(now)) { requestAnimationFrame(frame); return; }
 *   …update + render…
 *   pacer.frameDone(msOfWork);
 *
 * plus `pacer.poke()` on any touch/key, `pacer.active(true)` while something is moving, and
 * `pacer.setThermal(state)` from vv-thermal.
 */

export type PacerReason = 'play' | 'idle' | 'deep-idle' | 'battery' | 'warm' | 'hot' | 'critical' | 'struggling';

const IDLE_AFTER = 3000;
const DEEP_IDLE_AFTER = 20000;
/** Average work above this share of a 60 fps frame for STRUGGLE_FOR → drop to 30. */
const STRUGGLE_LOAD = 0.8;
const STRUGGLE_FOR = 3000;
/** …and back to 60 once work stays under this share for RECOVER_FOR (and at least HOLD after dropping). */
const RECOVER_LOAD = 0.5;
const RECOVER_FOR = 5000;
const HOLD = 10000;

export class FramePacer {
  /** Estimated time between screen refreshes (ms). */
  private vsync = 1000 / 60;
  private lastTick = 0;
  private lastRender = 0;
  private lastPoke = 0;
  private workAvg = 0;
  private overSince = 0;
  private underSince = 0;
  private struggling = false;
  private struggleAt = 0;
  private thermal: ThermalState = { thermal: 0, lowPower: false, headroom: -1 };
  private target = 60;
  private why: PacerReason = 'play';
  private frames = 0;
  private windowStart = 0;
  private measured = 0;

  constructor(private readonly clock: () => number = () => performance.now()) {
    const t = clock();
    this.lastPoke = t;
    this.windowStart = t;
  }

  /** Touch, key or button: full frame rate right away. */
  poke() {
    this.lastPoke = this.clock();
    this.update(this.lastPoke);
  }

  /** Call each rendered frame with whether something is moving (player, camera, a burst, the dragon). */
  active(moving: boolean) {
    if (moving) this.lastPoke = this.clock();
  }

  setThermal(s: ThermalState) {
    this.thermal = s;
    this.update(this.clock());
  }

  /** After a pause (app in the background): don't count the gap as an idle stretch or a long frame. */
  reset() {
    const t = this.clock();
    this.lastTick = 0;
    this.lastRender = 0;
    this.lastPoke = t;
    this.overSince = this.underSince = 0;
    this.windowStart = t;
    this.frames = 0;
  }

  /** Called at every requestAnimationFrame; true when this vsync should draw a frame. */
  shouldRender(now = this.clock()): boolean {
    if (this.lastTick) {
      const d = now - this.lastTick;
      // Learn the refresh interval from normal ticks (ignore hitches and pauses).
      if (d > 4 && d < this.vsync * 1.5) this.vsync += (d - this.vsync) * 0.05;
    }
    this.lastTick = now;
    this.update(now);
    // Whole vsyncs per frame, never faster than the target (90 Hz + 60 target → every 2nd = 45).
    const every = Math.max(1, Math.ceil(1000 / this.target / this.vsync - 0.1));
    // Half a vsync of slack so a slightly early tick still counts (and dropped frames don't add up).
    if (this.lastRender && now - this.lastRender < every * this.vsync - this.vsync * 0.5) return false;
    this.lastRender = now;
    this.frames++;
    if (now - this.windowStart >= 1000) {
      this.measured = (this.frames * 1000) / (now - this.windowStart);
      this.frames = 0;
      this.windowStart = now;
    }
    return true;
  }

  /** How long the frame's own work took (update + render, ms): drives the "struggling" check. */
  frameDone(workMs: number) {
    const now = this.clock();
    this.workAvg += (workMs - this.workAvg) * 0.1;
    const budget = 1000 / 60;
    if (this.workAvg > budget * STRUGGLE_LOAD) {
      this.underSince = 0;
      if (!this.overSince) this.overSince = now;
      if (!this.struggling && now - this.overSince > STRUGGLE_FOR) {
        this.struggling = true;
        this.struggleAt = now;
      }
    } else {
      this.overSince = 0;
      if (this.workAvg < budget * RECOVER_LOAD) {
        if (!this.underSince) this.underSince = now;
        if (this.struggling && now - this.underSince > RECOVER_FOR && now - this.struggleAt > HOLD) this.struggling = false;
      } else this.underSince = 0;
    }
    this.update(now);
  }

  /** Target frames per second right now. */
  get fps() {
    return this.target;
  }

  /** For the [perf] log: target, why, frames actually drawn last second, refresh rate, work. */
  get status() {
    return { fps: this.target, reason: this.why, drawn: Math.round(this.measured), hz: Math.round(1000 / this.vsync), workMs: +this.workAvg.toFixed(1) };
  }

  private update(now: number) {
    let fps = 60;
    let why: PacerReason = 'play';
    const cap = (f: number, r: PacerReason) => { if (f < fps) { fps = f; why = r; } };
    const { thermal, lowPower, headroom } = this.thermal;
    // Warm ("fair"): still smooth while playing, but idles sooner. On a 120 Hz screen it also
    // plays at 40 (every 3rd vsync); a 60 Hz screen can't do 40 evenly, so it stays at 60 there.
    const warm = thermal === 1 || (headroom >= 0.8 && headroom < 0.95);
    const idle = now - this.lastPoke;
    if (idle > DEEP_IDLE_AFTER) cap(20, 'deep-idle');
    else if (idle > (warm ? 1000 : IDLE_AFTER)) cap(30, 'idle');
    if (thermal >= 3) cap(20, 'critical');
    else if (thermal >= 2 || headroom >= 0.95) cap(30, 'hot');
    else if (warm && 1000 / this.vsync > 100) cap(40, 'warm');
    if (lowPower) cap(30, 'battery');
    if (this.struggling) cap(30, 'struggling');
    this.target = fps;
    this.why = why;
  }
}
