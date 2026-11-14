import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { fmtMoney } from '../game/economy';
import { BUFFS, ChestReward, GEMS, RARITY } from '../game/treasure';
import { GemIcon } from './gem';
import { BRASS, Hanji, INK, OBANG, Seal, Yeopjeon } from './korea';

/*
 * Opening a buried 반닫이 (an old wooden chest with brass fittings). It drops in and rattles on its
 * feet to a 장구 roll; the front flap swings down, coins and paper spill out, and the haul is
 * stamped on screen in a big seal — 쪽박, 소박, 중박, 대박 or 초대박. A 한지 slip then lists what
 * was inside. Tap to hurry it along at any point.
 *
 * The prize is already in the wallet when this starts (the caller grants it), so closing the app
 * mid-show loses nothing. Everything runs on the native driver; every timer and loop is cleaned
 * up on unmount. Mount with `key={reward.id}` so each chest starts fresh.
 */

export type ChestSound = 'drumroll' | 'pop' | 'fanfare' | 'fail' | 'cash' | 'tap';
type Phase = 'drop' | 'shake' | 'open' | 'card';

const MUTTER = ['어디 보자…', '뭐가 들었으려나…', '하나, 둘…', '셋!'];
const PAPER = [OBANG.blue, OBANG.red, OBANG.yellow, OBANG.white, '#3fbf8a'];
const WOOD = { body: '#5a2f1a', dark: '#3a1d10', grain: '#6e3a20', inside: '#1e0f07' };

