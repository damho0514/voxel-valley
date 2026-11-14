/*
 * The dark worlds, reached through the 자개 gate in the valley (all original designs).
 *
 * 노란 방 ('maze'): an endless, empty office floor nobody has used in years — mono-yellow striped
 * wallpaper, damp carpet, a low ceiling of acoustic tiles and a fluorescent panel in nearly every
 * room. The panels wake up a little as you come near and die behind you once you've passed (the
 * renderer does that; see renderer.ts mazeLamps). Nothing lives here. It is a real maze (seeded,
 * the same for everyone in a room): a big entrance room, open-plan halls with pillars and
 * half-height partitions, dead ends, and far away a door under a green 비상구 light that leads on.
 *
 * 끝없는 주차장 ('parking'): a car park four floors under the street and six above it plus the
 * roof, with colour-coded pillars per floor, parked cars, hanging tubes and ramps between floors.
 *
 * The world is 48 blocks tall, so the car park uses all of it: B4 sits on bedrock, the roof at 41.
 */
import { Block } from './blocks';
import type { Placed } from './dimensions';
import type { Chunk, World } from './world';
import { CHUNK, HEIGHT } from './world';

const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Small seeded PRNG (mulberry32). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A gate in a wall facing ±z: pillars at cx-2 and cx+1, portal cx-1..cx. `tall` = 7 (an arch) or 4 (a door). */
export function darkGate(cx: number, y0: number, z: number, portal: Block, frame: Block, tall: 4 | 7): Placed[] {
  const out: Placed[] = [];
  for (let x = cx - 2; x <= cx + 1; x++) {
    const pillar = x === cx - 2 || x === cx + 1;
    for (let y = y0; y < y0 + tall; y++) {
      if (tall === 7 && pillar && y === y0 + 6) continue;
      const inside = !pillar && y >= y0 + 1 && y <= y0 + tall - 2;
      out.push([x, y, z, inside ? portal : frame]);
    }
  }
  return out;
}

// ─────────────────────────────── 노란 방 ───────────────────────────────

export const MAZE_FLOOR = 10;
/** The ceiling slab, low enough to press down on you: walls stand between the floor and this. */
export const MAZE_CEIL = MAZE_FLOOR + 6;
/** One maze cell: 6 blocks of room and a 1-block wall. */
const CELL = 7;
/** Cells per side (21 × 7 = 147 blocks across). */
const N = 21;
const X0 = -Math.floor((N * CELL) / 2); // -73: the outer wall line
/** The entrance room: 3 × 3 cells in the middle, one big empty office (x, z from -9 to 10). */
const HALL = { lo: 9, hi: 11 };
const START = 10;

type Maze = {
  /** Open passages: "i,j,e" joins (i,j)–(i+1,j); "i,j,s" joins (i,j)–(i,j+1). */
  open: Set<string>;
  /** Hall id per cell (i + j*N), -1 for an ordinary corridor cell. Hall 0 is the entrance room. */
  hall: Int16Array;
  /** Steps from the entrance, per cell. */
  dist: Int32Array;
  /** The far cell with the way on to the car park, and its gate. */
  exit: { i: number; j: number; cx: number; z: number };
  /** Ceiling lights: cell → block (a fluorescent panel, or a green exit light on the last stretch). */
  lights: Map<number, Block>;
  structures: Placed[];
};

const cellX = (i: number) => X0 + i * CELL; // the wall line on the cell's -x side
const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N;
const idx = (i: number, j: number) => i + j * N;

let cached: { seed: number; maze: Maze } | null = null;

/** The maze for a world seed (built once, then reused). */
export function mazeOf(seed: number): Maze {
  if (cached?.seed === seed) return cached.maze;
  const maze = buildMaze(seed);
  cached = { seed, maze };
  return maze;
}

