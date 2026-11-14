import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { css } from '../session';
import { fmtMoney, PERKS, priceOf, Progress, Purchase, STATS, WEAPONS } from '../game/economy';
import { progress } from '../game/progress';
import { Coin } from './money';
import { Seal } from './korea';
import { BUFFS, GEMS } from '../game/treasure';
import { GemIcon } from './gem';

/*
 * The shop: money from smashing blocks buys newer drawing weapons, building perks and character
 * upgrades. Laid out for a landscape phone: tabs on top, a row of cards you swipe through.
 */

type Tab = 'weapon' | 'build' | 'char' | 'gems';
const TABS: { id: Tab; label: string }[] = [
  { id: 'weapon', label: '⚔️ 무기' },
  { id: 'build', label: '🏗️ 건축' },
  { id: 'char', label: '💪 캐릭터' },
  { id: 'gems', label: '💎 보석함' },
];

function useProgress() {
  const [p, setP] = useState(progress.get());
  useEffect(() => progress.subscribe(setP), []);
  return p;
}

export function Shop({ onBuy, onEquip, onClose }: {
  onBuy: (item: Purchase) => void;
  onEquip: (weaponId: string) => void;
  onClose: () => void;
}) {
  const p = useProgress();
  const [tab, setTab] = useState<Tab>('weapon');

  // The cards fill whatever height is left under the header, so the buy button is always on
  // screen, even on a short landscape phone (~360 pt tall) or with larger system text.
  const [cardH, setCardH] = useState(0);

  return (
    <View style={styles.backdrop}>
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.title} maxFontSizeMultiplier={1.15}>🛒 상점</Text>
          <View style={styles.balance}>
            <Coin size={16} />
            <Text style={styles.balanceText} maxFontSizeMultiplier={1.15}>{fmtMoney(p.money)}</Text>
          </View>
          {TABS.map((t) => (
            <Pressable key={t.id} testID={`shop-tab-${t.id}`} onPress={() => setTab(t.id)} style={[styles.tab, tab === t.id && styles.tabOn]}>
              <Text style={[styles.tabText, tab === t.id && styles.tabTextOn]} maxFontSizeMultiplier={1.15}>{t.label}</Text>
            </Pressable>
          ))}
          <View style={{ flex: 1 }} />
          <Pressable testID="shop-close" onPress={onClose} hitSlop={10} style={styles.close}>
            <Text style={styles.closeText} maxFontSizeMultiplier={1.15}>닫기 ✕</Text>
          </Pressable>
        </View>
        <View style={styles.cardArea} onLayout={(e) => setCardH(Math.floor(e.nativeEvent.layout.height))}>
          {cardH > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
              {tab === 'weapon' && WEAPONS.map((w, i) => {
                const owned = p.weapons.includes(w.id), using = p.weapon === w.id;
                return (
                  <Card key={w.id} height={cardH} testID={`shop-weapon-${w.id}`} emoji={w.emoji} name={w.name} desc={w.desc} accent={css(w.color)}
                    tag={i === WEAPONS.length - 1 ? '최신' : undefined}
                    lines={[`붓 ${w.brush ? w.brush : '1칸'} · 깊이 ${w.depth + 1}겹`, `한 획 ${w.cap}개 · 사거리 ${w.reach}칸`]}
                    action={using ? { label: '사용 중', state: 'done' } : owned ? { label: '장착하기', state: 'equip' } : price(p, { kind: 'weapon', id: w.id })}
                    onPress={() => (owned ? !using && onEquip(w.id) : onBuy({ kind: 'weapon', id: w.id }))} />
                );
              })}
              {tab === 'build' && PERKS.map((k) => {
                const owned = p.perks.includes(k.id);
                const locked = !!k.requires && !p.perks.includes(k.requires);
                return (
                  <Card key={k.id} height={cardH} testID={`shop-perk-${k.id}`} emoji={k.emoji} name={k.name} desc={k.desc} accent="#7fd4a0"
                    action={owned ? { label: '보유 중', state: 'done' } : locked ? { label: `🔒 ${PERKS.find((x) => x.id === k.requires)?.name} 먼저`, state: 'locked' } : price(p, { kind: 'perk', id: k.id })}
                    onPress={() => !owned && !locked && onBuy({ kind: 'perk', id: k.id })} />
                );
              })}
              {tab === 'char' && STATS.map((s) => {
                const lv = p.stats[s.id];
                return (
                  <Card key={s.id} height={cardH} testID={`shop-stat-${s.id}`} emoji={s.emoji} name={s.name} desc={`레벨마다 ${s.step}`} accent="#ff9ab8"
                    level={{ now: lv, max: s.max }}
                    action={lv >= s.max ? { label: 'MAX', state: 'done' } : price(p, { kind: 'stat', id: s.id }, `Lv ${lv + 1} · `)}
                    onPress={() => lv < s.max && onBuy({ kind: 'stat', id: s.id })} />
                );
              })}
              {tab === 'gems' && (
                <>
                  {GEMS.map((g) => (
                    <Showcase key={g.id} height={cardH} testID={`gems-${g.id}`} accent={g.color} icon={<GemIcon gem={g} size={34} dim={!p.gems[g.id]} />}
                      name={g.name} big={`${p.gems[g.id]}개`} line={`1개 ${fmtMoney(g.value)}냥 · ${g.minDepth}칸 아래부터`} />
                  ))}
                  <Showcase height={cardH} testID="gems-chests" accent="#c98a4b" icon={<Seal text="궤" size={30} color="#7a4a22" tilt={0} />}
                    name="열어 본 반닫이" big={`${p.chests}개`} line="깊이 팔수록 자주, 더 좋은 등급" />
                  {BUFFS.map((b) => {
                    const seen = p.found.includes(b.id);
                    return (
                      <Showcase key={b.id} height={cardH} testID={`gems-buff-${b.id}`} accent={seen ? b.color : '#4a5160'}
                        icon={<View style={{ opacity: seen ? 1 : 0.35 }}><Seal text={seen ? b.mark : '?'} size={30} color={seen ? b.color : '#6b625a'} tilt={0} /></View>}
                        name={seen ? b.name : '???'} big={seen ? '발견!' : '미발견'} line={seen ? b.desc : '부적 돌이나 반닫이에서 나와요'} />
                    );
                  })}
                </>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </View>
  );
}

type Action = { label: string; state: 'buy' | 'poor' | 'done' | 'equip' | 'locked'; coin?: boolean };

function price(p: Progress, item: Purchase, prefix = ''): Action {
  const v = priceOf(p, item);
  if (v === null) return { label: '구매 불가', state: 'locked' };
  return { label: `${prefix}${fmtMoney(v)}`, state: p.money >= v ? 'buy' : 'poor', coin: true };
}

function Card({ emoji, name, desc, lines, accent, tag, level, action, onPress, testID, height }: {
  emoji: string; name: string; desc: string; lines?: string[]; accent: string; tag?: string;
  level?: { now: number; max: number }; action: Action; onPress: () => void; testID: string; height: number;
}) {
  const roomy = height >= 230;
  return (
    <View style={[styles.card, { borderColor: accent, height }]}>
      {/* Details shrink and clip if space is tight; the button below them never moves off the card. */}
      <View style={styles.cardInfo}>
        <View style={styles.cardTop}>
          <Text style={[styles.cardEmoji, !roomy && { fontSize: 22 }]} maxFontSizeMultiplier={1}>{emoji}</Text>
          <Text style={styles.cardName} numberOfLines={2} maxFontSizeMultiplier={1.15}>{name}</Text>
        </View>
        {tag && <Text style={[styles.tag, { backgroundColor: accent }]} maxFontSizeMultiplier={1}>{tag}</Text>}
        <Text style={styles.cardDesc} numberOfLines={roomy ? 3 : 2} maxFontSizeMultiplier={1.15}>{desc}</Text>
        {lines?.map((l) => <Text key={l} style={styles.cardLine} numberOfLines={1} maxFontSizeMultiplier={1.15}>{l}</Text>)}
        {level && (
          <View style={styles.dots}>
            {Array.from({ length: level.max }, (_, i) => <View key={i} style={[styles.dot, i < level.now && { backgroundColor: accent }]} />)}
          </View>
        )}
      </View>
      <Pressable testID={testID} onPress={onPress} disabled={action.state === 'done' || action.state === 'locked'} hitSlop={6}
        style={({ pressed }) => [styles.button, BUTTON[action.state], pressed && { transform: [{ scale: 0.96 }] }]}>
        {action.coin && <Coin size={15} />}
        <Text numberOfLines={1} maxFontSizeMultiplier={1.15}
          style={[styles.buttonText, action.state !== 'buy' && { color: action.state === 'poor' || action.state === 'locked' ? '#c9ced8' : 'white' }]}>{action.label}</Text>
      </Pressable>
    </View>
  );
}

/** A collection card in the 보석함 (nothing to buy, just what you've found). */
function Showcase({ icon, name, big, line, accent, height, testID }: {
  icon: React.ReactNode; name: string; big: string; line: string; accent: string; height: number; testID: string;
}) {
  return (
    <View testID={testID} style={[styles.card, styles.showcase, { borderColor: accent, height, width: 136 }]}>
      <View style={styles.showIcon}>{icon}</View>
      <Text style={styles.showName} numberOfLines={1} maxFontSizeMultiplier={1.15}>{name}</Text>
      <Text style={[styles.showBig, { color: accent }]} numberOfLines={1} maxFontSizeMultiplier={1.15}>{big}</Text>
      <Text style={styles.showLine} numberOfLines={3} maxFontSizeMultiplier={1.15}>{line}</Text>
    </View>
  );
}

const BUTTON = StyleSheet.create({
  buy: { backgroundColor: '#f2b52e' },
  poor: { backgroundColor: '#4a5160' },
  done: { backgroundColor: '#2f7a52' },
  equip: { backgroundColor: '#3d8bd9' },
  locked: { backgroundColor: '#3a3f4a' },
});

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(8,12,20,0.6)', alignItems: 'center', justifyContent: 'center' },
  panel: { width: '94%', maxWidth: 940, height: '92%', borderRadius: 20, backgroundColor: '#1d2330', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8,
    borderWidth: 2, borderColor: '#ffd166' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: 'white', fontSize: 19, fontWeight: '900' },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: 'rgba(255,209,102,0.16)',
    borderWidth: 1.5, borderColor: '#ffd166', marginRight: 4 },
  balanceText: { color: '#ffe08a', fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  close: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: '#3a4252' },
  closeText: { color: 'white', fontWeight: '800' },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 11, backgroundColor: '#2b3242' },
  tabOn: { backgroundColor: '#ffd166' },
  tabText: { color: '#c9ced8', fontWeight: '800', fontSize: 14 },
  tabTextOn: { color: '#2a1d00' },
  cardArea: { flex: 1, marginTop: 8 },
  cards: { gap: 10, paddingRight: 6 },
  card: { width: 172, borderRadius: 14, backgroundColor: '#262d3c', padding: 10, borderWidth: 2 },
  cardInfo: { flex: 1, overflow: 'hidden' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: { position: 'absolute', top: 0, right: 0, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 7, color: '#1b1b1b', fontSize: 10, fontWeight: '900', overflow: 'hidden' },
  cardEmoji: { fontSize: 28 },
  cardName: { flex: 1, color: 'white', fontSize: 15, fontWeight: '900' },
  cardDesc: { color: '#aab2c0', fontSize: 11.5, marginTop: 4, marginBottom: 3 },
  cardLine: { color: '#d6dbe4', fontSize: 11.5 },
  dots: { flexDirection: 'row', gap: 5, marginTop: 6 },
  dot: { width: 14, height: 8, borderRadius: 4, backgroundColor: '#3d4556' },
  button: { height: 38, marginTop: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 },
  buttonText: { color: '#1b1300', fontSize: 14, fontWeight: '900' },
  showcase: { alignItems: 'center', overflow: 'hidden' },
  showIcon: { height: 44, alignItems: 'center', justifyContent: 'center' },
  showBig: { fontSize: 20, fontWeight: '900', marginTop: 2 },
  showName: { color: 'white', fontSize: 15, fontWeight: '900', textAlign: 'center', alignSelf: 'stretch' },
  showLine: { color: '#aab2c0', fontSize: 11.5, marginTop: 4, textAlign: 'center', alignSelf: 'stretch' },
});
