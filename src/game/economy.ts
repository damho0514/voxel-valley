import { Block } from './blocks';
import { BUFFS, BuffId, GemId, GEMS } from './treasure';

/*
 * The money loop: draw over blocks to smash them, every smashed block pays out, and the money buys
 * better drawing weapons, building perks and character upgrades in the shop.
 *
 * Pure rules only (no React, no storage), so it can be unit-tested and shared by the UI.
 */

/** What one smashed block is worth. Soft, common blocks pay little; rare, glowing ones pay more. */
const VALUE: Partial<Record<Block, number>> = {
  [Block.Leaf]: 1, [Block.Blossom]: 1, [Block.Maple]: 1, [Block.Snow]: 1, [Block.Sand]: 1, [Block.Ash]: 1,
  [Block.Moss]: 2, [Block.Soil]: 2, [Block.DryGrass]: 2, [Block.Ice]: 2,
  [Block.Stone]: 3, [Block.Wood]: 3, [Block.Plank]: 3, [Block.Clay]: 3, [Block.Asphalt]: 3, [Block.RoadLine]: 3,
  [Block.Glass]: 4, [Block.GlassSky]: 4, [Block.GlassRose]: 4, [Block.GlassAmber]: 4, [Block.GlassMint]: 4,
  [Block.Metal]: 5, [Block.Window]: 5, [Block.Station]: 6, [Block.Asteroid]: 6, [Block.Ember]: 6,
  [Block.Neon]: 8, [Block.WindowLit]: 8,
  [Block.Crystal]: 15,
};
export const blockValue = (b: Block) => VALUE[b] ?? 1;

/**
 * Longer strokes pay more per block: ×1 for the first 20 blocks, then +0.25 every 20 more, up to ×3.
 * `n` is how many blocks this stroke has already smashed.
 */
export const comboMultiplier = (n: number) => Math.min(3, 1 + Math.floor(Math.max(0, n) / 20) * 0.25);

/** A closed loop smashes everything inside it, and those blocks pay double. */
export const LOOP_BONUS = 2;

export type Weapon = {
  id: string;
  name: string;
  emoji: string;
  price: number;
  /** Screen radius (points) of the brush around the finger; 0 = just the block under it. */
  brush: number;
  /** Extra blocks behind each surface block that break too. */
  depth: number;
  /** Most blocks one stroke can smash ("energy"). */
  cap: number;
  /** How far away (blocks) the stroke reaches. */
  reach: number;
  /** Trail colour. */
  color: number;
  desc: string;
};

/** Drawing weapons, weakest first. Each one is bought once and stays yours. */
export const WEAPONS: Weapon[] = [
  { id: 'pick', name: '나무 곡괭이', emoji: '⛏️', price: 0, brush: 0, depth: 0, cap: 40, reach: 10, color: 0xffd166, desc: '손가락이 지나간 블록을 하나씩 부숴요' },
  { id: 'drill', name: '강철 드릴', emoji: '⚙️', price: 600, brush: 14, depth: 1, cap: 110, reach: 14, color: 0xff9a4c, desc: '굵은 붓처럼 두 겹씩 파고들어요' },
  { id: 'laser', name: '레이저 커터', emoji: '🔆', price: 3000, brush: 20, depth: 1, cap: 240, reach: 20, color: 0xff4f8b, desc: '멀리까지 넓게 잘라내요' },
  { id: 'plasma', name: '플라즈마 해머', emoji: '⚡', price: 12000, brush: 28, depth: 2, cap: 450, reach: 26, color: 0x8c6cff, desc: '세 겹 깊이로 크게 부숴요' },
  { id: 'quantum', name: '퀀텀 블래스터', emoji: '🌀', price: 45000, brush: 36, depth: 3, cap: 900, reach: 34, color: 0x5ff2ff, desc: '최신 무기 · 산도 한 번에 지워요' },
];

