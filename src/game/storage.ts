import AsyncStorage from '@react-native-async-storage/async-storage';
import { Block } from './blocks';

const KEY = 'voxel-valley-go/save-v1';

// Older saves also carry an `inventory` field; it is ignored now that blocks are unlimited.
export type Save = { seed: number; edits: [string, Block][]; pos?: [number, number, number] };

export async function loadSave(): Promise<Save | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
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
    await AsyncStorage.removeItem(KEY);
  } catch {}
}
