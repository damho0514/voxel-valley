import { BLOCKS } from './blocks';
import type { World } from './world';

/*
 * The third-person camera: where it may stand without going into a wall, and how it looks down on
 * you when there's no room behind. Pure (no three.js), so it can be tested on its own.
 */

/** How far a ray from o along the unit direction d travels before it enters a solid block (at most `max`). */
export function freeDistance(world: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  if (BLOCKS[world.get(x, y, z)].solid) return 0;
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity, tdz = sz ? Math.abs(1 / dz) : Infinity;
  let tx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
  let ty = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
  let tz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
  for (;;) {
    let t: number;
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; }
    else { z += sz; t = tz; tz += tdz; }
    if (t >= max) return max;
    if (BLOCKS[world.get(x, y, z)].solid) return t;
  }
}

/** Free distance for a thick ray: the centre and four rays offset by `r` around it, whichever stops first. */
function fatFree(world: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, r = 0.22): number {
  // Two directions at right angles to d.
  let ax = -dz, ay = 0, az = dx;
  if (Math.hypot(ax, az) < 1e-3) { ax = 1; az = 0; }
  const al = Math.hypot(ax, ay, az);
  ax /= al; ay /= al; az /= al;
  const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
  let best = freeDistance(world, ox, oy, oz, dx, dy, dz, max);
  for (const [p, q] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const px = ox + (ax * p + bx * q) * r, py = oy + (ay * p + by * q) * r, pz = oz + (az * p + bz * q) * r;
    best = Math.min(best, freeDistance(world, px, py, pz, dx, dy, dz, max));
  }
  return best;
}

/** How far the camera keeps from any wall (its near plane must not reach through). */
const MARGIN = 0.3;
/** How high over your head the camera may climb when there's no room behind you. */
const RISE = 2.6;

/** Smoothed between frames by the caller. */
export type ShotState = { back: number; tight: number };
export const newShotState = (): ShotState => ({ back: 0, tight: 0 });

/**
 * Where the third-person camera goes this frame, and its pitch. Normally back over the right
 * shoulder (`want` blocks); when a wall is close behind, it rises above your head instead and
 * tilts down toward you, so a narrow corridor shows you and the way ahead rather than a wall.
 * Pulling in is instant (never through a wall); easing back out is gradual.
 */
export function thirdPersonShot(world: World, eye: { x: number; y: number; z: number }, yaw: number, pitch: number,
  want: number, st: ShotState, dt: number): { x: number; y: number; z: number; pitch: number; dist: number } {
  const cp = Math.cos(pitch);
  const dx = -Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(yaw) * cp;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const u = want / 4.2;
  // Over the shoulder: back along the view, a little up and to the right.
  let bx = -dx * want + rx * 0.55 * u, by = -dy * want + 0.45 * u, bz = -dz * want + rz * 0.55 * u;
  const len = Math.hypot(bx, by, bz) || 1;
  bx /= len; by /= len; bz /= len;
  const room = Math.max(0, Math.min(len, fatFree(world, eye.x, eye.y, eye.z, bx, by, bz, len + MARGIN) - MARGIN));
  st.back = room < st.back ? room : st.back + (room - st.back) * Math.min(1, dt * 4);

  // How cramped it is: no room for at least 80% of the shot → move toward the overhead view.
  const tight = Math.max(0, Math.min(1, (len * 0.8 - room) / (len * 0.55)));
  st.tight += (tight - st.tight) * Math.min(1, dt * (tight > st.tight ? 10 : 3));
  const s = st.tight;

  const nx = eye.x + bx * st.back, ny = eye.y + by * st.back, nz = eye.z + bz * st.back;
  if (s < 0.01) return { x: nx, y: ny, z: nz, pitch, dist: st.back };

  // Overhead: straight up as far as the ceiling allows, then back a little, looking down at you.
  const up = Math.max(0, Math.min(RISE, fatFree(world, eye.x, eye.y, eye.z, 0, 1, 0, RISE + MARGIN) - MARGIN));
  const hx = Math.sin(yaw), hz = Math.cos(yaw); // behind you, level
  const py = eye.y + up;
  const behind = Math.max(0, Math.min(want * 0.5, fatFree(world, eye.x, py, eye.z, hx, 0, hz, want * 0.5 + MARGIN) - MARGIN));
  const ox = eye.x + hx * behind, oy = py, oz = eye.z + hz * behind;
  // Aim at the floor a few steps ahead: you at the bottom of the picture, the way on above you.
  const tx = eye.x - hx * 4, ty = eye.y - 1.2, tz = eye.z - hz * 4;
  // …but always steep enough to keep you in the lower part of the picture, even with the camera
  // right over your head (backed into a corner).
  const chest = Math.atan2(eye.y - 0.7 - oy, Math.max(0.01, behind));
  const down = Math.max(-1.25, Math.min(0.1, Math.atan2(ty - oy, Math.hypot(tx - ox, tz - oz)), chest + 0.3));
  const op = Math.min(down, pitch);

  let x = nx + (ox - nx) * s, y = ny + (oy - ny) * s, z = nz + (oz - nz) * s;
  // Blending the two spots could cut a corner: make sure the line from the eye is still clear.
  const lx = x - eye.x, ly = y - eye.y, lz = z - eye.z, l = Math.hypot(lx, ly, lz);
  if (l > 1e-3) {
    const free = fatFree(world, eye.x, eye.y, eye.z, lx / l, ly / l, lz / l, l + MARGIN) - MARGIN;
    if (free < l) {
      const k = Math.max(0, free) / l;
      x = eye.x + lx * k; y = eye.y + ly * k; z = eye.z + lz * k;
    }
  }
  return { x, y, z, pitch: pitch + (op - pitch) * s, dist: Math.hypot(x - eye.x, y - eye.y, z - eye.z) };
}
