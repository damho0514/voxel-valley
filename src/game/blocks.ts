/**
 * Block catalogue. The look is deliberately "soft pastel cubes" with flat
 * colours (no pixel textures) — Voxel Valley's own style.
 */
export enum Block {
  Air = 0,
  Moss = 1,
  Soil = 2,
  Stone = 3,
  Sand = 4,
  Wood = 5,
  Leaf = 6,
  Plank = 7,
  Clay = 8,
  Glass = 9,
  Bedrock = 10,
  Water = 11,
  Blossom = 12,
  Maple = 13,
  Snow = 14,
  Ice = 15,
  DryGrass = 16,
  Metal = 17,
  Asphalt = 18,
  RoadLine = 19,
  Neon = 20,
  Window = 21,
  WindowLit = 22,
  GateFrame = 23,
  PortalFuture = 24,
  PortalSpace = 25,
  PortalHome = 26,
  Asteroid = 27,
  Crystal = 28,
  Station = 29,
  Ember = 30,
  Ash = 31,
  GlassSky = 32,
  GlassRose = 33,
  GlassAmber = 34,
  GlassMint = 35,
}

export const BLOCK_COUNT = 36;

/** The valley (seasonal), the future city, and outer space. */
export type Dimension = 'valley' | 'future' | 'space';
export const DIMENSION_INFO: Record<Dimension, { name: string; emoji: string }> = {
  valley: { name: '계곡', emoji: '🏞️' },
  future: { name: '미래 도시', emoji: '🚀' },
  space: { name: '우주', emoji: '🌌' },
};

/** Walking into one of these blocks takes you to that dimension. */
export const PORTAL_TARGET: Partial<Record<Block, Dimension>> = {
  [Block.PortalFuture]: 'future',
  [Block.PortalSpace]: 'space',
  [Block.PortalHome]: 'valley',
};

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_INFO: Record<Season, { name: string; emoji: string; tagline: string; color: string }> = {
  spring: { name: '봄', emoji: '🌸', tagline: '벚꽃 날리는 언덕', color: '#f3a6c4' },
  summer: { name: '여름', emoji: '🌿', tagline: '푸른 숲과 넓은 바다', color: '#5fbf7f' },
  autumn: { name: '가을', emoji: '🍁', tagline: '단풍 물든 들판', color: '#e8955a' },
  winter: { name: '겨울', emoji: '❄️', tagline: '눈 덮인 계곡과 얼음 호수', color: '#8fbfe0' },
};

export type BlockInfo = {
  name: string;
  /** RGB 0..1 for top, sides, bottom. */
  top: [number, number, number];
  side: [number, number, number];
  bottom: [number, number, number];
  solid: boolean;
  /** Hides neighbour faces. */
  opaque: boolean;
  breakable: boolean;
  /** Seconds of holding to break. */
  hardness: number;
  /** Lit from inside: keeps its colour at night. */
  glow?: boolean;
  /** See-through, drawn in a separate translucent pass (portals). */
  portal?: boolean;
  /** Clear or tinted glass: a translucent pass with sorted-ish blending. */
  glass?: boolean;
};

const rgb = (hex: number): [number, number, number] => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];
const same = (hex: number) => {
  const c = rgb(hex);
  return { top: c, side: c, bottom: c };
};

