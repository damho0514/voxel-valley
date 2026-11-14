import AsyncStorage from '@react-native-async-storage/async-storage';
import { Block, Dimension } from './blocks';

// There is one saved world. It keeps the key of the old summer world (the one its terrain matches,
// so existing builds carry over); the very first save, from before worlds had keys, is the fallback.
const KEY = 'voxel-valley-go/save-v1-summer';
const LEGACY_KEY = 'voxel-valley-go/save-v1';

// Older saves also carry `inventory` and `season` fields; both are ignored now.
export type Save = {
  seed: number;
  edits: [string, Block][]; // the valley
  pos?: [number, number, number];
  dim?: Dimension; // where the player is
  dimEdits?: Partial<Record<Dimension, [string, Block][]>>; // the other dimensions
};

export async function loadSave(): Promise<Save | null> {
  try {
    const raw = (await AsyncStorage.getItem(KEY)) ?? (await AsyncStorage.getItem(LEGACY_KEY));
    return raw ? (JSON.parse(raw) as Save) : null;
  } catch {
    return null;
  }
}

export async function writeSave(save: Save) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Saving is best-effort.
  }
}

export async function clearSave() {
  try {
    await AsyncStorage.multiRemove([KEY, LEGACY_KEY]);
  } catch {}
}
