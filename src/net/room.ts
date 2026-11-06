import { CODE_ALPHABET, CODE_LENGTH, PlayerInfo, SeasonName, ServerMsg } from '../../server/src/protocol';

export { isRoomCode } from '../../server/src/protocol';
export type { PlayerInfo } from '../../server/src/protocol';

/** wss://… of the room server. Set EXPO_PUBLIC_SERVER_URL to point at a local `wrangler dev`. */
export const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'wss://voxel-valley-server.voxel-valley-server.workers.dev';

export const newRoomCode = () =>
  Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

export type Hello =
  | { t: 'create'; name: string; color: number; seed: number; season: SeasonName; edits: [string, number][] }
  | { t: 'join'; name: string; color: number };

export type Welcome = Extract<ServerMsg, { t: 'welcome' }>;

export type RoomEvents = {
  onWelcome: (w: Welcome) => void;
  onEdit: (x: number, y: number, z: number, b: number) => void;
  onPlayers: (players: Map<string, PlayerInfo>) => void;
  onStatus: (status: 'connecting' | 'online' | 'offline', error?: string) => void;
};

/**
 * One connection to a shared room. Reconnects (re-joining the same room) if the socket drops,
 * so a flaky phone connection doesn't kick you out for good.
 */
export class RoomClient {
  readonly players = new Map<string, PlayerInfo>();
  private ws: WebSocket | null = null;
  private closed = false;
  private welcomed = false; // got the first welcome (the world) ever
  private joined = false; // the current socket is in the room
  private retry: ReturnType<typeof setTimeout> | null = null;
  private lastPos = '';
  private lastPosAt = 0;
  /** Our own edits made while disconnected; re-sent after re-joining. */
  private pending: [number, number, number, number][] = [];

  constructor(readonly code: string, private hello: Hello, private readonly ev: RoomEvents) {
    this.connect();
  }

  private connect() {
    this.ev.onStatus('connecting');
    this.joined = false;
    const ws = new WebSocket(`${SERVER_URL}/room/${this.code}`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(this.hello));
    ws.onmessage = (e) => this.handle(JSON.parse(String(e.data)) as ServerMsg);
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.players.clear();
      this.ev.onPlayers(this.players);
      if (this.closed || e.code === 4003 || e.code === 4004) return;
      this.ev.onStatus('offline', '연결이 끊겼어요. 다시 연결하는 중...');
      this.retry = setTimeout(() => this.connect(), 2000);
    };
  }

  private handle(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.joined = true;
        this.players.clear();
        for (const p of m.players) this.players.set(p.id, p);
        this.ev.onPlayers(this.players);
        this.ev.onStatus('online');
        // Reconnects re-join the existing world instead of overwriting it.
        if (this.hello.t === 'create') this.hello = { t: 'join', name: this.hello.name, color: this.hello.color };
        if (!this.welcomed) {
          this.welcomed = true;
          this.ev.onWelcome(m);
        } else {
          for (const [key, b] of m.edits) {
            const [x, y, z] = key.split(',').map(Number);
            this.ev.onEdit(x, y, z, b);
          }
          const mine = this.pending;
          this.pending = [];
          for (const [x, y, z, b] of mine) {
            this.ev.onEdit(x, y, z, b);
            this.sendEdit(x, y, z, b);
          }
        }
        this.lastPos = '';
        break;
      case 'joined':
        this.players.set(m.player.id, m.player);
        this.ev.onPlayers(this.players);
        break;
      case 'left':
        this.players.delete(m.id);
        this.ev.onPlayers(this.players);
        break;
      case 'pos': {
        const p = this.players.get(m.id);
        if (p) Object.assign(p, { x: m.x, y: m.y, z: m.z, yaw: m.yaw });
        break;
      }
      case 'set':
        this.ev.onEdit(m.x, m.y, m.z, m.b);
        break;
      case 'error':
        this.ev.onStatus('offline', m.message);
        break;
    }
  }

  private get open() {
    return this.joined && this.ws?.readyState === WebSocket.OPEN;
  }

  private send(msg: object) {
    if (this.open) this.ws!.send(JSON.stringify(msg));
  }

  /** Sends our position at most ~10 times a second, and only when it changed. */
  sendPos(x: number, y: number, z: number, yaw: number, now: number) {
    if (now - this.lastPosAt < 100) return;
    const r = (v: number) => Math.round(v * 100) / 100;
    const pos = { t: 'pos', x: r(x), y: r(y), z: r(z), yaw: r(yaw) };
    const key = JSON.stringify(pos);
    if (key === this.lastPos) return;
    this.lastPos = key;
    this.lastPosAt = now;
    this.send(pos);
  }

  sendEdit(x: number, y: number, z: number, b: number) {
    if (this.open) this.send({ t: 'set', x, y, z, b });
    else this.pending.push([x, y, z, b]);
  }

  close() {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
  }
}
