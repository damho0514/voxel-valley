import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { analyzePhoto, PhotoLook } from '../game/photoRoom';
import { pickPhoto } from '../photo/capture';
import { CameraDenied, PhotoSource, Snap } from '../photo/types';

/*
 * 내 공간 제출: pick or shoot a photo (a screenshot works too), then the show —
 * the photo drops in as a polaroid, a "제출 완료" stamp slams onto it, a scanner sweeps it while it
 * turns into blocks, and the result card deals out the colours it found (wall, floor, ceiling,
 * accent), mood tags and a 감성 점수 with a rank. "여기에 짓기" flies the card into the world and the
 * caller builds the room. Tap anywhere during the show to skip ahead. Every timer and loop is
 * cleaned up on unmount.
 */

export type PhotoSound = 'whoosh' | 'place' | 'pop' | 'drumroll' | 'gem' | 'fanfare' | 'cash' | 'magic' | 'tap' | 'deny';
type Phase = 'choose' | 'loading' | 'submit' | 'scan' | 'result' | 'fly';

const STEPS = ['🎨 색감 추출 중…', '🧱 벽·바닥 찾는 중…', '✨ 분위기 읽는 중…'];
const RANK_COLOR = { S: '#ffcf3f', A: '#7fd7ff', B: '#b9f28a' } as const;
const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function PhotoSubmit({ width, height, onSound, onBuzz, onBuild, onClose }: {
  width: number;
  height: number;
  onSound: (s: PhotoSound) => void;
  onBuzz: (k: 'light' | 'heavy' | 'success') => void;
  /** "여기에 짓기": build the room from this photo. */
  onBuild: (snap: Snap, look: PhotoLook) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('choose');
  const phaseRef = useRef<Phase>('choose');
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<{ snap: Snap; look: PhotoLook } | null>(null);
  const [pct, setPct] = useState(0);
  const [score, setScore] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout | typeof setInterval>[]>([]);
  const loops = useRef<Animated.CompositeAnimation[]>([]);
  const alive = useRef(true);

  const [v] = useState(() => ({
    back: new Animated.Value(0),
    drop: new Animated.Value(0),
    stamp: new Animated.Value(0),
    flash: new Animated.Value(0),
    beam: new Animated.Value(0),
    scanOn: new Animated.Value(0),
    pixel: new Animated.Value(0),
    panel: new Animated.Value(0),
    title: new Animated.Value(0),
    rank: new Animated.Value(0),
    fly: new Animated.Value(0),
    chips: Array.from({ length: 4 }, () => new Animated.Value(0)),
    tags: Array.from({ length: 5 }, () => new Animated.Value(0)),
    strip: new Animated.Value(0),
  }));

  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const loop = (a: Animated.CompositeAnimation) => { loops.current.push(a); a.start(); };
  const go = (p: Phase) => { phaseRef.current = p; setPhase(p); };
  const clearTimers = () => { timers.current.forEach((t) => { clearTimeout(t as ReturnType<typeof setTimeout>); clearInterval(t as ReturnType<typeof setInterval>); }); timers.current = []; };
  const spring = (a: Animated.Value, friction = 5, tension = 120) => Animated.spring(a, { toValue: 1, friction, tension, useNativeDriver: true });
  const fade = (a: Animated.Value, toValue: number, duration: number, delay = 0) =>
    Animated.timing(a, { toValue, duration, delay, easing: Easing.out(Easing.quad), useNativeDriver: true });

  useEffect(() => {
    fade(v.back, 1, 200).start();
    return () => {
      alive.current = false;
      clearTimers();
      loops.current.forEach((l) => l.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (source: PhotoSource) => {
    onSound('tap');
    setError(null);
    go('loading');
    try {
      const snap = await pickPhoto(source);
      if (!alive.current) return;
      if (!snap) { go('choose'); return; }
      const look = analyzePhoto(snap.rgba, snap.w, snap.h);
      setShot({ snap, look });
      startShow(look);
    } catch (e) {
      if (!alive.current) return;
      onSound('deny');
      setError(e instanceof CameraDenied
        ? '카메라 권한이 꺼져 있어요. 설정에서 켜 주시거나, 찍어 둔 사진을 골라 주세요.'
        : '사진을 읽지 못했어요. 다른 사진으로 해 볼까요?');
      go('choose');
    }
  };

  /** drop → stamp → scan → result, on timers (tap skips to the result). */
  const startShow = (look: PhotoLook) => {
    clearTimers();
    for (const a of [v.drop, v.stamp, v.flash, v.beam, v.scanOn, v.pixel, v.panel, v.title, v.rank, v.fly, v.strip, ...v.chips, ...v.tags]) a.setValue(0);
    setPct(0);
    setScore(0);
    go('submit');
    onSound('whoosh');
    spring(v.drop, 6, 60).start();
    later(420, () => { onSound('place'); onBuzz('light'); });
    later(700, () => {
      onSound('pop');
      onBuzz('heavy');
      v.flash.setValue(0.7);
      fade(v.flash, 0, 380).start();
      spring(v.stamp, 4, 160).start();
    });
    later(1450, () => startScan(look));
  };

  const startScan = (look: PhotoLook) => {
    if (phaseRef.current !== 'submit') return;
    go('scan');
    onSound('drumroll');
    fade(v.scanOn, 1, 200).start();
    loop(Animated.loop(Animated.timing(v.beam, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true })));
    fade(v.pixel, 1, 900, 700).start();
    let p = 0;
    const tick = setInterval(() => {
      p = Math.min(100, p + 100 / (2300 / 50)); // 2.3 s to 100%
      setPct(Math.round(p));
      if (p >= 100) { clearInterval(tick); showResult(look); }
    }, 50);
    timers.current.push(tick);
  };

  const showResult = (look: PhotoLook) => {
    if (phaseRef.current === 'result' || phaseRef.current === 'fly') return;
    clearTimers();
    loops.current.forEach((l) => l.stop());
    loops.current = [];
    go('result');
    setPct(100);
    v.drop.setValue(1);
    v.stamp.setValue(1);
    fade(v.scanOn, 0, 250).start();
    fade(v.pixel, 0, 700, 300).start();
    v.flash.setValue(0.5);
    fade(v.flash, 0, 400).start();
    onSound('fanfare');
    onBuzz('success');
    Animated.timing(v.panel, { toValue: 1, duration: 420, easing: Easing.out(Easing.back(1.3)), useNativeDriver: true }).start();
    Animated.sequence([Animated.delay(250), spring(v.title, 4, 140)]).start();
    v.chips.forEach((c, i) => later(450 + i * 170, () => { onSound('gem'); spring(c, 4, 170).start(); }));
    fade(v.strip, 1, 400, 1150).start();
    v.tags.forEach((t, i) => Animated.sequence([Animated.delay(1200 + i * 110), spring(t, 5, 150)]).start());
    // The score counts up, then the rank badge slams in.
    later(1300, () => {
      let k = 0;
      const tick = setInterval(() => {
        k = Math.min(1, k + 30 / 650);
        setScore(Math.round(look.score * (1 - (1 - k) ** 3)));
        if (k >= 1) {
          clearInterval(tick);
          onSound(look.rank === 'S' ? 'cash' : 'pop');
          onBuzz('heavy');
          spring(v.rank, 3, 180).start();
        }
      }, 30);
      timers.current.push(tick);
    });
  };

  const skip = () => {
    if (!shot) return;
    if (phaseRef.current === 'submit' || phaseRef.current === 'scan') showResult(shot.look);
  };

  const build = () => {
    if (!shot || phaseRef.current !== 'result') return;
    go('fly');
    onSound('magic');
    onBuzz('heavy');
    Animated.parallel([
      Animated.timing(v.fly, { toValue: 1, duration: 650, easing: Easing.in(Easing.back(1.6)), useNativeDriver: true }),
      fade(v.panel, 0, 250),
      Animated.timing(v.back, { toValue: 0, duration: 600, delay: 200, useNativeDriver: true }),
    ]).start();
    later(560, () => onBuild(shot.snap, shot.look));
  };

  const retry = () => {
    onSound('tap');
    clearTimers();
    loops.current.forEach((l) => l.stop());
    loops.current = [];
    setShot(null);
    go('choose');
  };

  // ── Layout (landscape first; still fits a portrait browser) ───────────────
  const wide = width > height * 1.15;
  const look = shot?.look;
  const aspect = look?.aspect ?? 4 / 3;
  let picH = Math.min(height * (wide ? 0.6 : 0.36), 280);
  let picW = picH * aspect;
  const maxW = wide ? width * 0.4 : width * 0.8;
  if (picW > maxW) { picW = maxW; picH = picW / aspect; }
  const PAD = 8, CAP = 24;
  const cardW = picW + PAD * 2, cardH = picH + PAD + CAP;
  const panelW = wide ? Math.min(360, width - cardW - 64) : Math.min(420, width - 32);

  const showing = phase !== 'choose' && phase !== 'loading' && shot;
  const today = new Date();
  const stamp = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: v.back }]}>
      <Pressable testID="photo-backdrop" style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={skip} />

      {!showing && (
        <View style={styles.center} pointerEvents="box-none">
          <View style={[styles.sheet, { width: Math.min(520, width - 32) }]}>
            <Pressable testID="photo-close" onPress={() => { onSound('tap'); onClose(); }} style={styles.close} hitSlop={12}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
            <Text style={styles.sheetTitle}>📸 내 공간 제출</Text>
            <Text style={styles.sheetDesc}>방, 카페, 좋아하는 장소… 사진을 내면 색감과 분위기를 읽어서{'\n'}게임 속 집 안으로 지어 드려요.</Text>
            {phase === 'loading' ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#ffd36b" />
                <Text style={styles.loadingText}>사진 불러오는 중…</Text>
              </View>
            ) : (
              <View style={styles.choiceRow}>
                <Pressable testID="photo-camera" onPress={() => choose('camera')} style={({ pressed }) => [styles.choice, styles.choiceMain, pressed && styles.pressed]}>
                  <Text style={styles.choiceIcon}>📷</Text>
                  <Text style={styles.choiceText}>지금 찍기</Text>
                </Pressable>
                <Pressable testID="photo-library" onPress={() => choose('library')} style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
                  <Text style={styles.choiceIcon}>🖼️</Text>
                  <Text style={styles.choiceText}>사진·스크린샷 고르기</Text>
                </Pressable>
              </View>
            )}
            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        </View>
      )}

      {showing && look && (
        <View style={[styles.center, { flexDirection: wide ? 'row' : 'column', gap: wide ? 28 : 14 }]} pointerEvents="box-none">
          {/* The polaroid. */}
          <Animated.View pointerEvents="none" style={[styles.card, { width: cardW, height: cardH, padding: PAD, paddingBottom: CAP,
            transform: [
              { translateY: v.drop.interpolate({ inputRange: [0, 1], outputRange: [-height, 0] }) },
              { translateX: v.fly.interpolate({ inputRange: [0, 1], outputRange: [0, wide ? (panelW + 28) / 2 : 0] }) },
              { translateY: v.fly.interpolate({ inputRange: [0, 1], outputRange: [0, -height * 0.08] }) },
              { scale: v.fly.interpolate({ inputRange: [0, 1], outputRange: [1, 0.08] }) },
              { rotate: Animated.add(v.drop, v.fly.interpolate({ inputRange: [0, 1], outputRange: [0, 2] })).interpolate({ inputRange: [0, 1, 3], outputRange: ['-22deg', '-3deg', '357deg'] }) },
            ] }]}>
            <View style={{ width: picW, height: picH, overflow: 'hidden', backgroundColor: '#222' }}>
              <Image alt="" source={{ uri: shot.snap.uri }} style={{ width: picW, height: picH }} resizeMode="cover" />
              {/* Turning into blocks. */}
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: v.pixel, flexDirection: 'row', flexWrap: 'wrap' }]}>
                {look.pixels.colors.map((c, i) => (
                  <View key={i} style={{ width: picW / look.pixels.cols, height: picH / look.pixels.rows, backgroundColor: css(c),
                    borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.18)' }} />
                ))}
              </Animated.View>
              {/* Scanner: grid, corner brackets and a sweeping beam. */}
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: v.scanOn }]}>
                {Array.from({ length: 5 }, (_, i) => (
                  <View key={`h${i}`} style={[styles.gridH, { top: ((i + 1) * picH) / 6 }]} />
                ))}
                {Array.from({ length: 7 }, (_, i) => (
                  <View key={`v${i}`} style={[styles.gridV, { left: ((i + 1) * picW) / 8 }]} />
                ))}
                {(['tl', 'tr', 'bl', 'br'] as const).map((k) => <View key={k} style={[styles.bracket, styles[k]]} />)}
                <Animated.View style={[styles.beam, { width: picW,
                  transform: [{ translateY: v.beam.interpolate({ inputRange: [0, 1], outputRange: [-20, picH] }) }] }]} />
              </Animated.View>
            </View>
            <Text style={styles.caption} numberOfLines={1}>{`MY SPACE · ${stamp}`}</Text>
            {/* 제출 완료 stamp. */}
            <Animated.View style={[styles.stamp, {
              opacity: v.stamp.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }),
              transform: [{ scale: v.stamp.interpolate({ inputRange: [0, 1], outputRange: [2.8, 1] }) }, { rotate: '-14deg' }] }]}>
              <Text style={styles.stampText}>제출 완료</Text>
            </Animated.View>
          </Animated.View>

          {/* Scanning status, then the result card. */}
          {(phase === 'submit' || phase === 'scan') && (
            <View pointerEvents="none" style={[styles.scanBox, { width: panelW }]}>
              <Text style={styles.scanPct}>{phase === 'scan' ? `${pct}%` : '제출!'}</Text>
              <View style={styles.bar}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>
              {phase === 'scan' && <Text style={styles.scanStep}>{STEPS[Math.min(2, Math.floor(pct / 34))]}</Text>}
              <Text style={styles.skipHint}>탭하면 바로 결과 보기</Text>
            </View>
          )}
          {(phase === 'result' || phase === 'fly') && (
            <Animated.View style={[styles.panel, { width: panelW, opacity: v.panel,
              transform: [{ translateX: v.panel.interpolate({ inputRange: [0, 1], outputRange: [wide ? 80 : 0, 0] }) },
                { translateY: v.panel.interpolate({ inputRange: [0, 1], outputRange: [wide ? 0 : 60, 0] }) }] }]}>
              <View style={styles.titleRow}>
                <Animated.Text numberOfLines={1} style={[styles.title, { transform: [{ scale: v.title.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }], opacity: v.title }]}>
                  {`✨ ${look.title}`}
                </Animated.Text>
              </View>
              <View style={styles.scoreRow}>
                <Text style={styles.scoreLabel}>감성 점수</Text>
                <Text style={styles.score}>{score}</Text>
                <Animated.View style={[styles.rank, { backgroundColor: RANK_COLOR[look.rank], opacity: v.rank,
                  transform: [{ scale: v.rank.interpolate({ inputRange: [0, 1], outputRange: [3, 1] }) }, { rotate: v.rank.interpolate({ inputRange: [0, 1], outputRange: ['-40deg', '-8deg'] }) }] }]}>
                  <Text style={styles.rankText}>{look.rank}</Text>
                </Animated.View>
              </View>
              <View style={styles.chipRow}>
                {([['벽', look.wall], ['바닥', look.floor], ['천장', look.ceiling], ['포인트', look.accent]] as const).map(([label, k], i) => (
                  <Animated.View key={label} style={[styles.chip, { opacity: v.chips[i], transform: [{ scale: v.chips[i].interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] }]}>
                    <View style={[styles.swatch, { backgroundColor: css(look.palette[k]) }]} />
                    <Text style={styles.chipText}>{label}</Text>
                  </Animated.View>
                ))}
              </View>
              <Animated.View style={[styles.strip, { opacity: v.strip }]}>
                {look.palette.map((c, i) => <View key={i} style={{ flex: Math.max(0.15, look.share[i]), backgroundColor: css(c) }} />)}
              </Animated.View>
              <View style={styles.tagRow}>
                {look.tags.slice(0, 5).map((t, i) => (
                  <Animated.Text key={t} style={[styles.tag, { opacity: v.tags[i], transform: [{ translateY: v.tags[i].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>{t}</Animated.Text>
                ))}
              </View>
              <View style={styles.btnRow}>
                <Pressable testID="photo-retry" onPress={retry} style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}>
                  <Text style={styles.btnGhostText}>↺ 다시</Text>
                </Pressable>
                <Pressable testID="photo-build" onPress={build} style={({ pressed }) => [styles.btn, styles.btnMain, pressed && styles.pressed]}>
                  <Text style={styles.btnMainText}>🏠 여기에 짓기!</Text>
                </Pressable>
              </View>
            </Animated.View>
          )}
        </View>
      )}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'white', opacity: v.flash }]} />
    </Animated.View>
  );
}

