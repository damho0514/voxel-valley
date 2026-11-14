import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Dimension } from '../game/blocks';

/** Where the real photo hangs (world space) and which way it faces. */
export type FrameSpot = { x: number; y: number; z: number; nx: number; nz: number; w: number; h: number; dim: Dimension };
/** The last room built from a photo in this world: its colours and the picture on the wall. */
export type PhotoRoomRecord = { jpeg64: string; palette: number[]; title: string; frame: FrameSpot; at: number };

const key = (world: string) => `voxel-valley-go/photo-room-v1-${world}`;

export async function loadPhotoRoom(world: string): Promise<PhotoRoomRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(key(world));
    return raw ? (JSON.parse(raw) as PhotoRoomRecord) : null;
  } catch {
    return null;
  }
}

export async function savePhotoRoom(world: string, rec: PhotoRoomRecord) {
  try {
    await AsyncStorage.setItem(key(world), JSON.stringify(rec));
  } catch {
    // Storage full or unavailable: the room still stands, it just won't keep its colours.
  }
}