/** Things bought once (building perks). */
export type Perk = { id: string; name: string; emoji: string; price: number; desc: string; requires?: string };
export const PERKS: Perk[] = [
  { id: 'place2', name: '2×2 한 번에 짓기', emoji: '🧱', price: 800, desc: '탭 한 번에 블록 4개를 놓아요' },
  { id: 'place3', name: '3×3 한 번에 짓기', emoji: '🏗️', price: 3500, desc: '탭 한 번에 블록 9개를 놓아요', requires: 'place2' },
  { id: 'reach', name: '긴 팔', emoji: '🦾', price: 1200, desc: '블록을 놓고 캐는 거리가 8칸 → 14칸' },
  { id: 'special', name: '특수 블록 팔레트', emoji: '💎', price: 2000, desc: '어디서나 네온 · 수정 · 금속 · 불 켜진 창을 써요' },
];

/** Character stats, upgraded level by level. */
export type Stat = { id: 'hp' | 'speed' | 'jump' | 'income'; name: string; emoji: string; max: number; base: number; step: string };
export const STATS: Stat[] = [
  { id: 'hp', name: '체력', emoji: '❤️', max: 5, base: 400, step: '최대 체력 +25' },
  { id: 'speed', name: '이동 속도', emoji: '👟', max: 5, base: 500, step: '걷기 · 수영 +8%' },
  { id: 'jump', name: '점프력', emoji: '🦘', max: 4, base: 450, step: '점프 높이 +7%' },
  { id: 'income', name: '수입', emoji: '💰', max: 5, base: 900, step: '블록당 냥 +10%' },
];
/** The character's level: 1, plus one for every stat level bought (19 levels in all, so Lv 20 at most). */
export const characterLevel = (p: Progress) => 1 + STATS.reduce((n, s) => n + p.stats[s.id], 0);
export const MAX_LEVEL = 1 + STATS.reduce((n, s) => n + s.max, 0);

/** Price of the next level: each level costs 1.8× the one before. */
export const statPrice = (s: Stat, level: number) => Math.round((s.base * 1.8 ** level) / 10) * 10;

export type Progress = {
  v: 1;
  money: number;
  /** Everything ever earned (for the stats line). */
  earned: number;
  weapons: string[];
  weapon: string;
  perks: string[];
  stats: Record<Stat['id'], number>;
  /** Gems ever found (the 보석함 collection). */
  gems: Record<GemId, number>;
  /** Treasure chests opened. */
  chests: number;
  /** Mystic effects seen at least once (the collection shows the rest as "???"). */
  found: BuffId[];
};

const noGems = (): Record<GemId, number> => ({ gold: 0, ruby: 0, sapphire: 0, emerald: 0, diamond: 0 });

export const freshProgress = (): Progress => ({
  v: 1, money: 0, earned: 0, weapons: ['pick'], weapon: 'pick', perks: [], stats: { hp: 0, speed: 0, jump: 0, income: 0 },
  gems: noGems(), chests: 0, found: [],
});

/** Fills in anything missing from an older or damaged save. */
export function normalize(raw: unknown): Progress {
  const base = freshProgress();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Progress>;
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : d);
  const weapons = Array.isArray(r.weapons) ? r.weapons.filter((w) => WEAPONS.some((x) => x.id === w)) : [];
  if (!weapons.includes('pick')) weapons.unshift('pick');
  const stats = { ...base.stats };
  for (const s of STATS) stats[s.id] = Math.min(s.max, num(r.stats?.[s.id], 0));
  const gems = noGems();
  for (const g of GEMS) gems[g.id] = num(r.gems?.[g.id], 0);
  return {
    v: 1,
    money: num(r.money, 0),
    earned: num(r.earned, 0),
    weapons,
    weapon: weapons.includes(r.weapon ?? '') ? r.weapon! : weapons[weapons.length - 1],
    perks: Array.isArray(r.perks) ? r.perks.filter((p) => PERKS.some((x) => x.id === p)) : [],
    stats,
    gems,
    chests: num(r.chests, 0),
    found: Array.isArray(r.found) ? r.found.filter((f) => BUFFS.some((b) => b.id === f)) : [],
  };
}

