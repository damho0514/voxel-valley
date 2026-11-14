import { Block, Dimension } from './blocks';
import { depositAt } from './treasure';
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
 * A gate: an arch 4 wide and 7 tall — two pillars, a rounded top with the corners cut away — around a
 * 2×5 portal, facing ±z, centred on x = cx (portal spans cx-1..cx).
 * `y0` is the floor the gate stands in: its bottom bar is flush with it, so you can walk straight in.
 */
function gate(cx: number, y0: number, z: number, portal: Block): Placed[] {
  const out: Placed[] = [];
  for (let x = cx - 2; x <= cx + 1; x++) {
    const pillar = x === cx - 2 || x === cx + 1;
    for (let y = y0; y <= y0 + 6; y++) {
      if (pillar && y === y0 + 6) continue; // the arch's rounded shoulders
      const inside = !pillar && y >= y0 + 1 && y <= y0 + 5;
      out.push([x, y, z, inside ? portal : Block.GateFrame]);
    }
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
  out.push(...castle(world));
  return out;
}

/** Where the castle stands: straight ahead of the valley spawn, past the gates. */
export const CASTLE = { x: 0, z: -48, halfX: 17, halfZ: 13 };

/**
 * 달빛 첨탑성 — an original night castle on a rocky rise: a curtain wall with battlements, four
 * round corner towers, a tall keep with rows of lit windows, four slender spires and one great
 * central spire, all under dark slate cones. Built as a list of blocks (like the gates) so every
 * player sees the same castle; hollow inside, so it's cheap to mesh and fun to break into.
 */
function castle(world: World): Placed[] {
  const { x: CX, z: CZ, halfX: HX, halfZ: HZ } = CASTLE;
  const cells = new Map<string, Placed>();
  const put = (x: number, y: number, z: number, b: Block) => {
    if (y < 1 || y >= HEIGHT) return;
    cells.set(`${x},${y},${z}`, [x, y, z, b]);
  };
  // The rise it stands on: level with the higher ground of the site, above the sea.
  let sum = 0, n = 0;
  for (let x = CX - HX; x <= CX + HX; x += 4) for (let z = CZ - HZ; z <= CZ + HZ; z += 4) { sum += world.surfaceHeight(x, z); n++; }
  const y0 = Math.max(SEA_LEVEL + 3, Math.min(20, Math.round(sum / n) + 2));
  const S = Block.Stone, ROOF = Block.Asphalt, LIT = Block.WindowLit, DARK = Block.Window, TRIM = Block.GateFrame;
  // Rock under the castle and a sloped skirt around it; clear any hill sticking up inside.
  for (let x = CX - HX - 6; x <= CX + HX + 6; x++)
    for (let z = CZ - HZ - 6; z <= CZ + HZ + 6; z++) {
      const out = Math.max(0, Math.abs(x - CX) - HX, Math.abs(z - CZ) - HZ);
      const top = y0 - 1 - out; // slopes down one block per block outside the walls
      const ground = world.surfaceHeight(x, z);
      for (let y = ground + 1; y <= top; y++) put(x, y, z, y === top && out > 0 ? world.ground : S);
      if (out === 0) {
        put(x, y0 - 1, z, S);
        for (let y = y0; y <= Math.max(ground, y0) + 1; y++) put(x, y, z, Block.Air);
      }
    }
  const hash = (x: number, y: number, z: number) => Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1;
  /** A window block: most are lit, a few are dark, for a lived-in look. */
  const win = (x: number, y: number, z: number) => (hash(x, y, z) < 0.82 ? LIT : DARK);
  /** Round tower: a stone shell with windows, a trim ring, then a slate cone. */
  const tower = (tx: number, tz: number, r: number, base: number, top: number, cone: number) => {
    for (let x = tx - r; x <= tx + r; x++)
      for (let z = tz - r; z <= tz + r; z++) {
        const d = Math.hypot(x - tx, z - tz);
        if (d > r + 0.35) continue;
        const shell = d > r - 0.85;
        for (let y = base; y <= top; y++) {
          if (!shell) { put(x, y, z, y === base ? S : Block.Air); continue; }
          const facing = Math.abs(Math.atan2(z - tz, x - tx));
          const window = (y - base) % 4 === 2 && y < top - 1 && Math.round(facing * 3) % 2 === 0;
          put(x, y, z, y === top ? TRIM : window ? win(x, y, z) : S);
        }
      }
    // Cone: radius shrinks to a point over `cone` blocks, overhanging the wall by one.
    for (let k = 0; k < cone; k++) {
      const rr = (r + 1) * (1 - k / cone);
      for (let x = Math.floor(tx - rr); x <= Math.ceil(tx + rr); x++)
        for (let z = Math.floor(tz - rr); z <= Math.ceil(tz + rr); z++)
          if (Math.hypot(x - tx, z - tz) <= rr + 0.2) put(x, top + 1 + k, z, ROOF);
    }
    put(tx, top + 1 + cone, tz, TRIM);
  };
  // Curtain wall with battlements and a gate facing the valley (+z).
  const WALL = 7;
  for (let x = CX - HX; x <= CX + HX; x++)
    for (let z = CZ - HZ; z <= CZ + HZ; z++) {
      const edge = x === CX - HX || x === CX + HX || z === CZ - HZ || z === CZ + HZ;
      if (!edge) continue;
      const gateway = z === CZ + HZ && Math.abs(x - CX) <= 2;
      for (let y = y0; y < y0 + WALL; y++) {
        if (gateway && y < y0 + 5) { put(x, y, z, Block.Air); continue; }
        put(x, y, z, gateway && y === y0 + 5 ? TRIM : S);
      }
      if ((x + z) % 2 === 0) put(x, y0 + WALL, z, S); // crenellations
    }
  // Lanterns either side of the gate.
  put(CX - 3, y0 + 3, CZ + HZ + 1, LIT);
  put(CX + 3, y0 + 3, CZ + HZ + 1, LIT);
  // Corner towers.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tower(CX + sx * HX, CZ + sz * HZ, 3, y0, y0 + 13, 7);
  // The keep: a tall hall with lit windows in rows and a stepped slate roof.
  const KX = 7, KZ = 5, KH = 16;
  const kz0 = CZ - 3;
  for (let x = CX - KX; x <= CX + KX; x++)
    for (let z = kz0 - KZ; z <= kz0 + KZ; z++) {
      const edge = x === CX - KX || x === CX + KX || z === kz0 - KZ || z === kz0 + KZ;
      for (let y = y0; y <= y0 + KH; y++) {
        if (!edge) { put(x, y, z, y === y0 ? S : Block.Air); continue; }
        const along = z === kz0 - KZ || z === kz0 + KZ ? x - CX : z - kz0;
        const window = (y - y0) % 4 === 2 && y < y0 + KH - 1 && along % 2 === 0 && Math.abs(along) < (z === kz0 - KZ || z === kz0 + KZ ? KX : KZ) - 1;
        put(x, y, z, y === y0 + KH ? TRIM : window ? win(x, y, z) : S);
      }
    }
  for (let k = 0; k <= KZ + 1; k++)
    for (let x = CX - KX - 1 + k; x <= CX + KX + 1 - k; x++)
      for (let z = kz0 - KZ - 1 + k; z <= kz0 + KZ + 1 - k; z++)
        if (x === CX - KX - 1 + k || x === CX + KX + 1 - k || z === kz0 - KZ - 1 + k || z === kz0 + KZ + 1 - k) put(x, y0 + KH + 1 + k, z, ROOF);
  // Slender spires at the keep's corners, and the great spire in the middle.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tower(CX + sx * KX, kz0 + sz * KZ, 2, y0 + KH - 2, y0 + KH + 6, 6);
  const spireTop = Math.min(HEIGHT - 9, y0 + KH + 12);
  tower(CX, kz0, 3, y0 + KH - 2, spireTop, Math.min(7, HEIGHT - 2 - spireTop));
  return [...cells.values()];
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
  // On the pavement right in front of the store's door, facing it.
  if (dim === 'store') return { pos: [0.5, STORE_GROUND + 1, 2.5], yaw: 0 };
  if (from === 'store') {
    // Out of the rift: back up on the grass near where the valley starts.
    const [x, y, z] = world.findSpawn(0, 3);
    return { pos: [x, y, z], yaw: 0 };
  }
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
      // Under the streets: stone with treasure, richer further down.
      for (let y = 1; y < G; y++) c.set(lx, y, lz, depositAt(n, x, y, z, G - y + 3) ?? Block.Stone);

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
        // Asteroid cores hide treasure (counted as deep: the further inside, the richer).
        const core = d < r - 1.2 ? depositAt(n, x, y, z, 6 + Math.floor((r - d) * 4)) : null;
        c.set(lx, y, lz, core ?? (n.hash01(x, z * 13 + y, 27) < 0.08 ? Block.Crystal : Block.Asteroid));
      }
    }
}

