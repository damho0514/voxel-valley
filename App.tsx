import AsyncStorage from '@react-native-async-storage/async-storage';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Block, BLOCKS, PLACEABLE } from './src/game/blocks';
import { Game, HudState, Input } from './src/game/game';
import { clearSave, loadSave, Save, writeSave } from './src/game/storage';
import { isRoomCode, newRoomCode, PlayerInfo, RoomClient, Welcome } from './src/net/room';
import { VoxelRenderer } from './src/render/renderer';
import { HoldButton, Joystick, LookPad } from './src/ui/controls';

const hex = (c: [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

const PROFILE_KEY = 'voxel-valley-go/profile-v1';
const AVATAR_COLORS = [0xf28b6c, 0x6cb4f2, 0x8bd17c, 0xc89cf0, 0xf2c94c, 0xf27fb2, 0x5fd0c4, 0xb0a08a];
type Profile = { name: string; color: number };

/** solo: offline, saved on this phone. host: your saved world, shared. guest: someone else's world. */
type Mode = { kind: 'solo'; fresh: boolean } | { kind: 'host'; code: string; fresh: boolean } | { kind: 'guest'; code: string };

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [hasSave, setHasSave] = useState(false);
  const [profile, setProfile] = useState<Profile>({ name: '', color: AVATAR_COLORS[0] });
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    loadSave().then((s) => setHasSave(!!s));
    AsyncStorage.getItem(PROFILE_KEY)
      .then((raw) => {
        if (raw) setProfile(JSON.parse(raw) as Profile);
        else setProfile({ name: `여행자${Math.floor(Math.random() * 900 + 100)}`, color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] });
      })
      .catch(() => {});
    // Links ending in ?autostart=1 jump straight into the game (handy for testing and sharing).
    const check = (url?: string | null) => {
      if (!url) return;
      const join = /[?&]join=([A-Z0-9]{5})/.exec(url);
      if (join && isRoomCode(join[1])) setMode({ kind: 'guest', code: join[1] });
      else if (/[?&]autostart=1/.test(url)) setMode({ kind: 'solo', fresh: false });
    };
    Linking.getInitialURL().then(check).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => check(e.url));
    return () => sub.remove();
  }, []);

  const updateProfile = (p: Profile) => {
    setProfile(p);
    AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p)).catch(() => {});
  };
  const code = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (mode) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <StatusBar hidden />
        <Play mode={mode} profile={profile} onExit={() => { setMode(null); loadSave().then((s) => setHasSave(!!s)); }} />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      <View style={styles.title}>
        <Text style={styles.logo}>Voxel Valley</Text>
        <View style={styles.profileRow}>
          <TextInput testID="name" style={styles.nameInput} value={profile.name} maxLength={12} placeholder="이름"
            placeholderTextColor="#8aa" onChangeText={(name) => updateProfile({ ...profile, name })} />
          {AVATAR_COLORS.map((c) => (
            <Pressable key={c} onPress={() => updateProfile({ ...profile, color: c })}
              style={[styles.colorDot, { backgroundColor: css(c) }, profile.color === c && styles.colorDotOn]} />
          ))}
        </View>
        <View style={styles.columns}>
          <View style={styles.column}>
            <Text style={styles.columnTitle}>혼자 하기</Text>
            <Pressable testID="start" style={[styles.cta, { backgroundColor: '#5fbf7f' }]}
              onPress={() => setMode({ kind: 'solo', fresh: false })}>
              <Text style={styles.ctaText}>{hasSave ? '이어서 하기' : '시작하기'}</Text>
            </Pressable>
            {hasSave && (
              <Pressable testID="new-world" style={[styles.cta, { backgroundColor: '#8b7fd6' }]}
                onPress={async () => { await clearSave(); setMode({ kind: 'solo', fresh: true }); }}>
                <Text style={styles.ctaText}>새 세계 만들기</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.column}>
            <Text style={styles.columnTitle}>친구와 같이</Text>
            <Pressable testID="host" style={[styles.cta, { backgroundColor: '#e0905f' }]}
              onPress={() => setMode({ kind: 'host', code: newRoomCode(), fresh: false })}>
              <Text style={styles.ctaText}>{hasSave ? '내 세계로 방 만들기' : '방 만들기'}</Text>
            </Pressable>
            <View style={styles.joinRow}>
              <TextInput testID="code" style={styles.codeInput} value={code} maxLength={5} autoCapitalize="characters"
                autoCorrect={false} placeholder="방 코드" placeholderTextColor="#8aa" onChangeText={setJoinCode} />
              <Pressable testID="join" disabled={!isRoomCode(code)}
                style={[styles.joinBtn, !isRoomCode(code) && { opacity: 0.4 }]}
                onPress={() => setMode({ kind: 'guest', code })}>
                <Text style={styles.ctaText}>참가</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </GestureHandlerRootView>
  );
}

