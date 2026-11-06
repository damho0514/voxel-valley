import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

const STICK = 120;

/** Left thumb stick: reports a -1..1 vector (x right, y forward). */
export function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const [knob, setKnobState] = useState({ x: 0, y: 0 });
  const setKnob = (x: number, y: number) => setKnobState({ x, y });
  const pan = usePanGesture({
    minDistance: 0,
    runOnJS: true,
    onUpdate: (e) => {
      let dx = e.x - STICK / 2, dy = e.y - STICK / 2;
      const len = Math.hypot(dx, dy), max = STICK / 2;
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      onMove(dx / max, -dy / max);
      setKnob(dx, dy);
    },
    onFinalize: () => {
      onMove(0, 0);
      setKnob(0, 0);
    },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={styles.stick} testID="joystick">
        <View style={[styles.knob, { transform: [{ translateX: knob.x }, { translateY: knob.y }] }]} pointerEvents="none" />
      </View>
    </GestureDetector>
  );
}

const TAP_SLOP = 12; // px a finger may wander and still count as a tap/hold
const HOLD_MS = 260;

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
  stick: {
    position: 'absolute', left: 36, bottom: 30, width: STICK, height: STICK, borderRadius: STICK / 2,
    backgroundColor: 'rgba(20,30,40,0.25)', alignItems: 'center', justifyContent: 'center',
  },
  knob: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.75)' },
  button: {
    position: 'absolute', width: 74, height: 74, borderRadius: 37, alignItems: 'center', justifyContent: 'center',
    opacity: 0.82,
  },
  buttonText: { color: 'white', fontSize: 17, fontWeight: '700' },
});