const B = 16; // scanner bracket size
const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(10,14,26,0.84)' },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: '#1d2330', borderRadius: 20, borderWidth: 2, borderColor: '#ffd36b', paddingHorizontal: 22, paddingVertical: 18, alignItems: 'center' },
  close: { position: 'absolute', top: 8, right: 12, padding: 4 },
  closeText: { color: '#9aa3b5', fontSize: 20, fontWeight: '900' },
  sheetTitle: { color: 'white', fontSize: 22, fontWeight: '900' },
  sheetDesc: { color: '#c9d0de', fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 6, lineHeight: 19 },
  choiceRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  choice: { flex: 1, backgroundColor: '#2c3446', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', borderWidth: 2, borderColor: '#46506a' },
  choiceMain: { backgroundColor: '#f2b52e', borderColor: '#ffe08a' },
  choiceIcon: { fontSize: 30 },
  choiceText: { color: 'white', fontSize: 14, fontWeight: '900', marginTop: 4, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 2 },
  pressed: { transform: [{ scale: 0.95 }] },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20, marginBottom: 8 },
  loadingText: { color: '#ffd36b', fontSize: 14, fontWeight: '800' },
  error: { color: '#ff9b9b', fontSize: 12, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  card: { backgroundColor: '#fbf8f2', borderRadius: 6, shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 4, textAlign: 'center', color: '#6d6a64', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  stamp: { position: 'absolute', top: -14, right: -18, borderWidth: 3, borderColor: '#e8394d', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.85)' },
  stampText: { color: '#e8394d', fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(120,255,230,0.45)' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(120,255,230,0.45)' },
  bracket: { position: 'absolute', width: B, height: B, borderColor: '#7dffe0' },
  tl: { top: 6, left: 6, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 6, right: 6, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 6, left: 6, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 6, right: 6, borderBottomWidth: 3, borderRightWidth: 3 },
  beam: { position: 'absolute', left: 0, top: 0, height: 20, backgroundColor: 'rgba(125,255,224,0.35)', borderBottomWidth: 2, borderBottomColor: '#b8fff0' },
  scanBox: { alignItems: 'center' },
  scanPct: { color: '#7dffe0', fontSize: 40, fontWeight: '900', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,255,200,0.5)', textShadowRadius: 10 },
  bar: { width: '80%', height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: 6 },
  barFill: { height: '100%', backgroundColor: '#7dffe0' },
  scanStep: { color: 'white', fontSize: 15, fontWeight: '800', marginTop: 10 },
  skipHint: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '700', marginTop: 14 },
  panel: { backgroundColor: '#1d2330', borderRadius: 18, borderWidth: 2, borderColor: '#ffd36b', padding: 14, gap: 10 },
  titleRow: { alignItems: 'flex-start' },
  title: { color: 'white', fontSize: 19, fontWeight: '900' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreLabel: { color: '#aab3c5', fontSize: 12, fontWeight: '800' },
  score: { color: '#ffe08a', fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'], minWidth: 46 },
  rank: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'white' },
  rankText: { color: '#1b1b1b', fontSize: 22, fontWeight: '900' },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, alignItems: 'center', gap: 3 },
  swatch: { width: '100%', height: 30, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)' },
  chipText: { color: '#dfe5f0', fontSize: 11, fontWeight: '800' },
  strip: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { color: 'white', fontSize: 12, fontWeight: '800', backgroundColor: '#2f3a52', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  btn: { borderRadius: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { flex: 1, backgroundColor: '#2c3446', borderWidth: 1.5, borderColor: '#46506a' },
  btnGhostText: { color: '#dfe5f0', fontSize: 14, fontWeight: '900' },
  btnMain: { flex: 2.2, backgroundColor: '#f2b52e' },
  btnMainText: { color: '#1b1300', fontSize: 16, fontWeight: '900' },
});
