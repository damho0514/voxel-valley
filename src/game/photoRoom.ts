import { Block, BLOCKS, PHOTO_BLOCKS } from './blocks';

/*
 * 내 방 사진 → 게임 속 방.
 *
 * `analyzePhoto` reads a small RGBA image (a photo or screenshot, ~192px) and pulls out what makes
 * it feel the way it does: a 12-colour palette (k-means), which colours sit where (ceiling at the
 * top, walls in the middle, floor at the bottom), the accent colours, brightness, warmth and
 * colourfulness, plus a block mosaic of the whole picture.
 *
 * `designRoom` turns that into a furnished voxel room in front of the player: walls, floor and
 * ceiling in the photo's colours, the photo itself as a block mural on the far wall, furniture in
 * its accent colours, windows if it was bright or had sky, lamps if it was dark. Pure functions:
 * no rendering, no storage.
 */

export type PhotoLook = {
  /** 12 colours (0xRRGGBB), most common first. Photo block i is painted palette[i]. */
  palette: number[];
  /** Share of the picture each palette colour covers (0..1). */
  share: number[];
  /** Palette indices chosen for each part of the room. */
  wall: number;
  floor: number;
  ceiling: number;
  accent: number;
  accent2: number;
  brightness: number; // 0..1
  saturation: number; // 0..1
  warmth: number; // about -1 (blue) .. 1 (orange)
  /** Share of leafy green, and of sky-blue in the top part. */
  green: number;
  sky: number;
  tags: string[];
  title: string;
  /** The fun bit: a 감성 점수 out of 100 and a rank. */
  score: number;
  rank: 'S' | 'A' | 'B';
  /** The far-wall mural: palette indices, row 0 at the top. */
  mural: { cols: number; rows: number; cells: number[] };
  /** A pixel preview for the submit animation: average colours, row 0 at the top. */
  pixels: { cols: number; rows: number; colors: number[] };
  aspect: number;
};

type V3 = [number, number, number];
const toHex = (c: V3) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
const fromHex = (h: number): V3 => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const luma = (c: V3) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
/** Perceptual-ish distance ("redmean"), cheap enough for k-means on a few thousand points. */
function dist2(a: V3, b: V3) {
  const rm = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}
export function hsv(c: V3): { h: number; s: number; v: number } {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}

export const MURAL = { cols: 15, rows: 7 };
const K = PHOTO_BLOCKS.length;

/** Average colour of the image over a rectangle given in 0..1 image coordinates. */
function boxAverage(rgba: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): V3 {
  const ax = Math.max(0, Math.floor(x0 * w)), bx = Math.min(w, Math.max(ax + 1, Math.ceil(x1 * w)));
  const ay = Math.max(0, Math.floor(y0 * h)), by = Math.min(h, Math.max(ay + 1, Math.ceil(y1 * h)));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = ay; y < by; y++)
    for (let x = ax; x < bx; x++) {
      const o = (y * w + x) * 4;
      r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; n++;
    }
  return n ? [r / n, g / n, b / n] : [128, 128, 128];
}

