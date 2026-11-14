import { Platform } from 'react-native';

/**
 * True when the browser won't play sound until the user touches the page (autoplay policy). Apps
 * on a phone can always play; on the web a fresh visit usually can't. Errs on the side of "blocked".
 */
export function soundNeedsTap(): boolean {
  if (Platform.OS !== 'web') return false;
  try {
    const nav = navigator as Navigator & {
      getAutoplayPolicy?: (type: string) => string;
      userActivation?: { hasBeenActive: boolean };
    };
    if (nav.userActivation?.hasBeenActive) return false;
    if (nav.getAutoplayPolicy) return nav.getAutoplayPolicy('mediaelement') !== 'allowed';
    // A new AudioContext only starts "running" where autoplay is allowed.
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) return true;
    const ctx = new Ctx();
    const blocked = ctx.state !== 'running';
    ctx.close().catch(() => {});
    return blocked;
  } catch {
    return true;
  }
}
