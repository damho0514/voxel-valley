import { Block, BLOCKS, Dimension, isReplaceable, paletteFor, PORTAL_TARGET } from './blocks';
import { arrival, BLACK_HOLE } from './dimensions';
import { Body, collides, EYE_HEIGHT, inLava, inWater, move, PLAYER_HALF, PLAYER_HEIGHT } from './physics';
import { Hit, raycast } from './raycast';
import { Save } from './storage';
import { isTreasure } from './treasure';
import { HEIGHT, toChunk, World } from './world';

export const REACH = 8;
const WALK = 4.6;
const GRAVITY = -24;
const JUMP_SPEED = 8.2;
const DAY_SECONDS = 480;
/** Magic carpet cruising speed (blocks/s): crosses a view's worth of world in a few seconds. */
const CARPET_SPEED = 15;
/** How deep under the valley's natural ground a dug block must be to open the 꿀알바 rift. */
export const RIFT_DEPTH = 5;
const RIFT_COOLDOWN = 30;
/** How far the eye drops when crouching, and the speed while crouching / walking. */
const CROUCH_DROP = 0.42;
const CROUCH_SPEED = 0.4;
const QUIET_WALK = 0.5;

/** What the on-screen controls (or keyboard) want this frame. */
export type Input = {
  moveX: number; // strafe -1..1
  moveY: number; // forward -1..1
  lookDX: number; // accumulated pixels since last frame
  lookDY: number;
  /** Extra turn this frame in radians (tilt/gyro aiming). */
  turnYaw?: number;
  turnPitch?: number;
  jump: boolean;
  down?: boolean; // space only: thrust downward
  /** Crouch (keyboard Ctrl · C): lower eye, slow, silent, no auto-jump. Ground only. */
  crouch?: boolean;
  /** Walk (keyboard Shift): slow and silent. Ground only. */
  walk?: boolean;
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
  private prevJump = false;
  /** Health: lava burns it away; it slowly comes back. At 0 you respawn. */
  hp = 100;
  maxHp = 100;
  /** Shop upgrades (see economy.ts effects()). */
  walkMul = 1;
  jumpMul = 1;
  /** How far you can place and dig. */
  buildReach = REACH;
  /** Tap places an n×n square (1, 2 or 3). */
  placeSize = 1;
  /** Extra blocks on every hotbar (the special palette). */
  extraBlocks: Block[] = [];
  private hurtCooldown = 0;
  onHurt: (amount: number) => void = () => {};
  onRespawn: () => void = () => {};
  /** 0..1: how hard the black hole is pulling right now (for rumble and HUD). */
  blackHolePull = 0;
  get velocity() {
    return this.vel;
  }
  /** Riding the magic carpet: free 3D flight in any world (see `carpet`). */
  flying = false;
  /** How fast the view is turning (rad/s), for the carpet's banking. */
  turnRate = 0;
  /** Hop up single steps automatically while walking (like most mobile block games). */
  autoJump = true;
  /**
   * One-thumb steering (touch): push the stick toward where you want to go and you walk that way
   * while the view swings round to face it, so one finger both moves and turns.
   */
  steer = true;
  /** The view's heading the stick push is read against while it's held (null: stick released). */
  private steerBase: number | null = null;
  /** Which way the body faces (turns toward where you walk): your own figure in third person. */
  facing = 0;
  private idleLook = 0; // seconds since the player last aimed by hand
  yaw = 0;
  pitch = 0;
  selected = 0;
  target: Hit | null = null;
  /** Aim along this direction instead of the crosshair (a finger on a block). */
  aimRay: { x: number; y: number; z: number } | null = null;
  time = 0.45; // 0 sunrise, 0.25 noon, 0.75 midnight. Starts in the golden hour, night falls soon.
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
  /** A block was dug out (for the break effect). */
  onBreak: (x: number, y: number, z: number, b: Block) => void = () => {};
  /** The player broke a gem, chest or rune (by any means except dragon fire, which can't burn them). */
  onTreasure: (b: Block, x: number, y: number, z: number) => void = () => {};
  /** Mid-air jumps (future city), thruster kicks (space). */
  onAirJump: () => void = () => {};
  /** Fell into the black hole: thrown back out at the station. */
  onWarp: () => void = () => {};
  /** Called after stepping through a gate into another dimension. */
  onDimension: (dim: Dimension) => void = () => {};
  /**
   * Dug RIFT_DEPTH or more below the valley's natural ground: space-time tears open (PlayScreen
   * plays the swirl, then calls enterDimension('store')). Fires at most once per RIFT_COOLDOWN.
   */
  onRift: () => void = () => {};
  private riftCooldown = 0;

  constructor(save: Save | null) {
    const seed = save?.seed ?? Math.floor(Math.random() * 2 ** 31);
    const valley = new World(seed, save?.season ?? 'summer');
    this.worlds.set('valley', valley);
    for (const [key, b] of save?.edits ?? []) valley.setEdit(key, b);
    for (const d of ['future', 'space', 'store'] as Dimension[]) for (const [key, b] of save?.dimEdits?.[d] ?? []) this.worldFor(d).setEdit(key, b);
    this.world = this.worldFor(save?.dim ?? 'valley');
    const p = save?.pos ?? this.world.findSpawn(0, 0);
    this.body = { x: p[0], y: p[1], z: p[2], vy: 0, onGround: false };
    this.spawned = !!save?.pos;
  }

  get dim(): Dimension {
    return this.world.dim;
  }

  get palette(): Block[] {
    const base = paletteFor(this.world.season, this.world.dim);
    return [...base, ...this.extraBlocks.filter((b) => !base.includes(b))];
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
    this.yaw = this.facing = a.yaw;
    this.pitch = 0;
    this.spawned = true;
    this.portalCooldown = 1.5;
    if (from === 'store') this.riftCooldown = RIFT_COOLDOWN; // a moment back home before it can happen again
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

  /** 0 standing … 1 fully crouched (eased, so the camera glides down and up). */
  crouchT = 0;

  eye() {
    return { x: this.body.x, y: this.body.y + EYE_HEIGHT - CROUCH_DROP * this.crouchT, z: this.body.z };
  }

  /**
   * Third-person view: where the camera is, so aiming and drawing rays start from what you see.
   * `viewExtra` (its distance behind the head) is added to reach so you reach as far past the
   * character as in first person.
   */
  viewOrigin: { x: number; y: number; z: number } | null = null;
  viewExtra = 0;

  /** Where aiming rays start: the camera in third person, the eye in first person. */
  rayStart() {
    return this.viewOrigin ?? this.eye();
  }

  lookDir() {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }

  /** Advances the simulation. `ready` = terrain under the player is built. */
  update(dt: number, input: Input, ready: boolean) {
    dt = Math.min(dt, 0.05);
    this.time = (this.time + dt / DAY_SECONDS) % 1;

    const yaw0 = this.yaw;
    this.yaw -= input.lookDX * 0.0055;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - input.lookDY * 0.0055));
    this.yaw += input.turnYaw ?? 0;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (input.turnPitch ?? 0)));
    const aimed = input.lookDX !== 0 || input.lookDY !== 0 || !!input.turnYaw || !!input.turnPitch;
    this.idleLook = aimed ? 0 : this.idleLook + dt;
    if (this.steer) {
      // Follow-camera steering, as in mobile block games: the push is read against the view as it
      // was when the thumb went down (plus any turning done by hand), so the goal doesn't run away
      // while the view swings round to it. Pulling back walks backwards without spinning round.
      const mag = Math.min(1, Math.hypot(input.moveX, input.moveY));
      if (mag < 0.15) this.steerBase = null;
      else {
        this.steerBase = (this.steerBase ?? yaw0) + (this.yaw - yaw0);
        const push = Math.atan2(input.moveX, input.moveY); // 0 = ahead, + = right
        if (Math.abs(push) < 2) {
          const goal = this.steerBase - push;
          const d = Math.atan2(Math.sin(goal - this.yaw), Math.cos(goal - this.yaw));
          this.yaw += d * Math.min(1, dt * (2 + 3 * mag));
          const rel = this.yaw - goal; // > 0: the goal is still to the right of the view
          input = { ...input, moveX: Math.sin(rel) * mag, moveY: Math.cos(rel) * mag };
        }
        // Walking levels the view gently if you haven't aimed by hand for a moment.
        if (Math.abs(input.moveY) > 0.3 && this.idleLook > 1.2 && this.dim !== 'space') this.pitch += (-0.12 - this.pitch) * Math.min(1, dt * 1.5);
      }
    }
    if (Math.hypot(input.moveX, input.moveY) > 0.15) {
      const want = this.yaw - Math.atan2(input.moveX, input.moveY);
      this.facing += Math.atan2(Math.sin(want - this.facing), Math.cos(want - this.facing)) * Math.min(1, dt * 10);
    }
    this.turnRate += ((dt > 0 ? (this.yaw - yaw0) / dt : 0) - this.turnRate) * Math.min(1, dt * 6);

    if (!ready) return;
    if (!this.spawned) {
      const [x, y, z] = this.world.findSpawn(Math.floor(this.body.x), Math.floor(this.body.z));
      Object.assign(this.body, { x, y, z, vy: 0 });
      this.spawned = true;
    }

    this.portalCooldown -= dt;
    this.riftCooldown -= dt;
    if (this.portalCooldown <= 0) {
      const to = this.portalHere();
      if (to && to !== this.dim) {
        this.enterDimension(to);
        return;
      }
    }

    this.updateHealth(dt);
    const jumpPressed = input.jump && !this.prevJump;
    this.prevJump = input.jump;
    const crouching = !!input.crouch && !this.flying && this.dim !== 'space';
    this.crouchT += ((crouching ? 1 : 0) - this.crouchT) * Math.min(1, dt * 12);
    if (this.flying) {
      this.carpet(dt, input);
      this.aim();
      this.updateDig(dt, input.dig);
      if (input.placeTap) this.place();
      return;
    }
    if (this.dim === 'space') {
      this.fly(dt, input, jumpPressed);
      this.aim();
      this.updateDig(dt, input.dig);
      if (input.placeTap) this.place();
      return;
    }

    // Walk relative to where we're looking (yaw only).
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const swim = inWater(this.world, this.body);
    const quiet = (crouching || !!input.walk) && !swim;
    const speed = WALK * this.walkMul * (swim ? 0.6 : 1) * (crouching && !swim ? CROUCH_SPEED : input.walk && !swim ? QUIET_WALK : 1);
    const mx = (input.moveX * cos - input.moveY * sin) * speed * dt;
    const mz = (-input.moveX * sin - input.moveY * cos) * speed * dt;

    const fallSpeed = -this.body.vy;
    // Bobbing at the surface: head above water, feet still in it.
    const wading = !swim && this.world.get(Math.floor(this.body.x), Math.floor(this.body.y + 0.1), Math.floor(this.body.z)) === Block.Water;
    if (swim && this.body.vy > 4.5) {
      this.body.vy += GRAVITY * dt; // mid-hop out of the water: let the hop carry
    } else if (swim) {
      this.body.vy = input.jump ? 4.2 : Math.max(this.body.vy + GRAVITY * 0.15 * dt, -1.6);
    } else if (wading && input.jump && this.body.vy <= 0.5) {
      // Kick up out of the water (from the surface you can't stand on anything).
      this.body.vy = JUMP_SPEED * this.jumpMul * 0.9;
      this.onSound('jump');
    } else {
      if (this.body.onGround && input.jump) {
        this.body.vy = JUMP_SPEED * this.jumpMul;
        this.onSound('jump');
      } else if (jumpPressed && this.dim === 'future' && !this.body.onGround) {
        // Infinite jump in the future city: every tap in mid-air is another boost upward.
        this.body.vy = JUMP_SPEED;
        this.onSound('jump');
        this.onAirJump();
      }
      this.body.vy += GRAVITY * dt;
    }
    const bx = this.body.x, bz = this.body.z;
    const wasOnGround = this.body.onGround;
    move(this.world, this.body, mx, this.body.vy * dt, mz);
    // Auto-jump / climb out: if either axis of the move was stopped by a one-block step with
    // headroom above it, hop onto it. Works on land and from the water onto the shore.
    const inWaterNow = swim || wading;
    const canHop = (wasOnGround || inWaterNow) && this.body.vy <= 1;
    if (((this.autoJump && !quiet) || (inWaterNow && input.jump)) && canHop) {
      const fy = Math.floor(this.body.y + (inWaterNow ? 0.3 : 0));
      const hopAxis = (dx: number, dz: number) => {
        const ax = this.body.x + dx * (PLAYER_HALF + 0.25), az = this.body.z + dz * (PLAYER_HALF + 0.25);
        return this.world.isSolid(Math.floor(ax), fy, Math.floor(az)) &&
          !this.world.isSolid(Math.floor(ax), fy + 1, Math.floor(az)) && !this.world.isSolid(Math.floor(ax), fy + 2, Math.floor(az)) &&
          !collides(this.world, this.body.x, fy + 1.05, this.body.z);
      };
      const blockedX = Math.abs(mx) > 0.003 && Math.abs(this.body.x - bx) < Math.abs(mx) * 0.5;
      const blockedZ = Math.abs(mz) > 0.003 && Math.abs(this.body.z - bz) < Math.abs(mz) * 0.5;
      if ((blockedX && hopAxis(Math.sign(mx), 0)) || (blockedZ && hopAxis(0, Math.sign(mz)))) {
        this.body.vy = inWaterNow ? JUMP_SPEED * 0.95 : JUMP_SPEED;
      }
    }
    if (this.body.onGround && !swim) {
      this.stride += Math.hypot(this.body.x - bx, this.body.z - bz);
      if (this.stride > 1.7) {
        this.stride = 0;
        if (!quiet) this.onSound('step'); // walking and crouching are silent
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
  private fly(dt: number, input: Input, jumpPressed: boolean) {
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
    // Infinite jump in space: each tap of ▲ is a sharp kick upward (on top of holding thrust).
    if (jumpPressed) {
      v.y += 7;
      this.onSound('thrust');
      this.onAirJump();
    }
    const speed = Math.hypot(v.x, v.y, v.z), max = 12;
    if (speed > max) { v.x *= max / speed; v.y *= max / speed; v.z *= max / speed; }
    // The black hole pulls harder the closer you get (and can drag you past the speed limit).
    const bh = BLACK_HOLE;
    const dx = bh.x - this.body.x, dy = bh.y - this.body.y, dz = bh.z - this.body.z;
    const dist = Math.hypot(dx, dy, dz);
    this.blackHolePull = dist < bh.reach ? Math.min(1, ((bh.reach - dist) / (bh.reach - bh.horizon)) ** 1.5) : 0;
    if (this.blackHolePull > 0) {
      const a = (4 + 40 * this.blackHolePull) * dt / dist;
      v.x += dx * a; v.y += dy * a; v.z += dz * a;
    }
    if (dist < bh.horizon) {
      // Across the event horizon: spat out at the station.
      const a2 = arrival(this.world, 'space');
      Object.assign(this.body, { x: a2.pos[0], y: a2.pos[1], z: a2.pos[2], vy: 0 });
      this.vel = { x: 0, y: 0, z: 0 };
      this.yaw = this.facing = a2.yaw;
      this.blackHolePull = 0;
      this.onSound('portal');
      this.onWarp();
      return;
    }
    if ((input.moveX || input.moveY || up) && Math.random() < dt * 4) this.onSound('thrust');
    const before = { x: this.body.x, y: this.body.y, z: this.body.z };
    move(this.world, this.body, v.x * dt, v.y * dt, v.z * dt);
    // Bump: lose the velocity along any axis that hit something.
    if (Math.abs(this.body.x - before.x) < Math.abs(v.x * dt) * 0.5) v.x = 0;
    if (Math.abs(this.body.y - before.y) < Math.abs(v.y * dt) * 0.5) v.y = 0;
    if (Math.abs(this.body.z - before.z) < Math.abs(v.z * dt) * 0.5) v.z = 0;
    // Drifting too far out: a soft tether back toward the station.
    if (this.body.y < -30 || this.body.y > 110) v.y += (this.body.y < 0 ? 1 : -1) * 20 * dt;
  }

  /**
   * Magic carpet: glide toward where you look (the stick's forward/back), side-slip with its
   * left/right, rise/sink with ▲/▼. Velocity eases toward the target, so starts, stops and turns
   * feel like gliding on air, not walking. Blocks still stop you.
   */
  private carpet(dt: number, input: Input) {
    const d = this.lookDir();
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const up = (input.jump ? 1 : 0) - (input.down ? 1 : 0);
    const speed = CARPET_SPEED * this.walkMul;
    const tx = (d.x * input.moveY + rx * input.moveX) * speed;
    const ty = (d.y * input.moveY + up * 0.75) * speed;
    const tz = (d.z * input.moveY + rz * input.moveX) * speed;
    const k = Math.min(1, dt * 2.6);
    const v = this.vel;
    v.x += (tx - v.x) * k; v.y += (ty - v.y) * k; v.z += (tz - v.z) * k;
    // A slow hover bob when you're not going anywhere.
    this.hover += dt;
    const bob = Math.abs(input.moveY) + Math.abs(up) < 0.1 ? Math.sin(this.hover * 1.8) * 0.25 : 0;
    const before = { x: this.body.x, y: this.body.y, z: this.body.z };
    move(this.world, this.body, v.x * dt, (v.y + bob) * dt, v.z * dt);
    if (Math.abs(this.body.x - before.x) < Math.abs(v.x * dt) * 0.5) v.x *= 0.3;
    if (Math.abs(this.body.y - before.y) < Math.abs(v.y * dt) * 0.5) v.y *= 0.3;
    if (Math.abs(this.body.z - before.z) < Math.abs(v.z * dt) * 0.5) v.z *= 0.3;
    // Not too far above the world (it's all sky up there) nor below it.
    if (this.body.y > HEIGHT + 24) this.body.y = HEIGHT + 24;
    if (this.body.y < 1) this.body.y = 1;
    this.body.vy = 0;
    this.body.onGround = false;
    if (input.jump || input.down || input.moveY) this.dirty = true;
  }
  private hover = 0;

  /** Take off (or land): landing hands you back to gravity with your current drift. */
  setFlying(on: boolean) {
    if (on === this.flying) return;
    this.flying = on;
    if (on) {
      this.vel = { x: 0, y: 3, z: 0 }; // a little lift as the carpet rises
    } else {
      this.body.vy = Math.min(2, this.vel.y);
      if (this.dim !== 'space') this.vel = { x: 0, y: 0, z: 0 };
    }
  }

  private aim() {
    const e = this.rayStart(), d = this.aimRay ?? this.lookDir();
    this.target = raycast(this.world, e.x, e.y, e.z, d.x, d.y, d.z, this.buildReach + this.viewExtra);
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
      const was = this.world.get(t.x, t.y, t.z);
      this.onSound('break');
      this.onBreak(t.x, t.y, t.z, was);
      this.world.set(t.x, t.y, t.z, Block.Air);
      if (isTreasure(was)) this.onTreasure(was, t.x, t.y, t.z);
      this.checkRift(t.x, t.y, t.z);
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
    const b = this.selectedBlock;
    // An n×n square centred on the cell in front of the face, lying flat against that face.
    const n = this.placeSize, lo = -Math.floor((n - 1) / 2);
    const [ux, uy, uz, vx, vy, vz] = t.ny !== 0 ? [1, 0, 0, 0, 0, 1] : t.nx !== 0 ? [0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, 1, 0];
    let placed = 0;
    for (let i = lo; i < lo + n; i++)
      for (let j = lo; j < lo + n; j++) {
        const x = t.x + t.nx + ux * i + vx * j, y = t.y + t.ny + uy * i + vy * j, z = t.z + t.nz + uz * i + vz * j;
        if (this.placeOne(x, y, z, b)) placed++;
      }
    if (placed) {
      this.dirty = true;
      this.onSound('place');
    }
  }

  /** Puts one block down unless the cell is taken or it would trap the player. */
  private placeOne(x: number, y: number, z: number, b: Block) {
    if (y < 1 || y >= HEIGHT || !isReplaceable(this.world.get(x, y, z))) return false;
    // Blocks are unlimited. Don't build inside yourself.
    const p = this.body;
    const overlaps = p.x + PLAYER_HALF > x && p.x - PLAYER_HALF < x + 1 &&
      p.z + PLAYER_HALF > z && p.z - PLAYER_HALF < z + 1 &&
      p.y + PLAYER_HEIGHT > y && p.y < y + 1;
    if (overlaps) return false;
    this.world.set(x, y, z, b);
    if (collides(this.world, p.x, p.y, p.z)) { // safety net
      this.world.set(x, y, z, Block.Air);
      return false;
    }
    this.onBlockChanged(x, z);
    this.onEdit(x, y, z, b);
    return true;
  }

  private updateHealth(dt: number) {
    this.hurtCooldown -= dt;
    if (inLava(this.world, this.body)) {
      this.hp -= 30 * dt;
      if (this.hurtCooldown <= 0) {
        this.hurtCooldown = 0.45;
        this.onHurt(30 * 0.45);
      }
    } else {
      this.hp = Math.min(this.maxHp, this.hp + 3 * dt);
    }
    if (this.hp <= 0) {
      // Burned up: back to the start of this world, fully healed.
      const a = this.dim === 'valley'
        ? { pos: this.world.findSpawn(0, 0), yaw: 0 }
        : arrival(this.world, this.dim);
      Object.assign(this.body, { x: a.pos[0], y: a.pos[1], z: a.pos[2], vy: 0 });
      this.vel = { x: 0, y: 0, z: 0 };
      this.yaw = this.facing = a.yaw;
      this.hp = this.maxHp;
      this.onRespawn();
    }
  }

  /** Weapon strike: breaks the block instantly (anything breakable, at any distance in reach). */
  mineAt(hit: Hit) {
    const b = this.world.get(hit.x, hit.y, hit.z);
    if (!BLOCKS[b].breakable) return false;
    this.onSound('break');
    this.onBreak(hit.x, hit.y, hit.z, b);
    this.world.set(hit.x, hit.y, hit.z, Block.Air);
    this.dirty = true;
    this.onBlockChanged(hit.x, hit.z);
    this.onEdit(hit.x, hit.y, hit.z, Block.Air);
    if (isTreasure(b)) this.onTreasure(b, hit.x, hit.y, hit.z);
    this.checkRift(hit.x, hit.y, hit.z);
    return true;
  }

  /** A player-made hole reaching deep under the valley's natural ground opens the 꿀알바 rift. */
  private checkRift(x: number, y: number, z: number) {
    if (this.dim !== 'valley' || this.flying || this.riftCooldown > 0) return;
    if (this.world.surfaceHeight(x, z) - y < RIFT_DEPTH) return;
    this.riftCooldown = RIFT_COOLDOWN;
    this.onRift();
  }

  /**
   * Blocks seen along each ray (from the eye), plus up to `depth` more behind each one, as long
   * as they can be broken. Used by air-drawn shapes: a rectangle picks a slab of whatever is
   * inside it on screen. Never picks the block the player stands on or anything inside them.
   */
  pickAlong(dirs: { x: number; y: number; z: number }[], depth = 2, reach = 28, limit = 900): Hit[] {
    const e = this.rayStart(), p = this.body;
    reach += this.viewExtra;
    const seen = new Set<string>();
    const out: Hit[] = [];
    const under = `${Math.floor(p.x)},${Math.floor(p.y - 0.01)},${Math.floor(p.z)}`;
    for (const d of dirs) {
      const hit = raycast(this.world, e.x, e.y, e.z, d.x, d.y, d.z, reach);
      if (!hit) continue;
      for (let k = 0; k <= depth; k++) {
        const x = hit.x - hit.nx * k, y = hit.y - hit.ny * k, z = hit.z - hit.nz * k;
        const key = `${x},${y},${z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const b = this.world.get(x, y, z);
        const info = BLOCKS[b];
        if (b === Block.Air || b === Block.Water || !info.breakable || info.portal || key === under) break;
        out.push({ x, y, z, nx: hit.nx, ny: hit.ny, nz: hit.nz });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /** Breakable blocks in a ball (for the air-drawn circle), keeping clear of the player. */
  pickBall(cx: number, cy: number, cz: number, r: number): Hit[] {
    const p = this.body, out: Hit[] = [];
    const R = Math.ceil(r);
    for (let x = cx - R; x <= cx + R; x++)
      for (let y = Math.max(1, cy - R); y <= Math.min(HEIGHT - 1, cy + R); y++)
        for (let z = cz - R; z <= cz + R; z++) {
          if (Math.hypot(x - cx, y - cy, z - cz) > r) continue;
          if (Math.hypot(x + 0.5 - p.x, y + 0.5 - (p.y + 0.9), z + 0.5 - p.z) < 2.2) continue;
          const b = this.world.get(x, y, z), info = BLOCKS[b];
          if (b === Block.Air || b === Block.Water || !info.breakable || info.portal) continue;
          out.push({ x, y, z, nx: 0, ny: 0, nz: 0 });
        }
    return out;
  }

  /**
   * Removes a block with no sound or effect of its own (the caller batches those). Returns what
   * was there, or null if it couldn't be broken (it may have changed since it was picked).
   */
  smash(x: number, y: number, z: number): Block | null {
    const b = this.world.get(x, y, z), info = BLOCKS[b];
    if (b === Block.Air || b === Block.Water || !info.breakable || info.portal) return null;
    this.world.set(x, y, z, Block.Air);
    this.dirty = true;
    this.onBlockChanged(x, z);
    this.onEdit(x, y, z, Block.Air);
    if (isTreasure(b)) this.onTreasure(b, x, y, z);
    this.checkRift(x, y, z);
    return b;
  }

  /**
   * Sets one block of a 내 방 room (game/photoRoom.ts), quietly: the caller plays the show. Gates,
   * portals and bedrock are left alone, and a solid block never lands on the player.
   */
  build(x: number, y: number, z: number, b: Block): boolean {
    if (y < 1 || y >= HEIGHT) return false;
    const was = this.world.get(x, y, z);
    if (was === b) return false;
    const info = BLOCKS[was];
    if (!isReplaceable(was) && (!info.breakable || info.portal)) return false;
    if (BLOCKS[b].solid) {
      const p = this.body;
      if (p.x + PLAYER_HALF > x && p.x - PLAYER_HALF < x + 1 && p.z + PLAYER_HALF > z && p.z - PLAYER_HALF < z + 1 &&
        p.y + PLAYER_HEIGHT > y && p.y < y + 1) return false;
    }
    this.world.set(x, y, z, b);
    this.dirty = true;
    this.onBlockChanged(x, z);
    this.onEdit(x, y, z, b);
    return true;
  }

  /** Treasure blocks within r blocks of the player, nearest first (for the 보물 투시 effect). */
  treasureNear(r = 10, max = 120): { x: number; y: number; z: number }[] {
    const px = Math.floor(this.body.x), py = Math.floor(this.body.y), pz = Math.floor(this.body.z);
    const out: { x: number; y: number; z: number; d: number }[] = [];
    for (let x = px - r; x <= px + r; x++)
      for (let z = pz - r; z <= pz + r; z++)
        for (let y = Math.max(1, py - r); y <= Math.min(HEIGHT - 1, py + r); y++) {
          if (!isTreasure(this.world.get(x, y, z))) continue;
          const d = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
          if (d <= r * r) out.push({ x, y, z, d });
        }
    return out.sort((a, b) => a.d - b.d).slice(0, max);
  }

  /** First solid block along a direction from the eye, far reach (for dragon fire). */
  farHit(dir: { x: number; y: number; z: number }, reach = 120): Hit | null {
    const e = this.rayStart();
    reach += this.viewExtra;
    return raycast(this.world, e.x, e.y, e.z, dir.x, dir.y, dir.z, reach);
  }

  /** A random spot on the ground 10–28 blocks away (for the dragon's own strikes). */
  randomGroundTarget(): { x: number; y: number; z: number } | null {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 18;
      const x = Math.floor(this.body.x + Math.cos(a) * r), z = Math.floor(this.body.z + Math.sin(a) * r);
      let y = HEIGHT - 1;
      while (y > 0 && !this.world.isSolid(x, y, z)) y--;
      if (y > 0) return { x, y, z };
    }
    return null;
  }

  /**
   * Blows a crater of radius r at (cx,cy,cz): blocks become air, the crater floor smoulders with
   * embers and ash. Gates and bedrock survive, and so does everything within 4 blocks of the
   * player — the dragon never hurts you. Returns how many blocks changed.
   */
  blast(cx: number, cy: number, cz: number, r: number): number {
    const p = this.body;
    const safe = (x: number, y: number, z: number) => Math.hypot(x + 0.5 - p.x, y + 0.5 - (p.y + 0.9), z + 0.5 - p.z) < 4.5;
    let changed = 0;
    const set = (x: number, y: number, z: number, b: Block) => {
      if (this.world.get(x, y, z) === b) return;
      this.world.set(x, y, z, b);
      this.onBlockChanged(x, z);
      this.onEdit(x, y, z, b);
      changed++;
    };
    const R = Math.ceil(r + 1);
    for (let x = cx - R; x <= cx + R; x++)
      for (let y = Math.max(1, cy - R); y <= Math.min(HEIGHT - 1, cy + R); y++)
        for (let z = cz - R; z <= cz + R; z++) {
          const d = Math.hypot(x - cx, (y - cy) * 1.2, z - cz) + (Math.random() - 0.5) * 0.8;
          if (d > r + 0.8) continue;
          const b = this.world.get(x, y, z);
          const info = BLOCKS[b];
          // Treasure is fireproof: a dragon blast lays it bare instead of burning it.
          if (b === Block.Air || b === Block.Water || !info.breakable || info.portal || isTreasure(b) || safe(x, y, z)) continue;
          if (d <= r) set(x, y, z, Block.Air);
          else if (y <= cy) {
            // The crater floor: pools of lava among embers and ash.
            const r2 = Math.random();
            set(x, y, z, r2 < 0.4 ? Block.Lava : r2 < 0.65 ? Block.Ember : Block.Ash);
          }
        }
    if (changed) this.dirty = true;
    return changed;
  }

  /** A block changed by another player in the room. */
  applyRemoteEdit(x: number, y: number, z: number, b: Block, dim: Dimension = 'valley') {
    if (y < 0 || y >= HEIGHT) return;
    const w = this.worldFor(dim);
    // Only touch chunk data that's already loaded; unloaded chunks pick the edit up when generated.
    if (w.hasChunk(toChunk(x), toChunk(z))) w.set(x, y, z, b);
    else w.setEdit(`${x},${y},${z}`, b);
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
      dimEdits: { future: [...this.worldFor('future').edits.entries()], space: [...this.worldFor('space').edits.entries()], store: [...this.worldFor('store').edits.entries()] },
      pos: [this.body.x, this.body.y, this.body.z],
    };
  }
}
