import { Block, BLOCKS, Dimension, isReplaceable, paletteFor, PORTAL_TARGET } from './blocks';
import { arrival } from './dimensions';
import { Body, collides, EYE_HEIGHT, inWater, move, PLAYER_HALF, PLAYER_HEIGHT } from './physics';
import { Hit, raycast } from './raycast';
import { Save } from './storage';
import { HEIGHT, toChunk, World } from './world';

export const REACH = 6;
const WALK = 4.6;
const GRAVITY = -24;
const JUMP_SPEED = 8.2;
const DAY_SECONDS = 480;

/** What the on-screen controls (or keyboard) want this frame. */
export type Input = {
  moveX: number; // strafe -1..1
  moveY: number; // forward -1..1
  lookDX: number; // accumulated pixels since last frame
  lookDY: number;
  jump: boolean;
  down?: boolean; // space only: thrust downward
  dig: boolean;
  placeTap: boolean; // consumed once per press
};

export type SoundName = 'dig' | 'break' | 'place' | 'step' | 'jump' | 'splash' | 'portal' | 'thrust';

export type HudState = {
  selected: number;
  dig: number; // 0..1
  timeLabel: string;
  target: string | null;
};

/** All gameplay state and rules; rendering-agnostic. */
export class Game {
  world: World;
  private readonly worlds = new Map<Dimension, World>();
  readonly body: Body;
  /** Velocity while floating in space. */
  private vel = { x: 0, y: 0, z: 0 };
  private portalCooldown = 0;
  yaw = 0;
  pitch = 0;
  selected = 0;
  target: Hit | null = null;
  /** Aim along this direction instead of the crosshair (a finger on a block). */
  aimRay: { x: number; y: number; z: number } | null = null;
  time = 0.08; // 0 sunrise, 0.25 noon, 0.75 midnight
  private digProgress = 0;
  private digKey = '';
  private spawned = false;
  private stride = 0; // distance walked since the last footstep
  private digSoundAt = 0;
  private wasInWater = false;
  dirty = false; // something worth saving changed

  /** Called with (x, z) whenever a block changes so the renderer can rebuild. */
  onBlockChanged: (x: number, z: number) => void = () => {};
  /** Called when this player digs or places a block (for sending to a shared room). */
  onEdit: (x: number, y: number, z: number, b: Block) => void = () => {};
  onSound: (s: SoundName) => void = () => {};
  /** Called after stepping through a gate into another dimension. */
  onDimension: (dim: Dimension) => void = () => {};

  constructor(save: Save | null) {
    const seed = save?.seed ?? Math.floor(Math.random() * 2 ** 31);
    const valley = new World(seed, save?.season ?? 'summer');
    this.worlds.set('valley', valley);
    for (const [key, b] of save?.edits ?? []) valley.edits.set(key, b);
    for (const d of ['future', 'space'] as Dimension[]) for (const [key, b] of save?.dimEdits?.[d] ?? []) this.worldFor(d).edits.set(key, b);
    this.world = this.worldFor(save?.dim ?? 'valley');
    const p = save?.pos ?? this.world.findSpawn(0, 0);
    this.body = { x: p[0], y: p[1], z: p[2], vy: 0, onGround: false };
    this.spawned = !!save?.pos;
  }

  get dim(): Dimension {
    return this.world.dim;
  }

  get palette(): Block[] {
    return paletteFor(this.world.season, this.world.dim);
  }

  /** The world for a dimension; same seed and season, created on first use. */
  worldFor(dim: Dimension): World {
    let w = this.worlds.get(dim);
    if (!w) {
      const valley = this.worlds.get('valley')!;
      w = new World(valley.seed, valley.season, dim);
      this.worlds.set(dim, w);
    }
    return w;
  }

  /** Steps through a gate: switch worlds and land at that dimension's arrival point. */
  enterDimension(to: Dimension) {
    const from = this.dim;
    this.world = this.worldFor(to);
    const a = arrival(this.world, to, from);
    Object.assign(this.body, { x: a.pos[0], y: a.pos[1], z: a.pos[2], vy: 0 });
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = a.yaw;
    this.pitch = 0;
    this.spawned = true;
    this.portalCooldown = 1.5;
    this.selected = Math.min(this.selected, this.palette.length - 1);
    this.target = null;
    this.dirty = true;
    this.onSound('portal');
    this.onDimension(to);
  }

