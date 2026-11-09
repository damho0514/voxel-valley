import { Block, Dimension } from './blocks';
import type { Chunk, World } from './world';
import { CHUNK, HEIGHT, SEA_LEVEL } from './world';

/** Ground level of the future city and the floor height of the space station. */
export const CITY_GROUND = 10;
export const STATION_Y = 24;
const BLOCK = 20; // city block: 4 road + 16 lot
const PLAZA = { x: 10, z: 12 }; // open plaza around the arrival point
const CELL = 32; // one asteroid per cell in space

export type Placed = [x: number, y: number, z: number, b: Block];

/** The black hole hanging in front of the space station (visible from the arrival point). */
export const BLACK_HOLE = { x: 0, y: 44, z: 175, horizon: 16, reach: 130 };

const mod = (a: number, b: number) => ((a % b) + b) % b;

/**
 * A gate: a 4×6 frame with a 2×4 portal, facing ±z, centred on x = cx (portal spans cx-1..cx).
 * `y0` is the floor the gate stands in: its bottom bar is flush with it, so you can walk straight in.
 */
function gate(cx: number, y0: number, z: number, portal: Block): Placed[] {
  const out: Placed[] = [];
  for (let x = cx - 2; x <= cx + 1; x++)
    for (let y = y0; y <= y0 + 5; y++) {
      const inside = x >= cx - 1 && x <= cx && y >= y0 + 1 && y <= y0 + 4;
      out.push([x, y, z, inside ? portal : Block.GateFrame]);
    }
  return out;
}

/** Where gates stand in the valley, and where you appear when you come back through one. */
export const VALLEY_GATES = [
  { cx: -4, z: -8, portal: Block.PortalFuture, to: 'future' as Dimension },
  { cx: 5, z: -8, portal: Block.PortalSpace, to: 'space' as Dimension },
];

/**
 * The two gates near the valley spawn, on a small stone pad (lifted above water if needed).
 * Pure function of the terrain generator, so every player sees them in the same place.
 */
export function valleyStructures(world: World): Placed[] {
  const out: Placed[] = [];
  for (const g of VALLEY_GATES) {
    // Level with the ground you walk up from (the far end of the approach path), above the sea.
    const y0 = Math.min(HEIGHT - 10, Math.max(SEA_LEVEL + 1, world.surfaceHeight(g.cx - 1, g.z + 7) + 1));
    for (let x = g.cx - 3; x <= g.cx + 2; x++)
      for (let z = g.z - 2; z <= g.z + 6; z++) {
        // Fill down to the ground so the pad never floats, then carve the space above it.
        for (let y = Math.max(1, world.surfaceHeight(x, z) + 1); y < y0 - 1; y++) out.push([x, y, z, Block.Stone]);
        out.push([x, y0 - 1, z, z > g.z + 1 ? Block.Stone : Block.GateFrame]);
        for (let y = y0; y <= y0 + 8; y++) out.push([x, y, z, Block.Air]);
      }
    out.push(...gate(g.cx, y0 - 1, g.z, g.portal));
  }
  return out;
}

export function futureStructures(): Placed[] {
  return gate(1, CITY_GROUND, -8, Block.PortalHome);
}

export function spaceStructures(): Placed[] {
  const out: Placed[] = [];
  for (let x = -7; x <= 7; x++)
    for (let z = -9; z <= 7; z++) {
      const edge = Math.abs(x) === 7 || z === -9 || z === 7;
      out.push([x, STATION_Y, z, edge ? Block.Neon : Block.Station]);
      if (edge && (x + z) % 3 === 0) out.push([x, STATION_Y - 1, z, Block.Metal]);
    }
  // A glass canopy ring and a few lamps.
  for (const [x, z] of [[-7, 7], [7, 7], [-7, -9], [7, -9]]) {
    for (let y = STATION_Y + 1; y <= STATION_Y + 3; y++) out.push([x, y, z, Block.Metal]);
    out.push([x, STATION_Y + 4, z, Block.Crystal]);
  }
  out.push(...gate(1, STATION_Y, -8, Block.PortalHome));
  return out;
}

/** Arrival spot (feet) and facing for each dimension. Valley arrival is in front of the gate you used. */
export function arrival(world: World, dim: Dimension, from?: Dimension): { pos: [number, number, number]; yaw: number } {
  if (dim === 'future') return { pos: [0.5, CITY_GROUND + 1, -5], yaw: Math.PI };
  if (dim === 'space') return { pos: [0.5, STATION_Y + 1, -5], yaw: Math.PI };
  const g = VALLEY_GATES.find((v) => v.to === from) ?? VALLEY_GATES[0];
  const x = g.cx - 0.5, z = g.z + 3.5;
  let y = HEIGHT - 2;
  while (y > 0 && !world.isSolid(Math.floor(x), y, Math.floor(z))) y--;
  return { pos: [x, y + 1, z], yaw: 0 };
}

