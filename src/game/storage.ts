import AsyncStorage from '@react-native-async-storage/async-storage';
import { Block, Dimension, Season } from './blocks';

// One saved world per season. The pre-season save (a summer-looking world) lives under the old key.
const LEGACY_KEY = 'voxel-valley-go/save-v1';
const keyFor = (season: Season) => `voxel-valley-go/save-v1-${season}`;

// Older saves also carry an `inventory` field; it is ignored now that blocks are unlimited.
export type Save = {
  seed: number;
  season?: Season;
  edits: [string, Block][]; // the valley
  pos?: [number, number, number];
  dim?: Dimension; // where the player is
  dimEdits?: Partial<Record<Dimension, [string, Block][]>>; // the future city and space
};

export async function loadSave(season: Season): Promise<Save | null> {
  try {
    let raw = await AsyncStorage.getItem(keyFor(season));
    if (!raw && season === 'summer') raw = await AsyncStorage.getItem(LEGACY_KEY);
    return raw ? { ...(JSON.parse(raw) as Save), season } : null;
  } catch {
    return null;
  }
}

/** Which seasons have a saved world. */
export async function savedSeasons(): Promise<Set<Season>> {
  const out = new Set<Season>();
  for (const s of ['spring', 'summer', 'autumn', 'winter'] as Season[]) if (await loadSave(s)) out.add(s);
  return out;
}

export async function writeSave(save: Save) {
  try {
    await AsyncStorage.setItem(keyFor(save.season ?? 'summer'), JSON.stringify(save));
  } catch {
    // Saving is best-effort.
  }
}

export async function clearSave(season: Season) {
  try {
    await AsyncStorage.removeItem(keyFor(season));
    if (season === 'summer') await AsyncStorage.removeItem(LEGACY_KEY);
  } catch {}
}
