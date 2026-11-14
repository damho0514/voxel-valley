import { Block, BLOCKS, Dimension, isReplaceable } from './blocks';
import { CITY_GROUND, futureStructures, generateFuture, generateSpace, generateStore, Placed, spaceStructures, STORE_GROUND, storeStructures, valleyStructures } from './dimensions';
import { generateMaze, generateParking, MAZE_CEIL, mazeStructures, PARK_GROUND, parkingStructures } from './darkworlds';
import { Noise } from './noise';
import { depositAt } from './treasure';

export const CHUNK = 16;
export const HEIGHT = 48;
export const SEA_LEVEL = 14;

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;
const floorDiv = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => ((a % b) + b) % b;
export const toChunk = (x: number) => floorDiv(x, CHUNK);

export class Chunk {
  readonly blocks = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  constructor(readonly cx: number, readonly cz: number) {}

  static index(x: number, y: number, z: number) {
    return x + z * CHUNK + y * CHUNK * CHUNK;
  }

  get(x: number, y: number, z: number): Block {
    if (y < 0 || y >= HEIGHT) return Block.Air;
    return this.blocks[Chunk.index(x, y, z)] as Block;
  }

  set(x: number, y: number, z: number, b: Block) {
    if (x < 0 || x >= CHUNK || z < 0 || z >= CHUNK || y < 0 || y >= HEIGHT) return;
    this.blocks[Chunk.index(x, y, z)] = b;
  }
}

/** Terrain = seeded generator output + player edits on top. */
export class World {
  readonly noise: Noise;
  readonly chunks = new Map<string, Chunk>();
  /** Player edits, "x,y,z" → block (what gets saved and synced). Write through `setEdit`. */
  readonly edits = new Map<string, Block>();
  /** The same edits bucketed by chunk, so generating a chunk doesn't scan every edit ever made. */
  private readonly editsByChunk = new Map<string, Map<string, [number, number, number, Block]>>();
  // Most lookups (physics, raycasts, meshing) hit the same chunk as the one before.
  private lastKeyX = NaN;
  private lastKeyZ = NaN;
  private lastChunk: Chunk | null = null;

  /** The block that covers the ground. */
  readonly ground = Block.Moss;

  private structures: Map<string, Placed[]> | null = null;

  constructor(readonly seed: number, readonly dim: Dimension = 'valley') {
    this.noise = new Noise(seed);
  }

  surfaceHeight(x: number, z: number): number {
    const hills = this.noise.fractal(x / 40, z / 40, 4);
    const m = this.noise.fractal(x / 140, z / 140, 2, 7);
    const h = Math.floor(hills * 22 + m * m * 20);
    return Math.max(2, Math.min(HEIGHT - 10, h));
  }

