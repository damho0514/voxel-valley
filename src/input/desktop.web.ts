import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopActions, DesktopKey, DesktopState } from './desktop';
import { BUTTON_EVENT } from './headTypes';

export type { DesktopActions, DesktopKey, DesktopState } from './desktop';

/*
 * Keyboard + mouse for computer browsers, laid out like a Korean PC shooter's defaults
 * (Nexon's 서든어택 guide, https://guide.sa.nexon.com/guide/25): WASD, Shift walk, Ctrl crouch,
 * 1–5 weapon slots, Q previous weapon, R reload, Tab scoreboard, [ ] mouse speed, F special.
 *
 *   mouse            look (pointer lock: click the game to capture, Esc to let go)
 *   arrows           look, for playing without a mouse
 *   W A S D          walk · fly        Space · Enter  jump / rise (press again in mid-air: double jump)
 *   Shift            the tool's action: swing the blade (the default), flick the wand, or place
 *                    the selected block (only while a block slot is picked)
 *   ⌘ + Shift (Mac) · Ctrl + Shift (Windows)   hold: break the block at the crosshair (any tool)
 *   Alt              walk (slow, no footsteps)
 *   Ctrl · C         crouch · sink while flying
 *   Esc              let the mouse go (the "continue" card)
 *   ⌘ + Enter (Mac) · Ctrl + Enter (Windows)   window ↔ fullscreen, only when pressed together
 *   left button      wand: hold and sweep to mark blocks · block: dig · blade: strike
 *   right button     wand: 💥 break the marked blocks · block: place
 *   1 wand  2 blocks (again: next block)  3 blade  4 🐉 dragon  5 💥
 *   trackpad two-finger swipe · scroll wheel   turn the view (never changes weapon)
 *   Q  previous weapon   R  reload (clear marks)   Tab  who's here (hold)   [ ]  mouse speed
 *   F  magic carpet      V · F5  1st / 3rd person  B  shop   G  dragon   X  clear marks
 *   H · F1  help
 *   AirPods / headset buttons (needs the game's music playing, so the browser routes them here):
 *   press 💥 / strike / place · double press next weapon · triple press previous weapon
 *
 * Mouse movement arrives as raw pixel deltas (no OS acceleration where the browser allows it),
 * and the play screen turns a fixed angle per pixel, so it feels right without a settings screen.
 */

const KEYS: Record<string, DesktopKey> = {
  // Shop is B (buy), not E: E sits right next to W/D and opened the shop mid-fight.
  KeyF: 'carpet', KeyV: 'view', F5: 'view', KeyG: 'dragon', KeyB: 'shop', KeyH: 'help', F1: 'help', KeyX: 'clear',
  KeyQ: 'prev', KeyR: 'reload', BracketLeft: 'sensDown', BracketRight: 'sensUp',
};
const SHIFT = ['ShiftLeft', 'ShiftRight'];
/** The "command" key for the break / fullscreen combos: ⌘ on a Mac, Ctrl elsewhere. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const CMD = IS_MAC ? ['MetaLeft', 'MetaRight'] : ['ControlLeft', 'ControlRight'];
const cmdHeld = (e: KeyboardEvent) => (IS_MAC ? e.metaKey : e.ctrlKey);
const ALT = ['AltLeft', 'AltRight'];
/** ⌘/Ctrl + Shift held: one more block broken this often (ms) after the first, instant one. */
const BREAK_REPEAT = 200;
/** Two-finger trackpad swipe / scroll wheel: radians of turn per pixel scrolled. */
const SCROLL_TURN = 0.004;
const JUMP = ['Space', 'Enter', 'NumpadEnter'];
/** Arrow keys turn the view (radians per second), so the game plays without a mouse. */
const TURN_YAW = 2.4, TURN_PITCH = 1.5;
/** Window ↔ fullscreen choice, kept between visits. */
const FULL_KEY = 'vv-fullscreen';
const setWantsFull = (on: boolean) => { try { localStorage.setItem(FULL_KEY, on ? '1' : '0'); } catch {} };
type FullDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
const fullEl = () => document.fullscreenElement ?? (document as FullDoc).webkitFullscreenElement ?? null;
const enterFull = () => {
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    const r = root.requestFullscreen?.({ navigationUI: 'hide' });
    if (r) r.catch(() => {});
    else root.webkitRequestFullscreen?.();
  } catch {}
};
const exitFull = () => {
  try {
    const r = document.exitFullscreen?.();
    if (r) r.catch(() => {});
    else (document as FullDoc).webkitExitFullscreen?.();
  } catch {}
};
/**
 * Keys the page takes over in fullscreen (Keyboard Lock, Chrome/Edge), so browser shortcuts that
 * share a game key can't fire: Ctrl+W/T/N/Q/R/D/S/F/P while crouching, Tab, Alt (Windows menu bar),
 * F1/F3/F5/F7. Escape too, like a PC game: a press opens the "continue" card and fullscreen stays
 * (the browser still leaves fullscreen when Esc is held down). ⌘/Ctrl/Alt + Enter switches to a window.
 */