/*
 * 꿀알바 street: dig deep enough in the valley and space-time swallows you into a quiet street at
 * 3 a.m. with one 24-hour store, 꿀마트 24 (an original name, not any real chain). The street,
 * pavements and neighbouring buildings are generated per column; the store is placed block by block
 * (storeStructures) on top. The store faces +z toward the road; its door is at x = 0..1, z = -2.
 */
export const STORE_GROUND = 10;
const ROAD = { z0: 4, z1: 11 }; // asphalt; pavements either side
const NORTH = -2; // the store side's building line (front walls at z = -2)
const SOUTH = 15; // buildings across the road start here

/** One shell of a dim neighbouring building: brick walls, closed shutters below, a few lit windows. */
function neighbour(c: Chunk, lx: number, lz: number, x: number, z: number, ix: number, iz: number, w: number, d: number, h: number, front: 'n' | 's', seed: number, n: World['noise']) {
  const G = STORE_GROUND;
  const wall = ix === 0 || ix === w - 1 || iz === 0 || iz === d - 1;
  const frontRow = front === 'n' ? iz === d - 1 : iz === 0;
  for (let r = 1; r <= h; r++) {
    let b: Block = Block.Air;
    if (r === h) b = Block.Metal; // roof slab
    else if (wall) {
      if (frontRow && r <= 3 && ix > 0 && ix < w - 1) b = r === 3 ? Block.Awning : Block.Shutter;
      else if ((frontRow || ix === 0 || ix === w - 1) && r > 4 && r % 3 === 2 && ix % 2 === 1 && ix < w - 1)
        b = n.hash01(x * 7 + r, z, seed) < 0.22 ? Block.WindowLit : Block.Window;
      else b = Block.Brick;
    }
    if (b !== Block.Air) c.set(lx, G + r, lz, b);
  }
}

