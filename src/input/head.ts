import type { RefObject } from 'react';
import type { DesktopActions } from './desktop';
import { HEAD_OFF, HeadState } from './headTypes';

export type { HeadState } from './headTypes';

/*
 * AirPods head aiming (computer browsers). The real implementation is head.web.ts, which talks to
 * the Mac menu-bar bridge in tools/airpods-bridge; this is the app (iOS/Android) build: nothing.
 */


// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useHeadAim(_active: boolean, _actions: RefObject<DesktopActions | null>): HeadState {
  return HEAD_OFF;
}
