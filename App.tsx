import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BLOCKS, PLACEABLE } from './src/game/blocks';
import { Game, HudState, Input } from './src/game/game';
import { clearSave, loadSave, writeSave } from './src/game/storage';
import { VoxelRenderer } from './src/render/renderer';
import { HoldButton, Joystick, LookPad } from './src/ui/controls';

const hex = (c: [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

export default function App() {
  const [screen, setScreen] = useState<'title' | 'play'>('title');
  const [hasSave, setHasSave] = useState(false);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    loadSave().then((s) => setHasSave(!!s));
    // Links ending in ?autostart=1 jump straight into the game (handy for testing and sharing).
    const check = (url?: string | null) => { if (url && /[?&]autostart=1/.test(url)) setScreen('play'); };
    Linking.getInitialURL().then(check).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => check(e.url));
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      {screen === 'title' ? (
        <View style={styles.title}>
          <Text style={styles.logo}>Voxel Valley</Text>
          <Text style={styles.subtitle}>블록으로 만드는 우리만의 계곡</Text>
          <Pressable testID="start" style={[styles.cta, { backgroundColor: '#5fbf7f' }]}
            onPress={() => { setFresh(false); setScreen('play'); }}>
            <Text style={styles.ctaText}>{hasSave ? '이어서 하기' : '시작하기'}</Text>
          </Pressable>
          {hasSave && (
            <Pressable testID="new-world" style={[styles.cta, { backgroundColor: '#8b7fd6' }]}
              onPress={async () => { await clearSave(); setFresh(true); setScreen('play'); }}>
              <Text style={styles.ctaText}>새 세계 만들기</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Play fresh={fresh} onExit={() => { setScreen('title'); loadSave().then((s) => setHasSave(!!s)); }} />
      )}
    </GestureHandlerRootView>
  );
}

function Play({ fresh, onExit }: { fresh: boolean; onExit: () => void }) {
  const inputRef = useRef<Input>({ moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, jump: false, dig: false, placeTap: false });
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const save = useCallback(() => {
    const g = gameRef.current;
    if (g) writeSave(g.toSave());
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') save(); });
    const timer = setInterval(() => { if (gameRef.current?.dirty) { gameRef.current.dirty = false; save(); } }, 8000);
    return () => { alive.current = false; sub.remove(); clearInterval(timer); save(); };
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

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    const saved = fresh ? null : await loadSave();
    const game = new Game(saved);
    gameRef.current = game;
    const view = new VoxelRenderer(gl, game.world);
    game.onBlockChanged = (x, z) => view.blockChanged(x, z);

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
        if (ready) setLoading(false);
      }
      requestAnimationFrame(frame);
    };
    frame();
  }, [fresh]);

  const select = (i: number) => { if (gameRef.current) gameRef.current.selected = i; };

  return (
    <View style={styles.root}>
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      <LookPad style={styles.lookPad} onLook={(dx, dy) => { inputRef.current.lookDX += dx; inputRef.current.lookDY += dy; }} />
      <View pointerEvents="none" style={styles.crosshairWrap}>
        <View style={[styles.crossH, hud && hud.dig > 0 ? { width: 22 + 30 * hud.dig } : null]} />
        <View style={styles.crossV} />
      </View>

      <Text style={styles.info}>{hud ? `${hud.timeLabel}${hud.target ? `  ·  ${hud.target}` : ''}` : ''}</Text>
      <Pressable testID="exit" style={styles.exit} onPress={() => { save(); onExit(); }}>
        <Text style={styles.exitText}>나가기</Text>
      </Pressable>

      <Joystick onMove={(x, y) => { inputRef.current.moveX = x; inputRef.current.moveY = y; }} />
      <HoldButton label="캐기" color="#e07a6e" style={{ right: 118, bottom: 96 }} onChange={(h) => { inputRef.current.dig = h; }} />
      <HoldButton label="놓기" color="#5fb37f" style={{ right: 28, bottom: 132 }} onChange={(h) => { if (h) inputRef.current.placeTap = true; }} />
      <HoldButton label="점프" color="#56657a" style={{ right: 28, bottom: 36 }} onChange={(h) => { inputRef.current.jump = h; }} />

      <View style={styles.hotbar}>
        {PLACEABLE.map((b, i) => {
          const count = hud?.inventory[b] ?? 0;
          return (
            <Pressable key={b} testID={`slot-${i}`} onPress={() => select(i)}
              style={[styles.slot, hud?.selected === i && styles.slotSelected]}>
              <View style={[styles.swatch, { backgroundColor: hex(BLOCKS[b].top), opacity: count > 0 ? 1 : 0.3 }]} />
              {count > 0 && <Text style={styles.count}>{count}</Text>}
            </Pressable>
          );
        })}
      </View>
      {hud && <Text style={styles.selectedName}>{`${BLOCKS[PLACEABLE[hud.selected]].name} (${hud.inventory[PLACEABLE[hud.selected]] ?? 0})`}</Text>}

      {loading && (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>계곡을 만드는 중...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#bfe3f5' },
  title: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2f4b5c', gap: 14 },
  logo: { color: 'white', fontSize: 44, fontWeight: '800' },
  subtitle: { color: '#d6e9f2', fontSize: 16, marginBottom: 10 },
  cta: { width: 260, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  ctaText: { color: 'white', fontSize: 18, fontWeight: '700' },
  lookPad: { position: 'absolute', top: 0, bottom: 0, left: '35%', right: 0 },
  crosshairWrap: { position: 'absolute', top: '50%', left: '50%', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 22, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  crossV: { position: 'absolute', width: 3, height: 22, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  info: { position: 'absolute', top: 14, left: 18, color: 'white', fontSize: 15, fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
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
  loadingText: { color: 'white', fontSize: 18 },
});