function buildMaze(seed: number): Maze {
  const rand = rng(seed ^ 0x5eed_a11);
  const open = new Set<string>();
  const hall = new Int16Array(N * N).fill(-1);
  const edge = (i: number, j: number, di: number, dj: number) =>
    di === 1 ? `${i},${j},e` : di === -1 ? `${i - 1},${j},e` : dj === 1 ? `${i},${j},s` : `${i},${j - 1},s`;
  // Behind the way-home gate (the entrance room's -z wall at the middle) stays shut.
  const forbidden = new Set([`${START},${HALL.lo - 1},s`]);

  // Halls: the entrance room, then a few more rooms of 2×2 or 3×2 cells scattered around.
  const markHall = (i0: number, j0: number, w: number, h: number, id: number) => {
    for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + h; j++) hall[idx(i, j)] = id;
    for (let i = i0; i < i0 + w; i++)
      for (let j = j0; j < j0 + h; j++) {
        if (i + 1 < i0 + w) open.add(`${i},${j},e`);
        if (j + 1 < j0 + h) open.add(`${i},${j},s`);
      }
  };
  markHall(HALL.lo, HALL.lo, 3, 3, 0);
  let id = 1;
  for (let tries = 0; tries < 60 && id <= 6; tries++) {
    const w = rand() < 0.5 ? 2 : 3, h = 2;
    const i0 = 1 + Math.floor(rand() * (N - w - 2)), j0 = 1 + Math.floor(rand() * (N - h - 2));
    let clear = true;
    for (let i = i0 - 1; i <= i0 + w && clear; i++) for (let j = j0 - 1; j <= j0 + h && clear; j++) if (inGrid(i, j) && hall[idx(i, j)] >= 0) clear = false;
    if (!clear) continue;
    markHall(i0, j0, w, h, id++);
  }

  // A perfect maze by depth-first search from the entrance…
  const seen = new Uint8Array(N * N);
  const stack: [number, number][] = [[START, START]];
  seen[idx(START, START)] = 1;
  const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const next = DIRS.map(([di, dj]) => [i + di, j + dj, di, dj] as const)
      .filter(([a, b, di, dj]) => inGrid(a, b) && !seen[idx(a, b)] && !forbidden.has(edge(i, j, di, dj)));
    if (!next.length) { stack.pop(); continue; }
    const [a, b, di, dj] = next[Math.floor(rand() * next.length)];
    open.add(edge(i, j, di, dj));
    seen[idx(a, b)] = 1;
    stack.push([a, b]);
  }
  // …then a few dead ends knocked through, so there's more than one way round (and it's easy to get lost).
  const openings = (i: number, j: number) => DIRS.filter(([di, dj]) => inGrid(i + di, j + dj) && open.has(edge(i, j, di, dj))).length;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      if (openings(i, j) !== 1 || rand() > 0.22) continue;
      const shut = DIRS.filter(([di, dj]) => inGrid(i + di, j + dj) && !open.has(edge(i, j, di, dj)) && !forbidden.has(edge(i, j, di, dj)));
      if (shut.length) { const [di, dj] = shut[Math.floor(rand() * shut.length)]; open.add(edge(i, j, di, dj)); }
    }

  // Distances from the entrance; the way on is at the farthest corridor cell.
  const dist = new Int32Array(N * N).fill(-1);
  const prev = new Int32Array(N * N).fill(-1);
  const queue = [idx(START, START)];
  dist[queue[0]] = 0;
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q], i = c % N, j = Math.floor(c / N);
    for (const [di, dj] of DIRS) {
      const a = i + di, b = j + dj;
      if (!inGrid(a, b) || !open.has(edge(i, j, di, dj)) || dist[idx(a, b)] >= 0) continue;
      dist[idx(a, b)] = dist[c] + 1;
      prev[idx(a, b)] = c;
      queue.push(idx(a, b));
    }
  }
  let far = queue[0];
  for (const c of queue) if (hall[c] < 0 && dist[c] > dist[far]) far = c;
  const ei = far % N, ej = Math.floor(far / N);
  const exit = { i: ei, j: ej, cx: cellX(ei) + 4, z: cellX(ej) + 3 };

  // Lights: a fluorescent panel in nearly every cell (a few long dead); green ones on the last stretch.
  const lights = new Map<number, Block>();
  for (let c = 0; c < N * N; c++) if (hall[c] >= 0 || rand() > 0.12) lights.set(c, Block.DimLamp);
  for (let c = prev[far], k = 0; c >= 0 && k < 4; c = prev[c], k++) lights.set(c, Block.ExitSign);

  const maze: Maze = { open, hall, dist, exit, lights, structures: [] };
  maze.structures = furnish(maze, rand);
  return maze;
}