/** The future city: a street grid of glass-and-metal towers with lit windows and neon roofs. */
export function generateFuture(world: World, c: Chunk) {
  const G = CITY_GROUND;
  const n = world.noise;
  for (let lx = 0; lx < CHUNK; lx++)
    for (let lz = 0; lz < CHUNK; lz++) {
      const x = c.cx * CHUNK + lx, z = c.cz * CHUNK + lz;
      c.set(lx, 0, lz, Block.Bedrock);
      for (let y = 1; y < G; y++) c.set(lx, y, lz, Block.Stone);

      if (Math.abs(x) <= PLAZA.x && Math.abs(z) <= PLAZA.z) {
        const ring = Math.abs(x) === PLAZA.x || Math.abs(z) === PLAZA.z;
        c.set(lx, G, lz, ring ? Block.Neon : (x + z) % 2 === 0 ? Block.Station : Block.Metal);
        continue;
      }
      const rx = mod(x, BLOCK), rz = mod(z, BLOCK);
      if (rx < 4 || rz < 4) {
        const line = (rx === 2 && rz >= 4 && mod(z, 4) < 2) || (rz === 2 && rx >= 4 && mod(x, 4) < 2);
        c.set(lx, G, lz, line ? Block.RoadLine : Block.Asphalt);
        continue;
      }
      const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK);
      const ix = rx - 4, iz = rz - 4; // 0..15 inside the lot
      const kind = n.hash01(bx, bz, 11);
      c.set(lx, G, lz, Block.Station); // pavement
      if (kind < 0.18) {
        // A pocket park with neon lamp posts.
        if (ix >= 1 && ix <= 14 && iz >= 1 && iz <= 14) c.set(lx, G, lz, Block.Moss);
        if ((ix === 2 || ix === 13) && (iz === 2 || iz === 13)) {
          for (let y = G + 1; y <= G + 3; y++) c.set(lx, y, lz, Block.Metal);
          c.set(lx, G + 4, lz, Block.Neon);
        }
        continue;
      }
      if (ix < 2 || ix > 13 || iz < 2 || iz > 13) continue;
      const h = 8 + Math.floor(n.hash01(bx, bz, 12) * 28);
      const lit = 0.25 + n.hash01(bx, bz, 13) * 0.35;
      const wall = ix === 2 || ix === 13 || iz === 2 || iz === 13;
      for (let r = 1; r <= h && G + r < HEIGHT; r++) {
        let b = Block.Metal;
        if (r === h) b = wall ? Block.Neon : Block.Metal;
        else if (wall && r % 4 !== 0) b = n.hash01(x * 31 + r, z, 14) < lit ? Block.WindowLit : Block.Window;
        c.set(lx, G + r, lz, b);
      }
    }
}

/** Outer space: floating asteroids (with glowing crystal veins) in a sea of nothing. */
export function generateSpace(world: World, c: Chunk) {
  const n = world.noise;
  for (let lx = 0; lx < CHUNK; lx++)
    for (let lz = 0; lz < CHUNK; lz++) {
      const x = c.cx * CHUNK + lx, z = c.cz * CHUNK + lz;
      const cellX = Math.floor(x / CELL), cellZ = Math.floor(z / CELL);
      if (n.hash01(cellX, cellZ, 21) < 0.25) continue; // empty cell
      const ax = cellX * CELL + 7 + n.hash01(cellX, cellZ, 22) * 18;
      const az = cellZ * CELL + 7 + n.hash01(cellX, cellZ, 23) * 18;
      const ay = 6 + n.hash01(cellX, cellZ, 24) * 34;
      const r = 2.5 + n.hash01(cellX, cellZ, 25) * 3.5;
      if (Math.hypot(ax, az) < 16) continue; // keep the station clear
      const dxz = Math.hypot(x + 0.5 - ax, z + 0.5 - az);
      if (dxz > r + 1) continue;
      for (let y = Math.max(1, Math.floor(ay - r - 1)); y <= Math.min(HEIGHT - 1, Math.ceil(ay + r + 1)); y++) {
        const d = Math.hypot(dxz, y + 0.5 - ay);
        const wobble = (n.hash01(x * 7 + y, z, 26) - 0.5) * 1.2;
        if (d > r + wobble) continue;
        c.set(lx, y, lz, n.hash01(x, z * 13 + y, 27) < 0.08 ? Block.Crystal : Block.Asteroid);
      }
    }
}
