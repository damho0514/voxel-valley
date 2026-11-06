import { Block } from './blocks';

export type Inventory = Partial<Record<Block, number>>;

export const MAX_STACK = 999;
export const starterInventory = (): Inventory => ({ [Block.Plank]: 16, [Block.Glass]: 4 });

export function add(inv: Inventory, b: Block, n = 1) {
  if (b === Block.Air || n <= 0) return;
  inv[b] = Math.min(MAX_STACK, (inv[b] ?? 0) + n);
}

export function take(inv: Inventory, b: Block, n = 1): boolean {
  const have = inv[b] ?? 0;
  if (have < n) return false;
  if (have === n) delete inv[b];
  else inv[b] = have - n;
  return true;
}
