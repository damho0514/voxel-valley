import { tileOf, tileUV } from '../render/textures';
import { Block, BLOCK_COUNT, BLOCKS } from './blocks';
import { CHUNK, HEIGHT, World } from './world';

export type MeshArrays = {
  positions: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
};

// Faces: +X, -X, +Y, -Y, +Z, -Z. Corners listed counter-clockwise seen from
// outside (three.js front faces).
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.86 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.86 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.62 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.78 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.78 },
] as const;

const AO = [0.5, 0.68, 0.84, 1.0];

/*
 * Meshing runs on the JS thread (Hermes has no JIT), so it is written to be cheap there:
 * the chunk plus a one-block border is copied into a padded array once, neighbour and AO
 * lookups are plain index offsets into it, output goes into reused typed arrays instead of
 * growing JS arrays, and per-face/per-corner constants are precomputed.
 */
const PX = CHUNK + 2, PZ = CHUNK + 2, PY = HEIGHT + 2;
const SX = 1, SZ = PX, SY = PX * PZ;
const pad = new Uint8Array(PX * PZ * PY); // y = -1 and y = HEIGHT stay Air
const pidx = (x: number, y: number, z: number) => (x + 1) * SX + (z + 1) * SZ + (y + 1) * SY;

// Per-face neighbour offset, per-corner AO neighbour offsets (side1, side2, corner) and face UVs.
const N_OFF = new Int32Array(6);
const AO_OFF = new Int32Array(6 * 4 * 3);
const FACE_UV = new Float64Array(6 * 4 * 2);
FACES.forEach((face, f) => {
  const [nx, ny, nz] = face.n;
  N_OFF[f] = nx * SX + ny * SY + nz * SZ;
  face.c.forEach(([vx, vy, vz], k) => {
    const sx = vx === 1 ? 1 : -1, sy = vy === 1 ? 1 : -1, sz = vz === 1 ? 1 : -1;
    const n = N_OFF[f], o = (f * 4 + k) * 3;
    if (nx !== 0) { AO_OFF[o] = n + sy * SY; AO_OFF[o + 1] = n + sz * SZ; AO_OFF[o + 2] = n + sy * SY + sz * SZ; }
    else if (ny !== 0) { AO_OFF[o] = n + sx * SX; AO_OFF[o + 1] = n + sz * SZ; AO_OFF[o + 2] = n + sx * SX + sz * SZ; }
    else { AO_OFF[o] = n + sx * SX; AO_OFF[o + 1] = n + sy * SY; AO_OFF[o + 2] = n + sx * SX + sy * SY; }
    const [fu, fv] = f === 0 ? [1 - vz, vy] : f === 1 ? [vz, vy] : f === 4 ? [vx, vy] : f === 5 ? [1 - vx, vy] : [vx, vz];
    FACE_UV[(f * 4 + k) * 2] = fu;
    FACE_UV[(f * 4 + k) * 2 + 1] = fv;
  });
});

// Block properties as flat lookups (filled lazily: textures must be importable first).
const OPAQUE = new Uint8Array(256);
const TILE_UV = new Float64Array(256 * 6 * 4);
let tablesReady = false;
function initTables() {
  for (let b = 0; b < BLOCK_COUNT; b++) {
    const info = BLOCKS[b as Block];
    if (!info) continue;
    OPAQUE[b] = info.opaque ? 1 : 0;
    for (let f = 0; f < 6; f++) TILE_UV.set(tileUV(tileOf(b as Block, f)), (b * 6 + f) * 4);
  }
  tablesReady = true;
}

