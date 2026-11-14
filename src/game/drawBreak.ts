import type { VoxelRenderer } from '../render/renderer';
import type { Pt } from '../render/overlay';
import { Block, BLOCKS } from './blocks';
import { blockValue, comboMultiplier, LOOP_BONUS, Weapon } from './economy';
import type { Game } from './game';
import { time } from './prof';
import type { Hit } from './raycast';

/*
 * Draw, then cast. Drawing over blocks only marks them: they glow gold under the wand and stay
 * marked across strokes. Close a stroke into a loop and everything inside is marked too (worth
 * double). Nothing breaks until the 💥 button: then the marked blocks shatter in a wave rippling
 * out from the middle, paying money. The weapon sets how wide and deep a stroke reaches and how
 * many blocks one cast can take ("energy").
 *
 * Runs from the play screen's frame loop; all screen positions are touch points (y down).
 */

export type StrokeSummary = { total: number; blocks: number; loop: number; capped: boolean };

export type BreakerFx = {
  sound: (name: 'break' | 'boom' | 'zap') => void;
  buzz: (kind: 'light' | 'medium' | 'heavy') => void;
  shake: (amp: number, seconds: number) => void;
  /** Money from the blocks that just broke, to show near `at`. */
  earn: (amount: number, at: Pt, combo: number) => void;
  /** The cast and everything it set off has finished breaking. */
  done: (s: StrokeSummary) => void;
  toast: (text: string) => void;
  /** How many blocks are marked now (0 after a cast or clear). */
  selection: (count: number, cap: number) => void;
};

/** Distance between samples along the stroke, in points. */
const STEP = 7;

type Marked = { hit: Hit; loop: boolean };
type Queued = { hit: Hit; at: number; loop: boolean };

const GOLD: [number, number, number][] = [[1, 0.82, 0.38], [1, 0.62, 0.22], [1, 0.95, 0.75]];

export class DrawBreaker {
  private stroke: Pt[] = [];
  private last: Pt | null = null;
  private length = 0;
  private drawing = false;
  /** Blocks marked since the last cast ("x,y,z"). */
  private claimed = new Set<string>();
  private marked: Marked[] = [];
  private queue: Queued[] = [];
  private glowDirty = false;
  private clock = 0;
  private broken = 0;
  private loopBroken = 0;
  private total = 0;
  private capped = false;
  private lastBreakSound = 0;
  private lastSpark = 0;
  private lastGlow = 0;
  private width = 1;
  private height = 1;
  /** Screen point where the last cast is centred (for coins). */
  private castAt: Pt | null = null;

  constructor(
    private readonly game: Game,
    private readonly view: VoxelRenderer,
    private readonly fx: BreakerFx,
    /** The weapon in hand and the income multiplier, read when marking starts and at each cast. */
    private readonly loadout: () => { weapon: Weapon; income: number },
  ) {}

  private weapon: Weapon | null = null;
  private income = 1;

  setSize(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.view.overlay.setSize(w, h);
  }

  /** Something is marked or still shattering. */
  get busy() {
    return this.drawing || this.queue.length > 0 || this.marked.length > 0;
  }

  get count() {
    return this.marked.length;
  }

  begin(p: Pt) {
    const l = this.loadout();
    this.weapon = l.weapon;
    this.income = l.income;
    this.stroke = [p];
    this.last = p;
    this.length = 0;
    this.drawing = true;
    this.sample(p);
    // No line follows the finger: only the blocks it picks light up, one by one.
  }