export function analyzePhoto(rgba: Uint8Array, w: number, h: number): PhotoLook {
  // Sample on a grid of about 72 × 54.
  const step = Math.max(1, Math.round(Math.max(w, h) / 72));
  const pts: V3[] = [], rowOf: number[] = [];
  for (let y = Math.floor(step / 2); y < h; y += step)
    for (let x = Math.floor(step / 2); x < w; x += step) {
      const o = (y * w + x) * 4;
      pts.push([rgba[o], rgba[o + 1], rgba[o + 2]]);
      rowOf.push(y / h);
    }
  const n = pts.length;

  // k-means, seeded at evenly spaced brightness quantiles so the same photo gives the same palette.
  const byLuma = pts.map((p, i) => [luma(p), i] as [number, number]).sort((a, b) => a[0] - b[0]);
  let cent: V3[] = Array.from({ length: K }, (_, k) => [...pts[byLuma[Math.min(n - 1, Math.floor(((k + 0.5) / K) * n))][1]]] as V3);
  const label = new Int32Array(n);
  for (let it = 0; it < 10; it++) {
    const sum = Array.from({ length: K }, () => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { const d = dist2(pts[i], cent[k]); if (d < bd) { bd = d; best = k; } }
      label[i] = best;
      const s = sum[best]; s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; s[3]++;
    }
    cent = cent.map((c, k) => {
      const s = sum[k];
      if (s[3]) return [s[0] / s[3], s[1] / s[3], s[2] / s[3]] as V3;
      // Empty cluster: restart it on the point worst served by its centre.
      let far = 0, fd = -1;
      for (let i = 0; i < n; i++) { const d = dist2(pts[i], cent[label[i]]); if (d > fd) { fd = d; far = i; } }
      return [...pts[far]] as V3;
    });
  }
  const counts = new Array(K).fill(0);
  for (let i = 0; i < n; i++) counts[label[i]]++;
  // Most common first; relabel to match.
  const order = counts.map((c, k) => [c, k]).sort((a, b) => b[0] - a[0]).map(([, k]) => k);
  const remap = new Int32Array(K);
  order.forEach((k, i) => { remap[k] = i; });
  // Lift the very darkest colours a touch, so a dim photo still makes a room you can see in.
  const colors: V3[] = order.map((k) => {
    const c = cent[k], l = luma(c);
    const lift = l < 0.12 ? 0.12 - l : 0;
    return c.map((v) => Math.min(255, v + lift * 255)) as V3;
  });
  const share = order.map((k) => counts[k] / n);
  for (let i = 0; i < n; i++) label[i] = remap[label[i]];

  // Where each colour sits: top quarter = ceiling, middle = walls, bottom third = floor.
  const region = (lo: number, hi: number) => {
    const c = new Array(K).fill(0);
    for (let i = 0; i < n; i++) if (rowOf[i] >= lo && rowOf[i] < hi) c[label[i]]++;
    return c.map((v, k) => [v, k]).sort((a, b) => b[0] - a[0]).map(([, k]) => k);
  };
  const top = region(0, 0.25), mid = region(0.25, 0.68), bot = region(0.68, 1.01);
  const wall = mid[0];
  const floor = bot[0] !== wall ? bot[0] : bot[1] ?? wall;
  const ceiling = top[0];
  // Accents: colourful and not tiny, other than the wall and floor.
  const hs = colors.map(hsv);
  const pop = colors.map((_, k) => (k === wall || k === floor ? -1 : hs[k].s * hs[k].v * Math.sqrt(share[k] + 0.01)));
  const accOrder = pop.map((p, k) => [p, k]).sort((a, b) => b[0] - a[0]).map(([, k]) => k);
  const accent = accOrder[0], accent2 = accOrder[1];

  // Overall mood.
  let lum = 0, sat = 0, warm = 0, green = 0, sky = 0, skyN = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = hsv(p);
    lum += luma(p);
    sat += q.s;
    warm += (p[0] - p[2]) / 255;
    if (q.h > 70 && q.h < 170 && q.s > 0.25 && q.v > 0.2) green++;
    if (rowOf[i] < 0.45) { skyN++; if (q.h > 185 && q.h < 235 && q.s > 0.15 && q.v > 0.55) sky++; }
  }
  const brightness = lum / n, saturation = sat / n, warmth = warm / n;
  green /= n;
  sky = skyN ? sky / skyN : 0;

  const tags: string[] = [];
  const mood = brightness > 0.6 ? '화사한' : brightness < 0.33 ? '아늑한 밤의' : '포근한';
  tags.push(brightness > 0.6 ? '☀️ 화사함' : brightness < 0.33 ? '🌙 아늑함' : '🕯️ 포근함');
  if (warmth > 0.07) tags.push('🪵 웜톤');
  else if (warmth < -0.05) tags.push('🧊 쿨톤');
  if (saturation > 0.42) tags.push('🎨 컬러풀');
  else if (saturation < 0.16) tags.push('🤍 미니멀');
  if (green > 0.1) tags.push('🌿 초록 식물');
  if (sky > 0.12) tags.push('🪟 탁 트인 창');
  const kind = green > 0.1 ? '정원 같은 방'
    : sky > 0.12 ? '창가 라운지'
    : brightness < 0.33 ? '시네마 룸'
    : warmth > 0.07 ? '원목 거실'
    : warmth < -0.05 ? '모던 스튜디오'
    : saturation > 0.42 ? '팝아트 방' : '나만의 방';
  const title = `${mood} ${kind}`;

  // 감성 점수: colour variety + contrast, always flattering (it's a game).
  let spread = 0, pairs = 0;
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) { spread += Math.sqrt(dist2(colors[a], colors[b])); pairs++; }
  spread /= pairs * 600;
  const lumVar = Math.sqrt(pts.reduce((s, p) => s + (luma(p) - brightness) ** 2, 0) / n);
  const score = Math.max(72, Math.min(99, Math.round(70 + spread * 22 + lumVar * 40 + saturation * 10)));
  const rank = score >= 92 ? 'S' : score >= 84 ? 'A' : 'B';

  // The mural: crop the middle of the picture to the wall's shape, one block per cell.
  const aspect = w / h, wallAspect = MURAL.cols / MURAL.rows;
  const cw = aspect > wallAspect ? wallAspect / aspect : 1, ch = aspect > wallAspect ? 1 : aspect / wallAspect;
  const cx0 = (1 - cw) / 2, cy0 = (1 - ch) / 2;
  const cells: number[] = [];
  for (let r = 0; r < MURAL.rows; r++)
    for (let c = 0; c < MURAL.cols; c++) {
      const avg = boxAverage(rgba, w, h, cx0 + (c / MURAL.cols) * cw, cy0 + (r / MURAL.rows) * ch, cx0 + ((c + 1) / MURAL.cols) * cw, cy0 + ((r + 1) / MURAL.rows) * ch);
      let best = 0, bd = Infinity;
      colors.forEach((p, k) => { const d = dist2(avg, p); if (d < bd) { bd = d; best = k; } });
      cells.push(best);
    }

  // Pixel preview for the animation (keeps the photo's own shape).
  const pc = aspect >= 1 ? 18 : Math.max(6, Math.round(18 * aspect));
  const pr = aspect >= 1 ? Math.max(6, Math.round(18 / aspect)) : 18;
  const pixColors: number[] = [];
  for (let r = 0; r < pr; r++)
    for (let c = 0; c < pc; c++) pixColors.push(toHex(boxAverage(rgba, w, h, c / pc, r / pr, (c + 1) / pc, (r + 1) / pr)));

  return {
    palette: colors.map(toHex), share, wall, floor, ceiling, accent, accent2,
    brightness, saturation, warmth, green, sky, tags, title, score, rank,
    mural: { cols: MURAL.cols, rows: MURAL.rows, cells },
    pixels: { cols: pc, rows: pr, colors: pixColors },
    aspect,
  };
}