/** A reusable, growable vertex/index buffer; `arrays()` copies out exactly what was written. */
class Buffers {
  pos = new Float32Array(3 * 4096);
  col = new Float32Array(3 * 4096);
  uv = new Float32Array(2 * 4096);
  idx = new Uint32Array(6 * 1024);
  nv = 0;
  ni = 0;
  reset() { this.nv = 0; this.ni = 0; }
  /** Room for one more quad. */
  reserve() {
    if ((this.nv + 4) * 3 > this.pos.length) {
      const grow = <T extends Float32Array>(a: T, n: number) => { const b = new Float32Array(n); b.set(a); return b as T; };
      const cap = this.pos.length * 2;
      this.pos = grow(this.pos, cap);
      this.col = grow(this.col, cap);
      this.uv = grow(this.uv, (cap / 3) * 2);
    }
    if (this.ni + 6 > this.idx.length) {
      const b = new Uint32Array(this.idx.length * 2);
      b.set(this.idx);
      this.idx = b;
    }
  }
  arrays(): MeshArrays {
    const nv = this.nv, ni = this.ni;
    // 16-bit indices whenever they fit: half the memory and the faster path on mobile GPUs.
    const indices = nv <= 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
    indices.set(this.idx.subarray(0, ni));
    return {
      positions: this.pos.slice(0, nv * 3),
      colors: this.col.slice(0, nv * 3),
      uvs: this.uv.slice(0, nv * 2),
      indices,
    };
  }
}
const SOLID = new Buffers(), WATER = new Buffers(), GLOW = new Buffers(), PORTAL = new Buffers(), GLASS = new Buffers();

/** Copies chunk (cx,cz) and a one-block border from its neighbours into `pad`; returns the top used y. */
function fillPad(world: World, cx: number, cz: number): number {
  const C2 = CHUNK * CHUNK;
  const centre = world.chunk(cx, cz).blocks;
  // Interior: rows of 16 at a time.
  let top = -1;
  for (let y = 0; y < HEIGHT; y++) {
    const src = y * C2;
    let any = 0;
    for (let z = 0; z < CHUNK; z++) {
      const row = centre.subarray(src + z * CHUNK, src + z * CHUNK + CHUNK);
      pad.set(row, pidx(0, y, z));
    }
    for (let i = src, end = src + C2; i < end; i++) if (centre[i] !== 0) { any = 1; break; }
    if (any) top = y;
  }
  // Border columns (x or z = -1 / CHUNK), taken from the neighbouring chunks.
  for (let z = -1; z <= CHUNK; z++) {
    for (let x = -1; x <= CHUNK; x++) {
      if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK) continue;
      const dx = x < 0 ? -1 : x >= CHUNK ? 1 : 0, dz = z < 0 ? -1 : z >= CHUNK ? 1 : 0;
      const src = world.chunk(cx + dx, cz + dz).blocks;
      const lx = x - dx * CHUNK, lz = z - dz * CHUNK;
      let s = lx + lz * CHUNK, d = pidx(x, 0, z);
      for (let y = 0; y < HEIGHT; y++, s += C2, d += SY) pad[d] = src[s];
    }
  }
  return top;
}

export type ChunkMeshes = { solid: MeshArrays; water: MeshArrays; glow: MeshArrays; portal: MeshArrays; glass: MeshArrays };

/**
 * One textured quad per visible face with per-vertex ambient occlusion and directional shading.
 * Translucent things go to their own passes: water (world-space UVs, animated), portals and glass.
 * Glowing blocks go to a pass that ignores nightfall.
 */
