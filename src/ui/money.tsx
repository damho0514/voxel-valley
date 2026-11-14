import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { fmtMoney } from '../game/economy';
import { progress } from '../game/progress';
import { Bokjumeoni, Hanji, INK, OBANG, Seal, SEAL, Yeopjeon } from './korea';

/*
 * Money on screen, market-day style. The currency is 냥, paid in brass 엽전.
 *  - While you draw: coins hop off the blocks into the purse at the top, with "+3냥" at the finger;
 *    as the combo climbs, a 추임새 (좋다! 얼쑤! 얼씨구! … 지화자!) is stamped in red ink.
 *  - A cast: a 한지 slip with a 낙관 seal and the take.
 *  - Treasure / a lucky cast: a 복주머니 drops, bursts open and 엽전 fountain out (복 터졌다).
 * Everything animates on the native driver; particle counts are capped so it stays smooth.
 */

export type Pt = { x: number; y: number };

/** The game's coin (a 엽전). Kept under this name for the shop and chest screens. */
export function Coin({ size = 18 }: { size?: number }) {
  return <Yeopjeon size={size} />;
}

/** The live wallet balance, for React. */
export function useMoney() {
  const [money, setMoney] = useState(progress.get().money);
  useEffect(() => progress.subscribe((p) => setMoney(p.money)), []);
  return money;
}

