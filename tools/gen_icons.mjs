// Generates the app icons from scratch (original artwork, no third-party images).
//
//   node tools/gen_icons.mjs                      # writes the SVG sources to tools/icons/
//   PLAYWRIGHT=/path/to/node_modules/playwright node tools/gen_icons.mjs   # also renders assets/*.png
//
// Design: three pastel rounded voxels (mint, peach, sky glass) with a lavender one on top,
// sitting in a dawn valley. Everything below is plain geometry.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'tools/icons');
mkdirSync(out, { recursive: true });

const PALETTE = {
  mint: ['#c4f7e2', '#86dcb9', '#5fc49f'],
  peach: ['#ffdcbc', '#f7ae84', '#e38e66'],
  sky: ['#dcf1ff', '#a5d5f6', '#7cbbe8'],
  lavender: ['#ebe2ff', '#bfaaf4', '#a18ae4'],
};

/** Isometric cube faces for grid cell (gx, gy, gz), size s, origin (ox, oy). */
function cube(gx, gy, gz, s, ox, oy, [top, left, right], mono) {
  const k = 0.866 * s;
  const cx = ox + (gx - gz) * k;
  const cy = oy + (gx + gz) * 0.5 * s - gy * s;
  const pts = (a) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const T = [[cx, cy - s / 2], [cx + k, cy], [cx, cy + s / 2], [cx - k, cy]];
  const L = [[cx - k, cy], [cx, cy + s / 2], [cx, cy + 1.5 * s], [cx - k, cy + s]];
  const R = [[cx + k, cy], [cx, cy + s / 2], [cx, cy + 1.5 * s], [cx + k, cy + s]];
  const w = s * 0.07;
  const face = (p, c) => `<polygon points="${pts(p)}" fill="${c}" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"/>`;
  if (mono) return face(T, '#fff') + face(L, '#fff') + face(R, '#fff');
  // A soft highlight along the top face's front edges.
  const hi = `<polyline points="${pts([[cx - k * 0.78, cy + s * 0.05], [cx, cy + s * 0.45], [cx + k * 0.78, cy + s * 0.05]])}" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="${s * 0.035}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return face(L, left) + face(R, right) + face(T, top) + hi;
}

/** The voxel stack, centred on (cx, cy) with cube size s. */
function stack(cx, cy, s, mono = false) {
  // Back to front: the base cube, the one on top of it, then the two in front.
  const oy = cy - 0.25 * s;
  return [
    cube(0, 0, 0, s, cx, oy, PALETTE.peach, mono),
    cube(0, 1, 0, s, cx, oy, PALETTE.lavender, mono),
    cube(1, 0, 0, s, cx, oy, PALETTE.sky, mono),
    cube(0, 0, 1, s, cx, oy, PALETTE.mint, mono),
  ].join('');
}

const sky = `
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd2a6"/><stop offset="0.55" stop-color="#f4b9c8"/><stop offset="1" stop-color="#b9a6f0"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fffbea"/><stop offset="0.6" stop-color="#fff1cc" stop-opacity="0.9"/><stop offset="1" stop-color="#fff1cc" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#sky)"/>
  <circle cx="770" cy="250" r="150" fill="url(#sun)"/>
  <path d="M0 700 C 180 600, 330 640, 470 700 S 800 760, 1024 640 L1024 1024 L0 1024 Z" fill="#9ed8c6" opacity="0.85"/>
  <path d="M0 820 C 220 740, 420 800, 600 840 S 900 860, 1024 790 L1024 1024 L0 1024 Z" fill="#6fbfa6"/>
  <path d="M240 150 l10 26 26 10 -26 10 -10 26 -10 -26 -26 -10 26 -10 Z" fill="#ffffff" opacity="0.85"/>
  <path d="M150 300 l6 15 15 6 -15 6 -6 15 -6 -15 -15 -6 15 -6 Z" fill="#ffffff" opacity="0.7"/>`;

const svg = (body, bg = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bg}${body}</svg>`;
const files = {
  // Full-bleed iOS / store icon.
  'icon.svg': svg(stack(512, 560, 190), sky),
  // Android adaptive icon: background layer, a foreground kept inside the 66% safe zone, and a monochrome mask.
  'android-icon-background.svg': svg('', sky),
  'android-icon-foreground.svg': svg(stack(512, 540, 120)),
  'android-icon-monochrome.svg': svg(stack(512, 540, 120, true)),
  // Splash: the voxels alone on a transparent background.
  'splash-icon.svg': svg(stack(512, 540, 170)),
};
for (const [name, text] of Object.entries(files)) writeFileSync(path.join(out, name), text);
console.log('wrote', Object.keys(files).length, 'SVGs to tools/icons/');

if (process.env.PLAYWRIGHT) {
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  const render = async (src, dest, size) => {
    await page.setViewportSize({ width: size, height: size });
    const html = `<html><body style="margin:0;background:transparent">${files[src].replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`;
    await page.setContent(html);
    await page.screenshot({ path: path.join(root, 'assets', dest), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  await render('icon.svg', 'icon.png', 1024);
  await render('icon.svg', 'favicon.png', 48);
  await render('android-icon-background.svg', 'android-icon-background.png', 512);
  await render('android-icon-foreground.svg', 'android-icon-foreground.png', 512);
  await render('android-icon-monochrome.svg', 'android-icon-monochrome.png', 432);
  await render('splash-icon.svg', 'splash-icon.png', 1024);
  await browser.close();
  console.log('rendered PNGs to assets/');
}
