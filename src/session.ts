import type { Season } from './game/blocks';
import type { Species } from './game/bots';

/*
 * Types and helpers shared by the title screen (App.tsx) and the lazily loaded play screen.
 * Keep this free of runtime imports from the game/render code: it's part of the startup bundle.
 */

export type LookMode = 'stick' | 'steer' | 'tilt' | 'drag';
export type Profile = { name: string; color: number; sensitivity?: number; autoJump?: boolean; lookMode?: LookMode; pets?: Species[] };

/** solo: offline, saved per season. host: a new shared world. guest: someone else's world. */
export type Mode =
  | { kind: 'solo'; season: Season; fresh: boolean }
  | { kind: 'host'; season: Season; code: string }
  | { kind: 'guest'; code: string };

export const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