const LOCK_KEYS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`),
  ...'0123456789'.split('').map((d) => `Digit${d}`),
  'Escape', 'Space', 'Tab', 'Enter', 'NumpadEnter', 'Backspace', 'BracketLeft', 'BracketRight', 'Backquote', 'Minus', 'Equal',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8',
];
/** Keys never taken from the browser, even mid-game. */
const PASS = new Set(['Escape', 'F11', 'F12']);
const CROUCH = ['ControlLeft', 'ControlRight', 'KeyC'];
/** Keys the browser would otherwise act on (scroll, reload, help, focus). */
const SWALLOW = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F1', 'F5']);

export function useDesktopControls(enabled: boolean, actions: RefObject<DesktopActions>, blocked: boolean): DesktopState {
  const [locked, setLocked] = useState(false);
  const [wasLocked, setWasLocked] = useState(false);
  /**
   * Some browsers refuse pointer lock (in-app browsers, embedded frames). Then the mouse still
   * turns the view as it moves ("soft lock", cursor visible) until Esc.
   */
  const soft = useRef(false);
  const [, bump] = useState(0);
  const setSoft = useCallback((on: boolean) => {
    soft.current = on;
    setLocked(on || !!document.pointerLockElement);
    if (on) setWasLocked(true);
    bump((n) => n + 1);
  }, []);

  const requestLock = useCallback(() => {
    // A HUD button clicked earlier keeps focus, and Space / Enter would "press" it again mid-game.
    (document.activeElement as HTMLElement | null)?.blur?.();
    // Fullscreen is part of playing: the game fills the screen and (Chrome/Edge) gets every key.
    // Ignored where the browser refuses (in-app browsers): the game still plays in the window.
    // Fullscreen is no longer entered by clicking: only ⌘ + Enter / Ctrl + Enter switches it.
    const el = document.body as HTMLElement & { requestPointerLock?: (o?: { unadjustedMovement?: boolean }) => Promise<void> | void };
    const fallback = () => { if (!document.pointerLockElement) setSoft(true); };
    const plain = () => {
      try {
        const r = el.requestPointerLock?.();
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(fallback);
        else if (!el.requestPointerLock) fallback();
      } catch { fallback(); }
    };
    try {
      // Raw mouse movement (no OS acceleration) where supported; plain lock otherwise.
      const r = el.requestPointerLock?.({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(plain);
      else if (!el.requestPointerLock) fallback();
    } catch { plain(); }
    // Browsers that neither lock nor report an error: fall back after a moment.
    setTimeout(fallback, 400);
  }, [setSoft]);

  // Menus and the shop need the cursor back.
  useEffect(() => {
    if (!blocked) return;
    if (document.pointerLockElement) document.exitPointerLock();
    if (soft.current) setSoft(false);
  }, [blocked, setSoft]);

  // Headphone buttons (AirPods, Bluetooth headsets, media keys) arrive as media-session actions
  // while the page's music plays. On phones' browsers too, so this isn't tied to `enabled`.
  useEffect(() => {
    const media = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    const mediaActions: [MediaSessionAction, 'press' | 'next' | 'prev'][] = [
      ['play', 'press'], ['pause', 'press'], ['nexttrack', 'next'], ['previoustrack', 'prev'],
    ];
    const setMedia = (on: boolean) => {
      if (!media) return;
      for (const [action, kind] of mediaActions) {
        try {
          media.setActionHandler(action, on ? () => {
            actions.current?.poke();
            actions.current?.media(kind);
            media.playbackState = 'playing';
            window.dispatchEvent(new CustomEvent(BUTTON_EVENT, { detail: kind }));
          } : null);
        } catch {}
      }
      if (on && typeof MediaMetadata !== 'undefined') {
        try { media.metadata = new MediaMetadata({ title: 'Voxel Valley', artist: '이어폰 버튼: 1번 💥 · 2번 다음 무기 · 3번 이전 무기' }); } catch {}
      }
    };
    setMedia(true);
    return () => setMedia(false);
  }, [actions]);

  useEffect(() => {
    if (!enabled) return;
    const a = () => actions.current!;
    const held = new Set<string>();
    let mouseDown = false;
    let breakTimer: ReturnType<typeof setInterval> | null = null;
    const attack = () => a().primary(mouseDown);
    // Arrow keys: turn the view a little every frame while held.
    let turnFrame = 0, turnAt = 0;
    const turning = () => ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].some((k) => held.has(k));
    const turnStep = (now: number) => {
      if (!turning()) { turnFrame = 0; return; }
      const dt = Math.min(0.05, (now - turnAt) / 1000);
      turnAt = now;
      const yaw = (held.has('ArrowLeft') ? 1 : 0) - (held.has('ArrowRight') ? 1 : 0);
      const pitch = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0);
      if (dt > 0) a().turn(yaw * TURN_YAW * dt, pitch * TURN_PITCH * dt);
      turnFrame = requestAnimationFrame(turnStep);
    };
    const applyMove = () => {
      const f = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
      const r = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
      const len = Math.hypot(f, r) || 1;
      a().move(r / len, f / len);
      a().jump(JUMP.some((k) => held.has(k)));
      // ⌘/Ctrl + Shift breaks at once (on Windows that Ctrl doesn't also crouch).
      const breaking = SHIFT.some((k) => held.has(k)) && CMD.some((k) => held.has(k));
      if (breaking && !breakTimer) {
        a().breakNow();
        breakTimer = setInterval(() => a().breakNow(), BREAK_REPEAT);
      } else if (!breaking && breakTimer) { clearInterval(breakTimer); breakTimer = null; }
      const walk = ALT.some((k) => held.has(k)), crouch = CROUCH.some((k) => held.has(k)) && !breaking;
      a().down(crouch);
      a().stance(walk, crouch);
      attack();
      if (turning() && !turnFrame) { turnAt = performance.now(); turnFrame = requestAnimationFrame(turnStep); }
    };
    const releaseAll = () => {
      held.clear();
      mouseDown = false;
      applyMove();
      a().primary(false);
      a().board(false);
    };
    /** Set while ⌘/Ctrl/Alt + Enter leaves fullscreen, so play carries on in the window. */
    let toWindow = false;
    const toggleFull = () => {
      if (fullEl()) { setWantsFull(false); toWindow = true; exitFull(); }
      else { setWantsFull(true); enterFull(); }
    };
    const isLocked = () => !!document.pointerLockElement || soft.current;
    const typing = (e: Event) => (e.target as HTMLElement | null)?.tagName === 'INPUT';

    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e)) return;
      // Window ↔ fullscreen only for ⌘ + Enter (Mac) / Ctrl + Enter (Windows) pressed together.
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && cmdHeld(e) && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) toggleFull();
        return;
      }
      if (e.code === 'Escape') {
        // A pause, not a quit: the mouse is let go and the "continue" card shows; fullscreen stays
        // where the browser allows it (Chrome/Edge keyboard lock).
        if (soft.current) setSoft(false);
        if (document.pointerLockElement) document.exitPointerLock();
        releaseAll();
        return;
      }
      if (SWALLOW.has(e.code)) e.preventDefault();
      // Mid-game every key is the game's: no Ctrl+S save, Ctrl+D bookmark, Ctrl+F find, Alt menu,
      // Space scrolling or "clicking" a focused button. (Ctrl+W / Ctrl+T can only be stopped in
      // fullscreen: see the keyboard lock below.)
      if (isLocked() && !PASS.has(e.code)) e.preventDefault();
      a().poke();
      // (Re-added on key repeat too: a Mac drops key-ups while ⌘ is held, see onKeyUp.)
      held.add(e.code);
      if (e.repeat) return;
      // Shift on its own: the tool in hand's action (PlayScreen place()); with ⌘/Ctrl it breaks (applyMove).
      if (SHIFT.includes(e.code) && !cmdHeld(e)) a().place();
      applyMove();
      if (e.code === 'Tab') a().board(true);
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) a().slot(Number(digit[1]) - 1);
      const k = KEYS[e.code];
      if (k) a().key(k);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      held.delete(e.code);
      // macOS sends no key-up for keys released while ⌘ was down, so letting go of ⌘ drops every
      // non-modifier key; anything still held comes back with its next key repeat.
      if (IS_MAC && (e.code === 'MetaLeft' || e.code === 'MetaRight')) {
        for (const k of [...held]) if (!/^(Shift|Control|Alt|Meta)/.test(k)) held.delete(k);
      }
      applyMove();
      if (e.code === 'Tab') a().board(false);
    };
    // Fullscreen (F11 / the browser's fullscreen): Chrome and Edge let a page take every key,
    // so holding Ctrl to crouch and pressing W walks instead of closing the tab.
    type KeyboardLock = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void };
    const kb = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
    const onFullscreen = () => {
      if (fullEl()) kb?.lock?.(LOCK_KEYS).catch(() => {});
      else {
        kb?.unlock?.();
        // ⌘/Ctrl/Alt + Enter: keep playing in the window. Leaving any other way (Esc held, the
        // browser's own button) leaves the game too: the "continue" card comes back.
        if (toWindow) { toWindow = false; return; }
        if (document.pointerLockElement) document.exitPointerLock();
        if (soft.current) { setSoft(false); releaseAll(); }
      }
    };
    if (fullEl()) onFullscreen();
    const onMouseMove = (e: MouseEvent) => {
      if (!isLocked()) return;
      // Some browsers report a huge jump right as the lock engages; ignore those.
      const dx = Math.max(-250, Math.min(250, e.movementX)), dy = Math.max(-250, Math.min(250, e.movementY));
      if (dx || dy) a().look(dx, dy);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!isLocked()) return;
      e.preventDefault();
      a().poke();
      if (e.button === 0) { mouseDown = true; attack(); }
      else if (e.button === 2) a().secondary();
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) { mouseDown = false; attack(); }
    };
    // Trackpad (two-finger swipe) or scroll wheel only turns the view; weapons are on 1–5 / Q.
    // Not passive, so a sideways swipe can't also send the browser back a page.
    const onWheel = (e: WheelEvent) => {
      if (!isLocked()) return;
      e.preventDefault();
      if (e.ctrlKey) return; // pinch
      const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = Math.max(-120, Math.min(120, e.deltaX * px)), dy = Math.max(-120, Math.min(120, e.deltaY * px));
      if (dx || dy) { a().poke(); a().turn(dx * SCROLL_TURN, dy * SCROLL_TURN); }
    };
    const onContext = (e: MouseEvent) => { if (isLocked()) e.preventDefault(); };
    const onLockChange = () => {
      if (document.pointerLockElement) soft.current = false;
      const l = isLocked();
      setLocked(l);
      if (l) setWasLocked(true);
      if (!l) releaseAll();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('contextmenu', onContext);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('webkitfullscreenchange', onFullscreen);
      if (turnFrame) cancelAnimationFrame(turnFrame);
      if (breakTimer) clearInterval(breakTimer);
      kb?.unlock?.();
      releaseAll();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('wheel', onWheel);
      document.removeEventListener('contextmenu', onContext);
      document.removeEventListener('pointerlockchange', onLockChange);
      if (document.pointerLockElement) document.exitPointerLock();
      soft.current = false;
    };
  }, [enabled, actions, setSoft]);

  return { locked: enabled && locked, wasLocked, requestLock };
}
