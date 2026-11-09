import * as THREE from 'three';
import { Block } from '../game/blocks';

/**
 * Procedurally painted block textures (no image files, nothing copied): every tile is drawn
 * here from noise and simple shapes, in Voxel Valley's soft pastel palette.
 */
export const TILE = 32;
const COLS = 8;
export const ATLAS = TILE * COLS; // 256 × 256, up to 64 tiles

type RGB = [number, number, number];
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

function hash(x: number, y: number, s: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Tileable value noise on a period-32 grid. */
function vnoise(x: number, y: number, cell: number, s: number) {
  const p = TILE / cell;
  const gx = x / cell, gy = y / cell;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => hash(((a % p) + p) % p, ((b % p) + p) % p, s);
  const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, y: number, s: number) => vnoise(x, y, 16, s) * 0.5 + vnoise(x, y, 8, s + 1) * 0.3 + vnoise(x, y, 4, s + 2) * 0.2;

type Painter = (x: number, y: number) => [number, number, number, number?];

const grain = (base: number, amount: number, s: number): Painter => (x, y) => {
  const n = fbm(x, y, s) - 0.5 + (hash(x, y, s + 9) - 0.5) * 0.35;
  return shade(hex(base), 1 + n * amount) as RGB;
};

const P: Record<string, Painter> = {
  moss_top: (x, y) => {
    const c = grain(0x9ed98a, 0.22, 1)(x, y) as RGB;
    const blade = hash(x, y, 2);
    if (blade > 0.93) return shade(c, 1.12) as RGB;
    if (blade < 0.05) return shade(c, 0.86) as RGB;
    if (hash(x >> 2, y >> 2, 3) > 0.985) return hex(0xfff3b0); // a tiny flower now and then
    return c;
  },
  soil: (x, y) => {
    const c = grain(0xc9a27e, 0.25, 4)(x, y) as RGB;
    return hash(x >> 1, y >> 1, 5) > 0.94 ? (shade(c, 0.78) as RGB) : c;
  },
  stone: (x, y) => {
    const c = grain(0xb7bfcc, 0.22, 6)(x, y) as RGB;
    const crack = Math.abs(vnoise(x, y, 8, 7) - 0.5) < 0.025;
    return crack ? (shade(c, 0.8) as RGB) : c;
  },
  sand: (x, y) => {
    const ripple = Math.sin((y + vnoise(x, y, 16, 8) * 6) * 0.8) * 0.03;
    return shade(grain(0xf3e3b5, 0.12, 9)(x, y) as RGB, 1 + ripple) as RGB;
  },
  wood_side: (x, y) => {
    const stripe = vnoise(x * 4, y * 0.5, 16, 10);
    return shade(hex(0xb98a64), 0.85 + stripe * 0.3 + (hash(x, y, 11) - 0.5) * 0.06) as RGB;
  },
  wood_top: (x, y) => {
    const r = Math.hypot(x - 15.5, y - 15.5) + vnoise(x, y, 8, 12) * 2.5;
    const ring = 0.92 + 0.1 * Math.sin(r * 1.3);
    return shade(r > 14 ? hex(0xb98a64) : hex(0xe8c39a), ring) as RGB;
  },
  leaf: (x, y) => leafy(0x7fcf9b, x, y, 13),
  blossom: (x, y) => {
    if (hash(x, y, 15) > 0.95) return hex(0xfff6fa);
    return leafy(0xf6bdd3, x, y, 14);
  },
  maple: (x, y) => mix(leafy(0xef9a5b, x, y, 16), hex(0xe5664f), vnoise(x, y, 8, 17) * 0.45),
  plank: (x, y) => {
    const board = Math.floor(y / 8);
    const seam = y % 8 === 0 || (x + board * 13) % 32 === 0;
    const c = shade(hex(0xf0c98f), 0.94 + vnoise(x * 3, y + board * 40, 16, 18) * 0.12 + board * 0.015);
    return seam ? (shade(c, 0.78) as RGB) : (c as RGB);
  },
  clay: (x, y) => {
    const row = Math.floor(y / 8);
    const off = row % 2 ? 8 : 0;
    const mortar = y % 8 === 0 || (x + off) % 16 === 0;
    if (mortar) return hex(0xf6d2c6);
    return shade(hex(0xf29b8f), 0.9 + hash(Math.floor((x + off) / 16), row, 19) * 0.15 + (hash(x, y, 20) - 0.5) * 0.06) as RGB;
  },
  bedrock: grain(0x5d6270, 0.45, 21),
  water: (x, y) => {
    const w = Math.sin((x + vnoise(x, y, 16, 22) * 8) * 0.4) * Math.sin((y + vnoise(y, x, 16, 23) * 8) * 0.4);
    return [...shade(hex(0x7cc4f2), 0.95 + w * 0.12), 200] as [number, number, number, number];
  },
  snow_top: (x, y) => shade(hex(0xf7fafc), 0.97 + (hash(x, y, 24) > 0.9 ? 0.05 : 0) + (fbm(x, y, 25) - 0.5) * 0.06) as RGB,
  ice: (x, y) => {
    const crack = Math.abs(vnoise(x, y, 16, 26) - 0.5) < 0.02 || Math.abs(vnoise(x, y, 8, 27) - 0.5) < 0.015;
    return crack ? hex(0xf2fbff) : (shade(hex(0xbfe4f4), 0.96 + vnoise(x, y, 16, 28) * 0.08) as RGB);
  },
  drygrass_top: (x, y) => {
    const c = grain(0xdcc27c, 0.2, 29)(x, y) as RGB;
    return hash(x, y >> 1, 30) > 0.9 ? (shade(c, 1.1) as RGB) : c;
  },
  metal: (x, y) => {
    const edge = x === 0 || y === 0 || x === 31 || y === 31;
    const rivet = (x === 3 || x === 28) && (y === 3 || y === 28);
    const brushed = 0.95 + vnoise(x * 6, y, 16, 31) * 0.08;
    if (rivet) return hex(0xeef2f6);
    return shade(hex(0xc3cad4), edge ? 0.8 : brushed) as RGB;
  },
  asphalt: (x, y) => (hash(x, y, 32) > 0.92 ? hex(0x5c636e) : (grain(0x454b55, 0.2, 33)(x, y) as RGB)),
  roadline: grain(0xe9edf2, 0.08, 34),
  neon: (x, y) => {
    const band = Math.abs(((y + 4) % 16) - 8) / 8;
    return mix(hex(0xffffff), hex(0x5ff2ff), Math.min(1, band * 1.4));
  },
  window: (x, y) => windowTile(x, y, hex(0x7fa8c9), false),
  window_lit: (x, y) => windowTile(x, y, hex(0xffd98a), true),
  gateframe: (x, y) => {
    const rune = (Math.abs(x - 16) < 2 && y > 8 && y < 24) || (Math.abs(y - 16) < 2 && x > 10 && x < 22);
    return rune ? hex(0xb8a8ff) : (grain(0x6d6a8a, 0.25, 35)(x, y) as RGB);
  },
  portal: (x, y) => {
    const a = Math.atan2(y - 15.5, x - 15.5), r = Math.hypot(x - 15.5, y - 15.5);
    const swirl = 0.5 + 0.5 * Math.sin(a * 3 + r * 0.6);
    const c = 200 + swirl * 55;
    return [c, c, c, 170 + swirl * 60];
  },
  asteroid: (x, y) => {
    const crater = vnoise(x, y, 8, 36);
    return shade(grain(0x6a6276, 0.3, 37)(x, y) as RGB, crater < 0.25 ? 0.82 : crater > 0.8 ? 1.1 : 1) as RGB;
  },
  crystal: (x, y) => {
    const facet = Math.floor((x + y) / 8) % 2 ? 1.1 : 0.9;
    return shade(hex(0xc3a3ff), facet + (Math.abs(x - y) < 1 ? 0.25 : 0)) as RGB;
  },
  station: (x, y) => {
    const line = x % 16 === 0 || y % 16 === 0;
    const light = y === 8 && x > 4 && x < 12;
    if (light) return hex(0xa8f4ff);
    return shade(hex(0xe6eaf0), line ? 0.82 : 0.98 + (hash(x, y, 38) - 0.5) * 0.04) as RGB;
  },
  ember: (x, y) => {
    const glow = vnoise(x, y, 8, 39);
    return mix(hex(0x5a2a1a), hex(0xffb347), Math.max(0, glow * 1.6 - 0.4));
  },
  ash: grain(0x4a4448, 0.35, 40),
  bedrock_dark: grain(0x5d6270, 0.4, 41),
  lava: (x, y) => {
    // Molten swirls: bright yellow veins through orange-red crust.
    const n = vnoise(x, y, 8, 43) * 0.6 + vnoise(x, y, 4, 44) * 0.4;
    const vein = Math.abs(n - 0.5) < 0.07 ? 1 : 0;
    return mix(mix(hex(0xc8381a), hex(0xff8a2a), n), hex(0xfff0a0), vein * 0.85);
  },
};

function leafy(base: number, x: number, y: number, s: number): RGB {
  const n = vnoise(x, y, 4, s) * 0.6 + vnoise(x, y, 8, s + 1) * 0.4;
  const c = hex(base);
  if (n < 0.32) return shade(c, 0.72) as RGB; // gaps between leaves read as shadow
  if (n > 0.7) return shade(c, 1.12) as RGB;
  return shade(c, 0.95 + (hash(x, y, s + 2) - 0.5) * 0.1) as RGB;
}

function windowTile(x: number, y: number, pane: RGB, lit: boolean): RGB {
  const frame = x < 2 || y < 2 || x > 29 || y > 29 || x === 15 || x === 16 || y === 15 || y === 16;
  if (frame) return hex(lit ? 0xc9b48a : 0x9fb1c4);
  const streak = Math.abs(x - y - 6) < 2 || Math.abs(x - y + 10) < 1;
  return shade(pane, lit ? 1 + (vnoise(x, y, 16, 42) - 0.5) * 0.15 : streak ? 1.25 : 0.95) as RGB;
}

/** Grass-like sides: soil with a soft, wavy cap of the top colour (not a jagged fringe). */
const capped = (top: Painter, cap: number, s: number): Painter => (x, y) => {
  const edge = TILE - 7 - Math.sin(x * 0.55 + s) * 1.5 - vnoise(x, 0, 8, s) * 3;
  return y > edge ? top(x, y) : y > edge - 1 ? (shade(top(x, y) as RGB, 0.82) as RGB) : (P.soil(x, y) as RGB);
};
P.moss_side = capped(P.moss_top, 0, 50);
P.snow_side = capped(P.snow_top, 0, 51);
P.drygrass_side = capped(P.drygrass_top, 0, 52);

/** A glass pane: almost clear in the middle, with a bright rim and a soft highlight. */
const glass = (tint: number): Painter => (x, y) => {
  const rim = x < 2 || y < 2 || x > 29 || y > 29;
  const hi = Math.abs(x - y) < 2 && x > 5 && x < 14;
  const c = hex(tint);
  if (rim) return [...mix(c, hex(0xffffff), 0.55), 235] as [number, number, number, number];
  if (hi) return [255, 255, 255, 150];
  return [...c, 70] as [number, number, number, number];
};

const TILES: [string, Painter][] = [
  ['moss_top', P.moss_top], ['moss_side', P.moss_side], ['soil', P.soil], ['stone', P.stone], ['sand', P.sand],
  ['wood_side', P.wood_side], ['wood_top', P.wood_top], ['leaf', P.leaf], ['plank', P.plank], ['clay', P.clay],
  ['bedrock', P.bedrock], ['water', P.water], ['blossom', P.blossom], ['maple', P.maple], ['snow_top', P.snow_top],
  ['snow_side', P.snow_side], ['ice', P.ice], ['drygrass_top', P.drygrass_top], ['drygrass_side', P.drygrass_side],
  ['metal', P.metal], ['asphalt', P.asphalt], ['roadline', P.roadline], ['neon', P.neon], ['window', P.window],
  ['window_lit', P.window_lit], ['gateframe', P.gateframe], ['portal', P.portal], ['asteroid', P.asteroid],
  ['crystal', P.crystal], ['station', P.station], ['ember', P.ember], ['ash', P.ash],
  ['glass', glass(0xe8f6ff)], ['glass_sky', glass(0x7cc8f2)], ['glass_rose', glass(0xf59ac0)],
  ['glass_amber', glass(0xf5c060)], ['glass_mint', glass(0x7fe0b0)], ['lava', P.lava],
];
const TILE_INDEX = new Map(TILES.map(([name], i) => [name, i]));

/** [top, side, bottom] tile names per block. */
const FACES: Partial<Record<Block, [string, string, string]>> = {
  [Block.Moss]: ['moss_top', 'moss_side', 'soil'],
  [Block.Soil]: ['soil', 'soil', 'soil'],
  [Block.Stone]: ['stone', 'stone', 'stone'],
  [Block.Sand]: ['sand', 'sand', 'sand'],
  [Block.Wood]: ['wood_top', 'wood_side', 'wood_top'],
  [Block.Leaf]: ['leaf', 'leaf', 'leaf'],
  [Block.Plank]: ['plank', 'plank', 'plank'],
  [Block.Clay]: ['clay', 'clay', 'clay'],
  [Block.Glass]: ['glass', 'glass', 'glass'],
  [Block.Bedrock]: ['bedrock', 'bedrock', 'bedrock'],
  [Block.Water]: ['water', 'water', 'water'],
  [Block.Blossom]: ['blossom', 'blossom', 'blossom'],
  [Block.Maple]: ['maple', 'maple', 'maple'],
  [Block.Snow]: ['snow_top', 'snow_top', 'snow_top'], // snow is snow all the way round (ground and tree caps)
  [Block.Ice]: ['ice', 'ice', 'ice'],
  [Block.DryGrass]: ['drygrass_top', 'drygrass_side', 'soil'],
  [Block.Metal]: ['metal', 'metal', 'metal'],
  [Block.Asphalt]: ['asphalt', 'asphalt', 'asphalt'],
  [Block.RoadLine]: ['roadline', 'roadline', 'roadline'],
  [Block.Neon]: ['neon', 'neon', 'neon'],
  [Block.Window]: ['metal', 'window', 'metal'],
  [Block.WindowLit]: ['metal', 'window_lit', 'metal'],
  [Block.GateFrame]: ['gateframe', 'gateframe', 'gateframe'],
  [Block.PortalFuture]: ['portal', 'portal', 'portal'],
  [Block.PortalSpace]: ['portal', 'portal', 'portal'],
  [Block.PortalHome]: ['portal', 'portal', 'portal'],
  [Block.Asteroid]: ['asteroid', 'asteroid', 'asteroid'],
  [Block.Crystal]: ['crystal', 'crystal', 'crystal'],
  [Block.Station]: ['station', 'station', 'station'],
  [Block.Ember]: ['ember', 'ember', 'ember'],
  [Block.Ash]: ['ash', 'ash', 'ash'],
  [Block.Lava]: ['lava', 'lava', 'lava'],
  [Block.GlassSky]: ['glass_sky', 'glass_sky', 'glass_sky'],
  [Block.GlassRose]: ['glass_rose', 'glass_rose', 'glass_rose'],
  [Block.GlassAmber]: ['glass_amber', 'glass_amber', 'glass_amber'],
  [Block.GlassMint]: ['glass_mint', 'glass_mint', 'glass_mint'],
};

/** Tile index for a block face (face: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z). */
export function tileOf(b: Block, face: number): number {
  const f = FACES[b];
  if (!f) return TILE_INDEX.get('stone')!;
  return TILE_INDEX.get(face === 2 ? f[0] : face === 3 ? f[2] : f[1])!;
}

/** Tiles that get their colour from the texture alone (portals are tinted per block instead). */
export const PORTAL_TINT: Partial<Record<Block, number>> = {
  [Block.PortalFuture]: 0x4fe3ff, [Block.PortalSpace]: 0xa47bff, [Block.PortalHome]: 0x8ff0a4,
};

let atlas: THREE.DataTexture | null = null;

/** The block atlas, painted once. Tiles are inset by half a texel in UVs to avoid bleeding. */
export function blockAtlas(): THREE.DataTexture {
  if (atlas) return atlas;
  const data = new Uint8Array(ATLAS * ATLAS * 4);
  TILES.forEach(([, paint], i) => {
    const ox = (i % COLS) * TILE, oy = Math.floor(i / COLS) * TILE;
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const [r, g, b, a = 255] = paint(x, y);
        const o = ((oy + y) * ATLAS + ox + x) * 4;
        data[o] = Math.max(0, Math.min(255, r));
        data[o + 1] = Math.max(0, Math.min(255, g));
        data[o + 2] = Math.max(0, Math.min(255, b));
        data[o + 3] = Math.max(0, Math.min(255, a));
      }
  });
  atlas = new THREE.DataTexture(data, ATLAS, ATLAS, THREE.RGBAFormat);
  atlas.magFilter = THREE.NearestFilter; // crisp detail up close
  atlas.minFilter = THREE.LinearFilter;
  atlas.generateMipmaps = false;
  atlas.needsUpdate = true;
  return atlas;
}

