import { Block } from './blocks';
import type { Noise } from './noise';

/*
 * Treasure underground: the deeper you dig, the rarer the gems, and now and then a treasure chest
 * or a rune that gives a mystic effect for a while. Pure rules (no React, no rendering).
 */

export type GemId = 'gold' | 'ruby' | 'sapphire' | 'emerald' | 'diamond';

export type Gem = {
  id: GemId;
  block: Block;
  name: string;
  /** Money for one, before multipliers. */
  value: number;
  /** Blocks below the surface where it starts to show up. */
  minDepth: number;
  /** Chance per stone block once deep enough. */
  chance: number;
  color: string;
  shine: string;
};

/** Cheapest and shallowest first. */
export const GEMS: Gem[] = [
  { id: 'gold', block: Block.GoldOre, name: '금덩이', value: 25, minDepth: 4, chance: 0.012, color: '#f2c14e', shine: '#fff1b0' },
  { id: 'ruby', block: Block.RubyOre, name: '홍옥', value: 60, minDepth: 5, chance: 0.007, color: '#e0484f', shine: '#ffc2c4' },
  { id: 'sapphire', block: Block.SapphireOre, name: '청옥', value: 90, minDepth: 7, chance: 0.006, color: '#3f78d8', shine: '#c4d8ff' },
  { id: 'emerald', block: Block.EmeraldOre, name: '비취', value: 140, minDepth: 10, chance: 0.005, color: '#3fbf8a', shine: '#c9f2dc' },
  { id: 'diamond', block: Block.DiamondOre, name: '금강석', value: 250, minDepth: 14, chance: 0.004, color: '#bdf3ff', shine: '#ffffff' },
];
export const gemOfBlock = (b: Block) => GEMS.find((g) => g.block === b) ?? null;

export const CHEST_MIN_DEPTH = 5;
export const RUNE_MIN_DEPTH = 4;
const RUNE_CHANCE = 0.002;
/** Chests get more common the deeper you go: about 1 in 550 stone blocks at depth 10, 1 in 350 at 20. */
const chestChance = (depth: number) => 0.0008 + 0.0001 * Math.min(depth, 25);

/** Treasure blocks: breaking one is an event (gem payout, chest show, mystic effect). */
export const isTreasure = (b: Block) => b >= Block.GoldOre && b <= Block.Rune;

/**
 * What's buried at a stone block `depth` blocks below the surface, or null for plain stone.
 * Deterministic from the world seed, so every player in a room sees the same treasure.
 */