export function generateStore(world: World, c: Chunk) {
  const G = STORE_GROUND;
  const n = world.noise;
  for (let lx = 0; lx < CHUNK; lx++)
    for (let lz = 0; lz < CHUNK; lz++) {
      const x = c.cx * CHUNK + lx, z = c.cz * CHUNK + lz;
      c.set(lx, 0, lz, Block.Bedrock);
      for (let y = 1; y < G; y++) c.set(lx, y, lz, Block.Stone);
      if (z >= ROAD.z0 && z <= ROAD.z1) {
        // The road: a dashed centre line, and a zebra crossing in front of the store.
        const centre = z === 7 && mod(x, 6) < 3;
        const zebra = Math.abs(x) <= 3 && z >= ROAD.z0 + 1 && z <= ROAD.z1 - 1 && mod(x, 2) === 0;
        c.set(lx, G, lz, centre || zebra ? Block.RoadLine : Block.Asphalt);
        continue;
      }
      c.set(lx, G, lz, Block.Sidewalk);
      // Back alley behind the store row, and nothing beyond the outer rows.
      if (z <= -15 && z >= -17) { c.set(lx, G, lz, Block.Asphalt); continue; }
      if (z < -30 || z > 28) continue;
      if (z <= NORTH && z > -15) {
        // The store's own row: neighbours left and right of the store's lot.
        if (Math.abs(x) <= 10) continue; // the store (storeStructures) stands here
        const side = x > 0 ? 1 : -1;
        const ox = side > 0 ? x - 11 : -x - 11; // 0.. away from the store
        const lot = Math.floor(ox / 9), ix = ox % 9;
        if (ix === 8) continue; // a gap between buildings
        const h = 6 + Math.floor(n.hash01(lot * side, 1, 601) * 6);
        neighbour(c, lx, lz, x, z, side > 0 ? ix : 7 - ix, z + 14, 8, 13, h, 'n', 602, n);
        continue;
      }
      if (z <= -18) {
        // A second row of taller blocks behind the alley (seen over the store's roof).
        const lot = Math.floor(mod(x, 1000) / 10), ix = mod(x, 10);
        if (ix === 9) continue;
        const h = 9 + Math.floor(n.hash01(lot, 2, 603) * 10);
        neighbour(c, lx, lz, x, z, ix, z + 30, 9, 13, h, 'n', 604, n);
        continue;
      }
      if (z >= SOUTH) {
        // Across the road: a row of closed-up shops with flats above.
        const lot = Math.floor(mod(x, 1000) / 10), ix = mod(x, 10);
        if (ix === 9) continue;
        const h = 6 + Math.floor(n.hash01(lot, 3, 605) * 9);
        neighbour(c, lx, lz, x, z, ix, z - SOUTH, 9, 14, h, 's', 606, n);
        continue;
      }
      // Streetlights along both kerbs.
      if ((z === 3 || z === 12) && mod(x, 12) === 6) {
        for (let y = G + 1; y <= G + 5; y++) c.set(lx, y, lz, Block.Metal);
        c.set(lx, G + 6, lz, Block.StreetLight);
      }
    }
}

