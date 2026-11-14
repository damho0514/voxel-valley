import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { soundNeedsTap } from '../audio/autoplay';
import { sound } from '../audio/sound';

/*
 * Launch intro, like a console game booting: the letters of the name fall one by one as blocks
 * (a "tok" and a tap of haptics each), then the logo slams down — shake, flash, flying chips, a big
 * chord — and the title screen fades in. Tap anywhere to skip.
 *
 * The sound is one file per version (assets/sounds/intro*.wav, from tools/gen_sounds.py intro), and
 * the animation is timed to it. INTRO_TIMING here and in gen_sounds.py MUST stay the same.
 */
const INTRO_TIMING = { full: { first: 0.15, gap: 0.075, hold: 1.05 }, short: { first: 0.05, gap: 0.022, hold: 0.7 } };
const FALL = 0.32;
const SLAM_AFTER = 0.1;
const FADE = 0.35;
const SEEN_KEY = 'voxel-valley-go/intro-seen';

const WORDS = ['VOXEL', 'VALLEY'];
const LETTERS = WORDS.join('').split('');
const TILE = 50;
const GAP = 6;
/** Pastel block faces, from the app icon's palette. */
const FACES = ['#C3B1F7', '#8EDDBE', '#A9D6F7', '#F9C9A6', '#F4B9C8', '#F2DD8C'];
const CHIPS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
  const r = 150 + (i % 3) * 55;
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r * 0.6 - 30, spin: (i % 2 ? 1 : -1) * (180 + i * 25), color: FACES[i % FACES.length], size: 9 + (i % 3) * 4 };
});

const buzz = (style: Haptics.ImpactFeedbackStyle) => { if (Platform.OS !== 'web') Haptics.impactAsync(style).catch(() => {}); };
const ms = (s: number) => Math.round(s * 1000);

/** Darkens a #rrggbb colour (block sides). */
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
};

