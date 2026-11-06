import { Body, collides, inWater, move } from './physics';
import { World } from './world';

const NAMES = ['토리', '모모', '라온'];
const COLORS = [0xf2c94c, 0xf27fb2, 0x5fd0c4];
const SPEED = 3.2;
const GRAVITY = -24;
const LEASH = 26; // farther than this from the player → hop back nearby

type Mode = 'wander' | 'follow' | 'idle';

/** A computer-controlled friend: wanders, follows you around, hops over steps, swims. */
export class Bot {
  readonly body: Body;
  yaw = 0;
  private mode: Mode = 'idle';
  private timer = 0;
  private heading = 0;
  private stuck = 0;

  constructor(readonly id: string, readonly name: string, readonly color: number, x: number, y: number, z: number, private rand: () => number) {
    this.body = { x, y, z, vy: 0, onGround: false };
  }

  update(world: World, dt: number, player: { x: number; y: number; z: number }) {
    const b = this.body;
    const toPlayer = Math.hypot(player.x - b.x, player.z - b.z);
    if (toPlayer > LEASH || b.y < -5) {
      const [x, y, z] = world.findSpawn(Math.floor(player.x + (this.rand() - 0.5) * 8), Math.floor(player.z + (this.rand() - 0.5) * 8));
      Object.assign(b, { x, y, z, vy: 0 });
      return;
    }

    this.timer -= dt;
    if (this.timer <= 0) this.pickMode(toPlayer);

    let speed = 0;
    if (this.mode === 'follow') {
      this.heading = Math.atan2(-(player.x - b.x), -(player.z - b.z));
      speed = toPlayer > 3 ? SPEED : 0;
    } else if (this.mode === 'wander') {
      speed = SPEED * 0.6;
    }
    // Turn smoothly toward the heading.
    let d = this.heading - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 6);

    const mx = -Math.sin(this.yaw) * speed * dt, mz = -Math.cos(this.yaw) * speed * dt;
    const swim = inWater(world, b);
    if (swim) b.vy = 2.5;
    else b.vy += GRAVITY * dt;

    const x0 = b.x, z0 = b.z;
    move(world, b, mx, b.vy * dt, mz);
    const moved = Math.hypot(b.x - x0, b.z - z0);
    if (speed > 0 && moved < speed * dt * 0.3) {
      // Blocked: hop if a single step is in the way, otherwise turn away.
      const ahead = { x: b.x + Math.sign(mx) * 0.6, z: b.z + Math.sign(mz) * 0.6 };
      const stepFree = !collides(world, ahead.x, b.y + 1.05, ahead.z);
      if (b.onGround && stepFree) b.vy = 8.2;
      else if (++this.stuck > 20) {
        this.heading += Math.PI * (0.5 + this.rand());
        this.stuck = 0;
      }
    } else this.stuck = 0;
  }

  private pickMode(toPlayer: number) {
    const r = this.rand();
    if (toPlayer > 10 || r < 0.35) {
      this.mode = 'follow';
      this.timer = 3 + this.rand() * 4;
    } else if (r < 0.75) {
      this.mode = 'wander';
      this.heading = this.rand() * Math.PI * 2;
      this.timer = 2 + this.rand() * 4;
    } else {
      this.mode = 'idle';
      this.heading = this.yaw + (this.rand() - 0.5) * 2;
      this.timer = 1.5 + this.rand() * 2.5;
    }
  }
}

export function spawnBots(world: World, near: { x: number; z: number }, count = NAMES.length): Bot[] {
  let s = (world.seed ^ 0x9e3779b9) >>> 0;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  return NAMES.slice(0, count).map((name, i) => {
    const [x, y, z] = world.findSpawn(Math.floor(near.x) + 2 + i * 2, Math.floor(near.z) + 2);
    return new Bot(`bot-${i}`, name, COLORS[i], x, y, z, rand);
  });
}
