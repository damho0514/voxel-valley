import { useEffect, useState } from 'react';
import type { InputDevice } from './device';

export type { InputDevice } from './device';

/*
 * Browser version: start from what the main pointer is (a mouse → desktop, a finger → touch),
 * then follow what the player actually uses. A touch switches to touch controls at once; mouse
 * movement or a key press switches back to desktop — except right after a touch, because
 * phones send fake mouse events after every tap.
 */
function initial(): InputDevice {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  const mq = (q: string) => window.matchMedia(q).matches;
  // Phones and tablets: a coarse main pointer, a mobile browser, or touch without hover (iPad in
  // "desktop site" mode reports a Mac but has touch points and no hover).
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const touchOnly = navigator.maxTouchPoints > 0 && !mq('(hover: hover)');
  if (mq('(pointer: coarse)') || mobileUA || touchOnly) return 'touch';
  return 'desktop';
}

export function useInputDevice(): InputDevice {
  const [device, setDevice] = useState<InputDevice>(initial);
  useEffect(() => {
    let lastTouch = 0, travel = 0, since = 0;
    const onTouch = () => { lastTouch = Date.now(); travel = 0; setDevice('touch'); };
    const onMouse = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastTouch < 2000) return;
      // A real mouse or trackpad: steady movement (60 px within a second), not a stray event.
      if (now - since > 1000) { since = now; travel = 0; }
      travel += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (travel > 60) setDevice('desktop');
    };
    const onKey = (e: KeyboardEvent) => {
      if (Date.now() - lastTouch < 2000) return;
      // Typing into a field (room code, name) doesn't count.
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (/^(Key[WASD]|Arrow|Space)/.test(e.code)) setDevice('desktop');
    };
    window.addEventListener('touchstart', onTouch, { passive: true });
    window.addEventListener('mousemove', onMouse);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('touchstart', onTouch);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return device;
}