  chunk(cx: number, cz: number): Chunk {
    if (cx === this.lastKeyX && cz === this.lastKeyZ && this.lastChunk) return this.lastChunk;
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      c = this.generate(cx, cz);
      this.chunks.set(key, c);
    }
    this.lastKeyX = cx;
    this.lastKeyZ = cz;
    this.lastChunk = c;
    return c;
  }

  hasChunk(cx: number, cz: number) {
    return this.chunks.has(chunkKey(cx, cz));
  }

  unload(cx: number, cz: number) {
    this.chunks.delete(chunkKey(cx, cz));
    if (cx === this.lastKeyX && cz === this.lastKeyZ) this.lastChunk = null;
  }

  /** Records an edit without touching loaded chunk data (it's applied when the chunk generates). */
  setEdit(key: string, b: Block) {
    this.edits.set(key, b);
    const [x, y, z] = key.split(',').map(Number);
    const ck = chunkKey(toChunk(x), toChunk(z));
    let bucket = this.editsByChunk.get(ck);
    if (!bucket) this.editsByChunk.set(ck, (bucket = new Map()));
    bucket.set(key, [x, y, z, b]);
  }

  get(x: number, y: number, z: number): Block {
    if (y < 0 || y >= HEIGHT) return Block.Air;
    return this.chunk(toChunk(x), toChunk(z)).get(mod(x, CHUNK), y, mod(z, CHUNK));
  }

  set(x: number, y: number, z: number, b: Block) {
    if (y < 0 || y >= HEIGHT) return;
    this.setEdit(`${x},${y},${z}`, b);
    this.chunk(toChunk(x), toChunk(z)).set(mod(x, CHUNK), y, mod(z, CHUNK), b);
  }

  isSolid(x: number, y: number, z: number) {
    return BLOCKS[this.get(x, y, z)].solid;
  }

  /** Nearest open grass/sand column with headroom, searching outward. */
  findSpawn(x: number, z: number): [number, number, number] {
    for (let r = 0; r < 40; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const px = x + dx, pz = z + dz;
          // In the city, stand on the street rather than a rooftop.
          let y = this.dim === 'future' ? CITY_GROUND : this.dim === 'store' ? STORE_GROUND : this.dim === 'maze' ? MAZE_CEIL - 1 : this.dim === 'parking' ? PARK_GROUND + 2 : HEIGHT - 2;
          while (y > 0 && !this.isSolid(px, y, pz)) y--;
          const ground = this.get(px, y, pz);
          const okGround = this.dim === 'valley' ? ground === this.ground || ground === Block.Sand : BLOCKS[ground].solid;
          if (okGround &&
              isReplaceable(this.get(px, y + 1, pz)) && this.get(px, y + 1, pz) === Block.Air &&
              this.get(px, y + 2, pz) === Block.Air) {
            return [px + 0.5, y + 1, pz + 0.5];
          }
        }
      }
    }
    return [x + 0.5, HEIGHT - 4, z + 0.5];
  }

  /** Hand-placed structures (gates, the station), bucketed by chunk. */
  private structuresIn(cx: number, cz: number): Placed[] {
    if (!this.structures) {
      this.structures = new Map();
      const all = this.dim === 'future' ? futureStructures() : this.dim === 'space' ? spaceStructures() : this.dim === 'store' ? storeStructures() : this.dim === 'maze' ? mazeStructures(this.seed) : this.dim === 'parking' ? parkingStructures() : valleyStructures(this);
      for (const p of all) {
        const key = chunkKey(toChunk(p[0]), toChunk(p[2]));
        const list = this.structures.get(key) ?? [];
        list.push(p);
        this.structures.set(key, list);
      }
    }
    return this.structures.get(chunkKey(cx, cz)) ?? [];
  }

  private generate(cx: number, cz: number): Chunk {
    const c = new Chunk(cx, cz);
    if (this.dim === 'future') generateFuture(this, c);
    else if (this.dim === 'space') generateSpace(this, c);
    else if (this.dim === 'store') generateStore(this, c);
    else if (this.dim === 'maze') generateMaze(this, c);
    else if (this.dim === 'parking') generateParking(this, c);
    else this.generateValley(c);
    for (const [x, y, z, b] of this.structuresIn(cx, cz)) c.set(mod(x, CHUNK), y, mod(z, CHUNK), b);
    // Re-apply player edits for this chunk.
    for (const [x, y, z, b] of this.editsByChunk.get(chunkKey(cx, cz))?.values() ?? []) c.set(mod(x, CHUNK), y, mod(z, CHUNK), b);
    return c;
  }

  private generateValley(c: Chunk) {
    const { cx, cz } = c;
    for (let lx = 0; lx < CHUNK; lx++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        const wx = cx * CHUNK + lx, wz = cz * CHUNK + lz;
        const top = this.surfaceHeight(wx, wz);
        const shore = top <= SEA_LEVEL;
        for (let y = 0; y <= top; y++) {
          let b: Block;
          if (y === 0) b = Block.Bedrock;
          else if (y < top - 3) b = depositAt(this.noise, wx, y, wz, top - y) ?? Block.Stone;
          else if (shore) b = Block.Sand;
          else b = y === top ? this.ground : Block.Soil;
          c.set(lx, y, lz, b);
        }
        for (let y = top + 1; y <= SEA_LEVEL; y++) c.set(lx, y, lz, Block.Water);
      }
    }
    this.plantTrees(c);
  }

  /** Round, puffy trees that always fit inside their chunk. */
  private plantTrees(c: Chunk) {
    for (let lx = 3; lx <= CHUNK - 4; lx++) {
      for (let lz = 3; lz <= CHUNK - 4; lz++) {
        const wx = c.cx * CHUNK + lx, wz = c.cz * CHUNK + lz;
        if (this.noise.hash01(wx, wz, 101) > 0.024) continue;
        const g = this.surfaceHeight(wx, wz);
        if (c.get(lx, g, lz) !== this.ground) continue;
        const leaf = Block.Leaf;
        const trunk = 3 + Math.floor(this.noise.hash01(wx, wz, 202) * 2);
        if (g + trunk + 4 >= HEIGHT) continue;
        for (let y = 1; y <= trunk; y++) c.set(lx, g + y, lz, Block.Wood);
        const cy = g + trunk + 1;
        for (let dx = -2; dx <= 2; dx++)
          for (let dy = -2; dy <= 2; dy++)
            for (let dz = -2; dz <= 2; dz++) {
              if (dx * dx + dy * dy * 1.6 + dz * dz > 5.2) continue; // ball-ish canopy
              if (c.get(lx + dx, cy + dy, lz + dz) === Block.Air) c.set(lx + dx, cy + dy, lz + dz, leaf);
            }
      }
    }
  }
}
