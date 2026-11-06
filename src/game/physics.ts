import { Block } from './blocks';
import { World } from './world';

export const PLAYER_HALF = 0.3;
export const PLAYER_HEIGHT = 1.7;
export const EYE_HEIGHT = 1.55;

export type Body = { x: number; y: number; z: number; vy: number; onGround: boolean };

/** Whether the player's box at feet (x,y,z) overlaps a solid block. */
export function collides(world: World, x: number, y: number, z: number): boolean {
  const x0 = Math.floor(x - PLAYER_HALF), x1 = Math.floor(x + PLAYER_HALF - 1e-4);
  const y0 = Math.floor(y), y1 = Math.floor(y + PLAYER_HEIGHT - 1e-4);
  const z0 = Math.floor(z - PLAYER_HALF), z1 = Math.floor(z + PLAYER_HALF - 1e-4);
  for (let bx = x0; bx <= x1; bx++)
    for (let by = y0; by <= y1; by++)
      for (let bz = z0; bz <= z1; bz++)
        if (world.isSolid(bx, by, bz)) return true;
  return false;
}

export function inWater(world: World, b: Body) {
  return world.get(Math.floor(b.x), Math.floor(b.y + 0.6), Math.floor(b.z)) === Block.Water;
}

/**
 * Moves one axis at a time and stops at walls, so the player slides along
 * them. Small steps keep fast movement from tunnelling.
 */
export function move(world: World, b: Body, dx: number, dy: number, dz: number) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.25));
  b.onGround = false;
  for (let i = 0; i < steps; i++) {
    const sx = dx / steps, sy = dy / steps, sz = dz / steps;
    if (sx && !collides(world, b.x + sx, b.y, b.z)) b.x += sx;
    if (sz && !collides(world, b.x, b.y, b.z + sz)) b.z += sz;
    if (sy) {
      if (!collides(world, b.x, b.y + sy, b.z)) b.y += sy;
      else {
        if (sy < 0) {
          b.onGround = true;
          b.y = Math.floor(b.y + sy) + 1; // rest exactly on the block top
        }
        b.vy = 0;
      }
    }
  }
}