/** Is there wall at this column (grid coords gx, gz from the outer corner)? */
function isWall(m: Maze, gx: number, gz: number): boolean {
  const lx = gx % CELL, lz = gz % CELL;
  const i = Math.floor(gx / CELL), j = Math.floor(gz / CELL);
  if (lx === 0 && lz === 0) {
    // A post where four cells meet: gone only in the middle of a hall.
    if (i <= 0 || j <= 0 || i >= N || j >= N) return true;
    const h = m.hall[idx(i - 1, j - 1)];
    return !(h >= 0 && m.hall[idx(i, j - 1)] === h && m.hall[idx(i - 1, j)] === h && m.hall[idx(i, j)] === h);
  }
  if (lx === 0) return i <= 0 || i >= N || !m.open.has(`${i - 1},${j},e`);
  if (lz === 0) return j <= 0 || j >= N || !m.open.has(`${i},${j - 1},s`);
  return false;
}

/** Wallpaper, or a damp-stained patch of it (the same pattern the walls use). */
function paper(x: number, y: number, z: number): Block {
  const h = Math.sin(Math.floor((x + z) / 3) * 12.9898 + Math.floor(y / 2) * 78.233) * 43758.5453;
  return h - Math.floor(h) < 0.14 ? Block.WallpaperStain : Block.Wallpaper;
}

/**
 * What little there is: chest-high papered partitions and square pillars in the open
 * halls, the way home in the entrance room, and the door on at the far end. Mostly, emptiness.
 */
function furnish(m: Maze, rand: () => number): Placed[] {
  const out: Placed[] = [];
  const F = MAZE_FLOOR;
  const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, b: Block | ((x: number, y: number, z: number) => Block)) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) out.push([x, y, z, typeof b === 'function' ? b(x, y, z) : b]);
  };
  const lo = (i: number) => cellX(i) + 1; // first open block of cell i
  const hi = (i: number) => cellX(i) + CELL - 1; // last open block
  /** A partition: a papered wall, chest-high, that hides whatever is behind it. */
  const partition = (x0: number, x1: number, z0: number, z1: number) => box(x0, x1, z0, z1, F + 1, F + 3, paper);
  const pillar = (x: number, z: number) => box(x, x + 1, z, z + 1, F + 1, MAZE_CEIL - 1, paper);

  // The entrance room. The way home stands against its -z wall in the middle.
  out.push(...darkGate(1, F, cellX(HALL.lo) + 1, Block.PortalHome, Block.Jagae, 4));
  // An L of partitions and two pillars, like a reception nobody staffs.
  partition(lo(HALL.lo) + 1, lo(HALL.lo) + 9, lo(HALL.hi) + 1, lo(HALL.hi) + 1);
  partition(lo(HALL.lo) + 1, lo(HALL.lo) + 1, lo(HALL.lo) + 9, lo(HALL.hi));
  pillar(cellX(HALL.hi) - 1, cellX(HALL.lo + 1) - 1);
  pillar(cellX(HALL.hi) - 1, cellX(HALL.hi) - 1);

  // The side halls: pillars where the cells meet, or a run of partitions, or nothing at all.
  const halls = new Map<number, [number, number, number, number]>();
  for (let c = 0; c < N * N; c++) {
    const h = m.hall[c];
    if (h <= 0) continue;
    const i = c % N, j = Math.floor(c / N);
    const r = halls.get(h) ?? [i, i, j, j];
    halls.set(h, [Math.min(r[0], i), Math.max(r[1], i), Math.min(r[2], j), Math.max(r[3], j)]);
  }
  for (const [i0, i1, j0, j1] of halls.values()) {
    const kind = Math.floor(rand() * 3);
    if (kind === 0) {
      for (let i = i0 + 1; i <= i1; i++) for (let j = j0 + 1; j <= j1; j++) pillar(cellX(i) - 1, cellX(j) - 1);
    } else if (kind === 1) {
      for (let j = j0; j <= j1; j++) partition(lo(i0) + 2, hi(i1) - 2, lo(j) + 3, lo(j) + 3);
    }
  }
  // The way on: a door under a green exit light in the farthest corridor.
  const { cx, z } = m.exit;
  out.push(...darkGate(cx, F, z, Block.PortalParking, Block.Concrete, 4));
  box(cx - 1, cx, z, z, F + 4, F + 4, Block.ExitSign);
  return out;
}

