import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

/*
 * The reward look, drawn by hand (no emoji, so it's the same on every phone): brass 엽전 coins,
 * red 낙관 seal stamps, 한지 paper slips and the five 오방색 colours. Shared by the money
 * counter, payouts, the 반닫이 chest and the 부적 chips.
 */

/** 오방색 — the five traditional colours, toned to sit with the game's pastels. */
export const OBANG = {
  blue: '#2f6db5', // 청
  red: '#c8392f', // 적
  yellow: '#e9b330', // 황
  white: '#f4ecdc', // 백
  black: '#2a2522', // 흑
};
export const INK = '#2a1d14';
export const HANJI = '#f3e7cf';
export const HANJI_EDGE = '#d9c49c';
export const SEAL = '#c8392f';
export const BRASS = { face: '#d9a53a', rim: '#8a5a12', hi: '#f5d77e', hole: '#3a2508' };

/** 엽전: a brass coin with a raised rim and a square hole. */
export function Yeopjeon({ size = 18, style }: { size?: number; style?: ViewStyle }) {
  const rim = Math.max(1.5, size * 0.1), hole = size * 0.3;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: BRASS.face, borderWidth: rim, borderColor: BRASS.rim,
      alignItems: 'center', justifyContent: 'center' }, style]}>
      {/* the inner ring stamped around the hole */}
      <View style={{ position: 'absolute', width: hole * 1.9, height: hole * 1.9, borderWidth: Math.max(1, size * 0.05), borderColor: BRASS.rim, opacity: 0.45 }} />
      <View style={{ width: hole, height: hole, backgroundColor: BRASS.hole, borderWidth: Math.max(0.5, size * 0.04), borderColor: BRASS.hi }} />
      <View style={{ position: 'absolute', top: size * 0.1, left: size * 0.16, width: size * 0.2, height: size * 0.1, borderRadius: size, backgroundColor: BRASS.hi, opacity: 0.8, transform: [{ rotate: '-35deg' }] }} />
    </View>
  );
}

/**
 * 낙관: a square seal stamp, slightly tilted, with a worn inner border. `text` reads top-to-bottom,
 * right column first when it's 2–4 characters (the way seals are cut), or as one line otherwise.
 */
export function Seal({ text, size = 46, color = SEAL, tilt = -6, style }: { text: string; size?: number; color?: string; tilt?: number; style?: ViewStyle }) {
  const chars = [...text];
  // 2 → one column, 4 → two columns (right first, as seals are cut); 3 reads best as one line.
  const grid = chars.length === 4 ? [[chars[0], chars[1]], [chars[2], chars[3]]] : chars.length === 2 ? [[chars[0], chars[1]]] : null;
  const fs = grid ? size * (chars.length === 2 ? 0.4 : 0.34) : size * (chars.length <= 1 ? 0.62 : chars.length === 3 ? 0.27 : Math.max(0.16, 0.8 / chars.length));
  return (
    <View style={[{ width: size, height: size, borderRadius: size * 0.08, borderWidth: Math.max(2, size * 0.07), borderColor: color,
      backgroundColor: 'rgba(255,248,236,0.9)', padding: size * 0.05, transform: [{ rotate: `${tilt}deg` }] }, style]}>
      <View style={{ flex: 1, borderWidth: Math.max(1, size * 0.025), borderColor: color, opacity: 0.55, position: 'absolute', left: size * 0.09, right: size * 0.09, top: size * 0.09, bottom: size * 0.09 }} />
      <View style={{ flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center' }}>
        {grid ? grid.map((col, i) => (
          <View key={i} style={{ alignItems: 'center' }}>
            {col.map((c, j) => <Text key={j} style={[styles.sealText, { color, fontSize: fs, lineHeight: fs * 1.08 }]}>{c}</Text>)}
          </View>
        )) : <Text style={[styles.sealText, { color, fontSize: fs }]} numberOfLines={1}>{text}</Text>}
      </View>
    </View>
  );
}

/** 한지 띠지: a paper slip with a soft deckled edge (little notches top and bottom). */
export function Hanji({ children, style, tint = HANJI }: { children: React.ReactNode; style?: ViewStyle; tint?: string }) {
  return (
    <View style={[styles.hanji, { backgroundColor: tint }, style]}>
      <View pointerEvents="none" style={[styles.deckle, { top: -3 }]}>
        {Array.from({ length: 14 }, (_, i) => <View key={i} style={[styles.notch, { backgroundColor: tint, height: 3 + (i % 3) }]} />)}
      </View>
      <View pointerEvents="none" style={[styles.deckle, { bottom: -3, alignItems: 'flex-start' }]}>
        {Array.from({ length: 14 }, (_, i) => <View key={i} style={[styles.notch, { backgroundColor: tint, height: 3 + ((i + 1) % 3) }]} />)}
      </View>
      {children}
    </View>
  );
}

/** 복주머니: a lucky pouch in red silk with a gold 복 knot and a drawstring. `open` loosens the neck. */
export function Bokjumeoni({ size = 90, open = 0 }: { size?: number; open?: number }) {
  const w = size, h = size * 1.05;
  return (
    <View style={{ width: w, height: h, alignItems: 'center' }}>
      {/* the neck frill */}
      <View style={{ width: w * (0.42 + open * 0.25), height: h * 0.2, backgroundColor: '#e2574b', borderTopLeftRadius: w * 0.2, borderTopRightRadius: w * 0.2,
        borderWidth: 2, borderColor: '#8f1f19' }} />
      {/* drawstring */}
      <View style={{ width: w * 0.5, height: h * 0.06, backgroundColor: OBANG.yellow, borderRadius: 4, marginTop: -h * 0.02, borderWidth: 1, borderColor: '#9a6a0e' }} />
      {/* body */}
      <View style={{ width: w * 0.9, height: h * 0.66, marginTop: -h * 0.01, backgroundColor: OBANG.red, borderRadius: w * 0.42, borderTopLeftRadius: w * 0.3, borderTopRightRadius: w * 0.3,
        borderWidth: 2.5, borderColor: '#7d1a14', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: w * 0.08, top: h * 0.06, width: w * 0.16, height: h * 0.3, borderRadius: w, backgroundColor: 'rgba(255,255,255,0.18)' }} />
        <View style={{ width: w * 0.4, height: w * 0.4, borderRadius: w * 0.2, backgroundColor: OBANG.yellow, borderWidth: 2, borderColor: '#9a6a0e', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[styles.sealText, { color: '#7d1a14', fontSize: w * 0.24 }]}>복</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sealText: { fontWeight: '900', textAlign: 'center', includeFontPadding: false },
  hanji: { borderRadius: 3, borderWidth: 1, borderColor: HANJI_EDGE, paddingHorizontal: 16, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  deckle: { position: 'absolute', left: 4, right: 4, height: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', overflow: 'hidden' },
  notch: { width: 7, borderRadius: 2 },
});
