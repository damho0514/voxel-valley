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
}

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
  [Block.Glass]: { name: '유리', ...same(0xd6f1fb), solid: true, opaque: false, breakable: true, hardness: 0.3 },
  [Block.Bedrock]: { name: '바닥돌', ...same(0x5d6270), solid: true, opaque: true, breakable: false, hardness: Infinity },
  [Block.Water]: { name: '물', ...same(0x7cc4f2), solid: false, opaque: false, breakable: false, hardness: Infinity },
};

/** Hotbar order. */
export const PLACEABLE: Block[] = [
  Block.Moss, Block.Soil, Block.Stone, Block.Sand, Block.Wood, Block.Plank, Block.Clay, Block.Glass, Block.Leaf,
];

export const isReplaceable = (b: Block) => b === Block.Air || b === Block.Water;