export const BLOCKS: Record<Block, BlockInfo> = {
  [Block.Air]: { name: '공기', ...same(0), solid: false, opaque: false, breakable: false, hardness: 0 },
  [Block.Moss]: { name: '이끼', top: rgb(0x9ed98a), side: rgb(0x8fcc7d), bottom: rgb(0xc9a27e), solid: true, opaque: true, breakable: true, hardness: 0.5 },
  [Block.Soil]: { name: '흙', ...same(0xc9a27e), solid: true, opaque: true, breakable: true, hardness: 0.5 },
  [Block.Stone]: { name: '돌', ...same(0xb7bfcc), solid: true, opaque: true, breakable: true, hardness: 1.3 },
  [Block.Sand]: { name: '모래', ...same(0xf3e3b5), solid: true, opaque: true, breakable: true, hardness: 0.4 },
  [Block.Wood]: { name: '나무', top: rgb(0xe8c39a), side: rgb(0xb98a64), bottom: rgb(0xe8c39a), solid: true, opaque: true, breakable: true, hardness: 1.0 },
  [Block.Leaf]: { name: '잎', ...same(0x7fcf9b), solid: true, opaque: true, breakable: true, hardness: 0.2 },
  [Block.Plank]: { name: '판자', ...same(0xf0c98f), solid: true, opaque: true, breakable: true, hardness: 0.8 },
  [Block.Clay]: { name: '점토', ...same(0xf29b8f), solid: true, opaque: true, breakable: true, hardness: 1.2 },
  [Block.Glass]: { name: '투명 유리', ...same(0xe8f6ff), solid: true, opaque: false, breakable: true, hardness: 0.3, glass: true },
  [Block.Bedrock]: { name: '바닥돌', ...same(0x5d6270), solid: true, opaque: true, breakable: false, hardness: Infinity },
  [Block.Water]: { name: '물', ...same(0x7cc4f2), solid: false, opaque: false, breakable: false, hardness: Infinity },
  [Block.Blossom]: { name: '벚꽃잎', ...same(0xf6bdd3), solid: true, opaque: true, breakable: true, hardness: 0.2 },
  [Block.Maple]: { name: '단풍잎', ...same(0xef9a5b), solid: true, opaque: true, breakable: true, hardness: 0.2 },
  [Block.Snow]: { name: '눈', top: rgb(0xf7fafc), side: rgb(0xe6eef4), bottom: rgb(0xc9a27e), solid: true, opaque: true, breakable: true, hardness: 0.3 },
  [Block.Ice]: { name: '얼음', ...same(0xbfe4f4), solid: true, opaque: false, breakable: true, hardness: 0.5 },
  [Block.DryGrass]: { name: '마른풀', top: rgb(0xdcc27c), side: rgb(0xcfb56f), bottom: rgb(0xc9a27e), solid: true, opaque: true, breakable: true, hardness: 0.5 },
  [Block.Metal]: { name: '금속', ...same(0xc3cad4), solid: true, opaque: true, breakable: true, hardness: 1.2 },
  [Block.Asphalt]: { name: '도로', ...same(0x454b55), solid: true, opaque: true, breakable: true, hardness: 1.0 },
  [Block.RoadLine]: { name: '차선', ...same(0xe9edf2), solid: true, opaque: true, breakable: true, hardness: 1.0 },
  [Block.Neon]: { name: '네온', ...same(0x5ff2ff), solid: true, opaque: true, breakable: true, hardness: 0.4, glow: true },
  [Block.Window]: { name: '창문', ...same(0x7fa8c9), solid: true, opaque: true, breakable: true, hardness: 0.4 },
  [Block.WindowLit]: { name: '불 켜진 창', ...same(0xffd98a), solid: true, opaque: true, breakable: true, hardness: 0.4, glow: true },
  [Block.GateFrame]: { name: '차원문 틀', ...same(0x6d6a8a), solid: true, opaque: true, breakable: false, hardness: Infinity },
  [Block.PortalFuture]: { name: '미래로 가는 문', ...same(0x4fe3ff), solid: false, opaque: false, breakable: false, hardness: Infinity, glow: true, portal: true },
  [Block.PortalSpace]: { name: '우주로 가는 문', ...same(0xa47bff), solid: false, opaque: false, breakable: false, hardness: Infinity, glow: true, portal: true },
  [Block.PortalHome]: { name: '계곡으로 가는 문', ...same(0x8ff0a4), solid: false, opaque: false, breakable: false, hardness: Infinity, glow: true, portal: true },
  [Block.Asteroid]: { name: '소행성 암석', top: rgb(0x7a7186), side: rgb(0x6a6276), bottom: rgb(0x5c5568), solid: true, opaque: true, breakable: true, hardness: 1.4 },
  [Block.Crystal]: { name: '우주 수정', ...same(0xc3a3ff), solid: true, opaque: true, breakable: true, hardness: 0.8, glow: true },
  [Block.Station]: { name: '정거장 패널', ...same(0xe6eaf0), solid: true, opaque: true, breakable: true, hardness: 1.2 },
  [Block.Ember]: { name: '불씨', ...same(0xff7a3d), solid: true, opaque: true, breakable: true, hardness: 0.3, glow: true },
  [Block.Ash]: { name: '잿더미', ...same(0x4a4448), solid: true, opaque: true, breakable: true, hardness: 0.4 },
  [Block.GlassSky]: { name: '하늘색 유리', ...same(0x7cc8f2), solid: true, opaque: false, breakable: true, hardness: 0.3, glass: true },
  [Block.GlassRose]: { name: '분홍 유리', ...same(0xf59ac0), solid: true, opaque: false, breakable: true, hardness: 0.3, glass: true },
  [Block.GlassAmber]: { name: '호박색 유리', ...same(0xf5c060), solid: true, opaque: false, breakable: true, hardness: 0.3, glass: true },
  [Block.GlassMint]: { name: '민트 유리', ...same(0x7fe0b0), solid: true, opaque: false, breakable: true, hardness: 0.3, glass: true },
};

const BASE_PALETTE: Block[] = [Block.Moss, Block.Soil, Block.Stone, Block.Sand, Block.Wood, Block.Plank, Block.Clay];
/** Clear glass plus four tints, available everywhere. */
export const GLASS_PALETTE: Block[] = [Block.Glass, Block.GlassSky, Block.GlassRose, Block.GlassAmber, Block.GlassMint];
const SEASON_BLOCKS: Record<Season, Block[]> = {
  spring: [Block.Blossom, Block.Leaf],
  summer: [Block.Leaf, Block.Blossom],
  autumn: [Block.Maple, Block.DryGrass],
  winter: [Block.Snow, Block.Ice],
};

const FUTURE_PALETTE: Block[] = [Block.Metal, Block.Asphalt, Block.RoadLine, Block.Neon, Block.Window, Block.WindowLit, Block.Stone, Block.Clay, Block.Station];
const SPACE_PALETTE: Block[] = [Block.Station, Block.Metal, Block.Neon, Block.Asteroid, Block.Crystal, Block.WindowLit, Block.Stone, Block.Moss, Block.Clay];

/** Hotbar order: the basics plus that season's blocks, or the other dimensions' kits. */
export const paletteFor = (season: Season, dim: Dimension = 'valley'): Block[] =>
  [...(dim === 'future' ? FUTURE_PALETTE : dim === 'space' ? SPACE_PALETTE : [...BASE_PALETTE, ...SEASON_BLOCKS[season]]), ...GLASS_PALETTE];

export const isReplaceable = (b: Block) => b === Block.Air || b === Block.Water;
