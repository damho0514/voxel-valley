import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Gyroscope } from 'expo-sensors';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as THREE from 'three';
import { sound } from '../audio/sound';
import { Block, BLOCKS, Dimension, DIMENSION_INFO, DIMENSIONS } from '../game/blocks';
import { PARK_LEVEL_NAMES, parkingLevelAt } from '../game/darkworlds';
import { spawnGuides } from '../game/guides';
import { trackAt } from '../game/zones';
import { addTime, report, time } from '../game/prof';
import { Bot, knockBack, makeAnimal, spawnAnimals, spawnBots, spawnRobots, SPECIES_INFO } from '../game/bots';
import { Game, HudState, Input, REACH } from '../game/game';
import { loadSave, Save, writeSave } from '../game/storage';
import { DimCode, parseEditKey, PlayerInfo, RoomClient, Welcome } from '../net/room';
import { DIM_PREFIX, isBlock } from '../../server/src/protocol';
import { InvitePanel } from '../ui/invite';
import { RIFT_SWAP, RiftVortex } from '../ui/rift';
import { VoxelRenderer } from '../render/renderer';
import { Joystick, TouchPad } from '../ui/controls';
import { CastButton, makeStore, Pill, RoundButton, THEME } from '../ui/hud';
import { ClickToPlay, HeadChip, KeyHints, MarkHint } from '../ui/desktopHud';
import { useHeadAim } from '../input/head';
import { useInputDevice } from '../input/device';
import { DesktopActions, useDesktopControls } from '../input/desktop';
import { FramePacer } from '../render/pacer';
import { onThermalChange, thermalState } from '../../modules/vv-thermal';
import { SWING_TIME, type Avatar } from '../render/renderer';
import { DrawBreaker } from '../game/drawBreak';
import { addFind, buy, effects, equip as equipWeapon, fmtMoney, incomeMultiplier, Purchase, WEAPONS, weaponOf } from '../game/economy';
import { progress } from '../game/progress';
import { buffs } from '../game/buffs';
import { BUFFS, BuffId, buffOf, ChestReward, gemOfBlock, gemsValue, RARITY, rollChest } from '../game/treasure';
import { MoneyCounter, MoneyFx, MoneyFxHandle } from '../ui/money';
import { Shop } from '../ui/shop';
import { ChestShow, ChestSound } from '../ui/chest';
import { BuffChips, DiscoLights, useBuffs } from '../ui/buffs';
import { Manual } from '../ui/manual';
import { PhotoSubmit, PhotoSound } from '../ui/photoSubmit';
import { TalkPanel } from '../ui/talk';
import { personaOf } from '../game/people';
import { designRoom, nearestStandard, PhotoLook, roomToWorld } from '../game/photoRoom';
import { isPhotoBlock, isReplaceable, setPhotoColors } from '../game/blocks';
import { setPhotoTiles } from '../render/textures';
import { decodeSnap } from '../photo/capture';
import type { Snap } from '../photo/types';
import { FrameSpot, loadPhotoRoom, savePhotoRoom } from '../photo/store';
import { css, LookMode, Mode, Profile, ViewMode } from '../session';
import { raycast } from '../game/raycast';

/*
 * The in-game screen. It pulls in three.js, the renderer, the world generator and the native
 * GL/sensor/haptics modules, so App loads it lazily: the title screen starts without any of it.
 */

const DIMS: Dimension[] = DIMENSIONS;
const ZERO = { x: 0, y: 0, z: 0 };
const dimCode = (d: Dimension) => DIMS.indexOf(d) as DimCode;

