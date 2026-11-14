/*
 * Release smoke test (headless Chromium, real GPU). Fails (exit 1) on any page error, console
 * error, or broken screen. Used by tools/release/release.sh; can be run by hand.
 *
 *   node tools/release/smoke.mjs dev  http://localhost:8160/                       <outdir>
 *   node tools/release/smoke.mjs prod http://localhost:8161/voxel-valley/play/      <outdir>
 *
 * dev: the Metro dev build, which exposes globalThis.__vvGame / __vvView, so it can also visit
 *      every dimension, switch to third person and check the camera never ends up inside a block.
 * prod: the exported web build exactly as it will be published (title screen → play).
 *
 * Playwright comes from $PW_DIR (default ~/.damho-tools/pw), kept outside the repo.
 */
import os from 'node:os';
import fs from 'node:fs';

const [mode, url, out = '.'] = process.argv.slice(2);
if (!['dev', 'prod'].includes(mode) || !url) {
  console.error('usage: smoke.mjs dev|prod <url> [outdir]');
  process.exit(2);
}
const PW = process.env.PW_DIR || `${os.homedir()}/.damho-tools/pw`;
const { chromium } = await import(`${PW}/node_modules/playwright/index.mjs`);
fs.mkdirSync(out, { recursive: true });

const problems = [];
const fail = (msg) => { problems.push(msg); console.log(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

const browser = await chromium.launch({ args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => fail(`page error: ${e.message.slice(0, 200)}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // Network noise that isn't the game's fault (the multiplayer server, fonts) is reported, not failed.
  if (/net::ERR_|Failed to load resource|WebSocket/i.test(t)) { console.log(`  · console: ${t.slice(0, 160)}`); return; }
  fail(`console error: ${t.slice(0, 200)}`);
});
const shot = (name) => page.screenshot({ path: `${out}/${mode}-${name}.png` });

try {
  // ── Title screen: only the character, its level, the name and 입장.
  await page.goto(url, { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(9000);
  await page.mouse.click(420, 200).catch(() => {}); // past the intro (or the "tap to start" gate)
  await page.waitForTimeout(1500);
  for (const id of ['hero', 'level', 'name', 'start']) {
    if (await page.getByTestId(id).count()) ok(`title shows ${id}`);
    else fail(`title is missing ${id}`);
  }
  if (await page.locator('[data-testid^="season-"]').count()) fail('title still shows seasons');
  await shot('title');

  // ── Into the game.
  await page.getByTestId('start').tap();
  await page.waitForTimeout(15000);
  const hud = await page.evaluate(() => ({
    canvas: [...document.querySelectorAll('canvas')].some((c) => c.width > 100 && c.height > 100),
    hud: !!document.querySelector('[data-testid="menu"]') && !!document.querySelector('[data-testid="action"], [data-testid="view"]'),
  }));
  if (hud.canvas) ok('game canvas is up'); else fail('no game canvas');
  if (hud.hud) ok('HUD is up'); else fail('HUD missing');
  await shot('play');

  if (mode === 'dev') {
    const hasGame = await page.evaluate(() => !!globalThis.__vvGame);
    if (!hasGame) fail('dev build does not expose __vvGame');
    else {
      // Third person, so the camera checks mean something: hold the action button, slide to 🎥.
      const cdp = await ctx.newCDPSession(page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
      const box = await page.getByTestId('action').boundingBox();
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      await touch('touchStart', cx, cy);
      await page.waitForTimeout(450);
      const item = await page.evaluate(() => {
        const e = document.querySelector('[data-testid="dial-view"]');
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: e.textContent };
      });
      if (!item) fail('action ring did not open');
      else if (item.text.includes('3인칭')) {
        for (let k = 1; k <= 8; k++) { await touch('touchMove', cx + ((item.x - cx) * k) / 8, cy + ((item.y - cy) * k) / 8); await page.waitForTimeout(30); }
        await page.waitForTimeout(150);
      }
      await touch('touchEnd');
      await page.waitForTimeout(1200);
      const third = await page.evaluate(() => !!globalThis.__vvGame.viewOrigin);
      if (third) ok('third person via the action ring'); else fail('could not switch to third person via the action ring');
      for (const dim of ['valley', 'future', 'space', 'store', 'maze', 'parking']) {
        const r = await page.evaluate((dim) => {
          const g = globalThis.__vvGame;
          try { g.enterDimension(dim); } catch (e) { return { err: String(e) }; }
          return { dim: g.dim };
        }, dim);
        if (r.err) { fail(`${dim}: enterDimension threw ${r.err}`); continue; }
        await page.waitForTimeout(4500);
        // Walk a few steps in a circle, checking the camera stays out of the walls.
        const cam = await page.evaluate(async () => {
          const g = globalThis.__vvGame, v = globalThis.__vvView;
          let inside = 0, samples = 0;
          for (let k = 0; k < 12; k++) {
            g.yaw = (k / 12) * Math.PI * 2;
            await new Promise((r) => setTimeout(r, 120));
            const c = v?.camera?.position;
            if (!c) continue;
            samples++;
            if (g.world.isSolid(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z))) inside++;
          }
          return { dim: g.dim, y: g.body.y, inside, samples };
        });
        if (cam.dim !== dim) fail(`${dim}: ended up in ${cam.dim}`);
        else if (!Number.isFinite(cam.y)) fail(`${dim}: player position broke`);
        else if (cam.samples && cam.inside) fail(`${dim}: camera inside a block in ${cam.inside}/${cam.samples} views`);
        else ok(`${dim}: entered, camera clear (${cam.samples} views)`);
        await shot(dim);
      }
    }
  }
} catch (e) {
  fail(`smoke crashed: ${e.message}`);
}
await browser.close();
if (problems.length) {
  console.log(`SMOKE ${mode}: FAILED (${problems.length})`);
  process.exit(1);
}
console.log(`SMOKE ${mode}: PASSED`);