  move(p: Pt) {
    if (!this.drawing || !this.last) return;
    const from = this.last;
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d < 2) return;
    // Sample evenly so a fast swipe doesn't skip blocks.
    const n = Math.max(1, Math.floor(d / STEP));
    for (let i = 1; i <= n; i++) this.sample({ x: from.x + ((p.x - from.x) * i) / n, y: from.y + ((p.y - from.y) * i) / n });
    this.length += d;
    this.last = p;
    this.stroke.push(p);
    if (this.stroke.length > 400) this.stroke.splice(0, this.stroke.length - 400);
    this.view.wandCharge(1);
  }

  /**
   * Mouse painting (desktop, pointer locked): the cursor stays at the crosshair while the view
   * turns, so sample the same screen point every frame instead of waiting for it to move.
   */
  paint(p: Pt) {
    if (!this.drawing) return;
    this.sample(p);
    this.view.wandCharge(1);
  }

  end() {
    if (!this.drawing) return;
    this.drawing = false;
    this.view.overlay.release();
    const loop = this.closedLoop();
    if (loop) time('loop', () => this.markInside(loop));
  }

  /** Drop every mark without breaking anything. */
  clear() {
    if (this.drawing) this.end();
    this.marked = [];
    this.claimed.clear();
    this.capped = false;
    this.glowDirty = true;
    this.fx.selection(0, this.weapon?.cap ?? 0);
  }

  /**
   * 💥: the marked blocks shatter in a wave from the middle of the selection outward.
   * Returns false (and says why) when nothing is marked.
   */
  cast(): boolean {
    if (this.drawing) this.end();
    if (!this.marked.length) {
      this.fx.toast('✏️ 먼저 부술 블록 위에 손가락으로 그려 주세요');
      this.fx.buzz('light');
      return false;
    }
    // Anything still shattering from the last cast finishes now.
    if (this.queue.length) this.flushAll();
    const l = this.loadout();
    this.income = l.income;
    let cx = 0, cy = 0, cz = 0;
    for (const m of this.marked) { cx += m.hit.x; cy += m.hit.y; cz += m.hit.z; }
    const n = this.marked.length;
    cx /= n; cy /= n; cz /= n;
    let far = 1;
    for (const m of this.marked) far = Math.max(far, Math.hypot(m.hit.x - cx, m.hit.y - cy, m.hit.z - cz));
    // A short charge-up, then the wave: the middle goes first.
    const start = this.clock + 0.16;
    for (const m of this.marked) {
      const d = Math.hypot(m.hit.x - cx, m.hit.y - cy, m.hit.z - cz) / far;
      this.queue.push({ hit: m.hit, at: start + d * Math.min(0.55, 0.15 + n * 0.004), loop: m.loop });
    }
    this.broken = this.loopBroken = this.total = 0;
    const s = this.view.toScreen(cx + 0.5, cy + 0.5, cz + 0.5);
    this.castAt = s ? { x: ((s.nx + 1) / 2) * this.width, y: ((1 - s.ny) / 2) * this.height } : { x: this.width / 2, y: this.height / 2 };
    // The spell leaves the wand: a ribbon of sparks from the tip to the target, then the blast.
    const tip = this.view.wandTipWorld();
    if (tip) {
      for (let i = 0; i < 26; i++) {
        const u = i / 25;
        const x = tip.x + (cx + 0.5 - tip.x) * u, y = tip.y + (cy + 0.5 - tip.y) * u, z = tip.z + (cz + 0.5 - tip.z) * u;
        this.view.sparks.emit(x, y, z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6 + 0.3, (Math.random() - 0.5) * 0.6,
          0.35 + u * 0.4, 0.16 + Math.random() * 0.1, 1, 0.85, 0.5);
      }
    }
    this.view.wandCast();
    this.view.shockwave(cx + 0.5, cy + 0.5, cz + 0.5, Math.min(9, 2.5 + far * 1.2), Math.min(0.28, 0.1 + n / 600));
    this.view.sparks.burst(cx + 0.5, cy + 0.5, cz + 0.5, GOLD, { count: Math.min(140, 40 + n), speed: 7 + Math.min(6, n / 40), up: 2, life: 1.1, size: 0.3, spread: Math.min(4, 1 + far * 0.5) });
    this.fx.sound('zap');
    setTimeout(() => {
      this.fx.sound('boom');
      this.fx.shake(Math.min(0.7, 0.25 + n / 400), 0.6);
      this.fx.buzz('heavy');
    }, 160);
    this.marked = [];
    this.claimed.clear();
    this.glowDirty = true;
    this.fx.selection(0, this.weapon?.cap ?? 0);
    return true;
  }

  /** Runs every frame: shatters queued blocks whose time has come and pays for them. */
  tick(dt: number) {
    this.clock += dt;
    if (this.queue.length) {
      const due: Queued[] = [];
      const left: Queued[] = [];
      for (const q of this.queue) (q.at <= this.clock ? due : left).push(q);
      if (due.length) {
        this.queue = left;
        this.glowDirty = true;
        time('shatter', () => this.shatter(due));
      }
    }
    // The outline is rebuilt at most ~12 times a second while marking (it's O(marked)).
    if (this.glowDirty && (!this.drawing || this.clock - this.lastGlow > 0.08)) {
      this.glowDirty = false;
      this.lastGlow = this.clock;
      time('select', () => this.view.selection.set([...this.marked.map((m) => m.hit), ...this.queue.map((q) => q.hit)]));
    }
    if (!this.queue.length && this.weapon && this.broken) {
      this.fx.done({ total: Math.round(this.total), blocks: this.broken, loop: this.loopBroken, capped: this.capped });
      this.broken = this.loopBroken = this.total = 0;
      this.capped = false;
    }
  }

  /** Leaving the game: break whatever is mid-cast so the money isn't lost (marks are just dropped). */
  flushAll() {
    if (!this.queue.length) return;
    const all = this.queue;
    this.queue = [];
    this.glowDirty = true;
    this.shatter(all);
  }

  private trailWidth() {
    return 6 + (this.weapon?.brush ?? 0) * 0.45;
  }

  private ray(p: Pt) {
    return this.view.rayFromScreen((p.x / this.width) * 2 - 1, -((p.y / this.height) * 2 - 1));
  }

  /** Rays for the brush around a point: the centre, a ring at the brush radius, an inner ring. */
  private brush(p: Pt) {
    const w = this.weapon!;
    const pts: Pt[] = [p];
    if (w.brush > 0) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pts.push({ x: p.x + Math.cos(a) * w.brush, y: p.y + Math.sin(a) * w.brush });
        if (w.brush >= 20) pts.push({ x: p.x + Math.cos(a + 0.52) * w.brush * 0.5, y: p.y + Math.sin(a + 0.52) * w.brush * 0.5 });
      }
    }
    return pts.map((q) => this.ray(q));
  }

  /** Energy left for marking (loop-filled blocks don't count against it). */
  private room() {
    let used = 0;
    for (const m of this.marked) if (!m.loop) used++;
    return (this.weapon?.cap ?? 0) - used;
  }

  private sample(p: Pt) {
    const room = this.room();
    if (room <= 0) {
      if (!this.capped) {
        this.capped = true;
        this.fx.toast('⚡ 에너지 가득! 💥 부수기를 누르세요 · 상점의 더 센 지팡이는 한 번에 더 많이 부숴요');
        this.fx.buzz('medium');
      }
      return;
    }
    const w = this.weapon!;
    const hits = this.game.pickAlong(this.brush(p), w.depth, w.reach, room + 40);
    let added = 0;
    for (const h of hits) {
      if (added >= room) break;
      const key = `${h.x},${h.y},${h.z}`;
      if (this.claimed.has(key)) continue;
      this.claimed.add(key);
      this.marked.push({ hit: h, loop: false });
      added++;
    }
    if (added) {
      this.glowDirty = true;
      this.fx.selection(this.marked.length, w.cap);
      // A few motes where the wand touches the world.
      if (this.clock - this.lastSpark > 0.03) {
        this.lastSpark = this.clock;
        const h = hits[0];
        this.view.sparks.burst(h.x + 0.5, h.y + 0.5, h.z + 0.5, GOLD, { count: 3, speed: 1.2, up: 1, life: 0.6, size: 0.18, spread: 0.9 });
      }
    }
  }

  /** The stroke as a closed shape, if its ends meet and it encloses a real area. */
  private closedLoop(): Pt[] | null {
    const s = this.stroke;
    if (s.length < 8 || this.length < 180) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < 60 || bh < 60) return null;
    const gap = Math.hypot(s[0].x - s[s.length - 1].x, s[0].y - s[s.length - 1].y);
    return gap < Math.max(45, 0.3 * Math.min(bw, bh)) ? s : null;
  }

  /** Marks everything inside the loop (and a layer deeper); those blocks pay double. */
  private markInside(poly: Pt[]) {
    const w = this.weapon!;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const step = Math.max(11, Math.sqrt(((x1 - x0) * (y1 - y0)) / 700));
    const pts: Pt[] = [];
    for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (inside(poly, x, y)) pts.push({ x, y });
    if (!pts.length) return;
    const hits = this.game.pickAlong(pts.map((p) => this.ray(p)), w.depth + 1, w.reach, w.cap + 200);
    let added = 0;
    for (const h of hits) {
      if (added >= w.cap) break;
      const key = `${h.x},${h.y},${h.z}`;
      if (this.claimed.has(key)) continue;
      this.claimed.add(key);
      this.marked.push({ hit: h, loop: true });
      added++;
    }
    if (!added) return;
    this.glowDirty = true;
    // (The loop itself isn't drawn either: the blocks inside light up with the zap.)
    this.fx.sound('zap');
    this.fx.buzz('medium');
    this.fx.selection(this.marked.length, w.cap);
    this.fx.toast(`싹쓸이! 동그라미 안쪽 ${added}개까지 · 냥 곱절`);
  }

  /** Breaks a batch at once (one mesh rebuild per chunk, not per block) and pays for it. */
  private shatter(batch: Queued[]) {
    const every = Math.max(1, Math.round(batch.length / 20));
    let money = 0;
    batch.forEach((q, i) => {
      const was = time('s.smash', () => this.game.smash(q.hit.x, q.hit.y, q.hit.z));
      if (was === null) return;
      this.broken++;
      if (q.loop) this.loopBroken++;
      money += blockValue(was) * comboMultiplier(this.broken) * this.income * (q.loop ? LOOP_BONUS : 1);
      if (i % every === 0) {
        const info = BLOCKS[was as Block];
        const { x, y, z } = q.hit;
        time('s.burst', () => {
          this.view.effects.burst(x, y, z, [info.top, info.side, info.side], batch.length > 30 ? 3 : 6);
          this.view.sparks.burst(x + 0.5, y + 0.5, z + 0.5, [info.top, ...GOLD], { count: batch.length > 30 ? 4 : 8, speed: 3.5, up: 1.5, life: 0.8, size: 0.2 });
        });
      }
    });
    if (!money) return;
    this.total += money;
    const at = this.castAt ?? { x: this.width / 2, y: this.height / 2 };
    time('s.earn', () => this.fx.earn(money, at, comboMultiplier(this.broken)));
    if (this.clock - this.lastBreakSound > 0.07) {
      this.lastBreakSound = this.clock;
      time('s.sound', () => this.fx.sound('break'));
      time('s.buzz', () => this.fx.buzz('light'));
    }
  }
}

/** Point-in-polygon (even-odd rule). */
function inside(poly: Pt[], x: number, y: number) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
