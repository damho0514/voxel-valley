import type { RefObject } from 'react';

/*
 * Keyboard + mouse controls (computer browsers). The real implementation is desktop.web.ts;
 * this is the app (iOS/Android) build, where play is touch-only, so it does nothing.
 */

/** What the keyboard and mouse can ask the play screen to do. */
export type DesktopActions = {
  /** Mouse movement while the pointer is locked, in screen pixels. */
  look: (dx: number, dy: number) => void;
  /** AirPods head aiming (head.web.ts): extra turn in radians, + = left / up. */
  turn: (yaw: number, pitch: number) => void;
  /** WASD: x = strafe right, y = forward, each -1..1. (Arrow keys turn the view through `turn`.) */
  move: (x: number, y: number) => void;
  jump: (held: boolean) => void;
  /** Sink while flying (Ctrl · C). */
  down: (held: boolean) => void;
  /** On the ground: Alt walks slowly and silently; Ctrl · C crouch. */
  stance: (walk: boolean, crouch: boolean, sprint?: boolean) => void;
  /** Left button held / released. */
  primary: (held: boolean) => void;
  /** Right button pressed. */
  secondary: () => void;
  /** Shift pressed: place the selected block at the crosshair, whatever tool is in hand. */
  place: () => void;
  /**
   * ⌘ (Mac) / Ctrl (Windows) + Shift: break the block at the crosshair at once, whatever tool is in
   * hand. Called on the press, then again every BREAK_REPEAT ms while both stay down.
   */
  breakNow: () => void;
  /** Hotbar step (AirPods / headset double and triple press). The scroll wheel turns the view instead. */
  wheel: (dir: 1 | -1) => void;
  /**
   * Number keys 1–5 (0-based), laid out like a PC shooter's weapon slots:
   * 1 main weapon · 2 secondary · 3 melee · 4 gear · 5 bomb. PlayScreen decides what each holds.
   */
  slot: (i: number) => void;
  key: (k: DesktopKey) => void;
  /** Tab held: the scoreboard (who's here). */
  board: (held: boolean) => void;
  /**
   * Headphone / media-key buttons (AirPods stem or force sensor, Bluetooth headsets, keyboard media
   * keys): 'press' = play/pause, 'next' = double press, 'prev' = triple press.
   */
  media: (kind: 'press' | 'next' | 'prev') => void;
  /** Any input at all (keeps the frame rate up). */
  poke: () => void;
};
export type DesktopKey =
  | 'carpet' | 'view' | 'dragon' | 'shop' | 'help' | 'clear' | 'cast'
  /** Q: back to the previous weapon. */
  | 'prev'
  /** R: reload — the wand's marks are cleared for a fresh stroke. */
  | 'reload'
  /** [ and ]: mouse speed down / up a step. */
  | 'sensDown' | 'sensUp';

export type DesktopState = {
  /** The mouse is captured and turns the view. */
  locked: boolean;
  /** The mouse has been captured at least once (so the card says "continue", not "play"). */
  wasLocked: boolean;
  /** Capture the mouse (call from a click). */
  requestLock: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useDesktopControls(_enabled: boolean, _actions: RefObject<DesktopActions>, _blocked: boolean): DesktopState {
  return { locked: false, wasLocked: false, requestLock: () => {} };
}