/** Every ceiling light in the maze (the middle of its panel, just under the ceiling), for the renderer. */
export function mazeLamps(seed: number): { x: number; y: number; z: number; exit: boolean }[] {
  const m = mazeOf(seed);
  const out: { x: number; y: number; z: number; exit: boolean }[] = [];
  for (const [c, b] of m.lights) {
    const i = c % N, j = Math.floor(c / N);
    out.push({ x: cellX(i) + 3.5, y: MAZE_CEIL - 0.3, z: cellX(j) + 4, exit: b === Block.ExitSign });
  }
  return out;
}

/** The maze, one column at a time: floor, ceiling and walls. Outside it there is nothing at all. */
export function generateMaze(world: World, c: Chunk) {
  const m = mazeOf(world.seed);
  const n = world.noise;
  const F = MAZE_FLOOR, TOP = MAZE_CEIL;
  for (let lx = 0; lx < CHUNK; lx++)
    for (let lz = 0; lz < CHUNK; lz++) {
      const x = c.cx * CHUNK + lx, z = c.cz * CHUNK + lz;
      const gx = x - X0, gz = z - X0;
      if (gx < 0 || gz < 0 || gx > N * CELL || gz > N * CELL) continue; // the void
      c.set(lx, 0, lz, Block.Bedrock);
      for (let y = 1; y < F; y++) c.set(lx, y, lz, Block.Stone);
      c.set(lx, F, lz, Block.Jangpan);
      c.set(lx, TOP, lz, Block.Banja);
      if (isWall(m, gx, gz)) {
        // Wallpaper from carpet to ceiling, water-stained in patches.
        for (let y = F + 1; y < TOP; y++) c.set(lx, y, lz, n.hash01(Math.floor((x + z) / 3), Math.floor(y / 2), 911) < 0.14 ? Block.WallpaperStain : Block.Wallpaper);
        continue;
      }
      // A light in the middle of the cell's ceiling (a 3×2 panel), if it has one.
      const i = Math.floor(gx / CELL), j = Math.floor(gz / CELL);
      const light = m.lights.get(idx(i, j));
      const lx7 = gx % CELL, lz7 = gz % CELL;
      if (light && lx7 >= 2 && lx7 <= 4 && (lz7 === 3 || lz7 === 4)) c.set(lx, TOP, lz, light);
    }
}

export function mazeStructures(seed: number): Placed[] {
  return mazeOf(seed).structures;
}

/** Where you appear in the maze: in the entrance room facing in, or (back from the car park) at its door. */
export function mazeArrival(seed: number, from?: string): { pos: [number, number, number]; yaw: number } {
  if (from === 'parking') {
    const { cx, z } = mazeOf(seed).exit;
    return { pos: [cx - 0.5, MAZE_FLOOR + 1, z + 2.5], yaw: Math.PI };
  }
  return { pos: [0.5, MAZE_FLOOR + 1, cellX(HALL.lo) + 4.5], yaw: Math.PI };
}

// ─────────────────────────────── 끝없는 주차장 ───────────────────────────────