export function depositAt(n: Noise, x: number, y: number, z: number, depth: number): Block | null {
  if (depth < 4) return null;
  let r = n.hash01(x * 7 + y * 131, z * 13 - y * 17, 701);
  if (depth >= CHEST_MIN_DEPTH) {
    const c = chestChance(depth);
    if (r < c) return Block.Chest;
    r -= c;
  }
  if (depth >= RUNE_MIN_DEPTH) {
    if (r < RUNE_CHANCE) return Block.Rune;
    r -= RUNE_CHANCE;
  }
  // Rarest first so a deep block can be any of them.
  for (let i = GEMS.length - 1; i >= 0; i--) {
    const g = GEMS[i];
    if (depth < g.minDepth) continue;
    if (r < g.chance) return g.block;
    r -= g.chance;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// 부적: timed boosts from rune stones and chests, named after old Korean tales and sayings.

export type BuffId = 'midas' | 'feather' | 'rocket' | 'infinite' | 'xray' | 'disco' | 'heal';
/** `mark`: the one character cut into the 부적's seal. */
export type Buff = { id: BuffId; name: string; mark: string; seconds: number; desc: string; color: string };

export const BUFFS: Buff[] = [
  { id: 'midas', name: '재물운', mark: '財', seconds: 30, desc: '30초 동안 버는 냥 ×2', color: '#e9b330' },
  { id: 'feather', name: '날다람쥐', mark: '飛', seconds: 25, desc: '25초 동안 점프 높이 2배', color: '#7fb6e6' },
  { id: 'rocket', name: '축지법', mark: '縮', seconds: 25, desc: '25초 동안 이동 속도 ×1.6', color: '#2f6db5' },
  { id: 'infinite', name: '기운 충전', mark: '氣', seconds: 20, desc: '20초 동안 한 획 한도 ×3, 붓이 더 굵게', color: '#3fbf8a' },
  { id: 'xray', name: '천리안', mark: '眼', seconds: 30, desc: '30초 동안 근처 땅속 보물이 벽 너머로 비쳐요', color: '#9b6cd8' },
  { id: 'disco', name: '풍악을 울려라', mark: '興', seconds: 15, desc: '15초 동안 오방색 불빛 · 버는 냥 ×3', color: '#c8392f' },
  { id: 'heal', name: '보약 한 첩', mark: '藥', seconds: 0, desc: '체력이 바로 가득 차요', color: '#a0522d' },
];
export const buffOf = (id: BuffId) => BUFFS.find((b) => b.id === id)!;

// ---------------------------------------------------------------------------------------------
// 반닫이 (old wooden chests) buried underground. Graded like a market-day haul: 쪽박 … 초대박.

export type Rarity = 'bust' | 'common' | 'rare' | 'epic' | 'myth';
/** `seal`: what's stamped on the reveal. Colours follow 오방색 (흑 → 백 → 청 → 적 → 황). */
export const RARITY: Record<Rarity, { name: string; color: string; seal: string; lines: string[] }> = {
  bust: { name: '쪽박', color: '#7d7468', seal: '쪽박', lines: ['빈 궤짝이네…', '누가 먼저 다녀갔나 보다', '다음엔 더 깊이 파 보자'] },
  common: { name: '소박', color: '#d9c7a3', seal: '소박', lines: ['소소하게 한 냥 두 냥', '티끌 모아 태산', '오늘 장은 이 정도면 됐다'] },
  rare: { name: '중박', color: '#2f6db5', seal: '중박', lines: ['이 정도면 장 볼 만하네', '어허, 제법인데?', '오늘 운이 좀 트이네'] },
  epic: { name: '대박', color: '#c8392f', seal: '대박', lines: ['조상님이 도우셨다', '이게 웬 횡재냐!', '오늘 국밥은 내가 쏜다'] },
  myth: { name: '초대박', color: '#e9b330', seal: '초대박', lines: ['가문의 영광!', '팔자 폈다!', '동네방네 소문내야지'] },
};

/** What's in a 쪽박 chest. */
const JUNK = ['고무신 한 짝', '구멍 난 양말', '녹슨 숟가락', '뻥튀기 부스러기', '다 쓴 연탄', '찢어진 부채'];

export type ChestReward = {
  id: number;
  rarity: Rarity;
  /** A one-liner for the reveal. */
  line: string;
  /** Money before the income multiplier. */
  money: number;
  gems: Partial<Record<GemId, number>>;
  buffs: BuffId[];
  junk?: string;
};

let chestSeq = 1;

/** Rolls a chest's prize. Deeper chests are luckier. `rand` returns 0..1 (Math.random in the game). */
export function rollChest(depth: number, rand: () => number = Math.random): ChestReward {
  const luck = Math.max(0, Math.min(1, (depth - CHEST_MIN_DEPTH) / 20));
  const weights: [Rarity, number][] = [
    ['bust', 14 - 6 * luck],
    ['common', 46 - 18 * luck],
    ['rare', 26 + 8 * luck],
    ['epic', 11 + 10 * luck],
    ['myth', 3 + 6 * luck],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  let rarity: Rarity = 'common';
  for (const [k, w] of weights) {
    if (r < w) { rarity = k; break; }
    r -= w;
  }
  const pick = <T,>(xs: T[]) => xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))];
  const between = (a: number, b: number) => Math.round((a + rand() * (b - a)) / 10) * 10;
  const timed = BUFFS.filter((b) => b.seconds > 0).map((b) => b.id);
  const base = { id: chestSeq++, rarity, line: pick(RARITY[rarity].lines) };
  switch (rarity) {
    case 'bust':
      return { ...base, money: 7, gems: {}, buffs: [], junk: pick(JUNK) };
    case 'common':
      return { ...base, money: between(150, 400), gems: { gold: 1 + Math.floor(rand() * 2) }, buffs: [] };
    case 'rare':
      return { ...base, money: between(600, 1200), gems: { [pick<GemId>(['ruby', 'sapphire'])]: 1 + Math.floor(rand() * 2) }, buffs: rand() < 0.5 ? [pick(timed)] : [] };
    case 'epic':
      return { ...base, money: between(2000, 4000), gems: { [pick<GemId>(['emerald', 'diamond'])]: 1 + Math.floor(rand() * 2) }, buffs: [pick(timed)] };
    case 'myth':
      return { ...base, money: between(8000, 12000), gems: { diamond: 3 }, buffs: ['midas', 'disco'] };
  }
}

/** Total value of a set of gems (before multipliers). */
export const gemsValue = (gems: Partial<Record<GemId, number>>) =>
  GEMS.reduce((s, g) => s + (gems[g.id] ?? 0) * g.value, 0);
