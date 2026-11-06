// End-to-end check of the room protocol against a running server.
// Usage: node test/smoke.mjs [ws://localhost:8787]
const base = process.argv[2] ?? 'ws://localhost:8787';
const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

function client(name) {
  const ws = new WebSocket(`${base}/room/${code}`);
  const inbox = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else inbox.push(m);
  };
  const opened = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const next = (pred, ms = 3000) => {
    const i = inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error(`${name}: timed out`)), ms);
    });
  };
  return { ws, opened, next, send: (m) => ws.send(JSON.stringify(m)) };
}

const check = (cond, what) => {
  if (!cond) throw new Error(`FAIL: ${what}`);
  console.log(`ok - ${what}`);
};

const stranger = client('stranger');
await stranger.opened;
stranger.send({ t: 'join', name: 'x', color: 1 });
check((await stranger.next((m) => m.t === 'error')).code === 'no-room', 'joining a missing room is refused');

const host = client('host');
await host.opened;
host.send({ t: 'create', name: '호스트', color: 0xff8800, seed: 2_000_001_234, season: 'winter', edits: [['1,20,1', 7]] });
const hw = await host.next((m) => m.t === 'welcome');
check(hw.seed === 2_000_001_234 && hw.players.length === 0, 'host creates the room');

const guest = client('guest');
await guest.opened;
guest.send({ t: 'join', name: '친구', color: 0x3388ff });
const gw = await guest.next((m) => m.t === 'welcome');
check(gw.seed === 2_000_001_234 && gw.season === 'winter' && gw.edits.some(([k, b]) => k === '1,20,1' && b === 7), 'guest gets seed and edits');
check(gw.players.length === 1 && gw.players[0].name === '호스트', 'guest sees the host');
check((await host.next((m) => m.t === 'joined')).player.name === '친구', 'host is told about the guest');

host.send({ t: 'pos', x: 3.5, y: 21, z: -2, yaw: 1 });
const p = await guest.next((m) => m.t === 'pos');
check(p.id === hw.id && p.x === 3.5, 'positions are relayed');

guest.send({ t: 'set', x: 5, y: 22, z: 5, b: 9 });
const s = await host.next((m) => m.t === 'set');
check(s.x === 5 && s.b === 9, 'block edits are relayed');

guest.send({ t: 'set', x: 5, y: 999, z: 5, b: 9 });
check((await guest.next((m) => m.t === 'error')).code === 'bad-message', 'out-of-range edits are rejected');

const late = client('late');
await late.opened;
late.send({ t: 'join', name: '늦게', color: 2 });
const lw = await late.next((m) => m.t === 'welcome');
check(lw.edits.some(([k, b]) => k === '5,22,5' && b === 9) && lw.players.length === 2, 'late joiner gets new edits and both players');
const lp = lw.players.find((pl) => pl.id === hw.id);
check(lp && lp.x === 3.5, 'late joiner gets last known positions');

guest.ws.close();
check((await host.next((m) => m.t === 'left')).id === gw.id, 'leaving is broadcast');

for (const c of [host, late, stranger]) c.ws.close();
console.log(`all good (room ${code})`);
process.exit(0);