const hex = (c: [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

const SENSITIVITY = [{ label: '느림', k: 0.6 }, { label: '보통', k: 1 }, { label: '빠름', k: 1.5 }];

const buzz = (style: Haptics.ImpactFeedbackStyle) => { if (Platform.OS !== 'web') Haptics.impactAsync(style).catch(() => {}); };
const notify = (type: Haptics.NotificationFeedbackType) => { if (Platform.OS !== 'web') Haptics.notificationAsync(type).catch(() => {}); };

/** A cast turns up hidden treasure (the only time the 돈다발 rains) this often. */
const JACKPOT_CHANCE = 0.03;

/** Chests waiting to be shown; past this many, extras open on their own (prize still paid). */
const MAX_CHEST_QUEUE = 4;
type ChestEvent = { reward: ChestReward; total: number };

/** A 내 방 room going up block by block (see game/photoRoom.ts). */
type PhotoBuild = {
  queue: { x: number; y: number; z: number; b: Block; t: number }[];
  i: number;
  start: number;
  look: PhotoLook;
  snap: Snap;
  frame: FrameSpot;
  centre: { x: number; y: number; z: number };
  sparkColors: [number, number, number][];
};

type Touch = { tap: { x: number; y: number } | null; hold: { x: number; y: number } | null; drawing: boolean };

export default function Play({ mode, profile, onProfile, onExit, onHost }: {
  mode: Mode; profile: Profile; onProfile: (p: Profile) => void; onExit: () => void;
  /** Solo only: reopen this world as an online room (for inviting friends). */
  onHost?: () => void;
}) {
  const inputRef = useRef<Input>({ moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, jump: false, down: false, dig: false, placeTap: false });
  const [dim, setDim] = useState<Dimension>('valley');
  const [flash] = useState(() => new Animated.Value(0));
  /** The name of the place you just entered (or the car-park floor you walked onto), fading in and out. */
  const [place, setPlace] = useState<{ title: string; sub?: string } | null>(null);
  const [placeAnim] = useState(() => new Animated.Value(0));
  const showPlaceRef = useRef<(title: string, sub?: string) => void>(() => {});
  showPlaceRef.current = (title, sub) => {
    setPlace({ title, sub });
    placeAnim.stopAnimation();
    placeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(placeAnim, { toValue: 1, duration: 450, useNativeDriver: false }),
      Animated.delay(2200),
      Animated.timing(placeAnim, { toValue: 0, duration: 900, useNativeDriver: false }),
    ]).start();
  };
  /** The 꿀알바 rift swirl is on screen (dug too deep in the valley). */
  const [rift, setRift] = useState(false);
  const [hurtFlash] = useState(() => new Animated.Value(0));
  const [weapon, setWeapon] = useState(false);
  const weaponRef = useRef(false);
  const [hp, setHp] = useState(100);
  const animalsRef = useRef<Bot[]>([]);
  const petsRef = useRef<Bot[]>([]);
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  const viewRef = useRef<VoxelRenderer | null>(null);
  const strikeRef = useRef<(hit: { x: number; y: number; z: number }) => void>(() => {});
  const [dragon, setDragon] = useState(false);
  // The old right-hand look stick is gone: drag to look (or the stick steers while drawing).
  const lookMode: LookMode = !profile.lookMode || profile.lookMode === 'stick' ? 'drag' : profile.lookMode;
  const lookStick = useRef({ x: 0, y: 0 });

  const touchRef = useRef<Touch>({ tap: null, hold: null, drawing: false });
  /** Your character's last action (third person): when its swing began, and where the finger was. */
  const actRef = useRef({ at: 0, point: null as { x: number; y: number } | null });
  /** Who you're chatting with (tap one of the valley's people), and the screen-point picker for it. */
  const [talkBot, setTalkBot] = useState<Bot | null>(null);
  const talkPickRef = useRef<((x: number, y: number) => Bot | null) | null>(null);
  const talkTapRef = useRef(false);
  const openTalkRef = useRef<((b: Bot) => void) | null>(null);
  const gameRef = useRef<Game | null>(null);
  const roomRef = useRef<RoomClient | null>(null);
  const botsRef = useRef<Bot[]>([]);
  const [hud, setHud] = useState<HudState | null>(null);
  const hudReady = hud !== null;
  const [palette, setPalette] = useState<Block[]>([]);
  const [loading, setLoading] = useState<string | null>('계곡을 만드는 중...');
  const [status, setStatus] = useState<{ state: 'connecting' | 'online' | 'offline'; error?: string } | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const { width, height } = useWindowDimensions();
  // Touches, the crosshair and the hand cursor are all relative to the play view, so map screen
  // points with the view's own measured size (on Android the window size can include system bars
  // the view doesn't cover, which put taps off their targets).
  const screen = useRef({ width, height });
  // The drawing tool (draw over blocks to smash them for money) is in hand from the start.
  const [drawing, setDrawing] = useState(true);
  const drawingRef = useRef(true);
  /** How many blocks are marked for the 💥 button (its own store: changes many times a second). */
  const [selStore] = useState(() => makeStore({ count: 0, cap: 0 }));
  const [flying, setFlying] = useState(false);
  const flyingRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  /** Tab held (keyboard): the scoreboard. */
  const [board, setBoard] = useState(false);
  const showBoard = useCallback((held: boolean) => setBoard(held), []);
  /** [ and ] (keyboard): this session's mouse speed on top of the fixed default. */
  const mouseMul = useRef(1);
  /** The weapon before the current one, for Q. */
  const prevKind = useRef<'wand' | 'blocks' | 'blade'>('blocks');
  /** 1인칭 / 3인칭 — remembered in the profile. */
  const [viewMode, setViewMode] = useState<ViewMode>(profile.view ?? 'first');
  const viewModeRef = useRef<ViewMode>(profile.view ?? 'first');
  /** Touch (app, phones, tablets) or keyboard + mouse (a computer's browser); follows what's used. */
  const device = useInputDevice();
  const desktop = device === 'desktop';
  const desktopRef = useRef(desktop);
  /** Left mouse button held (desktop). */
  const mouseRef = useRef({ primary: false });
  const deskActions = useRef<DesktopActions | null>(null);
  const [pacer] = useState(() => new FramePacer());
  /** Restarts the frame loop after it stopped in the background. */
  const resumeRef = useRef<() => void>(() => {});
  const pausedRef = useRef(false);
  /** Until when a burst of effects keeps the frame rate up even with no input. */
  const fxUntil = useRef(0);
  const breakerRef = useRef<DrawBreaker | null>(null);
  const moneyFx = useRef<MoneyFxHandle>(null);
  const [moneyTarget, setMoneyTarget] = useState({ x: width / 2, y: 50 });
  const [size, setSize] = useState({ width, height });
  /** Held upright (phones with rotation lock): HUD rows move so nothing overlaps. */
  const portrait = size.height > size.width;
  const [shopOpen, setShopOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [weaponId, setWeaponId] = useState(progress.get().weapon);
  const [manualOpen, setManualOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const photoBuildRef = useRef<PhotoBuild | null>(null);
  /** Photo rooms are remembered per world: the solo world (its old 'summer' key), or the room code. */
  const photoKey = mode.kind === 'guest' ? `room-${mode.code}` : 'summer';
  const [chests, setChests] = useState<ChestEvent[]>([]);
  const chestCount = useRef(0);
  const buffList = useBuffs();
  const disco = buffList.some((b) => b.id === 'disco');
  const alive = useRef(true);
  const sens = SENSITIVITY[profile.sensitivity ?? 1];
  const sensRef = useRef(sens.k);
  useEffect(() => { sensRef.current = sens.k; }, [sens.k]);
  /** Who's around (bots, robots, pets), refreshed with the HUD. */
  const [locals, setLocals] = useState<{ friends: { id: string; name: string; color: number }[]; robots: number }>({ friends: [], robots: 0 });

  // Settings take effect immediately.
  useEffect(() => {
    const g = gameRef.current;
    if (!g) return;
    desktopRef.current = desktop;
    // With a mouse to look around, A/D always side-step; on touch, the one stick steers (Game.steer).
    g.steer = !desktop;
    g.autoJump = true;
  }, [lookMode, hudReady, desktop]);

  // Heat and battery saver feed the frame pacer (native module; on web it always reports cool).
  useEffect(() => {
    pacer.setThermal(thermalState());
    const off = onThermalChange((st) => pacer.setThermal(st));
    const poll = setInterval(() => pacer.setThermal(thermalState()), 5000);
    return () => { off(); clearInterval(poll); };
  }, [pacer]);

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

  // The wallet and upgrades: load once, and apply every purchase to the running game.
  useEffect(() => {
    const apply = () => {
      const g = gameRef.current, p = progress.get(), fx = effects(p);
      setWeaponId(p.weapon);
      if (!g) return;
      const grew = fx.maxHp - g.maxHp;
      g.maxHp = fx.maxHp;
      if (grew > 0) g.hp += grew; // a bigger heart comes full
      g.walkMul = fx.walk * buffs.walk;
      g.jumpMul = fx.jump * buffs.jump;
      g.placeSize = fx.placeSize;
      g.buildReach = fx.buildReach;
      const extra = fx.specialBlocks ? [Block.Neon, Block.Crystal, Block.Metal, Block.WindowLit] : [];
      if (extra.length !== g.extraBlocks.length) {
        g.extraBlocks = extra;
        setPalette(g.palette);
      }
    };
    progress.load().then(apply);
    const off = progress.subscribe(apply);
    const offBuffs = buffs.subscribe(apply);
    return () => { off(); offBuffs(); progress.flush(); };
  }, [hudReady]);

  // Mystic effects belong to one visit to the game.
  useEffect(() => () => buffs.clear(), []);

  /** Starts mystic effects (the potion just heals). */
  const grantBuffs = useCallback((ids: BuffId[]) => {
    for (const id of ids) {
      if (id === 'heal') {
        const g = gameRef.current;
        if (g) g.hp = g.maxHp;
      } else buffs.add(id);
    }
  }, []);

  const say = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // Only solo worlds are saved on this phone; shared worlds live in their room on the server.
  const save = useCallback(() => {
    const g = gameRef.current;
    breakerRef.current?.flushAll();
    progress.flush();
    if (g && mode.kind === 'solo') writeSave(g.toSave());
  }, [mode.kind]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') {
        save();
        pausedRef.current = true; // the frame loop stops until we're back
      } else {
        sound.resume();
        if (pausedRef.current) {
          pausedRef.current = false;
          pacer.reset();
          resumeRef.current();
        }
      }
    });
    const timer = setInterval(() => { if (gameRef.current?.dirty) { gameRef.current.dirty = false; save(); } }, 8000);
    return () => {
      alive.current = false;
      sub.remove();
      clearInterval(timer);
      save();
      roomRef.current?.close();
    };
  }, [save, pacer]);

  /** 1인칭 ↔ 3인칭. */
  const toggleView = useCallback(() => {
    const next: ViewMode = viewModeRef.current === 'first' ? 'third' : 'first';
    viewModeRef.current = next;
    setViewMode(next);
    sound.play('tap');
    pacer.poke();
    onProfile({ ...profileRef.current, view: next });
    say(next === 'third' ? '🎥 3인칭 시점 · 내 캐릭터가 보여요' : '👁 1인칭 시점');
  }, [onProfile, pacer, say]);


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
      const byDim = Object.fromEntries(DIMS.map((d) => [d, []])) as unknown as Record<Dimension, [string, Block][]>;
      for (const [key, b] of w.edits) {
        const [d, x, y, z] = parseEditKey(key);
        byDim[DIMS[d]]?.push([`${x},${y},${z}`, b as Block]);
      }
      const nearValley = near && near.d === 0 ? near : undefined;
      start = { seed: w.seed, edits: byDim.valley, dimEdits: byDim,
        pos: nearValley ? [nearValley.x + 1, nearValley.y + 0.5, nearValley.z] : undefined };
      setLoading('계곡을 만드는 중...');
    } else if ((mode.kind === 'solo' && !mode.fresh) || (mode.kind === 'host' && mode.fromSave)) {
      // Inviting from a solo world opens that same world (with everything built and broken) as a room.
      start = await loadSave();
    }
    if (!alive.current) return;
    if (!start) start = { seed: Math.floor(Math.random() * 2 ** 31), edits: [] };

    const game = new Game(start);
    gameRef.current = game;
    // Handle for browser-driven tests of the dev build.
    if (__DEV__ && Platform.OS === 'web') (globalThis as { __vvGame?: Game }).__vvGame = game;
    if (__DEV__ && Platform.OS === 'web') (globalThis as { __vvBuffs?: typeof buffs }).__vvBuffs = buffs;
    setPalette(game.palette);
    const view = new VoxelRenderer(gl, game.world);
    view.setDimension(game.dim);
    sound.setTrack(trackAt(game.dim, game.body.x, game.body.y, game.body.z));
    setDim(game.dim);
    game.onBlockChanged = (x, z) => view.blockChanged(x, z);
    game.onEdit = (x, y, z, b) => roomRef.current?.sendEdit(x, y, z, b, dimCode(game.dim));
    game.onSound = (s) => {
      sound.play(s);
      // Digging, placing and cutting each swing the tool in your character's hand.
      if ((s === 'dig' || s === 'place') && Date.now() - actRef.current.at > SWING_TIME * 1000) actRef.current.at = Date.now();
      if (s === 'place') buzz(Haptics.ImpactFeedbackStyle.Light);
      else if (s === 'break') buzz(Haptics.ImpactFeedbackStyle.Medium);
    };
    game.autoJump = true;
    game.steer = !desktopRef.current;
    game.onBreak = (x, y, z, b) => {
      const info = BLOCKS[b];
      view.effects.burst(x, y, z, [info.top, info.side, info.side]);
    };
    viewRef.current = view;
    view.setWand(!weaponRef.current);
    // The last photo room in this world: its colours, and the photo on its wall.
    loadPhotoRoom(photoKey).then(async (rec) => {
      if (!rec || !alive.current) return;
      setPhotoColors(rec.palette);
      setPhotoTiles(rec.palette);
      try {
        const snap = await decodeSnap(rec.jpeg64);
        if (alive.current && viewRef.current === view) view.setPhotoFrame({ ...rec.frame, rgba: snap.rgba, iw: snap.w, ih: snap.h });
      } catch { /* the room keeps its colours even if the picture can't be read */ }
    });
    if (__DEV__ && Platform.OS === 'web') (globalThis as { __vvView?: VoxelRenderer }).__vvView = view;
    if (__DEV__ && Platform.OS === 'web') (globalThis as { __vvMoney?: typeof moneyFx }).__vvMoney = moneyFx;
    if (__DEV__ && Platform.OS === 'web') (globalThis as { __vvProgress?: typeof progress }).__vvProgress = progress;
    if (__DEV__ && Platform.OS === 'web') (globalThis as { __vvBots?: typeof botsRef }).__vvBots = botsRef;
    const buzzKind = { light: Haptics.ImpactFeedbackStyle.Light, medium: Haptics.ImpactFeedbackStyle.Medium, heavy: Haptics.ImpactFeedbackStyle.Heavy };
    const breaker = new DrawBreaker(game, view, {
      sound: (n) => sound.play(n),
      buzz: (k) => buzz(buzzKind[k]),
      shake: (a, t) => view.shake(a, t),
      earn: (amount, at, combo) => {
        progress.set((p) => ({ ...p, money: p.money + Math.round(amount), earned: p.earned + Math.round(amount) }));
        moneyFx.current?.earn(amount, at, combo);
      },
      done: (r) => {
        fxUntil.current = Date.now() + 2500;
        // Sometimes a cast turns up hidden treasure: a jackpot, and only then the 돈다발 rain.
        if (Math.random() < JACKPOT_CHANCE) {
          const p = progress.get();
          const bonus = Math.round(Math.max(120, r.total * (3 + Math.random() * 5)) * incomeMultiplier(p) * buffs.money);
          progress.set((q) => ({ ...q, money: q.money + bonus, earned: q.earned + bonus }));
          moneyFx.current?.payout(r.total + bonus, r.blocks, r.loop, '복 터졌다! 숨은 복주머니', true, '福');
          sound.play('fanfare');
          notify(Haptics.NotificationFeedbackType.Success);
          // A fountain of gold where the spell landed.
          const t = game.target ?? null;
          const c = view.camera.position, d = game.lookDir();
          const fx0 = t ? t.x + 0.5 : c.x + d.x * 6, fy0 = t ? t.y + 1 : c.y + d.y * 6, fz0 = t ? t.z + 0.5 : c.z + d.z * 6;
          view.sparks.burst(fx0, fy0, fz0, [[1, 0.84, 0.3], [1, 0.95, 0.7], [1, 0.6, 0.2]], { count: 160, speed: 6, up: 7, life: 1.6, size: 0.32, spread: 1.2 });
        } else {
          moneyFx.current?.payout(r.total, r.blocks, r.loop);
        }
      },
      toast: say,
      selection: (count, cap) => selStore.set({ count, cap }),
    }, () => {
      const p = progress.get(), w = weaponOf(p);
      // 무한 에너지: three times the blocks per stroke and a fatter brush.
      const weapon = buffs.infinite ? { ...w, cap: w.cap * 3, brush: w.brush + 10 } : w;
      return { weapon, income: incomeMultiplier(p) * buffs.money };
    });
    breaker.setSize(screen.current.width, screen.current.height);
    breakerRef.current = breaker;

    /** Screen point of a block (for coins and pops), or the middle of the screen. */
    const screenAt = (x: number, y: number, z: number) => {
      const { width: w, height: h } = screen.current;
      const s = view.toScreen(x + 0.5, y + 0.5, z + 0.5);
      return s ? { x: ((s.nx + 1) / 2) * w, y: ((1 - s.ny) / 2) * h } : { x: w / 2, y: h / 2 };
    };
    let lastGemSound = 0;
    game.onTreasure = (b, x, y, z) => {
      const p = progress.get();
      const mult = incomeMultiplier(p) * buffs.money;
      const gem = gemOfBlock(b);
      if (gem) {
        const amount = Math.round(gem.value * mult);
        const first = !p.gems[gem.id];
        progress.set((q) => addFind(q, { money: amount, gems: { [gem.id]: 1 } }));
        moneyFx.current?.earn(amount, screenAt(x, y, z), 1);
        const c = new THREE.Color(gem.color), w = new THREE.Color(gem.shine);
        view.effects.burst(x, y, z, [[c.r, c.g, c.b], [w.r, w.g, w.b], [1, 1, 1]], 16);
        const now = Date.now();
        if (now - lastGemSound > 140) { lastGemSound = now; sound.play('gem'); }
        if (first) say(`처음 캔 보석 · ${gem.name} (한 개 ${fmtMoney(gem.value)}냥)`);
        return;
      }
      if (b === Block.Rune) {
        const pick = BUFFS[Math.floor(Math.random() * BUFFS.length)];
        grantBuffs([pick.id]);
        progress.set((q) => addFind(q, { found: [pick.id] }));
        view.effects.burst(x, y, z, [[0.55, 0.42, 1], [0.85, 0.78, 1], [1, 1, 1]], 22);
        sound.play('magic');
        notify(Haptics.NotificationFeedbackType.Success);
        say(`부적 · ${pick.name} — ${pick.desc}`);
        return;
      }
      if (b === Block.Chest) {
        // Deeper chests are luckier. Outside the valley, count them as fairly deep.
        const depth = game.dim === 'valley' ? game.world.surfaceHeight(x, z) - y : 12;
        const reward = rollChest(depth);
        const total = Math.round((reward.money + gemsValue(reward.gems)) * mult);
        // Paid now, so nothing is lost if the show is skipped or the app closes; effects start on "받기".
        progress.set((q) => addFind(q, { money: total, gems: reward.gems, chest: true, found: reward.buffs }));
        progress.flush();
        view.effects.burst(x, y, z, [[0.95, 0.76, 0.3], [0.63, 0.4, 0.18], [1, 1, 0.8]], 24);
        if (chestCount.current >= MAX_CHEST_QUEUE) {
          // Too many at once: open this one quietly.
          grantBuffs(reward.buffs);
          moneyFx.current?.earn(total, screenAt(x, y, z), 1);
          say(`반닫이 · ${RARITY[reward.rarity].name} +${fmtMoney(total)}냥`);
          return;
        }
        chestCount.current++;
        setChests((q) => [...q, { reward, total }]);
        // Stop the stroke so the finger that found it doesn't keep breaking things behind the show.
        setTimeout(() => breakerRef.current?.end(), 0);
      }
    };
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
    game.onRift = () => {
      // Dug too deep: the ground rumbles, space-time swirls shut, and you wake up on the night street.
      say('🌀 시공간이 빨려 들어가요… 꿀알바 출근!');
      sound.play('quake');
      setTimeout(() => sound.play('portal'), 700);
      view.shake(1.0, 1.4);
      buzz(Haptics.ImpactFeedbackStyle.Heavy);
      setTimeout(() => buzz(Haptics.ImpactFeedbackStyle.Heavy), 300);
      setTimeout(() => buzz(Haptics.ImpactFeedbackStyle.Heavy), 900);
      setRift(true);
      setTimeout(() => {
        if (!alive.current || gameRef.current !== game || game.dim !== 'valley') return;
        game.enterDimension('store');
        say('🏪 꿀마트 24 · 새벽 3시, 야간 알바 시작');
      }, RIFT_SWAP);
      setTimeout(() => { if (alive.current) setRift(false); }, 2600);
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
      view.setDimension(d);
      sound.setTrack(trackAt(d, game.body.x, game.body.y, game.body.z));
      sound.arrive(d);
      lastLevel = d === 'parking' ? parkingLevelAt(game.body.y) : -1;
      const info = DIMENSION_INFO[d];
      showPlaceRef.current(`${info.emoji} ${info.name}`, d === 'parking' ? `${PARK_LEVEL_NAMES[lastLevel]} · ${info.tagline}` : info.tagline);
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
      // A room opened from a solo world starts with its edits (room keys: "f:"/"s:" for the other worlds).
      const edits: [string, number][] = [];
      if (mode.fromSave) {
        const sv = game.toSave();
        const add = (prefix: string, list: [string, Block][] | undefined) => { for (const [k, b] of list ?? []) if (isBlock(b) && edits.length < 20000) edits.push([prefix + k, b]); };
        add('', sv.edits);
        DIMS.forEach((d, i) => { if (i > 0) add(DIM_PREFIX[i], sv.dimEdits?.[d]); });
      }
      void connect({ t: 'create', name: profile.name, color: profile.color, seed: game.world.seed, season: 'summer' /* the protocol still carries one; there is only one world */, edits }, mode.code)
        .then(() => { if (mode.fromSave && alive.current) setInviteOpen(true); });
    }

    const input = inputRef.current, touch = touchRef.current;
    let lastXray = 0, xrayOn = false;
    let last = Date.now(), lastHud = 0, ready = false, lastBreath = 0, lastRumble = 0, lastQuake = 0, lastSwing = 0, lastAnimalCheck = 0;
    let petsPlaced = false;
    /** Which car-park floor you were last on (-1 elsewhere), and when the place's sound was last checked. */
    let lastLevel = -1, lastZone = 0;
    view.onFlicker = () => {
      buzz(Haptics.ImpactFeedbackStyle.Light);
      if (Math.random() < 0.35) sound.play('creak');
    };
    view.onLampOut = () => sound.play('lampoff');
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
      if (b.look) { openTalkRef.current?.(b); return true; } // people aren't hit: you talk to them
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
    // Drawing mode routes every touch into strokes: this lets a tap on a person open a chat first.
    talkPickRef.current = (x, y) => {
      const { width: w, height: h } = screen.current;
      const dir = view.rayFromScreen((x / w) * 2 - 1, -((y / h) * 2 - 1));
      const e = game.rayStart();
      const ent = pickEntity(e, dir, 14 + game.viewExtra);
      if (!ent?.bot.look) return null;
      const blk = game.farHit(dir, 14);
      const blkDist = blk ? Math.hypot(blk.x + 0.5 - e.x, blk.y + 0.5 - e.y, blk.z + 0.5 - e.z) : Infinity;
      return ent.t < blkDist ? ent.bot : null;
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
    const perf = { frames: 0, stream: 0, sim: 0, draw: 0, worst: 0, long: 0, since: Date.now() };
    // Reused every frame (no per-frame garbage): the game's input and the avatar list.
    const frameInput: Input = { ...input };
    const avatarBuf: Avatar[] = [];
    let roll = 0, flyClock = 0, lastGust = 0, camDist = 0, handsHidden = false;
    const camOrigin = { x: 0, y: 0, z: 0 };
    const lastBody = { x: game.body.x, y: game.body.y, z: game.body.z };
    let lastBuildSound = 0, lastBuildSpark = 0;
    /** Lays every block that's due, with a patter of taps and sparkles; at the end, hangs the photo. */
    const stepPhotoBuild = (job: PhotoBuild, now: number) => {
      const t = (now - job.start) / 1000;
      let placed = 0, at: { x: number; y: number; z: number } | null = null;
      while (job.i < job.queue.length && job.queue[job.i].t <= t) {
        const c = job.queue[job.i++];
        if (game.build(c.x, c.y, c.z, c.b) && c.b !== Block.Air) { placed++; at = c; }
      }
      if (placed && now - lastBuildSound > 110) { lastBuildSound = now; sound.play('place'); }
      if (at && now - lastBuildSpark > 160) {
        lastBuildSpark = now;
        view.sparks.burst(at.x + 0.5, at.y + 0.8, at.z + 0.5, job.sparkColors, { count: 14, speed: 2, up: 2, life: 0.8, size: 0.18, spread: 0.6 });
      }
      fxUntil.current = Math.max(fxUntil.current, now + 1500);
      if (job.i < job.queue.length) return;
      photoBuildRef.current = null;
      view.setPhotoFrame({ ...job.frame, rgba: job.snap.rgba, iw: job.snap.w, ih: job.snap.h });
      const f = job.frame;
      view.sparks.burst(f.x + f.nx * 0.3, f.y, f.z + f.nz * 0.3, [[1, 0.9, 0.6], [1, 1, 1], ...job.sparkColors], { count: 90, speed: 3, up: 2, life: 1.3, size: 0.24, spread: 1.4 });
      view.sparks.burst(job.centre.x, job.centre.y, job.centre.z, job.sparkColors, { count: 140, speed: 5, up: 4, life: 1.5, size: 0.28, spread: 3 });
      sound.play('fanfare');
      notify(Haptics.NotificationFeedbackType.Success);
      say(`🏠 ${job.look.title} 완성! 안으로 들어가 보세요`);
    };
    resumeRef.current = () => { last = Date.now(); requestAnimationFrame(frame); };
    const frame = () => {
      if (!alive.current || pausedRef.current) return;
      if (!pacer.shouldRender()) { requestAnimationFrame(frame); return; }
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      const t0 = performance.now();
      const turned = input.lookDX !== 0 || input.lookDY !== 0 || !!input.turnYaw || !!input.turnPitch;

      view.syncSize();
      view.stream(game.body.x, game.body.z, ready ? 1 : 3);
      const t1 = performance.now();
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
          const e = game.rayStart();
          const reach = armed ? 12 : REACH;
          const ent = pickEntity(e, dir, reach + game.viewExtra);
          const blk = game.farHit(dir, reach);
          const blkDist = blk ? Math.hypot(blk.x + 0.5 - e.x, blk.y + 0.5 - e.y, blk.z + 0.5 - e.z) : Infinity;
          if (ent && ent.t < blkDist) consumed = hitEntity(ent.bot);
          if (!consumed && armed && blk) consumed = game.mineAt(blk);
          if (armed) {
            consumed = true;
            lastSwing = now;
            view.swing();
            actRef.current.at = now;
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
      // Desktop: the left button held paints marks under the crosshair as the view sweeps.
      if (desktopRef.current && mouseRef.current.primary && drawingRef.current && !game.flying) breaker.paint({ x: w / 2, y: h / 2 });
      time('break', () => breaker.tick(dt));
      // 보물 투시: buried treasure nearby glows through the ground (rescanned once a second).
      if (buffs.has('xray')) {
        if (now - lastXray > 1000) { lastXray = now; view.xray.set(game.treasureNear(10)); xrayOn = true; }
      } else if (xrayOn) { xrayOn = false; view.xray.set([]); }
      Object.assign(frameInput, input);
      // The keyboard's Shift (place) and ⌘/Ctrl + Shift (break) work with any tool in hand.
      frameInput.dig = !armed && !drawingRef.current && (input.dig || !!touch.hold);
      frameInput.breakTap = !!input.keyBreak && !game.flying;
      frameInput.placeTap = (!armed && !drawingRef.current && (input.placeTap || (!!touch.tap && !consumed))) || (!!input.keyPlace && !game.flying);
      game.update(dt, frameInput, ready);
      // Where you are decides the music: the castle grounds, the car park above or below the street.
      if (now - lastZone > 400) {
        lastZone = now;
        sound.setTrack(trackAt(game.dim, game.body.x, game.body.y, game.body.z));
        if (game.dim === 'parking') {
          const lv = parkingLevelAt(game.body.y);
          if (lv !== lastLevel) {
            lastLevel = lv;
            showPlaceRef.current(`🅿️ ${PARK_LEVEL_NAMES[lv]}`, lv < 4 ? '지하' : lv === PARK_LEVEL_NAMES.length - 1 ? '하늘이 보인다' : '지상');
          }
        } else if (game.dim === 'maze' && Math.random() < 0.02) sound.play('creak');
      }
      if (photoBuildRef.current) stepPhotoBuild(photoBuildRef.current, now);
      view.effects.setDig(game.dig, game.target?.x, game.target?.y, game.target?.z);
      // Speed streaks + FOV kick when flying fast in space or air-jumping in the city.
      view.setMotion(game.flying || game.dim === 'space' ? game.velocity : game.dim === 'future' ? { x: 0, y: Math.max(0, game.body.vy) * 1.2, z: 0 } : ZERO, dt);
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
      input.keyPlace = false;
      input.keyBreak = false;
      touch.tap = null;

      // Friends in the solo valley; robot citizens in the future city (in rooms too).
      if (ready && botsRef.current.length === 0) {
        // The guides wait at the dark gate in every valley, solo or in a room.
        if (game.dim === 'valley') botsRef.current = [...(mode.kind === 'solo' ? spawnBots(game.world, game.body) : []), ...spawnGuides(game.world)];
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
        if (animalsRef.current.length < 4) animalsRef.current = [...animalsRef.current, ...spawnAnimals(game.world, game.body, 6 - animalsRef.current.length)];
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
      for (const list of [botsRef.current, animalsRef.current, petsRef.current]) for (const bot of list) bot.update(game.world, step, game.body);

      const room = roomRef.current;
      const d = dimCode(game.dim);
      if (room && ready) room.sendPos(game.body.x, game.body.y, game.body.z, game.yaw, d, now);
      let na = 0;
      const slot = () => (avatarBuf[na] ??= { id: '', color: 0, x: 0, y: 0, z: 0, yaw: 0 });
      if (room)
        for (const p of room.players.values()) {
          if ((p.d ?? 0) !== d) continue;
          const a = slot();
          a.id = p.id; a.color = p.color; a.x = p.x; a.y = p.y; a.z = p.z; a.yaw = p.yaw;
          a.robot = undefined; a.species = undefined; a.pet = undefined; a.flash = undefined; a.emote = undefined;
          a.tool = undefined; a.act = undefined; a.aim = undefined; a.look = 'me';
          na++;
        }
      for (const list of [botsRef.current, animalsRef.current, petsRef.current])
        for (const b of list) {
          const a = slot();
          a.id = b.id; a.color = b.color; a.x = b.body.x; a.y = b.body.y; a.z = b.body.z; a.yaw = b.yaw;
          a.robot = b.robot; a.species = b.species; a.pet = b.pet; a.flash = b.hitFlash; a.emote = b.emote;
          a.tool = undefined; a.act = undefined; a.aim = undefined; a.look = b.look;
          na++;
        }
      if (handsHidden) {
        // Your own character, seen from behind in third person. It acts out what you do: turns
        // toward where your finger is, points the tool while you draw, swings it when you dig,
        // place, cut or cast, and holds whatever is equipped.
        const act = actRef.current;
        const sinceAct = (now - act.at) / 1000;
        const drawingNow = touchRef.current.drawing;
        const spot = drawingNow || sinceAct < SWING_TIME ? touchRef.current.hold ?? act.point : null;
        if (spot && !game.flying) {
          const { width: sw, height: sh } = screen.current;
          const half = Math.tan(((view.camera.fov * Math.PI) / 180) / 2);
          const want = game.yaw - Math.atan(((spot.x - sw / 2) / (sh / 2)) * half);
          game.facing += Math.atan2(Math.sin(want - game.facing), Math.cos(want - game.facing)) * Math.min(1, dt * 12);
        }
        const a = slot();
        a.id = 'self'; a.color = profileRef.current.color; a.x = game.body.x; a.y = game.body.y; a.z = game.body.z; a.yaw = game.facing;
        a.robot = undefined; a.species = undefined; a.pet = undefined; a.flash = undefined; a.emote = undefined; a.sit = game.flying; a.exact = true;
        a.tool = drawingRef.current ? progress.get().weapon : weaponRef.current ? 'blade' : 'block';
        const top = BLOCKS[game.palette[game.selected]]?.top ?? [1, 1, 1];
        a.toolColor = (Math.round(top[0] * 255) << 16) | (Math.round(top[1] * 255) << 8) | Math.round(top[2] * 255);
        a.act = sinceAct;
        a.aim = drawingNow;
        a.look = 'me';
        na++;
      }
      avatarBuf.length = na;
      view.setAvatars(avatarBuf, dt);

      const e = game.eye();
      view.camera.position.set(e.x, e.y, e.z);
      // Flying: bank into turns, a little turbulence at speed, the carpet and its dust, and the
      // phone rumbling with the wind (the "4DX" part).
      const v = game.velocity;
      const flySpeed = game.flying ? Math.hypot(v.x, v.y, v.z) : 0;
      flyClock += dt;
      const wantRoll = game.flying ? Math.max(-0.32, Math.min(0.32, -game.turnRate * 0.11)) : 0;
      roll += (wantRoll - roll) * Math.min(1, dt * 5);
      if (game.flying) {
        const sf = Math.min(1, flySpeed / 15);
        view.camera.position.y += Math.sin(flyClock * 7.3) * 0.012 * sf + Math.sin(flyClock * 2.1) * 0.03;
        view.camera.position.x += Math.sin(flyClock * 5.1) * 0.008 * sf;
        view.updateCarpet(dt, game.body.x, game.body.y, game.body.z, game.yaw, roll, v.y, flySpeed);
        if (flySpeed > 5 && now - lastRumble > 900 - flySpeed * 35) {
          lastRumble = now;
          buzz(flySpeed > 12 ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
        }
        if (flySpeed > 10 && now - lastGust > 2600 + Math.random() * 1500) { lastGust = now; sound.play('whoosh'); }
      }
      view.camera.rotation.set(game.pitch, game.yaw, roll);
      // Third person: the camera glides back over the right shoulder (and comes forward if a
      // wall is in the way), the hands give way to your whole character.
      const wantDist = viewModeRef.current === 'third' ? (game.flying ? 5.2 : 4.2) : 0;
      camDist += (wantDist - camDist) * Math.min(1, dt * 7);
      if (camDist > 0.05) {
        const d = game.lookDir();
        const rx = Math.cos(game.yaw), rz = -Math.sin(game.yaw);
        const u = camDist / 4.2;
        // Back along the view, a little up and to the right.
        const bx = -d.x * camDist + rx * 0.55 * u, by = -d.y * camDist + 0.45 * u, bz = -d.z * camDist + rz * 0.55 * u;
        const len = Math.hypot(bx, by, bz);
        const c = view.camera.position;
        const hit = raycast(game.world, c.x, c.y, c.z, bx / len, by / len, bz / len, len + 0.4);
        const t = hit ? Math.max(0.25, Math.hypot(hit.x + 0.5 - c.x, hit.y + 0.5 - c.y, hit.z + 0.5 - c.z) - 0.75) / len : 1;
        const k = Math.min(1, t);
        c.set(c.x + bx * k, c.y + by * k, c.z + bz * k);
        camOrigin.x = c.x; camOrigin.y = c.y; camOrigin.z = c.z;
        game.viewOrigin = camOrigin;
        game.viewExtra = len * k;
      } else {
        game.viewOrigin = null;
        game.viewExtra = 0;
      }
      const thirdNow = camDist > 0.6;
      if (thirdNow !== handsHidden) { handsHidden = thirdNow; view.setHands(!thirdNow); }
      const t = game.target;
      // While drawing, the finger is the cursor: no outline on the block straight ahead.
      view.setHighlight(t && !drawingRef.current ? t.x : null, t?.y, t?.z);
      view.setDaylight(game.daylight, game.time);
      // The wand tip burns while the finger is drawing.
      if (drawingRef.current && touch.drawing) view.wandCharge(0.9);
      const t2 = performance.now();
      view.render(dt);
      const t3 = performance.now();
      const b = game.body;
      const walked = Math.abs(b.x - lastBody.x) + Math.abs(b.y - lastBody.y) + Math.abs(b.z - lastBody.z) > 0.002;
      lastBody.x = b.x; lastBody.y = b.y; lastBody.z = b.z;
      pacer.active(walked || turned || !!input.moveX || !!input.moveY || !!touch.hold || touch.drawing || breaker.busy
        || game.flying || !!view.dragon || chestCount.current > 0 || now < fxUntil.current || !ready);
      pacer.frameDone(t3 - t0);
      perf.frames++;
      perf.stream += t1 - t0; perf.sim += t2 - t1; perf.draw += t3 - t2;
      addTime('frame', t3 - t0);
      perf.worst = Math.max(perf.worst, dt * 1000);
      if (dt > 0.034) perf.long++;
      if (now - perf.since > 5000) {
        const n = perf.frames;
        console.log(`[perf] ${(n * 1000 / (now - perf.since)).toFixed(1)}fps  stream ${(perf.stream / n).toFixed(1)}ms  sim ${(perf.sim / n).toFixed(1)}ms  draw ${(perf.draw / n).toFixed(1)}ms  worst ${perf.worst.toFixed(0)}ms  long ${perf.long}  calls ${view.stats.calls}  tris ${view.stats.triangles}  pacer ${JSON.stringify(pacer.status)}  | ${report()}`);
        Object.assign(perf, { frames: 0, stream: 0, sim: 0, draw: 0, worst: 0, long: 0, since: now });
      }

      if (now - lastHud > 120) {
        lastHud = now;
        // Only hand React a new object when something on screen changed: re-rendering this whole
        // screen several times a second shows up as hitches in the 3D view.
        const h = game.hud();
        setHud((prev) => prev && prev.selected === h.selected && prev.target === h.target
          && (prev.dig === h.dig || (prev.dig > 0 && h.dig > 0 && Math.abs(prev.dig - h.dig) < 0.04)) ? prev : h);
        setHp(Math.round((game.hp / game.maxHp) * 100));
        const friends = [
          ...botsRef.current.filter((b) => !b.robot).map((b) => ({ id: b.id, name: `${b.name} (봇)`, color: b.color })),
          ...petsRef.current.map((p) => ({ id: p.id, name: `❤️ ${SPECIES_INFO[p.species!].name}`, color: p.color })),
        ];
        const robots = botsRef.current.filter((b) => b.robot).length;
        setLocals((prev) => prev.robots === robots && prev.friends.length === friends.length
          && prev.friends.every((f, i) => f.id === friends[i].id && f.name === friends[i].name && f.color === friends[i].color)
          ? prev : { friends, robots });
        if (ready) setLoading(null);
      }
      requestAnimationFrame(frame);
    };
    frame();
  }, [mode, profile, connect, flash, hurtFlash, onProfile, say, grantBuffs, pacer, selStore, photoKey]);

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
    setDraw(false);
  };
  const equip = (on: boolean) => {
    weaponRef.current = on;
    setWeapon(on);
    viewRef.current?.setWeapon(on);
    viewRef.current?.setWand(!on);
    if (on) setDraw(false);
  };
  const setDraw = (on: boolean) => {
    if (!on) breakerRef.current?.end();
    drawingRef.current = on;
    setDrawing(on);
  };

  /** Hop on (or off) the magic carpet: free flight in any world. Drawing pauses while you fly. */
  const toggleCarpet = () => {
    const g = gameRef.current, v = viewRef.current;
    if (!g || !v) return;
    pacer.poke();
    const on = !flyingRef.current;
    flyingRef.current = on;
    setFlying(on);
    g.setFlying(on);
    v.setCarpet(on);
    if (on) {
      setDraw(false);
      sound.play('magic');
      setTimeout(() => sound.play('whoosh'), 250);
      buzz(Haptics.ImpactFeedbackStyle.Heavy);
      const b = g.body;
      v.sparks.burst(b.x, b.y + 0.6, b.z, [[1, 0.84, 0.4], [1, 0.95, 0.75], [0.9, 0.3, 0.35]], { count: 70, speed: 3, up: 1.5, life: 1.2, size: 0.22, spread: 1.4 });
      say('🧞 양탄자 비행! 조이스틱 = 앞으로 · 화면 끌기 = 방향 · ▲▼ = 오르내리기');
    } else {
      sound.play('tap');
      buzz(Haptics.ImpactFeedbackStyle.Medium);
      inputRef.current.jump = false;
      inputRef.current.down = false;
      say('착륙! ✏️ 그리기로 돌아가려면 ✏️ 버튼');
    }
  };
  /** Tap one of the valley's people: they stop, turn to you, and you chat (by voice). */
  const openTalk = (b: Bot) => {
    if (talkBot && talkBot !== b) { talkBot.talking = false; talkBot.speaking = false; }
    b.talking = true;
    sound.play('tap');
    setTalkBot(b);
  };
  const closeTalk = () => {
    if (talkBot) { talkBot.talking = false; talkBot.speaking = false; }
    setTalkBot(null);
  };
  useEffect(() => { openTalkRef.current = openTalk; });
  const castSpell = () => {
    pacer.poke();
    fxUntil.current = Date.now() + 2500;
    actRef.current.at = Date.now(); // the big swing that sets it off
    breakerRef.current?.cast();
  };
  const clearMarks = () => {
    sound.play('tap');
    breakerRef.current?.clear();
  };
  const toggleMode = () => {
    pacer.poke();
    if (flyingRef.current) toggleCarpet();
    if (drawingRef.current) {
      sound.play('tap');
      setDraw(false);
      say('👀 둘러보기 · 화면을 끌어서 둘러보고, 탭하면 블록을 놓아요');
    } else {
      pickDraw();
      say('✏️ 그리기 · 블록 위에 그리고 💥 부수기 · 조이스틱 좌우로 방향을 돌려요');
    }
  };
  const pickDraw = () => {
    sound.play('tap');
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    equip(false);
    setDraw(true);
  };
  const purchase = (item: Purchase) => {
    const r = buy(progress.get(), item);
    if (!r.ok) {
      sound.play('deny');
      buzz(Haptics.ImpactFeedbackStyle.Light);
      say(r.reason);
      return;
    }
    progress.set(r.progress);
    progress.flush();
    sound.play('buy');
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (item.kind === 'weapon') {
      const w = WEAPONS.find((x) => x.id === item.id)!;
      say(`${w.emoji} ${w.name} 장착! 이제 한 획에 ${w.cap}개까지`);
      pickDraw();
    } else say('구매 완료! 바로 적용됐어요');
  };
  const openShop = () => {
    sound.play('tap');
    setMenuOpen(false);
    breakerRef.current?.end();
    setShopOpen(true);
  };
  const openManual = () => {
    sound.play('tap');
    setMenuOpen(false);
    breakerRef.current?.end();
    setManualOpen(true);
  };
  const openPhoto = () => {
    sound.play('tap');
    setMenuOpen(false);
    breakerRef.current?.end();
    setPhotoOpen(true);
  };
  const photoSound = useCallback((s: PhotoSound) => sound.play(s), []);
  const photoBuzz = useCallback((k: 'light' | 'heavy' | 'success') => {
    if (k === 'success') notify(Haptics.NotificationFeedbackType.Success);
    else buzz(k === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Heavy);
  }, []);
  /**
   * "여기에 짓기": the room goes up in front of the player, facing the way they look. Alone, it's
   * built from the photo's own colours; in a shared room every block is mapped to the nearest
   * standard block, so friends see the same room (the photo frame is only on this device).
   */
  const buildPhotoRoom = (snap: Snap, look: PhotoLook) => {
    setPhotoOpen(false);
    const g = gameRef.current;
    if (!g) return;
    if (flyingRef.current) toggleCarpet(); // land first
    const shared = !!roomRef.current;
    const { cells, frame } = designRoom(look);
    // Stand the room on the ground under the player (up to 24 blocks down; in open space, right here).
    const px = Math.floor(g.body.x), pz = Math.floor(g.body.z);
    let fy = Math.floor(g.body.y + 0.01);
    for (let y = fy; y > Math.max(1, fy - 24); y--) if (g.world.isSolid(px, y - 1, pz)) { fy = y; break; }
    // Face the way the player looks, unless a gate or bedrock is in the way: then try left, right, behind.
    const blocked = (mm: ReturnType<typeof roomToWorld>) => {
      let n = 0;
      for (const c of cells) {
        const p = mm.cell(c.u, c.v, c.h), b = g.world.get(p.x, p.y, p.z), info = BLOCKS[b];
        if (!isReplaceable(b) && (!info.breakable || info.portal)) n++;
      }
      return n;
    };
    const m = [0, Math.PI / 2, -Math.PI / 2, Math.PI].map((d) => roomToWorld(g.yaw + d, px, fy, pz)).find((mm) => blocked(mm) === 0);
    if (!m) {
      sound.play('deny');
      say('🚪 차원문 가까이엔 지을 수 없어요. 조금 떨어진 곳에서 다시 ☰ → 내 공간 제출!');
      return;
    }
    setPhotoColors(look.palette);
    setPhotoTiles(look.palette);
    g.yaw = m.yaw;
    g.pitch = -0.05;
    const queue = cells.map((c) => {
      const p = m.cell(c.u, c.v, c.h);
      const b = shared && isPhotoBlock(c.b) ? nearestStandard(look.palette[c.b - Block.Photo0]) : c.b;
      return { ...p, b, t: c.t };
    });
    // A stone footing under the floor wherever the ground dips away (so the room never floats).
    for (const c of cells) {
      if (c.h !== -1) continue;
      const top = m.cell(c.u, c.v, -2);
      for (let y = top.y, n = 0; y > 0 && n < 8 && !g.world.isSolid(top.x, y, top.z); y--, n++) queue.push({ x: top.x, y, z: top.z, b: Block.Stone, t: c.t });
    }
    queue.sort((a, b) => a.t - b.t);
    const fp = m.point(frame.u + 0.05, frame.v, frame.h);
    const spot: FrameSpot = { x: fp.x, y: fp.y, z: fp.z, nx: m.right.x, nz: m.right.z, w: frame.w, h: frame.hgt, dim: g.dim };
    const centre = m.point(0, 9, 3);
    const rgb = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    photoBuildRef.current = {
      queue, i: 0, start: Date.now() + 250, look, snap, frame: spot, centre,
      sparkColors: [look.wall, look.accent, look.accent2, look.floor].map((k) => rgb(look.palette[k])),
    };
    savePhotoRoom(photoKey, { jpeg64: snap.jpeg64, palette: look.palette, title: look.title, frame: spot, at: Date.now() });
    sound.play('whoosh');
    say(`🧱 ${look.title} 짓는 중…`);
  };
  const chestSound = useCallback((s: ChestSound) => sound.play(s), []);
  const chestBuzz = useCallback((k: 'light' | 'heavy' | 'success' | 'fail') => {
    if (k === 'light') buzz(Haptics.ImpactFeedbackStyle.Light);
    else if (k === 'heavy') buzz(Haptics.ImpactFeedbackStyle.Heavy);
    else notify(k === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  }, []);
  /** The prize card's "받기": start its effects, shower the coins, then the next chest (if any). */
  const collectChest = () => {
    const c = chests[0];
    if (!c) return;
    chestCount.current = Math.max(0, chestCount.current - 1);
    setChests((q) => q.slice(1));
    grantBuffs(c.reward.buffs);
    const r = RARITY[c.reward.rarity];
    moneyFx.current?.earn(c.total, { x: size.width / 2, y: size.height * 0.7 }, 1);
    moneyFx.current?.payout(c.total, 0, 0, c.reward.rarity === 'bust' ? '쪽박이어도 노잣돈은 챙겨야지' : `반닫이 ${r.name}!`, undefined, r.seal);
    if (c.reward.buffs.length) {
      sound.play('magic');
      say(`부적 · ${c.reward.buffs.map((id) => buffOf(id).name).join(' · ')} 효과 시작`);
    }
  };
  // Keyboard + mouse (desktop browsers). The handlers live in src/input/desktop.web.ts; here is
  // what each one does in the game. Rebound after every render so they see the current state.
  const blocked = shopOpen || manualOpen || menuOpen || inviteOpen || chests.length > 0;
  const desk = useDesktopControls(desktop, deskActions as React.RefObject<DesktopActions>, blocked);
  const head = useHeadAim(desktop && desk.locked && !blocked, deskActions);
  useEffect(() => {
    const center = () => ({ x: screen.current.width / 2, y: screen.current.height / 2 });
    // Weapon slots like a PC shooter: 1 main (wand) · 2 secondary (blocks; press again for the
    // next one) · 3 melee (blade) · 4 gear (🐉 dragon) · 5 bomb (💥 the marks). The wheel and the
    // headphone buttons step through wand → each block → blade.
    type Kind = 'wand' | 'blocks' | 'blade';
    const kind = (): Kind => (drawingRef.current ? 'wand' : weaponRef.current ? 'blade' : 'blocks');
    const sel = () => gameRef.current?.selected ?? 0;
    const order = () => 2 + palette.length;
    const position = () => (drawingRef.current ? 0 : weaponRef.current ? order() - 1 : 1 + sel());
    const take = (k: Kind, block?: number) => {
      const was = kind();
      if (was !== k) prevKind.current = was;
      if (k === 'wand') pickDraw();
      else if (k === 'blade') { sound.play('tap'); equip(true); }
      else if (palette.length) select(block ?? sel());
    };
    const step = (dir: 1 | -1) => {
      const i = (position() + dir + order()) % order();
      if (i === 0) take('wand');
      else if (i === order() - 1) take('blade');
      else take('blocks', i - 1);
    };
    const pickSlot = (i: number) => {
      if (i === 0) take('wand');
      else if (i === 1) take('blocks', kind() === 'blocks' && palette.length ? (sel() + 1) % palette.length : sel());
      else if (i === 2) take('blade');
      else if (i === 3) summonDragon();
      else if (i === 4) {
        if (drawingRef.current && !flyingRef.current) castSpell();
        else say('💥 5번은 지팡이(1번)로 표시한 블록을 터뜨려요');
      }
    };
    deskActions.current = {
      look: (dx, dy) => {
        // A fixed angle per pixel (≈0.13°): feels like a PC game's default without any setup.
        const k = 0.4 * sensRef.current * mouseMul.current;
        inputRef.current.lookDX += dx * k;
        inputRef.current.lookDY += dy * k;
      },
      turn: (yaw, pitch) => { const i = inputRef.current; i.turnYaw = (i.turnYaw ?? 0) + yaw; i.turnPitch = (i.turnPitch ?? 0) + pitch; pacer.poke(); },
      move: (x, y) => { inputRef.current.moveX = x; inputRef.current.moveY = y; },
      jump: (held) => { inputRef.current.jump = held; },
      down: (held) => { inputRef.current.down = held; },
      stance: (walk, crouch) => { inputRef.current.walk = walk; inputRef.current.crouch = crouch; },
      primary: (held) => {
        if (held === mouseRef.current.primary) return;
        mouseRef.current.primary = held;
        const b = breakerRef.current, t = touchRef.current;
        if (drawingRef.current && !flyingRef.current) {
          t.drawing = held;
          if (held) b?.begin(center());
          else b?.end();
        } else if (weaponRef.current) {
          t.hold = held ? center() : null;
          if (held) t.tap = center();
        } else {
          inputRef.current.dig = held;
        }
      },
      secondary: () => {
        if (drawingRef.current && !flyingRef.current) castSpell();
        else if (!weaponRef.current) inputRef.current.placeTap = true;
      },
      place: () => { inputRef.current.keyPlace = true; pacer.poke(); },
      breakNow: () => { inputRef.current.keyBreak = true; pacer.poke(); },
      wheel: step,
      slot: pickSlot,
      board: showBoard,
      media: (m) => {
        if (m === 'next') step(1);
        else if (m === 'prev') step(-1);
        else if (flyingRef.current) return;
        // One press = a click for the tool in hand. The wand breaks what's marked, or with
        // nothing marked, the block under the crosshair (AirPods-only play has no sweep).
        else if (drawingRef.current) {
          const b = breakerRef.current;
          if (b && !b.count) { b.begin(center()); b.end(); }
          castSpell();
        }
        else if (weaponRef.current) touchRef.current.tap = center();
        else inputRef.current.placeTap = true;
      },
      key: (k) => {
        if (k === 'carpet') toggleCarpet();
        else if (k === 'view') toggleView();
        else if (k === 'dragon') summonDragon();
        else if (k === 'shop') openShop();
        else if (k === 'help') openManual();
        else if (k === 'clear') clearMarks();
        else if (k === 'cast' && drawingRef.current) castSpell();
        else if (k === 'prev') take(prevKind.current);
        else if (k === 'reload') {
          if (drawingRef.current) { clearMarks(); say('🔄 재장전 · 표시를 비웠어요'); }
        } else if (k === 'sensDown' || k === 'sensUp') {
          const m = Math.min(2.5, Math.max(0.4, mouseMul.current * (k === 'sensUp' ? 1.15 : 1 / 1.15)));
          mouseMul.current = m;
          say(`🖱 마우스 속도 ${Math.round(m * 100)}%`);
        }
      },
      poke: () => pacer.poke(),
    };
  });

  const code = mode.kind === 'solo' ? null : mode.code;
  const roster = [
    ...players.map((p) => ({ ...p, name: (p.d ?? 0) !== dimCode(dim) ? `${p.name} (${DIMENSION_INFO[DIMS[p.d ?? 0]].name})` : p.name })),
    ...locals.friends,
    ...(locals.robots ? [{ id: 'robots', name: `로봇 시민 ${locals.robots}명`, color: 0xc9d0da }] : []),
  ];
  /** The blade's hotbar slot: second on touch, after the blocks with the keyboard (key 3). */
  const blade = (
    <Pressable testID="weapon" onPress={() => { sound.play('tap'); equip(!weapon); }}
      style={[styles.slot, weapon && styles.slotWeapon]}>
      <Text style={styles.weaponIcon}>⚔️</Text>
      {desktop && <Text style={styles.slotKey}>3</Text>}
    </Pressable>
  );

  return (
    <View style={styles.root} onLayout={(e) => {
      const { width: w, height: h } = e.nativeEvent.layout;
      screen.current = { width: w, height: h };
      breakerRef.current?.setSize(w, h);
      setSize({ width: w, height: h });
    }}>
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      <TouchPad style={StyleSheet.absoluteFill}
        onLook={(dx, dy) => {
          pacer.poke();
          // Acceleration curve: slow drags are precise, quick flicks turn a lot.
          const gain = sens.k * (0.75 + Math.min(1.6, Math.hypot(dx, dy) / 16));
          inputRef.current.lookDX += dx * gain;
          inputRef.current.lookDY += dy * gain;
        }}
        onTap={(x, y) => { pacer.poke(); touchRef.current.tap = { x, y }; actRef.current.point = { x, y }; }}
        onHold={(p) => { pacer.poke(); touchRef.current.hold = p; if (p) actRef.current.point = p; }}
        onDraw={drawing ? (phase, x, y) => {
          const b = breakerRef.current;
          if (!b) return;
          pacer.poke();
          // A tap that lands on a person opens a chat instead of starting a stroke.
          if (phase === 'begin') {
            const who = talkPickRef.current?.(x, y);
            if (who) { talkTapRef.current = true; openTalk(who); return; }
          }
          if (talkTapRef.current) { if (phase === 'end') talkTapRef.current = false; return; }
          actRef.current.point = { x, y };
          if (phase === 'begin') { touchRef.current.drawing = true; time('input', () => b.begin({ x, y })); }
          else if (phase === 'move') time('input', () => b.move({ x, y }));
          else { touchRef.current.drawing = false; b.end(); }
        } : null} />
      <View pointerEvents="none" style={[styles.crosshairWrap, drawing && !desktop && { opacity: 0 }]}>
        <View style={[styles.crossH, hud && hud.dig > 0 ? { width: 22 + 30 * hud.dig } : null]} />
        <View style={styles.crossV} />
      </View>

      {desktop && !desk.locked && !blocked && !loading && <ClickToPlay resumed={desk.wasLocked} onPress={() => { sound.resume(); desk.requestLock(); }} />}
      {/* App-style header: status on the left, money in the middle, two icon buttons on the right. */}
      <View style={styles.header} pointerEvents="box-none">
        <View style={styles.status} pointerEvents="none">
          <View style={styles.hpRow}>
            <Text style={styles.hpIcon}>❤️</Text>
            <View style={styles.hpBar}>
              <View style={[styles.hpFill, { width: `${hp}%`, backgroundColor: hp > 50 ? '#5fd07f' : hp > 25 ? '#f2c94c' : '#ff5a5a' }]} />
            </View>
          </View>
          {hudReady && desktop && <InfoLine gameRef={gameRef} dim={dim} />}
        </View>
        <View style={styles.headerRight}>
          <Pill testID="view" label={desktop ? (viewMode === 'first' ? '👁 1인칭' : '🎥 3인칭') : viewMode === 'first' ? '👁' : '🎥'} onPress={toggleView} />
          {(desktop || dragon) && <Pill testID="dragon" label={dragon ? '🐉 ✕' : '🐉'} onPress={summonDragon} />}
          <Pill testID="menu" label="☰" onPress={() => { sound.play('tap'); setMenuOpen((o) => !o); }} />
        </View>
      </View>
      {disco && <DiscoLights />}
      <BuffChips list={buffList} />
      {desktop ? (
        <>
          <KeyHints flying={flying} drawing={drawing} />
          <HeadChip head={head} />
          {drawing && !flying && <MarkHint store={selStore} />}
        </>
      ) : (<>
      <Joystick onMove={(x, y) => { pacer.poke(); inputRef.current.moveX = x; inputRef.current.moveY = y; }} />
      {flying ? (
        <>
          <RoundButton testID="btn-up" label="▲" sub="상승" size={70} style={{ right: 140, bottom: 30 }} onDown={() => { pacer.poke(); inputRef.current.jump = true; }} onUp={() => { inputRef.current.jump = false; }} />
          <RoundButton testID="btn-down" label="▼" sub="하강" size={84} style={{ right: 30, bottom: 34 }} onDown={() => { pacer.poke(); inputRef.current.down = true; }} onUp={() => { inputRef.current.down = false; }} />
        </>
      ) : dim === 'space' ? (
        <>
          <RoundButton testID="btn-▲" label="▲" size={70} style={{ right: 140, bottom: 30 }} onDown={() => { pacer.poke(); inputRef.current.jump = true; }} onUp={() => { inputRef.current.jump = false; }} />
          <RoundButton testID="btn-▼" label="▼" size={58} style={{ right: 148, bottom: 112 }} onDown={() => { pacer.poke(); inputRef.current.down = true; }} onUp={() => { inputRef.current.down = false; }} />
        </>
      ) : (
        // Jump owns the bottom-right corner, where the thumb rests (as in Roblox's mobile layout).
        <RoundButton testID="btn-점프" label="⤒" size={78} style={{ right: 20, bottom: 18 }} onDown={() => { pacer.poke(); inputRef.current.jump = true; }} onUp={() => { inputRef.current.jump = false; }} />
      )}
      {/* Small secondary icons stack above jump; nothing else crowds the corner. */}
      {!flying && <RoundButton testID="mode" label={drawing ? '👀' : '✏️'} size={50} style={{ right: 34, bottom: 108 }} onDown={toggleMode} />}
      <RoundButton testID="carpet" label="🧞" sub={flying ? '착륙' : undefined} size={flying ? 70 : 50} tone={flying ? 'gold' : 'glass'}
        style={flying ? { right: 42, bottom: 150 } : { right: 34, bottom: 166 }} onDown={toggleCarpet} />
      {!flying && <CastButton store={selStore} visible={drawing} onCast={castSpell} onClear={clearMarks} style={{ right: 112, bottom: 12 }} />}
      </>)}

      {!flying && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.hotbar, portrait && styles.hotbarPortrait]} contentContainerStyle={styles.hotbarInner}>
        <Pressable testID="draw" onPress={pickDraw} style={[styles.slot, drawing && styles.slotDraw]}>
          <Text style={styles.weaponIcon}>{WEAPONS.find((w) => w.id === weaponId)?.emoji ?? '✏️'}</Text>
          {desktop && <Text style={styles.slotKey}>1</Text>}
        </Pressable>
        {!desktop && blade}
        {palette.map((b, i) => (
          <Pressable key={b} testID={`slot-${i}`} onPress={() => select(i)}
            style={[styles.slot, !weapon && !drawing && hud?.selected === i && styles.slotSelected]}>
            <View style={[styles.swatch, { backgroundColor: hex(BLOCKS[b].top) }, b === Block.Metal && styles.swatchMetal, BLOCKS[b].glass && styles.swatchGlass]}>
              {BLOCKS[b].glass && <View style={styles.glassShine} />}
            </View>
            {desktop && <Text style={styles.slotKey}>2</Text>}
          </Pressable>
        ))}
        {desktop && <>
          {blade}
          <Pressable testID="slot-dragon" onPress={summonDragon} style={[styles.slot, dragon && styles.slotWeapon]}>
            <Text style={styles.weaponIcon}>🐉</Text>
            <Text style={styles.slotKey}>4</Text>
          </Pressable>
          <Pressable testID="slot-cast" onPress={() => { if (drawing) castSpell(); }} style={[styles.slot, !drawing && styles.slotOff]}>
            <Text style={styles.weaponIcon}>💥</Text>
            <Text style={styles.slotKey}>5</Text>
          </Pressable>
        </>}
      </ScrollView>}
      {board && (
        <View pointerEvents="none" style={styles.board}>
          <Text style={styles.menuHead}>{code ? `방 ${code} · 함께 있는 사람` : '함께 있는 사람'}</Text>
          {[{ id: 'me', name: `${profile.name} (나)`, color: profile.color }, ...roster].map((p) => (
            <View key={p.id} style={styles.playerRow}>
              <View style={[styles.playerDot, { backgroundColor: css(p.color) }]} />
              <Text style={styles.playerName}>{p.name}</Text>
            </View>
          ))}
        </View>
      )}
      {hud && palette.length > 0 && !flying && (desktop ? (
        <Text pointerEvents="none" style={[styles.selectedName, portrait && styles.selectedNamePortrait]}>
          {drawing ? `${WEAPONS.find((w) => w.id === weaponId)?.name ?? ''} · 좌클릭 쓸어서 표시 · 우클릭 💥` : weapon ? '에너지 검 · 좌클릭 베기' : `${BLOCKS[palette[hud.selected]].name} · 좌클릭 캐기 · 우클릭 놓기`}
        </Text>
      ) : (
        <FadingHint text={drawing ? `${WEAPONS.find((w) => w.id === weaponId)?.name ?? ''} · 블록 위에 그리고 💥` : weapon ? '에너지 검 · 탭해서 베기' : `${BLOCKS[palette[hud.selected]].name} · 탭해서 놓기`} />
      ))}
      {hudReady && <MoneyCounter onPress={openShop} onTarget={setMoneyTarget} top={portrait ? 66 : undefined} />}
      <MoneyFx ref={moneyFx} target={moneyTarget} width={size.width} height={size.height} onSound={(n) => sound.play(n)} />
      {toast && <Text pointerEvents="none" style={styles.toast}>{toast}</Text>}
      {inviteOpen && code && (
        <InvitePanel code={code} name={profile.name} online={status?.state === 'online'} onClose={() => { sound.play('tap'); setInviteOpen(false); }} />
      )}
      {menuOpen && (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)}>
          <View style={styles.menu}>
            <MenuRow icon="📸" label="내 공간 제출 (사진→방)" onPress={openPhoto} />
            <MenuRow icon="🛒" label="상점" onPress={openShop} />
            {!desktop && <MenuRow icon="🐉" label={dragon ? '용 돌려보내기' : '용 부르기'} onPress={() => { setMenuOpen(false); summonDragon(); }} />}
            <MenuRow icon="❓" label="도움말" onPress={openManual} />
            <MenuRow icon="👥" label={code ? `친구 초대 링크 보내기 (방 ${code})` : '친구 초대 (링크 보내기)'} onPress={() => {
              sound.play('tap');
              setMenuOpen(false);
              if (code) setInviteOpen(true);
              // Solo: reopen this world as a room; the invite opens as soon as it's online.
              else if (onHost) { breakerRef.current?.flushAll(); save(); onHost(); }
            }} />
            <View style={styles.menuPeople}>
              <Text style={styles.menuHead}>함께 있는 사람</Text>
              {status?.state !== 'online' && status?.error && <Text style={styles.roomStatus}>{status.error}</Text>}
              {[{ id: 'me', name: `${profile.name} (나)`, color: profile.color }, ...roster].map((p) => (
                <View key={p.id} style={styles.playerRow}>
                  <View style={[styles.playerDot, { backgroundColor: css(p.color) }]} />
                  <Text style={styles.playerName}>{p.name}</Text>
                </View>
              ))}
            </View>
            <MenuRow icon="🚪" label="저장하고 나가기" onPress={() => { sound.play('tap'); setMenuOpen(false); save(); onExit(); }} />
          </View>
        </Pressable>
      )}
      {shopOpen && (
        <Shop onBuy={purchase} onClose={() => { sound.play('tap'); setShopOpen(false); }}
          onEquip={(id) => { sound.play('tap'); progress.set((p) => equipWeapon(p, id)); pickDraw(); }} />
      )}
      {talkBot && personaOf(talkBot.look) && (
        <TalkPanel key={talkBot.id} persona={personaOf(talkBot.look)!} onClose={closeTalk}
          onSpeaking={(on) => { talkBot.speaking = on; }} />
      )}
      {manualOpen && <Manual onClose={() => { sound.play('tap'); setManualOpen(false); }} />}
      {photoOpen && (
        <PhotoSubmit width={size.width} height={size.height} onSound={photoSound} onBuzz={photoBuzz}
          onBuild={buildPhotoRoom} onClose={() => setPhotoOpen(false)} />
      )}
      {chests[0] && (
        <ChestShow key={chests[0].reward.id} reward={chests[0].reward} total={chests[0].total} width={size.width} height={size.height}
          onSound={chestSound} onBuzz={chestBuzz} onCollect={collectChest} />
      )}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#ff2a2a', opacity: hurtFlash }]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: dim === 'space' ? '#1a1240' : dim === 'store' ? '#120c2a' : dim === 'maze' ? '#000000' : dim === 'parking' ? '#0c0f14' : '#e8fbff', opacity: flash }]} />
      {place && (
        <Animated.View pointerEvents="none" style={[styles.placeBanner, { opacity: placeAnim, transform: [{ translateY: placeAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}>
          <Text style={styles.placeTitle}>{place.title}</Text>
          {place.sub ? <Text style={styles.placeSub}>{place.sub}</Text> : null}
        </Animated.View>
      )}
      {rift && <RiftVortex size={size} />}

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

/**
 * The tool hint over the hotbar, on touch only for a moment after it changes: a phone screen
 * has no room for a caption that never goes away.
 */
function FadingHint({ text }: { text: string }) {
  const [fade] = useState(() => new Animated.Value(0));
  useEffect(() => {
    fade.setValue(1);
    const a = Animated.sequence([Animated.delay(2500), Animated.timing(fade, { toValue: 0, duration: 500, useNativeDriver: true })]);
    a.start();
    return () => a.stop();
  }, [text, fade]);
  return <Animated.Text pointerEvents="none" style={[styles.selectedName, { opacity: fade }]}>{text}</Animated.Text>;
}

/** One row of the ☰ menu. */
function MenuRow({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: 'rgba(255,246,220,0.12)' }]}>
      <Text style={styles.menuIcon}>{icon}</Text>
      <Text style={styles.menuLabel}>{label}</Text>
    </Pressable>
  );
}

/** Place and clock; updates itself so the play screen doesn't re-render. */
function InfoLine({ gameRef, dim }: { gameRef: React.RefObject<Game | null>; dim: Dimension }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const tick = () => {
      const g = gameRef.current;
      if (!g) return;
      setText(`${DIMENSION_INFO[dim].emoji} ${DIMENSION_INFO[dim].name}`);
    };
    tick();
    const id = setInterval(tick, 700);
    return () => clearInterval(id);
  }, [gameRef, dim]);
  return <Text pointerEvents="none" style={styles.info}>{text}</Text>;
}

