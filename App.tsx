import AsyncStorage from '@react-native-async-storage/async-storage';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { sound } from './src/audio/sound';
import { Block, BLOCKS, Season, SEASON_INFO, SEASONS } from './src/game/blocks';
import { Bot, spawnBots } from './src/game/bots';
import { Game, HudState, Input } from './src/game/game';
import { clearSave, loadSave, Save, savedSeasons, writeSave } from './src/game/storage';
import { isRoomCode, newRoomCode, PlayerInfo, RoomClient, Welcome } from './src/net/room';
import { VoxelRenderer } from './src/render/renderer';
import { HoldButton, Joystick, TouchPad } from './src/ui/controls';

const hex = (c: [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

const PROFILE_KEY = 'voxel-valley-go/profile-v1';
const AVATAR_COLORS = [0xf28b6c, 0x6cb4f2, 0x8bd17c, 0xc89cf0, 0xf2c94c, 0xf27fb2, 0x5fd0c4, 0xb0a08a];
const SENSITIVITY = [{ label: '느림', k: 0.6 }, { label: '보통', k: 1 }, { label: '빠름', k: 1.5 }];
type Profile = { name: string; color: number; sensitivity?: number };

/** solo: offline, saved per season. host: a new shared world. guest: someone else's world. */
type Mode =
  | { kind: 'solo'; season: Season; fresh: boolean }
  | { kind: 'host'; season: Season; code: string }
  | { kind: 'guest'; code: string };

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [season, setSeason] = useState<Season>('spring');
  const [saved, setSaved] = useState<Set<Season>>(new Set());
  const [profile, setProfile] = useState<Profile>({ name: '', color: AVATAR_COLORS[0] });
  const [joinCode, setJoinCode] = useState('');
  const [muted, setMuted] = useState(false);

  const refreshSaves = () => { savedSeasons().then(setSaved); };

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    refreshSaves();
    sound.load().then(() => { setMuted(sound.muted); sound.startMusic(); });
    AsyncStorage.getItem(PROFILE_KEY)
      .then((raw) => {
        if (raw) setProfile(JSON.parse(raw) as Profile);
        else setProfile({ name: `여행자${Math.floor(Math.random() * 900 + 100)}`, color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] });
      })
      .catch(() => {});
    // Links: ?join=CODE joins a room; ?autostart=1 jumps into the summer world (handy for testing).
    const check = (url?: string | null) => {
      if (!url) return;
      const join = /[?&]join=([A-Z0-9]{5})/.exec(url);
      const s = /[?&]season=(spring|summer|autumn|winter)/.exec(url)?.[1] as Season | undefined;
      if (join && isRoomCode(join[1])) setMode({ kind: 'guest', code: join[1] });
      else if (/[?&]autostart=1/.test(url)) setMode({ kind: 'solo', season: s ?? 'summer', fresh: false });
    };
    Linking.getInitialURL().then(check).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => check(e.url));
    return () => sub.remove();
  }, []);

  const updateProfile = (p: Profile) => {
    setProfile(p);
    AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p)).catch(() => {});
  };
  const go = (m: Mode) => { sound.play('tap'); setMode(m); };
  const code = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const info = SEASON_INFO[season];
  const hasSave = saved.has(season);

  if (mode) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <StatusBar hidden />
        <Play mode={mode} profile={profile} onProfile={updateProfile} onExit={() => { setMode(null); refreshSaves(); }} />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      <View style={[styles.title, { backgroundColor: titleBg[season] }]}>
        <Pressable testID="mute" style={styles.muteTitle} onPress={() => { sound.setMuted(!muted); setMuted(!muted); }}>
          <Text style={styles.muteText}>{muted ? '🔇' : '🔊'}</Text>
        </Pressable>
        <Text style={styles.logo}>Voxel Valley</Text>
        <View style={styles.profileRow}>
          <TextInput testID="name" style={styles.nameInput} value={profile.name} maxLength={12} placeholder="이름"
            placeholderTextColor="#8aa" onChangeText={(name) => updateProfile({ ...profile, name })} />
          {AVATAR_COLORS.map((c) => (
            <Pressable key={c} onPress={() => updateProfile({ ...profile, color: c })}
              style={[styles.colorDot, { backgroundColor: css(c) }, profile.color === c && styles.colorDotOn]} />
          ))}
        </View>

        <View style={styles.seasonRow}>
          {SEASONS.map((s) => (
            <Pressable key={s} testID={`season-${s}`} onPress={() => { sound.play('tap'); setSeason(s); }}
              style={[styles.seasonCard, { borderColor: s === season ? 'white' : 'transparent', backgroundColor: SEASON_INFO[s].color }]}>
              <Text style={styles.seasonEmoji}>{SEASON_INFO[s].emoji}</Text>
              <Text style={styles.seasonName}>{SEASON_INFO[s].name}</Text>
              {saved.has(s) && <Text style={styles.seasonSaved}>저장됨</Text>}
            </Pressable>
          ))}
        </View>
        <Text style={styles.tagline}>{info.tagline}</Text>

        <View style={styles.columns}>
          <View style={styles.column}>
            <Pressable testID="start" style={[styles.cta, { backgroundColor: '#3f9d63' }]}
              onPress={() => go({ kind: 'solo', season, fresh: false })}>
              <Text style={styles.ctaText}>{hasSave ? `${info.name} 세계 이어서 하기` : `${info.name} 세계로 입장`}</Text>
            </Pressable>
            {hasSave && (
              <Pressable testID="new-world" style={styles.smallBtn}
                onPress={async () => { await clearSave(season); go({ kind: 'solo', season, fresh: true }); }}>
                <Text style={styles.smallBtnText}>{`새 ${info.name} 세계 만들기`}</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.column}>
            <Pressable testID="host" style={[styles.cta, { backgroundColor: '#d9804f' }]}
              onPress={() => go({ kind: 'host', season, code: newRoomCode() })}>
              <Text style={styles.ctaText}>{`친구와 ${info.name} 방 만들기`}</Text>
            </Pressable>
            <View style={styles.joinRow}>
              <TextInput testID="code" style={styles.codeInput} value={code} maxLength={5} autoCapitalize="characters"
                autoCorrect={false} placeholder="방 코드" placeholderTextColor="#cdd" onChangeText={setJoinCode} />
              <Pressable testID="join" disabled={!isRoomCode(code)}
                style={[styles.joinBtn, !isRoomCode(code) && { opacity: 0.4 }]}
                onPress={() => go({ kind: 'guest', code })}>
                <Text style={styles.ctaText}>참가</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </GestureHandlerRootView>
  );
}

