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
  Lava = 36,
  // Treasure, buried deeper the rarer it is (see game/treasure.ts).
  GoldOre = 37,
  RubyOre = 38,
  SapphireOre = 39,
  EmeraldOre = 40,
  DiamondOre = 41,
  Chest = 42,
  Rune = 43,
  // 내 방 사진: twelve blocks whose colours come from the last photo submitted (game/photoRoom.ts).
  Photo0 = 44, Photo1 = 45, Photo2 = 46, Photo3 = 47, Photo4 = 48, Photo5 = 49,
  Photo6 = 50, Photo7 = 51, Photo8 = 52, Photo9 = 53, Photo10 = 54, Photo11 = 55,
  // 꿀알바 street: the 24-hour convenience store and the night street around it (game/dimensions.ts).
  StoreTile = 56, StoreWall = 57, StoreSign = 58, CeilingLight = 59, ShelfSnack = 60, ShelfNoodle = 61,
  Cooler = 62, Counter = 63, Register = 64, CigWall = 65, CoffeeMachine = 66, Microwave = 67, HotWater = 68,
  Freezer = 69, Atm = 70, TrashBin = 71, PlasticTable = 72, PlasticChair = 73, Parasol = 74, DeliveryBox = 75,
  Sidewalk = 76, StreetLight = 77, Brick = 78, Shutter = 79, StaffDoor = 80, Bedding = 81, Awning = 82,
}

export const BLOCK_COUNT = 83;

/** The photo-colour blocks, in palette order (palette[i] paints PHOTO_BLOCKS[i]). */
export const PHOTO_BLOCKS: Block[] = Array.from({ length: 12 }, (_, i) => (Block.Photo0 + i) as Block);
export const isPhotoBlock = (b: Block) => b >= Block.Photo0 && b <= Block.Photo11;

