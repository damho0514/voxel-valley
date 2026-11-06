// Messages exchanged between the app and a room. Shared by the server and the client
// (the client imports this file directly), so keep it free of platform APIs.

export const MAX_PLAYERS = 8;
export const WORLD_HEIGHT = 48;
export const BLOCK_TYPES = 12; // Block enum size in src/game/blocks.ts
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export type PlayerInfo = { id: string; name: string; color: number; x: number; y: number; z: number; yaw: number };

export type ClientMsg =
  | { t: 'create'; name: string; color: number; seed: number; edits: [string, number][] }
  | { t: 'join'; name: string; color: number }
  | { t: 'pos'; x: number; y: number; z: number; yaw: number }
  | { t: 'set'; x: number; y: number; z: number; b: number };

export type ServerMsg =
  | { t: 'welcome'; id: string; seed: number; edits: [string, number][]; players: PlayerInfo[] }
  | { t: 'joined'; player: PlayerInfo }
  | { t: 'left'; id: string }
  | { t: 'pos'; id: string; x: number; y: number; z: number; yaw: number }
  | { t: 'set'; x: number; y: number; z: number; b: number }
  | { t: 'error'; code: 'no-room' | 'full' | 'bad-message'; message: string };

export const isRoomCode = (s: string) =>
  s.length === CODE_LENGTH && [...s].every((c) => CODE_ALPHABET.includes(c));

const isInt = (v: unknown): v is number => Number.isInteger(v) && Math.abs(v as number) < 1_000_000;
const isSeed = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 2 ** 31;
const isColor =(v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffff;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1_000_000;
export const isBlock = (b: unknown): b is number => Number.isInteger(b) && (b as number) >= 0 && (b as number) < BLOCK_TYPES;
export const isEditKey = (k: unknown): k is string => {
  if (typeof k !== 'string') return false;
  const p = k.split(',');
  return p.length === 3 && p.every((n) => /^-?\d{1,6}$/.test(n)) && Number(p[1]) >= 0 && Number(p[1]) < WORLD_HEIGHT;
};

export function cleanName(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().slice(0, 12) : '';
  return s || '여행자';
}

/** Parses and validates one client message; returns null if it's malformed. */
export function parseClientMsg(raw: string): ClientMsg | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'create':
      if (!isSeed(m.seed) || !Array.isArray(m.edits) || !isColor(m.color)) return null;
      if (!m.edits.every((e) => Array.isArray(e) && isEditKey(e[0]) && isBlock(e[1]))) return null;
      return { t: 'create', name: cleanName(m.name), color: m.color, seed: m.seed, edits: m.edits as [string, number][] };
    case 'join':
      if (!isColor(m.color)) return null;
      return { t: 'join', name: cleanName(m.name), color: m.color };
    case 'pos':
      if (!isNum(m.x) || !isNum(m.y) || !isNum(m.z) || !isNum(m.yaw)) return null;
      return { t: 'pos', x: m.x, y: m.y, z: m.z, yaw: m.yaw };
    case 'set':
      if (!isInt(m.x) || !isInt(m.y) || !isInt(m.z) || !isBlock(m.b)) return null;
      if (m.y < 0 || m.y >= WORLD_HEIGHT) return null;
      return { t: 'set', x: m.x, y: m.y, z: m.z, b: m.b };
    default:
      return null;
  }
}
