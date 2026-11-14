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
import zapWav from '../../assets/sounds/zap.wav';
import coinWav from '../../assets/sounds/coin.wav';
import coinsWav from '../../assets/sounds/coins.wav';
import cashWav from '../../assets/sounds/cash.wav';
import buyWav from '../../assets/sounds/buy.wav';
import denyWav from '../../assets/sounds/deny.wav';
import drumrollWav from '../../assets/sounds/drumroll.wav';
import popWav from '../../assets/sounds/pop.wav';
import fanfareWav from '../../assets/sounds/fanfare.wav';
import failWav from '../../assets/sounds/fail.wav';
import gemWav from '../../assets/sounds/gem.wav';
import magicWav from '../../assets/sounds/magic.wav';
import futureWav from '../../assets/sounds/future.wav';
import spaceWav from '../../assets/sounds/space.wav';
import storeWav from '../../assets/sounds/store.wav';
import introWav from '../../assets/sounds/intro.wav';
import introShortWav from '../../assets/sounds/intro_short.wav';
import mazeWav from '../../assets/sounds/maze.wav';
import parkingWav from '../../assets/sounds/parking.wav';
import parkingUnderWav from '../../assets/sounds/parking_under.wav';
import castleWav from '../../assets/sounds/castle.wav';
import arriveValleyWav from '../../assets/sounds/arrive_valley.wav';
import arriveFutureWav from '../../assets/sounds/arrive_future.wav';
import arriveSpaceWav from '../../assets/sounds/arrive_space.wav';
import arriveStoreWav from '../../assets/sounds/arrive_store.wav';
import arriveMazeWav from '../../assets/sounds/arrive_maze.wav';
import arriveParkingWav from '../../assets/sounds/arrive_parking.wav';
import creakWav from '../../assets/sounds/creak.wav';
import lobbyWav from '../../assets/sounds/lobby.wav';
import battleWav from '../../assets/sounds/battle.wav';
import lampoffWav from '../../assets/sounds/lampoff.wav';
import eerieStepsWav from '../../assets/sounds/eerie_steps.wav';
import eerieKnockWav from '../../assets/sounds/eerie_knock.wav';
import eerieBreathWav from '../../assets/sounds/eerie_breath.wav';
import eerieWhisperWav from '../../assets/sounds/eerie_whisper.wav';
import eerieDoorWav from '../../assets/sounds/eerie_door.wav';
import eerieStaticWav from '../../assets/sounds/eerie_static.wav';
import type { Dimension } from '../game/blocks';
import type { Track } from '../game/zones';
import { loadSfx, playSfx, sfxAvailable } from './sfx';

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
  zap: zapWav,
  coin: coinWav,
  coins: coinsWav,
  cash: cashWav,
  buy: buyWav,
  deny: denyWav,
  drumroll: drumrollWav,
  pop: popWav,
  fanfare: fanfareWav,
  fail: failWav,
  gem: gemWav,
  magic: magicWav,
  // Arriving somewhere: each place has its own sting (see tools/gen_sounds.py places).
  arrive_valley: arriveValleyWav,
  arrive_future: arriveFutureWav,
  arrive_space: arriveSpaceWav,
  arrive_store: arriveStoreWav,
  arrive_maze: arriveMazeWav,
  arrive_parking: arriveParkingWav,
  /** Something in the dark worlds, somewhere you can't see. */
  creak: creakWav,
  /** A ceiling panel in the 노란 방 dying behind you. */
  lampoff: lampoffWav,
  // The 노란 방's small strange sounds, played quietly from nowhere (see EERIE).
  eerie_steps: eerieStepsWav,
  eerie_knock: eerieKnockWav,
  eerie_breath: eerieBreathWav,
  eerie_whisper: eerieWhisperWav,
  eerie_door: eerieDoorWav,
  eerie_static: eerieStaticWav,
};
/** Background loops per place (a dimension, or a zone inside one; see game/zones.ts). */
const TRACKS: Record<Track, number> = {
  valley: musicWav, castle: castleWav, future: futureWav, space: spaceWav, store: storeWav,
  maze: mazeWav, parking: parkingWav, parkingUnder: parkingUnderWav,
  // The title screen (a little mysterious) and the market where you level up (battle).
  lobby: lobbyWav, battle: battleWav,
};
const TRACK_VOLUME: Record<Track, number> = {
  valley: 0.35, castle: 0.45, future: 0.3, space: 0.5, store: 0.45, maze: 0.8, parking: 0.55, parkingUnder: 0.65,
  lobby: 0.5, battle: 0.42,
};
/** The sting for arriving in each dimension. */
export const ARRIVE: Partial<Record<Dimension, Sfx>> = {
  // Coming home to the valley: just the portal and its own music, as it always was.
  future: 'arrive_future', space: 'arrive_space', store: 'arrive_store', maze: 'arrive_maze', parking: 'arrive_parking',
};
/** Quiet strange sounds for the 노란 방, one picked at random every so often. */
export const EERIE: Sfx[] = ['eerie_steps', 'eerie_knock', 'eerie_breath', 'eerie_whisper', 'eerie_door', 'eerie_static', 'creak'];
/** Seconds for one track to fade into the next. */
const FADE = 1.6;
type FileName = keyof typeof FILES;
export type Sfx = Exclude<FileName, 'step1' | 'step2'> | 'step';

