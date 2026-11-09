import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

const STICK = 120;

/**
 * Floating thumb stick: put your thumb down anywhere in the left zone and the stick centres there
 * (no hunting for a fixed pad). Reports a -1..1 vector (x right, y forward).
 */
export function Joystick({ onMove, side = 'left' }: { onMove: (x: number, y: number) => void; side?: 'left' | 'right' }) {
  const [stick, setStick] = useState<{ cx: number; cy: number; x: number; y: number } | null>(null);
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
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      // A small dead zone, then full speed is reached a bit before the rim.
      const k = len < 6 ? 0 : 1 / (max * 0.85);
      onMove(Math.max(-1, Math.min(1, dx * k)), Math.max(-1, Math.min(1, -dy * k)));
      setStick({ cx: center.current.x, cy: center.current.y, x: dx, y: dy });
    },
    onFinalize: () => {
      onMove(0, 0);
      setStick(null);
    },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={side === 'left' ? styles.stickZone : styles.stickZoneRight} testID={side === 'left' ? 'joystick' : 'lookstick'}>
        {stick ? (
          <View pointerEvents="none" style={[styles.stick, { left: stick.cx - STICK / 2, top: stick.cy - STICK / 2 }]}>
            <View style={[styles.knob, { transform: [{ translateX: stick.x }, { translateY: stick.y }] }]} />
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
 */
export function TouchPad({ onLook, onTap, onHold, style }: {
  onLook: (dx: number, dy: number) => void;
  onTap: (x: number, y: number) => void;
  onHold: (pos: { x: number; y: number } | null) => void;
  style: ViewStyle;
}) {
  const t = useRef({ startX: 0, startY: 0, x: 0, y: 0, at: 0, mode: 'pending' as 'pending' | 'look' | 'hold', timer: null as ReturnType<typeof setTimeout> | null });
  const pan = usePanGesture({
    minDistance: 0,
    runOnJS: true,
    onBegin: (e) => {
      const s = t.current;
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
      if (s.mode === 'pending' && Math.hypot(s.x - s.startX, s.y - s.startY) > TAP_SLOP) {
        s.mode = 'look';
        if (s.timer) clearTimeout(s.timer);
      }
      if (s.mode === 'look') onLook(e.changeX, e.changeY);
      else if (s.mode === 'hold') onHold({ x: s.x, y: s.y });
    },
    onFinalize: () => {
      const s = t.current;
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
  stickZone: { position: 'absolute', left: 0, bottom: 0, width: '38%', height: '72%' },
  stick: {
    position: 'absolute', width: STICK, height: STICK, borderRadius: STICK / 2,
    backgroundColor: 'rgba(20,30,40,0.25)', alignItems: 'center', justifyContent: 'center',
  },
  stickIdle: { left: 36, bottom: 30, opacity: 0.55 },
  // The look stick sits above the jump button on the right.
  stickZoneRight: { position: 'absolute', right: 0, bottom: 128, width: '34%', height: '48%' },
  stickIdleRight: { right: 40, bottom: 20, opacity: 0.45 },
  knob: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.75)' },
  button: {
    position: 'absolute', width: 74, height: 74, borderRadius: 37, alignItems: 'center', justifyContent: 'center',
    opacity: 0.82,
  },
  buttonText: { color: 'white', fontSize: 17, fontWeight: '700' },
});
