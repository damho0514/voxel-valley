import type { Dimension } from './blocks';
import { PARK_GROUND } from './darkworlds';
import { CASTLE } from './dimensions';

/** A background loop: one per dimension, plus zones inside some of them. */
export type Track = Dimension | 'castle' | 'parkingUnder';

/**
 * Which loop fits where you stand. Places change the sound, not only gates: walking up to the
 * moonlit castle, or down the car park's ramps below the street.
 */
export function trackAt(dim: Dimension, x: number, y: number, z: number): Track {
  if (dim === 'valley') {
    const dx = Math.max(0, Math.abs(x - CASTLE.x) - CASTLE.halfX), dz = Math.max(0, Math.abs(z - CASTLE.z) - CASTLE.halfZ);
    return Math.hypot(dx, dz) < 14 ? 'castle' : 'valley';
  }
  if (dim === 'parking') return y < PARK_GROUND - 0.5 ? 'parkingUnder' : 'parking';
  return dim;
}