const VOLUME: Record<FileName, number> = {
  dig: 0.5, break: 0.8, place: 0.7, step1: 0.35, step2: 0.35, jump: 0.4, splash: 0.7, join: 0.6, leave: 0.5, tap: 0.4,
  portal: 0.8, thrust: 0.25, roar: 1, fire: 0.8, boom: 0.9, quake: 0.9, whoosh: 0.8, swing: 0.6, hurt: 0.8, tame: 0.7, zap: 0.75,
  coin: 0.55, coins: 0.8, cash: 1, buy: 0.85, deny: 0.6,
  drumroll: 0.8, pop: 0.8, fanfare: 0.9, fail: 0.85, gem: 0.75, magic: 0.75,
  arrive_valley: 0.8, arrive_future: 0.8, arrive_space: 0.85, arrive_store: 0.8, arrive_maze: 1, arrive_parking: 0.9, creak: 0.7, lampoff: 0.55,
  eerie_steps: 0.35, eerie_knock: 0.3, eerie_breath: 0.28, eerie_whisper: 0.26, eerie_door: 0.3, eerie_static: 0.22,
};
const MUTE_KEY = 'voxel-valley-go/muted';

/**
 * Android gives each app a limited number of audio tracks, and every expo-audio player holds one.
 * Creating 3 players for each of ~30 sounds up front (~90) ran out: the last pools created (the
 * money sounds among them) failed with "Error -12 initializing AudioTrack" and stayed silent.
 * So: players are made the first time a sound plays, rapid sounds get 2 and the rest 1, and once
 * more than MAX_PLAYERS exist the least recently played pool is released.
 */
const MAX_PLAYERS = 24;
const RAPID: ReadonlySet<FileName> = new Set<FileName>(['dig', 'break', 'place', 'step1', 'step2', 'tap', 'coin']);
/** Sounds that are likely needed in the first seconds of play; created a few at a time after start-up. */
const WARM: FileName[] = ['tap', 'break', 'coin', 'place', 'dig', 'step1', 'step2', 'jump'];

/**
 * Sound effects + background music. A small fixed pool of players per sound (round-robin), so
 * rapid sounds overlap without creating players on the fly. Never throws: no audio is fine.
 */
class Sound {
  private pools = new Map<FileName, { players: AudioPlayer[]; next: number; used: number }>();
  private clock = 0;
  private music: AudioPlayer | null = null;
  private track: Track = 'lobby'; // the app opens on the title screen
  /** The track fading out, and the timer driving the fade. */
  private fading: AudioPlayer | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private loaded = false;
  /** The audio session is set up and players can be created. */
  private ready = false;
  private stepFlip = false;
  muted = false;
  musicWanted = false;

  private loading: Promise<void> | null = null;

  /** Sets up the audio session (once). Every caller waits for the same set-up. */
  load() {
    if (!this.loading) this.loading = this.init();
    return this.loading;
  }

