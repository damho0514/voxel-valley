import type { Dimension } from './blocks';
import { PARK_GROUND } from './darkworlds';

/** A background loop: one per dimension, zones inside some of them, and the lobby (title) and market (level-up) themes. */
export type Track = Dimension | 'castle' | 'parkingUnder' | 'lobby' | 'battle';

/**
 * Which loop fits where you stand. Places change the sound, not only gates: walking down the car
 * park's ramps below the street, for one.
 */
// x and z are kept so zones can depend on where you stand again (the castle grounds did).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function trackAt(dim: Dimension, x: number, y: number, z: number): Track {
  // The valley keeps its own original music everywhere (the castle loop is not used there).
  if (dim === 'valley') return 'valley';
  if (dim === 'parking') return y < PARK_GROUND - 0.5 ? 'parkingUnder' : 'parking';
  return dim;
}
