import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/*
 * Speech recognition, when this build has it. Expo Go has no native speech-recognition module, and
 * the package throws as soon as it's imported there — which took the whole play screen down with
 * it. So the package is only loaded when its native side exists (or on web, where it uses the
 * browser's own). Without it, the 🎙️ button simply reports that it's unavailable.
 */
type Mod = typeof import('expo-speech-recognition');

const available = Platform.OS === 'web' || !!requireOptionalNativeModule('ExpoSpeechRecognition');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod: Mod | null = available ? (require('expo-speech-recognition') as Mod) : null;

export const SpeechRec = mod?.ExpoSpeechRecognitionModule ?? null;
/** Same as the package's hook; a no-op when there is no speech recognition. */
export const useSpeechRecEvent: Mod['useSpeechRecognitionEvent'] = mod ? mod.useSpeechRecognitionEvent : () => {};