export function Intro({ onDone }: { onDone: () => void }) {
  const { height } = useWindowDimensions();
  const [drops] = useState(() => LETTERS.map(() => new Animated.Value(0)));
  const [squash] = useState(() => LETTERS.map(() => new Animated.Value(0)));
  const [slam] = useState(() => new Animated.Value(0));
  const [shine] = useState(() => new Animated.Value(0));
  const [sub] = useState(() => new Animated.Value(0));
  const [fade] = useState(() => new Animated.Value(1));
  const [gate] = useState(() => new Animated.Value(0));
  /** On the web, sound needs a touch first: the intro waits on "눌러서 시작" and starts from that tap. */
  const [waiting, setWaiting] = useState(false);
  const ctl = useRef({ stop: () => {}, begin: null as (() => void) | null, timers: [] as ReturnType<typeof setTimeout>[], anim: null as Animated.CompositeAnimation | null, over: false });

  /** A tap: starts the intro if it's waiting for one, otherwise skips it. */
  const tap = () => {
    const c = ctl.current;
    if (c.begin) {
      c.anim?.stop();
      setWaiting(false);
      c.begin();
      return;
    }
    finish(true);
  };

  const finish = (quick: boolean) => {
    if (ctl.current.over) return;
    ctl.current.over = true;
    ctl.current.anim?.stop();
    ctl.current.timers.forEach(clearTimeout);
    if (quick) ctl.current.stop();
    Animated.timing(fade, { toValue: 0, duration: quick ? 200 : ms(FADE), easing: Easing.out(Easing.quad), useNativeDriver: true })
      .start(() => onDone());
  };

  useEffect(() => {
    let alive = true;
    const c = ctl.current; // the same object for the whole intro
    (async () => {
      const seen = await AsyncStorage.getItem(SEEN_KEY).catch(() => null);
      AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {});
      const t = seen ? INTRO_TIMING.short : INTRO_TIMING.full;
      const sting = await sound.prepareIntro(!!seen);
      if (!alive || c.over) { sting.stop(); return; }
      c.stop = sting.stop;
      // Plays sound and show together. Must run synchronously inside the tap on the web.
      c.begin = () => {
        c.begin = null;
        sting.start();
        const lands = LETTERS.map((_, i) => t.first + i * t.gap + FALL);
        const slamAt = lands[lands.length - 1] + SLAM_AFTER;
        const native = { useNativeDriver: true };
        c.anim = Animated.parallel([
          ...LETTERS.map((_, i) => Animated.sequence([
            Animated.delay(ms(t.first + i * t.gap)),
            Animated.timing(drops[i], { toValue: 1, duration: ms(FALL), easing: Easing.in(Easing.quad), ...native }),
            Animated.timing(squash[i], { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), ...native }),
          ])),
          Animated.sequence([Animated.delay(ms(slamAt)), Animated.timing(slam, { toValue: 1, duration: 650, easing: Easing.linear, ...native })]),
          Animated.sequence([Animated.delay(ms(slamAt + 0.15)), Animated.timing(shine, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), ...native })]),
          Animated.sequence([Animated.delay(ms(slamAt + 0.2)), Animated.timing(sub, { toValue: 1, duration: 400, easing: Easing.out(Easing.quad), ...native })]),
        ]);
        c.anim.start();
        // Feel each block land, then the slam.
        c.timers = [
          ...lands.map((x) => setTimeout(() => buzz(Haptics.ImpactFeedbackStyle.Rigid), ms(x))),
          setTimeout(() => buzz(Haptics.ImpactFeedbackStyle.Heavy), ms(slamAt)),
          setTimeout(() => buzz(Haptics.ImpactFeedbackStyle.Medium), ms(slamAt + 0.09)),
          setTimeout(() => finish(false), ms(slamAt + t.hold)),
        ];
      };
      if (!soundNeedsTap()) { c.begin(); return; }
      setWaiting(true);
      c.anim = Animated.loop(Animated.sequence([
        Animated.timing(gate, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(gate, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]));
      c.anim.start();
    })();
    return () => {
      alive = false;
      c.anim?.stop();
      c.timers.forEach(clearTimeout);
      c.stop();
    };
    // Runs once: the intro plays on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logoScale = slam.interpolate({ inputRange: [0, 0.08, 0.3, 0.55, 1], outputRange: [1, 1.14, 0.97, 1.01, 1] });
  const shakeX = slam.interpolate({ inputRange: [0, 0.06, 0.14, 0.22, 0.3, 0.4, 1], outputRange: [0, -10, 9, -6, 4, 0, 0] });
  const shakeY = slam.interpolate({ inputRange: [0, 0.05, 0.12, 0.2, 0.3, 1], outputRange: [0, 7, -5, 3, 0, 0] });
  const flash = slam.interpolate({ inputRange: [0, 0.04, 0.35, 1], outputRange: [0, 0.5, 0, 0] });
  const rowW = (n: number) => n * TILE + (n - 1) * GAP;
  const wide = rowW(Math.max(...WORDS.map((w) => w.length)));
  let k = 0;

  return (
    <Animated.View style={[styles.root, { opacity: fade }]}>
      <Pressable testID="intro" style={styles.fill} onPress={tap}>
        {STARS.map((s, i) => <View key={i} style={[styles.star, { left: `${s.x}%`, top: `${s.y}%`, opacity: s.o, width: s.r, height: s.r }]} />)}
        <Animated.View style={{ alignItems: 'center', gap: GAP + 2, transform: [{ translateX: shakeX }, { translateY: shakeY }, { scale: logoScale }] }}>
          {WORDS.map((word) => (
            <View key={word} style={styles.row}>
              {word.split('').map((ch) => {
                const i = k++;
                const face = FACES[i % FACES.length];
                return (
                  <Animated.View key={i} style={{ transform: [
                    { translateY: drops[i].interpolate({ inputRange: [0, 1], outputRange: [-height - TILE * 2, 0] }) },
                    { translateY: squash[i].interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, TILE * 0.1, 0] }) },
                    { scaleX: squash[i].interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 1.16, 1] }) },
                    { scaleY: squash[i].interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 0.78, 1] }) },
                  ] }}>
                    <View style={[styles.tile, { backgroundColor: shade(face, 0.72) }]}>
                      <View style={[styles.face, { backgroundColor: face }]}>
                        <View style={styles.highlight} />
                        <Text style={styles.letter}>{ch}</Text>
                      </View>
                    </View>
                  </Animated.View>
                );
              })}
            </View>
          ))}
          {/* a light sweep across the finished logo */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
            <Animated.View style={[styles.shine, { transform: [{ translateX: shine.interpolate({ inputRange: [0, 1], outputRange: [-wide * 0.7, wide * 1.2] }) }, { rotate: '20deg' }] }]} />
          </View>
          {CHIPS.map((c, i) => (
            <Animated.View key={i} pointerEvents="none" style={[styles.chip, {
              width: c.size, height: c.size, backgroundColor: c.color,
              opacity: slam.interpolate({ inputRange: [0, 0.01, 0.6, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                { translateX: slam.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, c.dx * 0.85, c.dx] }) },
                { translateY: slam.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [0, c.dy * 0.7, c.dy * 0.9 + 40, c.dy + 110] }) },
                { rotate: slam.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${c.spin}deg`] }) },
              ],
            }]} />
          ))}
        </Animated.View>
        <Animated.Text style={[styles.sub, { opacity: sub, transform: [{ translateY: sub.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
          블록으로 쌓는 나만의 계곡
        </Animated.Text>
        {waiting && (
          <Animated.View pointerEvents="none" style={[styles.gate, { opacity: gate }]}>
            <Text style={styles.gateText}>화면을 눌러 시작</Text>
            <Text style={styles.gateHint}>🔊 소리를 켜고 즐겨요</Text>
          </Animated.View>
        )}
        <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash }]} />
      </Pressable>
    </Animated.View>
  );
}

/** A fixed sprinkle of stars (no randomness between renders). */
const STARS = Array.from({ length: 26 }, (_, i) => ({
  x: (i * 37.7) % 100, y: ((i * 61.3) % 70) + 2, r: 1.5 + (i % 3), o: 0.25 + ((i * 7) % 10) / 20,
}));

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, backgroundColor: '#1b2233' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  star: { position: 'absolute', borderRadius: 3, backgroundColor: 'white' },
  row: { flexDirection: 'row', gap: GAP },
  tile: { width: TILE, height: TILE, borderRadius: 10, overflow: 'hidden' },
  face: { height: TILE - 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  highlight: { position: 'absolute', top: 4, left: 6, right: 6, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.45)' },
  letter: { color: 'white', fontSize: 27, fontWeight: '900', textShadowColor: 'rgba(40,30,70,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0 },
  shine: { position: 'absolute', top: -40, bottom: -40, width: 46, backgroundColor: 'rgba(255,255,255,0.32)' },
  chip: { position: 'absolute', alignSelf: 'center', top: '45%', borderRadius: 2 },
  sub: { marginTop: 22, color: 'rgba(255,255,255,0.82)', fontSize: 15, fontWeight: '700', letterSpacing: 2 },
  gate: { position: 'absolute', alignItems: 'center', gap: 8 },
  gateText: { color: 'white', fontSize: 22, fontWeight: '900', letterSpacing: 3 },
  gateHint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  flash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'white' },
});
