import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import digWav from '../../assets/sounds/dig.wav';
import breakWav from '../../assets/sounds/break.wav';
import placeWav from '../../assets/sounds/place.wav';
import step1Wav from '../../assets/sounds/step1.wav';
import step2Wav from '../../assets/sounds/step2.wav';
import jumpWav from '../../assets/sounds/jump.wav';
import splashWav from '../../assets/sounds/splash.wav';
import joinWav from '../../assets/sounds/join.wav';
import leaveWav from '../../assets/sounds/leave.wav';
import tapWav from '../../assets/sounds/tap.wav';
import musicWav from '../../assets/sounds/music.wav';
import portalWav from '../../assets/sounds/portal.wav';
import thrustWav from '../../assets/sounds/thrust.wav';
import roarWav from '../../assets/sounds/roar.wav';
import fireWav from '../../assets/sounds/fire.wav';
import boomWav from '../../assets/sounds/boom.wav';
import quakeWav from '../../assets/sounds/quake.wav';
import whooshWav from '../../assets/sounds/whoosh.wav';
import swingWav from '../../assets/sounds/swing.wav';
import hurtWav from '../../assets/sounds/hurt.wav';
import tameWav from '../../assets/sounds/tame.wav';
import futureWav from '../../assets/sounds/future.wav';
import spaceWav from '../../assets/sounds/space.wav';
import type { Dimension } from '../game/blocks';

// Every sound is synthesised by tools/gen_sounds.py — no samples, no third-party rights.
const FILES = {
  dig: digWav,
  break: breakWav,
  place: placeWav,
  step1: step1Wav,
  step2: step2Wav,
  jump: jumpWav,
  splash: splashWav,
  join: joinWav,
  leave: leaveWav,
  tap: tapWav,
  portal: portalWav,
  thrust: thrustWav,
  roar: roarWav,
  fire: fireWav,
  boom: boomWav,
  quake: quakeWav,
  whoosh: whooshWav,
  swing: swingWav,
  hurt: hurtWav,
  tame: tameWav,
};
const TRACKS: Record<Dimension, number> = { valley: musicWav, future: futureWav, space: spaceWav };
const TRACK_VOLUME: Record<Dimension, number> = { valley: 0.35, future: 0.3, space: 0.5 };
type FileName = keyof typeof FILES;
export type Sfx = Exclude<FileName, 'step1' | 'step2'> | 'step';

const VOLUME: Record<FileName, number> = {
  dig: 0.5, break: 0.8, place: 0.7, step1: 0.35, step2: 0.35, jump: 0.4, splash: 0.7, join: 0.6, leave: 0.5, tap: 0.4,
  portal: 0.8, thrust: 0.25, roar: 1, fire: 0.8, boom: 0.9, quake: 0.9, whoosh: 0.8, swing: 0.6, hurt: 0.8, tame: 0.7,
};
const MUTE_KEY = 'voxel-valley-go/muted';

/**
 * Sound effects + background music. A small fixed pool of players per sound (round-robin), so
 * rapid sounds overlap without creating players on the fly. Never throws: no audio is fine.
 */
class Sound {
  private pools = new Map<FileName, { players: AudioPlayer[]; next: number }>();
  private music: AudioPlayer | null = null;
  private track: Dimension = 'valley';
  private loaded = false;
  /** The audio session is set up and players can be created. */
  private ready = false;
  private stepFlip = false;
  muted = false;
  musicWanted = false;

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.muted = (await AsyncStorage.getItem(MUTE_KEY)) === '1';
      // Play even with the ring/silent switch on (a game is silent only via the in-app mute),
      // mixing with whatever else is playing.
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
      await setIsAudioActiveAsync(true);
      // The title screen only needs taps and music; the rest (60 players in all) are created a few
      // at a time afterwards so they don't hold up startup. play() also creates a pool on demand.
      this.ready = true;
      this.pool('tap');
      this.makeMusic();
      const rest = (Object.keys(FILES) as FileName[]).filter((n) => !this.pools.has(n));
      const next = () => {
        const name = rest.shift();
        if (!name) return;
        this.pool(name);
        setTimeout(next, 16);
      };
      setTimeout(next, 300);
    } catch (e) {
      console.warn('audio unavailable', e);
    }
  }

  /** The round-robin players for one sound, created the first time they're needed. */
  private pool(name: FileName) {
    let pool = this.pools.get(name);
    if (pool) return pool.players.length ? pool : null;
    try {
      const players = [0, 1, 2].map(() => {
        const p = createAudioPlayer(FILES[name]);
        p.volume = VOLUME[name];
        return p;
      });
      pool = { players, next: 0 };
      this.pools.set(name, pool);
      return pool;
    } catch (e) {
      console.warn('audio unavailable', name, e);
      this.pools.set(name, { players: [], next: 0 }); // don't retry on every play
      return null;
    }
  }

  play(sfx: Sfx) {
    if (this.muted) return;
    if (sfx === 'step') this.stepFlip = !this.stepFlip;
    const name: FileName = sfx === 'step' ? (this.stepFlip ? 'step1' : 'step2') : sfx;
    // Before load() has set up the audio session, stay silent (as before) rather than create players.
    const pool = this.ready ? this.pool(name) : null;
    if (!pool) return;
    const p = pool.players[pool.next];
    pool.next = (pool.next + 1) % pool.players.length;
    try {
      p.seekTo(0).catch(() => {});
      p.play();
    } catch {}
  }

  private makeMusic() {
    try {
      this.music?.remove();
    } catch {}
    this.music = createAudioPlayer(TRACKS[this.track]);
    this.music.loop = true;
    this.music.volume = TRACK_VOLUME[this.track];
    if (this.musicWanted && !this.muted) this.music.play();
  }

  /** Background music for the dimension you're in. */
  setTrack(dim: Dimension) {
    if (dim === this.track) return;
    this.track = dim;
    if (this.loaded) this.makeMusic();
  }

  startMusic() {
    this.musicWanted = true;
    if (!this.muted) try { this.music?.play(); } catch {}
  }

  stopMusic() {
    this.musicWanted = false;
    try { this.music?.pause(); } catch {}
  }

  /** Back in the foreground: make sure the session is live and the music is running. */
  resume() {
    setIsAudioActiveAsync(true).catch(() => {});
    if (this.musicWanted && !this.muted) try { this.music?.play(); } catch {}
  }

  setMuted(m: boolean) {
    this.muted = m;
    AsyncStorage.setItem(MUTE_KEY, m ? '1' : '0').catch(() => {});
    try {
      if (m) this.music?.pause();
      else if (this.musicWanted) this.music?.play();
    } catch {}
  }
}

export const sound = new Sound();
