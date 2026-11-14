import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Asset } from 'expo-asset';
import { Platform } from 'react-native';

/**
 * Short game sounds through the local `vv-sfx` module (SoundPool on Android, AVAudioPlayer on
 * iOS): decoded once, and play() returns immediately. expo-audio's play() blocks the JS thread
 * until the UI thread answers, which showed up as 30–80 ms hitches every time a block broke.
 * Missing on web / Expo Go: callers fall back to expo-audio.
 */
declare class VvSfxModule extends NativeModule {
  load(uri: string): Promise<number>;
  play(id: number, volume: number): boolean;
}

const Native = Platform.OS === 'web' ? null : requireOptionalNativeModule<VvSfxModule>('VvSfx');

export const sfxAvailable = !!Native;

const ids = new Map<string, number>();

/** Loads sounds one after another (in the background); each becomes playable when it's ready. */
export async function loadSfx(files: Record<string, number>, order: string[]) {
  if (!Native) return;
  for (const name of order) {
    if (ids.has(name)) continue;
    try {
      const asset = Asset.fromModule(files[name]);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      const id = await Native.load(uri);
      if (id) ids.set(name, id);
    } catch (e) {
      console.warn('sfx load failed', name, e);
    }
  }
}

/** True if the sound played here; false means "not loaded (yet)", so use the fallback. */
export function playSfx(name: string, volume: number): boolean {
  const id = ids.get(name);
  if (!Native || !id) return false;
  try {
    return Native.play(id, volume);
  } catch {
    return false;
  }
}
