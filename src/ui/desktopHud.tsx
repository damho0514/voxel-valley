import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { HeadState } from '../input/headTypes';
import { Store, THEME, useStore } from './hud';

/*
 * On-screen parts that only the keyboard + mouse scheme shows: the "click to play" card (the
 * mouse isn't captured yet), a slim key guide at the bottom, and a hint by the crosshair saying
 * how many blocks are marked for the right button.
 */

// Laid out like Nexon's 서든어택 defaults (https://guide.sa.nexon.com/guide/25) where this game has
// the same thing; F (특수기능) is the carpet here.
const GUIDE: [string, string][] = [
  ['마우스 · 방향키', '둘러보기'],
  ['W A S D', '이동'],
  ['Space · Enter', '점프 · 공중에서 한 번 더: 이단 점프'],
  ['Shift', '누르고 있으면 달리기'],
  ['E', '공격 (검을 휘둘러요) · 블록을 고르면 쌓기'],
  ['⌘ · Ctrl + Shift', '누르는 즉시 블록 깨기 · 누르고 있으면 연속 (맥 ⌘ · 윈도우 Ctrl)'],
  ['Alt', '걷기 (발소리 없음)'],
  ['Ctrl · C', '앉기 · 하강'],
  ['좌클릭', '지팡이: 쓸어 표시 · 블록: 캐기 · 검: 베기'],
  ['우클릭', '지팡이: 💥 부수기 · 블록: 놓기'],
  ['1 · 2 · 3', '지팡이 · 블록(다시 누르면 다음) · 검'],
  ['4 · 5', '🐉 용 · 💥 터뜨리기'],
  ['트랙패드 두 손가락 · 휠', '둘러보기 (무기는 안 바뀌어요)'],
  ['Q', '이전 무기'],
  ['R', '재장전 (표시 비우기)'],
  ['Tab', '함께 있는 사람 (누르고 있기)'],
  ['F', '🧞 양탄자'],
  ['V', '1인칭 / 3인칭'],
  ['B', '상점'],
  ['[ · ]', '마우스 속도 − / +'],
  ['🎧 에어팟 누르기', '1번 클릭 · 2번 휠↓ · 3번 휠↑'],
  ['K', '🎧 에어팟 마우스 켜기 / 끄기'],
  ['Esc', '일시정지'],
  ['⌘ · Ctrl + Enter', '창 모드 ↔ 전체 화면 (두 키를 같이)'],
];

export function ClickToPlay({ onPress, resumed }: { onPress: () => void; resumed: boolean }) {
  // No mouse needed: Enter or Space starts too. Taken before the game's own key handler sees it,
  // so that press doesn't also jump.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (!['Enter', 'NumpadEnter', 'Space'].includes(e.code)) return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      e.preventDefault();
      e.stopPropagation();
      onPress();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onPress]);
  return (
    <Pressable testID="click-to-play" style={styles.veil} onPress={onPress}>
      <View style={styles.card}>
        <Text style={styles.title}>{resumed ? '▶ 클릭 · Enter로 계속하기' : '▶ 클릭 · Enter로 플레이'}</Text>
        <Text style={styles.sub}>마우스가 고정돼요 · Shift 달리기 · E 공격 · ⌘/Ctrl+Shift 깨기 · Esc 일시정지 · ⌘/Ctrl+Enter 전체 화면</Text>
        <View style={styles.grid}>
          {GUIDE.map(([k, v]) => (
            <View key={k} style={styles.row}>
              <Text style={styles.key}>{k}</Text>
              <Text style={styles.val}>{v}</Text>
            </View>
          ))}
        </View>
      </View>
    </Pressable>
  );
}

/** One line of the most-used keys, bottom-left while playing. */
export function KeyHints({ flying, drawing }: { flying: boolean; drawing: boolean }) {
  // Stay left of the centred hotbar (7 slots ≈ 350 px wide) instead of sliding under it.
  const { width } = useWindowDimensions();
  const hintsWidth = Math.max(150, width / 2 - 200);
  const items = flying
    ? ['W 앞으로', 'Space 상승', 'Ctrl 하강', 'F 착륙', 'V 시점']
    : drawing
      ? ['좌클릭 쓸어서 표시', '우클릭 · 5 💥', 'Shift 달리기 · E 공격', '⌘/Ctrl+Shift 깨기', '⌘/Ctrl+Enter 전체 화면', 'Esc 일시정지']
      : ['Shift 달리기 · E 공격', '⌘/Ctrl+Shift 깨기', '좌클릭 캐기 · 우클릭 놓기', '1 지팡이 · 3 검', '⌘/Ctrl+Enter 전체 화면', 'Esc 일시정지'];
  return (
    <View pointerEvents="none" style={[styles.hints, { maxWidth: hintsWidth }]}>
      {items.map((t) => <Text key={t} style={styles.hint}>{t}</Text>)}
    </View>
  );
}