// ── The room ────────────────────────────────────────────────────────────────

/**
 * Room layout in local coordinates: u to the player's right, v straight ahead, h up from the floor
 * the player stands on. Inside is u -7..7, v 3..15, h 0..6; walls at u ±8, v 2 (front, with the
 * door) and v 16 (the mural); floor at h -1, ceiling at h 7.
 */
export const ROOM = { half: 8, front: 2, back: 16, height: 7 };

export type RoomCell = { u: number; v: number; h: number; b: Block; t: number };
export type RoomFrame = { u: number; v: number; h: number; w: number; hgt: number };

const P = (i: number) => PHOTO_BLOCKS[i];

/**
 * Every block of the room with the time (seconds) it appears in the build animation:
 * clear the space and lay the floor from the door outward, raise the walls row by row, close the
 * ceiling, paint the mural across the far wall, then pop in the furniture and switch on the lamps.
 */
export function designRoom(look: PhotoLook): { cells: RoomCell[]; frame: RoomFrame; duration: number } {
  const { half: X, front: F, back: B, height: H } = ROOM;
  const cells = new Map<string, RoomCell>();
  const put = (u: number, v: number, h: number, b: Block, t: number) => cells.set(`${u},${v},${h}`, { u, v, h, b, t });
  const jitter = (u: number, v: number, h: number) => (Math.abs(Math.sin(u * 12.9898 + v * 78.233 + h * 37.719) * 43758.5453) % 1) * 0.08;

  const wallB = P(look.wall), floorB = P(look.floor), ceilB = P(look.ceiling), acc = P(look.accent), acc2 = P(look.accent2);
  const bright = look.brightness > 0.5 || look.sky > 0.12;
  const dark = look.brightness < 0.33;

  // 1) Clear the inside (instant) and lay the floor, rippling out from the door. Porch outside the door.
  for (let u = -X; u <= X; u++)
    for (let v = F; v <= B; v++) {
      const d = Math.hypot(u, v - F);
      put(u, v, -1, floorB, 0.05 + d * 0.045 + jitter(u, v, -1));
      for (let h = 0; h < H; h++) put(u, v, h, Block.Air, 0);
    }
  for (let u = -2; u <= 2; u++)
    for (let v = 0; v < F; v++) {
      put(u, v, -1, Block.Plank, 0.05 + Math.abs(u) * 0.04);
      if (Math.abs(u) <= 1) for (let h = 0; h < 4; h++) put(u, v, h, Block.Air, 0);
    }
  const floorEnd = 0.05 + Math.hypot(X, B - F) * 0.045 + 0.1;

  // 2) Walls rise row by row (the far wall goes up plain, the mural is painted on later).
  const wallStart = floorEnd;
  for (let h = 0; h < H; h++) {
    const t = wallStart + h * 0.16;
    for (let v = F; v <= B; v++) { put(-X, v, h, wallB, t + jitter(-X, v, h)); put(X, v, h, wallB, t + jitter(X, v, h)); }
    for (let u = -X + 1; u < X; u++) {
      const door = Math.abs(u) <= 1 && h <= 2;
      if (!door) put(u, F, h, wallB, t + jitter(u, F, h));
      put(u, B, h, wallB, t + jitter(u, B, h));
    }
  }
  // Wooden corner posts and a lintel over the door.
  for (let h = 0; h < H; h++) for (const [u, v] of [[-X, F], [X, F], [-X, B], [X, B]]) put(u, v, h, Block.Wood, wallStart + h * 0.16);
  for (let u = -2; u <= 2; u++) put(u, F, 3, Block.Wood, wallStart + 3 * 0.16 + 0.05);
  // Windows: on the right wall (and beside the door) when the photo was bright or had sky; glow strips if it was dark.
  const windows: [number, number, number][] = [];
  if (bright) {
    for (const v0 of [5, 11]) for (let v = v0; v <= v0 + 2; v++) for (let h = 2; h <= 3; h++) windows.push([X, v, h]);
    for (const u0 of [-5, 4]) for (let u = u0; u <= u0 + 1; u++) for (let h = 2; h <= 3; h++) windows.push([u, F, h]);
  }
  const wallEnd = wallStart + H * 0.16 + 0.1;
  for (const [u, v, h] of windows) put(u, v, h, look.sky > 0.12 ? Block.GlassSky : Block.Glass, wallEnd + 0.1 + jitter(u, v, h));

  // 3) The ceiling closes from the edges in, with lamps (more of them, warmer, if it was dark) and a skylight if bright.
  const ceilStart = wallEnd + 0.1;
  for (let u = -X; u <= X; u++)
    for (let v = F; v <= B; v++) {
      const edge = Math.min(X - Math.abs(u), v - F, B - v);
      put(u, v, H, ceilB, ceilStart + edge * 0.07 + jitter(u, v, H));
    }
  const ceilEnd = ceilStart + 8 * 0.07 + 0.1;
  const lamps = dark ? [[-4, 5], [4, 5], [-4, 9], [4, 9], [-4, 13], [4, 13], [0, 9]] : [[-4, 6], [4, 6], [-4, 12], [4, 12]];
  if (bright && !dark) for (let u = -1; u <= 1; u++) for (let v = 8; v <= 10; v++) put(u, v, H, Block.Glass, ceilEnd + 1.7);

  // 4) The mural: the far wall repainted cell by cell in a diagonal sweep — the photo, in blocks.
  const muralStart = ceilEnd + 0.1;
  const { cols, rows, cells: mural } = look.mural;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const u = -7 + c, h = rows - 1 - r; // row 0 (top of the photo) at the top of the wall
      put(u, B, h, P(mural[r * cols + c]), muralStart + (c + r) * 0.045);
    }
  const muralEnd = muralStart + (cols + rows) * 0.045 + 0.15;

  // 5) Furniture pops in, one piece at a time.
  let t = muralEnd;
  const piece = (blocks: [number, number, number, Block][]) => {
    for (const [u, v, h, b] of blocks) put(u, v, h, b, t + h * 0.04);
    t += 0.22;
  };
  // Rug in the middle (in the floor, accent 2).
  piece(Array.from({ length: 35 }, (_, i) => [-3 + (i % 7), 7 + Math.floor(i / 7), -1, acc2] as [number, number, number, Block]));
  // Sofa against the left wall, under the photo frame: seat + back + arms in the accent colour.
  const sofa: [number, number, number, Block][] = [];
  for (let v = 8; v <= 10; v++) { sofa.push([-7, v, 0, acc], [-6, v, 0, acc], [-7, v, 1, acc]); }
  for (const v of [7, 11]) sofa.push([-7, v, 0, Block.Wood], [-6, v, 0, Block.Wood], [-7, v, 1, Block.Wood]);
  piece(sofa);
  // Coffee table on the rug.
  piece([[-3, 9, 0, Block.Wood], [-3, 8, 0, Block.Plank], [-3, 10, 0, Block.Plank]]);
  // Bed in the front-right corner: wooden headboard, a white pillow, a blanket in the accent colour.
  const bed: [number, number, number, Block][] = [];
  for (let u = 5; u <= 7; u++) {
    bed.push([u, 3, 0, Block.Wood], [u, 3, 1, Block.Wood], [u, 4, 0, Block.Snow]);
    for (let v = 5; v <= 7; v++) bed.push([u, v, 0, acc]);
  }
  piece(bed);
  // Bookshelf on the right wall between the windows, in wood with coloured book spines from the palette.
  const shelf: [number, number, number, Block][] = [];
  for (let h = 0; h <= 3; h++) shelf.push([7, 9, h, h % 2 === 0 ? Block.Wood : P((look.accent + h + 2) % 12)]);
  piece(shelf);
  // Plants in the far corners (bigger ones if the photo was green), and a floor lamp by the sofa.
  const tall = look.green > 0.1 ? 3 : 2;
  const plants: [number, number, number, Block][] = [];
  for (const u of [-7, 7]) {
    plants.push([u, 15, 0, Block.Clay]);
    for (let h = 1; h <= tall; h++) plants.push([u, 15, h, Block.Leaf]);
  }
  piece(plants);
  piece([[-7, 13, 0, Block.Metal], [-7, 13, 1, Block.Metal], [-7, 13, 2, Block.WindowLit]]);
  // 6) Lights on: ceiling lamps, then sconces either side of the door.
  t += 0.15;
  for (const [u, v] of lamps) put(u, v, H, Block.WindowLit, t);
  t += 0.2;
  for (const u of [-3, 3]) put(u, F + 0, 3, dark ? Block.WindowLit : Block.Wood, t);
  for (const u of [-3, 3]) put(u, F, 2, dark ? Block.WindowLit : wallB, t);

  // The real photo hangs on the left wall above the sofa, facing into the room.
  const maxW = 5.2, maxH = 3;
  let fw = maxH * look.aspect, fh = maxH;
  if (fw > maxW) { fw = maxW; fh = maxW / look.aspect; }
  const frame: RoomFrame = { u: -X + 0.5, v: 9, h: 4, w: fw, hgt: fh };

  const list = [...cells.values()].sort((a, b) => a.t - b.t);
  return { cells: list, frame, duration: t + 0.3 };
}

