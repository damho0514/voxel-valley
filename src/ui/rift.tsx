import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

/*
 * The 꿀알바 rift: dig deep enough and space-time swallows you. Rings of violet and teal spin and
 * shrink into the centre while the screen goes dark (the world is swapped at the darkest point,
 * RIFT_SWAP ms in), then the darkness lifts on the night street.
 */
export const RIFT_SWAP = 1300;
const TOTAL = 2500;
const RINGS = [0, 1, 2, 3, 4, 5];
const COLORS = ['#8c6cff', '#5ff2ff', '#ff6fd8', '#8c6cff', '#5ff2ff', '#ffd36a'];

export function RiftVortex({ size }: { size: { width: number; height: number } }) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const a = Animated.timing(t, { toValue: 1, duration: TOTAL, easing: Easing.linear, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [t]);
  const swap = RIFT_SWAP / TOTAL;
  const dark = t.interpolate({ inputRange: [0, swap * 0.6, swap, swap + 0.12, 1], outputRange: [0, 0.55, 1, 0.9, 0] });
  const d = Math.hypot(size.width, size.height) * 1.1;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#05030f', opacity: dark }]} />
      {RINGS.map((i) => {
        // Each ring starts big and offset in time, spins faster and faster, and is sucked to a point.
        const k = i / RINGS.length;
        const scale = t.interpolate({ inputRange: [0, swap, 1], outputRange: [1.2 - k * 0.15, 0.02 + k * 0.02, 0.01], extrapolate: 'clamp' });
        const spin = t.interpolate({ inputRange: [0, swap, 1], outputRange: ['0deg', `${(i % 2 ? -1 : 1) * (540 + i * 90)}deg`, `${(i % 2 ? -1 : 1) * (720 + i * 90)}deg`] });
        const fade = t.interpolate({ inputRange: [0, 0.08, swap, swap + 0.1, 1], outputRange: [0, 0.85, 0.9, 0, 0] });
        return (
          <Animated.View key={i} style={[styles.ring, {
            width: d * (1 - k * 0.12), height: d * (1 - k * 0.12), borderRadius: d,
            borderColor: COLORS[i], borderWidth: 10 + i * 4, borderStyle: i % 2 ? 'dashed' : 'solid',
            opacity: fade, transform: [{ scale }, { rotate: spin }],
          }]} />
        );
      })}
      <Animated.View style={[styles.core, {
        opacity: t.interpolate({ inputRange: [0, swap * 0.7, swap, swap + 0.15, 1], outputRange: [0, 0.9, 1, 0, 0] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, swap, 1], outputRange: [0.2, 2.2, 0.2] }) }],
      }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ring: { position: 'absolute' },
  core: { position: 'absolute', width: 60, height: 60, borderRadius: 30, backgroundColor: '#e8dcff' },
});
