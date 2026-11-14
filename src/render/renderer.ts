import * as THREE from 'three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { Platform } from 'react-native';
import type { Dimension, Season } from '../game/blocks';
import { buildChunkMesh, MeshArrays } from '../game/mesher';
import { time } from '../game/prof';
import { CHUNK, chunkKey, toChunk, World } from '../game/world';
import { BLACK_HOLE, CITY_GROUND } from '../game/dimensions';
import { BlackHole } from './blackhole';
import { Dragon } from './dragon';
import { BreakEffects } from './effects';
import { DrawOverlay, SelectionGlow } from './overlay';
import { PostFX } from './post';
import { DriftField, DriftSpec, Sparks } from './sparks';
import { Sky } from './sky';
import { blockAtlas, glowTexture, waterTexture } from './textures';

const SKY_PALETTE: Record<Season | 'future' | 'store', { zenith: number; horizon: number }> = {
  store: { zenith: 0x0b1030, horizon: 0x2a2a58 },
  spring: { zenith: 0x74b3ea, horizon: 0xf6e3ef },
  summer: { zenith: 0x3f95e0, horizon: 0xcde9f8 },
  autumn: { zenith: 0x6a98c8, horizon: 0xf5d8b6 },
  winter: { zenith: 0x93b0c8, horizon: 0xeaf0f4 },
  future: { zenith: 0x4a5ea6, horizon: 0xd0c6ec },
};

/** Where another player is, as the renderer needs it. */
export type Avatar = {
  id: string; color: number; x: number; y: number; z: number; yaw: number;
  robot?: boolean; species?: string; pet?: boolean; flash?: number;
  /** Seated (riding the carpet): legs forward, no walk cycle. */
  sit?: boolean;
  /** Snap to the position instead of gliding toward it (your own character in third person). */
  exact?: boolean;
  /** A bubble over the head: "!" or "?" (a bot getting itself unstuck). */
  emote?: string;
  /** Which of the valley's people this is (game/people.ts): 'me' for players. */
  look?: Look;
  /** What's in the right hand: a drawing weapon's id, 'blade', or 'block' (in toolColor). */
  tool?: string;
  toolColor?: number;
  /** Seconds since the last swing started (dig, place, cut, cast); the swing lasts SWING_TIME. */
  act?: number;
  /** Pointing the tool at where the finger is drawing. */
  aim?: boolean;
};

import type { Look } from '../game/people';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The drawing weapons' colours, for the model in a third-person hand. */
const WEAPON_LOOK: Record<string, { color: number }> = {
  pick: { color: 0xffd166 }, drill: { color: 0xff9a4c }, laser: { color: 0xff4f8b }, plasma: { color: 0x8c6cff }, quantum: { color: 0x5ff2ff },
};

/** How long one tool swing takes (wind up over the head, strike, recover). */
export const SWING_TIME = 0.45;

/** A 4-point twinkle for the shine on a bald head. */
function glintTexture(): THREE.DataTexture {
  const n = 16, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5);
    const v = Math.max(0, 1 - Math.min(dx * 0.6 + dy * 0.12, dy * 0.6 + dx * 0.12) / 4.5) + Math.max(0, 1 - Math.hypot(dx, dy) / 3);
    const a = Math.min(255, Math.round(v * 255));
    const o = (y * n + x) * 4;
    data[o] = 255; data[o + 1] = 255; data[o + 2] = 240; data[o + 3] = a;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

