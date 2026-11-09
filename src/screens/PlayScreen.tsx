import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Gyroscope } from 'expo-sensors';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Platform, Pressable, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as THREE from 'three';
import { sound } from '../audio/sound';
import { Block, BLOCKS, Dimension, DIMENSION_INFO, SEASON_INFO } from '../game/blocks';
import { Bot, knockBack, makeAnimal, spawnAnimals, spawnBots, spawnRobots, SPECIES_INFO } from '../game/bots';
import { Game, HudState, Input, REACH } from '../game/game';
import { loadSave, Save, writeSave } from '../game/storage';
import { DimCode, parseEditKey, PlayerInfo, RoomClient, Welcome } from '../net/room';
import { VoxelRenderer } from '../render/renderer';
import { HoldButton, Joystick, TouchPad } from '../ui/controls';
import { css, LookMode, Mode, Profile } from '../session';

/*
 * The in-game screen. It pulls in three.js, the renderer, the world generator and the native
 * GL/sensor/haptics modules, so App loads it lazily: the title screen starts without any of it.
 */

const DIMS: Dimension[] = ['valley', 'future', 'space'];
const dimCode = (d: Dimension) => DIMS.indexOf(d) as DimCode;

const hex = (c: [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

const SENSITIVITY = [{ label: '느림', k: 0.6 }, { label: '보통', k: 1 }, { label: '빠름', k: 1.5 }];

const buzz = (style: Haptics.ImpactFeedbackStyle) => { if (Platform.OS !== 'web') Haptics.impactAsync(style).catch(() => {}); };

type Touch = { tap: { x: number; y: number } | null; hold: { x: number; y: number } | null };

export default function Play({ mode, profile, onProfile, onExit }: { mode: Mode; profile: Profile; onProfile: (p: Profile) => void; onExit: () => void }) {
  const inputRef = useRef<Input>({ moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, jump: false, down: false, dig: false, placeTap: false });
  const [dim, setDim] = useState<Dimension>('valley');
  const flash = useRef(new Animated.Value(0)).current;
  const hurtFlash = useRef(new Animated.Value(0)).current;
  const [weapon, setWeapon] = useState(false);
  const weaponRef = useRef(false);
  const [hp, setHp] = useState(100);
  const animalsRef = useRef<Bot[]>([]);
  const petsRef = useRef<Bot[]>([]);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const viewRef = useRef<VoxelRenderer | null>(null);
  const strikeRef = useRef<(hit: { x: number; y: number; z: number }) => void>(() => {});
  const [dragon, setDragon] = useState(false);
  const lookMode: LookMode = profile.lookMode ?? 'stick';
  const lookStick = useRef({ x: 0, y: 0 });

  const touchRef = useRef<Touch>({ tap: null, hold: null });
  const gameRef = useRef<Game | null>(null);
  const roomRef = useRef<RoomClient | null>(null);
  const botsRef = useRef<Bot[]>([]);
  const [hud, setHud] = useState<HudState | null>(null);
  const [palette, setPalette] = useState<Block[]>([]);
  const [loading, setLoading] = useState<string | null>('계곡을 만드는 중...');
  const [status, setStatus] = useState<{ state: 'connecting' | 'online' | 'offline'; error?: string } | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const { width, height } = useWindowDimensions();
  const screen = useRef({ width, height });
  screen.current = { width, height };
  const alive = useRef(true);
  const sens = SENSITIVITY[profile.sensitivity ?? 1];
  const sensRef = useRef(sens.k);
  sensRef.current = sens.k;

  // Settings take effect immediately.
  useEffect(() => {
    const g = gameRef.current;
    if (!g) return;
    g.steer = lookMode === 'steer';
    g.autoJump = true;
  }, [lookMode, hud !== null]);

  // Tilt aiming: integrate the gyroscope into turn input. In landscape the screen's "up" is the
  // device's ±x axis (which way depends on how the phone is held), its "right" is ∓y.
  useEffect(() => {
    if (lookMode !== 'tilt' || Platform.OS === 'web') return;
    let side = 1;
    const readSide = (o: ScreenOrientation.Orientation) => { side = o === ScreenOrientation.Orientation.LANDSCAPE_LEFT ? -1 : 1; };
    ScreenOrientation.getOrientationAsync().then(readSide).catch(() => {});
    const orient = ScreenOrientation.addOrientationChangeListener((e) => readSide(e.orientationInfo.orientation));
    let last = 0;
    Gyroscope.setUpdateInterval(16);
    const sub = Gyroscope.addListener((g) => {
      const dt = last ? Math.min(0.05, g.timestamp - last) : 0;
      last = g.timestamp;
      const k = 1.25 * sens.k;
      const dz = (v: number) => (Math.abs(v) < 0.03 ? 0 : v); // ignore hand tremor
      inputRef.current.turnYaw = (inputRef.current.turnYaw ?? 0) + side * dz(g.x) * dt * k;
      inputRef.current.turnPitch = (inputRef.current.turnPitch ?? 0) - side * dz(g.y) * dt * k;
    });
    return () => { sub.remove(); ScreenOrientation.removeOrientationChangeListener(orient); };
  }, [lookMode, sens.k]);

  // Only solo worlds are saved on this phone; shared worlds live in their room on the server.
  const save = useCallback(() => {
    const g = gameRef.current;
    if (g && mode.kind === 'solo') writeSave(g.toSave());
  }, [mode.kind]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') save(); else sound.resume(); });
    const timer = setInterval(() => { if (gameRef.current?.dirty) { gameRef.current.dirty = false; save(); } }, 8000);
    return () => {
      alive.current = false;
      sub.remove();
      clearInterval(timer);
      save();
      roomRef.current?.close();
    };
  }, [save]);

  // Keyboard + mouse for the web build (and quick testing).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const keys = new Set<string>();
    const input = inputRef.current;
    const apply = () => {
      input.moveY = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
      input.moveX = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      input.jump = keys.has(' ');
      input.down = keys.has('shift') || keys.has('c');
      input.dig = keys.has('f');
    };
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      keys.add(k);
      if (k === 'e') input.placeTap = true;
      if (k >= '1' && k <= '9' && gameRef.current) gameRef.current.selected = Math.min(Number(k) - 1, gameRef.current.palette.length - 1);
      if (k === '0' && gameRef.current) gameRef.current.selected = gameRef.current.palette.length - 1;
      apply();
    };
    const up = (e: KeyboardEvent) => { keys.delete(e.key.toLowerCase()); apply(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  /** Connects to the room; resolves with the room's world once we're in. */
  const connect = useCallback((hello: ConstructorParameters<typeof RoomClient>[1], code: string) =>
    new Promise<Welcome>((resolve) => {
      let count = 0;
      roomRef.current = new RoomClient(code, hello, {
        onWelcome: resolve,
        onEdit: (x, y, z, b, d) => gameRef.current?.applyRemoteEdit(x, y, z, b as Block, DIMS[d]),
        onPlayers: (ps) => {
          if (ps.size > count) sound.play('join');
          else if (ps.size < count) sound.play('leave');
          count = ps.size;
          setPlayers([...ps.values()]);
        },
        onStatus: (state, error) => {
          if (!alive.current) return;
          setStatus({ state, error });
          if (error) setLoading((l) => (l ? error : l));
        },
      });
    }), []);

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    let start: Save | null = null;
    if (mode.kind === 'guest') {
      setLoading('방에 들어가는 중...');
      const w = await connect({ t: 'join', name: profile.name, color: profile.color }, mode.code);
      // Spawn beside someone already there, if anyone has a position yet.
      const near = w.players.find((p) => p.y > -50);
      // Room edits for every dimension come in one list; sort them into worlds.
      const byDim: Record<Dimension, [string, Block][]> = { valley: [], future: [], space: [] };
      for (const [key, b] of w.edits) {
        const [d, x, y, z] = parseEditKey(key);
        byDim[DIMS[d]].push([`${x},${y},${z}`, b as Block]);
      }
      const nearValley = near && near.d === 0 ? near : undefined;
      start = { seed: w.seed, season: w.season, edits: byDim.valley, dimEdits: { future: byDim.future, space: byDim.space },
        pos: nearValley ? [nearValley.x + 1, nearValley.y + 0.5, nearValley.z] : undefined };
      setLoading('계곡을 만드는 중...');
    } else if (mode.kind === 'solo' && !mode.fresh) {
      start = await loadSave(mode.season);
    }
    if (!alive.current) return;
    if (!start) start = { seed: Math.floor(Math.random() * 2 ** 31), season: mode.kind === 'guest' ? 'summer' : mode.season, edits: [] };

    const game = new Game(start);
    gameRef.current = game;
    // Handle for browser-driven tests of the dev build.
    if (__DEV__ && Platform.OS === 'web') (globalThis as { __vvGame?: Game }).__vvGame = game;
    setPalette(game.palette);
    const view = new VoxelRenderer(gl, game.world);
    view.setDimension(game.dim, game.world.season);
    sound.setTrack(game.dim);
    setDim(game.dim);
    game.onBlockChanged = (x, z) => view.blockChanged(x, z);
    game.onEdit = (x, y, z, b) => roomRef.current?.sendEdit(x, y, z, b, dimCode(game.dim));
    game.onSound = (s) => {
      sound.play(s);
      if (s === 'place') buzz(Haptics.ImpactFeedbackStyle.Light);
      else if (s === 'break') buzz(Haptics.ImpactFeedbackStyle.Medium);
    };
    game.autoJump = true;
    game.steer = (profile.lookMode ?? 'stick') === 'steer';
    game.onBreak = (x, y, z, b) => {
      const info = BLOCKS[b];
      view.effects.burst(x, y, z, [info.top, info.side, info.side]);
    };
    viewRef.current = view;
    if (__DEV__ && Platform.OS === 'web') (globalThis as { __vvView?: VoxelRenderer }).__vvView = view;
    game.onAirJump = () => buzz(Haptics.ImpactFeedbackStyle.Light);
    game.onHurt = () => {
      sound.play('hurt');
      buzz(Haptics.ImpactFeedbackStyle.Heavy);
      hurtFlash.setValue(0.55);
      Animated.timing(hurtFlash, { toValue: 0, duration: 450, useNativeDriver: false }).start();
    };
    game.onRespawn = () => {
      sound.play('portal');
      flash.setValue(1);
      Animated.timing(flash, { toValue: 0, duration: 1400, useNativeDriver: false }).start();
      petsPlaced = false;
    };
    game.onWarp = () => {
      view.shake(1.2, 1.5);
      flash.setValue(1);
      Animated.timing(flash, { toValue: 0, duration: 1600, useNativeDriver: false }).start();
      buzz(Haptics.ImpactFeedbackStyle.Heavy);
      setTimeout(() => buzz(Haptics.ImpactFeedbackStyle.Heavy), 180);
    };
    view.onCarPass = () => {
      sound.play('whoosh');
      buzz(Haptics.ImpactFeedbackStyle.Light);
    };
    game.onDimension = (d) => {
      view.setWorld(game.world);
      view.setDimension(d, game.world.season);
      sound.setTrack(d);
      botsRef.current = [];
      deadBots = [];
      animalsRef.current = [];
      petsPlaced = false;
      ready = false;
      setDim(d);
      setPalette(game.palette);
      flash.setValue(1);
      Animated.timing(flash, { toValue: 0, duration: 1200, useNativeDriver: false }).start();
    };
    if (mode.kind === 'host') {
      void connect({ t: 'create', name: profile.name, color: profile.color, seed: game.world.seed, season: game.world.season, edits: [] }, mode.code);
    }

    const input = inputRef.current, touch = touchRef.current;
    let last = Date.now(), lastHud = 0, ready = false, lastBreath = 0, lastRumble = 0, lastQuake = 0, lastSwing = 0, lastAnimalCheck = 0;
    let petsPlaced = false;
    let deadBots: { bot: Bot; at: number }[] = [];
    petsRef.current = (profile.pets ?? []).map((sp, i) => {
      const pet = makeAnimal(`pet-${i}`, sp, game.body.x, game.body.y, game.body.z);
      pet.pet = true;
      return pet;
    });

    /** Nearest bot/animal/pet whose body the ray passes through (within reach). */
    const pickEntity = (o: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, max: number) => {
      let best: { bot: Bot; t: number } | null = null;
      for (const b of [...botsRef.current, ...animalsRef.current, ...petsRef.current]) {
        const h = b.species ? 0.7 : 1.9, r = b.species ? 0.55 : 0.6;
        const cx = b.body.x - o.x, cy = b.body.y + h / 2 - o.y, cz = b.body.z - o.z;
        const t = cx * dir.x + cy * dir.y + cz * dir.z;
        if (t < 0 || t > max) continue;
        const d2 = cx * cx + cy * cy + cz * cz - t * t;
        if (d2 < r * r * 1.4 && (!best || t < best.t)) best = { bot: b, t };
      }
      return best;
    };

    /** Hitting something: wild animals become pets; with the weapon, bots take damage and break apart. */
    const hitEntity = (b: Bot): boolean => {
      if (b.species && !b.pet) {
        b.pet = true;
        animalsRef.current = animalsRef.current.filter((a) => a !== b);
        petsRef.current = [...petsRef.current, b];
        const pets = [...(profileRef.current.pets ?? []), b.species].slice(-6);
        onProfile({ ...profileRef.current, pets });
        sound.play('tame');
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        view.effects.burst(Math.floor(b.body.x), Math.floor(b.body.y + 0.5), Math.floor(b.body.z), [[1, 0.42, 0.6], [1, 0.75, 0.85], [1, 1, 1]], 18);
        knockBack(b, game.body);
        b.hitFlash = 0;
        return true;
      }
      if (b.species) return false; // never hurt a pet
      if (!weaponRef.current) return false;
      b.hp -= 1;
      knockBack(b, game.body);
      buzz(Haptics.ImpactFeedbackStyle.Medium);
      sound.play('hurt');
      if (b.hp <= 0) {
        // Destroyed: burst into pieces of its colours; it comes back a while later.
        const c = new THREE.Color(b.color);
        view.effects.burst(Math.floor(b.body.x), Math.floor(b.body.y + 1), Math.floor(b.body.z), [[c.r, c.g, c.b], [0.8, 0.82, 0.86], [0.3, 0.32, 0.36]], 28);
        sound.play('boom');
        view.shake(0.3, 0.4);
        buzz(Haptics.ImpactFeedbackStyle.Heavy);
        botsRef.current = botsRef.current.filter((x) => x !== b);
        deadBots.push({ bot: b, at: Date.now() });
      }
      return true;
    };
    /** The dragon breathes fire at a block; when the fire lands, the ground there is blasted. */
    const strike = (hit: { x: number; y: number; z: number }) => {
      const dragon = view.dragon;
      if (!dragon) return;
      sound.play('fire');
      dragon.breathe(new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5), () => {
        game.blast(hit.x, hit.y, hit.z, 3.2);
        sound.play('boom');
        view.shake(0.45, 0.9);
        buzz(Haptics.ImpactFeedbackStyle.Heavy);
      });
    };
    strikeRef.current = strike;
    const frame = () => {
      if (!alive.current) return;
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;

      view.stream(game.body.x, game.body.z, ready ? 1 : 3);
      ready = view.isReady(game.body.x, game.body.z);

      // A finger on a block aims at it; otherwise aim with the crosshair.
      const finger = touch.hold ?? touch.tap;
      const { width: w, height: h } = screen.current;
      game.aimRay = finger ? view.rayFromScreen((finger.x / w) * 2 - 1, -((finger.y / h) * 2 - 1)) : null;
      // Taps: dragon fire (when the dragon is out) > creatures > weapon strikes > placing blocks.
      let consumed = false;
      const armed = weaponRef.current;
      if (touch.tap || (armed && touch.hold && now - lastSwing > 260)) {
        const dir = game.aimRay ?? game.lookDir();
        if (view.dragon && touch.tap) {
          consumed = true;
          if (now - lastBreath > 700) {
            lastBreath = now;
            const hit = game.farHit(dir);
            if (hit) strike(hit);
          }
        } else {
          const e = game.eye();
          const reach = armed ? 12 : REACH;
          const ent = pickEntity(e, dir, reach);
          const blk = game.farHit(dir, reach);
          const blkDist = blk ? Math.hypot(blk.x + 0.5 - e.x, blk.y + 0.5 - e.y, blk.z + 0.5 - e.z) : Infinity;
          if (ent && ent.t < blkDist) consumed = hitEntity(ent.bot);
          if (!consumed && armed && blk) consumed = game.mineAt(blk);
          if (armed) {
            consumed = true;
            lastSwing = now;
            view.swing();
            sound.play('swing');
          }
        }
      }
      // Right stick: turn rate grows with how far it's pushed (fine aim near the centre).
      const ls = lookStick.current, lk = sensRef.current * dt;
      if (ls.x || ls.y) {
        input.turnYaw = (input.turnYaw ?? 0) - Math.sign(ls.x) * Math.pow(Math.abs(ls.x), 1.7) * 2.6 * lk;
        input.turnPitch = (input.turnPitch ?? 0) + Math.sign(ls.y) * Math.pow(Math.abs(ls.y), 1.7) * 1.8 * lk;
      }
      game.update(dt, { ...input, dig: !armed && (input.dig || !!touch.hold), placeTap: !armed && (input.placeTap || (!!touch.tap && !consumed)) }, ready);
      view.effects.setDig(game.dig, game.target?.x, game.target?.y, game.target?.z);
      // Speed streaks + FOV kick when flying fast in space or air-jumping in the city.
      view.setMotion(game.dim === 'space' ? game.velocity : game.dim === 'future' ? { x: 0, y: Math.max(0, game.body.vy) * 1.2, z: 0 } : { x: 0, y: 0, z: 0 }, dt);
      // The black hole: the closer you drift, the harder the screen and the phone shake.
      const pull = game.blackHolePull;
      if (pull > 0.02) {
        view.shake(0.15 + pull * 0.6, 0.15);
        if (now - lastRumble > 650 - pull * 450) {
          lastRumble = now;
          buzz(pull > 0.6 ? Haptics.ImpactFeedbackStyle.Heavy : pull > 0.3 ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
        }
        if (now - lastQuake > 3000 && pull > 0.25) { lastQuake = now; sound.play('quake'); }
      }
      view.dragon?.follow(new THREE.Vector3(game.body.x, game.body.y, game.body.z));
      input.lookDX = 0;
      input.lookDY = 0;
      input.turnYaw = 0;
      input.turnPitch = 0;
      input.placeTap = false;
      touch.tap = null;

      // Friends in the solo valley; robot citizens in the future city (in rooms too).
      if (ready && botsRef.current.length === 0) {
        if (game.dim === 'valley' && mode.kind === 'solo') botsRef.current = spawnBots(game.world, game.body);
        else if (game.dim === 'future') botsRef.current = spawnRobots(game.world, game.body);
      }
      // Destroyed bots come back after 30 s, somewhere near you.
      deadBots = deadBots.filter(({ bot, at }) => {
        if (now - at < 30000) return true;
        const [x, y, z] = game.world.findSpawn(Math.floor(game.body.x + 10), Math.floor(game.body.z + 10));
        Object.assign(bot.body, { x, y, z, vy: 0 });
        bot.hp = 3;
        botsRef.current = [...botsRef.current, bot];
        return false;
      });
      // Wild animals in the valley; topped up now and then.
      if (ready && game.dim === 'valley' && now - lastAnimalCheck > 20000) {
        lastAnimalCheck = now;
        if (animalsRef.current.length < 4) animalsRef.current = [...animalsRef.current, ...spawnAnimals(game.world, game.body, game.world.season, 6 - animalsRef.current.length)];
      }
      // Pets appear beside you whenever you arrive somewhere.
      if (ready && !petsPlaced) {
        petsPlaced = true;
        petsRef.current.forEach((p, i) => {
          const [x, y, z] = game.world.findSpawn(Math.floor(game.body.x) + 1 + (i % 3), Math.floor(game.body.z) + 2 + Math.floor(i / 3));
          Object.assign(p.body, { x, y, z, vy: 0 });
        });
      }
      const step = Math.min(dt, 0.05);
      for (const bot of [...botsRef.current, ...animalsRef.current, ...petsRef.current]) bot.update(game.world, step, game.body);

      const room = roomRef.current;
      const d = dimCode(game.dim);
      if (room && ready) room.sendPos(game.body.x, game.body.y, game.body.z, game.yaw, d, now);
      const others = [
        ...(room ? [...room.players.values()].filter((p) => (p.d ?? 0) === d) : []),
        ...[...botsRef.current, ...animalsRef.current, ...petsRef.current].map((b) => ({
          id: b.id, color: b.color, x: b.body.x, y: b.body.y, z: b.body.z, yaw: b.yaw, robot: b.robot, species: b.species, pet: b.pet, flash: b.hitFlash,
        })),
      ];
      view.setAvatars(others, dt);

      const e = game.eye();
      view.camera.position.set(e.x, e.y, e.z);
      view.camera.rotation.set(game.pitch, game.yaw, 0);
      const t = game.target;
      view.setHighlight(t ? t.x : null, t?.y, t?.z);
      view.setDaylight(game.daylight, game.time);
      view.render(dt);

      if (now - lastHud > 120) {
        lastHud = now;
        setHud(game.hud());
        setHp(Math.round(game.hp));
        if (ready) setLoading(null);
      }
      requestAnimationFrame(frame);
    };
    frame();
  }, [mode, profile, connect]);

  /** Summon: the earth shakes, the dragon roars and swoops in, then torches a few spots by itself. */
  const summonDragon = () => {
    const view = viewRef.current, game = gameRef.current;
    if (!view || !game) return;
    if (view.dragon) {
      view.dismissDragon();
      sound.play('roar');
      setDragon(false);
      return;
    }
    view.summonDragon(game.body);
    view.shake(0.7, 3.5);
    sound.play('quake');
    setTimeout(() => sound.play('roar'), 900);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setDragon(true);
    for (const delay of [3000, 4800, 6600]) {
      setTimeout(() => {
        const g = gameRef.current;
        if (!alive.current || !viewRef.current?.dragon || !g) return;
        const t = g.randomGroundTarget();
        if (t) strikeRef.current(t);
      }, delay);
    }
  };

  const select = (i: number) => {
    sound.play('tap');
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    if (gameRef.current) gameRef.current.selected = i;
    equip(false);
  };
  const equip = (on: boolean) => {
    weaponRef.current = on;
    setWeapon(on);
    viewRef.current?.setWeapon(on);
  };
  const code = mode.kind === 'solo' ? null : mode.code;
  const shareCode = () => {
    if (code) Share.share({ message: `Voxel Valley에서 같이 놀자! 앱에서 방 코드 ${code} 입력하고 참가` }).catch(() => {});
  };
  const robots = botsRef.current.filter((b) => b.robot).length;
  const roster = [
    ...players.map((p) => ({ ...p, name: (p.d ?? 0) !== dimCode(dim) ? `${p.name} (${DIMENSION_INFO[DIMS[p.d ?? 0]].name})` : p.name })),
    ...botsRef.current.filter((b) => !b.robot).map((b) => ({ id: b.id, name: `${b.name} (봇)`, color: b.color })),
    ...(robots ? [{ id: 'robots', name: `로봇 시민 ${robots}명`, color: 0xc9d0da }] : []),
    ...petsRef.current.map((p) => ({ id: p.id, name: `❤️ ${SPECIES_INFO[p.species!].name}`, color: p.color })),
  ];
  const season = gameRef.current?.world.season;

  return (
    <View style={styles.root}>
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      <TouchPad style={StyleSheet.absoluteFill}
        onLook={(dx, dy) => {
          // Acceleration curve: slow drags are precise, quick flicks turn a lot.
          const gain = sens.k * (0.75 + Math.min(1.6, Math.hypot(dx, dy) / 16));
          inputRef.current.lookDX += dx * gain;
          inputRef.current.lookDY += dy * gain;
        }}
        onTap={(x, y) => { touchRef.current.tap = { x, y }; }}
        onHold={(p) => { touchRef.current.hold = p; }} />
      <View pointerEvents="none" style={styles.crosshairWrap}>
        <View style={[styles.crossH, hud && hud.dig > 0 ? { width: 22 + 30 * hud.dig } : null]} />
        <View style={styles.crossV} />
      </View>

      <Text pointerEvents="none" style={styles.info}>
        {hud ? [
          dim !== 'valley' ? `${DIMENSION_INFO[dim].emoji} ${DIMENSION_INFO[dim].name}` : season ? `${SEASON_INFO[season].emoji} ${hud.timeLabel}` : hud.timeLabel,
          dim === 'future' ? hud.timeLabel : null,
          hud.target,
        ].filter(Boolean).join('  ·  ') : ''}
      </Text>
      <View style={styles.roomBox}>
        {code && (
          <Pressable testID="share" onPress={shareCode}>
            <Text style={styles.roomCode}>{`방 코드 ${code}  ⤴︎`}</Text>
          </Pressable>
        )}
        {status?.state !== 'online' && status?.error && <Text style={styles.roomStatus}>{status.error}</Text>}
        <View style={styles.playerRow}>
          <View style={[styles.playerDot, { backgroundColor: css(profile.color) }]} />
          <Text style={styles.playerName}>{`${profile.name} (나)`}</Text>
        </View>
        {roster.map((p) => (
          <View key={p.id} style={styles.playerRow}>
            <View style={[styles.playerDot, { backgroundColor: css(p.color) }]} />
            <Text style={styles.playerName}>{p.name}</Text>
          </View>
        ))}
      </View>
      <View style={styles.topRight}>
        <Pressable testID="dragon" style={[styles.pill, dragon && { backgroundColor: 'rgba(196,48,61,0.8)' }]} onPress={summonDragon}>
          <Text style={styles.pillText}>{dragon ? '🐉 돌려보내기' : '🐉 용 소환'}</Text>
        </Pressable>
        <Pressable testID="exit" style={styles.pill} onPress={() => { sound.play('tap'); save(); onExit(); }}>
          <Text style={styles.pillText}>나가기</Text>
        </Pressable>
      </View>

      <Joystick onMove={(x, y) => { inputRef.current.moveX = x; inputRef.current.moveY = y; }} />
      {lookMode === 'stick' && <Joystick side="right" onMove={(x, y) => { lookStick.current = { x, y }; }} />}
      {dim === 'space' ? (
        <>
          <HoldButton label="▲" color="#6b5fd6" style={styles.bigButton} onChange={(h) => { inputRef.current.jump = h; }} />
          <HoldButton label="▼" color="#3d3f73" style={{ right: 122, bottom: 22 }} onChange={(h) => { inputRef.current.down = h; }} />
        </>
      ) : (
        <HoldButton label="점프" color="#56657a" style={styles.bigButton} onChange={(h) => { inputRef.current.jump = h; }} />
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hotbar} contentContainerStyle={styles.hotbarInner}>
        <Pressable testID="weapon" onPress={() => { sound.play('tap'); equip(!weapon); }}
          style={[styles.slot, weapon && styles.slotWeapon]}>
          <Text style={styles.weaponIcon}>⚔️</Text>
        </Pressable>
        {palette.map((b, i) => (
          <Pressable key={b} testID={`slot-${i}`} onPress={() => select(i)}
            style={[styles.slot, !weapon && hud?.selected === i && styles.slotSelected]}>
            <View style={[styles.swatch, { backgroundColor: hex(BLOCKS[b].top) }, BLOCKS[b].glass && styles.swatchGlass]} />
          </Pressable>
        ))}
      </ScrollView>
      {hud && palette.length > 0 && (
        <Text pointerEvents="none" style={styles.selectedName}>{weapon ? '에너지 검' : BLOCKS[palette[hud.selected]].name}</Text>
      )}
      <View pointerEvents="none" style={styles.hpWrap}>
        <Text style={styles.hpIcon}>❤️</Text>
        <View style={styles.hpBar}>
          <View style={[styles.hpFill, { width: `${hp}%`, backgroundColor: hp > 50 ? '#5fd07f' : hp > 25 ? '#f2c94c' : '#ff5a5a' }]} />
        </View>
      </View>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#ff2a2a', opacity: hurtFlash }]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: dim === 'space' ? '#1a1240' : '#e8fbff', opacity: flash }]} />

      {loading && (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>{loading}</Text>
          {status?.state === 'offline' && (
            <Pressable style={[styles.cta, { backgroundColor: '#56657a', marginTop: 16 }]} onPress={onExit}>
              <Text style={styles.ctaText}>돌아가기</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#bfe3f5' },
  cta: { width: 240, paddingVertical: 12, borderRadius: 14, alignItems: 'center' },
  ctaText: { color: 'white', fontSize: 16, fontWeight: '700' },
  crosshairWrap: { position: 'absolute', top: '50%', left: '50%', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 22, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  crossV: { position: 'absolute', width: 3, height: 22, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  info: { position: 'absolute', top: 14, left: 18, color: 'white', fontSize: 15, fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  roomBox: { position: 'absolute', top: 40, left: 14, padding: 8, borderRadius: 10, backgroundColor: 'rgba(30,40,50,0.35)', gap: 3 },
  roomCode: { color: 'white', fontWeight: '800', fontSize: 15, letterSpacing: 1 },
  roomStatus: { color: '#ffd38a', fontSize: 12 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerDot: { width: 10, height: 10, borderRadius: 5 },
  playerName: { color: 'white', fontSize: 13, fontWeight: '600' },
  slotWeapon: { backgroundColor: 'rgba(95,242,255,0.55)' },
  weaponIcon: { fontSize: 22 },
  hpWrap: { position: 'absolute', top: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6 },
  hpIcon: { fontSize: 14 },
  hpBar: { width: 150, height: 10, borderRadius: 5, backgroundColor: 'rgba(20,25,35,0.5)', overflow: 'hidden' },
  hpFill: { height: '100%', borderRadius: 5 },
  bigButton: { right: 22, bottom: 30, width: 88, height: 88, borderRadius: 44 },
  topRight: { position: 'absolute', top: 10, right: 14, flexDirection: 'row', gap: 8 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(30,40,50,0.45)' },
  pillText: { color: 'white', fontWeight: '700' },
  hotbar: { position: 'absolute', bottom: 10, alignSelf: 'center', maxWidth: '52%', borderRadius: 14, backgroundColor: 'rgba(30,40,50,0.35)', flexGrow: 0 },
  hotbarInner: { flexDirection: 'row', gap: 5, padding: 5 },
  swatchGlass: { opacity: 0.55, borderWidth: 2, borderColor: 'rgba(255,255,255,0.95)' },
  slot: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  slotSelected: { backgroundColor: 'rgba(255,255,255,0.6)' },
  swatch: { width: 28, height: 28, borderRadius: 8 },
  selectedName: { position: 'absolute', bottom: 58, alignSelf: 'center', color: 'white', fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#2f4b5c', alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: 'white', fontSize: 18, textAlign: 'center', paddingHorizontal: 30 },
});