function Play({ mode, profile, onExit }: { mode: Mode; profile: Profile; onExit: () => void }) {
  const inputRef = useRef<Input>({ moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, jump: false, dig: false, placeTap: false });
  const gameRef = useRef<Game | null>(null);
  const roomRef = useRef<RoomClient | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [loading, setLoading] = useState<string | null>('계곡을 만드는 중...');
  const [status, setStatus] = useState<{ state: 'connecting' | 'online' | 'offline'; error?: string } | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const alive = useRef(true);
  const shared = mode.kind !== 'solo';

  // Guests play in someone else's world, so nothing is saved on their phone.
  const save = useCallback(() => {
    const g = gameRef.current;
    if (g && mode.kind !== 'guest') writeSave(g.toSave());
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
      if (k >= '1' && k <= '9' && gameRef.current) gameRef.current.selected = Number(k) - 1;
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
      roomRef.current = new RoomClient(code, hello, {
        onWelcome: resolve,
        onEdit: (x, y, z, b) => gameRef.current?.applyRemoteEdit(x, y, z, b as Block),
        onPlayers: (ps) => setPlayers([...ps.values()]),
        onStatus: (state, error) => {
          if (!alive.current) return;
          setStatus({ state, error });
          if (error) setLoading((l) => (l ? error : l));
        },
      });
    }), []);

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    let saved: Save | null = null;
    if (mode.kind === 'guest') {
      setLoading('방에 들어가는 중...');
      const w = await connect({ t: 'join', name: profile.name, color: profile.color }, mode.code);
      // Spawn beside someone already there, if anyone has a position yet.
      const near = w.players.find((p) => p.y > -50);
      saved = { seed: w.seed, edits: w.edits as [string, Block][], pos: near ? [near.x + 1, near.y + 0.5, near.z] : undefined };
      setLoading('계곡을 만드는 중...');
    } else if (!mode.fresh) {
      saved = await loadSave();
    }
    if (!alive.current) return;

    const game = new Game(saved);
    gameRef.current = game;
    const view = new VoxelRenderer(gl, game.world);
    game.onBlockChanged = (x, z) => view.blockChanged(x, z);
    game.onEdit = (x, y, z, b) => roomRef.current?.sendEdit(x, y, z, b);
    if (mode.kind === 'host') {
      writeSave(game.toSave()); // so the shared world is kept even if this is a brand-new one
      void connect({ t: 'create', name: profile.name, color: profile.color, seed: game.world.seed, edits: [...game.world.edits] }, mode.code);
    }

    const input = inputRef.current;
    let last = Date.now(), lastHud = 0, ready = false;
    const frame = () => {
      if (!alive.current) return;
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;

      view.stream(game.body.x, game.body.z, ready ? 1 : 3);
      ready = view.isReady(game.body.x, game.body.z);
      game.update(dt, input, ready);
      input.lookDX = 0;
      input.lookDY = 0;
      input.placeTap = false;

      const room = roomRef.current;
      if (room) {
        if (ready) room.sendPos(game.body.x, game.body.y, game.body.z, game.yaw, now);
        view.setAvatars(room.players.values(), dt);
      }

      const e = game.eye();
      view.camera.position.set(e.x, e.y, e.z);
      view.camera.rotation.set(game.pitch, game.yaw, 0);
      const t = game.target;
      view.setHighlight(t ? t.x : null, t?.y, t?.z);
      view.setDaylight(game.daylight);
      view.render();

      if (now - lastHud > 120) {
        lastHud = now;
        setHud(game.hud());
        if (ready) setLoading(null);
      }
      requestAnimationFrame(frame);
    };
    frame();
  }, [mode, profile, connect]);

  const select = (i: number) => { if (gameRef.current) gameRef.current.selected = i; };
  const code = mode.kind === 'solo' ? null : mode.code;
  const shareCode = () => {
    if (code) Share.share({ message: `Voxel Valley에서 같이 놀자! 앱에서 "친구와 같이 → 방 코드"에 ${code} 입력` }).catch(() => {});
  };

  return (
    <View style={styles.root}>
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      <LookPad style={styles.lookPad} onLook={(dx, dy) => { inputRef.current.lookDX += dx; inputRef.current.lookDY += dy; }} />
      <View pointerEvents="none" style={styles.crosshairWrap}>
        <View style={[styles.crossH, hud && hud.dig > 0 ? { width: 22 + 30 * hud.dig } : null]} />
        <View style={styles.crossV} />
      </View>

      <Text style={styles.info}>{hud ? `${hud.timeLabel}${hud.target ? `  ·  ${hud.target}` : ''}` : ''}</Text>
      {shared && (
        <View style={styles.roomBox}>
          <Pressable testID="share" onPress={shareCode}>
            <Text style={styles.roomCode}>{`방 코드 ${code}  ⤴︎`}</Text>
          </Pressable>
          {status?.state !== 'online' && status?.error && <Text style={styles.roomStatus}>{status.error}</Text>}
          <View style={styles.playerRow}>
            <View style={[styles.playerDot, { backgroundColor: css(profile.color) }]} />
            <Text style={styles.playerName}>{`${profile.name} (나)`}</Text>
          </View>
          {players.map((p) => (
            <View key={p.id} style={styles.playerRow}>
              <View style={[styles.playerDot, { backgroundColor: css(p.color) }]} />
              <Text style={styles.playerName}>{p.name}</Text>
            </View>
          ))}
        </View>
      )}
      <Pressable testID="exit" style={styles.exit} onPress={() => { save(); onExit(); }}>
        <Text style={styles.exitText}>나가기</Text>
      </Pressable>

      <Joystick onMove={(x, y) => { inputRef.current.moveX = x; inputRef.current.moveY = y; }} />
      <HoldButton label="캐기" color="#e07a6e" style={{ right: 118, bottom: 96 }} onChange={(h) => { inputRef.current.dig = h; }} />
      <HoldButton label="놓기" color="#5fb37f" style={{ right: 28, bottom: 132 }} onChange={(h) => { if (h) inputRef.current.placeTap = true; }} />
      <HoldButton label="점프" color="#56657a" style={{ right: 28, bottom: 36 }} onChange={(h) => { inputRef.current.jump = h; }} />

      <View style={styles.hotbar}>
        {PLACEABLE.map((b, i) => (
          <Pressable key={b} testID={`slot-${i}`} onPress={() => select(i)}
            style={[styles.slot, hud?.selected === i && styles.slotSelected]}>
            <View style={[styles.swatch, { backgroundColor: hex(BLOCKS[b].top) }]} />
            <Text style={styles.count}>∞</Text>
          </Pressable>
        ))}
      </View>
      {hud && <Text style={styles.selectedName}>{`${BLOCKS[PLACEABLE[hud.selected]].name} (무제한)`}</Text>}

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
  title: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2f4b5c', gap: 12 },
  logo: { color: 'white', fontSize: 38, fontWeight: '800' },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: { width: 150, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)',
    color: 'white', fontSize: 16, fontWeight: '700' },
  colorDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  colorDotOn: { borderColor: 'white', transform: [{ scale: 1.15 }] },
  columns: { flexDirection: 'row', gap: 28, marginTop: 6 },
  column: { alignItems: 'center', gap: 10 },
  columnTitle: { color: '#d6e9f2', fontSize: 14, fontWeight: '700' },
  cta: { width: 230, paddingVertical: 12, borderRadius: 14, alignItems: 'center' },
  ctaText: { color: 'white', fontSize: 17, fontWeight: '700' },
  joinRow: { flexDirection: 'row', width: 230, gap: 8 },
  codeInput: { flex: 1, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', color: 'white',
    fontSize: 18, fontWeight: '800', letterSpacing: 3 },
  joinBtn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: '#5f8fe0' },
  lookPad: { position: 'absolute', top: 0, bottom: 0, left: '35%', right: 0 },
  crosshairWrap: { position: 'absolute', top: '50%', left: '50%', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 22, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  crossV: { position: 'absolute', width: 3, height: 22, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  info: { position: 'absolute', top: 14, left: 18, color: 'white', fontSize: 15, fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  roomBox: { position: 'absolute', top: 40, left: 14, padding: 8, borderRadius: 10, backgroundColor: 'rgba(30,40,50,0.4)', gap: 3 },
  roomCode: { color: 'white', fontWeight: '800', fontSize: 15, letterSpacing: 1 },
  roomStatus: { color: '#ffd38a', fontSize: 12 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerDot: { width: 10, height: 10, borderRadius: 5 },
  playerName: { color: 'white', fontSize: 13, fontWeight: '600' },
  exit: { position: 'absolute', top: 10, right: 14, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(30,40,50,0.45)' },
  exitText: { color: 'white', fontWeight: '700' },
  hotbar: { position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', gap: 6, padding: 6,
    borderRadius: 14, backgroundColor: 'rgba(30,40,50,0.35)' },
  slot: { width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  slotSelected: { backgroundColor: 'rgba(255,255,255,0.6)' },
  swatch: { width: 26, height: 26, borderRadius: 7 },
  count: { position: 'absolute', right: 3, bottom: 1, color: 'white', fontSize: 11, fontWeight: '800',
    textShadowColor: 'black', textShadowRadius: 2 },
  selectedName: { position: 'absolute', bottom: 66, alignSelf: 'center', color: 'white', fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#2f4b5c', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: 'white', fontSize: 18, textAlign: 'center', paddingHorizontal: 30 },
});