export const weaponOf = (p: Progress) => WEAPONS.find((w) => w.id === p.weapon) ?? WEAPONS[0];

/** Money multiplier from the income stat. */
export const incomeMultiplier = (p: Progress) => 1 + 0.1 * p.stats.income;

/** What the game should use, given what's been bought. */
export function effects(p: Progress) {
  return {
    maxHp: 100 + 25 * p.stats.hp,
    walk: 1 + 0.08 * p.stats.speed,
    jump: 1 + 0.07 * p.stats.jump,
    placeSize: p.perks.includes('place3') ? 3 : p.perks.includes('place2') ? 2 : 1,
    buildReach: p.perks.includes('reach') ? 14 : 8,
    specialBlocks: p.perks.includes('special'),
  };
}

export const earn = (p: Progress, amount: number): Progress =>
  amount > 0 ? { ...p, money: p.money + Math.round(amount), earned: p.earned + Math.round(amount) } : p;

export type Purchase =
  | { kind: 'weapon'; id: string }
  | { kind: 'perk'; id: string }
  | { kind: 'stat'; id: Stat['id'] };

/** The price of a purchase right now, or null if it can't be bought (owned, maxed, locked). */
export function priceOf(p: Progress, item: Purchase): number | null {
  if (item.kind === 'weapon') {
    const w = WEAPONS.find((x) => x.id === item.id);
    return !w || p.weapons.includes(w.id) ? null : w.price;
  }
  if (item.kind === 'perk') {
    const k = PERKS.find((x) => x.id === item.id);
    if (!k || p.perks.includes(k.id) || (k.requires && !p.perks.includes(k.requires))) return null;
    return k.price;
  }
  const s = STATS.find((x) => x.id === item.id);
  if (!s || p.stats[s.id] >= s.max) return null;
  return statPrice(s, p.stats[s.id]);
}

/** Buys it if affordable; returns the new progress, or an error message. */
export function buy(p: Progress, item: Purchase): { ok: true; progress: Progress } | { ok: false; reason: string } {
  const price = priceOf(p, item);
  if (price === null) return { ok: false, reason: '살 수 없는 상품이에요' };
  if (p.money < price) return { ok: false, reason: `${(price - p.money).toLocaleString()}냥이 모자라요` };
  const money = p.money - price;
  if (item.kind === 'weapon') return { ok: true, progress: { ...p, money, weapons: [...p.weapons, item.id], weapon: item.id } };
  if (item.kind === 'perk') return { ok: true, progress: { ...p, money, perks: [...p.perks, item.id] } };
  return { ok: true, progress: { ...p, money, stats: { ...p.stats, [item.id]: p.stats[item.id] + 1 } } };
}

export const equip = (p: Progress, id: string): Progress => (p.weapons.includes(id) ? { ...p, weapon: id } : p);

/** "12,340" with Korean-style grouping. */
export const fmtMoney = (n: number) => Math.round(n).toLocaleString('en-US');

/** Adds a treasure find: money, gems for the collection, an opened chest, newly seen effects. */
export function addFind(p: Progress, f: { money?: number; gems?: Partial<Record<GemId, number>>; chest?: boolean; found?: BuffId[] }): Progress {
  const money = Math.max(0, Math.round(f.money ?? 0));
  const gems = { ...p.gems };
  for (const g of GEMS) gems[g.id] += f.gems?.[g.id] ?? 0;
  const found = [...p.found];
  for (const id of f.found ?? []) if (!found.includes(id)) found.push(id);
  return { ...p, money: p.money + money, earned: p.earned + money, gems, chests: p.chests + (f.chest ? 1 : 0), found };
}