  /** Gate under the player's body, if any. */
  private portalHere(): Dimension | null {
    const b = this.body;
    for (let y = Math.floor(b.y); y <= Math.floor(b.y + PLAYER_HEIGHT - 0.01); y++)
      for (const [dx, dz] of [[-PLAYER_HALF, -PLAYER_HALF], [PLAYER_HALF, PLAYER_HALF], [0, 0]]) {
        const to = PORTAL_TARGET[this.world.get(Math.floor(b.x + dx), y, Math.floor(b.z + dz))];
        if (to) return to;
      }
    return null;
  }

  get selectedBlock(): Block {
    return this.palette[this.selected];
  }

  get daylight() {
    const s = Math.sin(this.time * Math.PI * 2);
    return 0.25 + 0.75 * Math.min(1, Math.max(0, s * 3 + 0.35));
  }

  eye() {
    return { x: this.body.x, y: this.body.y + EYE_HEIGHT, z: this.body.z };
  }

  lookDir() {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }

  /** Advances the simulation. `ready` = terrain under the player is built. */
  update(dt: number, input: Input, ready: boolean) {
    dt = Math.min(dt, 0.05);
    this.time = (this.time + dt / DAY_SECONDS) % 1;

    this.yaw -= input.lookDX * 0.0055;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - input.lookDY * 0.0055));

    if (!ready) return;
    if (!this.spawned) {
      const [x, y, z] = this.world.findSpawn(Math.floor(this.body.x), Math.floor(this.body.z));
      Object.assign(this.body, { x, y, z, vy: 0 });
      this.spawned = true;
    }

    this.portalCooldown -= dt;
    if (this.portalCooldown <= 0) {
      const to = this.portalHere();
      if (to && to !== this.dim) {
        this.enterDimension(to);
        return;
      }
    }

    if (this.dim === 'space') {
      this.fly(dt, input);
      this.aim();
      this.updateDig(dt, input.dig);
      if (input.placeTap) this.place();
      return;
    }

    // Walk relative to where we're looking (yaw only).
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const swim = inWater(this.world, this.body);
    const speed = WALK * (swim ? 0.6 : 1);
    const mx = (input.moveX * cos - input.moveY * sin) * speed * dt;
    const mz = (-input.moveX * sin - input.moveY * cos) * speed * dt;

    const fallSpeed = -this.body.vy;
    if (swim) {
      this.body.vy = input.jump ? 3.2 : Math.max(this.body.vy + GRAVITY * 0.15 * dt, -1.6);
    } else {
      if (this.body.onGround && input.jump) {
        this.body.vy = JUMP_SPEED;
        this.onSound('jump');
      }
      this.body.vy += GRAVITY * dt;
    }
    const bx = this.body.x, bz = this.body.z;
    move(this.world, this.body, mx, this.body.vy * dt, mz);
    if (this.body.onGround && !swim) {
      this.stride += Math.hypot(this.body.x - bx, this.body.z - bz);
      if (this.stride > 1.7) {
        this.stride = 0;
        this.onSound('step');
      }
    }
    if (swim && !this.wasInWater && fallSpeed > 3) this.onSound('splash');
    this.wasInWater = swim;
    if (this.body.y < -10) this.spawned = false; // fell out of the world: respawn

    this.aim();
    this.updateDig(dt, input.dig);
    if (input.placeTap) this.place();
  }

  /**
   * Zero-gravity flight: thrust along where you look (joystick), straight up/down (buttons),
   * with gentle drag so you drift to a stop.
   */
  private fly(dt: number, input: Input) {
    const d = this.lookDir();
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw); // right vector
    const up = (input.jump ? 1 : 0) - (input.down ? 1 : 0);
    const thrust = 9;
    const v = this.vel;
    v.x += (d.x * input.moveY + rx * input.moveX) * thrust * dt;
    v.y += (d.y * input.moveY + up) * thrust * dt;
    v.z += (d.z * input.moveY + rz * input.moveX) * thrust * dt;
    const drag = Math.exp(-dt * 0.9);
    v.x *= drag; v.y *= drag; v.z *= drag;
    const speed = Math.hypot(v.x, v.y, v.z), max = 10;
    if (speed > max) { v.x *= max / speed; v.y *= max / speed; v.z *= max / speed; }
    if ((input.moveX || input.moveY || up) && Math.random() < dt * 4) this.onSound('thrust');
    const before = { x: this.body.x, y: this.body.y, z: this.body.z };
    move(this.world, this.body, v.x * dt, v.y * dt, v.z * dt);
    // Bump: lose the velocity along any axis that hit something.
    if (Math.abs(this.body.x - before.x) < Math.abs(v.x * dt) * 0.5) v.x = 0;
    if (Math.abs(this.body.y - before.y) < Math.abs(v.y * dt) * 0.5) v.y = 0;
    if (Math.abs(this.body.z - before.z) < Math.abs(v.z * dt) * 0.5) v.z = 0;
    // Drifting too far out: a soft tether back toward the station.
    if (this.body.y < -30 || this.body.y > 90) v.y += (this.body.y < 0 ? 1 : -1) * 20 * dt;
  }

  private aim() {
    const e = this.eye(), d = this.aimRay ?? this.lookDir();
    this.target = raycast(this.world, e.x, e.y, e.z, d.x, d.y, d.z, REACH);
  }

  private updateDig(dt: number, held: boolean) {
    const t = this.target;
    const key = t ? `${t.x},${t.y},${t.z}` : '';
    if (!held || !t || key !== this.digKey) {
      this.digProgress = 0;
      this.digKey = key;
      return;
    }
    const info = BLOCKS[this.world.get(t.x, t.y, t.z)];
    if (!info.breakable) return;
    this.digProgress += dt / Math.max(0.05, info.hardness);
    this.digSoundAt -= dt;
    if (this.digSoundAt <= 0) {
      this.digSoundAt = 0.22;
      this.onSound('dig');
    }
    if (this.digProgress >= 1) {
      this.onSound('break');
      this.world.set(t.x, t.y, t.z, Block.Air);
      this.digProgress = 0;
      this.dirty = true;
      this.onBlockChanged(t.x, t.z);
      this.onEdit(t.x, t.y, t.z, Block.Air);
    }
  }

  get dig() {
    return this.digProgress;
  }

  place() {
    const t = this.target;
    if (!t) return;
    const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
    const b = this.selectedBlock;
    if (y < 1 || y >= HEIGHT || !isReplaceable(this.world.get(x, y, z))) return;
    // Blocks are unlimited. Don't build inside yourself.
    const p = this.body;
    const overlaps = p.x + PLAYER_HALF > x && p.x - PLAYER_HALF < x + 1 &&
      p.z + PLAYER_HALF > z && p.z - PLAYER_HALF < z + 1 &&
      p.y + PLAYER_HEIGHT > y && p.y < y + 1;
    if (overlaps) return;
    this.world.set(x, y, z, b);
    if (collides(this.world, p.x, p.y, p.z)) { // safety net
      this.world.set(x, y, z, Block.Air);
      return;
    }
    this.dirty = true;
    this.onSound('place');
    this.onBlockChanged(x, z);
    this.onEdit(x, y, z, b);
  }

  /** A block changed by another player in the room. */
  applyRemoteEdit(x: number, y: number, z: number, b: Block, dim: Dimension = 'valley') {
    if (y < 0 || y >= HEIGHT) return;
    const w = this.worldFor(dim);
    // Only touch chunk data that's already loaded; unloaded chunks pick the edit up when generated.
    if (w.hasChunk(toChunk(x), toChunk(z))) w.set(x, y, z, b);
    else w.edits.set(`${x},${y},${z}`, b);
    if (w !== this.world) return;
    // If it landed on us, step up out of it.
    const p = this.body;
    if (collides(this.world, p.x, p.y, p.z)) p.y = Math.min(HEIGHT, y + 1);
    this.dirty = true;
    this.onBlockChanged(x, z);
  }

  hud(): HudState {
    const hours = (this.time * 24 + 6) % 24;
    const night = this.daylight < 0.5;
    const t = this.target ? BLOCKS[this.world.get(this.target.x, this.target.y, this.target.z)].name : null;
    return {
      selected: this.selected,
      dig: this.digProgress,
      timeLabel: `${night ? '밤' : '낮'} ${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}`,
      target: t,
    };
  }

  toSave(): Save {
    return {
      seed: this.world.seed,
      season: this.world.season,
      edits: [...this.worldFor('valley').edits.entries()],
      dim: this.dim,
      dimEdits: { future: [...this.worldFor('future').edits.entries()], space: [...this.worldFor('space').edits.entries()] },
      pos: [this.body.x, this.body.y, this.body.z],
    };
  }
}
