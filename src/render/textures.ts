import * as THREE from 'three';
import { Block, PHOTO_BLOCKS, PHOTO_DEFAULT } from '../game/blocks';

/**
 * Procedurally painted block textures (no image files, nothing copied): every tile is drawn
 * here from noise and simple shapes, in Voxel Valley's soft pastel palette.
 */
export const TILE = 32;
const COLS = 16;
export const ATLAS = TILE * COLS; // 512 × 512, up to 256 tiles

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
    // Pale moonstone with a gold inlay border and a small gold diamond: a bright, ornate arch.
    const edge = Math.min(x, y, 31 - x, 31 - y);
    if (edge === 2) return hex(0xe2b85c);
    if (Math.abs(x - 15.5) + Math.abs(y - 15.5) < 5) return mix(hex(0xf6d488), hex(0xe2b85c), (Math.abs(x - 15.5) + Math.abs(y - 15.5)) / 5);
    return grain(0xece6da, 0.12, 35)(x, y) as RGB;
  },
  portal: (x, y) => {
    // A curtain of light: soft vertical ribbons that ripple sideways, with a few sparkles.
    const ribbon = 0.5 + 0.5 * Math.sin(x * 0.59 + Math.sin(y * 0.39) * 1.6);
    const sparkle = hash(x, y, 77) > 0.975 ? 1 : 0;
    const c = Math.min(255, 205 + ribbon * 45 + sparkle * 40);
    return [c, c, c, Math.min(255, 150 + ribbon * 70 + sparkle * 60)];
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

/** Stone with clusters of a gem poking out: faceted colour, a dark rim and a bright glint. */
const ore = (gem: number, seed: number): Painter => {
  // Fixed cluster centres per gem so each ore has its own recognisable pattern.
  const spots = Array.from({ length: 5 }, (_, i) => ({
    x: 4 + hash(i, 1, seed) * 24, y: 4 + hash(i, 2, seed) * 24, r: 2.6 + hash(i, 3, seed) * 2.4,
  }));
  return (x, y) => {
    for (const sp of spots) {
      const d = Math.hypot(x + 0.5 - sp.x, y + 0.5 - sp.y);
      if (d > sp.r) continue;
      if (d > sp.r - 0.9) return shade(hex(gem), 0.55) as RGB;
      const facet = (x - sp.x) + (y - sp.y) < 0 ? 1.18 : 0.88;
      if (x + 0.5 - sp.x < -sp.r * 0.25 && y + 0.5 - sp.y < -sp.r * 0.25 && d < sp.r * 0.6) return mix(hex(gem), hex(0xffffff), 0.75);
      return shade(hex(gem), facet) as RGB;
    }
    return P.stone(x, y) as RGB;
  };
};

/** Treasure chest: dark wood planks, gold corner bands, a lock plate on the sides. */
const chest = (top: boolean): Painter => (x, y) => {
  const gold = hex(0xf2c14e), wood = hex(0xa8692f), dark = hex(0x5a3416);
  if (x < 2 || x > 29 || y < 2 || y > 29) return shade(gold, x < 1 || x > 30 || y < 1 || y > 30 ? 0.7 : 1) as RGB;
  if (!top && y >= 11 && y <= 12) return shade(gold, 0.85) as RGB; // lid seam
  if (top && (x === 9 || x === 22)) return gold;
  if (!top && x >= 13 && x <= 18 && y >= 9 && y <= 17) {
    // Lock plate with a keyhole.
    const hole = (x === 15 || x === 16) && y >= 12 && y <= 15;
    return hole ? hex(0x1d1208) : shade(gold, y === 9 || x === 13 || x === 18 ? 0.8 : 1.05) as RGB;
  }
  const plank = top ? x % 8 === 0 : y % 7 === 0;
  return plank ? dark : (shade(wood, 1 + (fbm(x, y * 3, 60) - 0.5) * 0.3) as RGB);
};

/** Rune stone: dark violet rock with glowing carved lines. */
const rune: Painter = (x, y) => {
  const glyph =
    (x === 16 && y > 5 && y < 26) || (y === 10 && x > 9 && x < 23) || (Math.abs(x - y) < 1 && x > 8 && x < 24) ||
    (Math.abs(x + y - 31) < 1 && x > 18 && x < 26) || (Math.hypot(x - 16, y - 16) > 11 && Math.hypot(x - 16, y - 16) < 12.2);
  if (glyph) return mix(hex(0xd9c8ff), hex(0xffffff), hash(x, y, 64) * 0.4);
  return shade(hex(0x3a2a66), 0.85 + fbm(x, y, 65) * 0.4) as RGB;
};

/** A glass pane: almost clear in the middle, with a bright rim and a soft highlight. */
const glass = (tint: number): Painter => (x, y) => {
  const rim = x < 2 || y < 2 || x > 29 || y > 29;
  const hi = Math.abs(x - y) < 2 && x > 5 && x < 14;
  const c = hex(tint);
  if (rim) return [...mix(c, hex(0xffffff), 0.55), 235] as [number, number, number, number];
  if (hi) return [255, 255, 255, 150];
  return [...c, 70] as [number, number, number, number];
};

/** Colours of the 내 방 photo blocks (repainted by setPhotoTiles). */
const photoColors = [...PHOTO_DEFAULT];
/** A photo-colour block: the colour with a faint plaster grain and a soft bevelled edge. */
const photoTile = (i: number): Painter => (x, y) => {
  const n = fbm(x, y, 70 + i) - 0.5 + (hash(x, y, 80 + i) - 0.5) * 0.25;
  const edge = x < 1 || y < 1 || x > 30 || y > 30 ? 0.88 : x < 2 || y < 2 ? 1.05 : 1;
  return shade(hex(photoColors[i]), (1 + n * 0.09) * edge) as RGB;
};

/*
 * 꿀알바 store street. Products are just colourful shapes (no brands, no text), the sign is a honey
 * band with drips, and everything is drawn here like the other tiles.
 */
const inR = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const PACKS = [0xff5a5f, 0xffc23c, 0x3fb6ff, 0x5ad18a, 0xb07cff, 0xff8fc2, 0xff8a3c, 0xf2f2f2];
/** Shelf: three levels of packets in random colours, a steel shelf edge under each level. */
const shelf = (seed: number, cups: boolean): Painter => (x, y) => {
  const level = Math.floor(y / 11); // 0..2 from the bottom of the tile (y up)
  const ly = y - level * 11;
  if (ly <= 1) return shade(hex(0xc3cad4), ly === 0 ? 0.75 : 1.05) as RGB; // shelf lip
  if (x < 1 || x > 30) return hex(0x8a929c);
  if (cups) {
    // Cup noodles: a row of round-shouldered cups with a lid band.
    const col = Math.floor(x / 5), cx = col * 5 + 2.5;
    if (Math.abs(x + 0.5 - cx) > 2 + (ly - 2) * 0.05) return hex(0x30343c);
    const c = hex(PACKS[(col * 3 + level + seed) % 3 === 0 ? 1 : (col + level) % 2 ? 0 : 7]);
    if (ly >= 8) return shade(c, 1.15) as RGB;
    if (ly === 5) return hex(0xffffff);
    return shade(c, 0.95) as RGB;
  }
  const col = Math.floor(x / 6);
  const h = 5 + Math.floor(hash(col, level, seed) * 4);
  if (ly - 2 > h) return hex(0x30343c); // shadow above shorter packs
  const c = hex(PACKS[Math.floor(hash(col, level, seed + 1) * PACKS.length)]);
  if (x % 6 === 0) return shade(c, 0.7) as RGB;
  if (ly - 2 === h) return shade(c, 1.2) as RGB;
  return (ly === 4 && x % 6 > 1 && x % 6 < 5 ? mix(c, hex(0xffffff), 0.7) : c) as RGB; // a label stripe
};
const STORE: Record<string, Painter> = {
  store_tile: (x, y) => {
    if (x % 16 === 0 || y % 16 === 0) return hex(0xc9ccd2); // grout
    const sheen = Math.abs(((x % 16) - (y % 16))) < 2 ? 1.04 : 1;
    return shade(hex(0xf1f3f5), sheen * (0.98 + hash(x >> 2, y >> 2, 501) * 0.03)) as RGB;
  },
  store_wall: (x, y) => (x % 16 === 0 ? hex(0xdcd6cb) : (shade(hex(0xf4f1ea), 0.98 + fbm(x, y, 502) * 0.05) as RGB)),
  store_sign: (x, y) => {
    if (y >= 27) return y === 27 ? hex(0xfff3c4) : hex(0xffffff);
    if (y <= 3) return hex(0x6b3d10);
    // Honey drips hanging from the top band.
    const drip = 27 - (3 + Math.floor(hash(x >> 2, 0, 503) * 9));
    if (y > drip && y < 27) return mix(hex(0xff9d1e), hex(0xffd04a), (y - drip) / (27 - drip));
    const hx = x % 8, hy = y % 7; // faint honeycomb
    return (hx === 0 || hy === 0) && ((x >> 3) + (y / 7 | 0)) % 2 === 0 ? hex(0xffd96b) : hex(0xffc93c);
  },
  ceiling_light: (x, y) => {
    if (x < 2 || y < 2 || x > 29 || y > 29) return hex(0xd6dbe2);
    return x === 2 || y === 2 ? hex(0xffffff) : (shade(hex(0xf8fbff), 0.97 + 0.03 * Math.sin(x * 0.4)) as RGB);
  },
  shelf_side: shelf(510, false),
  shelf_side2: shelf(520, false),
  noodle_side: shelf(530, true),
  shelf_top: (x, y) => (x < 1 || y < 1 || x > 30 || y > 30 ? hex(0x8a929c) : (shade(hex(0xc3cad4), 0.95 + hash(x, y, 511) * 0.08) as RGB)),
  cooler_side: (x, y) => {
    // Lit fridge doors. Glow blocks skip shading and bloom, so keep this mid-toned: the bottles must
    // read as colours, not blow out to white.
    if (x < 2 || x > 29 || y < 2 || y > 29) return hex(0x8c96a3); // door frame
    if (x === 15 || x === 16) return hex(0x6f7883); // door split
    const level = Math.floor((y - 2) / 9), ly = (y - 2) % 9;
    if (ly === 0) return hex(0xa9c4dc); // lit shelf edge
    const bx = Math.floor((x - 2) / 4), lx = (x - 2) % 4;
    const c = hex([0x1f8fe0, 0xd8343c, 0x2fae5f, 0xe8a817, 0x8a52e0, 0xe86a1e, 0xc9d3dc][(bx + level * 3) % 7]);
    if (lx === 0) return hex(0x3c5468); // dim gap between bottles
    if (ly >= 7) return lx === 2 ? hex(0x1d2129) : hex(0x3c5468); // caps
    if (Math.abs(x - y + 3) < 1) return hex(0xb8c8d8); // glass glare
    return (ly === 3 ? mix(c, hex(0xffffff), 0.45) : shade(c, 0.85)) as RGB;
  },
  counter_side: (x, y) => (y >= 28 ? hex(0xf4f4f0) : y >= 26 ? hex(0x9a7a52) : (shade(hex(0xd9b98a), 0.92 + fbm(x * 3, y, 541) * 0.15) as RGB)),
  counter_top: (x, y) => (shade(hex(0xf4f2ec), 0.97 + hash(x >> 1, y >> 1, 542) * 0.04) as RGB),
  register_side: (x, y) => (inR(x, y, 6, 6, 25, 20) ? (inR(x, y, 8, 8, 23, 18) ? hex(0x6fd3ff) : hex(0x1d2129)) : (shade(hex(0x2e3440), 0.95 + hash(x, y, 543) * 0.08) as RGB)),
  register_top: (x, y) => {
    if (inR(x, y, 3, 14, 28, 29)) return inR(x, y, 5, 16, 26, 27) ? mix(hex(0x6fd3ff), hex(0xffffff), (y - 16) / 22) : hex(0x1d2129);
    if (y < 12 && x > 3 && x < 28 && x % 4 !== 0 && y % 4 !== 0) return hex(0xdfe3ea); // keys
    return hex(0x2e3440);
  },
  cig_side: (x, y) => {
    if (x % 4 === 0 || y % 6 === 0) return hex(0x2a2f3a);
    const c = hex([0xffffff, 0xd94040, 0x3a6fd6, 0x2fa86a, 0xf2c14e, 0x9a9aa8][Math.floor(hash(x >> 2, Math.floor(y / 6), 544) * 6)]);
    return (y % 6 === 5 ? shade(c, 0.85) : c) as RGB;
  },
  coffee_side: (x, y) => {
    if (inR(x, y, 9, 4, 22, 15)) return inR(x, y, 13, 5, 18, 10) ? hex(0xf4efe6) : hex(0x15110f); // cup bay + paper cup
    if (inR(x, y, 14, 15, 17, 18)) return hex(0xb8bec6); // nozzle
    if (inR(x, y, 22, 24, 24, 26)) return hex(0xff4040); // power light
    if (inR(x, y, 7, 21, 20, 27)) return hex(0x5a4a40); // menu panel
    return shade(hex(0x3a3330), 0.95 + hash(x, y, 545) * 0.08) as RGB;
  },
  microwave_side: (x, y) => {
    if (x < 1 || y < 1 || x > 30 || y > 30) return hex(0xb9bec6);
    if (inR(x, y, 3, 5, 21, 26)) return inR(x, y, 5, 7, 19, 24) ? (shade(hex(0x2a2f3a), 1 + (x + y) % 5 * 0.02) as RGB) : hex(0x9aa0a8);
    if (x > 23 && x < 29 && y > 6 && y < 26 && y % 3 === 0) return hex(0x6a7078); // buttons
    if (inR(x, y, 24, 22, 28, 25)) return hex(0x5fe08a); // display
    return hex(0xf2f2f2);
  },
  hotwater_side: (x, y) => {
    if (inR(x, y, 8, 10, 12, 13)) return hex(0xe03a3a);
    if (inR(x, y, 19, 10, 23, 13)) return hex(0x3a7ae0);
    if (inR(x, y, 9, 4, 22, 9)) return hex(0x2a2f3a); // drip tray
    return shade(hex(0xc8ccd2), 0.9 + (x % 6) * 0.03) as RGB;
  },
  freezer_top: (x, y) => {
    if (x < 2 || y < 2 || x > 29 || y > 29) return hex(0xf2f6fa);
    const cell = (Math.floor(x / 6) + Math.floor(y / 6) * 5) % 6;
    const c = hex([0xffc2d9, 0xfff1b8, 0xb8e8ff, 0xd4b48a, 0xc8f0c0, 0xffffff][cell]);
    if (x % 6 === 0 || y % 6 === 0) return hex(0xdff2ff);
    return (Math.abs(x - y) < 1.5 ? hex(0xffffff) : c) as RGB; // lid glare
  },
  freezer_side: (x, y) => (y > 22 && y < 27 ? hex(0x3f8fe0) : y >= 27 ? hex(0xe6ecf2) : (shade(hex(0xf6f8fa), 0.97 + hash(x, y, 546) * 0.03) as RGB)),
  atm_side: (x, y) => {
    if (inR(x, y, 6, 14, 25, 26)) return inR(x, y, 8, 16, 23, 24) ? mix(hex(0x7fd8ff), hex(0xffffff), (y - 16) / 20) : hex(0x1d2129);
    if (inR(x, y, 9, 3, 22, 11)) return x % 3 === 0 || y % 3 === 0 ? hex(0x3a3f48) : hex(0xd8dde4); // keypad
    if (y >= 28) return hex(0xffc23c);
    return hex(0x2f6fd6);
  },
  trash_side: (x, y) => {
    if (y >= 26) return hex(0x3a3f48);
    if (x % 11 === 10) return hex(0x5a6068);
    const c = hex([0x3f7fd6, 0xffc23c, 0x3fae5a][Math.min(2, Math.floor(x / 11))]);
    if (inR(x % 11, y, 3, 18, 7, 22)) return hex(0xffffff); // recycling mark
    return shade(c, 0.95 + hash(x, y, 547) * 0.08) as RGB;
  },
  trash_top: (x, y) => (inR(x % 11, y, 2, 12, 8, 19) ? hex(0x111317) : hex(0x5a6068)),
  table_top: (x, y) => (x % 5 === 0 ? hex(0x2f8a46) : (shade(hex(0x3fae5a), 0.95 + hash(x, y, 548) * 0.08) as RGB)),
  table_side: (x, y) => (y >= 27 || inR(x, y, 0, 0, 3, 26) || inR(x, y, 28, 0, 31, 26) ? hex(0x3fae5a) : y >= 24 ? hex(0x2f8a46) : [20, 24, 30, 0]),
  chair_side: (x, y) => (y >= 14 && y <= 16 ? hex(0x2f66b8) : (y > 16 && x % 6 < 4) || inR(x, y, 0, 0, 3, 13) || inR(x, y, 28, 0, 31, 13) ? hex(0x3f7fd6) : [20, 24, 30, 0]),
  parasol_top: (x, y) => (Math.floor((Math.atan2(y - 15.5, x - 15.5) + Math.PI) / (Math.PI / 4)) % 2 ? hex(0xf2f2f2) : hex(0xe8473c)),
  parasol_side: (x, y) => (y < 6 ? (Math.floor(x / 4) % 2 ? hex(0xf2f2f2) : hex(0xe8473c)) : y < 8 ? hex(0xc8382e) : [0, 0, 0, 0]),
  box_side: (x, y) => (inR(x, y, 13, 0, 18, 31) && y > 22 ? hex(0xd9c7a0) : inR(x, y, 4, 6, 12, 10) ? hex(0xf4f4f0) : (shade(hex(0xc89a62), 0.92 + fbm(x, y, 549) * 0.15) as RGB)),
  box_top: (x, y) => (inR(x, y, 13, 0, 18, 31) ? hex(0xd9c7a0) : (shade(hex(0xc89a62), 0.95 + fbm(x, y, 550) * 0.12) as RGB)),
  sidewalk: (x, y) => {
    const row = Math.floor(y / 8), off = row % 2 ? 8 : 0;
    if (y % 8 === 0 || (x + off) % 16 === 0) return hex(0x8f8a84);
    return shade(hex([0xb9b4ad, 0xa9a49d, 0xc4bfb8][Math.floor(hash(Math.floor((x + off) / 16), row, 551) * 3)]), 0.97 + hash(x, y, 552) * 0.05) as RGB;
  },
  streetlight: (x, y) => mix(hex(0xffd27a), hex(0xfff6dc), 1 - Math.min(1, Math.hypot(x - 15.5, y - 15.5) / 18)),
  brick: (x, y) => {
    const row = Math.floor(y / 6), off = row % 2 ? 6 : 0;
    if (y % 6 === 0 || (x + off) % 12 === 0) return hex(0x5c3a33);
    return shade(hex(0x8a4a3c), 0.88 + hash(Math.floor((x + off) / 12), row, 553) * 0.2) as RGB;
  },
  shutter: (x, y) => (y % 4 === 0 ? hex(0x6f7680) : y % 4 === 1 ? hex(0xb9c0c8) : (shade(hex(0x9aa1aa), 0.96 + hash(x >> 3, y, 554) * 0.06) as RGB)),
  staffdoor: (x, y) => {
    if (x < 2 || x > 29) return hex(0x4a525c);
    if (inR(x, y, 9, 18, 22, 26)) return hex(0x9fc4dc); // little window
    if (inR(x, y, 23, 12, 26, 14)) return hex(0xd8dde4); // handle
    return shade(hex(0x6f7a86), 0.97 + hash(x, y, 555) * 0.04) as RGB;
  },
  bedding: (x, y) => (Math.floor(x / 4 + y / 4) % 2 ? hex(0x7fa6e0) : ((x + y) % 8 === 0 ? hex(0xffffff) : hex(0x9fbcec))),
  awning: (x, y) => (Math.floor(x / 4) % 2 ? hex(0xfff3e0) : y < 3 ? hex(0xd9781e) : hex(0xff9f2e)),
};

/** The dark worlds: an old 안방 (maze) and a car park (game/darkworlds.ts). */
const paint = (base: number, amount: number, s: number): Painter => grain(base, amount, s);
const DARK: Record<string, Painter> = {
  jangpan: (x, y) => {
    // Old office carpet: a fine low pile in khaki-beige, darker damp blotches that never dry.
    const pile = 0.9 + hash(x, y, 601) * 0.12 + fbm(x, y, 603) * 0.06;
    const c = shade(hex(0xa49a68), pile) as RGB;
    const damp = fbm(x + 40, y + 13, 602);
    return damp > 0.62 ? (mix(c, hex(0x6f6638), Math.min(0.6, (damp - 0.62) * 2.4)) as RGB) : c;
  },
  wallpaper: (x, y) => {
    // Mono-yellow paper with thin vertical stripes, faintly uneven, the way it fades on old walls.
    const base = shade(hex(0xcdbb63), 0.95 + fbm(x, y, 611) * 0.07) as RGB;
    if (x % 8 === 0) return shade(base, 0.9) as RGB;
    if (x % 8 === 4) return shade(base, 1.04) as RGB;
    return base;
  },
  wallpaper_stain: (x, y) => {
    const c = DARK.wallpaper(x, y) as RGB;
    const blot = fbm(x, y * 0.6, 621);
    return blot > 0.52 ? (mix(c, hex(0x7a6a30), Math.min(0.7, (blot - 0.52) * 2.6)) as RGB) : (shade(c, 0.93) as RGB);
  },
  banja: (x, y) => {
    // Acoustic ceiling tiles: a pale grid, pinholes in the board, yellowed with age.
    if (x % 16 === 0 || y % 16 === 0) return hex(0xa9a07a);
    const c = shade(hex(0xd9d3ae), 0.96 + fbm(x, y, 631) * 0.06) as RGB;
    return hash(x, y, 632) < 0.06 ? (shade(c, 0.86) as RGB) : c;
  },
  jagae_top: paint(0x1d1a22, 0.15, 641),
  jagae_side: (x, y) => {
    // Black lacquer with mother-of-pearl: a curling vine of shimmering specks, and brass corners.
    if ((x < 3 || x > 28) && (y < 3 || y > 28)) return hex(0xc9a24a);
    const vine = Math.abs(y - 16 - 7 * Math.sin(x / 4.5)) < 1.2 || Math.hypot(x - 9, y - 9) < 2.5 || Math.hypot(x - 23, y - 22) < 2.5;
    if (vine) {
      const t = hash(x, y, 642);
      return t < 0.33 ? hex(0xbfe8ff) : t < 0.66 ? hex(0xf6d6f0) : hex(0xd8f6e0);
    }
    return shade(hex(0x1d1a22), 0.9 + hash(x, y, 643) * 0.2) as RGB;
  },
  byeongpung: (x, y) => {
    if (x < 2 || x > 29 || y < 2 || y > 29) return hex(0x5a3a22);
    // A faint ink landscape: two mountains and a moon.
    const m1 = y > 22 - 9 * Math.max(0, 1 - Math.abs(x - 11) / 9), m2 = y > 26 - 7 * Math.max(0, 1 - Math.abs(x - 22) / 8);
    if (Math.hypot(x - 23, y - 8) < 3) return hex(0xe8d8a8);
    if (m1 || m2) return shade(hex(0x8a8268), 0.9 + fbm(x, y, 651) * 0.2) as RGB;
    return shade(hex(0xd8c89a), 0.95 + fbm(x, y, 652) * 0.08) as RGB;
  },
  yo: (x, y) => ((x % 8 === 0 || y % 8 === 0) ? hex(0xc07888) : (shade(hex(0xe0a0b0), 0.95 + hash(x >> 1, y >> 1, 661) * 0.1) as RGB)),
  tv_side: paint(0x5a5550, 0.12, 671),
  tv_front: (x, y) => {
    if (x < 3 || x > 28 || y < 3 || y > 24) return hex(0x3a3632);
    if (y > 26) return x % 6 === 0 ? hex(0x9a948a) : hex(0x3a3632);
    const v = hash(x, y, 672) * 0.6 + 0.25 + (y % 3 === 0 ? -0.1 : 0);
    return shade(hex(0xc8d4e0), v) as RGB; // static
  },
  dim_lamp: (x, y) => {
    // A fluorescent panel: a thin metal frame round a milky diffuser with a faint prism grid.
    if (x < 2 || x > 29 || y < 2 || y > 29) return hex(0xb8b29a);
    if (x % 6 === 0 || y % 6 === 0) return hex(0xf2ead0);
    return shade(hex(0xfff8e2), 0.97 + 0.03 * Math.sin(x * 0.5)) as RGB;
  },
  concrete: (x, y) => {
    if ((x === 8 || x === 24) && (y === 8 || y === 24)) return hex(0x5a5a58); // form-tie holes
    if (y % 16 === 0) return hex(0x84847f);
    return shade(hex(0x9a9a96), 0.9 + fbm(x, y, 681) * 0.2) as RGB;
  },
  epoxy: (x, y) => shade(hex(0x5f7f6a), 0.92 + fbm(x, y, 691) * 0.12 + (Math.abs(x - y) % 29 < 1 ? 0.06 : 0)) as RGB,
  level_blue: paint(0x2f6fd6, 0.1, 701),
  level_yellow: (x, y) => (Math.floor((x + y) / 6) % 2 ? hex(0xf2c230) : hex(0x2a2a2a)), // hazard stripes
  level_red: paint(0xd84a3a, 0.1, 703),
  level_green: paint(0x3faa5a, 0.1, 704),
  exit_sign: (x, y) => {
    // An original exit sign: a white doorway with an arrow running into it, on green.
    if (x < 2 || x > 29 || y < 6 || y > 25) return hex(0xe8f0e8);
    const door = x >= 19 && x <= 26 && y >= 9 && y <= 22 && (x === 19 || x === 26 || y === 9);
    const arrow = (y >= 14 && y <= 17 && x >= 5 && x <= 14) || (x >= 12 && x <= 16 && Math.abs(y - 15.5) <= 16 - x);
    return door || arrow ? hex(0xffffff) : hex(0x1faa50);
  },
  car_red: (x, y) => carBody(0xb8322c, x, y),
  car_white: (x, y) => carBody(0xe8eaec, x, y),
  car_black: (x, y) => carBody(0x22252b, x, y),
  car_glass: (x, y) => (Math.abs(x - y - 6) < 3 || Math.abs(x - y + 10) < 1.5 ? hex(0x6a7f94) : (shade(hex(0x22303e), 0.9 + y / 160) as RGB)),
  tire: (x, y) => {
    const r = Math.hypot(x - 15.5, y - 15.5);
    return r < 5 ? hex(0x9aa1aa) : r < 6 ? hex(0x4a4a4a) : (shade(hex(0x161616), 0.9 + hash(x, y, 711) * 0.2) as RGB);
  },
};
function carBody(base: number, x: number, y: number): RGB {
  if (y === 15) return shade(hex(base), 0.7) as RGB; // the door line
  if (y >= 18 && y <= 19 && x >= 20 && x <= 25) return hex(0x9aa1aa); // a handle
  return shade(hex(base), 0.92 + y / 260 + hash(x, y, 721) * 0.04) as RGB;
}

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
  ['ore_gold', ore(0xf2c14e, 91)], ['ore_ruby', ore(0xff3b5c, 92)], ['ore_sapphire', ore(0x3f7bff, 93)],
  ['ore_emerald', ore(0x2fcf7d, 94)], ['ore_diamond', ore(0x8ff2ff, 95)],
  ['chest_side', chest(false)], ['chest_top', chest(true)], ['rune', rune],
  ...PHOTO_BLOCKS.map((_, i) => [`photo_${i}`, photoTile(i)] as [string, Painter]),
  ...Object.entries(STORE),
  ...Object.entries(DARK),
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
  [Block.GoldOre]: ['ore_gold', 'ore_gold', 'ore_gold'],
  [Block.RubyOre]: ['ore_ruby', 'ore_ruby', 'ore_ruby'],
  [Block.SapphireOre]: ['ore_sapphire', 'ore_sapphire', 'ore_sapphire'],
  [Block.EmeraldOre]: ['ore_emerald', 'ore_emerald', 'ore_emerald'],
  [Block.DiamondOre]: ['ore_diamond', 'ore_diamond', 'ore_diamond'],
  [Block.Chest]: ['chest_top', 'chest_side', 'chest_top'],
  [Block.Rune]: ['rune', 'rune', 'rune'],
  ...Object.fromEntries(PHOTO_BLOCKS.map((b, i) => [b, [`photo_${i}`, `photo_${i}`, `photo_${i}`]])),
  [Block.StoreTile]: ['store_tile', 'store_wall', 'store_tile'],
  [Block.StoreWall]: ['store_wall', 'store_wall', 'store_wall'],
  [Block.StoreSign]: ['store_wall', 'store_sign', 'store_wall'],
  [Block.CeilingLight]: ['store_wall', 'ceiling_light', 'ceiling_light'],
  [Block.ShelfSnack]: ['shelf_top', 'shelf_side', 'shelf_top'],
  [Block.ShelfNoodle]: ['shelf_top', 'noodle_side', 'shelf_top'],
  [Block.Cooler]: ['shelf_top', 'cooler_side', 'shelf_top'],
  [Block.Counter]: ['counter_top', 'counter_side', 'counter_top'],
  [Block.Register]: ['register_top', 'register_side', 'register_side'],
  [Block.CigWall]: ['shelf_top', 'cig_side', 'shelf_top'],
  [Block.CoffeeMachine]: ['shelf_top', 'coffee_side', 'shelf_top'],
  [Block.Microwave]: ['shelf_top', 'microwave_side', 'shelf_top'],
  [Block.HotWater]: ['shelf_top', 'hotwater_side', 'shelf_top'],
  [Block.Freezer]: ['freezer_top', 'freezer_side', 'freezer_side'],
  [Block.Atm]: ['shelf_top', 'atm_side', 'shelf_top'],
  [Block.TrashBin]: ['trash_top', 'trash_side', 'trash_side'],
  [Block.PlasticTable]: ['table_top', 'table_side', 'table_top'],
  [Block.PlasticChair]: ['chair_side', 'chair_side', 'chair_side'],
  [Block.Parasol]: ['parasol_top', 'parasol_side', 'parasol_top'],
  [Block.DeliveryBox]: ['box_top', 'box_side', 'box_top'],
  [Block.Sidewalk]: ['sidewalk', 'sidewalk', 'sidewalk'],
  [Block.StreetLight]: ['streetlight', 'streetlight', 'streetlight'],
  [Block.Brick]: ['brick', 'brick', 'brick'],
  [Block.Shutter]: ['shutter', 'shutter', 'shutter'],
  [Block.StaffDoor]: ['staffdoor', 'staffdoor', 'staffdoor'],
  [Block.Bedding]: ['bedding', 'bedding', 'bedding'],
  [Block.Awning]: ['awning', 'awning', 'awning'],
  [Block.PortalDark]: ['portal', 'portal', 'portal'],
  [Block.PortalParking]: ['portal', 'portal', 'portal'],
  [Block.Jangpan]: ['jangpan', 'wallpaper', 'jangpan'],
  [Block.Wallpaper]: ['banja', 'wallpaper', 'jangpan'],
  [Block.WallpaperStain]: ['banja', 'wallpaper_stain', 'jangpan'],
  [Block.Banja]: ['banja', 'banja', 'banja'],
  [Block.Jagae]: ['jagae_top', 'jagae_side', 'jagae_top'],
  [Block.Byeongpung]: ['byeongpung', 'byeongpung', 'byeongpung'],
  [Block.Yo]: ['yo', 'yo', 'yo'],
  [Block.OldTv]: ['tv_side', 'tv_front', 'tv_side'],
  [Block.DimLamp]: ['dim_lamp', 'dim_lamp', 'dim_lamp'],
  [Block.Concrete]: ['concrete', 'concrete', 'concrete'],
  [Block.Epoxy]: ['epoxy', 'concrete', 'concrete'],
  [Block.LevelBlue]: ['level_blue', 'level_blue', 'level_blue'],
  [Block.LevelYellow]: ['level_yellow', 'level_yellow', 'level_yellow'],
  [Block.LevelRed]: ['level_red', 'level_red', 'level_red'],
  [Block.LevelGreen]: ['level_green', 'level_green', 'level_green'],
  [Block.ExitSign]: ['exit_sign', 'exit_sign', 'exit_sign'],
  [Block.CarRed]: ['car_red', 'car_red', 'car_red'],
  [Block.CarWhite]: ['car_white', 'car_white', 'car_white'],
  [Block.CarBlack]: ['car_black', 'car_black', 'car_black'],
  [Block.CarGlass]: ['car_glass', 'car_glass', 'car_glass'],
  [Block.Tire]: ['tire', 'tire', 'tire'],
};

