import { Block, BLOCKS, dropOf, isReplaceable, PLACEABLE } from './blocks';
import { add, Inventory, starterInventory, take } from './inventory';
import { Body, collides, EYE_HEIGHT, inWater, move, PLAYER_HALF, PLAYER_HEIGHT } from './physics';
import { Hit, raycast } from './raycast';
import { Save } from './storage';
import { HEIGHT, World } from './world';

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
  dig: boolean;
  placeTap: boolean; // consumed once per press
};

export type HudState = {
  selected: number;
  inventory: Inventory;
  dig: number; // 0..1
  timeLabel: string;
  target: string | null;
};

/** All gameplay state and rules; rendering-agnostic. */
export class Game {
  readonly world: World;
  readonly body: Body;
  yaw = 0;
  pitch = 0;
  inventory: Inventory;
  selected = 0;
  target: Hit | null = null;
  time = 0.08; // 0 sunrise, 0.25 noon, 0.75 midnight
  private digProgress = 0;
  private digKey = '';
  private spawned = false;
  dirty = false; // something worth saving changed

  /** Called with (x, z) whenever a block changes so the renderer can rebuild. */
  onBlockChanged: (x: number, z: number) => void = () => {};

  constructor(save: Save | null) {
    this.world = new World(save?.seed ?? Math.floor(Math.random() * 2 ** 31));
    for (const [key, b] of save?.edits ?? []) this.world.edits.set(key, b);
    this.inventory = save?.inventory ?? starterInventory();
    const p = save?.pos ?? this.world.findSpawn(0, 0);
    this.body = { x: p[0], y: p[1], z: p[2], vy: 0, onGround: false };
    this.spawned = !!save?.pos;
  }

  get selectedBlock(): Block {
    return PLACEABLE[this.selected];
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

    // Walk relative to where we're looking (yaw only).
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const swim = inWater(this.world, this.body);
    const speed = WALK * (swim ? 0.6 : 1);
    const mx = (input.moveX * cos - input.moveY * sin) * speed * dt;
    const mz = (-input.moveX * sin - input.moveY * cos) * speed * dt;

    if (swim) {
      this.body.vy = input.jump ? 3.2 : Math.max(this.body.vy + GRAVITY * 0.15 * dt, -1.6);
    } else {
      if (this.body.onGround && input.jump) this.body.vy = JUMP_SPEED;
      this.body.vy += GRAVITY * dt;
    }
    move(this.world, this.body, mx, this.body.vy * dt, mz);
    if (this.body.y < -10) this.spawned = false; // fell out of the world: respawn

    this.aim();
    this.updateDig(dt, input.dig);
    if (input.placeTap) this.place();
  }

  private aim() {
    const e = this.eye(), d = this.lookDir();
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
    if (this.digProgress >= 1) {
      const b = this.world.get(t.x, t.y, t.z);
      this.world.set(t.x, t.y, t.z, Block.Air);
      add(this.inventory, dropOf(b));
      this.digProgress = 0;
      this.dirty = true;
      this.onBlockChanged(t.x, t.z);
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
    if ((this.inventory[b] ?? 0) <= 0) return;
    // Don't build inside yourself.
    const p = this.body;
    const overlaps = p.x + PLAYER_HALF > x && p.x - PLAYER_HALF < x + 1 &&
      p.z + PLAYER_HALF > z && p.z - PLAYER_HALF < z + 1 &&
      p.y + PLAYER_HEIGHT > y && p.y < y + 1;
    if (overlaps) return;
    take(this.inventory, b);
    this.world.set(x, y, z, b);
    if (collides(this.world, p.x, p.y, p.z)) { // safety net
      this.world.set(x, y, z, Block.Air);
      add(this.inventory, b);
      return;
    }
    this.dirty = true;
    this.onBlockChanged(x, z);
  }

  hud(): HudState {
    const hours = (this.time * 24 + 6) % 24;
    const night = this.daylight < 0.5;
    const t = this.target ? BLOCKS[this.world.get(this.target.x, this.target.y, this.target.z)].name : null;
    return {
      selected: this.selected,
      inventory: { ...this.inventory },
      dig: this.digProgress,
      timeLabel: `${night ? '밤' : '낮'} ${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}`,
      target: t,
    };
  }

  toSave(): Save {
    return {
      seed: this.world.seed,
      edits: [...this.world.edits.entries()],
      inventory: this.inventory,
      pos: [this.body.x, this.body.y, this.body.z],
    };
  }
}
