import { Body, collides, inWater, move } from './physics';
import type { Season } from './blocks';
import { World } from './world';

export type Species = 'rabbit' | 'sheep' | 'fox' | 'penguin' | 'chick';
export const SPECIES_INFO: Record<Species, { name: string; color: number; speed: number; hp: number }> = {
  rabbit: { name: '토끼', color: 0xf3ece4, speed: 3.4, hp: 1 },
  sheep: { name: '양', color: 0xfafaf5, speed: 1.8, hp: 1 },
  fox: { name: '여우', color: 0xe8803a, speed: 3.0, hp: 1 },
  penguin: { name: '펭귄', color: 0x2c3340, speed: 1.6, hp: 1 },
  chick: { name: '병아리', color: 0xffd84a, speed: 2.2, hp: 1 },
};
const SEASON_ANIMALS: Record<Season, Species[]> = {
  spring: ['rabbit', 'chick', 'sheep'],
  summer: ['fox', 'sheep', 'chick'],
  autumn: ['fox', 'rabbit', 'sheep'],
  winter: ['penguin', 'rabbit', 'fox'],
};

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
  hp = 3;
  /** Set for animals. */
  species?: Species;
  /** A tamed animal: sticks close and follows you everywhere. */
  pet = false;
  /** Seconds left of the red "hit" flash. */
  hitFlash = 0;
  speed = SPEED;

  constructor(readonly id: string, readonly name: string, readonly color: number, x: number, y: number, z: number,
    private rand: () => number, readonly robot = false) {
    this.body = { x, y, z, vy: 0, onGround: false };
  }

  update(world: World, dt: number, player: { x: number; y: number; z: number }) {
    const b = this.body;
    const toPlayer = Math.hypot(player.x - b.x, player.z - b.z);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (toPlayer > (this.pet ? 14 : LEASH) || b.y < -5) {
      const [x, y, z] = world.findSpawn(Math.floor(player.x + (this.rand() - 0.5) * 8), Math.floor(player.z + (this.rand() - 0.5) * 8));
      Object.assign(b, { x, y, z, vy: 0 });
      return;
    }

    this.timer -= dt;
    if (this.timer <= 0) this.pickMode(toPlayer);

    let speed = 0;
    if (this.mode === 'follow') {
      this.heading = Math.atan2(-(player.x - b.x), -(player.z - b.z));
      speed = toPlayer > (this.pet ? 2.2 : 3) ? this.speed * (this.pet && toPlayer > 6 ? 1.4 : 1) : 0;
    } else if (this.mode === 'wander') {
      speed = this.speed * 0.6;
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
    // Pets stay at your heels; robots and wild animals mostly go about their business.
    const followChance = this.pet ? 0.85 : this.robot || this.species ? 0.12 : 0.35;
    if (toPlayer > (this.pet ? 4 : 10) || r < followChance) {
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

const ROBOT_COLORS = [0x5ff2ff, 0xff6f91, 0xffd166, 0x7cf29c, 0xa47bff];

/** Humanoid robot citizens for the future city, scattered along the streets around you. */
export function spawnRobots(world: World, near: { x: number; z: number }, count = 10): Bot[] {
  let s = (world.seed ^ 0x51ed270b) >>> 0;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const [x, y, z] = world.findSpawn(Math.floor(near.x + Math.cos(a) * 9), Math.floor(near.z + 6 + Math.sin(a) * 9));
    return new Bot(`robot-${i}`, `R-${String(i + 1).padStart(2, '0')}`, ROBOT_COLORS[i % ROBOT_COLORS.length], x, y, z, rand, true);
  });
}

/** Knock an entity back from a hit. */
export function knockBack(bot: Bot, from: { x: number; z: number }) {
  const dx = bot.body.x - from.x, dz = bot.body.z - from.z, d = Math.hypot(dx, dz) || 1;
  bot.body.vy = 5;
  bot.body.x += (dx / d) * 0.4;
  bot.body.z += (dz / d) * 0.4;
  bot.hitFlash = 0.25;
}

/** Wild animals of the season, scattered around you. */
export function spawnAnimals(world: World, near: { x: number; z: number }, season: Season, count = 6): Bot[] {
  let s = ((world.seed ^ 0x2545f491) + Math.floor(near.x) * 31 + Math.floor(near.z)) >>> 0;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const kinds = SEASON_ANIMALS[season];
  return Array.from({ length: count }, (_, i) => {
    const sp = kinds[i % kinds.length];
    const a = rand() * Math.PI * 2, r = 8 + rand() * 14;
    const [x, y, z] = world.findSpawn(Math.floor(near.x + Math.cos(a) * r), Math.floor(near.z + Math.sin(a) * r));
    return makeAnimal(`animal-${sp}-${i}-${Math.floor(rand() * 1e6)}`, sp, x, y, z, rand);
  });
}

export function makeAnimal(id: string, sp: Species, x: number, y: number, z: number, rand: () => number = Math.random): Bot {
  const info = SPECIES_INFO[sp];
  const bot = new Bot(id, info.name, info.color, x, y, z, rand);
  bot.species = sp;
  bot.speed = info.speed;
  bot.hp = info.hp;
  return bot;
}