/** Top-centre chip while the AirPods bridge is running: recognized or not, head aiming on or off. */
const BUD = { left: '왼쪽 이어버드', right: '오른쪽 이어버드', both: '양쪽' } as const;
const BUTTON = { press: '🖱 클릭', next: '🖱 휠 ↓ 다음 무기', prev: '🖱 휠 ↑ 이전 무기' } as const;

/**
 * Top-centre chip for the AirPods mouse: which AirPods (and which earbud's sensor) moves the
 * cursor, whether it's on, and a flash of each AirPods click / wheel the game receives.
 */
export function HeadChip({ head }: { head?: HeadState }) {
  if (!head || (!head.bridge && !head.button)) return null;
  const who = `${head.name ?? '에어팟'}${head.bud ? ` · ${BUD[head.bud]}` : ''}`;
  const text = !head.bridge
    ? '🎧 에어팟 버튼'
    : head.denied
      ? '🎧 동작 권한이 꺼져 있어요 · 시스템 설정 › 개인정보 보호 › 동작 및 피트니스'
      : !head.connected
        ? '🎧 에어팟을 연결하세요 (맥의 소리 출력 = 에어팟)'
        : !head.bluetooth
          ? `🎧 ${head.name ?? '이 장치'}는 에어팟이 아니에요 · 소리 출력을 에어팟으로`
          : head.on
            ? `🎧 ${who} · 에어팟 마우스 켜짐 · K 끄기`
            : `🎧 ${who} · 에어팟 마우스 꺼짐 · K 켜기`;
  return (
    <View pointerEvents="none" style={[styles.head, head.connected && head.on && styles.headOn]}>
      <Text style={styles.headText}>{text}</Text>
      {head.button && <Text style={styles.headButton}>{BUTTON[head.button]}</Text>}
    </View>
  );
}

/** "💥 우클릭 · 12개" under the crosshair once something is marked. */
export function MarkHint({ store }: { store: Store<{ count: number; cap: number }> }) {
  const { count, cap } = useStore(store);
  if (!count) return null;
  return (
    <View pointerEvents="none" style={styles.mark}>
      <Text style={styles.markText}>{`💥 우클릭으로 부수기 · ${count}${cap ? ` / ${cap}` : ''}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  veil: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(6,10,20,0.45)', alignItems: 'center', justifyContent: 'center' },
  card: { maxWidth: 560, paddingHorizontal: 26, paddingVertical: 20, borderRadius: 20, backgroundColor: 'rgba(12,18,34,0.92)', borderWidth: 1, borderColor: THEME.rim, gap: 8 },
  title: { color: THEME.gold, fontSize: 24, fontWeight: '900', textAlign: 'center' },
  sub: { color: THEME.inkSoft, fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 240 },
  key: { minWidth: 72, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(255,246,220,0.12)', borderWidth: 1, borderColor: THEME.rimSoft,
    color: THEME.ink, fontSize: 12, fontWeight: '900', textAlign: 'center' },
  val: { flex: 1, color: THEME.ink, fontSize: 13, fontWeight: '700' },
  hints: { position: 'absolute', left: 14, bottom: 14, flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignContent: 'flex-end' },
  hint: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: THEME.glass, borderWidth: 1, borderColor: THEME.rimSoft, color: THEME.inkSoft, fontSize: 11, fontWeight: '800', overflow: 'hidden' },
  // Top-left under the status card: the game's own toasts use the top centre.
  head: { position: 'absolute', top: 76, left: 14, maxWidth: 360, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: THEME.glass, borderWidth: 1, borderColor: THEME.rimSoft },
  headOn: { borderColor: THEME.gold },
  headText: { color: THEME.ink, fontSize: 12, fontWeight: '800' },
  headButton: { marginTop: 3, alignSelf: 'center', color: '#2a1b00', backgroundColor: THEME.gold, fontSize: 12, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  mark: { position: 'absolute', top: '56%', alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(242,195,91,0.92)' },
  markText: { color: '#2a1b00', fontSize: 13, fontWeight: '900' },
});
