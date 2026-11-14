/** A photo or screenshot, shrunk for analysis (longest side ~192px). */
export type Snap = {
  /** Shows the picture in the UI (a data: URI). */
  uri: string;
  /** The shrunk JPEG, base64 (what gets saved). */
  jpeg64: string;
  w: number;
  h: number;
  /** RGBA pixels, row 0 at the top. */
  rgba: Uint8Array;
};
export type PhotoSource = 'camera' | 'library';
/** The camera permission was refused (the UI says how to turn it back on). */
export class CameraDenied extends Error {}
export const SNAP_SIZE = 192;
