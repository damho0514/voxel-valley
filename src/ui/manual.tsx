import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fmtMoney, PERKS, STATS, WEAPONS } from '../game/economy';
import { BUFFS, CHEST_MIN_DEPTH, GEMS, RARITY, RUNE_MIN_DEPTH } from '../game/treasure';
import { Bokjumeoni, Seal, Yeopjeon } from './korea';
import { GemIcon } from './gem';

/*
 * The in-game manual (☰ → ❓ 도움말), laid out like the "how to play" screens of big mobile games:
 * a first tab of four big picture cards that teach the core loop in one glance, then short cards
 * (a title and a line or two, never a wall of text) for everything else. Numbers come from the
 * same tables the game uses, so they stay right.
 */

type Item = { icon: React.ReactNode; title: string; body: string };
type Section = { id: string; label: string; items: Item[] };

const I = (emoji: string) => <Text style={styles.icon}>{emoji}</Text>;

/** The core loop, one card per step. */
const QUICK: { emoji: string; step: string; title: string; body: string }[] = [
  { emoji: '🕹️', step: '1', title: '밀면 그쪽으로', body: '왼쪽 아래 아무 데나 엄지를 대고 밀어요. 그 방향으로 걷고 화면도 따라 돌아요.' },
  { emoji: '✏️', step: '2', title: '쓱 그리기', body: '블록 위를 손가락으로 그려요. 그린 블록이 금빛으로 빛나요.' },
  { emoji: '💥', step: '3', title: '한 번에 부수기', body: '💥를 누르면 한꺼번에 부서지고 돈이 들어와요.' },
  { emoji: '⤒', step: '4', title: '점프', body: '오른쪽 아래 큰 버튼. 한 칸 턱은 저절로 넘어요.' },
];

/** Built on first open (it renders icons, so it can't run while this module is still loading). */
const buildSections = (): Section[] => [
  {
    id: 'play', label: '🎮 버튼', items: [
      { icon: I('👀'), title: '둘러보기 ↔ 그리기', body: '점프 위 작은 버튼. 둘러보기에선 화면을 끌어 보고, 탭하면 블록을 놓고, 꾹 누르면 캐요.' },
      { icon: I('🧞'), title: '마법 양탄자', body: '하늘을 날아요. 스틱으로 방향, ▲▼로 높이. 착륙을 누르면 내려요.' },
      { icon: I('🎥'), title: '1인칭 / 3인칭', body: '오른쪽 위 👁 / 🎥 버튼으로 내 캐릭터를 보며 놀 수 있어요.' },
      { icon: I('⚔️'), title: '에너지 검', body: '아래 둘째 칸. 탭한 블록을 바로 캐요. 동물을 탭하면 펫이 돼요.' },
      { icon: I('🧱'), title: '블록 칸', body: '유리 · 잔디 · 메탈. 골라서 화면을 탭하면 놓여요.' },
      { icon: I('☰'), title: '메뉴', body: '📸 내 공간 제출 · 상점 · 🐉 용 부르기 · 도움말 · 친구 초대 · 저장하고 나가기.' },
      { icon: I('📸'), title: '내 공간 제출', body: '방·카페 사진이나 스크린샷을 내면 색감과 분위기를 읽어, 바라보는 쪽에 그 느낌의 집을 지어요. 뒷벽엔 사진 블록 벽화, 옆벽엔 진짜 사진 액자.' },
      { icon: I('🐉'), title: '용', body: '메뉴에서 불러요. 화면을 탭하면 그곳에 불을 뿜어 땅을 날려요.' },
      { icon: I('🌀'), title: '차원문', body: '계곡의 문으로 들어가면 미래 도시나 우주로 가요.' },
    ],
  },
  {
    id: 'money', label: '엽전', items: [
      { icon: <Yeopjeon size={26} />, title: '냥', body: '부순 블록만큼 엽전이 들어와요. 위 가운데 돈주머니를 누르면 장터가 열려요.' },
      { icon: <Seal text="얼쑤" size={28} tilt={0} />, title: '추임새', body: '쉬지 않고 이어서 부수면 좋다 → 얼쑤 → 얼씨구 → 지화자! 갈수록 냥이 더 붙어요.' },
      { icon: <Seal text="倍" size={28} tilt={0} />, title: '싹쓸이 ×2', body: '처음과 끝이 만나게 동그라미를 그리면 안쪽까지 표시되고 냥이 곱절!' },
      { icon: <Bokjumeoni size={26} />, title: '복주머니 (3%)', body: '부수기 한 번마다 3% 확률로 복주머니가 터져 엽전이 쏟아져요.' },
      { icon: I('❤️'), title: '체력', body: '용암에 닿으면 줄어요. 0이 되면 처음 장소에서 다시 시작해요.' },
    ],
  },
  {
    id: 'treasure', label: '💎 보물', items: [
      { icon: I('⛏️'), title: '깊이 팔수록 보물', body: '4칸 넘게 파 내려가면 보석이 섞여 나와요. 깊을수록 비싸요.' },
      ...GEMS.map((g) => ({ icon: <GemIcon gem={g} size={26} />, title: `${g.name} · ${fmtMoney(g.value)}`, body: `${g.minDepth}칸 아래부터` })),
      { icon: <Seal text="궤" size={28} color="#7a4a22" tilt={0} />, title: '반닫이', body: `${CHEST_MIN_DEPTH}칸 아래부터 묻힌 옛 궤짝. ${(['bust', 'common', 'rare', 'epic', 'myth'] as const).map((r) => RARITY[r].name).join(' · ')}` },
      { icon: <Seal text="符" size={28} color="#9b6cd8" tilt={0} />, title: '부적 돌', body: `${RUNE_MIN_DEPTH}칸 아래 보라색 돌. 깨면 부적 효과가 걸려요.` },
    ],
  },
  {
    id: 'buffs', label: '부적', items: BUFFS.map((b) => ({ icon: <Seal text={b.mark} size={28} color={b.color} tilt={0} />, title: b.name, body: b.desc })),
  },
  {
    id: 'shop', label: '🛒 상점', items: [
      ...WEAPONS.map((w) => ({ icon: I(w.emoji), title: `${w.name} · ${w.price ? fmtMoney(w.price) : '기본'}`, body: '굵을수록 넓게, 깊을수록 여러 겹 부숴요.' })),
      ...PERKS.map((k) => ({ icon: I(k.emoji), title: `${k.name} · ${fmtMoney(k.price)}`, body: k.desc })),
      ...STATS.map((st) => ({ icon: I(st.emoji), title: st.name, body: `${st.step} (최대 ${st.max}레벨)` })),
    ],
  },
];