export function buildChunkMesh(world: World, cx: number, cz: number): ChunkMeshes {
  if (!tablesReady) initTables();
  SOLID.reset(); WATER.reset(); GLOW.reset(); PORTAL.reset(); GLASS.reset();
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const top = fillPad(world, cx, cz);
  const aos = [0, 0, 0, 0];

  for (let y = 0; y <= top; y++) {
    for (let z = 0; z < CHUNK; z++) {
      let p = pidx(0, y, z);
      for (let x = 0; x < CHUNK; x++, p++) {
        const b = pad[p];
        if (b === Block.Air) continue;
        const info = BLOCKS[b as Block];
        const isWater = b === Block.Water;
        const isPortal = !!info.portal;
        const isGlass = !!info.glass;
        const isGlow = !!info.glow;
        const flat = isWater || isPortal || isGlow;
        // Tiny per-block tint variation keeps big areas from looking flat.
        const jitter = 0.97 + ((((ox + x) * 73856093) ^ (y * 19349663) ^ ((oz + z) * 83492791)) & 7) / 140;
        const tint = isPortal ? info.top : null;

        for (let f = 0; f < 6; f++) {
          const nb = pad[p + N_OFF[f]];
          if (isWater) {
            if (nb !== Block.Air) continue;
          } else if (OPAQUE[nb] || nb === b) continue;

          const out = isWater ? WATER : isPortal ? PORTAL : isGlass ? GLASS : isGlow ? GLOW : SOLID;
          out.reserve();
          const base = out.nv;
          const surface = isWater && f !== 3 && pad[p + SY] !== Block.Water;
          const face = FACES[f];
          const shade = face.shade;
          const t = (b * 6 + f) * 4;
          const u0 = TILE_UV[t], v0 = TILE_UV[t + 1], u1 = TILE_UV[t + 2], v1 = TILE_UV[t + 3];
          const pos = out.pos, col = out.col, uv = out.uv;
          for (let k = 0; k < 4; k++) {
            const corner = face.c[k];
            const vx = corner[0], vy = corner[1], vz = corner[2];
            const vt = surface && vy === 1 ? 0.88 : vy;
            const vi = (base + k) * 3, ui = (base + k) * 2;
            pos[vi] = x + vx; pos[vi + 1] = y + vt; pos[vi + 2] = z + vz;
            if (isWater) {
              // World-space UVs on a repeating ripple texture (scrolled by the renderer).
              const wx = ox + x + vx, wz = oz + z + vz;
              uv[ui] = f === 2 || f === 3 ? wx / 4 : (f < 2 ? wz : wx) / 4;
              uv[ui + 1] = f === 2 || f === 3 ? wz / 4 : (y + vt) / 4;
            } else {
              const fk = (f * 4 + k) * 2;
              uv[ui] = u0 + (u1 - u0) * FACE_UV[fk];
              uv[ui + 1] = v0 + (v1 - v0) * FACE_UV[fk + 1];
            }
            let ao = 3;
            if (!flat) {
              // Classic voxel AO: two edge neighbours + the corner neighbour.
              const o = (f * 4 + k) * 3;
              const s1 = OPAQUE[pad[p + AO_OFF[o]]], s2 = OPAQUE[pad[p + AO_OFF[o + 1]]], cc = OPAQUE[pad[p + AO_OFF[o + 2]]];
              ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            }
            aos[k] = ao;
            const kk = isGlow ? 0.94 + 0.06 * shade : shade * AO[ao] * jitter;
            if (tint) { col[vi] = tint[0] * kk; col[vi + 1] = tint[1] * kk; col[vi + 2] = tint[2] * kk; }
            else { col[vi] = kk; col[vi + 1] = kk; col[vi + 2] = kk; }
          }
          out.nv += 4;
          // Flip the quad's diagonal when it makes AO interpolate smoothly.
          const idx = out.idx, i = out.ni;
          if (aos[0] + aos[2] > aos[1] + aos[3]) {
            idx[i] = base; idx[i + 1] = base + 1; idx[i + 2] = base + 2; idx[i + 3] = base; idx[i + 4] = base + 2; idx[i + 5] = base + 3;
          } else {
            idx[i] = base + 1; idx[i + 1] = base + 2; idx[i + 2] = base + 3; idx[i + 3] = base + 1; idx[i + 4] = base + 3; idx[i + 5] = base;
          }
          out.ni += 6;
        }
      }
    }
  }
  return { solid: SOLID.arrays(), water: WATER.arrays(), glow: GLOW.arrays(), portal: PORTAL.arrays(), glass: GLASS.arrays() };
}
