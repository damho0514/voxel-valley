/*
 * Which control scheme the play screen shows.
 *
 *   'touch'   — joystick, on-screen buttons, draw with a finger (the phone app, phones and tablets in a browser)
 *   'desktop' — keyboard + mouse with pointer lock (a computer's browser)
 *
 * This file is the app (iOS/Android) version: always touch. The browser version is device.web.ts,
 * which Metro picks for the web build, so each side can change without touching the other.
 */
export type InputDevice = 'touch' | 'desktop';

export function useInputDevice(): InputDevice {
  return 'touch';
}