/** UV rectangle [u0, v0, u1, v1] of a tile. */
export function tileUV(i: number): [number, number, number, number] {
  const x = (i % COLS) * TILE, y = Math.floor(i / COLS) * TILE, e = 0.5;
  return [(x + e) / ATLAS, (y + e) / ATLAS, (x + TILE - e) / ATLAS, (y + TILE - e) / ATLAS];
}

/** Five crack stages for the block you're digging (white lines on transparent). */
export function crackTextures(): THREE.DataTexture[] {
  const out: THREE.DataTexture[] = [];
  for (let stage = 1; stage <= 5; stage++) {
    const data = new Uint8Array(TILE * TILE * 4);
    // Random-walk cracks from the centre; more and longer each stage.
    for (let k = 0; k < stage * 3; k++) {
      let x = 16, y = 16;
      const a0 = hash(k, stage, 77) * Math.PI * 2;
      for (let step = 0; step < 6 + stage * 3; step++) {
        const a = a0 + (hash(k, step, 78) - 0.5) * 1.6;
        x += Math.cos(a) * 1.2;
        y += Math.sin(a) * 1.2;
        const ix = Math.round(x), iy = Math.round(y);
        if (ix < 0 || iy < 0 || ix >= TILE || iy >= TILE) break;
        const o = (iy * TILE + ix) * 4;
        data[o] = 40; data[o + 1] = 32; data[o + 2] = 30; data[o + 3] = 210;
      }
    }
    const t = new THREE.DataTexture(data, TILE, TILE, THREE.RGBAFormat);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    out.push(t);
  }
  return out;
}

/** A soft round glow (sun, moon) as a texture. */
export function glowTexture(inner: number, outer: number): THREE.DataTexture {
  const n = 64, data = new Uint8Array(n * n * 4);
  const a = hex(inner), b = hex(outer);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x - 31.5, y - 31.5) / 31.5;
      const core = r < 0.32 ? 1 : 0;
      const halo = Math.max(0, 1 - r) ** 2;
      const c = mix(b, a, core);
      const o = (y * n + x) * 4;
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2];
      data[o + 3] = Math.min(255, (core + halo * 0.6) * 255);
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** The ripple texture for water, repeating across the surface (scrolled to look alive). */
export function waterTexture(): THREE.DataTexture {
  const data = new Uint8Array(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const [r, g, b, a = 255] = P.water(x, y);
      const o = (y * TILE + x) * 4;
      const c = (v: number) => Math.max(0, Math.min(255, v));
      data[o] = c(r); data[o + 1] = c(g); data[o + 2] = c(b); data[o + 3] = c(a);
    }
  const t = new THREE.DataTexture(data, TILE, TILE, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