const styles = StyleSheet.create({
  placeBanner: { position: 'absolute', top: '22%', left: 16, right: 16, alignItems: 'center' },
  placeTitle: { color: '#fff', fontSize: 30, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 12, textAlign: 'center' },
  placeSub: { color: 'rgba(255,255,255,0.78)', fontSize: 14, marginTop: 6, textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 8, textAlign: 'center' },
  // Effects fly past the edges (rays, banknotes, the chest lid): clip them so the web page never scrolls.
  root: { flex: 1, backgroundColor: '#bfe3f5', overflow: 'hidden' },
  cta: { width: 240, paddingVertical: 12, borderRadius: 14, alignItems: 'center' },
  ctaText: { color: 'white', fontSize: 16, fontWeight: '700' },
  crosshairWrap: { position: 'absolute', top: '50%', left: '50%', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 22, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  crossV: { position: 'absolute', width: 3, height: 22, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  info: { color: THEME.inkSoft, fontSize: 12, fontWeight: '700', marginTop: 3 },
  header: { position: 'absolute', top: 8, left: 14, right: 14, height: 44, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  status: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: THEME.glass, borderWidth: 1, borderColor: THEME.rimSoft },
  hpRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerRight: { flexDirection: 'row', gap: 8 },
  menu: { position: 'absolute', top: 58, right: 14, width: 250, padding: 8, borderRadius: 18, backgroundColor: 'rgba(12,18,34,0.94)',
    borderWidth: 1, borderColor: THEME.rim, gap: 2 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12 },
  menuIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  menuLabel: { color: THEME.ink, fontSize: 15, fontWeight: '800' },
  menuPeople: { paddingHorizontal: 12, paddingVertical: 8, gap: 4, borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(232,194,106,0.2)', marginVertical: 4 },
  menuHead: { color: THEME.inkSoft, fontSize: 12, fontWeight: '800', marginBottom: 2 },
  roomStatus: { color: '#ffd38a', fontSize: 12 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerDot: { width: 10, height: 10, borderRadius: 5 },
  playerName: { color: 'white', fontSize: 13, fontWeight: '600' },
  slotWeapon: { backgroundColor: 'rgba(95,242,255,0.55)', borderColor: '#bff8ff' },
  slotDraw: { backgroundColor: 'rgba(242,195,91,0.85)', borderColor: '#fff3cf' },
  toast: { position: 'absolute', top: 62, alignSelf: 'center', maxWidth: '70%', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14,
    backgroundColor: THEME.glassHi, borderWidth: 1, borderColor: THEME.rimSoft, color: THEME.ink, fontSize: 14, fontWeight: '700', textAlign: 'center', overflow: 'hidden' },
  weaponIcon: { fontSize: 22 },
  hotbarPortrait: { bottom: undefined, top: 116, maxWidth: '92%' },
  selectedNamePortrait: { bottom: undefined, top: 176 },
  slotOff: { opacity: 0.45 },
  board: { position: 'absolute', top: '18%', alignSelf: 'center', minWidth: 280, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 16,
    backgroundColor: 'rgba(12,18,34,0.9)', borderWidth: 1, borderColor: THEME.rim, gap: 6 },
  slotKey: { position: 'absolute', top: 1, left: 4, color: THEME.inkSoft, fontSize: 10, fontWeight: '900' },
  hpIcon: { fontSize: 12 },
  hpBar: { width: 96, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  hpFill: { height: '100%', borderRadius: 5 },
  hotbar: { position: 'absolute', bottom: 10, alignSelf: 'center', maxWidth: '44%', borderRadius: 16, backgroundColor: THEME.glass, borderWidth: 1, borderColor: THEME.rimSoft, flexGrow: 0 },
  hotbarInner: { flexDirection: 'row', gap: 5, padding: 5 },
  // Clear glass reads as a pale-blue pane with a bright rim; metal as dark brushed steel.
  swatchGlass: { backgroundColor: 'rgba(160,215,255,0.28)', borderWidth: 2, borderColor: 'rgba(225,245,255,0.95)' },
  glassShine: { position: 'absolute', top: 3, left: 9, width: 5, height: 20, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.85)', transform: [{ rotate: '30deg' }] },
  swatchMetal: { backgroundColor: '#7d8898', borderWidth: 2, borderTopColor: '#e3e8ef', borderLeftColor: '#c9d1dc', borderRightColor: '#56606e', borderBottomColor: '#4a5360' },
  slot: { width: 44, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'transparent' },
  slotSelected: { backgroundColor: 'rgba(255,246,220,0.35)', borderColor: THEME.gold },
  swatch: { width: 28, height: 28, borderRadius: 8, overflow: 'hidden' },
  selectedName: { position: 'absolute', bottom: 58, alignSelf: 'center', color: 'white', fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#2f4b5c', alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: 'white', fontSize: 18, textAlign: 'center', paddingHorizontal: 30 },
});
