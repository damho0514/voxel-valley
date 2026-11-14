import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

const STICK = 120;

/**
 * Floating thumb stick: put your thumb down anywhere in the left zone and the stick centres there
 * (no hunting for a fixed pad). Reports a -1..1 vector (x right, y forward), and `run` while the
 * thumb is pushed out past the rim (the knob turns gold).
 */
export function Joystick({ onMove, side = 'left' }: { onMove: (x: number, y: number, run: boolean) => void; side?: 'left' | 'right' }) {
  const [stick, setStick] = useState<{ cx: number; cy: number; x: number; y: number; run?: boolean } | null>(null);
  const center = useRef({ x: 0, y: 0 });
  const pan = usePanGesture({
    minDistance: 0,
    runOnJS: true,
    onBegin: (e) => {
      center.current = { x: e.x, y: e.y };
      setStick({ cx: e.x, cy: e.y, x: 0, y: 0 });
    },
    onUpdate: (e) => {
      let dx = e.x - center.current.x, dy = e.y - center.current.y;
      const len = Math.hypot(dx, dy), max = STICK / 2;
      const run = len > max * 1.15;
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      // A small dead zone, then full speed is reached a bit before the rim.
      const k = len < 6 ? 0 : 1 / (max * 0.85);
      onMove(Math.max(-1, Math.min(1, dx * k)), Math.max(-1, Math.min(1, -dy * k)), run);
      setStick({ cx: center.current.x, cy: center.current.y, x: dx, y: dy, run });
    },
    onFinalize: () => {
      onMove(0, 0, false);
      setStick(null);
    },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={side === 'left' ? styles.stickZone : styles.stickZoneRight} testID={side === 'left' ? 'joystick' : 'lookstick'}>
        {stick ? (
          <View pointerEvents="none" style={[styles.stick, { left: stick.cx - STICK / 2, top: stick.cy - STICK / 2 }]}>
            <View style={[styles.knob, stick.run && styles.knobRun, { transform: [{ translateX: stick.x }, { translateY: stick.y }] }]} />
          </View>
        ) : (
          <View pointerEvents="none" style={[styles.stick, side === 'left' ? styles.stickIdle : styles.stickIdleRight]}>
            <View style={styles.knob} />
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

const TAP_SLOP = 12; // px a finger may wander and still count as a tap/hold
const HOLD_MS = 220;

/**
 * The play area. Drag to look around; tap a block to place onto it; press and hold a block
 * to dig it (move the held finger to dig the next one). Positions are absolute screen points.
 * With `onDraw` set (the drawing tool), a finger draws instead: begin / move / end.
 */
export function TouchPad({ onLook, onTap, onHold, onDraw, style }: {
  onLook: (dx: number, dy: number) => void;
  onTap: (x: number, y: number) => void;
  onHold: (pos: { x: number; y: number } | null) => void;
  onDraw?: ((phase: 'begin' | 'move' | 'end', x: number, y: number) => void) | null;
  style: ViewStyle;
}) {
  const t = useRef({ startX: 0, startY: 0, x: 0, y: 0, at: 0, mode: 'pending' as 'pending' | 'look' | 'hold' | 'draw', timer: null as ReturnType<typeof setTimeout> | null });
  const drawRef = useRef(onDraw);
  useEffect(() => { drawRef.current = onDraw; }, [onDraw]);
  const pan = usePanGesture({
    minDistance: 0,
    runOnJS: true,
    onBegin: (e) => {
      const s = t.current;
      if (drawRef.current) {
        Object.assign(s, { x: e.absoluteX, y: e.absoluteY, mode: 'draw' });
        drawRef.current('begin', e.absoluteX, e.absoluteY);
        return;
      }
      Object.assign(s, { startX: e.absoluteX, startY: e.absoluteY, x: e.absoluteX, y: e.absoluteY, at: Date.now(), mode: 'pending' });
      if (s.timer) clearTimeout(s.timer);
      s.timer = setTimeout(() => {
        if (s.mode !== 'pending') return;
        s.mode = 'hold';
        onHold({ x: s.x, y: s.y });
      }, HOLD_MS);
    },
    onUpdate: (e) => {
      const s = t.current;
      s.x = e.absoluteX;
      s.y = e.absoluteY;
      if (s.mode === 'draw') { drawRef.current?.('move', s.x, s.y); return; }
      if (s.mode === 'pending' && Math.hypot(s.x - s.startX, s.y - s.startY) > TAP_SLOP) {
        s.mode = 'look';
        if (s.timer) clearTimeout(s.timer);
      }
      if (s.mode === 'look') onLook(e.changeX, e.changeY);
      else if (s.mode === 'hold') onHold({ x: s.x, y: s.y });
    },
    onFinalize: () => {
      const s = t.current;
      if (s.mode === 'draw') {
        // Even if the tool was switched mid-stroke, finish the stroke that began.
        drawRef.current?.('end', s.x, s.y);
        s.mode = 'pending';
        return;
      }
      if (s.timer) clearTimeout(s.timer);
      if (s.mode === 'pending' && Date.now() - s.at < HOLD_MS + 40) onTap(s.x, s.y);
      if (s.mode === 'hold') onHold(null);
      s.mode = 'pending';
    },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={style} testID="lookpad" />
    </GestureDetector>
  );
}

/** A round button that reports press/release (works alongside other touches). */
export function HoldButton({ label, color, onChange, style }: {
  label: string; color: string; onChange: (held: boolean) => void; style?: ViewStyle;
}) {
  const [held, setHeld] = useState(false);
  const pan = usePanGesture({
    minDistance: 0,
    runOnJS: true,
    onBegin: () => { onChange(true); setHeld(true); },
    onFinalize: () => { onChange(false); setHeld(false); },
  });
  return (
    <GestureDetector gesture={pan}>
      <View testID={`btn-${label}`} style={[styles.button, { backgroundColor: color, opacity: held ? 1 : 0.82 }, style]}>
        <Text style={styles.buttonText}>{label}</Text>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  stickZone: { position: 'absolute', left: 0, bottom: 0, width: '36%', height: '64%' }, // the whole lower-left: put a thumb down anywhere
  stick: {
    position: 'absolute', width: STICK, height: STICK, borderRadius: STICK / 2,
    backgroundColor: 'rgba(12,18,34,0.32)', borderWidth: 1.5, borderColor: 'rgba(232,194,106,0.35)', alignItems: 'center', justifyContent: 'center',
  },
  stickIdle: { left: 40, bottom: 34, opacity: 0.6 },
  // The look stick sits above the jump button on the right.
  stickZoneRight: { position: 'absolute', right: 0, bottom: 122, width: '22%', height: '36%' }, // just above the jump button
  stickIdleRight: { right: 30, bottom: 6, opacity: 0.45 },
  knob: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,246,220,0.82)', borderWidth: 2, borderColor: 'rgba(242,195,91,0.9)' },
  knobRun: { backgroundColor: 'rgba(242,195,91,0.95)', borderColor: '#fff3cf' },
  button: {
    position: 'absolute', width: 74, height: 74, borderRadius: 37, alignItems: 'center', justifyContent: 'center',
    opacity: 0.82,
  },
  buttonText: { color: 'white', fontSize: 17, fontWeight: '700' },
});