  private async init() {
    this.loaded = true;
    try {
      // Sound always starts on (an old saved "muted" from the removed settings panel is ignored).
      this.muted = false;
      AsyncStorage.removeItem(MUTE_KEY).catch(() => {});
      // Play even with the ring/silent switch on (a game is silent only via the in-app mute),
      // mixing with whatever else is playing.
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
      await setIsAudioActiveAsync(true);
      // The title screen only needs taps and music. A few common game sounds are created a few at a
      // time afterwards; everything else on first play (see MAX_PLAYERS).
      this.ready = true;
      this.makeMusic();
      if (sfxAvailable) {
        // Effects go through vv-sfx (never blocks the game loop); expo-audio only plays music.
        const names = Object.keys(FILES) as FileName[];
        loadSfx(FILES, [...WARM, ...names.filter((n) => !WARM.includes(n))]).catch(() => {});
        return;
      }
      this.pool('tap');
      const rest = WARM.filter((n) => !this.pools.has(n));
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
    if (pool) {
      pool.used = ++this.clock;
      return pool.players.length ? pool : null;
    }
    const size = RAPID.has(name) ? 2 : 1;
    this.makeRoom(size);
    try {
      const players = Array.from({ length: size }, () => {
        const p = createAudioPlayer(FILES[name]);
        p.volume = VOLUME[name];
        return p;
      });
      pool = { players, next: 0, used: ++this.clock };
      this.pools.set(name, pool);
      return pool;
    } catch (e) {
      console.warn('audio unavailable', name, e);
      this.pools.set(name, { players: [], next: 0, used: 0 }); // don't retry on every play
      return null;
    }
  }

  /** Releases the least recently played pools until `need` more players fit under the cap. */
  private makeRoom(need: number) {
    let live = 0;
    for (const p of this.pools.values()) live += p.players.length;
    while (live + need > MAX_PLAYERS) {
      let oldest: FileName | null = null;
      for (const [n, p] of this.pools) if (p.players.length && (oldest === null || p.used < this.pools.get(oldest)!.used)) oldest = n;
      if (oldest === null) return;
      const victim = this.pools.get(oldest)!;
      for (const pl of victim.players) {
        try { pl.remove(); } catch {}
      }
      live -= victim.players.length;
      this.pools.delete(oldest);
    }
  }

  /**
   * Loads the launch intro sting (one file, so the animation can't drift from it). Resolves once it's
   * ready — or right away when there's no audio — with `start`, which plays it at once (call it from
   * the tap itself on the web, where browsers only allow sound from a touch), and `stop`.
   */
  async prepareIntro(short: boolean): Promise<{ start: () => void; stop: () => void }> {
    const none = { start: () => {}, stop: () => {} };
    await this.load();
    if (this.muted) return none;
    try {
      const p = createAudioPlayer(short ? introShortWav : introWav);
      p.volume = 0.9;
      await new Promise<void>((done) => {
        if (p.isLoaded) return done();
        let settled = false;
        const finish = () => { if (settled) return; settled = true; sub.remove(); done(); };
        const sub = p.addListener('playbackStatusUpdate', (st) => { if (st.isLoaded) finish(); });
        setTimeout(finish, 600); // start the show anyway; a late sound beats a stuck intro
      });
      let gone = false;
      const stop = () => {
        if (gone) return;
        gone = true;
        try { p.pause(); p.remove(); } catch {}
      };
      const start = () => {
        if (gone) return;
        try { p.play(); } catch {}
        setTimeout(stop, 4000);
      };
      return { start, stop };
    } catch (e) {
      console.warn('intro sound unavailable', e);
      return none;
    }
  }

  play(sfx: Sfx) {
    if (this.muted) return;
    if (sfx === 'step') this.stepFlip = !this.stepFlip;
    const name: FileName = sfx === 'step' ? (this.stepFlip ? 'step1' : 'step2') : sfx;
    if (playSfx(name, VOLUME[name])) return;
    // vv-sfx is still decoding this one: skip rather than block the game on expo-audio.
    if (sfxAvailable) return;
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

  /** Starts the current track; with `fade`, the old one fades out while this one fades in. */
  private makeMusic(fade = false) {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    try { this.fading?.remove(); } catch {}
    this.fading = null;
    const old = this.music;
    const target = TRACK_VOLUME[this.track];
    try {
      this.music = createAudioPlayer(TRACKS[this.track]);
    } catch (e) {
      console.warn('music unavailable', e);
      this.music = null;
      try { old?.remove(); } catch {}
      return;
    }
    this.music.loop = true;
    const playing = this.musicWanted && !this.muted;
    if (!fade || !old || !playing) {
      try { old?.remove(); } catch {}
      this.music.volume = target;
      if (playing) this.music.play();
      return;
    }
    // Crossfade: places blend into each other instead of cutting.
    const next = this.music;
    const from = old.volume;
    next.volume = 0;
    next.play();
    this.fading = old;
    const t0 = Date.now();
    this.fadeTimer = setInterval(() => {
      const u = Math.min(1, (Date.now() - t0) / (FADE * 1000));
      try {
        next.volume = target * u;
        old.volume = from * (1 - u);
      } catch {}
      if (u >= 1) {
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        try { old.remove(); } catch {}
        if (this.fading === old) this.fading = null;
      }
    }, 50);
  }

  /** Background music for where you are: a dimension, or a zone inside one (game/zones.ts). */
  setTrack(track: Track) {
    if (track === this.track) return;
    this.track = track;
    if (this.loaded && this.ready) this.makeMusic(true);
  }

  /** The arrival sting for a dimension, a moment after the portal swirl. */
  arrive(dim: Dimension) {
    const sting = ARRIVE[dim];
    if (sting) setTimeout(() => this.play(sting), 350);
  }

  startMusic() {
    this.musicWanted = true;
    if (!this.muted) try { this.music?.play(); } catch {}
    this.watchdog();
  }

  stopMusic() {
    this.musicWanted = false;
    try { this.music?.pause(); this.fading?.pause(); } catch {}
  }

  /**
   * Make sure sound is really running: re-activate the audio session and (re)start the music if it
   * isn't playing. Called on returning to the app and on the first touches.
   */
  resume() {
    setIsAudioActiveAsync(true).catch(() => {});
    if (!this.musicWanted || this.muted) return;
    try {
      if (!this.music?.playing) this.music?.play();
    } catch {}
  }

  /** Keep checking for a little while after start-up that the music actually got going. */
  private watchdog(tries = 6) {
    if (tries <= 0) return;
    setTimeout(() => {
      this.resume();
      if (!this.music?.playing) this.watchdog(tries - 1);
    }, 1500);
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
