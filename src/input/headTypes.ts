/** Shared by head.ts (app stub) and head.web.ts, so neither imports the other. */

export type HeadState = {
  /** The bridge app is running and the page is connected to it. */
  bridge: boolean;
  /** AirPods are worn and sending motion. */
  connected: boolean;
  /** What the Mac calls them (its current audio output), e.g. "담호의 AirPods". */
  name: string | null;
  /** Head aiming is switched on (K toggles). */
  on: boolean;
  /** The Mac refused motion access (System Settings › Privacy › Motion & Fitness). */
  denied: boolean;
  /** Which earbud's sensor moves the cursor: 'left' · 'right' · 'both' (null until known). */
  bud: 'left' | 'right' | 'both' | null;
  /** The Mac's sound goes to a Bluetooth device: with the name, tells AirPods from the speakers. */
  bluetooth: boolean;
  /** The last AirPods button press the game received, for a moment (shown as "클릭 · 휠 ↓ · 휠 ↑"). */
  button: 'press' | 'next' | 'prev' | null;
};

/** Fired on window by desktop.web.ts for each headphone button press (detail: 'press' | 'next' | 'prev'). */
export const BUTTON_EVENT = 'vv-airpods-button';

export const HEAD_OFF: HeadState = { bridge: false, connected: false, name: null, on: false, denied: false, bud: null, bluetooth: false, button: null };