/** The valley (seasonal), the future city, outer space, and the 꿀알바 store street (dug into). */
export type Dimension = 'valley' | 'future' | 'space' | 'store';
export const DIMENSION_INFO: Record<Dimension, { name: string; emoji: string }> = {
  valley: { name: '계곡', emoji: '🏞️' },
  future: { name: '미래 도시', emoji: '🚀' },
  space: { name: '우주', emoji: '🌌' },
  store: { name: '꿀알바', emoji: '🏪' },
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

/** Soft neutrals until a photo is submitted. */
export const PHOTO_DEFAULT = [0xe9e2d6, 0xcdbfa9, 0xa98f72, 0x8a9aa8, 0xd8c3c0, 0xb7c9b0, 0xf2eadf, 0x6f6a66, 0xc9b28f, 0x9fb3c8, 0xe8d5b0, 0x8c7a6b];
function photo(i: number): BlockInfo {
  return { name: `내 방 색 ${i + 1}`, ...same(PHOTO_DEFAULT[i]), solid: true, opaque: true, breakable: true, hardness: 0.6 };
}

export const BLOCKS: Record<Block, BlockInfo> = {
  [Block.Air]: { name: '공기', ...same(0), solid: false, opaque: false, breakable: false, hardness: 0 },
  [Block.Moss]: { name: '잔디', top: rgb(0x9ed98a), side: rgb(0x8fcc7d), bottom: rgb(0xc9a27e), solid: true, opaque: true, breakable: true, hardness: 0.5 },
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
  [Block.Metal]: { name: '메탈', ...same(0xc3cad4), solid: true, opaque: true, breakable: true, hardness: 1.2 },
  [Block.Asphalt]: { name: '도로', ...same(0x454b55), solid: true, opaque: true, breakable: true, hardness: 1.0 },
  [Block.RoadLine]: { name: '차선', ...same(0xe9edf2), solid: true, opaque: true, breakable: true, hardness: 1.0 },
  [Block.Neon]: { name: '네온', ...same(0x5ff2ff), solid: true, opaque: true, breakable: true, hardness: 0.4, glow: true },
  [Block.Window]: { name: '창문', ...same(0x7fa8c9), solid: true, opaque: true, breakable: true, hardness: 0.4 },
  [Block.WindowLit]: { name: '불 켜진 창', ...same(0xffd98a), solid: true, opaque: true, breakable: true, hardness: 0.4, glow: true },
  [Block.GateFrame]: { name: '차원문 틀', ...same(0xece6da), solid: true, opaque: true, breakable: false, hardness: Infinity },
  [Block.PortalFuture]: { name: '미래로 가는 문', ...same(0x4fe3ff), solid: false, opaque: false, breakable: false, hardness: Infinity, glow: true, portal: true },
  [Block.PortalSpace]: { name: '우주로 가는 문', ...same(0xffc86b), solid: false, opaque: false, breakable: false, hardness: Infinity, glow: true, portal: true },
  [Block.PortalHome]: { name: '계곡으로 가는 문', ...same(0x8ff0a4), solid: false, opaque: false, breakable: false, hardness: Infinity, glow: true, portal: true },
  [Block.Asteroid]: { name: '소행성 암석', top: rgb(0x7a7186), side: rgb(0x6a6276), bottom: rgb(0x5c5568), solid: true, opaque: true, breakable: true, hardness: 1.4 },
  [Block.Crystal]: { name: '우주 수정', ...same(0xc3a3ff), solid: true, opaque: true, breakable: true, hardness: 0.8, glow: true },
  [Block.Station]: { name: '정거장 패널', ...same(0xe6eaf0), solid: true, opaque: true, breakable: true, hardness: 1.2 },
  [Block.Ember]: { name: '불씨', ...same(0xff7a3d), solid: true, opaque: true, breakable: true, hardness: 0.3, glow: true },
  [Block.Ash]: { name: '잿더미', ...same(0x4a4448), solid: true, opaque: true, breakable: true, hardness: 0.4 },
  [Block.GlassSky]: { name: '하늘색 유리', ...same(0x7cc8f2), solid: true, opaque: false, breakable: true, hardness: 0.3, glass: true },
  [Block.GlassRose]: { name: '분홍 유리', ...same(0xf59ac0), solid: true, opaque: false, breakable: true, hardness: 0.3, glass: true },
  [Block.GlassAmber]: { name: '호박색 유리', ...same(0xf5c060), solid: true, opaque: false, breakable: true, hardness: 0.3, glass: true },
  [Block.Lava]: { name: '용암', top: rgb(0xff8a2a), side: rgb(0xf06a1e), bottom: rgb(0xd04a14), solid: false, opaque: true, breakable: false, hardness: Infinity, glow: true },
  [Block.GlassMint]: { name: '민트 유리', ...same(0x7fe0b0), solid: true, opaque: false, breakable: true, hardness: 0.3, glass: true },
  [Block.GoldOre]: { name: '금덩이 원석', ...same(0xf2c14e), solid: true, opaque: true, breakable: true, hardness: 1.0 },
  [Block.RubyOre]: { name: '홍옥 원석', ...same(0xff4f6d), solid: true, opaque: true, breakable: true, hardness: 1.0 },
  [Block.SapphireOre]: { name: '청옥 원석', ...same(0x4f8bff), solid: true, opaque: true, breakable: true, hardness: 1.0 },
  [Block.EmeraldOre]: { name: '비취 원석', ...same(0x3fd68a), solid: true, opaque: true, breakable: true, hardness: 1.0 },
  [Block.DiamondOre]: { name: '금강석 원석', ...same(0x9ff4ff), solid: true, opaque: true, breakable: true, hardness: 1.0, glow: true },
  [Block.Chest]: { name: '반닫이', top: rgb(0xb8783e), side: rgb(0xa0652f), bottom: rgb(0x7a4a22), solid: true, opaque: true, breakable: true, hardness: 0.6 },
  [Block.Rune]: { name: '부적 돌', ...same(0x8c6cff), solid: true, opaque: true, breakable: true, hardness: 0.6, glow: true },
  [Block.Photo0]: photo(0), [Block.Photo1]: photo(1), [Block.Photo2]: photo(2), [Block.Photo3]: photo(3),
  [Block.Photo4]: photo(4), [Block.Photo5]: photo(5), [Block.Photo6]: photo(6), [Block.Photo7]: photo(7),
  [Block.Photo8]: photo(8), [Block.Photo9]: photo(9), [Block.Photo10]: photo(10), [Block.Photo11]: photo(11),
  [Block.StoreTile]: { name: '편의점 바닥', ...same(0xeef0f2), solid: true, opaque: true, breakable: true, hardness: 0.8 },
  [Block.StoreWall]: { name: '편의점 벽', ...same(0xf4f1ea), solid: true, opaque: true, breakable: true, hardness: 0.8 },
  [Block.StoreSign]: { name: '꿀마트 간판', ...same(0xffc93c), solid: true, opaque: true, breakable: true, hardness: 0.5, glow: true },
  [Block.CeilingLight]: { name: '천장 조명', ...same(0xf8fbff), solid: true, opaque: true, breakable: true, hardness: 0.4, glow: true },
  [Block.ShelfSnack]: { name: '과자 진열대', ...same(0xff8a5c), solid: true, opaque: true, breakable: true, hardness: 0.4 },
  [Block.ShelfNoodle]: { name: '컵라면 진열대', ...same(0xe8473c), solid: true, opaque: true, breakable: true, hardness: 0.4 },
  [Block.Cooler]: { name: '음료 냉장고', ...same(0x9fd8ff), solid: true, opaque: true, breakable: true, hardness: 0.6, glow: true },
  [Block.Counter]: { name: '계산대', ...same(0xd9c3a0), solid: true, opaque: true, breakable: true, hardness: 0.8 },
  [Block.Register]: { name: '포스기', ...same(0x2e3440), solid: true, opaque: true, breakable: true, hardness: 0.5, glow: true },
  [Block.CigWall]: { name: '계산대 뒤 진열장', ...same(0x5a6b8c), solid: true, opaque: true, breakable: true, hardness: 0.4, glow: true },
  [Block.CoffeeMachine]: { name: '커피 머신', ...same(0x3a3330), solid: true, opaque: true, breakable: true, hardness: 0.6 },
  [Block.Microwave]: { name: '전자레인지', ...same(0xf2f2f2), solid: true, opaque: true, breakable: true, hardness: 0.5 },
  [Block.HotWater]: { name: '온수기', ...same(0xc8ccd2), solid: true, opaque: true, breakable: true, hardness: 0.5 },
  [Block.Freezer]: { name: '아이스크림 냉동고', ...same(0xbfe8ff), solid: true, opaque: true, breakable: true, hardness: 0.6, glow: true },
  [Block.Atm]: { name: 'ATM', ...same(0x2f6fd6), solid: true, opaque: true, breakable: true, hardness: 0.8, glow: true },
  [Block.TrashBin]: { name: '분리수거함', ...same(0x7b8794), solid: true, opaque: true, breakable: true, hardness: 0.5 },
  [Block.PlasticTable]: { name: '플라스틱 테이블', ...same(0x3fae5a), solid: true, opaque: true, breakable: true, hardness: 0.3 },
  [Block.PlasticChair]: { name: '플라스틱 의자', ...same(0x3f7fd6), solid: true, opaque: true, breakable: true, hardness: 0.3 },
  [Block.Parasol]: { name: '파라솔', ...same(0xf2f2f2), solid: true, opaque: true, breakable: true, hardness: 0.2 },
  [Block.DeliveryBox]: { name: '택배 상자', ...same(0xc89a62), solid: true, opaque: true, breakable: true, hardness: 0.3 },
  [Block.Sidewalk]: { name: '보도블록', ...same(0xb9b4ad), solid: true, opaque: true, breakable: true, hardness: 1.0 },
  [Block.StreetLight]: { name: '가로등', ...same(0xffe0a0), solid: true, opaque: true, breakable: true, hardness: 0.5, glow: true },
  [Block.Brick]: { name: '벽돌', ...same(0x8a4a3c), solid: true, opaque: true, breakable: true, hardness: 1.0 },
  [Block.Shutter]: { name: '셔터', ...same(0x9aa1aa), solid: true, opaque: true, breakable: true, hardness: 1.0 },
  [Block.StaffDoor]: { name: '직원 출입문', ...same(0x6f7a86), solid: true, opaque: true, breakable: true, hardness: 0.8 },
  [Block.Bedding]: { name: '이불', ...same(0x7fa6e0), solid: true, opaque: true, breakable: true, hardness: 0.2 },
  [Block.Awning]: { name: '차양', ...same(0xff9f2e), solid: true, opaque: true, breakable: true, hardness: 0.3 },
};

/** Recolours the photo blocks (their atlas tiles are repainted by render/textures.ts setPhotoTiles). */
export function setPhotoColors(colors: number[]) {
  PHOTO_BLOCKS.forEach((b, i) => {
    const c = rgb(colors[i] ?? PHOTO_DEFAULT[i]);
    Object.assign(BLOCKS[b], { top: c, side: c, bottom: c });
  });
}

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

/**
 * Hotbar: just the blocks people actually build with — clear glass, grass and metal — in every
 * world. (The full sets above stay for reference and the special-palette perk.)
 */
export const HOTBAR: Block[] = [Block.Glass, Block.Moss, Block.Metal];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const paletteFor = (_season: Season, _dim: Dimension = 'valley'): Block[] => [...HOTBAR];
export const FULL_PALETTES = { BASE_PALETTE, SEASON_BLOCKS, FUTURE_PALETTE, SPACE_PALETTE };

export const isReplaceable = (b: Block) => b === Block.Air || b === Block.Water || b === Block.Lava;
/** Liquids you sink and swim in. */
export const isLiquid = (b: Block) => b === Block.Water || b === Block.Lava;
