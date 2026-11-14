import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import React, { Component, ComponentProps, ReactNode, Suspense, use, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { sound } from './src/audio/sound';
import { characterLevel } from './src/game/economy';
import { progress } from './src/game/progress';
import { isRoomCode, newRoomCode } from './src/net/room';
import { Hero } from './src/ui/hero';
import { Intro } from './src/ui/intro';
import { InstallButton } from './src/ui/install';
import { css, Mode, Profile } from './src/session';

/*
 * Code splitting: the play screen (three.js, renderer, world generation, expo-gl, sensors, haptics)
 * is loaded with import(). On web it becomes its own chunk; in Expo Go dev it's a separate lazy
 * bundle; in a native release build its modules simply aren't evaluated until first needed.
 * Either way the title screen comes up without paying for the game engine.
 */
type PlayModule = typeof import('./src/screens/PlayScreen');
type PlayProps = ComponentProps<PlayModule['default']>;
let playModule: Promise<PlayModule> | null = null;
let failedPlay: Promise<PlayModule> | null = null;
/**
 * Starts (or reuses) loading the play screen. The promise is cached so `use()` sees the same one
 * on every render — even a failed one, or React would retry forever instead of showing the error.
 */
const loadPlay = () => {
  if (!playModule) {
    const p = import('./src/screens/PlayScreen');
    playModule = p;
    p.catch(() => { failedPlay = p; });
  }
  return playModule;
};
/** After a failed load has been reported, lets the next attempt start over. */
const forgetFailedPlay = () => {
  if (playModule && playModule === failedPlay) playModule = null;
};

const PROFILE_KEY = 'voxel-valley-go/profile-v1';
const AVATAR_COLORS = [0xf28b6c, 0x6cb4f2, 0x8bd17c, 0xc89cf0, 0xf2c94c, 0xf27fb2, 0x5fd0c4, 0xb0a08a];

/** Suspends until the play screen's code is in, then renders it. */
function Play(props: PlayProps) {
  const Screen = use(loadPlay()).default;
  return <Screen {...props} />;
}

/** Shows a way back if the play screen's code can't be loaded (e.g. the dev server dropped). */
class LoadBoundary extends Component<{ onExit: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn('play screen failed', e);
    forgetFailedPlay(); // "다시 시도" or entering again fetches afresh
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>게임을 불러오지 못했어요</Text>
        <View style={styles.loadingButtons}>
          <Pressable testID="retry" style={[styles.loadingBtn, { backgroundColor: '#3f9d63' }]}
            onPress={() => this.setState({ failed: false })}>
            <Text style={styles.ctaText}>다시 시도</Text>
          </Pressable>
          <Pressable testID="back" style={[styles.loadingBtn, { backgroundColor: '#56657a' }]} onPress={this.props.onExit}>
            <Text style={styles.ctaText}>돌아가기</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

/** Same look as the play screen's own loading cover, so the hand-off is seamless. */
const PlayLoading = () => (
  <View style={styles.loading}>
    <Text style={styles.loadingText}>입장하는 중...</Text>
  </View>
);

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [profile, setProfile] = useState<Profile>({ name: '', color: AVATAR_COLORS[0] });
  const [level, setLevel] = useState(() => characterLevel(progress.get()));
  const [muted, setMuted] = useState(false);
  // The boot intro plays over the title screen; the title music starts once it's done.
  const [intro, setIntro] = useState(true);
  const endIntro = () => { setIntro(false); sound.startMusic(); };

  // Once the title screen is up, fetch the game in the background so "start" feels instant.
  useEffect(() => {
    // A failed prefetch is forgotten right away; pressing start will simply try again.
    const t = setTimeout(() => { loadPlay().catch(forgetFailedPlay); }, 800);
    return () => clearTimeout(t);
  }, []);

  // The character's level follows the stats bought in the shop (kept across sessions).
  useEffect(() => {
    progress.load().then((p) => setLevel(characterLevel(p))).catch(() => {});
    return progress.subscribe((p) => setLevel(characterLevel(p)));
  }, []);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    sound.load().then(() => { setMuted(sound.muted); });
    AsyncStorage.getItem(PROFILE_KEY)
      .then((raw) => {
        if (raw) { setProfile(JSON.parse(raw) as Profile); return; }
        // First launch: make up a traveller and keep it, or the name changes on every start.
        const fresh: Profile = { name: `여행자${Math.floor(Math.random() * 900 + 100)}`, color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] };
        setProfile(fresh);
        AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(fresh)).catch(() => {});
      })
      .catch(() => {});
    // Links: ?join=CODE joins a room; ?autostart=1 jumps straight into the world (handy for testing).
    const check = (url?: string | null) => {
      if (!url) return;
      const join = /[?&]join=([A-Z0-9]{5})/.exec(url);
      if (join && isRoomCode(join[1])) setMode({ kind: 'guest', code: join[1] });
      else if (/[?&]autostart=1/.test(url)) setMode({ kind: 'solo', fresh: false });
      else return;
      endIntro(); // a link goes straight in, no intro
    };
    Linking.getInitialURL().then(check).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => check(e.url));
    return () => sub.remove();
  }, []);

  const updateProfile = (p: Profile) => {
    setProfile(p);
    AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p)).catch(() => {});
  };
  const go = (m: Mode) => { sound.resume(); sound.play('tap'); setMode(m); };
  /** Tapping the character tries on the next colour. */
  const nextColor = () => {
    sound.resume(); sound.play('tap');
    const i = AVATAR_COLORS.indexOf(profile.color);
    updateProfile({ ...profile, color: AVATAR_COLORS[(i + 1) % AVATAR_COLORS.length] });
  };

  if (mode) {
    const exit = () => setMode(null);
    return (
      <GestureHandlerRootView style={styles.root}>
        <StatusBar hidden />
        <LoadBoundary onExit={exit}>
          <Suspense fallback={<PlayLoading />}>
            <Play key={mode.kind === 'solo' ? 'solo' : `${mode.kind}-${mode.code}`} mode={mode} profile={profile} onProfile={updateProfile} onExit={exit}
              onHost={mode.kind === 'solo' ? () => setMode({ kind: 'host', code: newRoomCode(), fromSave: true }) : undefined} />
          </Suspense>
        </LoadBoundary>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar hidden />
      <View style={styles.title}>
        <View pointerEvents="none" style={styles.moonGlow} />
        <View pointerEvents="none" style={styles.moon} />
        <InstallButton />
        <Pressable testID="mute" style={styles.muteTitle} onPress={() => { sound.setMuted(!muted); setMuted(!muted); }}>
          <Text style={styles.muteText}>{muted ? '🔇' : '🔊'}</Text>
        </Pressable>

        <View style={styles.stage}>
          <Pressable testID="hero" onPress={nextColor} accessibilityLabel="캐릭터 색 바꾸기">
            <Hero color={css(profile.color)} />
          </Pressable>
          <View style={styles.card}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelLabel}>Lv.</Text>
              <Text testID="level" style={styles.levelValue}>{level}</Text>
            </View>
            <TextInput testID="name" style={styles.nameInput} value={profile.name} maxLength={12} placeholder="이름"
              placeholderTextColor="#5d6680" onChangeText={(name) => updateProfile({ ...profile, name })} />
            <Pressable testID="start" style={styles.cta} onPress={() => go({ kind: 'solo', fresh: false })}>
              <Text style={styles.ctaText}>입장</Text>
            </Pressable>
          </View>
        </View>
      </View>
      {intro && <Intro onDone={endIntro} />}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070a14' },
  title: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#070a14', overflow: 'hidden' },
  moonGlow: { position: 'absolute', top: 14, right: 76, width: 94, height: 94, borderRadius: 47, backgroundColor: 'rgba(150,170,230,0.07)' },
  moon: { position: 'absolute', top: 38, right: 100, width: 46, height: 46, borderRadius: 23, backgroundColor: '#aeb8d4', opacity: 0.7 },
  muteTitle: { position: 'absolute', top: 14, right: 18, padding: 8 },
  muteText: { fontSize: 22 },
  stage: { flexDirection: 'row', alignItems: 'center', gap: 44 },
  card: { alignItems: 'center', gap: 12 },
  levelBadge: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 22, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1.5, borderColor: 'rgba(242,201,76,0.55)', backgroundColor: 'rgba(242,201,76,0.08)' },
  levelLabel: { color: '#f2c94c', fontSize: 18, fontWeight: '800' },
  levelValue: { color: '#f2c94c', fontSize: 40, fontWeight: '900' },
  nameInput: { width: 180, paddingVertical: 4, textAlign: 'center', color: '#e8ecf6', fontSize: 20, fontWeight: '800',
    borderBottomWidth: 1, borderBottomColor: 'rgba(232,236,246,0.18)' },
  cta: { width: 180, marginTop: 6, paddingVertical: 13, borderRadius: 14, alignItems: 'center', backgroundColor: '#3a4a7a' },
  ctaText: { color: 'white', fontSize: 17, fontWeight: '800', letterSpacing: 2 },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#070a14', alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: 'white', fontSize: 18, textAlign: 'center', paddingHorizontal: 30 },
  loadingButtons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  loadingBtn: { width: 160, paddingVertical: 12, borderRadius: 14, alignItems: 'center' },
});
