import { Asset } from 'expo-asset';

/*
 * Game sounds on the web, through the Web Audio API (the web build of the native vv-sfx module).
 *
 * expo-audio plays through <audio> elements, and mobile Safari only lets each element start inside
 * a touch the first time, but breaks, steps and coins come from the game loop, not from a touch,
 * so on the iPhone they stayed silent. One AudioContext, unlocked by the first touch or key, plays
 * decoded buffers from anywhere, overlapping freely and without the <audio> start-up lag.
 */

type Ctx = AudioContext;
let ctx: Ctx | null = null;
const buffers = new Map<string, AudioBuffer>();

function context(): Ctx | null {
  if (ctx) return ctx;
  const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const C = w.AudioContext ?? w.webkitAudioContext;
  if (!C) return null;
  // Safari (iOS 17+): count as media playback, so the ring/silent switch doesn't mute the game.
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
  } catch {}
  ctx = new C();
  // Browsers start the context suspended until the page is touched: resume on every gesture
  // until it's running (iOS also wants a sound started inside that first touch).
  const unlock = () => {
    const c = ctx;
    if (!c) return;
    if (c.state !== 'running') {
      c.resume().catch(() => {});
      try {
        const src = c.createBufferSource();
        src.buffer = c.createBuffer(1, 1, 22050);
        src.connect(c.destination);
        src.start(0);
      } catch {}
    }
  };
  for (const ev of ['pointerdown', 'touchend', 'keydown', 'mousedown']) addEventListener(ev, unlock, { capture: true, passive: true });
  return ctx;
}

export const sfxAvailable = !!context();

/** Fetches and decodes sounds one after another; each becomes playable when it's ready. */
export async function loadSfx(files: Record<string, number>, order: string[]) {
  const c = context();
  if (!c) return;
  for (const name of order) {
    if (buffers.has(name)) continue;
    try {
      const asset = Asset.fromModule(files[name]);
      const res = await fetch(asset.uri);
      const data = await res.arrayBuffer();
      // The callback form also works on older Safari, which has no promise-returning decode.
      const buf = await new Promise<AudioBuffer>((ok, fail) => c.decodeAudioData(data, ok, fail));
      buffers.set(name, buf);
    } catch (e) {
      console.warn('sfx load failed', name, e);
    }
  }
}

/** True if the sound played here; false means "not loaded (yet)" or sound is still locked. */
export function playSfx(name: string, volume: number): boolean {
  const c = ctx;
  const buf = buffers.get(name);
  if (!c || !buf) return false;
  if (c.state !== 'running') {
    // Still unlocking (the touch that caused this sound is being handled): play it as soon as the
    // context runs, unless that takes long, so a page never touched doesn't burst out later.
    const asked = performance.now();
    c.resume().then(() => { if (performance.now() - asked < 250) start(c, buf, volume); }).catch(() => {});
    return true;
  }
  return start(c, buf, volume);
}

function start(c: Ctx, buf: AudioBuffer, volume: number) {
  try {
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(c.destination);
    src.start();
    return true;
  } catch {
    return false;
  }
}
