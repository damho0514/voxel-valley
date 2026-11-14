import { Body, collides, inWater, move } from './physics';
import type { Season } from './blocks';
import { World } from './world';
import { Look, PEOPLE } from './people';

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

const SPEED = 3.2;
const GRAVITY = -24;
const LEASH = 26; // farther than this from the player → hop back nearby

type Mode = 'wander' | 'follow' | 'idle';
/** What a bot shows over its head: "!" (hopping out of trouble), "?" (looking for another way). */
export type Emote = '' | '!' | '?' | '…';
/** How often a moving bot checks it's actually getting somewhere. */
const STUCK_WINDOW = 0.7;

/** A computer-controlled friend: wanders, follows you around, hops over steps, swims. */
export class Bot {
  readonly body: Body;
  yaw = 0;
  private mode: Mode = 'idle';
  private timer = 0;
  private heading = 0;
  /** Getting-unstuck state: how many tries in a row, a pause to look around, then a set way out. */
  private tries = 0;
  private lookTime = 0;
  private escapeTime = 0;
  private window = { t: 0, x: 0, z: 0 };
  /** Bubble over the head and how long it stays. */
  emote: Emote = '';
  private emoteTime = 0;
  hp = 3;
  /** Set for animals. */
  species?: Species;
  /** Set for the valley's people (see game/people.ts): how they look, talk and move. */
  look?: Look;
  /** How often they come over to you (0..1); people have their own. */
  followChance?: number;
  /** In a chat with you: stands still and faces you. */
  talking = false;
  /** Saying something in that chat: a "…" bubble over the head. */
  speaking = false;
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
    if (this.talking) {
      // Chatting: stop and look at you (the heading below turns the body round).
      this.mode = 'idle';
      this.heading = Math.atan2(-(player.x - b.x), -(player.z - b.z));
      this.timer = 1;
    } else if (this.timer <= 0) this.pickMode(toPlayer);

    let speed = 0;
    const escaping = this.lookTime > 0 || this.escapeTime > 0; // keep the way out it picked
    if (this.mode === 'follow') {
      if (!escaping) this.heading = Math.atan2(-(player.x - b.x), -(player.z - b.z));
      speed = toPlayer > (this.pet ? 2.2 : 3) ? this.speed * (this.pet && toPlayer > 6 ? 1.4 : 1) : 0;
    } else if (this.mode === 'wander') {
      speed = this.speed * 0.6;
    }
    // Getting unstuck overrides the plan: stand and look round, then walk the way that's open.
    if (this.speaking) this.say('…', 0.3);
    this.emoteTime = Math.max(0, this.emoteTime - dt);
    if (this.emoteTime === 0) this.emote = '';
    if (this.lookTime > 0) {
      this.lookTime -= dt;
      speed = 0;
    } else if (this.escapeTime > 0) {
      this.escapeTime -= dt;
      speed = this.speed * 0.8;
    }
    // Turn smoothly toward the heading (slower while looking round, so you can see it turn).
    let d = this.heading - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * (this.lookTime > 0 ? 3.5 : 6));

    const mx = -Math.sin(this.yaw) * speed * dt, mz = -Math.cos(this.yaw) * speed * dt;
    const swim = inWater(world, b);
    if (swim) b.vy = 2.5;
    else b.vy += GRAVITY * dt;

    const x0 = b.x, z0 = b.z;
    move(world, b, mx, b.vy * dt, mz);
    const moved = Math.hypot(b.x - x0, b.z - z0);
    // A single step in the way: hop it straight away (like the player's auto-jump).
    if (speed > 0 && moved < speed * dt * 0.3 && b.onGround && !collides(world, b.x + Math.sign(mx) * 0.6, b.y + 1.05, b.z + Math.sign(mz) * 0.6)) b.vy = 8.2;

    // Every STUCK_WINDOW, check it got somewhere; if not, escalate where everyone can see it.
    const w = this.window;
    w.t += dt;
    if (w.t >= STUCK_WINDOW) {
      const progress = Math.hypot(b.x - w.x, b.z - w.z);
      const wanted = speed > 0 && this.lookTime <= 0;
      if (wanted && progress < this.speed * STUCK_WINDOW * 0.25) this.unstick(world);
      else if (progress > 0.5) this.tries = 0;
      w.t = 0; w.x = b.x; w.z = b.z;
    }
  }

  private say(e: Emote, seconds: number) {
    this.emote = e;
    this.emoteTime = seconds;
  }

  /**
   * Stuck: 1st try a big hop ("!"); then stop, look round ("?") and turn to the most open way
   * nearest where it wanted to go, and walk it for a bit; deep in a pit, a huge leap; and if
   * nothing works, it pops back next to the player (handled by the leash in update()).
   */
  private unstick(world: World) {
    const b = this.body;
    this.tries++;
    if (this.tries === 1 || this.tries === 3) {
      if (b.onGround) b.vy = this.tries === 3 ? 11 : 8.6;
      this.say('!', 0.9);
      return;
    }
    if (this.tries > 5) {
      b.y = -10; // the leash check respawns it beside the player next frame
      this.tries = 0;
      return;
    }
    // Look round: score 8 directions by how far you can walk (stepping up one block is fine)
    // and how close they are to where it wanted to go.
    const want = this.heading;
    let best = want + Math.PI, bestScore = -Infinity;
    for (let i = 0; i < 8; i++) {
      const a = want + (i * Math.PI) / 4 + (this.rand() - 0.5) * 0.3;
      const dx = -Math.sin(a), dz = -Math.cos(a);
      let free = 0;
      for (const r of [0.8, 1.6, 2.4]) {
        const x = b.x + dx * r, z = b.z + dz * r;
        if (!collides(world, x, b.y + 0.05, z) || !collides(world, x, b.y + 1.05, z)) free++;
        else break;
      }
      const score = free * 1.5 + Math.cos(a - want) - (i === 0 ? 2 : 0); // not straight back into the wall
      if (score > bestScore) { bestScore = score; best = a; }
    }
    this.heading = best;
    this.lookTime = 0.7;
    this.escapeTime = 1.6;
    this.timer = Math.max(this.timer, 2.4); // don't re-plan mid-escape
    this.say('?', 1.1);
  }

  private pickMode(toPlayer: number) {
    const r = this.rand();
    // Pets stay at your heels; robots and wild animals mostly go about their business.
    const followChance = this.pet ? 0.85 : this.robot || this.species ? 0.12 : this.followChance ?? 0.35;
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

/** The valley's people (털보 아저씨, 안경 선배, 잼민이, 폰좀비, 바코드 부장님), around you. */
export function spawnBots(world: World, near: { x: number; z: number }, count = PEOPLE.length): Bot[] {
  let s = (world.seed ^ 0x9e3779b9) >>> 0;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  return PEOPLE.slice(0, count).map((p, i) => {
    const [x, y, z] = world.findSpawn(Math.floor(near.x) + 2 + i * 2, Math.floor(near.z) + 2 + (i % 2) * 2);
    const bot = new Bot(`bot-${p.look}`, p.name, p.color, x, y, z, rand);
    bot.look = p.look;
    bot.speed = p.speed;
    bot.followChance = p.follow;
    return bot;
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