export function Manual({ onClose }: { onClose: () => void }) {
  const [SECTIONS] = useState(buildSections);
  const [tab, setTab] = useState('quick');
  const section = SECTIONS.find((s) => s.id === tab);
  const tabs = [{ id: 'quick', label: '🚀 빠른 시작' }, ...SECTIONS];
  return (
    <View style={styles.backdrop}>
      <View style={styles.panel}>
        <View style={styles.header}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {tabs.map((s) => (
              <Pressable key={s.id} testID={`manual-tab-${s.id}`} onPress={() => setTab(s.id)} style={[styles.tab, tab === s.id && styles.tabOn]}>
                <Text style={[styles.tabText, tab === s.id && styles.tabTextOn]} maxFontSizeMultiplier={1.15}>{s.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable testID="manual-close" onPress={onClose} hitSlop={12} style={styles.close}>
            <Text style={styles.closeText} maxFontSizeMultiplier={1.15}>✕</Text>
          </Pressable>
        </View>
        {section ? (
          <ScrollView key={tab} style={{ flex: 1, marginTop: 10 }} contentContainerStyle={styles.grid}>
            {section.items.map((it) => (
              <View key={it.title} style={styles.card}>
                <View style={styles.iconBox}>{it.icon}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} maxFontSizeMultiplier={1.2}>{it.title}</Text>
                  <Text style={styles.cardBody} maxFontSizeMultiplier={1.2}>{it.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.quick}>
            {QUICK.map((q) => (
              <View key={q.step} style={styles.quickCard}>
                <Text style={styles.quickStep}>{q.step}</Text>
                <Text style={styles.quickEmoji}>{q.emoji}</Text>
                <Text style={styles.quickTitle} maxFontSizeMultiplier={1.15}>{q.title}</Text>
                <Text style={styles.quickBody} maxFontSizeMultiplier={1.15}>{q.body}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(8,12,20,0.6)', alignItems: 'center', justifyContent: 'center' },
  panel: { width: '94%', maxWidth: 940, height: '90%', borderRadius: 22, backgroundColor: '#1b2130', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tabs: { gap: 6 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#283042' },
  tabOn: { backgroundColor: '#ffd36a' },
  tabText: { color: '#c9ced8', fontWeight: '800', fontSize: 14 },
  tabTextOn: { color: '#2a1b00' },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#384156' },
  closeText: { color: 'white', fontWeight: '900', fontSize: 16 },
  // Short cards, two per row on a landscape phone.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 6 },
  card: { flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 16, backgroundColor: '#252d3e' },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#313a50' },
  icon: { fontSize: 22 },
  cardTitle: { color: 'white', fontSize: 14.5, fontWeight: '900' },
  cardBody: { color: '#b9c1cf', fontSize: 12.5, lineHeight: 17, marginTop: 1 },
  // The quick start: four big picture cards side by side.
  quick: { flex: 1, flexDirection: 'row', gap: 10, marginTop: 12 },
  quickCard: { flex: 1, borderRadius: 20, backgroundColor: '#252d3e', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, gap: 6 },
  quickStep: { position: 'absolute', top: 10, left: 12, color: '#ffd36a', fontSize: 15, fontWeight: '900' },
  quickEmoji: { fontSize: 46 },
  quickTitle: { color: 'white', fontSize: 17, fontWeight: '900', textAlign: 'center' },
  quickBody: { color: '#b9c1cf', fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
});
