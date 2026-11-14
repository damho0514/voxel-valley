import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/**
 * Device heat and battery saver, for frame pacing. Missing on web / Expo Go: reports "cool".
 *
 * thermal: 0 nominal · 1 fair (warm) · 2 serious (hot: the OS is about to throttle) · 3 critical
 * headroom (Android 11+): forecast of thermal headroom in 10 s; ≥ 1 means throttling; -1 unknown
 */
export type ThermalState = { thermal: 0 | 1 | 2 | 3; lowPower: boolean; headroom: number };

type Events = { onChange: (s: ThermalState) => void };
declare class VvThermalModule extends NativeModule<Events> {
  state(): ThermalState;
}

const Native = Platform.OS === 'web' ? null : requireOptionalNativeModule<VvThermalModule>('VvThermal');

const COOL: ThermalState = { thermal: 0, lowPower: false, headroom: -1 };

export const thermalAvailable = !!Native;

export function thermalState(): ThermalState {
  try {
    return Native ? { ...COOL, ...Native.state() } : COOL;
  } catch {
    return COOL;
  }
}

/** Calls `fn` whenever heat or battery saver changes. Returns an unsubscribe function. */
export function onThermalChange(fn: (s: ThermalState) => void): () => void {
  if (!Native) return () => {};
  const sub = Native.addListener('onChange', (s) => fn({ ...COOL, ...s }));
  return () => sub.remove();
}