/** 꿀마트 24, block by block: everything a Korean 24-hour store has, plus a studio flat upstairs. */
export function storeStructures(): Placed[] {
  const G = STORE_GROUND;
  const cells = new Map<string, Placed>();
  const put = (x: number, y: number, z: number, b: Block) => cells.set(`${x},${y},${z}`, [x, y, z, b]);
  const X0 = -8, X1 = 8, Z0 = -14, Z1 = -2; // outer walls
  const FLOOR = G, TOP = G + 5; // ceiling slab (the flat's floor)
  for (let x = X0; x <= X1; x++)
    for (let z = Z0; z <= Z1; z++) {
      const edge = x === X0 || x === X1 || z === Z0 || z === Z1;
      put(x, FLOOR, z, Block.StoreTile);
      for (let y = FLOOR + 1; y < TOP; y++) {
        if (!edge) { put(x, y, z, Block.Air); continue; }
        if (z === Z1 && x > X0 && x < X1) {
          // The shop front: floor-to-ceiling glass, with the automatic door left open in the middle.
          const door = (x === 0 || x === 1) && y <= FLOOR + 3;
          put(x, y, z, door ? Block.Air : y === TOP - 1 ? Block.StoreWall : Block.Glass);
          continue;
        }
        put(x, y, z, Block.StoreWall);
      }
      // Ceiling: white panels with rows of bright light panels.
      put(x, TOP, z, !edge && mod(x, 3) === 1 && mod(z, 3) === 0 ? Block.CeilingLight : Block.StoreWall);
    }
  // The sign band over the front and an orange awning over the door; the sign wraps the corners.
  for (let x = X0; x <= X1; x++) {
    put(x, TOP, Z1 + 1, Block.StoreSign);
    put(x, TOP - 1, Z1 + 1, Block.StoreSign);
    if (x >= -2 && x <= 3) put(x, FLOOR + 4, Z1 + 2, Block.Awning);
  }
  for (const x of [X0 - 1, X1 + 1]) for (let z = Z1 - 3; z <= Z1 + 1; z++) { put(x, TOP, z, Block.StoreSign); put(x, TOP - 1, z, Block.StoreSign); }

  // Inside, left to right. Snack aisles run front to back.
  for (const [ax, kind] of [[-6, Block.ShelfSnack], [-3, Block.ShelfNoodle], [0, Block.ShelfSnack]] as const)
    for (let z = -10; z <= -5; z++) {
      put(ax, FLOOR + 1, z, kind);
      put(ax, FLOOR + 2, z, z % 2 ? Block.ShelfSnack : kind);
    }
  // Drink coolers along the back wall (lit), three high.
  for (let x = -7; x <= 2; x++) for (let y = FLOOR + 1; y <= FLOOR + 3; y++) put(x, y, Z0 + 1, Block.Cooler);
  // Ice-cream chest freezer under the front window, left of the door.
  for (let x = -7; x <= -5; x++) put(x, FLOOR + 1, Z1 - 1, Block.Freezer);
  // ATM in the front-left corner, against the side wall.
  put(-7, FLOOR + 1, -12, Block.Atm);
  put(-7, FLOOR + 2, -12, Block.Atm);
  // The counter: along x = 3 from the door back, with the till, coffee machine and the staff side.
  for (let z = -7; z <= -3; z++) put(3, FLOOR + 1, z, Block.Counter);
  put(3, FLOOR + 2, -5, Block.Register);
  put(3, FLOOR + 2, -3, Block.CoffeeMachine);
  put(3, FLOOR + 2, -7, Block.DeliveryBox); // a parcel waiting for pickup
  // Behind the counter: the wall of small colourful packs.
  for (let z = -7; z <= -3; z++) for (let y = FLOOR + 1; y <= FLOOR + 3; y++) put(X1 - 1, y, z, Block.CigWall);
  // Ramen corner: a ledge with the hot-water dispenser and a microwave.
  for (let z = -10; z <= -9; z++) put(X1 - 1, FLOOR + 1, z, Block.Counter);
  put(X1 - 1, FLOOR + 2, -10, Block.HotWater);
  put(X1 - 1, FLOOR + 2, -9, Block.Microwave);
  // Staff room in the back-right corner: a partition with a door, and a back door to the alley.
  for (let x = 4; x <= X1 - 1; x++) for (let y = FLOOR + 1; y < TOP; y++) put(x, y, -11, x === 5 && y <= FLOOR + 2 ? Block.StaffDoor : Block.StoreWall);
  for (let x = 4; x <= X1 - 1; x++) for (let z = -13; z <= -12; z++) for (let y = FLOOR + 1; y < TOP; y++) put(x, y, z, Block.Air);
  put(X1 - 1, FLOOR + 1, -13, Block.DeliveryBox);
  put(X1 - 1, FLOOR + 2, -13, Block.DeliveryBox);
  put(4, FLOOR + 1, -13, Block.PlasticChair);
  put(6, FLOOR + 1, Z0, Block.StaffDoor);
  put(6, FLOOR + 2, Z0, Block.StaffDoor);

  // Outside: recycling bins by the door, parcels stacked at the corner, the green plastic tables
  // with chairs and a parasol (the street's best seat for cup noodles at 3 a.m.).
  put(-3, FLOOR + 1, Z1 + 1, Block.TrashBin);
  put(-4, FLOOR + 1, Z1 + 1, Block.TrashBin);
  put(X0, FLOOR + 1, Z1 + 1, Block.DeliveryBox);
  put(X0, FLOOR + 2, Z1 + 1, Block.DeliveryBox);
  put(X0 + 1, FLOOR + 1, Z1 + 1, Block.DeliveryBox);
  for (const tx of [5, -6]) {
    put(tx, FLOOR + 1, 1, Block.PlasticTable);
    put(tx - 1, FLOOR + 1, 1, Block.PlasticChair);
    put(tx + 1, FLOOR + 1, 1, Block.PlasticChair);
    put(tx, FLOOR + 2, 1, Block.Metal); // parasol pole
    put(tx, FLOOR + 3, 1, Block.Metal);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(tx + dx, FLOOR + 4, 1 + dz, Block.Parasol);
  }

  // Upstairs: a tiny studio flat (원룸) with lit windows, a bed and a desk, reached by an outside stair.
  const F2 = TOP, R2 = TOP + 4;
  for (let x = X0; x <= X1; x++)
    for (let z = Z0; z <= Z1; z++) {
      const edge = x === X0 || x === X1 || z === Z0 || z === Z1;
      if (!edge && cells.get(`${x},${F2},${z}`)?.[3] !== Block.CeilingLight) put(x, F2, z, Block.Plank);
      for (let y = F2 + 1; y < R2; y++) {
        if (!edge) { put(x, y, z, Block.Air); continue; }
        const win = (z === Z1 || z === Z0) && y === F2 + 2 && mod(x, 3) === 0 && x > X0 && x < X1;
        put(x, y, z, win ? (x < 0 ? Block.WindowLit : Block.Window) : Block.Brick);
      }
      put(x, R2, z, Block.Metal);
    }
  for (let z = -13; z <= -12; z++) { put(-6, F2 + 1, z, Block.Bedding); put(-5, F2 + 1, z, Block.Bedding); }
  put(-7, F2 + 1, -13, Block.Plank); // headboard shelf
  put(5, F2 + 1, -13, Block.Counter); // desk
  put(6, F2 + 1, -13, Block.Counter);
  put(5, F2 + 2, -13, Block.Register); // a laptop glowing at 3 a.m.
  for (let k = 0; k < 3; k++) put(5 + k, F2 + 1, -3, Block.DeliveryBox); // unopened online orders
  put(X1, F2 + 1, -4, Block.Air); // the flat's door, left open at the top of the stair
  put(X1, F2 + 2, -4, Block.Air);
  put(X1, F2 + 3, -4, Block.StaffDoor); // its frame
  // Outside stair up the right side of the building: five steps, then a landing at the door.
  for (let k = 0; k <= 4; k++) {
    const z = 1 - k;
    for (let y = FLOOR + 1; y <= FLOOR + k + 1; y++) put(X1 + 1, y, z, Block.Metal);
  }
  put(X1 + 1, F2, -4, Block.Metal); // landing

  // The way home: a gate on the pavement to the right of the tables.
  for (const p of gate(14, STORE_GROUND, 2, Block.PortalHome)) cells.set(`${p[0]},${p[1]},${p[2]}`, p);
  return [...cells.values()];
}
