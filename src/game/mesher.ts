import { tileOf, tileUV } from '../render/textures';
import { Block, BLOCKS } from './blocks';
import { CHUNK, HEIGHT, World } from './world';

export type MeshArrays = {
  positions: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
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

class Buffers {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  arrays(): MeshArrays {
    return {
      positions: new Float32Array(this.pos),
      colors: new Float32Array(this.col),
      uvs: new Float32Array(this.uv),
      indices: new Uint32Array(this.idx),
    };
  }
}

/** Texture coordinates of a corner within its face, so tiles stand upright on the sides. */
function faceUV(f: number, vx: number, vy: number, vz: number): [number, number] {
  if (f === 0) return [1 - vz, vy];
  if (f === 1) return [vz, vy];
  if (f === 4) return [vx, vy];
  if (f === 5) return [1 - vx, vy];
  return [vx, vz];
}

export type ChunkMeshes = { solid: MeshArrays; water: MeshArrays; glow: MeshArrays; portal: MeshArrays; glass: MeshArrays };

/**
 * One textured quad per visible face with per-vertex ambient occlusion and directional shading.
 * Translucent things go to their own passes: water (world-space UVs, animated), portals and glass.
 * Glowing blocks go to a pass that ignores nightfall.
 */
export function buildChunkMesh(world: World, cx: number, cz: number): ChunkMeshes {
  const chunk = world.chunk(cx, cz);
  const solid = new Buffers(), water = new Buffers(), glow = new Buffers(), portal = new Buffers(), glass = new Buffers();
  const ox = cx * CHUNK, oz = cz * CHUNK;

  // Neighbour lookups go through the world so chunk borders are seamless.
  const at = (x: number, y: number, z: number): Block => {
    if (y < 0 || y >= HEIGHT) return Block.Air;
    if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK) return chunk.get(x, y, z);
    return world.get(ox + x, y, oz + z);
  };
  const occludes = (x: number, y: number, z: number) => BLOCKS[at(x, y, z)].opaque;

  for (let y = 0; y < HEIGHT; y++) {
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const b = chunk.get(x, y, z);
        if (b === Block.Air) continue;
        const info = BLOCKS[b];
        const isWater = b === Block.Water;
        const isPortal = !!info.portal;
        const isGlass = !!info.glass;
        const flat = isWater || isPortal || !!info.glow;
        // Tiny per-block tint variation keeps big areas from looking flat.
        const jitter = 0.97 + ((((ox + x) * 73856093) ^ (y * 19349663) ^ ((oz + z) * 83492791)) & 7) / 140;
        const tint = isPortal ? info.top : null;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const [nx, ny, nz] = face.n;
          const nb = at(x + nx, y + ny, z + nz);
          if (isWater) {
            if (nb !== Block.Air) continue;
          } else if (isPortal || isGlass) {
            if (nb === b || BLOCKS[nb].opaque) continue;
          } else {
            const nInfo = BLOCKS[nb];
            if (nInfo.opaque || nb === b) continue;
          }

          const out = isWater ? water : isPortal ? portal : isGlass ? glass : info.glow ? glow : solid;
          const base = out.pos.length / 3;
          const surface = isWater && f !== 3 && at(x, y + 1, z) !== Block.Water;
          const [u0, v0, u1, v1] = tileUV(tileOf(b, f));
          const aos: number[] = [];
          for (const corner of face.c) {
            const vx = corner[0], vy = corner[1], vz = corner[2];
            const top = surface && vy === 1 ? 0.88 : vy;
            out.pos.push(x + vx, y + top, z + vz);
            if (isWater) {
              // World-space UVs on a repeating ripple texture (scrolled by the renderer).
              const wx = ox + x + vx, wz = oz + z + vz;
              out.uv.push(f === 2 || f === 3 ? wx / 4 : (f < 2 ? wz : wx) / 4, f === 2 || f === 3 ? wz / 4 : (y + top) / 4);
            } else {
              const [fu, fv] = faceUV(f, vx, vy, vz);
              out.uv.push(u0 + (u1 - u0) * fu, v0 + (v1 - v0) * fv);
            }
            let ao = 3;
            if (!flat) {
              // Classic voxel AO: two edge neighbours + the corner neighbour.
              const sx = vx === 1 ? 1 : -1, sy = vy === 1 ? 1 : -1, sz = vz === 1 ? 1 : -1;
              const px = x + nx, py = y + ny, pz = z + nz;
              let s1: boolean, s2: boolean, cc: boolean;
              if (nx !== 0) { s1 = occludes(px, py + sy, pz); s2 = occludes(px, py, pz + sz); cc = occludes(px, py + sy, pz + sz); }
              else if (ny !== 0) { s1 = occludes(px + sx, py, pz); s2 = occludes(px, py, pz + sz); cc = occludes(px + sx, py, pz + sz); }
              else { s1 = occludes(px + sx, py, pz); s2 = occludes(px, py + sy, pz); cc = occludes(px + sx, py + sy, pz); }
              ao = s1 && s2 ? 0 : 3 - (Number(s1) + Number(s2) + Number(cc));
            }
            aos.push(ao);
            const k = info.glow ? 0.94 + 0.06 * face.shade : face.shade * AO[ao] * jitter;
            if (tint) out.col.push(tint[0] * k, tint[1] * k, tint[2] * k);
            else out.col.push(k, k, k);
          }
          // Flip the quad's diagonal when it makes AO interpolate smoothly.
          if (aos[0] + aos[2] > aos[1] + aos[3]) {
            out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          } else {
            out.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          }
        }
      }
    }
  }
  return { solid: solid.arrays(), water: water.arrays(), glow: glow.arrays(), portal: portal.arrays(), glass: glass.arrays() };
}