/** The street, and the 1F floor level with it. */
export const PARK_GROUND = 17;
/** Floor slab of level k: 0 = B4 … 3 = B1, 4 = 1F … 9 = 6F, 10 = the roof. */
const levelY = (k: number) => 1 + 4 * k;
const LEVELS = 11;
const ROOF = LEVELS - 1;
export const PARK_LEVEL_NAMES = ['B4', 'B3', 'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '옥상'];
/** Floor colour codes, so you know where you are (and where you parked). */
const LEVEL_COLOR = [Block.LevelRed, Block.LevelGreen, Block.LevelYellow, Block.LevelBlue, Block.LevelBlue, Block.LevelYellow,
  Block.LevelRed, Block.LevelGreen, Block.LevelBlue, Block.LevelYellow, Block.LevelGreen];
/** Which level someone standing at height y is on. */
export const parkingLevelAt = (y: number) => Math.max(0, Math.min(ROOF, Math.floor((y - 1) / 4)));

const PX0 = -32, PX1 = 31, PZ0 = -24, PZ1 = 13;
/** Ramps run along the north aisle (z -17..-14), up and down at the east end on even floors, the west on odd. */
const RAMP_Z0 = -17, RAMP_Z1 = -14;
const rampRise = (lane: number, x: number) =>
  lane === 0 ? (x >= 22 && x <= 29 ? 1 + Math.floor((29 - x) / 2) : 0) : x >= -29 && x <= -22 ? 1 + Math.floor((x + 29) / 2) : 0;
const inHole = (lane: number, x: number) => (lane === 0 ? x >= 24 && x <= 29 : x >= -29 && x <= -24);
/** How full each floor is (deeper floors are emptier). */
const OCCUPANCY = [0.15, 0.25, 0.4, 0.55, 0.7, 0.6, 0.5, 0.45, 0.35, 0.3, 0.2];
/** Fraction of the hanging tubes still working, per floor. */
const LIT = [0.3, 0.45, 0.6, 0.8, 1, 1, 1, 1, 1, 1, 1];
const CARS = [Block.CarRed, Block.CarWhite, Block.CarBlack, Block.Metal, Block.CarWhite, Block.CarBlack];
/** Bay rows [z0, z1] and the z range a car takes in them (nose to the aisle). */
const ROWS: [number, number][] = [[-23, -19], [-10, -6], [-5, -1], [8, 12]];

export function generateParking(world: World, c: Chunk) {
  const n = world.noise;
  for (let lx = 0; lx < CHUNK; lx++)
    for (let lz = 0; lz < CHUNK; lz++) {
      const x = c.cx * CHUNK + lx, z = c.cz * CHUNK + lz;
      const set = (y: number, b: Block) => c.set(lx, y, lz, b);
      set(0, Block.Bedrock);
      const inside = x >= PX0 && x <= PX1 && z >= PZ0 && z <= PZ1;
      if (!inside) {
        street(x, z, set, n);
        continue;
      }
      const edgeX = x === PX0 || x === PX1, edgeZ = z === PZ0 || z === PZ1, edge = edgeX || edgeZ;
      const inRampZ = z >= RAMP_Z0 && z <= RAMP_Z1;
      const line = mod(x, 4) === 0;
      for (let k = 0; k < LEVELS; k++) {
        const s = levelY(k);
        const color = LEVEL_COLOR[k];
        // The floor slab (also the ceiling of the floor below), with a hole above the ramp from below.
        const holed = k > 0 && inRampZ && inHole((k - 1) % 2, x);
        if (!holed) {
          const inBay = ROWS.some(([z0, z1]) => z >= z0 && z <= z1);
          set(s, edge ? Block.Concrete : inBay && line ? Block.RoadLine : Block.Epoxy);
        }
        if (k === ROOF) {
          // The roof: a parapet and a few lamp posts under the open sky.
          if (edge) set(s + 1, Block.Concrete);
          if ((x === -24 || x === -8 || x === 8 || x === 24) && (z === -12 || z === 1)) {
            for (let y = s + 1; y <= s + 3; y++) set(y, Block.Metal);
            set(s + 4, Block.StreetLight);
          }
          continue;
        }
        if (edge) {
          const under = k < 4;
          const entrance = k === 4 && z === PZ1 && x >= -4 && x <= 3;
          if (entrance) continue;
          const post = (edgeZ && mod(x, 8) === 0) || (edgeX && mod(z, 8) === 0);
          for (let y = s + 1; y <= s + 3; y++) {
            if (!under && !post && y > s + 1) continue; // above ground: just a parapet between posts
            set(y, y === s + 2 ? color : Block.Concrete);
          }
          if (under && edgeX && z === -15 && k < 4) set(s + 3, Block.ExitSign);
          continue;
        }
        // Pillars in a grid, banded in the floor's colour at eye height.
        if (mod(x, 8) === 0 && Math.abs(x) <= 24 && (z === -23 || z === -6 || z === 12)) {
          for (let y = s + 1; y <= s + 3; y++) set(y, y === s + 2 ? color : Block.Concrete);
          continue;
        }
        // The ramp up from this floor, one step every two blocks.
        if (inRampZ) {
          const rise = rampRise(k % 2, x);
          if (rise) set(s + rise, z === RAMP_Z0 || z === RAMP_Z1 ? Block.LevelYellow : Block.Concrete);
        }
        // A kerb round the hole down to the ramp below, so you don't walk straight into it.
        if (k > 0) {
          const lane = (k - 1) % 2;
          const kerb = ((z === RAMP_Z0 - 1 || z === RAMP_Z1 + 1) && inHole(lane, x)) || (inRampZ && x === (lane === 0 ? 30 : -30));
          if (kerb) set(s + 1, Block.Concrete);
        }
        // Hanging tubes over both aisles; on the deep floors many are dead.
        if ((z === -13 || z === 4) && mod(x, 6) === 3 && n.hash01(x, k, 77) < LIT[k]) set(s + 3, Block.CeilingLight);
        // A green exit light over the bottom of each ramp.
        if (z === RAMP_Z1 + 1 && x === (k % 2 === 0 ? 29 : -29)) set(s + 3, Block.ExitSign);
        // Parked cars, nose to the aisle.
        for (let r = 0; r < ROWS.length; r++) {
          const [z0, z1] = ROWS[r];
          if (z < z0 || z > z1 || line) continue;
          const bay = Math.floor((x - PX0) / 4);
          if (n.hash01(bay, r * 31 + k, 515) >= OCCUPANCY[k]) continue;
          const body = CARS[Math.floor(n.hash01(bay, r * 31 + k, 516) * CARS.length)];
          const bx = mod(x - PX0, 4); // 1..3 across the bay
          const along = z - z0; // 0..4 along the car
          const wheel = (bx === 1 || bx === 3) && (along === 1 || along === 3);
          set(s + 1, wheel ? Block.Tire : body);
          if (along >= 1 && along <= 3) set(s + 2, along === 2 && bx === 2 ? body : Block.CarGlass);
        }
      }
    }
}

/** Outside the car park: an empty street at night, streetlights, and dark towers far off. */
function street(x: number, z: number, set: (y: number, b: Block) => void, n: World['noise']) {
  const G = PARK_GROUND;
  for (let y = 1; y < G; y++) set(y, Block.Stone);
  const dx = x < PX0 ? PX0 - x : x > PX1 ? x - PX1 : 0, dz = z < PZ0 ? PZ0 - z : z > PZ1 ? z - PZ1 : 0;
  const d = Math.max(dx, dz);
  set(G, d <= 3 ? Block.Sidewalk : Block.Asphalt);
  if (d === 3 && mod(x + z, 10) === 0) {
    for (let y = G + 1; y <= G + 4; y++) set(y, Block.Metal);
    set(G + 5, Block.StreetLight);
  }
  // A ring of tall, mostly dark buildings beyond the road.
  const CELLW = 36;
  const cx = Math.floor(x / CELLW), cz = Math.floor(z / CELLW);
  if (Math.hypot(cx * CELLW + 18, cz * CELLW + 18) < 80 || n.hash01(cx, cz, 520) > 0.7) return;
  const ix = mod(x, CELLW) - 6, iz = mod(z, CELLW) - 6;
  const W = 22;
  if (ix < 0 || iz < 0 || ix >= W || iz >= W) return;
  const h = Math.min(HEIGHT - 1 - G, 16 + Math.floor(n.hash01(cx, cz, 521) * 26));
  const wall = ix === 0 || iz === 0 || ix === W - 1 || iz === W - 1;
  if (!wall) { set(G + h, Block.Concrete); return; }
  for (let r = 1; r <= h; r++) {
    const win = r % 3 === 2 && (ix + iz) % 2 === 1;
    set(G + r, win ? (n.hash01(x * 3 + r, z, 522) < 0.08 ? Block.WindowLit : Block.Window) : Block.Concrete);
  }
}

/** The way home and the way back into the dark, side by side on 1F. Doors are short: floors are 3 high. */
export function parkingStructures(): Placed[] {
  return [
    ...darkGate(1, PARK_GROUND, 6, Block.PortalHome, Block.Concrete, 4),
    ...darkGate(-6, PARK_GROUND, 6, Block.PortalDark, Block.Jagae, 4),
  ];
}

export function parkingArrival(): { pos: [number, number, number]; yaw: number } {
  return { pos: [0.5, PARK_GROUND + 1, 3.5], yaw: 0 };
}