/** Tile index for a block face (face: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z). */
export function tileOf(b: Block, face: number): number {
  const f = FACES[b];
  if (!f) return TILE_INDEX.get('stone')!;
  return TILE_INDEX.get(face === 2 ? f[0] : face === 3 ? f[2] : f[1])!;
}

/** Tiles that get their colour from the texture alone (portals are tinted per block instead). */
export const PORTAL_TINT: Partial<Record<Block, number>> = {
  [Block.PortalFuture]: 0x4fe3ff, [Block.PortalSpace]: 0xffc86b, [Block.PortalHome]: 0x8ff0a4,
};

let atlas: THREE.DataTexture | null = null;

function paintTile(data: Uint8Array, i: number, paint: Painter) {
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
}

/** Repaints the 내 방 photo-block tiles in the live atlas (the GPU copy updates on the next frame). */
export function setPhotoTiles(colors: number[]) {
  PHOTO_BLOCKS.forEach((_, i) => { photoColors[i] = colors[i] ?? PHOTO_DEFAULT[i]; });
  if (!atlas) return; // painted with these colours when it's first built
  const data = atlas.image.data as Uint8Array;
  PHOTO_BLOCKS.forEach((_, i) => paintTile(data, TILE_INDEX.get(`photo_${i}`)!, photoTile(i)));
  atlas.needsUpdate = true;
}

/** The block atlas, painted once. Tiles are inset by half a texel in UVs to avoid bleeding. */
export function blockAtlas(): THREE.DataTexture {
  if (atlas) return atlas;
  const data = new Uint8Array(ATLAS * ATLAS * 4);
  TILES.forEach(([, paint], i) => paintTile(data, i, paint));
  if (TILES.length > COLS * COLS) throw new Error('block atlas is full');
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
