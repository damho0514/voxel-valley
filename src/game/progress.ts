import AsyncStorage from '@react-native-async-storage/async-storage';
import { freshProgress, normalize, Progress } from './economy';

/*
 * The player's wallet and purchases, kept on this phone across worlds and rooms.
 * A tiny observable store: the game loop reads `progress.get()`, React subscribes with useProgress.
 */

const KEY = 'voxel-valley-go/progress-v1';

type Listener = (p: Progress) => void;

class ProgressStore {
  private value: Progress = freshProgress();
  private listeners = new Set<Listener>();
  private loaded: Promise<Progress> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  get() {
    return this.value;
  }

  load(): Promise<Progress> {
    this.loaded ??= AsyncStorage.getItem(KEY)
      .then((raw) => (raw ? normalize(JSON.parse(raw)) : freshProgress()))
      .catch(() => freshProgress())
      .then((p) => {
        // Money earned before loading finished (unlikely) is kept on top.
        const early = this.value;
        this.value = { ...p, money: p.money + early.money, earned: p.earned + early.earned };
        this.emit();
        return this.value;
      });
    return this.loaded;
  }

  set(next: Progress | ((p: Progress) => Progress)) {
    const v = typeof next === 'function' ? next(this.value) : next;
    if (v === this.value) return;
    this.value = v;
    this.emit();
    // Earning happens many times a second while drawing; write at most once a second.
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 1000);
  }

  /** Write now (leaving the game, app going to the background). */
  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    AsyncStorage.setItem(KEY, JSON.stringify(this.value)).catch(() => {});
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit() {
    for (const fn of this.listeners) fn(this.value);
  }
}

export const progress = new ProgressStore();