/** The purse (tap it for the market). Rolls up to the new value and bumps when it grows. */
/** `top`: distance from the top edge (portrait screens put it below the header). */
export function MoneyCounter({ onPress, onTarget, top }: { onPress: () => void; onTarget: (p: Pt) => void; top?: number }) {
  const money = useMoney();
  const [shown, setShown] = useState(money);
  const shownRef = useRef(money);
  const [bump] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const from = shownRef.current;
    if (money === from) return;
    if (money > from) {
      bump.setValue(1.22);
      Animated.spring(bump, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
    }
    // Roll the digits over ~400 ms.
    const start = Date.now();
    let raf = 0;
    const step = () => {
      const u = Math.min(1, (Date.now() - start) / 400);
      const v = Math.round(from + (money - from) * (1 - (1 - u) ** 3));
      shownRef.current = v;
      setShown(v);
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [money, bump]);

  return (
    <Pressable testID="money" onPress={onPress} style={[styles.counterWrap, top !== undefined && { top }]}
      onLayout={(e) => { const l = e.nativeEvent.layout; onTarget({ x: l.x + 26, y: l.y + l.height / 2 }); }}>
      <Animated.View style={[styles.counter, { transform: [{ scale: bump }] }]}>
        <Yeopjeon size={22} />
        <Text style={styles.counterText}>{fmtMoney(shown)}</Text>
        <Text style={styles.counterUnit}>냥</Text>
        <View style={styles.marketTag}><Text style={styles.marketText}>장터</Text></View>
      </Animated.View>
    </Pressable>
  );
}

/** 추임새, one per combo step (combo 1.25 → 좋다, 1.5 → 얼쑤, … 3 → 지화자 좋다). */
const CHUIMSAE = ['좋다!', '얼쑤!', '잘한다!', '얼씨구!', '절씨구!', '좋구나!', '지화자!', '지화자 좋다!'];
/** Paper confetti in the five colours. */
const PAPER = [OBANG.blue, OBANG.red, OBANG.yellow, OBANG.white, '#3fbf8a'];

type Hop = { id: number; x: number; y: number; dx: number; lift: number; t: Animated.Value };
type Pop = { id: number; x: number; y: number; text: string; big: boolean; t: Animated.Value };
type Shout = { id: number; x: number; y: number; text: string; tilt: number; t: Animated.Value };
type Burst = { id: number; dx: number; up: number; fall: number; spin: number; size: number; paper?: string; delay: number; t: Animated.Value };
type Banner = { id: number; title: string; amount: string; seal: string; t: Animated.Value };
type Pouch = { id: number; t: Animated.Value; open: Animated.Value };

export type MoneyFxHandle = {
  /** Money earned near a point (called many times a second while drawing). */
  earn: (amount: number, at: Pt, combo: number) => void;
  /**
   * A cast's take on a 한지 slip. The 복주머니 (with a fountain of 엽전) comes out only for
   * treasure: a titled payout (chests, a lucky cast) or when `rain` is set — never for ordinary breaking.
   * `seal`: the 1–4 characters stamped on the slip.
   */
  payout: (total: number, blocks: number, loop: number, title?: string, rain?: boolean, seal?: string) => void;
};

const MAX_HOPS = 36;
let nextId = 1;

export const MoneyFx = forwardRef<MoneyFxHandle, { target: Pt; height: number; width: number; onSound: (name: 'coin' | 'coins' | 'cash') => void }>(
  function MoneyFx({ target, height, width, onSound }, ref) {
    const [hops, setHops] = useState<Hop[]>([]);
    const [pops, setPops] = useState<Pop[]>([]);
    const [shouts, setShouts] = useState<Shout[]>([]);
    const [burst, setBurst] = useState<Burst[]>([]);
    const [banner, setBanner] = useState<Banner | null>(null);
    const [pouch, setPouch] = useState<Pouch | null>(null);
    const live = useRef({ hops: 0, lastHop: 0, lastPop: 0, popSum: 0, lastSound: 0, combo: 1, lastEarn: 0 });
    const targetRef = useRef(target);
    useEffect(() => { targetRef.current = target; }, [target]);

    useImperativeHandle(ref, () => ({
      earn(amount, at, combo) {
        const now = Date.now(), L = live.current;
        // A pause between strokes starts the 추임새 over.
        if (now - L.lastEarn > 1500) L.combo = 1;
        L.lastEarn = now;
        // Coins: a few per batch, at most every 60 ms, never more than MAX_HOPS in the air.
        if (now - L.lastHop > 60 && L.hops < MAX_HOPS) {
          L.lastHop = now;
          const n = Math.min(MAX_HOPS - L.hops, amount >= 40 ? 4 : amount >= 12 ? 3 : amount >= 4 ? 2 : 1);
          const fresh: Hop[] = Array.from({ length: n }, () => ({
            id: nextId++, x: at.x + (Math.random() - 0.5) * 24, y: at.y + (Math.random() - 0.5) * 24,
            dx: (Math.random() - 0.5) * 110, lift: 36 + Math.random() * 50, t: new Animated.Value(0),
          }));
          L.hops += n;
          setHops((c) => [...c, ...fresh]);
          for (const c of fresh) {
            Animated.timing(c.t, { toValue: 1, duration: 600 + Math.random() * 200, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
              live.current.hops--;
              setHops((cs) => cs.filter((x) => x.id !== c.id));
            });
          }
        }
        // "+N냥" at the finger, summed over ~180 ms so it reads.
        L.popSum += amount;
        if (now - L.lastPop > 180) {
          L.lastPop = now;
          const p: Pop = { id: nextId++, x: at.x, y: at.y - 30, text: `+${fmtMoney(L.popSum)}냥`, big: combo > 1, t: new Animated.Value(0) };
          L.popSum = 0;
          setPops((ps) => [...ps.slice(-5), p]);
          Animated.timing(p.t, { toValue: 1, duration: 720, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() =>
            setPops((ps) => ps.filter((x) => x.id !== p.id)));
        }
        // Each new combo step gets its 추임새, stamped beside the finger.
        if (combo > L.combo) {
          L.combo = combo;
          const step = Math.max(1, Math.min(CHUIMSAE.length, Math.round((combo - 1) / 0.25)));
          const s: Shout = { id: nextId++, x: at.x + (Math.random() < 0.5 ? -70 : 70), y: at.y - 70, text: CHUIMSAE[step - 1],
            tilt: (Math.random() - 0.5) * 18, t: new Animated.Value(0) };
          setShouts((ss) => [...ss.slice(-2), s]);
          Animated.timing(s.t, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() =>
            setShouts((ss) => ss.filter((x) => x.id !== s.id)));
        }
        if (now - L.lastSound > 85) {
          L.lastSound = now;
          onSound('coin');
        }
      },

      payout(total, blocks, loop, title, rain = !!title, seal) {
        if (total <= 0) return;
        const big = rain;
        if (big || total >= 20) onSound(big ? 'cash' : 'coins');
        const b: Banner = {
          id: nextId++,
          title: title ?? (loop ? `싹쓸이 ${blocks}개 · 곱절` : `와르르 ${blocks}개`),
          amount: `+${fmtMoney(total)}냥`,
          seal: seal ?? (big ? '福' : loop ? '倍' : '得'),
          t: new Animated.Value(0),
        };
        setBanner(b);
        Animated.sequence([
          Animated.delay(big ? 650 : 0), // after the pouch bursts
          Animated.spring(b.t, { toValue: 1, friction: 6, tension: 130, useNativeDriver: true }),
          Animated.delay(big ? 1500 : 750),
          Animated.timing(b.t, { toValue: 2, duration: 320, useNativeDriver: true }),
        ]).start(() => setBanner((cur) => (cur?.id === b.id ? null : cur)));
        if (!big) return;
        // 복주머니: drops in, sways, bursts open — a fountain of 엽전 and paper confetti.
        const pt: Pouch = { id: nextId++, t: new Animated.Value(0), open: new Animated.Value(0) };
        setPouch(pt);
        Animated.sequence([
          Animated.spring(pt.t, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
          Animated.timing(pt.open, { toValue: 1, duration: 160, easing: Easing.out(Easing.back(3)), useNativeDriver: true }),
          Animated.delay(1700),
          Animated.timing(pt.t, { toValue: 2, duration: 380, useNativeDriver: true }),
        ]).start(() => setPouch((cur) => (cur?.id === pt.id ? null : cur)));
        const coins = Math.min(30, 14 + Math.floor(total / 200));
        const fresh: Burst[] = Array.from({ length: coins + 14 }, (_, i) => {
          const paper = i >= coins ? PAPER[i % PAPER.length] : undefined;
          return {
            id: nextId++,
            dx: (Math.random() - 0.5) * Math.min(width * 0.8, 520),
            up: 70 + Math.random() * Math.min(150, height * 0.25),
            fall: height * 0.6 + Math.random() * 80,
            spin: (Math.random() - 0.5) * 900,
            size: paper ? 8 + Math.random() * 6 : 18 + Math.random() * 12,
            paper,
            delay: 560 + Math.random() * 220,
            t: new Animated.Value(0),
          };
        });
        setBurst((bs) => [...bs, ...fresh]);
        for (const c of fresh) {
          Animated.sequence([
            Animated.delay(c.delay),
            Animated.timing(c.t, { toValue: 1, duration: c.paper ? 2000 : 1350, easing: Easing.linear, useNativeDriver: true }),
          ]).start(() => setBurst((bs) => bs.filter((x) => x.id !== c.id)));
        }
      },
    }), [onSound, width, height]);

    const tg = target;
    // Below the slip (which sits at the top quarter), so both read at once.
    const pouchX = width / 2, pouchY = Math.max(height * 0.6, 200);
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
        {pouch && (
          <Animated.View style={{ position: 'absolute', left: pouchX - 50, top: pouchY - 52,
            opacity: pouch.t.interpolate({ inputRange: [0, 0.2, 1, 1.6, 2], outputRange: [0, 1, 1, 1, 0] }),
            transform: [
              { translateY: pouch.t.interpolate({ inputRange: [0, 1, 2], outputRange: [-height * 0.6, 0, 18] }) },
              { rotate: pouch.open.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '-8deg', '4deg'] }) },
              { scale: pouch.open.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.18, 1] }) },
            ] }}>
            <Bokjumeoni size={100} />
          </Animated.View>
        )}
        {burst.map((c) => {
          const x0 = pouchX - c.size / 2, y0 = pouchY - 30;
          return (
            <Animated.View key={c.id} style={{ position: 'absolute', left: x0, top: y0,
              opacity: c.t.interpolate({ inputRange: [0, 0.04, 0.85, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                { translateX: c.t.interpolate({ inputRange: [0, 1], outputRange: [0, c.dx] }) },
                // A toss: up fast, then gravity.
                { translateY: c.t.interpolate({ inputRange: [0, 0.25, 0.45, 1], outputRange: [0, -c.up, -c.up * 0.8, c.fall] }) },
                c.paper
                  ? { rotate: c.t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${c.spin}deg`] }) }
                  : { rotateY: c.t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${Math.abs(c.spin) + 360}deg`] }) },
              ] }}>
              {c.paper ? <View style={{ width: c.size, height: c.size * 0.7, backgroundColor: c.paper }} /> : <Yeopjeon size={c.size} />}
            </Animated.View>
          );
        })}
        {hops.map((c) => (
          <Animated.View key={c.id} style={[styles.hop, {
            left: c.x - 11, top: c.y - 11,
            opacity: c.t.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateX: c.t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, c.dx * 0.5, tg.x - c.x] }) },
              { translateY: c.t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, -c.lift, tg.y - c.y] }) },
              { scale: c.t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.5, 1.15, 0.6] }) },
              { rotateY: c.t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '540deg'] }) },
            ],
          }]}><Yeopjeon size={22} /></Animated.View>
        ))}
        {pops.map((p) => (
          <Animated.Text key={p.id} style={[styles.pop, p.big && styles.popBig, {
            left: p.x - 80, top: p.y - 14,
            opacity: p.t.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateY: p.t.interpolate({ inputRange: [0, 1], outputRange: [0, -40] }) },
              { scale: p.t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.1, 1] }) },
            ],
          }]}>{p.text}</Animated.Text>
        ))}
        {shouts.map((s) => (
          <Animated.Text key={s.id} style={[styles.shout, {
            left: s.x - 90, top: s.y - 20,
            opacity: s.t.interpolate({ inputRange: [0, 0.08, 0.75, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { scale: s.t.interpolate({ inputRange: [0, 0.1, 0.2, 1], outputRange: [2.2, 0.92, 1, 1.04] }) },
              { translateY: s.t.interpolate({ inputRange: [0, 1], outputRange: [0, -16] }) },
              { rotate: `${s.tilt}deg` },
            ],
          }]}>{s.text}</Animated.Text>
        ))}
        {banner && (
          <Animated.View style={[styles.bannerWrap, {
            opacity: banner.t.interpolate({ inputRange: [0, 0.3, 1, 2], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateY: banner.t.interpolate({ inputRange: [0, 1, 2], outputRange: [-24, 0, -18] }) },
              { rotate: banner.t.interpolate({ inputRange: [0, 1, 2], outputRange: ['-4deg', '-1deg', '-1deg'] }) },
            ],
          }]}>
            <Hanji style={styles.banner}>
              <Animated.View style={{ transform: [{ scale: banner.t.interpolate({ inputRange: [0, 0.6, 1, 2], outputRange: [2.4, 2.4, 1, 1] }) }] }}>
                <Seal text={banner.seal} size={44} tilt={-8} />
              </Animated.View>
              <View>
                <Text style={styles.bannerTitle}>{banner.title}</Text>
                <Text style={styles.bannerAmount}>{banner.amount}</Text>
              </View>
            </Hanji>
          </Animated.View>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  counterWrap: { position: 'absolute', top: 8, alignSelf: 'center' },
  counter: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 6, paddingVertical: 5, borderRadius: 8,
    backgroundColor: 'rgba(42,29,20,0.86)', borderWidth: 2, borderColor: '#b98a3a',
  },
  counterText: { color: '#f6e2b0', fontSize: 19, fontWeight: '900', fontVariant: ['tabular-nums'], minWidth: 34, textAlign: 'right' },
  counterUnit: { color: '#d9b26a', fontSize: 14, fontWeight: '900', marginLeft: -2 },
  marketTag: { marginLeft: 4, backgroundColor: SEAL, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  marketText: { color: '#fff4e2', fontSize: 11, fontWeight: '900' },
  hop: { position: 'absolute' },
  pop: { position: 'absolute', width: 160, textAlign: 'center', color: '#fff1cc', fontSize: 19, fontWeight: '900',
    textShadowColor: 'rgba(42,29,20,0.95)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
  popBig: { color: '#ffd98a', fontSize: 21 },
  shout: { position: 'absolute', width: 180, textAlign: 'center', color: SEAL, fontSize: 30, fontWeight: '900',
    textShadowColor: '#fff6e6', textShadowRadius: 5, textShadowOffset: { width: 0, height: 0 } },
  bannerWrap: { position: 'absolute', top: '24%', alignSelf: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 10 },
  bannerTitle: { color: INK, fontSize: 16, fontWeight: '800', opacity: 0.85 },
  bannerAmount: { color: INK, fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: -2 },
});
