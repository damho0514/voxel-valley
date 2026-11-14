import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { buffs } from '../game/buffs';
import { BuffId, buffOf } from '../game/treasure';
import { OBANG, Seal } from './korea';

/** Running 부적 effects, as of the last tick (re-reads twice a second for the countdown). */
export function useBuffs() {
  const [list, setList] = useState(() => buffs.list());
  useEffect(() => {
    const off = buffs.subscribe(() => setList(buffs.list()));
    const t = setInterval(() => {
      buffs.prune();
      setList(buffs.list());
    }, 500);
    return () => { off(); clearInterval(t); };
  }, []);
  return list;
}

/** A paper 부적 strip per running effect, with its seal and a countdown (top right, under the buttons). */
export function BuffChips({ list }: { list: { id: BuffId; left: number }[] }) {
  if (!list.length) return null;
  return (
    <View pointerEvents="none" style={styles.chips}>
      {list.map(({ id, left }) => {
        const b = buffOf(id);
        return (
          <View key={id} style={[styles.chip, left <= 5 && styles.chipEnding]}>
            <Seal text={b.mark} size={20} color={b.color} tilt={0} />
            <Text style={styles.chipText}>{b.name}</Text>
            <Text style={styles.chipTime}>{`${left}초`}</Text>
          </View>
        );
      })}
    </View>
  );
}

const LIGHTS = [OBANG.blue, OBANG.red, OBANG.yellow, '#3fbf8a'];

/** 풍악을 울려라: soft 오방색 lantern light washing over the screen (never blocks touches, no strobing). */
export function DiscoLights() {
  const [layers] = useState(() => LIGHTS.map(() => new Animated.Value(0)));
  useEffect(() => {
    const anims = layers.map((v, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 340),
      Animated.timing(v, { toValue: 1, duration: 340, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 560, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay((LIGHTS.length - 1 - i) * 340),
    ])));
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [layers]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {layers.map((v, i) => (
        <Animated.View key={i} style={[StyleSheet.absoluteFill, { backgroundColor: LIGHTS[i],
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 0.12] }) }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { position: 'absolute', top: 60, right: 14, alignItems: 'flex-end', gap: 5 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 9, paddingVertical: 3, borderRadius: 4,
    backgroundColor: 'rgba(243,231,207,0.92)', borderWidth: 1, borderColor: '#d9c49c' },
  chipEnding: { opacity: 0.55 },
  chipText: { color: '#2a1d14', fontSize: 12, fontWeight: '900' },
  chipTime: { color: '#7a6450', fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
