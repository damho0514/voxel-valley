import React, { useState } from 'react';
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

/** Drag anywhere on this area to look around. */
export function LookPad({ onLook, style }: { onLook: (dx: number, dy: number) => void; style: ViewStyle }) {
  const pan = usePanGesture({
    minDistance: 0,
    runOnJS: true,
    onUpdate: (e) => onLook(e.changeX, e.changeY),
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
