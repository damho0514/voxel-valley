import { RefObject, useEffect, useRef, useState } from 'react';
import type { DesktopActions } from './desktop';
// Not './head': on web that resolves back to this file (Metro prefers .web.ts).
import { BUTTON_EVENT, HEAD_OFF, HeadState } from './headTypes';

export type { HeadState } from './headTypes';

/*
 * AirPods as a mouse: browsers can't read the AirPods' head tracking, so the menu-bar app in
 * tools/airpods-bridge (macOS 14+) reads it and streams the head's attitude to
 * ws://127.0.0.1:47800. Here each head movement turns the view like the mouse would:
 *
 *   small turns    the view follows the head, amplified (×2.6 left/right, ×2 up/down), so you can
 *                  look around without turning away from the screen
 *   past ±17°      the view keeps turning (faster the further you look) until you face the screen
 *   K              head aiming on / off (turning it on takes the current head pose as "straight")
 *
 * Without the bridge nothing happens; the page quietly retries now and then.
 */

const URL = 'ws://127.0.0.1:47800';
const GAIN_YAW = 2.6;
const GAIN_PITCH = 2.0;
/** Head angle (rad) where the view starts turning on its own, and how fast past it (rad/s per rad). */
const EDGE = 0.3;
const EDGE_RATE = 3.2;
/** Below this per-sample change (rad) the head is "still": sensor jitter shouldn't shake the view. */
const JITTER = 0.0012;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function useHeadAim(active: boolean, actions: RefObject<DesktopActions | null>): HeadState {
  const [state, setState] = useState<HeadState>(HEAD_OFF);
  const on = useRef(true);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  /** Smoothed pose, the last pose used, and "straight ahead". */
  const pose = useRef<{ yaw: number; pitch: number; last: { yaw: number; pitch: number } | null; center: number | null; t: number }>(
    { yaw: 0, pitch: 0, last: null, center: null, t: 0 });

  useEffect(() => {
    if (typeof WebSocket === 'undefined') return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let wait = 2000;
    let closed = false;
    const recenter = () => { pose.current.last = null; pose.current.center = null; };

    const connect = () => {
      if (closed) return;
      try { ws = new WebSocket(URL); } catch { schedule(); return; }
      ws.onopen = () => { wait = 2000; recenter(); setState((s) => ({ ...s, bridge: true, on: on.current })); };
      ws.onclose = () => { setState((s) => ({ ...HEAD_OFF, button: s.button })); schedule(); };
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        let m: { t?: string; yaw?: number; pitch?: number; connected?: boolean; name?: string; auth?: string; bud?: string; bluetooth?: boolean };
        try { m = JSON.parse(String(e.data)); } catch { return; }
        if (m.t === 's') {
          if (!m.connected) recenter();
          const bud = m.bud === 'left' || m.bud === 'right' || m.bud === 'both' ? m.bud : null;
          setState((s) => ({ ...s, bridge: true, connected: !!m.connected, name: m.name ?? null, on: on.current, denied: m.auth === 'denied', bud, bluetooth: !!m.bluetooth }));
          return;
        }
        if (m.t !== 'm' || typeof m.yaw !== 'number' || typeof m.pitch !== 'number') return;
        const p = pose.current;
        const now = performance.now();
        const dt = p.t ? Math.min(0.1, (now - p.t) / 1000) : 0;
        p.t = now;
        // Light smoothing: AirPods report ~25–60 times a second with a little noise.
        if (p.last === null) { p.yaw = m.yaw; p.pitch = m.pitch; }
        else { p.yaw += wrap(m.yaw - p.yaw) * 0.6; p.pitch += (m.pitch - p.pitch) * 0.6; }
        if (p.last === null || p.center === null) {
          p.last = { yaw: p.yaw, pitch: p.pitch };
          p.center = p.yaw;
          return;
        }
        const dYaw = wrap(p.yaw - p.last.yaw), dPitch = p.pitch - p.last.pitch;
        p.last = { yaw: p.yaw, pitch: p.pitch };
        if (!on.current || !activeRef.current) return;
        let turnYaw = Math.abs(dYaw) > JITTER ? dYaw * GAIN_YAW : 0;
        const turnPitch = Math.abs(dPitch) > JITTER ? dPitch * GAIN_PITCH : 0;
        const off = wrap(p.yaw - p.center);
        if (Math.abs(off) > EDGE) turnYaw += Math.sign(off) * (Math.abs(off) - EDGE) * EDGE_RATE * dt;
        if (turnYaw || turnPitch) actions.current?.turn(turnYaw, turnPitch);
      };
    };
    const schedule = () => {
      if (closed || retry) return;
      retry = setTimeout(() => { retry = null; connect(); }, wait);
      wait = Math.min(15000, wait * 1.5);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyK' || e.repeat || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      on.current = !on.current;
      recenter();
      setState((s) => ({ ...s, on: on.current }));
    };
    // AirPods button presses (from the media keys in desktop.web.ts): show them for a moment, so
    // you can see the game heard the AirPods.
    let flash: ReturnType<typeof setTimeout> | null = null;
    const onButton = (e: Event) => {
      const kind = (e as CustomEvent<HeadState['button']>).detail;
      setState((s) => ({ ...s, button: kind }));
      if (flash) clearTimeout(flash);
      flash = setTimeout(() => setState((s) => ({ ...s, button: null })), 1200);
    };
    window.addEventListener(BUTTON_EVENT, onButton);
    window.addEventListener('keydown', onKey);
    connect();
    return () => {
      closed = true;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(BUTTON_EVENT, onButton);
      if (flash) clearTimeout(flash);
      if (retry) clearTimeout(retry);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, [actions]);

  return state;
}