/** A pixel speech bubble with "!" or "?" in it (bots getting unstuck). */
function emoteTexture(kind: string): THREE.DataTexture {
  const glyph = kind === '!'
    ? ['...XX...', '...XX...', '...XX...', '...XX...', '........', '...XX...']
    : kind === '…'
      ? ['........', '........', '........', '........', '........', 'XX.XX.XX']
      : ['..XXXX..', '.XX..XX.', '....XX..', '...XX...', '........', '...XX...'];
  const n = 16, data = new Uint8Array(n * n * 4);
  const set = (x: number, y: number, r: number, gr: number, bl: number) => {
    const o = ((n - 1 - y) * n + x) * 4;
    data[o] = r; data[o + 1] = gr; data[o + 2] = bl; data[o + 3] = 255;
  };
  for (let y = 1; y < 12; y++) for (let x = 1; x < 15; x++) {
    const edge = y === 1 || y === 11 || x === 1 || x === 14;
    const corner = (y === 1 || y === 11) && (x === 1 || x === 14);
    if (corner) continue;
    if (edge) set(x, y, 40, 34, 52);
    else set(x, y, 255, 255, 255);
  }
  for (const [x, y] of [[6, 12], [7, 12], [6, 13]]) set(x, y, 40, 34, 52); // the bubble's tail
  glyph.forEach((row, gy) => [...row].forEach((ch, gx) => { if (ch === 'X') set(gx + 4, gy + 3, kind === '!' ? 235 : 70, kind === '!' ? 70 : 110, kind === '!' ? 60 : 230); }));
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** A small pixel heart (for pets). */
function heartTexture(): THREE.DataTexture {
  const rows = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
  const n = 8, data = new Uint8Array(n * n * 4);
  rows.forEach((row, ry) => [...row].forEach((ch, x) => {
    if (ch !== 'X') return;
    const y = n - 2 - ry, o = (y * n + x) * 4;
    data[o] = 255; data[o + 1] = 90; data[o + 2] = 130; data[o + 3] = 255;
  }));
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

const SKY_FUTURE = 0x9db3da;
const SKY_SPACE = new THREE.Color(0x03040b);
const CAR_COLORS = [0xff6f91, 0x5ff2ff, 0xffd166, 0xa47bff, 0xf4f7fb, 0x7cf29c];

// Colours in this game are authored as plain sRGB values and shown as-is.
THREE.ColorManagement.enabled = false;

const SKY: Record<Season, number> = { spring: 0xd4e8f6, summer: 0xaedcf4, autumn: 0xf0dcc0, winter: 0xdfe8ef };

/** Falling petals / leaves / snow per season (summer stays clear). */
const WEATHER: Record<Season, DriftSpec | null> = {
  spring: { color: 0xf7b6cf, size: 0.16, fall: 0.9, sway: 0.5, count: 320, box: 24 },
  summer: null,
  autumn: { color: 0xe8894a, size: 0.18, fall: 1.2, sway: 0.6, count: 240, box: 24 },
  winter: { color: 0xffffff, size: 0.12, fall: 1.6, sway: 0.3, count: 600, box: 24 },
};
/** Golden motes that drift around you after dark (and faintly at dusk). */
const FIREFLIES: DriftSpec = { color: 0xffcf6a, size: 0.13, fall: -0.12, sway: 0.5, count: 150, box: 26, glow: true, opacity: 0.9 };
/** Moonlight: what white looks like at the darkest point of the night. */
const MOONLIGHT = new THREE.Color(0.5, 0.58, 0.86);
/** Milliseconds of chunk meshing allowed per frame beyond the first chunk (keeps frames under 16 ms). */
const FRAME_BUDGET_MS = 5; // particles live in a box this wide around the camera

/** The carpet's weave: crimson field, gold and navy borders, a medallion, fringe at both ends. */
function carpetTexture(): THREE.DataTexture {
  const W = 64, H = 112, data = new Uint8Array(W * H * 4);
  const put = (x: number, y: number, c: number, a = 255) => {
    const o = (y * W + x) * 4;
    data[o] = (c >> 16) & 255; data[o + 1] = (c >> 8) & 255; data[o + 2] = c & 255; data[o + 3] = a;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const fringe = y < 6 || y >= H - 6;
      if (fringe) { put(x, y, 0xf0d9a0, x % 3 === 0 ? 255 : 0); continue; }
      const ey = Math.min(y - 6, H - 7 - y), e = Math.min(x, W - 1 - x, ey);
      let c = 0x8e1b2c; // crimson field
      if (e < 2) c = 0x5a0f1c;
      else if (e < 5) c = 0xd9a640; // gold border
      else if (e < 7) c = 0x1d2a5a; // navy band
      else if (e < 8) c = 0xd9a640;
      else {
        // Medallion: a gold diamond with a teal heart, small diamonds scattered on the field.
        const cx = Math.abs(x - W / 2 + 0.5), cy = Math.abs(y - H / 2 + 0.5);
        const d = cx / 18 + cy / 26;
        if (d < 0.45) c = 0x2a8a8a;
        else if (d < 0.6) c = 0xe8b54a;
        else if (d < 0.68) c = 0x1d2a5a;
        else if ((x + y) % 10 === 0 || (x - y + 200) % 10 === 0) c = 0xa8303e;
        if ((Math.abs(x - 14) + Math.abs((y % 24) - 12) < 3 || Math.abs(x - 49) + Math.abs((y % 24) - 12) < 3) && d > 0.7) c = 0xe8b54a;
      }
      put(x, y, c);
    }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function geometryOf(a: MeshArrays) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(a.colors, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(a.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(a.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * expo-gl's native context is OpenGL ES 3 (WebGL 2 API) but its class extends
 * the global WebGLRenderingContext, which three.js (r163+) takes as WebGL 1 and
 * rejects. Hide that global only while the renderer checks it.
 */
function createRenderer(canvas: HTMLCanvasElement, gl: ExpoWebGLRenderingContext) {
  const g = globalThis as { WebGLRenderingContext?: unknown };
  const saved = g.WebGLRenderingContext;
  if (Platform.OS !== 'web') g.WebGLRenderingContext = class NotWebGL1 {};
  try {
    return new THREE.WebGLRenderer({ canvas, context: gl as unknown as WebGL2RenderingContext, antialias: false });
  } finally {
    g.WebGLRenderingContext = saved;
  }
}

/** three.js on top of an expo-gl context, plus chunk streaming. */
export class VoxelRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly atlas = blockAtlas();
  private readonly waterTex = waterTexture();
  private readonly solidMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: this.atlas });
  private readonly waterMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: this.waterTex, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide });
  // Lit blocks (windows, neon, lava, crystals) ignore fog: their light carries across the valley at night.
  private readonly glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: this.atlas, fog: false });
  private readonly portalMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: this.atlas, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  private readonly glassMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: this.atlas, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  private readonly sky: Sky;
  readonly effects: BreakEffects;
  /** Drawing layer (finger trail, loop flash), drawn over the world. */
  readonly overlay = new DrawOverlay();
  readonly selection: SelectionGlow;
  /** Buried treasure shown through the ground while the 보물 투시 effect runs. */
  readonly xray: SelectionGlow;
  private time = 0.25;
  private dim: Dimension = 'valley';
  private extras: THREE.Object3D[] = []; // per-dimension scenery (stars, planets, cars)
  private cars: { mesh: THREE.Group; axis: 'x' | 'z'; lane: number; y: number; speed: number; offset: number }[] = [];
  private readonly meshes = new Map<string, THREE.Group>();
  private readonly highlight: THREE.LineSegments;
  private readonly avatars = new Map<string, THREE.Group>();
  private daylight = 1;
  private skyDay = new THREE.Color(SKY.summer);
  private weather: DriftField | null = null;
  private readonly fireflies = new DriftField(FIREFLIES);
  /** Magic sparks (breaking, the wand, treasure). */
  readonly sparks: Sparks;
  readonly post: PostFX;
  private nightAmt = 0;
  viewRadius = 4;

  constructor(private readonly gl: ExpoWebGLRenderingContext, private world: World) {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    // three.js wants a canvas; expo-gl gives a bare context, so pass a stub.
    const canvas = {
      width: w, height: h, style: {}, clientWidth: w, clientHeight: h,
      addEventListener: () => {}, removeEventListener: () => {}, getContext: () => gl,
    } as unknown as HTMLCanvasElement;
    this.renderer = createRenderer(canvas, gl);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(this.skyDay);

    this.camera = new THREE.PerspectiveCamera(72, w / h, 0.05, 160);
    this.camera.rotation.order = 'YXZ';
    this.scene.fog = new THREE.Fog(this.skyDay, 34, 70);
    this.sky = new Sky(this.scene);
    this.post = new PostFX(w, h);
    this.sparks = new Sparks(this.scene);
    this.scene.add(this.fireflies.points);
    this.effects = new BreakEffects(this.scene, (x, y, z) => this.world.isSolid(x, y, z));

    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01)),
      new THREE.LineBasicMaterial({ color: 0x24313a }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.selection = new SelectionGlow(this.scene, { color: 0xffc94a });
    this.xray = new SelectionGlow(this.scene, { color: 0xff9af0, xray: true });
    this.bufW = w;
    this.bufH = h;
  }

  /** Draw calls and triangles of the last world render (for the perf log). */
  readonly stats = { calls: 0, triangles: 0 };
  private bufW: number;
  private bufH: number;

  /**
   * Keeps the viewport and aspect ratio in step with the GL surface. The surface can change size
   * after the context is created (rotation, split screen, the Android nav bar appearing), and a
   * stale aspect ratio stretches the picture and puts taps and the crosshair off their targets.
   */
  syncSize() {
    const w = this.gl.drawingBufferWidth, h = this.gl.drawingBufferHeight;
    if (w > 0 && h > 0 && (w !== this.bufW || h !== this.bufH)) this.resize(w, h);
  }

  resize(w: number, h: number) {
    this.bufW = w;
    this.bufH = h;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setHighlight(x: number | null, y = 0, z = 0) {
    this.highlight.visible = x !== null;
    if (x !== null) this.highlight.position.set(x + 0.5, y + 0.5, z + 0.5);
  }

  /** Direction from the camera through a point on screen (-1..1 each way, y up). */
  /** Where a world point is on screen, in normalised device coordinates (-1..1, y up), or null if behind. */
  toScreen(x: number, y: number, z: number): { nx: number; ny: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return v.z > 1 ? null : { nx: v.x, ny: v.y };
  }

  rayFromScreen(nx: number, ny: number) {
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3(nx, ny, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    return { x: v.x, y: v.y, z: v.z };
  }

  /** Sky tint and falling particles for the world's season. */
  setSeason(season: Season) {
    this.skyDay = new THREE.Color(SKY[season]);
    this.dropWeather();
    const spec = WEATHER[season];
    if (!spec) return;
    this.weather = new DriftField(spec);
    this.scene.add(this.weather.points);
  }

  private dropWeather() {
    if (!this.weather) return;
    this.scene.remove(this.weather.points);
    this.weather.dispose();
    this.weather = null;
  }

  /** Swaps in another world (after going through a gate): drops every chunk mesh. */
  setWorld(world: World) {
    for (const group of this.meshes.values()) this.dispose(group);
    this.meshes.clear();
    this.dirty.clear();
    this.streamAt.complete = false;
    this.streamAt.cx = NaN;
    this.dragon?.dispose();
    this.dragon = null;
    this.world = world;
  }

  /** Sky, fog, camera range and scenery for a dimension. */
  setDimension(dim: Dimension, season: Season) {
    this.dim = dim;
    if (this.photoFrame) this.photoFrame.group.visible = this.photoFrame.dim === dim;
    for (const o of this.extras) {
      this.scene.remove(o);
      o.traverse((m) => { if (m instanceof THREE.Mesh || m instanceof THREE.Points) m.geometry.dispose(); });
    }
    this.extras = [];
    this.cars = [];
    this.blackHole = null;
    this.comets = [];
    this.searchlights = [];
    this.holos = [];
    this.setSeason(season);
    const fog = this.scene.fog as THREE.Fog;
    this.sky.setVisible(dim !== 'space');
    this.sky.setPalette(SKY_PALETTE[dim === 'future' ? 'future' : dim === 'store' ? 'store' : season], true);
    if (dim === 'valley') {
      fog.near = 34; fog.far = 70; this.camera.far = 160;
    } else if (dim === 'future') {
      this.setSeason('summer');
      this.skyDay = new THREE.Color(SKY_FUTURE);
      this.dropWeather();
      fog.near = 40; fog.far = 70; this.camera.far = 170;
      this.buildCars();
      this.buildCityFX();
    } else if (dim === 'store') {
      // 꿀알바 street: always 3 a.m., no weather, the glow of the store and the streetlights.
      this.dropWeather();
      this.skyDay = new THREE.Color(0x141a3a);
      fog.near = 30; fog.far = 72; this.camera.far = 160;
    } else {
      this.dropWeather();
      this.skyDay = SKY_SPACE.clone();
      fog.near = 300; fog.far = 900; this.camera.far = 1200;
      this.buildSpace();
    }
    this.camera.updateProjectionMatrix();
  }

  private addExtra(o: THREE.Object3D) {
    this.extras.push(o);
    this.scene.add(o);
  }

  /** Stars that follow the camera, two planets, a ringed giant and a distant sun. */
  private buildSpace() {
    const n = 1600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 700;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r], i * 3);
      const tint = Math.random();
      col.set(tint < 0.15 ? [0.75, 0.82, 1] : tint < 0.25 ? [1, 0.9, 0.75] : [1, 1, 1], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false }));
    stars.name = 'stars';
    stars.frustumCulled = false;
    this.addExtra(stars);

    const planet = (r: number, x: number, y: number, z: number, bands: number[], ring?: number) => {
      const geo = new THREE.SphereGeometry(r, 40, 24);
      const p = geo.attributes.position as THREE.BufferAttribute;
      const colors = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const t = (p.getY(i) / r + 1) / 2; // 0 bottom .. 1 top
        const k = Math.min(bands.length - 1, Math.floor(t * bands.length + Math.sin(t * 40) * 0.3));
        const c = new THREE.Color(bands[Math.max(0, k)]);
        colors.set([c.r, c.g, c.b], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
      m.position.set(x, y, z);
      m.rotation.z = 0.35;
      if (ring) {
        const rg = new THREE.Mesh(new THREE.RingGeometry(r * 1.35, r * ring, 64),
          new THREE.MeshBasicMaterial({ color: 0xd9c7a0, side: THREE.DoubleSide, transparent: true, opacity: 0.55, fog: false }));
        rg.rotation.x = Math.PI / 2.3;
        m.add(rg);
      }
      this.addExtra(m);
    };
    planet(120, -380, 140, -520, [0x8a6a4f, 0xc9a77c, 0xe6d3b0, 0xb98a5e, 0xe9dcc4, 0xa3775a], 2.1);
    planet(60, 420, -60, -300, [0x1f4f8f, 0x2f7bd0, 0x3fa36b, 0x2f7bd0, 0x9fd3ff, 0xffffff]);
    planet(30, 120, 80, 460, [0xc96a5a, 0xe08b6a, 0xb85a4a]);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(45, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff2c8, fog: false }));
    sun.position.set(-200, 420, 520);
    this.addExtra(sun);

    this.blackHole = new BlackHole(BLACK_HOLE.x, BLACK_HOLE.y, BLACK_HOLE.z, BLACK_HOLE.horizon);
    this.addExtra(this.blackHole.group);

    // Nebulae: huge soft clouds of colour far away.
    const nebula = (inner: number, outer: number, x: number, y: number, z: number, size: number) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(inner, outer), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.35 }));
      sp.position.set(x, y, z);
      sp.scale.set(size, size * 0.7, 1);
      this.addExtra(sp);
    };
    nebula(0xb07cff, 0x3a1f7a, -520, 160, 260, 520);
    nebula(0x4fe3ff, 0x123a6a, 480, 60, -420, 600);
    nebula(0xff7ab8, 0x5a1a4a, 120, -260, -560, 480);

    // Comets: bright heads with fading tails, crossing the sky now and then.
    for (let i = 0; i < 3; i++) {
      const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(0xffffff, 0x9fdcff), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      head.scale.set(6, 6, 1);
      const n = 40, tail = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 2.2, color: 0xbfe8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      tail.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      tail.frustumCulled = false;
      this.addExtra(head);
      this.addExtra(tail);
      this.comets.push({ head, tail, t: i * 7, period: 18 + i * 5, seed: i });
    }
  }

  private blackHole: BlackHole | null = null;
  private comets: { head: THREE.Sprite; tail: THREE.Points; t: number; period: number; seed: number }[] = [];
  private searchlights: THREE.Mesh[] = [];
  private holos: { mesh: THREE.Mesh; tex: THREE.DataTexture }[] = [];
  private carPassAt = 0;
  /** A flying car just whooshed past close by. */
  onCarPass: () => void = () => {};

  /** Searchlights sweeping the sky and holographic billboards hanging over the streets. */
  private buildCityFX() {
    const G = CITY_GROUND;
    for (const [x, z] of [[-10, -12], [10, -12], [-10, 12], [10, 12]]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(5, 60, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x9ff6ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      cone.geometry.translate(0, -30, 0); // pivot at the tip, beam pointing up from the lamp
      cone.rotation.x = Math.PI;
      cone.position.set(x, G + 1, z);
      this.addExtra(cone);
      this.searchlights.push(cone);
    }
    const colors = [[0x5ff2ff, 0xff6f91], [0xffd166, 0xa47bff], [0x7cf29c, 0x5ff2ff]];
    colors.forEach(([a, b], i) => {
      const n = 64, data = new Uint8Array(n * n * 4);
      const A = new THREE.Color(a), B = new THREE.Color(b);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const frame = x < 2 || y < 2 || x > n - 3 || y > n - 3;
          const bar = Math.floor(y / 8) % 2 === 0;
          const glyph = ((x * 7 + y * 13 + i * 5) % 11) < 4 && x > 6 && x < n - 6 && y > 10 && y < n - 10;
          const c = frame ? A : glyph ? B.clone().lerp(new THREE.Color(1, 1, 1), 0.3) : A.clone().multiplyScalar(bar ? 0.35 : 0.2);
          const o = (y * n + x) * 4;
          data[o] = c.r * 255; data[o + 1] = c.g * 255; data[o + 2] = c.b * 255; data[o + 3] = frame ? 230 : glyph ? 200 : 90;
        }
      const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      const holo = new THREE.Mesh(new THREE.PlaneGeometry(14, 8),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      holo.position.set(-22 + i * 22, G + 18 + i * 3, 24 + (i % 2) * 10);
      holo.rotation.y = Math.PI + (i - 1) * 0.4;
      this.addExtra(holo);
      this.holos.push({ mesh: holo, tex });
    });
  }

  // Warp streaks: lines that stream past when you're moving fast, plus a field-of-view kick.
  private streaks: THREE.LineSegments | null = null;
  private streakPts = new Float32Array(90 * 3);
  private fovKick = 0;

  /** Feed the player's velocity each frame (for speed streaks and FOV kick). */
  setMotion(v: { x: number; y: number; z: number }, dt: number) {
    const speed = Math.hypot(v.x, v.y, v.z);
    const want = Math.min(14, Math.max(0, speed - 5) * 1.4);
    this.fovKick += (want - this.fovKick) * Math.min(1, dt * 4);
    this.camera.fov = 72 + this.fovKick;
    this.camera.updateProjectionMatrix();
    if (!this.streaks) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(90 * 6), 3));
      this.streaks = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      this.streaks.frustumCulled = false;
      this.scene.add(this.streaks);
      for (let i = 0; i < 90; i++) this.streakPts.set([(Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30], i * 3);
    }
    const mat = this.streaks.material as THREE.LineBasicMaterial;
    mat.opacity = Math.min(0.6, Math.max(0, speed - 6) / 10);
    if (mat.opacity <= 0.01) { this.streaks.visible = false; return; }
    this.streaks.visible = true;
    const c = this.camera.position, pos = this.streaks.geometry.attributes.position as THREE.BufferAttribute;
    const n = { x: v.x / speed, y: v.y / speed, z: v.z / speed }, len = 0.6 + speed * 0.25;
    for (let i = 0; i < 90; i++) {
      const j = i * 3;
      for (let k = 0; k < 3; k++) {
        const vk = k === 0 ? v.x : k === 1 ? v.y : v.z;
        let p = this.streakPts[j + k] - vk * dt * 2.5;
        p = ((p + 15) % 30 + 30) % 30 - 15; // wrap in a box around the camera
        this.streakPts[j + k] = p;
      }
      const px = c.x + this.streakPts[j], py = c.y + this.streakPts[j + 1], pz = c.z + this.streakPts[j + 2];
      pos.setXYZ(i * 2, px, py, pz);
      pos.setXYZ(i * 2 + 1, px - n.x * len, py - n.y * len, pz - n.z * len);
    }
    pos.needsUpdate = true;
  }

  private buildCars() {
    for (let i = 0; i < 16; i++) {
      const color = CAR_COLORS[i % CAR_COLORS.length];
      const car = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 2.4), new THREE.MeshBasicMaterial({ color }));
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45, 1.1), new THREE.MeshBasicMaterial({ color: 0x24313a }));
      cabin.position.set(0, 0.45, -0.1);
      const glowL = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.08), new THREE.MeshBasicMaterial({ color: 0xff4d6d }));
      glowL.position.set(0, 0, 1.22);
      const under = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 1.8), new THREE.MeshBasicMaterial({ color: 0x5ff2ff }));
      under.position.set(0, -0.3, 0);
      car.add(body, cabin, glowL, under);
      this.addExtra(car);
      // Sky lanes run above the street grid (roads at x,z ≡ 0..3 mod 20).
      this.cars.push({
        mesh: car, axis: i % 2 ? 'x' : 'z', lane: (Math.floor(i / 2) - 4) * 20 + 2,
        y: 18 + (i % 4) * 5 + Math.random() * 2, speed: (8 + Math.random() * 8) * (i % 3 ? 1 : -1), offset: Math.random() * 200,
      });
    }
  }

  /** Moves the flying cars along their lanes, wrapping around the camera so traffic never ends. */
  private updateScenery(dt: number) {
    const c = this.camera.position;
    const stars = this.extras.find((o) => o.name === 'stars');
    if (stars) stars.position.copy(c);
    this.clockCars += dt;
    for (const car of this.cars) {
      const along = car.offset + this.clockCars * car.speed;
      const center = car.axis === 'z' ? c.z : c.x;
      const span = 160;
      const t = center + ((((along - center + span / 2) % span) + span) % span) - span / 2;
      const laneBase = (car.axis === 'z' ? Math.round(c.x / 20) : Math.round(c.z / 20)) * 20;
      const lane = laneBase + car.lane;
      if (car.axis === 'z') car.mesh.position.set(lane, car.y, t);
      else car.mesh.position.set(t, car.y, lane);
      car.mesh.rotation.y = car.axis === 'z' ? (car.speed > 0 ? Math.PI : 0) : car.speed > 0 ? -Math.PI / 2 : Math.PI / 2;
      car.mesh.position.y += Math.sin(this.clockCars * 2 + car.offset) * 0.15;
    }
    this.portalMat.opacity = 0.55 + 0.2 * Math.sin(this.clockCars * 3);
    // Cars that pass within a few blocks of you: whoosh.
    for (const car of this.cars) {
      if (car.mesh.position.distanceTo(c) < 6 && this.clockCars - this.carPassAt > 1.2) {
        this.carPassAt = this.clockCars;
        this.onCarPass();
      }
    }
    this.blackHole?.update(dt, this.camera);
    for (const cm of this.comets) {
      cm.t += dt;
      const u = (cm.t % cm.period) / cm.period; // 0..1 across the sky
      const a = cm.seed * 2.1;
      const from = new THREE.Vector3(Math.cos(a) * 500, 200 + cm.seed * 60, Math.sin(a) * 500);
      const to = new THREE.Vector3(-Math.cos(a + 0.8) * 500, 40 - cm.seed * 30, -Math.sin(a + 0.8) * 500);
      const head = from.clone().lerp(to, u);
      cm.head.position.copy(head);
      const pos = cm.tail.geometry.attributes.position as THREE.BufferAttribute;
      const back = from.clone().sub(to).normalize();
      for (let i = 0; i < pos.count; i++) {
        const p = head.clone().addScaledVector(back, i * 2.2).add(new THREE.Vector3(Math.sin(i * 1.7) * 0.6, Math.cos(i * 2.3) * 0.6, 0));
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
      (cm.tail.material as THREE.PointsMaterial).opacity = 0.7 * Math.sin(u * Math.PI);
      (cm.head.material as THREE.SpriteMaterial).opacity = Math.sin(u * Math.PI);
    }
    this.searchlights.forEach((s, i) => {
      s.rotation.x = Math.PI + Math.sin(this.clockCars * 0.5 + i * 1.7) * 0.45;
      s.rotation.z = Math.cos(this.clockCars * 0.4 + i * 2.3) * 0.45;
    });
    for (const h of this.holos) {
      h.tex.offset.y = (h.tex.offset.y + dt * 0.15) % 1;
      (h.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * Math.sin(this.clockCars * 7 + h.mesh.position.x);
    }
  }
  private clockCars = 0;
  /** Chunks waiting for a rebuild: 0 = holds a changed block, 1 = only borders one. */
  private dirty = new Map<string, number>();
  /** Where streaming last ran, and whether every chunk in view was built then. */
  private streamAt = { cx: NaN, cz: NaN, r: -1, complete: false };
  private shakeLeft = 0;
  private shakeAmp = 0;
  dragon: Dragon | null = null;

  // First-person weapon: a glowing energy blade held at the lower right, with a swing animation.
  private weaponModel: THREE.Group | null = null;
  private swingT = 1;

  setWeapon(on: boolean) {
    if (!this.weaponModel) {
      const w = new THREE.Group();
      const mat = (c: number) => new THREE.MeshBasicMaterial({ color: c, fog: false });
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.02), mat(0x9ff6ff));
      blade.position.y = 0.42;
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.6, 0.025), mat(0xffffff));
      core.position.y = 0.42;
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.66, 0.04),
        new THREE.MeshBasicMaterial({ color: 0x5ff2ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      glow.position.y = 0.42;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.06), mat(0xf2b544));
      guard.position.y = 0.1;
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.18, 0.045), mat(0x3a3f4a));
      w.add(blade, core, glow, guard, grip);
      w.position.set(0.32, -0.32, -0.55);
      w.rotation.set(-0.35, -0.25, -0.35);
      w.traverse((o) => { o.renderOrder = 10; if (o instanceof THREE.Mesh) (o.material as THREE.Material).depthTest = false; });
      this.camera.add(w);
      if (!this.camera.parent) this.scene.add(this.camera);
      this.weaponModel = w;
    }
    this.weaponOn = on;
    this.weaponModel.visible = on && this.handsShown;
  }

  // First-person magic wand at the lower right: dark wood, a gold band, a glowing tip. It's the
  // "hand" for drawing; the tip flares while you draw and kicks when a spell goes off.
  private wand: THREE.Group | null = null;
  private wandTip: THREE.Sprite | null = null;
  private wandGlow = 0;
  private wandKick = 0;
  private wandClock = 0;
  private readonly tipPos = new THREE.Vector3();

  setWand(on: boolean) {
    if (!this.wand) {
      const g = new THREE.Group();
      const mat = (c: number) => new THREE.MeshBasicMaterial({ color: c, fog: false });
      // The wand runs along the group's +y from the fist; the group is turned to point up-forward-left.
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.014, 0.26, 8), mat(0x6b4630));
      shaft.position.y = 0.16;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.016, 10), mat(0xe8b54a));
      band.position.y = 0.06;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.014), mat(0xfff1c2));
      gem.position.y = 0.295;
      const tip = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(0xfff6d8, 0xffb43a), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      tip.position.y = 0.3;
      tip.scale.set(0.08, 0.08, 1);
      // A blocky fist around the grip and a dark robe sleeve with a gold cuff.
      const fist = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.066, 0.056), mat(0xc98e68));
      fist.position.y = 0.0;
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.036, 0.022), mat(0xb98060));
      thumb.position.set(-0.026, 0.022, -0.022);
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.02, 0.074), mat(0xb98a2e));
      cuff.position.y = -0.045;
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), mat(0x2b2440));
      sleeve.position.y = -0.2;
      g.add(shaft, band, gem, tip, fist, thumb, cuff, sleeve);
      g.position.set(0.33, -0.27, -0.52);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-0.22, 0.8, -0.56).normalize());
      this.wandRest.copy(g.quaternion);
      g.traverse((o) => { o.renderOrder = 10; if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) (o.material as THREE.Material).depthTest = false; });
      this.camera.add(g);
      if (!this.camera.parent) this.scene.add(this.camera);
      this.wand = g;
      this.wandTip = tip;
    }
    this.wandOn = on;
    this.wand.visible = on && this.handsShown;
  }
  private wandOn = false;
  private weaponOn = false;
  private handsShown = true;

  /** First-person hands (wand, blade) are hidden in third person: you see your whole character. */
  setHands(shown: boolean) {
    if (shown === this.handsShown) return;
    this.handsShown = shown;
    if (this.wand) this.wand.visible = this.wandOn && shown;
    if (this.weaponModel) this.weaponModel.visible = this.weaponOn && shown;
  }
  private readonly wandRest = new THREE.Quaternion();
  private readonly wandQ = new THREE.Quaternion();
  private readonly wandE = new THREE.Euler();

  // The magic carpet you sit on while flying: crimson with a gold border and a medallion, fringe at
  // both ends, rippling in the wind (more the faster you go) and shedding gold dust behind.
  private carpet: THREE.Mesh | null = null;
  private carpetBase: Float32Array | null = null;
  private carpetT = 0;
  private dustAt = 0;

  private photoFrame: { group: THREE.Group; pic: THREE.MeshBasicMaterial; dim: Dimension } | null = null;
  /**
   * Hangs the real photo (내 방) on a wall: a picture in a wooden frame centred at (x,y,z), facing
   * along (nx, nz). It's shown only in the dimension it was hung in, and dims with the daylight
   * like the blocks around it. Null takes it down.
   */
  setPhotoFrame(f: { x: number; y: number; z: number; nx: number; nz: number; w: number; h: number; dim: Dimension; rgba: Uint8Array; iw: number; ih: number } | null) {
    if (this.photoFrame) {
      const old = this.photoFrame.group;
      this.scene.remove(old);
      old.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.MeshBasicMaterial;
          m.map?.dispose();
          m.dispose();
        }
      });
      this.photoFrame = null;
    }
    if (!f) return;
    // DataTexture rows run bottom-up; the photo's run top-down.
    const row = f.iw * 4, data = new Uint8Array(f.rgba.length);
    for (let y = 0; y < f.ih; y++) data.set(f.rgba.subarray(y * row, (y + 1) * row), (f.ih - 1 - y) * row);
    const tex = new THREE.DataTexture(data, f.iw, f.ih, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    const group = new THREE.Group();
    const pic = new THREE.MeshBasicMaterial({ map: tex });
    const picture = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.h), pic);
    picture.position.z = 0.045;
    const wood = new THREE.Mesh(new THREE.BoxGeometry(f.w + 0.34, f.h + 0.34, 0.07), new THREE.MeshBasicMaterial({ color: 0x5e3b22 }));
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(f.w + 0.14, f.h + 0.14), new THREE.MeshBasicMaterial({ color: 0xf4efe6 }));
    mat.position.z = 0.04;
    wood.userData.base = 0x5e3b22;
    mat.userData.base = 0xf4efe6;
    group.add(wood, mat, picture);
    group.position.set(f.x + f.nx * 0.04, f.y, f.z + f.nz * 0.04);
    group.rotation.y = Math.atan2(f.nx, f.nz);
    group.visible = f.dim === this.dim;
    this.scene.add(group);
    this.photoFrame = { group, pic, dim: f.dim };
    this.tintPhotoFrame();
  }

  private tintPhotoFrame() {
    const f = this.photoFrame;
    if (!f) return;
    // Each part keeps its own colour (userData.base) under the current light; the picture stays a little brighter.
    f.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshBasicMaterial;
      m.color.copy(this.solidMat.color);
      if (m === f.pic) m.color.lerp(this.tmpColor.setRGB(1, 1, 1), 0.25);
      else m.color.multiply(this.tmpColor.setHex(o.userData.base as number));
    });
  }

  setCarpet(on: boolean) {
    if (!this.carpet && on) {
      const g = new THREE.PlaneGeometry(1.35, 2.4, 10, 18);
      g.rotateX(-Math.PI / 2);
      this.carpetBase = (g.attributes.position.array as Float32Array).slice();
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: carpetTexture(), side: THREE.DoubleSide, alphaTest: 0.5 }));
      m.frustumCulled = false;
      this.scene.add(m);
      this.carpet = m;
    }
    if (this.carpet) this.carpet.visible = on;
  }

  /**
   * Carpet under the rider at (x, y, z) facing `yaw`; `bank` tilts it into turns, `speed` (blocks/s)
   * drives the ripple and the dust trail.
   */
  updateCarpet(dt: number, x: number, y: number, z: number, yaw: number, bank: number, climb: number, speed: number) {
    const c = this.carpet;
    if (!c || !c.visible || !this.carpetBase) return;
    this.carpetT += dt;
    c.position.set(x, y + 0.68, z);
    c.rotation.set(Math.max(-0.25, Math.min(0.25, climb * 0.02)), yaw, -bank * 0.9, 'YXZ');
    // Ripple: a wave running from front to back, stronger toward the edges and with speed.
    const pos = c.geometry.attributes.position as THREE.BufferAttribute, base = this.carpetBase, t = this.carpetT;
    const amp = 0.025 + Math.min(0.09, speed * 0.005);
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3], bz = base[i * 3 + 2];
      const edge = 0.35 + Math.abs(bx) * 0.9 + Math.max(0, bz) * 0.5;
      pos.setY(i, Math.sin(bz * 3.4 + t * (5 + speed * 0.4)) * amp * edge + Math.sin(bx * 5 + t * 3) * 0.01);
    }
    pos.needsUpdate = true;
    // Shift the whole carpet forward of the rider so its front edge shows at the bottom of the view.
    c.translateZ(-0.95);
    // Gold dust from the back corners.
    if (speed > 2.5 && this.carpetT - this.dustAt > 0.03) {
      this.dustAt = this.carpetT;
      const back = new THREE.Vector3();
      for (const side of [-0.62, 0.62]) {
        back.set(side, 0.02, 1.15).applyMatrix4(c.matrixWorld);
        this.sparks.emit(back.x, back.y, back.z, (Math.random() - 0.5) * 0.6, 0.2 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6,
          0.9 + Math.random() * 0.5, 0.12 + Math.random() * 0.08, 1, 0.8, 0.42, 0.8);
      }
    }
  }

  // Shockwave: a gold ring that faces the camera and swells out from where a spell lands.
  private shock: THREE.Mesh | null = null;
  private shockT = 1;
  private shockR = 4;
  private flashAmt = 0;

  /** A ring of light swelling out from (x, y, z) to `radius`, and a warm flash of the whole frame. */
  shockwave(x: number, y: number, z: number, radius: number, flash = 0.18) {
    if (!this.shock) {
      this.shock = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      this.shock.renderOrder = 7;
      this.scene.add(this.shock);
    }
    this.shock.position.set(x, y, z);
    this.shockT = 0;
    this.shockR = radius;
    this.flashAmt = Math.max(this.flashAmt, flash);
  }

  private updateShock(dt: number) {
    const f = this.post.flash;
    this.flashAmt = Math.max(0, this.flashAmt - dt * 0.6);
    f.setRGB(this.flashAmt, this.flashAmt * 0.8, this.flashAmt * 0.45);
    if (!this.shock) return;
    this.shockT = Math.min(1, this.shockT + dt * 2.2);
    this.shock.visible = this.shockT < 1;
    if (!this.shock.visible) return;
    const e = 1 - (1 - this.shockT) ** 3;
    const r = 0.5 + this.shockR * e;
    this.shock.scale.set(r, r, r);
    this.shock.quaternion.copy(this.camera.quaternion);
    (this.shock.material as THREE.MeshBasicMaterial).opacity = (1 - this.shockT) * 0.6;
  }

  /** How bright the wand tip burns (0 idle .. 1 casting); call each frame while drawing. */
  wandCharge(v: number) {
    this.wandGlow = Math.max(this.wandGlow, v);
  }

  /** The wand jerks forward as a spell is released. */
  wandCast() {
    this.wandKick = 1;
    this.wandGlow = 1;
  }

  /** World position of the wand tip (for sparks that leave it). */
  wandTipWorld(): THREE.Vector3 | null {
    if (!this.wandTip || !this.wand?.visible) return null;
    this.camera.updateMatrixWorld();
    return this.wandTip.getWorldPosition(this.tipPos);
  }

  private updateWand(dt: number) {
    const w = this.wand;
    if (!w || !w.visible) return;
    this.wandClock += dt;
    this.wandKick = Math.max(0, this.wandKick - dt * 3.5);
    this.wandGlow = Math.max(0.25, this.wandGlow - dt * 1.8);
    const k = Math.sin(this.wandKick * Math.PI) * this.wandKick;
    const t = this.wandClock;
    w.position.set(0.33 + Math.sin(t * 1.1) * 0.005, -0.27 + Math.sin(t * 2.2) * 0.005 + k * 0.03, -0.52 - k * 0.1);
    // Flick forward when a spell is cast, plus a slow breathing sway.
    this.wandE.set(-k * 0.6, 0, Math.sin(t * 0.9) * 0.02);
    w.quaternion.copy(this.wandRest).premultiply(this.wandQ.setFromEuler(this.wandE));
    if (this.wandTip) {
      const s = 0.07 + this.wandGlow * 0.11 + Math.sin(t * 9) * 0.008;
      this.wandTip.scale.set(s, s, 1);
      (this.wandTip.material as THREE.SpriteMaterial).opacity = 0.55 + 0.45 * this.wandGlow;
    }
  }

  /** Swing the weapon once. */
  swing() {
    this.swingT = 0;
  }

  private updateWeapon(dt: number) {
    const w = this.weaponModel;
    if (!w || !w.visible) return;
    this.swingT = Math.min(1, this.swingT + dt * 4.5);
    const s = Math.sin(this.swingT * Math.PI); // 0 → 1 → 0
    w.rotation.set(-0.35 - s * 1.3, -0.25 + s * 0.5, -0.35 - s * 0.4);
    w.position.set(0.32 - s * 0.12, -0.32 + s * 0.05, -0.55 - s * 0.1);
    // A gentle idle bob.
    w.position.y += Math.sin(Date.now() / 450) * 0.006;
  }

  /** Shakes the camera for `seconds` (an earthquake). */
  shake(amp: number, seconds: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeLeft = Math.max(this.shakeLeft, seconds);
  }

  summonDragon(center: { x: number; y: number; z: number }) {
    this.dragon?.dispose();
    this.dragon = new Dragon(this.scene, new THREE.Vector3(center.x, Math.max(10, center.y - 10), center.z));
  }

  dismissDragon() {
    this.dragon?.leave();
  }

  /** 0..1 daylight tints the sky, fog and every block. `time` places the sun and moon. */
  setDaylight(d: number, time = 0.25) {
    if (this.dim === 'space') d = 1;
    // The store street is stuck at 3 a.m., but bright enough to see the shelves by.
    if (this.dim === 'store') { d = 0.42; time = 0.86; }
    this.time = time;
    this.light = d;
    // Night isn't just darker: white turns moonlit blue, so lit windows and magic stand out warm.
    const n = Math.max(0, Math.min(1, (1 - d) / 0.75));
    const c = this.lightColor.setRGB(1, 1, 1).lerp(MOONLIGHT, n);
    this.solidMat.color.copy(c);
    this.waterMat.color.copy(c);
    this.glassMat.color.copy(c).lerp(this.tmpColor.setRGB(1, 1, 1), 0.35);
    this.tintPhotoFrame();
    const k = 0.3 + 0.7 * d;
    // Re-tint characters only when the light has visibly changed (not every frame).
    if (Math.abs(k - this.daylight) > 0.01) {
      this.daylight = k;
      for (const a of this.avatars.values()) this.tintAvatar(a);
    }
  }
  private light = 1;
  private readonly lightColor = new THREE.Color();
  private readonly tmpColor = new THREE.Color();

  private tintAvatar(a: THREE.Group) {
    a.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.glow) {
        const m = o.material as THREE.MeshBasicMaterial;
        m.color.copy(o.userData.base as THREE.Color).multiplyScalar(this.daylight);
      }
    });
  }

  private heartTex: THREE.DataTexture | null = null;
  private glintTex: THREE.DataTexture | null = null;
  private emoteTex: Record<string, THREE.DataTexture> = {};

  /** Original blocky animals. Four legs swing like limbs. */
  private makeAnimal(species: string, part: (geo: THREE.BufferGeometry, c: THREE.Color, y: number, z?: number, glow?: boolean) => THREE.Mesh) {
    const g = new THREE.Group();
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const C = (h: number) => new THREE.Color(h);
    const at = (m: THREE.Mesh, x: number, y: number, z: number) => { m.position.set(x, y, z); g.add(m); return m; };
    const leg = (w: number, h: number, c: THREE.Color, x: number, y: number, z: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      const m = part(box(w, h, w), c, -h / 2);
      pivot.add(m);
      g.add(pivot);
      return pivot;
    };
    let legs: THREE.Group[] = [];
    if (species === 'rabbit') {
      const fur = C(0xf3ece4), inner = C(0xf6b8c8);
      at(part(box(0.38, 0.34, 0.5), fur, 0), 0, 0.32, 0.05);
      at(part(box(0.3, 0.28, 0.28), fur, 0), 0, 0.52, -0.25);
      for (const sx of [-0.07, 0.07]) {
        at(part(box(0.07, 0.3, 0.05), fur, 0), sx, 0.8, -0.24);
        at(part(box(0.04, 0.22, 0.02), inner, 0), sx, 0.8, -0.27);
        at(part(box(0.05, 0.05, 0.02), C(0x2a2f3a), 0), sx * 1.4, 0.55, -0.4);
      }
      at(part(box(0.06, 0.05, 0.03), inner, 0), 0, 0.48, -0.4);
      at(part(box(0.14, 0.14, 0.1), C(0xffffff), 0), 0, 0.38, 0.33);
      legs = [leg(0.1, 0.16, fur, -0.12, 0.16, -0.12), leg(0.1, 0.16, fur, 0.12, 0.16, -0.12), leg(0.12, 0.16, fur, -0.12, 0.16, 0.18), leg(0.12, 0.16, fur, 0.12, 0.16, 0.18)];
    } else if (species === 'sheep') {
      const wool = C(0xfafaf5), face = C(0x4a4448);
      at(part(box(0.7, 0.55, 0.9), wool, 0), 0, 0.72, 0);
      at(part(box(0.34, 0.34, 0.3), face, 0), 0, 0.85, -0.55);
      at(part(box(0.42, 0.18, 0.3), wool, 0), 0, 1.04, -0.5);
      for (const sx of [-0.08, 0.08]) at(part(box(0.06, 0.06, 0.02), C(0xffffff), 0), sx, 0.9, -0.71);
      legs = [leg(0.14, 0.45, face, -0.2, 0.45, -0.3), leg(0.14, 0.45, face, 0.2, 0.45, -0.3), leg(0.14, 0.45, face, -0.2, 0.45, 0.3), leg(0.14, 0.45, face, 0.2, 0.45, 0.3)];
    } else if (species === 'fox') {
      const fur = C(0xe8803a), white = C(0xfaf3ea), dark = C(0x3a2a24);
      at(part(box(0.36, 0.34, 0.7), fur, 0), 0, 0.5, 0);
      at(part(box(0.3, 0.2, 0.3), white, 0), 0, 0.42, -0.22);
      at(part(box(0.34, 0.3, 0.3), fur, 0), 0, 0.68, -0.45);
      at(part(box(0.16, 0.12, 0.16), white, 0), 0, 0.6, -0.65);
      at(part(box(0.06, 0.05, 0.03), dark, 0), 0, 0.64, -0.74);
      for (const sx of [-0.1, 0.1]) {
        at(part(box(0.1, 0.14, 0.05), fur, 0), sx, 0.9, -0.42);
        at(part(box(0.05, 0.05, 0.02), dark, 0), sx, 0.72, -0.61);
      }
      at(part(box(0.18, 0.18, 0.45), fur, 0), 0, 0.6, 0.55).rotation.x = 0.5;
      at(part(box(0.14, 0.14, 0.14), white, 0), 0, 0.78, 0.78);
      legs = [leg(0.1, 0.33, dark, -0.12, 0.33, -0.25), leg(0.1, 0.33, dark, 0.12, 0.33, -0.25), leg(0.1, 0.33, dark, -0.12, 0.33, 0.25), leg(0.1, 0.33, dark, 0.12, 0.33, 0.25)];
    } else if (species === 'penguin') {
      const black = C(0x2c3340), white = C(0xf7f8fa), orange = C(0xffa53a);
      at(part(box(0.46, 0.7, 0.4), black, 0), 0, 0.5, 0);
      at(part(box(0.34, 0.56, 0.05), white, 0), 0, 0.46, -0.2);
      at(part(box(0.36, 0.3, 0.34), black, 0), 0, 0.98, -0.02);
      at(part(box(0.12, 0.06, 0.12), orange, 0), 0, 0.94, -0.24);
      for (const sx of [-0.08, 0.08]) at(part(box(0.06, 0.06, 0.02), white, 0), sx, 1.04, -0.2);
      legs = [leg(0.12, 0.14, orange, -0.1, 0.14, -0.05), leg(0.12, 0.14, orange, 0.1, 0.14, -0.05),
        leg(0.06, 0.5, black, -0.27, 0.8, 0), leg(0.06, 0.5, black, 0.27, 0.8, 0)];
    } else {
      const yellow = C(0xffd84a), orange = C(0xff9a2a);
      at(part(box(0.32, 0.3, 0.34), yellow, 0), 0, 0.3, 0);
      at(part(box(0.24, 0.22, 0.22), yellow, 0), 0, 0.52, -0.12);
      at(part(box(0.08, 0.05, 0.08), orange, 0), 0, 0.5, -0.27);
      for (const sx of [-0.06, 0.06]) at(part(box(0.04, 0.04, 0.02), C(0x2a2f3a), 0), sx, 0.56, -0.24);
      legs = [leg(0.05, 0.15, orange, -0.07, 0.15, 0), leg(0.05, 0.15, orange, 0.07, 0.15, 0),
        leg(0.04, 0.14, yellow, -0.18, 0.36, 0), leg(0.04, 0.14, yellow, 0.18, 0.36, 0)];
    }
    g.userData.limbs = legs;
    return g;
  }

  private makeAvatar(color: number, robot = false, species?: string, look: Look = 'me') {
    const part = (geo: THREE.BufferGeometry, c: THREE.Color, y: number, z = 0, glow = false) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c }));
      m.userData.base = c;
      m.userData.glow = glow;
      m.position.set(0, y, z);
      return m;
    };
    if (species) {
      const a = this.makeAnimal(species, part);
      this.tintAvatar(a);
      return a;
    }
    const g = this.makeGoof(new THREE.Color(color), robot, part, look);
    this.tintAvatar(g);
    return g;
  }

  /**
   * Everyone (players, friend bots, robot citizens) is a goofy two-heads-tall figure: the head is
   * half the height, with mismatched googly eyes, a unibrow, a bulbous nose, buck teeth with a gap,
   * flappy ears, three hairs and a cap far too small. Stubby legs, huge feet, a belly. Robots get the
   * same build in chrome, with one big visor eye and a bent antenna. All original.
   *
   * Front is -z. userData.limbs = [legL, legR, armL, armR] swing; userData.fig waddles and
   * userData.head bobbles (see setAvatars).
   */
  private makeGoof(base: THREE.Color, robot: boolean, part: (geo: THREE.BufferGeometry, c: THREE.Color, y: number, z?: number, glow?: boolean) => THREE.Mesh, look: Look = 'me') {
    const g = new THREE.Group();
    const fig = new THREE.Group();
    g.add(fig);
    const C = (h: number) => new THREE.Color(h);
    const put = (parent: THREE.Object3D, w: number, h: number, d: number, c: THREE.Color, x: number, y: number, z: number, rz = 0, glow = false) => {
      const m = part(new THREE.BoxGeometry(w, h, d), c, y, z, glow);
      m.position.x = x;
      m.rotation.z = rz;
      parent.add(m);
      return m;
    };
    const pivot = (x: number, y: number) => {
      const p = new THREE.Group();
      p.position.set(x, y, 0);
      fig.add(p);
      return p;
    };
    const skin = robot ? C(0xc9d0da) : C(0xf0c49a);
    const shirt = robot ? C(0xaab3c0) : base.clone();
    const pants = robot ? C(0x7d8794) : base.clone().multiplyScalar(0.5);
    const shoe = robot ? C(0x4a5360) : C(0x5a3a2a);
    const dark = C(0x24202a);
    const white = C(0xfafaf2);

    // Stubby legs with clown-sized feet that stick out in front.
    const legs = [-0.16, 0.16].map((x) => {
      const p = pivot(x, 0.36);
      put(p, 0.17, 0.28, 0.18, pants, 0, -0.14, 0);
      put(p, 0.22, 0.1, 0.36, shoe, 0, -0.31, -0.07);
      return p;
    });
    // A pear of a body: wide hips, a narrower chest and a belly pushing out the front.
    put(fig, 0.56, 0.2, 0.42, pants, 0, 0.44, 0);
    put(fig, 0.5, 0.32, 0.38, shirt, 0, 0.68, 0);
    // A proper 아저씨 belly (smaller on the kid, none on robots).
    if (robot) put(fig, 0.38, 0.26, 0.14, shirt.clone().lerp(C(0xffffff), 0.12), 0, 0.6, -0.22);
    else {
      put(fig, 0.48, 0.34, 0.2, shirt.clone().lerp(C(0xffffff), 0.1), 0, 0.58, -0.26);
      put(fig, 0.36, 0.22, 0.1, shirt.clone().lerp(C(0xffffff), 0.16), 0, 0.56, -0.38);
    }
    if (look === 'barcode' || look === 'glasses') put(fig, 0.08, 0.3, 0.03, look === 'barcode' ? C(0xc0392b) : C(0x2f80ed), 0, 0.68, look === 'barcode' ? -0.27 : -0.3); // tie / lanyard
    if (look === 'glasses') put(fig, 0.12, 0.08, 0.02, white, 0, 0.53, -0.47); // ID card
    if (robot) put(fig, 0.12, 0.12, 0.03, base, 0, 0.66, -0.3, 0, true); // chest light in the robot's colour
    else put(fig, 0.05, 0.05, 0.03, dark, 0, 0.56, -0.3); // belly button
    // Short little arms ending in big mitts.
    const arms = [-0.31, 0.31].map((x) => {
      const p = pivot(x, 0.8);
      put(p, 0.11, 0.26, 0.12, shirt.clone().multiplyScalar(0.9), 0, -0.13, 0);
      put(p, 0.16, 0.15, 0.16, skin, 0, -0.32, 0);
      return p;
    });

    // The head: half the figure (more, for people: a huge bald dome), tipped back a little so it
    // looks down its nose at you.
    const head = new THREE.Group();
    // 거북목: people's heads hang forward of the body (the phone zombie's way forward and down).
    const pitch = robot ? 0.12 : look === 'phone' ? -0.5 : look === 'glasses' ? -0.06 : look === 'me' ? 0.12 : 0.02;
    const jut = robot ? 0 : look === 'phone' ? -0.3 : look === 'kid' ? -0.05 : -0.17;
    head.position.set(0, robot ? 0.84 : look === 'phone' ? 0.74 : 0.8, jut);
    head.rotation.z = 0.05;
    head.rotation.x = pitch;
    fig.add(head);
    g.userData.headPitch = pitch;
    if (!robot && jut < -0.1) {
      const neck = put(fig, 0.26, 0.18, 0.26, skin.clone().multiplyScalar(0.95), 0, 0.84, jut * 0.45);
      neck.rotation.x = 0.7;
    }
    if (look === 'kid') g.scale.setScalar(0.74);
    if (robot) {
      put(head, 0.9, 0.84, 0.78, skin, 0, 0.42, 0);
      const F = -0.39; // the face plane
      // One huge visor eye and one tiny one, a grille mouth, bolts for ears, a bent antenna.
      put(head, 0.34, 0.3, 0.06, C(0x10161e), -0.17, 0.5, F - 0.02);
      put(head, 0.22, 0.2, 0.04, base, -0.17, 0.5, F - 0.05, 0, true);
      put(head, 0.12, 0.12, 0.05, base, 0.22, 0.58, F - 0.02, 0, true);
      for (let i = 0; i < 4; i++) put(head, 0.06, 0.12, 0.04, dark, -0.12 + i * 0.09, 0.2, F - 0.02, i % 2 ? 0.2 : -0.1);
      for (const x of [-0.48, 0.48]) put(head, 0.08, 0.18, 0.18, C(0x6d7684), x, 0.45, 0);
      put(head, 0.04, 0.3, 0.04, C(0x8b95a3), 0.12, 0.98, 0, -0.35);
      put(head, 0.12, 0.12, 0.12, base, 0.2, 1.12, 0, 0, true);
    } else {
      this.makeHead(head, look, base, skin, put);
    }
    // The right hand's grip: whatever tool is equipped is built into it (see setAvatars).
    const grip = new THREE.Group();
    grip.position.set(0, -0.33, -0.02);
    arms[1].add(grip);
    g.userData.grip = grip;
    g.userData.seed = Math.random() * 10;
    g.userData.limbs = [legs[0], legs[1], arms[0], arms[1]];
    g.userData.fig = fig;
    g.userData.head = head;
    return g;
  }

  /**
   * A person's head (see game/people.ts). Everyone shares the big square-jawed head; hair, face
   * and extras make the type. Only 'me' (players) shines: a round bald spot in the crown, pearly,
   * ringed in champagne gold, with a twinkle (animated in poseTool).
   */
  private makeHead(head: THREE.Group, look: Look, base: THREE.Color, skin: THREE.Color,
    put: (parent: THREE.Object3D, w: number, h: number, d: number, c: THREE.Color, x: number, y: number, z: number, rz?: number, glow?: boolean) => THREE.Mesh) {
    const C = (h: number) => new THREE.Color(h);
    const dark = C(0x24202a), white = C(0xfafaf2);
    const hair = look === 'barcode' ? C(0x45403c) : look === 'beard' ? C(0x3a2a20) : C(0x231d1a);
    const F = -0.43; // the face plane
    put(head, 1.0, 0.74, 0.86, skin, 0, 0.5, 0); // cranium
    put(head, 0.88, 0.12, 0.76, skin, 0, 0.92, 0); // the dome's top
    put(head, 1.06, 0.3, 0.84, skin.clone().multiplyScalar(0.97), 0, 0.16, -0.01); // square jaw
    for (const x of [-0.52, 0.52]) put(head, 0.07, 0.2, 0.16, skin.clone().multiplyScalar(0.92), x, 0.5, 0.02); // ears
    const sideHair = (h = 0.36) => {
      for (const x of [-0.505, 0.505]) put(head, 0.04, h, 0.8, hair, x, 0.92 - h / 2 - 0.04, 0.03);
      put(head, 0.96, h + 0.08, 0.04, hair, 0, 0.92 - h / 2, 0.44);
    };
    /**
     * Hair over the top in fine tiles (so a bald spot comes out round), leaving out any tile
     * `bare` says, merged into one mesh: one draw call per head instead of hundreds.
     */
    const topHair = (bare: (x: number, z: number) => boolean, lift = 0) => {
      const parts: THREE.BufferGeometry[] = [];
      const T = 0.055;
      for (let ix = 0; ix < 16; ix++) for (let iz = 0; iz < 14; iz++) {
        const x = -0.4125 + ix * T, z = -0.3575 + iz * T;
        if (bare(x, z)) continue;
        const h = 0.05 + lift * ((((ix >> 1) * 7 + (iz >> 1) * 3) % 5) / 5);
        parts.push(new THREE.BoxGeometry(T + 0.002, h, T + 0.002).translate(x, 0.98 + h / 2, z));
      }
      if (!parts.length) return;
      const merged = mergeGeometries(parts);
      for (const g of parts) g.dispose();
      const m = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: hair }));
      m.userData.base = hair;
      m.userData.glow = false;
      head.add(m);
    };
    const eyes = (o: { w?: number; h?: number; pupil?: number; py?: number; px?: number; lid?: boolean } = {}) => {
      for (const x of [-0.22, 0.22]) {
        put(head, o.w ?? 0.2, o.h ?? 0.13, 0.04, white, x, 0.58, F - 0.02);
        put(head, o.pupil ?? 0.09, o.pupil ?? 0.09, 0.03, dark, x + (o.px ?? 0), 0.58 + (o.py ?? 0), F - 0.045);
        if (o.lid) put(head, 0.24, 0.05, 0.05, skin.clone().multiplyScalar(0.8), x, 0.64, F - 0.03);
      }
    };
    const nose = (c = skin.clone().multiplyScalar(0.93), big = 1) => {
      put(head, 0.11, 0.26, 0.1, skin.clone().multiplyScalar(0.95), 0, 0.46, F - 0.05);
      put(head, 0.18 * big, 0.12 * big, 0.16, c, 0, 0.34, F - 0.09);
    };
    if (look === 'me') {
      // The crown: hair all round a perfectly round bald spot, which alone gleams.
      topHair((x, z) => Math.hypot(x, z - 0.02) < 0.255);
      sideHair();
      put(head, 0.86, 0.07, 0.05, hair, 0, 0.95, F + 0.04); // front hairline
      const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.014, 28), new THREE.MeshBasicMaterial({ color: 0xffeedd }));
      spot.position.set(0, 0.987, 0.02);
      spot.userData.base = C(0xffeedd);
      spot.userData.glow = true;
      head.add(spot);
      const sheen = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
      sheen.rotation.x = -Math.PI / 2;
      sheen.position.set(-0.07, 0.996, -0.04);
      sheen.scale.set(1.4, 0.7, 1);
      sheen.userData.base = C(0xffffff);
      sheen.userData.glow = true;
      head.add(sheen);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.014, 6, 32), new THREE.MeshBasicMaterial({ color: 0xf1d28a }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.992, 0.02);
      ring.userData.base = C(0xf1d28a);
      ring.userData.glow = true;
      head.add(ring);
      head.parent!.parent!.userData.spot = spot;
      this.glintTex ??= glintTexture();
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glintTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glint.position.set(-0.1, 1.06, -0.02);
      glint.scale.set(0.3, 0.3, 1);
      glint.userData.glow = true;
      head.add(glint);
      head.parent!.parent!.userData.glint = glint;
      // The smug face from before: half-lidded side glance, a cocked brow, a smirk.
      eyes({ w: 0.24, h: 0.1, pupil: 0.08, px: 0.06, py: -0.01, lid: true });
      put(head, 0.27, 0.07, 0.05, dark, -0.22, 0.71, F - 0.03, 0.06);
      head.parent!.parent!.userData.brow = put(head, 0.27, 0.07, 0.05, dark, 0.23, 0.79, F - 0.03, -0.28);
      nose();
      for (const x of [-0.05, 0.05]) put(head, 0.04, 0.03, 0.02, C(0x7a3a30), x, 0.27, F - 0.17);
      put(head, 0.26, 0.04, 0.03, C(0xb85a5a), 0.03, 0.2, F - 0.025, 0.2);
      put(head, 0.14, 0.04, 0.03, C(0xe08a8a), 0, 0.165, F - 0.025);
    } else if (look === 'beard') {
      topHair(() => false, 0.12); // a shaggy mop
      sideHair(0.4);
      eyes({ w: 0.17, h: 0.13, pupil: 0.09 });
      for (const x of [-0.22, 0.22]) put(head, 0.3, 0.1, 0.06, hair, x, 0.71, F - 0.03, x < 0 ? 0.1 : -0.1); // bushy brows
      nose(C(0xe0786a), 1.15); // a drinker's nose
      put(head, 1.08, 0.44, 0.24, hair, 0, 0.17, F + 0.1); // the beard
      put(head, 0.6, 0.22, 0.1, hair, 0, 0.0, F - 0.02);
      for (const x of [-0.42, 0.42]) put(head, 0.22, 0.32, 0.5, hair, x, 0.3, -0.05);
      put(head, 0.46, 0.09, 0.08, hair.clone().multiplyScalar(0.8), 0, 0.27, F - 0.06); // moustache
      put(head, 0.16, 0.05, 0.03, C(0x9a3f3a), 0, 0.2, F - 0.08);
    } else if (look === 'glasses') {
      topHair(() => false, 0.05);
      put(head, 0.5, 0.08, 0.7, hair, -0.2, 1.06, 0.02); // the side part sits higher on one side
      sideHair(0.3);
      eyes({ w: 0.16, h: 0.1, pupil: 0.07 });
      for (const x of [-0.22, 0.22]) {
        // Thick black frames, and dark circles from all those late nights.
        put(head, 0.32, 0.04, 0.04, dark, x, 0.69, F - 0.07);
        put(head, 0.32, 0.04, 0.04, dark, x, 0.47, F - 0.07);
        put(head, 0.04, 0.26, 0.04, dark, x - 0.15, 0.58, F - 0.07);
        put(head, 0.04, 0.26, 0.04, dark, x + 0.15, 0.58, F - 0.07);
        put(head, 0.2, 0.04, 0.02, C(0x8a6a8a), x, 0.5, F - 0.02);
        put(head, 0.03, 0.03, 0.5, dark, x < 0 ? -0.51 : 0.51, 0.66, -0.2);
      }
      put(head, 0.1, 0.03, 0.04, dark, 0, 0.62, F - 0.07); // bridge
      nose();
      put(head, 0.24, 0.035, 0.03, C(0x9a5a5a), 0, 0.2, F - 0.025); // a flat, tired mouth
    } else if (look === 'kid') {
      topHair(() => false);
      sideHair(0.42);
      put(head, 0.96, 0.16, 0.06, hair, 0, 0.84, F - 0.01); // bowl-cut fringe
      put(head, 0.7, 0.12, 0.6, base, 0, 1.08, 0.04); // cap, worn backwards
      put(head, 0.5, 0.04, 0.24, base.clone().multiplyScalar(0.8), 0, 1.04, 0.42);
      eyes({ w: 0.2, h: 0.18, pupil: 0.12 });
      for (const x of [-0.22, 0.22]) put(head, 0.04, 0.04, 0.02, white, x + 0.03, 0.62, F - 0.07); // sparkle
      nose(skin.clone().multiplyScalar(0.93), 0.7);
      put(head, 0.42, 0.1, 0.03, C(0x5a2028), 0, 0.2, F - 0.025); // big grin…
      put(head, 0.1, 0.05, 0.03, white, -0.1, 0.235, F - 0.035);
      put(head, 0.1, 0.05, 0.03, white, 0.1, 0.235, F - 0.035); // …with the front tooth missing
      for (const [x, y] of [[-0.32, 0.38], [-0.26, 0.34], [0.3, 0.37], [0.26, 0.33]]) put(head, 0.03, 0.03, 0.02, C(0xb87a5a), x, y, F - 0.02); // freckles
    } else if (look === 'phone') {
      topHair(() => false, 0.04);
      sideHair(0.36);
      put(head, 1.12, 0.8, 0.22, base.clone().multiplyScalar(0.8), 0, 0.55, 0.5); // the hood, down
      eyes({ w: 0.2, h: 0.09, pupil: 0.07, py: -0.02, lid: true }); // staring down at the screen
      for (const x of [-0.55, 0.55]) put(head, 0.06, 0.06, 0.06, white, x, 0.46, -0.04); // earphones
      nose();
      put(head, 0.18, 0.03, 0.03, C(0x9a5a5a), 0, 0.2, F - 0.025);
    } else {
      // 'barcode': a bald top with five strands combed carefully across it.
      for (let i = 0; i < 5; i++) put(head, 0.84, 0.025, 0.035, hair, 0, 0.995, -0.26 + i * 0.12, 0);
      sideHair(0.26);
      eyes({ w: 0.18, h: 0.07, pupil: 0.06 }); // a squinty grin
      for (const x of [-0.22, 0.22]) put(head, 0.24, 0.05, 0.05, hair, x, 0.7, F - 0.03);
      nose();
      put(head, 0.4, 0.07, 0.06, hair, 0, 0.27, F - 0.06); // a neat moustache
      put(head, 0.26, 0.04, 0.03, C(0xa85a5a), 0, 0.19, F - 0.025, -0.08);
    }
  }

  /** Builds the model for what's held in the hand. It points forward (-z) out of the fist. */
  private makeTool(tool: string, color: number) {
    const t = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, c: number, x: number, y: number, z: number, glow = false) => {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c }));
      mesh.userData.base = new THREE.Color(c);
      mesh.userData.glow = glow;
      mesh.position.set(x, y, z);
      t.add(mesh);
      return mesh;
    };
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const wood = 0x8a5a32, steel = 0x9aa3ad;
    const w = WEAPON_LOOK[tool];
    if (tool === 'block') {
      add(box(0.28, 0.28, 0.28), color, 0, 0.08, -0.12);
    } else if (tool === 'phone') {
      // Held up in front of the face, screen glowing.
      add(box(0.16, 0.26, 0.03), 0x1a1d24, 0, 0.12, -0.08);
      add(box(0.13, 0.22, 0.01), 0x9fd2ff, 0, 0.12, -0.1, true);
    } else if (tool === 'blade') {
      add(box(0.06, 0.06, 0.16), 0x2a2f3a, 0, 0, 0.02);
      add(box(0.24, 0.05, 0.05), 0xd9b45a, 0, 0, -0.08);
      add(box(0.05, 0.04, 0.8), 0x7ff6ff, 0, 0, -0.5, true);
    } else if (tool === 'drill') {
      add(box(0.08, 0.16, 0.1), 0x3a3f4a, 0, -0.04, 0.02);
      add(box(0.16, 0.16, 0.32), w.color, 0, 0.05, -0.18);
      const bit = add(new THREE.ConeGeometry(0.08, 0.28, 6), steel, 0, 0.05, -0.48);
      bit.rotation.x = -Math.PI / 2;
    } else if (tool === 'laser') {
      add(box(0.09, 0.16, 0.1), 0x2a2f3a, 0, -0.05, 0.02);
      add(box(0.13, 0.14, 0.38), w.color, 0, 0.06, -0.18);
      add(box(0.05, 0.05, 0.22), 0xffffff, 0, 0.06, -0.46, true);
    } else if (tool === 'plasma') {
      add(box(0.05, 0.05, 0.6), wood, 0, 0, -0.26);
      add(box(0.24, 0.24, 0.38), w.color, 0, 0, -0.62);
      add(box(0.26, 0.05, 0.4), 0xd6c8ff, 0, 0.06, -0.62, true);
    } else if (tool === 'quantum') {
      add(box(0.09, 0.16, 0.1), 0x2a2f3a, 0, -0.05, 0.02);
      add(box(0.18, 0.18, 0.44), 0x3a4a66, 0, 0.06, -0.2);
      for (const z of [-0.3, -0.42]) add(box(0.26, 0.26, 0.04), w.color, 0, 0.06, z, true);
      add(box(0.08, 0.08, 0.06), 0xffffff, 0, 0.06, -0.46, true);
    } else {
      // The wooden pickaxe (also the fallback): a handle and a curved iron head.
      add(box(0.05, 0.05, 0.62), wood, 0, 0, -0.26);
      add(box(0.07, 0.4, 0.08), steel, 0, 0, -0.56);
      add(box(0.06, 0.08, 0.1), steel, 0, 0.22, -0.52);
      add(box(0.06, 0.08, 0.1), steel, 0, -0.22, -0.52);
    }
    return t;
  }

  /**
   * The tool in the hand and what the arm does with it: held ready while walking, pointed at
   * where the finger is drawing, or swung (wind up over the head, strike, recover) for a dig,
   * a cut, a placed block or a cast. Idle, the people raise an eyebrow and nod at you, smugly.
   */
  private poseTool(a: THREE.Group, p: Avatar, limbs: THREE.Group[], dt: number, speed: number) {
    const grip = a.userData.grip as THREE.Group | undefined;
    if (grip) {
      const tool = p.tool ?? (p.look === 'phone' ? 'phone' : undefined);
      const key = tool ? `${tool}:${tool === 'block' ? p.toolColor ?? 0 : ''}` : '';
      if (key !== (a.userData.toolKey ?? '')) {
        a.userData.toolKey = key;
        for (const c of [...grip.children]) {
          grip.remove(c);
          c.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
        }
        if (tool) {
          const t = this.makeTool(tool, p.toolColor ?? 0xffffff);
          grip.add(t);
          t.traverse((o) => {
            if (o instanceof THREE.Mesh && !o.userData.glow) (o.material as THREE.MeshBasicMaterial).color.copy(o.userData.base as THREE.Color).multiplyScalar(this.daylight);
          });
        }
      }
    }
    const arm = limbs[3];
    const fig = a.userData.fig as THREE.Group | undefined;
    const act = p.act ?? 99;
    if (act < SWING_TIME) {
      const u = act / SWING_TIME;
      const ease = (x: number) => x * x * (3 - 2 * x);
      arm.rotation.x = u < 0.35 ? 0.4 + 2.5 * ease(u / 0.35) : u < 0.55 ? 2.9 - 2.6 * ((u - 0.35) / 0.2) : 0.3 + 0.1 * ((u - 0.55) / 0.45);
      if (fig) fig.rotation.x = u < 0.35 ? 0.08 * (u / 0.35) : u < 0.55 ? 0.08 - 0.26 * ((u - 0.35) / 0.2) : -0.18 * (1 - (u - 0.55) / 0.45);
    } else if (p.aim) {
      arm.rotation.x = 1.35 + Math.sin(Date.now() / 90) * 0.04;
      if (fig) fig.rotation.x = -0.05;
    } else if (p.look === 'phone') {
      // Both hands up at the screen, always.
      arm.rotation.x = 1.15;
      limbs[2].rotation.x = 1.05;
    } else {
      if (p.tool) arm.rotation.x = Math.max(arm.rotation.x, 0.45); // holding it ready
      if (fig) fig.rotation.x *= Math.max(0, 1 - dt * 8);
    }
    // The smug idle: a slow nod, and every few seconds the cocked eyebrow wiggles twice.
    const brow = a.userData.brow as THREE.Mesh | undefined;
    const head = a.userData.head as THREE.Group | undefined;
    const t = Date.now() / 1000 + ((a.userData.seed as number) ?? 0);
    if (brow) {
      const cycle = t % 3.2;
      brow.position.y = 0.79 + (cycle < 0.5 ? Math.abs(Math.sin(cycle * Math.PI * 4)) * 0.07 : 0);
    }
    if (head && brow && speed < 0.3 && act >= SWING_TIME) {
      head.rotation.z = 0.05 + Math.sin(t * 1.9) * 0.07;
    }
    // The bald spot breathes light, slow and expensive-looking.
    const spot = a.userData.spot as THREE.Mesh | undefined;
    if (spot) (spot.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.93 + 0.07 * Math.sin(t * 2.4), 0.86 + 0.1 * Math.sin(t * 2.4));
    const glint = a.userData.glint as THREE.Sprite | undefined;
    if (glint) {
      const g = t % 2.4;
      const s = g < 0.35 ? Math.sin((g / 0.35) * Math.PI) : 0;
      glint.scale.set(0.12 + 0.4 * s, 0.12 + 0.4 * s, 1);
      (glint.material as THREE.SpriteMaterial).opacity = 0.35 + 0.65 * s;
    }
  }

  /** Shows other players, gliding toward their latest reported spot. */
  setAvatars(list: Iterable<Avatar>, dt: number) {
    const seen = new Set<string>();
    const k = 1 - Math.exp(-dt * 12);
    for (const p of list) {
      if (p.y < -50) continue; // hasn't reported a position yet
      seen.add(p.id);
      let a = this.avatars.get(p.id);
      if (!a) {
        a = this.makeAvatar(p.color, p.robot, p.species, p.look);
        a.position.set(p.x, p.y, p.z);
        a.rotation.y = p.yaw;
        this.avatars.set(p.id, a);
        this.scene.add(a);
      }
      // Pets wear a little heart; a hit flashes the whole body red.
      if (p.pet && !a.userData.heart) {
        this.heartTex ??= heartTexture();
        const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.heartTex, depthWrite: false, transparent: true }));
        heart.scale.set(0.3, 0.3, 1);
        heart.position.y = p.species === 'sheep' ? 1.4 : p.species ? 1.2 : 2.4;
        heart.userData.glow = true;
        a.add(heart);
        a.userData.heart = heart;
      }
      const flashing = (p.flash ?? 0) > 0;
      if (flashing !== !!a.userData.flashing) {
        a.userData.flashing = flashing;
        a.traverse((o) => {
          if (o instanceof THREE.Mesh) (o.material as THREE.MeshBasicMaterial).color.copy(flashing ? new THREE.Color(1, 0.25, 0.25) : (o.userData.base as THREE.Color).clone().multiplyScalar(o.userData.glow ? 1 : this.daylight));
        });
      }
      if (a.userData.heart) (a.userData.heart as THREE.Sprite).position.y += Math.sin(Date.now() / 300) * 0.002;
      // "!" / "?" bubble: pops in with a little bounce, so you can see what a bot is up to.
      const emote = p.emote ?? '';
      if (emote !== (a.userData.emote ?? '')) {
        a.userData.emote = emote;
        let bubble = a.userData.bubble as THREE.Sprite | undefined;
        if (!bubble) {
          bubble = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true, fog: false }));
          bubble.position.y = p.species ? 1.5 : 2.25;
          bubble.userData.glow = true;
          a.add(bubble);
          a.userData.bubble = bubble;
        }
        if (emote) {
          this.emoteTex[emote] ??= emoteTexture(emote);
          (bubble.material as THREE.SpriteMaterial).map = this.emoteTex[emote];
          bubble.material.needsUpdate = true;
          a.userData.bubbleAge = 0;
        }
        bubble.visible = !!emote;
      }
      const bubble = a.userData.bubble as THREE.Sprite | undefined;
      if (bubble?.visible) {
        const age = (a.userData.bubbleAge = ((a.userData.bubbleAge as number) ?? 0) + dt);
        const pop = age < 0.25 ? 0.4 + 0.75 * Math.sin((age / 0.25) * Math.PI * 0.5) * (1 + 0.3 * Math.sin((age / 0.25) * Math.PI)) : 1;
        bubble.scale.set(0.55 * pop, 0.55 * pop, 1);
      }
      const before = a.position.clone();
      if (p.exact) a.position.set(p.x, p.y, p.z);
      else a.position.lerp(new THREE.Vector3(p.x, p.y, p.z), k);
      // Walk cycle: swing speed follows how fast they're moving across the ground.
      const speed = dt > 0 ? Math.hypot(a.position.x - before.x, a.position.z - before.z) / dt : 0;
      const limbs = a.userData.limbs as THREE.Group[] | undefined;
      if (limbs && p.sit && !p.species) {
        // Sitting cross-legged on the carpet: legs forward, hands resting on the knees.
        limbs[0].rotation.x = limbs[1].rotation.x = 1.45;
        limbs[2].rotation.x = limbs[3].rotation.x = 0.55;
      } else if (limbs) {
        a.userData.phase = ((a.userData.phase as number) ?? 0) + dt * Math.min(12, speed * 2.4);
        const amp = Math.min(0.7, speed * 0.18);
        const sw = Math.sin(a.userData.phase as number) * amp;
        limbs[0].rotation.x = sw;
        limbs[1].rotation.x = -sw;
        limbs[2].rotation.x = -sw * 0.8;
        limbs[3].rotation.x = sw * 0.8;
        // The goofy figures waddle side to side, and their big heads wobble.
        const fig = a.userData.fig as THREE.Group | undefined;
        if (fig) {
          const ph = a.userData.phase as number;
          fig.rotation.z = Math.sin(ph) * amp * 0.28;
          fig.position.y = Math.abs(Math.cos(ph)) * amp * 0.08;
          const head = a.userData.head as THREE.Group;
          head.rotation.z = 0.05 + Math.sin(ph * 2 + 0.6) * amp * 0.2;
          head.rotation.x = ((a.userData.headPitch as number) ?? 0.12) + Math.sin(ph * 2) * amp * 0.1;
        }
      }
      if (limbs && !p.species && !p.sit) this.poseTool(a, p, limbs, dt, speed);
      let d = p.yaw - a.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.rotation.y += p.exact ? d : d * k;
    }
    for (const [id, a] of this.avatars) {
      if (seen.has(id)) continue;
      this.scene.remove(a);
      a.traverse((o) => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose(); });
      this.avatars.delete(id);
    }
  }

  /**
   * Builds up to `budget` missing chunk meshes near (px, pz), nearest first, within the frame's
   * time budget; drops far ones. Once everything in view is built it does nothing until you
   * cross into another chunk, so standing or walking within a chunk costs (and allocates) nothing.
   */
  stream(px: number, pz: number, budget = 2) {
    const ccx = toChunk(Math.floor(px)), ccz = toChunk(Math.floor(pz));
    const r = this.viewRadius, at = this.streamAt;
    const moved = ccx !== at.cx || ccz !== at.cz || r !== at.r;
    if (!moved && at.complete) return;
    if (moved) {
      at.cx = ccx; at.cz = ccz; at.r = r;
      const far = (r + 2) * (r + 2);
      for (const [key, group] of this.meshes) {
        const { cx, cz } = group.userData as { cx: number; cz: number };
        if ((cx - ccx) ** 2 + (cz - ccz) ** 2 > far) {
          this.dispose(group);
          this.meshes.delete(key);
          this.dirty.delete(key);
          this.world.unload(cx, cz);
        }
      }
    }
    const missing: [number, number, number][] = [];
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const d = dx * dx + dz * dz;
        if (d > r * r + 1) continue;
        if (!this.meshes.has(chunkKey(ccx + dx, ccz + dz))) missing.push([d, ccx + dx, ccz + dz]);
      }
    missing.sort((a, b) => a[0] - b[0]);
    const start = performance.now();
    let built = 0;
    while (built < missing.length && built < budget && (built === 0 || performance.now() - start < FRAME_BUDGET_MS)) {
      this.rebuild(missing[built][1], missing[built][2]);
      built++;
    }
    at.complete = built === missing.length;
  }

  isReady(px: number, pz: number) {
    return this.meshes.has(chunkKey(toChunk(Math.floor(px)), toChunk(Math.floor(pz))));
  }

  rebuild(cx: number, cz: number) {
    const key = chunkKey(cx, cz);
    const old = this.meshes.get(key);
    if (old) this.dispose(old);
    const { solid, water, glow, portal, glass } = buildChunkMesh(this.world, cx, cz);
    const group = new THREE.Group();
    group.position.set(cx * CHUNK, 0, cz * CHUNK);
    group.userData = { cx, cz };
    if (solid.indices.length) group.add(new THREE.Mesh(geometryOf(solid), this.solidMat));
    if (glow.indices.length) group.add(new THREE.Mesh(geometryOf(glow), this.glowMat));
    if (glass.indices.length) {
      const m = new THREE.Mesh(geometryOf(glass), this.glassMat);
      m.renderOrder = 1;
      group.add(m);
    }
    if (portal.indices.length) {
      const m = new THREE.Mesh(geometryOf(portal), this.portalMat);
      m.renderOrder = 2;
      group.add(m);
    }
    if (water.indices.length) {
      const m = new THREE.Mesh(geometryOf(water), this.waterMat);
      m.renderOrder = 1;
      group.add(m);
    }
    this.scene.add(group);
    this.meshes.set(key, group);
  }

  /** Marks the chunk holding (x,z), and any neighbour it touches, for a rebuild. */
  blockChanged(x: number, z: number) {
    const cx = toChunk(x), cz = toChunk(z);
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    this.markDirty(chunkKey(cx, cz), 0);
    if (lx === 0) this.markDirty(chunkKey(cx - 1, cz), 1);
    if (lx === CHUNK - 1) this.markDirty(chunkKey(cx + 1, cz), 1);
    if (lz === 0) this.markDirty(chunkKey(cx, cz - 1), 1);
    if (lz === CHUNK - 1) this.markDirty(chunkKey(cx, cz + 1), 1);
  }

  private markDirty(key: string, priority: number) {
    if (!this.meshes.has(key)) return;
    const was = this.dirty.get(key);
    if (was === undefined || priority < was) this.dirty.set(key, priority);
  }

  /**
   * Rebuilds changed chunks before drawing, chunks holding the changed blocks first. At least one
   * per frame, then only while there's time left in the frame budget, so smashing blocks across
   * several chunks spreads the work over a few frames instead of freezing one.
   */
  private flushDirty() {
    if (!this.dirty.size) return;
    const order = [...this.dirty].sort((a, b) => a[1] - b[1]);
    const start = performance.now();
    for (let i = 0; i < order.length; i++) {
      if (i > 0 && performance.now() - start > FRAME_BUDGET_MS) break;
      const key = order[i][0];
      this.dirty.delete(key);
      const group = this.meshes.get(key);
      if (group) this.rebuild(group.userData.cx, group.userData.cz);
    }
  }

  render(dt = 0) {
    dt = Math.min(dt, 0.1);
    time('mesh', () => this.flushDirty());
    if (this.dim !== 'space') {
      const sky = this.sky.update(this.camera, this.time, (this.light - 0.25) / 0.75, dt);
      this.renderer.setClearColor(sky);
      (this.scene.fog as THREE.Fog).color.copy(sky);
      this.nightAmt = this.sky.night;
    } else {
      this.renderer.setClearColor(SKY_SPACE);
      (this.scene.fog as THREE.Fog).color.copy(SKY_SPACE);
      this.nightAmt = 0.6;
    }
    this.waterTex.offset.x = (this.waterTex.offset.x + dt * 0.03) % 1;
    this.waterTex.offset.y = (this.waterTex.offset.y + dt * 0.017) % 1;
    time('fx', () => this.effects.update(dt, (this.daylight - 0.3) / 0.7));
    const cam = this.camera.position;
    this.weather?.update(dt, cam, 0.35 + 0.65 * this.light);
    this.fireflies.update(dt, cam, 1, this.dim === 'valley' ? 0.9 * Math.min(1, this.nightAmt * 1.4) : this.dim === 'future' ? 0.3 : 0);
    this.sparks.update(dt);
    this.updateScenery(dt);
    this.updateWeapon(dt);
    this.updateWand(dt);
    if (this.dragon) {
      this.dragon.update(dt);
      if (this.dragon.gone) this.dragon = null;
    }
    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt;
      const a = this.shakeAmp * Math.min(1, this.shakeLeft);
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.camera.position.z += (Math.random() - 0.5) * a;
      this.camera.rotation.z = (Math.random() - 0.5) * a * 0.05;
      if (this.shakeLeft <= 0) { this.shakeAmp = 0; this.camera.rotation.z = 0; }
    }
    this.selection.update(dt);
    this.xray.update(dt);
    this.overlay.update(dt);
    // Points are sized in pixels of the offscreen frame, which shrinks and grows with the scale.
    const rtH = this.bufH * (this.post.enabled ? this.post.scale : 1);
    this.sparks.setViewHeight(rtH);
    this.fireflies.setViewHeight(rtH);
    this.weather?.setViewHeight(rtH);
    this.sky.setViewHeight(rtH);
    this.post.night = this.nightAmt;
    this.post.bloom = 0.35 + 0.75 * this.nightAmt;
    this.post.threshold = 0.9 - 0.28 * this.nightAmt;
    time('gl', () => this.post.render(this.renderer, this.scene, this.camera));
    this.stats.calls = this.post.calls;
    this.stats.triangles = this.post.triangles;
    this.updateShock(dt);
    if (this.overlay.visible) {
      this.renderer.autoClear = false;
      this.renderer.setRenderTarget(null);
      this.renderer.clearDepth();
      this.renderer.render(this.overlay.scene, this.overlay.camera);
      this.renderer.autoClear = true;
    }
    this.gl.endFrameEXP();
    this.post.adapt(dt);
  }

  private dispose(group: THREE.Group) {
    this.scene.remove(group);
    group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}
