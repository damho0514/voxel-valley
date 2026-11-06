import { Block, BLOCKS, isReplaceable, Season } from './blocks';
import { Noise } from './noise';

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
  readonly edits = new Map<string, Block>();

  /** The block that covers the ground this season. */
  readonly ground: Block;

  constructor(readonly seed: number, readonly season: Season = 'summer') {
    this.noise = new Noise(seed);
    this.ground = season === 'winter' ? Block.Snow : season === 'autumn' ? Block.DryGrass : Block.Moss;
  }

  surfaceHeight(x: number, z: number): number {
    const hills = this.noise.fractal(x / 40, z / 40, 4);
    const m = this.noise.fractal(x / 140, z / 140, 2, 7);
    const h = Math.floor(hills * 22 + m * m * 20);
    return Math.max(2, Math.min(HEIGHT - 10, h));
  }

  chunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      c = this.generate(cx, cz);
      this.chunks.set(key, c);
    }
    return c;
  }

  hasChunk(cx: number, cz: number) {
    return this.chunks.has(chunkKey(cx, cz));
  }

  unload(cx: number, cz: number) {
    this.chunks.delete(chunkKey(cx, cz));
  }

  get(x: number, y: number, z: number): Block {
    if (y < 0 || y >= HEIGHT) return Block.Air;
    return this.chunk(toChunk(x), toChunk(z)).get(mod(x, CHUNK), y, mod(z, CHUNK));
  }

  set(x: number, y: number, z: number, b: Block) {
    if (y < 0 || y >= HEIGHT) return;
    this.edits.set(`${x},${y},${z}`, b);
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
          let y = HEIGHT - 2;
          while (y > 0 && !this.isSolid(px, y, pz)) y--;
          const ground = this.get(px, y, pz);
          if ((ground === this.ground || ground === Block.Sand) &&
              isReplaceable(this.get(px, y + 1, pz)) && this.get(px, y + 1, pz) === Block.Air &&
              this.get(px, y + 2, pz) === Block.Air) {
            return [px + 0.5, y + 1, pz + 0.5];
          }
        }
      }
    }
    return [x + 0.5, HEIGHT - 4, z + 0.5];
  }

  private generate(cx: number, cz: number): Chunk {
    const c = new Chunk(cx, cz);
    for (let lx = 0; lx < CHUNK; lx++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        const wx = cx * CHUNK + lx, wz = cz * CHUNK + lz;
        const top = this.surfaceHeight(wx, wz);
        const shore = top <= SEA_LEVEL;
        for (let y = 0; y <= top; y++) {
          let b: Block;
          if (y === 0) b = Block.Bedrock;
          else if (y < top - 3) b = Block.Stone;
          else if (shore) b = Block.Sand;
          else b = y === top ? this.ground : Block.Soil;
          c.set(lx, y, lz, b);
        }
        for (let y = top + 1; y <= SEA_LEVEL; y++) c.set(lx, y, lz, Block.Water);
        // Winter freezes the surface of lakes and the sea.
        if (this.season === 'winter' && top < SEA_LEVEL) c.set(lx, SEA_LEVEL, lz, Block.Ice);
      }
    }
    this.plantTrees(c);
    // Re-apply player edits for this chunk.
    for (const [key, b] of this.edits) {
      const [x, y, z] = key.split(',').map(Number);
      if (toChunk(x) === cx && toChunk(z) === cz) c.set(mod(x, CHUNK), y, mod(z, CHUNK), b);
    }
    return c;
  }

  private leafFor(r: number): Block {
    if (this.season === 'spring') return r < 0.75 ? Block.Blossom : Block.Leaf;
    if (this.season === 'autumn') return r < 0.75 ? Block.Maple : Block.Leaf;
    return Block.Leaf;
  }

  /** Round, puffy trees that always fit inside their chunk. */
  private plantTrees(c: Chunk) {
    for (let lx = 3; lx <= CHUNK - 4; lx++) {
      for (let lz = 3; lz <= CHUNK - 4; lz++) {
        const wx = c.cx * CHUNK + lx, wz = c.cz * CHUNK + lz;
        if (this.noise.hash01(wx, wz, 101) > (this.season === 'summer' ? 0.024 : 0.015)) continue;
        const g = this.surfaceHeight(wx, wz);
        if (c.get(lx, g, lz) !== this.ground) continue;
        const leaf = this.leafFor(this.noise.hash01(wx, wz, 303));
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
        if (this.season === 'winter') {
          // A cap of snow on each canopy column.
          for (let dx = -2; dx <= 2; dx++)
            for (let dz = -2; dz <= 2; dz++)
              for (let y = cy + 2; y >= cy - 2; y--)
                if (c.get(lx + dx, y, lz + dz) === leaf) {
                  c.set(lx + dx, y, lz + dz, Block.Snow);
                  break;
                }
        }
      }
    }
  }
}
