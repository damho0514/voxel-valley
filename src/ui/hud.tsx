import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

/*
 * The play screen's buttons, in one visual language: deep navy glass with a thin gold rim,
 * warm gold for the main action. Also a tiny store so fast-changing numbers (how many blocks are
 * marked) re-render only the button that shows them, not the whole play screen.
 */

export const THEME = {
  glass: 'rgba(12,18,34,0.62)',
  glassHi: 'rgba(22,32,58,0.78)',
  rim: 'rgba(232,194,106,0.85)',
  rimSoft: 'rgba(232,194,106,0.35)',
  gold: '#f2c35b',
  goldDeep: '#b9801f',
  ink: '#fff6dc',
  inkSoft: 'rgba(255,246,220,0.72)',
};

/** A value that components can subscribe to without re-rendering their parent. */
export function makeStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  return {
    get: () => value,
    set(v: T) {
      if (v === value) return;
      value = v;
      subs.forEach((f) => f(v));
    },
    subscribe(f: (v: T) => void) {
      subs.add(f);
      return () => { subs.delete(f); };
    },
  };
}
export type Store<T> = ReturnType<typeof makeStore<T>>;

export function useStore<T>(store: Store<T>): T {
  const [v, setV] = useState(store.get());
  useEffect(() => store.subscribe(setV), [store]);
  return v;
}

/** Small glass pill for the top bar. */
export function Pill({ label, onPress, accent, testID }: { label: string; onPress: () => void; accent?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} hitSlop={6}
      style={({ pressed }) => [styles.pill, accent && styles.pillAccent, pressed && { transform: [{ scale: 0.95 }] }]}>
      <Text style={[styles.pillText, accent && { color: '#2a1b00' }]}>{label}</Text>
    </Pressable>
  );
}

/** A round button that reports press and release (works alongside other touches). */
export function RoundButton({ label, sub, size, style, onDown, onUp, tone = 'glass', testID }: {
  label: string; sub?: string; size: number; style?: ViewStyle; onDown?: () => void; onUp?: () => void;
  tone?: 'glass' | 'gold' | 'danger'; testID?: string;
}) {
  const [held, setHeld] = useState(false);
  const pan = usePanGesture({
    minDistance: 0,
    runOnJS: true,
    onBegin: () => { setHeld(true); onDown?.(); },
    onFinalize: () => { setHeld(false); onUp?.(); },
  });
  return (
    <GestureDetector gesture={pan}>
      <View testID={testID} style={[styles.round, { width: size, height: size, borderRadius: size / 2 },
        tone === 'gold' ? styles.roundGold : tone === 'danger' ? styles.roundDanger : null,
        held && { transform: [{ scale: 0.92 }] }, style]}>
        <Text style={[styles.roundLabel, { fontSize: size * 0.3 }, tone === 'gold' && { color: '#2a1b00' }]}>{label}</Text>
        {sub ? <Text style={[styles.roundSub, tone === 'gold' && { color: '#4a3200' }]}>{sub}</Text> : null}
      </View>
    </GestureDetector>
  );
}

/**
 * The 💥 cast button. Dim when nothing is marked; once blocks glow it lights up, pulses and shows
 * how many are ready (and how full the energy is).
 */
export function CastButton({ store, onCast, onClear, visible, style }: {
  store: Store<{ count: number; cap: number }>; onCast: () => void; onClear: () => void; visible: boolean; style?: ViewStyle;
}) {
  const { count, cap } = useStore(store);
  const ready = count > 0;
  const [pulse] = useState(() => new Animated.Value(0));
  const loop = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    loop.current?.stop();
    if (!ready) { pulse.setValue(0); return; }
    loop.current = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 520, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    loop.current.start();
    return () => loop.current?.stop();
  }, [ready, pulse]);
  const fill = cap > 0 ? Math.min(1, count / cap) : 0;
  // Shown while drawing, and whenever something is marked (so marks are never stranded).
  if (!visible && !ready) return null;
  return (
    <View style={[styles.castWrap, style]} pointerEvents="box-none">
      {ready && (
        <Animated.View pointerEvents="none" style={[styles.castHalo, {
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }],
        }]} />
      )}
      <RoundButton testID="cast" label="💥" sub={ready ? `부수기 ${count}` : '부수기'} size={104} tone={ready ? 'gold' : 'glass'} onDown={onCast} />
      {ready && (
        <Pressable testID="clear" onPress={onClear} hitSlop={8} style={styles.clear}>
          <Text style={styles.clearText}>✕</Text>
        </Pressable>
      )}
      {ready && cap > 0 && (
        <View pointerEvents="none" style={styles.energy}>
          <View style={[styles.energyFill, { width: `${fill * 100}%`, backgroundColor: fill >= 1 ? '#ff8a5b' : THEME.gold }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 12, backgroundColor: THEME.glass,
    borderWidth: 1, borderColor: THEME.rimSoft,
  },
  pillAccent: { backgroundColor: 'rgba(242,195,91,0.94)', borderColor: '#fff0c4' },
  pillText: { color: THEME.ink, fontWeight: '800', fontSize: 14, letterSpacing: 0.2 },
  round: {
    position: 'absolute', alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.glass,
    borderWidth: 1.5, borderColor: THEME.rimSoft,
  },
  roundGold: { backgroundColor: 'rgba(242,195,91,0.95)', borderColor: '#fff3cf', borderWidth: 2 },
  roundDanger: { backgroundColor: 'rgba(80,28,36,0.7)', borderColor: 'rgba(255,150,150,0.5)' },
  roundLabel: { color: THEME.ink, fontWeight: '900' },
  roundSub: { color: THEME.inkSoft, fontSize: 12, fontWeight: '800', marginTop: -2 },
  castWrap: { position: 'absolute', width: 104, height: 104, alignItems: 'center', justifyContent: 'center' },
  castHalo: { position: 'absolute', width: 124, height: 124, borderRadius: 62, backgroundColor: 'rgba(255,200,90,0.55)' },
  clear: { position: 'absolute', top: -8, left: -8, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: THEME.glassHi, borderWidth: 1, borderColor: THEME.rimSoft },
  clearText: { color: THEME.ink, fontSize: 15, fontWeight: '900' },
  energy: { position: 'absolute', bottom: -10, width: 74, height: 6, borderRadius: 3, backgroundColor: 'rgba(12,18,34,0.7)', overflow: 'hidden' },
  energyFill: { height: '100%', borderRadius: 3 },
});
