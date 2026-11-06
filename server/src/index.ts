import { DurableObject } from 'cloudflare:workers';
import { isRoomCode, MAX_PLAYERS, parseClientMsg, PlayerInfo, ServerMsg } from './protocol';

type Env = { ROOMS: DurableObjectNamespace<Room> };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/room\/([A-Z0-9]+)$/.exec(url.pathname);
    if (match) {
      if (!isRoomCode(match[1])) return new Response('bad room code', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
    }
    if (url.pathname === '/') return new Response('Voxel Valley server ok');
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * One shared world. Holds the seed and every block edit (persisted, so a room survives restarts
 * and everyone leaving), and relays player positions. Uses WebSocket hibernation: the object
 * can be evicted between messages, so per-player state lives in each socket's attachment.
 */
export class Room extends DurableObject<Env> {
  private seed: number | null = null;
  private edits = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.seed = (await ctx.storage.get<number>('seed')) ?? null;
      for (const [k, b] of await ctx.storage.list<number>({ prefix: 'e:' })) this.edits.set(k.slice(2), b);
    });
  }

  async fetch(): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private players(except?: WebSocket) {
    const out: { ws: WebSocket; info: PlayerInfo }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const info = ws.deserializeAttachment() as PlayerInfo | null;
      if (info && ws !== except) out.push({ ws, info });
    }
    return out;
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already closing; its close handler cleans up.
    }
  }

  private broadcast(msg: ServerMsg, except?: WebSocket) {
    const raw = JSON.stringify(msg);
    for (const { ws } of this.players(except)) {
      try {
        ws.send(raw);
      } catch {}
    }
  }

  private async saveEdits(entries: [string, number][]) {
    for (let i = 0; i < entries.length; i += 128) {
      const batch: Record<string, number> = {};
      for (const [k, b] of entries.slice(i, i + 128)) batch[`e:${k}`] = b;
      await this.ctx.storage.put(batch);
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const msg = typeof raw === 'string' ? parseClientMsg(raw) : null;
    if (!msg) {
      this.send(ws, { t: 'error', code: 'bad-message', message: '잘못된 메시지' });
      return;
    }
    const me = ws.deserializeAttachment() as PlayerInfo | null;

    if (msg.t === 'create' || msg.t === 'join') {
      if (me) return; // already in the room
      if (this.seed === null) {
        if (msg.t === 'join') {
          this.send(ws, { t: 'error', code: 'no-room', message: '그런 방이 없어요. 코드를 확인해 주세요.' });
          ws.close(4004, 'no room');
          return;
        }
        this.seed = msg.seed;
        for (const [k, b] of msg.edits) this.edits.set(k, b);
        await this.ctx.storage.put('seed', msg.seed);
        await this.saveEdits(msg.edits);
      }
      if (this.players().length >= MAX_PLAYERS) {
        this.send(ws, { t: 'error', code: 'full', message: `방이 가득 찼어요 (최대 ${MAX_PLAYERS}명).` });
        ws.close(4003, 'full');
        return;
      }
      const info: PlayerInfo = { id: crypto.randomUUID().slice(0, 8), name: msg.name, color: msg.color, x: 0, y: -100, z: 0, yaw: 0 };
      const others = this.players().map((p) => p.info);
      ws.serializeAttachment(info);
      this.send(ws, { t: 'welcome', id: info.id, seed: this.seed, edits: [...this.edits], players: others });
      this.broadcast({ t: 'joined', player: info }, ws);
      return;
    }

    if (!me) return; // must create/join first
    if (msg.t === 'pos') {
      ws.serializeAttachment({ ...me, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw });
      this.broadcast({ t: 'pos', id: me.id, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw }, ws);
    } else if (msg.t === 'set') {
      const key = `${msg.x},${msg.y},${msg.z}`;
      this.edits.set(key, msg.b);
      this.broadcast({ t: 'set', x: msg.x, y: msg.y, z: msg.z, b: msg.b }, ws);
      await this.ctx.storage.put(`e:${key}`, msg.b);
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.leave(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.leave(ws);
  }

  private leave(ws: WebSocket) {
    const me = ws.deserializeAttachment() as PlayerInfo | null;
    ws.serializeAttachment(null);
    if (me) this.broadcast({ t: 'left', id: me.id }, ws);
    try {
      ws.close(1000, 'bye');
    } catch {}
  }
}