export function ChestShow({ reward, total, width, height, onSound, onBuzz, onCollect }: {
  reward: ChestReward;
  /** Money actually added (prize + gems, with multipliers). */
  total: number;
  width: number;
  height: number;
  onSound: (s: ChestSound) => void;
  onBuzz: (k: 'light' | 'heavy' | 'success' | 'fail') => void;
  onCollect: () => void;
}) {
  const bust = reward.rarity === 'bust';
  const big = reward.rarity === 'epic' || reward.rarity === 'myth';
  const grade = RARITY[reward.rarity];
  const [phase, setPhase] = useState<Phase>('drop');
  const phaseRef = useRef<Phase>('drop');
  const [mutter, setMutter] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const loops = useRef<Animated.CompositeAnimation[]>([]);
  const collected = useRef(false);
  const cardAt = useRef(0);

  const [v] = useState(() => ({
    fade: new Animated.Value(0),
    drop: new Animated.Value(0),
    rattle: new Animated.Value(0),
    squash: new Animated.Value(1),
    flap: new Animated.Value(0),
    glow: new Animated.Value(0),
    flash: new Animated.Value(0),
    stamp: new Animated.Value(0),
    card: new Animated.Value(0),
  }));
  const [bits] = useState(() => {
    const n = bust ? 6 : big ? 30 : 18;
    return Array.from({ length: n }, (_, i) => {
      const paper = !bust && i % 3 === 2;
      return {
        paper, color: PAPER[i % PAPER.length],
        dx: (Math.random() - 0.5) * (bust ? 120 : 380), up: bust ? 20 + Math.random() * 30 : 80 + Math.random() * 140,
        fall: 160 + Math.random() * 120, spin: (Math.random() - 0.5) * 900, size: paper ? 9 + Math.random() * 5 : 16 + Math.random() * 10,
        dur: 1300 + Math.random() * 500, t: new Animated.Value(0),
      };
    });
  });

  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const loop = (a: Animated.CompositeAnimation) => { loops.current.push(a); a.start(); };
  const go = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    loops.current.forEach((l) => l.stop());
  }, []);

  const open = () => {
    if (phaseRef.current === 'open' || phaseRef.current === 'card') return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    loops.current.forEach((l) => l.stop());
    loops.current = [];
    go('open');
    v.rattle.setValue(0);
    v.drop.setValue(1);
    v.fade.setValue(1);
    onSound('pop');
    onBuzz('heavy');
    // The front flap swings down on its hinge; the chest gives a little hop.
    Animated.timing(v.flap, { toValue: 1, duration: 360, easing: Easing.out(Easing.back(1.8)), useNativeDriver: true }).start();
    Animated.sequence([
      Animated.timing(v.squash, { toValue: 0.82, duration: 70, useNativeDriver: true }),
      Animated.spring(v.squash, { toValue: 1, friction: 3, tension: 200, useNativeDriver: true }),
    ]).start();
    if (!bust) {
      v.flash.setValue(big ? 0.85 : 0.5);
      Animated.timing(v.flash, { toValue: 0, duration: 450, useNativeDriver: true }).start();
      Animated.timing(v.glow, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    }
    for (const b of bits) Animated.timing(b.t, { toValue: 1, duration: b.dur, easing: Easing.linear, useNativeDriver: true }).start();
    // The verdict: a big seal slams down.
    later(260, () => {
      onSound(bust ? 'fail' : 'fanfare');
      onBuzz(bust ? 'fail' : 'success');
      Animated.spring(v.stamp, { toValue: 1, friction: 5, tension: 170, useNativeDriver: true }).start();
      if (reward.rarity === 'myth') later(650, () => onSound('cash'));
    });
    later(1250, showCard);
  };

  const showCard = () => {
    if (phaseRef.current === 'card') return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    v.stamp.setValue(1);
    go('card');
    cardAt.current = Date.now();
    Animated.spring(v.card, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }).start();
  };

  const collect = () => {
    if (collected.current) return;
    collected.current = true;
    onSound('tap');
    onCollect();
  };

  // Drop in, then rattle harder and harder to the 장구, then open.
  useEffect(() => {
    Animated.timing(v.fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    Animated.spring(v.drop, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }).start();
    onBuzz('light');
    later(420, () => {
      go('shake');
      onSound('drumroll');
      const hop = (amp: number, ms: number) => [
        Animated.timing(v.rattle, { toValue: amp, duration: ms, useNativeDriver: true }),
        Animated.timing(v.rattle, { toValue: -amp, duration: ms, useNativeDriver: true }),
      ];
      loop(Animated.sequence([...hop(0.25, 110), ...hop(0.35, 90), ...hop(0.5, 70), ...hop(0.65, 55), ...hop(0.8, 45), ...hop(1, 38), ...hop(1, 32), ...hop(1, 28),
        Animated.timing(v.rattle, { toValue: 0, duration: 30, useNativeDriver: true })]));
      for (let i = 1; i < MUTTER.length; i++) later(i * 360, () => setMutter(i));
      later(MUTTER.length * 360 - 200, () => onBuzz('light'));
      later(MUTTER.length * 360 + 80, open);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tap = () => {
    const p = phaseRef.current;
    if (p === 'drop' || p === 'shake') open();
    else if (p === 'open') showCard();
    else if (Date.now() - cardAt.current > 450) collect();
  };

  // Layout: the verdict seal up top, the chest in the middle, the slip at the bottom.
  const cx = width / 2;
  const cy = Math.max(110, height * 0.45);
  const CH = Math.min(104, height * 0.24), CW = CH * 1.55;
  const sealSize = Math.min(118, height * 0.26);
  const gemsList = GEMS.filter((g) => (reward.gems[g.id] ?? 0) > 0);
  const buffList = BUFFS.filter((b) => reward.buffs.includes(b.id));

  return (
    <Pressable testID="chest-show" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} onPress={tap}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(24,16,10,0.82)', opacity: v.fade }]} />
      {/* Warm light from inside the chest (no rays: just a soft lantern glow). */}
      {!bust && (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: cx - CW * 1.4, top: cy - CW * 1.4, width: CW * 2.8, height: CW * 2.8,
          alignItems: 'center', justifyContent: 'center', opacity: v.glow.interpolate({ inputRange: [0, 1], outputRange: [0, big ? 0.9 : 0.6] }),
          transform: [{ scale: v.glow.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }}>
          {[1, 0.72, 0.48].map((k, i) => (
            <View key={i} style={{ position: 'absolute', width: CW * 2.8 * k, height: CW * 2.8 * k, borderRadius: CW * 1.4 * k,
              backgroundColor: grade.color, opacity: 0.1 + i * 0.07 }} />
          ))}
        </Animated.View>
      )}

      {/* Muttering while it rattles. */}
      {(phase === 'drop' || phase === 'shake') && (
        <View pointerEvents="none" style={[styles.mutterWrap, { top: Math.max(12, cy - CH * 1.45) }]}>
          <Hanji style={styles.mutter}><Text style={styles.mutterText}>{MUTTER[mutter]}</Text></Hanji>
        </View>
      )}

      {/* The 반닫이. */}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: cx - CW / 2, top: cy - CH / 2, width: CW, height: CH,
        opacity: v.fade,
        transform: [
          { translateY: Animated.add(
            v.drop.interpolate({ inputRange: [0, 1], outputRange: [-height, 0] }),
            v.rattle.interpolate({ inputRange: [-1, 0, 1], outputRange: [-5, 0, -5] })) },
          { rotate: v.rattle.interpolate({ inputRange: [-1, 1], outputRange: ['-4deg', '4deg'] }) },
          { scaleY: v.squash },
          { scaleX: v.squash.interpolate({ inputRange: [0.82, 1], outputRange: [1.1, 1] }) },
        ] }}>
        {/* top board */}
        <View style={[styles.top, { height: CH * 0.12 }]} />
        <View style={[styles.body, { height: CH * 0.8 }]}>
          {/* inside, revealed when the flap drops */}
          <View style={[styles.inside, { height: CH * 0.42 }]}>
            {!bust && <Animated.View style={{ flex: 1, backgroundColor: grade.color, opacity: v.glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }) }} />}
          </View>
          {/* wood grain lines on the lower half */}
          {[0.6, 0.75, 0.9].map((k) => <View key={k} style={[styles.grain, { top: CH * 0.8 * k }]} />)}
          {/* brass corner plates (장석) on the lower half */}
          {[0, 1].map((side) => (
            <View key={side} style={[styles.corner, side ? { right: 4 } : { left: 4 }, { bottom: 4, width: CH * 0.2, height: CH * 0.2 }]} />
          ))}
          {/* the front flap (upper half): swings down on its bottom hinge */}
          <Animated.View style={[styles.flap, { height: CH * 0.42,
            // Scale about the bottom edge (the hinge): shift the pivot down, scale, shift back.
            transform: [
              { translateY: CH * 0.21 },
              { scaleY: v.flap.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.05, -0.55] }) },
              { translateY: -CH * 0.21 },
            ] }]}>
            {[0, 1].map((side) => (
              <View key={side} style={[styles.corner, side ? { right: 4 } : { left: 4 }, { top: 4, width: CH * 0.18, height: CH * 0.18 }]} />
            ))}
            {/* round lock plate (앞바탕) with the bar lock */}
            <View style={[styles.lockPlate, { width: CH * 0.38, height: CH * 0.38, borderRadius: CH * 0.19, bottom: -CH * 0.16 }]}>
              <View style={[styles.lockBar, { width: CH * 0.3, height: CH * 0.08 }]} />
            </View>
          </Animated.View>
        </View>
        {/* feet */}
        <View style={styles.feet}>
          <View style={[styles.foot, { width: CW * 0.16, height: CH * 0.08 }]} />
          <View style={[styles.foot, { width: CW * 0.16, height: CH * 0.08 }]} />
        </View>
      </Animated.View>

      {/* Coins and paper spilling out. */}
      {phase !== 'drop' && phase !== 'shake' && bits.map((b, i) => (
        <Animated.View key={i} pointerEvents="none" style={{ position: 'absolute', left: cx - b.size / 2, top: cy - CH * 0.1,
          opacity: b.t.interpolate({ inputRange: [0, 0.05, 0.8, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateX: b.t.interpolate({ inputRange: [0, 1], outputRange: [0, b.dx] }) },
            { translateY: b.t.interpolate({ inputRange: [0, 0.3, 0.5, 1], outputRange: [0, -b.up, -b.up * 0.85, b.fall] }) },
            b.paper ? { rotate: b.t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${b.spin}deg`] }) }
              : { rotateY: b.t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${Math.abs(b.spin) + 360}deg`] }) },
          ] }}>
          {b.paper ? <View style={{ width: b.size, height: b.size * 0.7, backgroundColor: b.color }} />
            : bust ? <View style={{ width: b.size * 0.6, height: b.size * 0.6, borderRadius: 3, backgroundColor: '#8a7a68' }} /> : <Yeopjeon size={b.size} />}
        </Animated.View>
      ))}

      {/* The verdict seal. */}
      {phase !== 'drop' && phase !== 'shake' && (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: cx - sealSize / 2, top: Math.max(8, cy - CH / 2 - sealSize - 6),
          opacity: v.stamp.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
          transform: [{ scale: v.stamp.interpolate({ inputRange: [0, 1], outputRange: [3, 1] }) }] }}>
          <Seal text={grade.seal} size={sealSize} color={bust ? '#6b625a' : reward.rarity === 'common' ? '#9a7b4a' : reward.rarity === 'myth' ? '#b9770e' : grade.color} tilt={bust ? 7 : -7} />
        </Animated.View>
      )}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff4dc', opacity: v.flash }]} />

      {/* What was inside, on a 한지 slip. */}
      {phase === 'card' && (
        <Animated.View style={[styles.cardWrap, { maxHeight: height * 0.36,
          transform: [{ translateY: v.card.interpolate({ inputRange: [0, 1], outputRange: [height * 0.5, 0] }) }] }]}>
          <Hanji style={styles.card}>
            <View style={styles.cardBody}>
              <Text style={styles.line} numberOfLines={1}>{`“${reward.line}”`}</Text>
              <View style={styles.cardRow}>
                {reward.junk && <Text style={styles.junk} numberOfLines={1}>{reward.junk}</Text>}
                <View style={styles.prize}><Yeopjeon size={18} /><Text style={styles.money}>{`+${fmtMoney(total)}냥`}</Text></View>
                {gemsList.map((g) => (
                  <View key={g.id} style={styles.prize}><GemIcon gem={g} size={20} /><Text style={styles.prizeText}>{`${g.name} ×${reward.gems[g.id]}`}</Text></View>
                ))}
                {buffList.map((b) => (
                  <View key={b.id} style={styles.prize}><Seal text={b.mark} size={20} color={b.color} tilt={0} /><Text style={styles.prizeText}>{b.name}</Text></View>
                ))}
              </View>
            </View>
            <Pressable testID="chest-collect" onPress={collect} style={({ pressed }) => [styles.collect, pressed && { transform: [{ scale: 0.95 }] }]}>
              <Text style={styles.collectText}>{bust ? '그래도 챙기기' : '챙기기'}</Text>
            </Pressable>
          </Hanji>
        </Animated.View>
      )}
      {phase !== 'card' && <Text pointerEvents="none" style={styles.skip}>탭하면 바로 열어요</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mutterWrap: { position: 'absolute', alignSelf: 'center' },
  mutter: { paddingHorizontal: 14, paddingVertical: 5, transform: [{ rotate: '-2deg' }] },
  mutterText: { color: INK, fontSize: 17, fontWeight: '800' },
  top: { backgroundColor: WOOD.dark, borderRadius: 3, marginHorizontal: -4, borderWidth: 1.5, borderColor: '#24110a' },
  body: { backgroundColor: WOOD.body, borderWidth: 2, borderColor: WOOD.dark, overflow: 'visible' },
  inside: { position: 'absolute', left: 6, right: 6, top: 4, backgroundColor: WOOD.inside, overflow: 'hidden' },
  grain: { position: 'absolute', left: 8, right: 8, height: 1.5, backgroundColor: WOOD.grain },
  corner: { position: 'absolute', backgroundColor: BRASS.face, borderWidth: 1.5, borderColor: BRASS.rim, borderRadius: 3 },
  flap: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: '#64351d', borderBottomWidth: 2, borderColor: WOOD.dark, alignItems: 'center' },
  lockPlate: { position: 'absolute', backgroundColor: BRASS.face, borderWidth: 2, borderColor: BRASS.rim, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  lockBar: { backgroundColor: BRASS.hi, borderWidth: 1.5, borderColor: BRASS.rim, borderRadius: 2 },
  feet: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6 },
  foot: { backgroundColor: WOOD.dark, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  cardWrap: { position: 'absolute', bottom: 12, alignSelf: 'center', maxWidth: '94%' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  cardBody: { flexShrink: 1, gap: 6 },
  line: { color: INK, fontSize: 15, fontWeight: '800' },
  cardRow: { flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  junk: { color: '#6b5a48', fontSize: 13, fontWeight: '700' },
  prize: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  prizeText: { color: INK, fontSize: 13, fontWeight: '800' },
  money: { color: INK, fontSize: 19, fontWeight: '900', fontVariant: ['tabular-nums'] },
  collect: { backgroundColor: OBANG.red, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 6, borderWidth: 2, borderColor: '#7d1a14' },
  collectText: { color: '#fff4e2', fontWeight: '900', fontSize: 15 },
  skip: { position: 'absolute', bottom: 12, alignSelf: 'center', color: 'rgba(255,240,215,0.6)', fontSize: 12, fontWeight: '700' },
});
