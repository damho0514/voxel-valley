import type * as PickerModule from 'expo-image-picker';
import type { PhotoSource, Snap } from './types';
import { SNAP_SIZE } from './types';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not read the image'));
    img.src = src;
  });
}

/** Draws the image small on a canvas: pixels + a compact JPEG to save. */
async function snapFrom(src: string, max = SNAP_SIZE): Promise<Snap> {
  const img = await loadImage(src);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  const rgba = new Uint8Array(g.getImageData(0, 0, w, h).data.buffer.slice(0));
  const uri = canvas.toDataURL('image/jpeg', 0.82);
  return { uri, jpeg64: uri.slice(uri.indexOf(',') + 1), w, h, rgba };
}

export async function decodeSnap(jpeg64: string): Promise<Snap> {
  return snapFrom(`data:image/jpeg;base64,${jpeg64}`, Infinity);
}

/**
 * The browser's own picker: on a phone, "camera" opens the camera straight away (capture), and
 * the library lets you choose any picture, screenshots included. On a computer both open a file.
 */
export async function pickPhoto(source: PhotoSource): Promise<Snap | null> {
  const ImagePicker = await import('expo-image-picker');
  const opts: PickerModule.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9 };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const a = !res.canceled ? res.assets?.[0] : undefined;
  if (!a) return null;
  return snapFrom(a.uri);
}
