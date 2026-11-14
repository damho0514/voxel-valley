import type * as PickerModule from 'expo-image-picker';
import type { decode as Decode } from 'jpeg-js';
import { CameraDenied, PhotoSource, Snap, SNAP_SIZE } from './types';

// Only the decoder: the package's index also pulls in the encoder.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const decodeJpeg: typeof Decode = require('jpeg-js/lib/decoder');

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;
function base64ToBytes(s: string): Uint8Array {
  s = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = LOOKUP[s.charCodeAt(i)], b = LOOKUP[s.charCodeAt(i + 1)];
    const c = LOOKUP[s.charCodeAt(i + 2)], d = LOOKUP[s.charCodeAt(i + 3)];
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < s.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < s.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

/** Decodes a saved snap (base64 JPEG) back into pixels. */
export async function decodeSnap(jpeg64: string): Promise<Snap> {
  const img = decodeJpeg(base64ToBytes(jpeg64), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 });
  return { uri: `data:image/jpeg;base64,${jpeg64}`, jpeg64, w: img.width, h: img.height, rgba: img.data };
}

/** Takes a photo, or lets the player pick one (a screenshot works too). Null if they backed out. */
export async function pickPhoto(source: PhotoSource): Promise<Snap | null> {
  // Loaded on first use: an app build made before these native modules were added still starts
  // (and plays) normally; only this button reports that it can't open photos.
  const [ImagePicker, { ImageManipulator, SaveFormat }] = await Promise.all([import('expo-image-picker'), import('expo-image-manipulator')]);
  const opts: PickerModule.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9, allowsEditing: false, exif: false };
  let res: PickerModule.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new CameraDenied('camera permission refused');
    res = await ImagePicker.launchCameraAsync(opts);
  } else {
    res = await ImagePicker.launchImageLibraryAsync(opts);
  }
  const a = !res.canceled ? res.assets?.[0] : undefined;
  if (!a) return null;
  // Shrink on the native side (fast, and it applies the photo's rotation), then decode the small JPEG here.
  const ctx = ImageManipulator.manipulate(a.uri);
  ctx.resize(a.width >= a.height ? { width: SNAP_SIZE } : { height: SNAP_SIZE });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
  ctx.release();
  ref.release();
  if (!out.base64) throw new Error('no image data');
  return decodeSnap(out.base64);
}
