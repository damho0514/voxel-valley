import { BuffId, buffOf } from './treasure';

/*
 * Mystic effects running right now (for this play session only). The game loop reads the
 * multipliers; React subscribes to show the chips with their countdown.
 */

type Listener = () => void;

export class Buffs {
  /** Buff → when it runs out (ms since epoch). */
  private until = new Map<BuffId, number>();
  private listeners = new Set<Listener>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Starts a timed effect; getting the same one again adds its time on top. */
  add(id: BuffId) {
    const b = buffOf(id);
    if (b.seconds <= 0) return;
    const t = this.now();
    this.until.set(id, Math.max(t, this.until.get(id) ?? 0) + b.seconds * 1000);
    this.emit();
  }

  has(id: BuffId) {
    const u = this.until.get(id);
    return u !== undefined && u > this.now();
  }

  /** Seconds left per running effect, soonest to end first. */
  list(): { id: BuffId; left: number }[] {
    const t = this.now();
    return [...this.until.entries()]
      .filter(([, u]) => u > t)
      .map(([id, u]) => ({ id, left: Math.ceil((u - t) / 1000) }))
      .sort((a, b) => a.left - b.left);
  }

  /** Drops finished effects; returns true (and tells listeners) if any ended. */
  prune() {
    const t = this.now();
    let changed = false;
    for (const [id, u] of this.until) if (u <= t) { this.until.delete(id); changed = true; }
    if (changed) this.emit();
    return changed;
  }

  clear() {
    if (!this.until.size) return;
    this.until.clear();
    this.emit();
  }

  /** Money multiplier from running effects. */
  get money() {
    return (this.has('midas') ? 2 : 1) * (this.has('disco') ? 3 : 1);
  }
  get jump() {
    return this.has('feather') ? 1.42 : 1; // jump speed ×1.42 = about twice as high
  }
  get walk() {
    return this.has('rocket') ? 1.6 : 1;
  }
  get infinite() {
    return this.has('infinite');
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export const buffs = new Buffs();