const titleBg: Record<Season, string> = { spring: '#5b4a63', summer: '#2f4b5c', autumn: '#5c4636', winter: '#3d5568' };

type Touch = { tap: { x: number; y: number } | null; hold: { x: number; y: number } | null };

function Play({ mode, profile, onProfile, onExit }: { mode: Mode; profile: Profile; onProfile: (p: Profile) => void; onExit: () => void }) {
  const inputRef = useRef<Input>({ moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, jump: false, dig: false, placeTap: false });
  const touchRef = useRef<Touch>({ tap: null, hold: null });
  const gameRef = useRef<Game | null>(null);
  const roomRef = useRef<RoomClient | null>(null);
  const botsRef = useRef<Bot[]>([]);
  const [hud, setHud] = useState<HudState | null>(null);
  const [palette, setPalette] = useState<Block[]>([]);
  const [loading, setLoading] = useState<string | null>('계곡을 만드는 중...');
  const [status, setStatus] = useState<{ state: 'connecting' | 'online' | 'offline'; error?: string } | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [muted, setMuted] = useState(sound.muted);
  const { width, height } = useWindowDimensions();
  const screen = useRef({ width, height });
  screen.current = { width, height };
  const alive = useRef(true);
  const sens = SENSITIVITY[profile.sensitivity ?? 1];

  // Only solo worlds are saved on this phone; shared worlds live in their room on the server.
  const save = useCallback(() => {
    const g = gameRef.current;
    if (g && mode.kind === 'solo') writeSave(g.toSave());
  }, [mode.kind]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') save(); });
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
        onEdit: (x, y, z, b) => gameRef.current?.applyRemoteEdit(x, y, z, b as Block),
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
      start = { seed: w.seed, season: w.season, edits: w.edits as [string, Block][], pos: near ? [near.x + 1, near.y + 0.5, near.z] : undefined };
      setLoading('계곡을 만드는 중...');
    } else if (mode.kind === 'solo' && !mode.fresh) {
      start = await loadSave(mode.season);
    }
    if (!alive.current) return;
    if (!start) start = { seed: Math.floor(Math.random() * 2 ** 31), season: mode.kind === 'guest' ? 'summer' : mode.season, edits: [] };

    const game = new Game(start);
    gameRef.current = game;
    setPalette(game.palette);
    const view = new VoxelRenderer(gl, game.world);
    view.setSeason(game.world.season);
    game.onBlockChanged = (x, z) => view.blockChanged(x, z);
    game.onEdit = (x, y, z, b) => roomRef.current?.sendEdit(x, y, z, b);
    game.onSound = (s) => sound.play(s);
    if (mode.kind === 'host') {
      void connect({ t: 'create', name: profile.name, color: profile.color, seed: game.world.seed, season: game.world.season, edits: [] }, mode.code);
    }

    const input = inputRef.current, touch = touchRef.current;
    let last = Date.now(), lastHud = 0, ready = false;
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
      game.update(dt, { ...input, dig: input.dig || !!touch.hold, placeTap: input.placeTap || !!touch.tap }, ready);
      input.lookDX = 0;
      input.lookDY = 0;
      input.placeTap = false;
      touch.tap = null;

      if (ready && mode.kind === 'solo' && botsRef.current.length === 0) botsRef.current = spawnBots(game.world, game.body);
      for (const bot of botsRef.current) bot.update(game.world, Math.min(dt, 0.05), game.body);

      const room = roomRef.current;
      if (room && ready) room.sendPos(game.body.x, game.body.y, game.body.z, game.yaw, now);
      const others = [
        ...(room ? room.players.values() : []),
        ...botsRef.current.map((b) => ({ id: b.id, color: b.color, x: b.body.x, y: b.body.y, z: b.body.z, yaw: b.yaw })),
      ];
      view.setAvatars(others, dt);

      const e = game.eye();
      view.camera.position.set(e.x, e.y, e.z);
      view.camera.rotation.set(game.pitch, game.yaw, 0);
      const t = game.target;
      view.setHighlight(t ? t.x : null, t?.y, t?.z);
      view.setDaylight(game.daylight);
      view.render(dt);

      if (now - lastHud > 120) {
        lastHud = now;
        setHud(game.hud());
        if (ready) setLoading(null);
      }
      requestAnimationFrame(frame);
    };
    frame();
  }, [mode, profile, connect]);

  const select = (i: number) => { sound.play('tap'); if (gameRef.current) gameRef.current.selected = i; };
  const code = mode.kind === 'solo' ? null : mode.code;
  const shareCode = () => {
    if (code) Share.share({ message: `Voxel Valley에서 같이 놀자! 앱에서 방 코드 ${code} 입력하고 참가` }).catch(() => {});
  };
  const roster = mode.kind === 'solo'
    ? botsRef.current.map((b) => ({ id: b.id, name: `${b.name} (봇)`, color: b.color }))
    : players;
  const season = gameRef.current?.world.season;

  return (
    <View style={styles.root}>
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      <TouchPad style={StyleSheet.absoluteFill}
        onLook={(dx, dy) => { inputRef.current.lookDX += dx * sens.k; inputRef.current.lookDY += dy * sens.k; }}
        onTap={(x, y) => { touchRef.current.tap = { x, y }; }}
        onHold={(p) => { touchRef.current.hold = p; }} />
      <View pointerEvents="none" style={styles.crosshairWrap}>
        <View style={[styles.crossH, hud && hud.dig > 0 ? { width: 22 + 30 * hud.dig } : null]} />
        <View style={styles.crossV} />
      </View>

      <Text pointerEvents="none" style={styles.info}>
        {hud ? `${season ? `${SEASON_INFO[season].emoji} ` : ''}${hud.timeLabel}${hud.target ? `  ·  ${hud.target}` : ''}` : ''}
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
        <Pressable testID="sens" style={styles.pill}
          onPress={() => onProfile({ ...profile, sensitivity: ((profile.sensitivity ?? 1) + 1) % SENSITIVITY.length })}>
          <Text style={styles.pillText}>{`감도 ${sens.label}`}</Text>
        </Pressable>
        <Pressable testID="mute-play" style={styles.pill} onPress={() => { sound.setMuted(!muted); setMuted(!muted); }}>
          <Text style={styles.pillText}>{muted ? '🔇' : '🔊'}</Text>
        </Pressable>
        <Pressable testID="exit" style={styles.pill} onPress={() => { sound.play('tap'); save(); onExit(); }}>
          <Text style={styles.pillText}>나가기</Text>
        </Pressable>
      </View>

      <Joystick onMove={(x, y) => { inputRef.current.moveX = x; inputRef.current.moveY = y; }} />
      <HoldButton label="캐기" color="#e07a6e" style={{ right: 118, bottom: 96 }} onChange={(h) => { inputRef.current.dig = h; }} />
      <HoldButton label="놓기" color="#5fb37f" style={{ right: 28, bottom: 132 }} onChange={(h) => { if (h) inputRef.current.placeTap = true; }} />
      <HoldButton label="점프" color="#56657a" style={{ right: 28, bottom: 36 }} onChange={(h) => { inputRef.current.jump = h; }} />

      <View style={styles.hotbar}>
        {palette.map((b, i) => (
          <Pressable key={b} testID={`slot-${i}`} onPress={() => select(i)}
            style={[styles.slot, hud?.selected === i && styles.slotSelected]}>
            <View style={[styles.swatch, { backgroundColor: hex(BLOCKS[b].top) }]} />
          </Pressable>
        ))}
      </View>
      {hud && palette.length > 0 && (
        <Text pointerEvents="none" style={styles.selectedName}>{`${BLOCKS[palette[hud.selected]].name} · 무제한`}</Text>
      )}

      {loading && (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>{loading}</Text>
          <Text style={styles.loadingHint}>화면을 끌면 둘러보기 · 블록을 톡 치면 놓기 · 꾹 누르면 캐기</Text>
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
  title: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 9 },
  muteTitle: { position: 'absolute', top: 14, right: 18, padding: 8 },
  muteText: { fontSize: 22 },
  logo: { color: 'white', fontSize: 32, fontWeight: '800' },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: { width: 140, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)',
    color: 'white', fontSize: 15, fontWeight: '700' },
  colorDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: 'transparent' },
  colorDotOn: { borderColor: 'white', transform: [{ scale: 1.15 }] },
  seasonRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  seasonCard: { width: 92, paddingVertical: 8, borderRadius: 14, alignItems: 'center', borderWidth: 3 },
  seasonEmoji: { fontSize: 24 },
  seasonName: { color: 'white', fontSize: 16, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 3 },
  seasonSaved: { color: 'white', fontSize: 10, fontWeight: '700', opacity: 0.9 },
  tagline: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  columns: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
  column: { alignItems: 'center', gap: 8 },
  cta: { width: 240, paddingVertical: 12, borderRadius: 14, alignItems: 'center' },
  ctaText: { color: 'white', fontSize: 16, fontWeight: '700' },
  smallBtn: { paddingVertical: 4, paddingHorizontal: 10 },
  smallBtnText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, textDecorationLine: 'underline' },
  joinRow: { flexDirection: 'row', width: 240, gap: 8 },
  codeInput: { flex: 1, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)', color: 'white',
    fontSize: 17, fontWeight: '800', letterSpacing: 3 },
  joinBtn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: '#5f8fe0' },
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
  topRight: { position: 'absolute', top: 10, right: 14, flexDirection: 'row', gap: 8 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(30,40,50,0.45)' },
  pillText: { color: 'white', fontWeight: '700' },
  hotbar: { position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', gap: 5, padding: 5,
    borderRadius: 14, backgroundColor: 'rgba(30,40,50,0.35)' },
  slot: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  slotSelected: { backgroundColor: 'rgba(255,255,255,0.6)' },
  swatch: { width: 24, height: 24, borderRadius: 7 },
  selectedName: { position: 'absolute', bottom: 58, alignSelf: 'center', color: 'white', fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#2f4b5c', alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: 'white', fontSize: 18, textAlign: 'center', paddingHorizontal: 30 },
  loadingHint: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
});
