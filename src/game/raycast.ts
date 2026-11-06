import { BLOCKS } from './blocks';
import { World } from './world';

export type Hit = { x: number; y: number; z: number; nx: number; ny: number; nz: number };

/** Voxel DDA (Amanatides & Woo): first solid block along the ray, with the face hit. */
export function raycast(world: World, ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number, maxDist: number): Hit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);
  const tdx = stepX ? Math.abs(1 / dx) : Infinity;
  const tdy = stepY ? Math.abs(1 / dy) : Infinity;
  const tdz = stepZ ? Math.abs(1 / dz) : Infinity;
  let tmx = stepX > 0 ? (x + 1 - ox) * tdx : stepX < 0 ? (ox - x) * tdx : Infinity;
  let tmy = stepY > 0 ? (y + 1 - oy) * tdy : stepY < 0 ? (oy - y) * tdy : Infinity;
  let tmz = stepZ > 0 ? (z + 1 - oz) * tdz : stepZ < 0 ? (oz - z) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  while (t <= maxDist) {
    if (BLOCKS[world.get(x, y, z)].solid) return { x, y, z, nx, ny, nz };
    if (tmx < tmy && tmx < tmz) { x += stepX; t = tmx; tmx += tdx; nx = -stepX; ny = 0; nz = 0; }
    else if (tmy < tmz) { y += stepY; t = tmy; tmy += tdy; nx = 0; ny = -stepY; nz = 0; }
    else { z += stepZ; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -stepZ; }
  }
  return null;
}
