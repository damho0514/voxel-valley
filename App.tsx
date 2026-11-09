import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import React, { Component, ComponentProps, ReactNode, Suspense, use, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { sound } from './src/audio/sound';
import { Season, SEASON_INFO, SEASONS } from './src/game/blocks';
import { clearSave, savedSeasons } from './src/game/storage';
import { isRoomCode, newRoomCode } from './src/net/room';
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
    <Text style={styles.loadingText}>계곡을 만드는 중...</Text>
  </View>
);

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [season, setSeason] = useState<Season>('spring');
  const [saved, setSaved] = useState<Set<Season>>(new Set());
  const [profile, setProfile] = useState<Profile>({ name: '', color: AVATAR_COLORS[0] });
  const [joinCode, setJoinCode] = useState('');
  const [muted, setMuted] = useState(false);
  const refreshSaves = () => { savedSeasons().then(setSaved); };

  // Once the title screen is up, fetch the game in the background so "start" feels instant.
  useEffect(() => {
    // A failed prefetch is forgotten right away; pressing start will simply try again.
    const t = setTimeout(() => { loadPlay().catch(forgetFailedPlay); }, 800);
    return () => clearTimeout(t);
  }, []);

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
    const exit = () => { setMode(null); refreshSaves(); };
    return (
      <GestureHandlerRootView style={styles.root}>
        <StatusBar hidden />
        <LoadBoundary onExit={exit}>
          <Suspense fallback={<PlayLoading />}>
            <Play mode={mode} profile={profile} onProfile={updateProfile} onExit={exit} />
          </Suspense>
        </LoadBoundary>
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
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#2f4b5c', alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: 'white', fontSize: 18, textAlign: 'center', paddingHorizontal: 30 },
  loadingButtons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  loadingBtn: { width: 160, paddingVertical: 12, borderRadius: 14, alignItems: 'center' },
});
