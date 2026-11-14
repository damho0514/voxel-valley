import type { Species } from './game/bots';

/*
 * Types and helpers shared by the title screen (App.tsx) and the lazily loaded play screen.
 * Keep this free of runtime imports from the game/render code: it's part of the startup bundle.
 */

export type LookMode = 'stick' | 'steer' | 'tilt' | 'drag';
/** Camera: from your own eyes, or from behind your character. */
export type ViewMode = 'first' | 'third';
export type Profile = { name: string; color: number; sensitivity?: number; autoJump?: boolean; lookMode?: LookMode; view?: ViewMode; pets?: Species[] };

/** solo: offline, saved on this phone. host: a new shared world. guest: someone else's world. */
export type Mode =
  | { kind: 'solo'; fresh: boolean }
  | { kind: 'host'; code: string; fromSave?: boolean }
  | { kind: 'guest'; code: string };

export const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