// ── Rooms shared with other players ─────────────────────────────────────────

/** Blocks every server knows: in a shared room the photo colours map to the nearest of these. */
const STANDARD: Block[] = [
  Block.Moss, Block.Soil, Block.Stone, Block.Sand, Block.Wood, Block.Leaf, Block.Plank, Block.Clay,
  Block.Blossom, Block.Maple, Block.Snow, Block.DryGrass, Block.Metal, Block.Asphalt, Block.RoadLine,
  Block.Window, Block.Station, Block.Asteroid, Block.Ash,
];
export function nearestStandard(hex: number): Block {
  const c = fromHex(hex);
  let best = Block.Stone, bd = Infinity;
  for (const b of STANDARD) {
    const s = BLOCKS[b].side;
    const d = dist2(c, [s[0] * 255, s[1] * 255, s[2] * 255]);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** Local room coordinates → world cells, for a player at cell (ox, fy, oz) looking along `yaw`. */
export function roomToWorld(yaw: number, ox: number, fy: number, oz: number) {
  // Snap to the nearest of the four directions. Forward is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw).
  const q = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  const fwd = [[0, -1], [-1, 0], [0, 1], [1, 0]][q], right = [[1, 0], [0, -1], [-1, 0], [0, 1]][q];
  return {
    cell: (u: number, v: number, h: number) => ({ x: ox + right[0] * u + fwd[0] * v, y: fy + h, z: oz + right[1] * u + fwd[1] * v }),
    /** A point in local space (cell centres at integer u, v) → world space. */
    point: (u: number, v: number, h: number) => ({ x: ox + 0.5 + right[0] * u + fwd[0] * v, y: fy + h, z: oz + 0.5 + right[1] * u + fwd[1] * v }),
    right: { x: right[0], z: right[1] },
    yaw: (q * Math.PI) / 2,
  };
}
