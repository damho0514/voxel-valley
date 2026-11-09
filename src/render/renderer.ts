import * as THREE from 'three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { Platform } from 'react-native';
import type { Dimension, Season } from '../game/blocks';
import { buildChunkMesh, MeshArrays } from '../game/mesher';
import { CHUNK, chunkKey, toChunk, World } from '../game/world';
import { Dragon } from './dragon';
import { BreakEffects } from './effects';
import { Sky } from './sky';
import { blockAtlas, waterTexture } from './textures';

const SKY_PALETTE: Record<Season | 'future', { zenith: number; horizon: number }> = {
  spring: { zenith: 0x74b3ea, horizon: 0xf6e3ef },
  summer: { zenith: 0x3f95e0, horizon: 0xcde9f8 },
  autumn: { zenith: 0x6a98c8, horizon: 0xf5d8b6 },
  winter: { zenith: 0x93b0c8, horizon: 0xeaf0f4 },
  future: { zenith: 0x4a5ea6, horizon: 0xd0c6ec },
};

/** Where another player is, as the renderer needs it. */
export type Avatar = { id: string; color: number; x: number; y: number; z: number; yaw: number; robot?: boolean };

const SKY_FUTURE = 0x9db3da;
const SKY_SPACE = new THREE.Color(0x03040b);
const CAR_COLORS = [0xff6f91, 0x5ff2ff, 0xffd166, 0xa47bff, 0xf4f7fb, 0x7cf29c];

// Colours in this game are authored as plain sRGB values and shown as-is.
THREE.ColorManagement.enabled = false;

const SKY_NIGHT = new THREE.Color(0x1b2140);
const SKY: Record<Season, number> = { spring: 0xd4e8f6, summer: 0xaedcf4, autumn: 0xf0dcc0, winter: 0xdfe8ef };

/** Falling petals / leaves / snow per season (summer stays clear). */
const WEATHER: Record<Season, { color: number; size: number; fall: number; sway: number; count: number } | null> = {
  spring: { color: 0xf7b6cf, size: 0.16, fall: 0.9, sway: 0.8, count: 260 },
  summer: null,
  autumn: { color: 0xe8894a, size: 0.18, fall: 1.2, sway: 1.0, count: 200 },
  winter: { color: 0xffffff, size: 0.12, fall: 1.6, sway: 0.4, count: 520 },
};
const WEATHER_BOX = 22; // particles live in a box this wide around the camera

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
  private readonly glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: this.atlas });
  private readonly portalMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: this.atlas, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  private readonly glassMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: this.atlas, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  private readonly sky: Sky;
  readonly effects: BreakEffects;
  private time = 0.25;
  private dim: Dimension = 'valley';
  private extras: THREE.Object3D[] = []; // per-dimension scenery (stars, planets, cars)
  private cars: { mesh: THREE.Group; axis: 'x' | 'z'; lane: number; y: number; speed: number; offset: number }[] = [];
  private readonly meshes = new Map<string, THREE.Group>();
  private readonly highlight: THREE.LineSegments;
  private readonly avatars = new Map<string, THREE.Group>();
  private daylight = 1;
  private skyDay = new THREE.Color(SKY.summer);
  private weather: { points: THREE.Points; pos: Float32Array; phase: Float32Array; spec: NonNullable<(typeof WEATHER)[Season]> } | null = null;
  private clock = 0;
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
    this.scene.fog = new THREE.Fog(this.skyDay, 40, 64);
    this.sky = new Sky(this.scene);
    this.effects = new BreakEffects(this.scene, (x, y, z) => this.world.isSolid(x, y, z));

    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01)),
      new THREE.LineBasicMaterial({ color: 0x24313a }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setHighlight(x: number | null, y = 0, z = 0) {
    this.highlight.visible = x !== null;
    if (x !== null) this.highlight.position.set(x + 0.5, y + 0.5, z + 0.5);
  }

  /** Direction from the camera through a point on screen (-1..1 each way, y up). */
  rayFromScreen(nx: number, ny: number) {
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3(nx, ny, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    return { x: v.x, y: v.y, z: v.z };
  }

  /** Sky tint and falling particles for the world's season. */
  setSeason(season: Season) {
    this.skyDay = new THREE.Color(SKY[season]);
    if (this.weather) {
      this.scene.remove(this.weather.points);
      this.weather.points.geometry.dispose();
      this.weather = null;
    }
    const spec = WEATHER[season];
    if (!spec) return;
    const pos = new Float32Array(spec.count * 3), phase = new Float32Array(spec.count);
    for (let i = 0; i < spec.count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * WEATHER_BOX;
      pos[i * 3 + 1] = Math.random() * WEATHER_BOX;
      pos[i * 3 + 2] = (Math.random() - 0.5) * WEATHER_BOX;
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: spec.color, size: spec.size, transparent: true, opacity: 0.9, depthWrite: false }));
    points.frustumCulled = false;
    this.scene.add(points);
    this.weather = { points, pos, phase, spec };
  }

  /** Drifts the weather particles; they wrap around a box that follows the camera. */
  private updateWeather(dt: number) {
    const w = this.weather;
    if (!w) return;
    this.clock += dt;
    const c = this.camera.position, half = WEATHER_BOX / 2;
    const wrap = (v: number, center: number) => center + ((((v - center + half) % WEATHER_BOX) + WEATHER_BOX) % WEATHER_BOX) - half;
    for (let i = 0; i < w.phase.length; i++) {
      const j = i * 3, p = w.phase[i];
      w.pos[j] = wrap(w.pos[j] + Math.sin(this.clock * 0.9 + p) * w.spec.sway * dt, c.x);
      w.pos[j + 1] = wrap(w.pos[j + 1] - w.spec.fall * (0.7 + 0.3 * Math.sin(p)) * dt, c.y + 4);
      w.pos[j + 2] = wrap(w.pos[j + 2] + Math.cos(this.clock * 0.7 + p) * w.spec.sway * 0.6 * dt, c.z);
    }
    (w.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (w.points.material as THREE.PointsMaterial).color.setHex(w.spec.color).multiplyScalar(this.daylight);
  }

  /** Swaps in another world (after going through a gate): drops every chunk mesh. */
  setWorld(world: World) {
    for (const group of this.meshes.values()) this.dispose(group);
    this.meshes.clear();
    this.dirty.clear();
    this.dragon?.dispose();
    this.dragon = null;
    this.world = world;
  }

  /** Sky, fog, camera range and scenery for a dimension. */
  setDimension(dim: Dimension, season: Season) {
    this.dim = dim;
    for (const o of this.extras) {
      this.scene.remove(o);
      o.traverse((m) => { if (m instanceof THREE.Mesh || m instanceof THREE.Points) m.geometry.dispose(); });
    }
    this.extras = [];
    this.cars = [];
    this.setSeason(season);
    const fog = this.scene.fog as THREE.Fog;
    this.sky.setVisible(dim !== 'space');
    this.sky.setPalette(SKY_PALETTE[dim === 'future' ? 'future' : season], true);
    if (dim === 'valley') {
      fog.near = 40; fog.far = 64; this.camera.far = 160;
    } else if (dim === 'future') {
      this.setSeason('summer');
      this.skyDay = new THREE.Color(SKY_FUTURE);
      if (this.weather) { this.scene.remove(this.weather.points); this.weather = null; }
      fog.near = 40; fog.far = 70; this.camera.far = 170;
      this.buildCars();
    } else {
      if (this.weather) { this.scene.remove(this.weather.points); this.weather = null; }
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
  }
  private clockCars = 0;
  private dirty = new Set<string>();
  private shakeLeft = 0;
  private shakeAmp = 0;
  dragon: Dragon | null = null;

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
    this.time = time;
    const sky = this.dim === 'space' ? SKY_SPACE : this.sky.update(this.camera, time, d, 0, SKY_NIGHT);
    this.renderer.setClearColor(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    const k = 0.3 + 0.7 * d;
    this.solidMat.color.setRGB(k, k, k);
    this.waterMat.color.setRGB(k, k, k);
    this.glassMat.color.setRGB(Math.max(0.5, k), Math.max(0.5, k), Math.max(0.5, k));
    this.daylight = k;
    for (const a of this.avatars.values()) this.tintAvatar(a);
  }

  private tintAvatar(a: THREE.Group) {
    a.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.glow) {
        const m = o.material as THREE.MeshBasicMaterial;
        m.color.copy(o.userData.base as THREE.Color).multiplyScalar(this.daylight);
      }
    });
  }

  private makeAvatar(color: number, robot = false) {
    const part = (geo: THREE.BufferGeometry, c: THREE.Color, y: number, z = 0, glow = false) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c }));
      m.userData.base = c;
      m.userData.glow = glow;
      m.position.set(0, y, z);
      return m;
    };
    const base = new THREE.Color(color);
    const g = new THREE.Group();
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    /** A limb hanging from a pivot at (x, y), so it can swing. */
    const limb = (w: number, h: number, d: number, c: THREE.Color, x: number, y: number, glow = false) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const m = part(box(w, h, d), c, -h / 2, 0, glow);
      pivot.add(m);
      g.add(pivot);
      return pivot;
    };
    if (robot) {
      // A humanoid robot: silver body, glowing visor, a chest light, an antenna, swinging limbs.
      const silver = new THREE.Color(0xc9d0da);
      const legL = limb(0.22, 0.75, 0.24, silver.clone().multiplyScalar(0.8), -0.15, 0.75);
      const legR = limb(0.22, 0.75, 0.24, silver.clone().multiplyScalar(0.8), 0.15, 0.75);
      g.add(part(box(0.62, 0.7, 0.36), silver, 1.07));
      g.add(part(box(0.2, 0.2, 0.04), base, 1.12, -0.19, true));
      const armL = limb(0.16, 0.62, 0.18, silver.clone().multiplyScalar(0.9), -0.4, 1.38);
      const armR = limb(0.16, 0.62, 0.18, silver.clone().multiplyScalar(0.9), 0.4, 1.38);
      g.add(part(box(0.5, 0.48, 0.48), silver.clone().lerp(new THREE.Color(1, 1, 1), 0.3), 1.68));
      g.add(part(box(0.42, 0.12, 0.04), new THREE.Color(0x5ff2ff), 1.72, -0.25, true));
      g.add(part(box(0.04, 0.22, 0.04), silver, 2.02));
      g.add(part(box(0.1, 0.1, 0.1), base, 2.15, 0, true));
      g.userData.limbs = [legL, legR, armL, armR];
      this.tintAvatar(g);
      return g;
    }
    // A friendly blocky explorer: shirt in the player's colour, darker trousers, round-ish head
    // with eyes, a little backpack. Arms and legs swing as they walk.
    const shirt = base.clone();
    const trousers = base.clone().multiplyScalar(0.55);
    const skin = new THREE.Color(0xf4d7bd);
    const legL = limb(0.24, 0.72, 0.26, trousers, -0.13, 0.72);
    const legR = limb(0.24, 0.72, 0.26, trousers, 0.13, 0.72);
    g.add(part(box(0.56, 0.66, 0.32), shirt, 1.05));
    g.add(part(box(0.4, 0.44, 0.16), base.clone().multiplyScalar(0.7), 1.08, 0.24)); // backpack
    const armL = limb(0.18, 0.62, 0.2, shirt.clone().multiplyScalar(0.9), -0.38, 1.36);
    const armR = limb(0.18, 0.62, 0.2, shirt.clone().multiplyScalar(0.9), 0.38, 1.36);
    g.add(part(box(0.5, 0.5, 0.5), skin, 1.64));
    g.add(part(box(0.54, 0.16, 0.54), base.clone().lerp(new THREE.Color(1, 1, 1), 0.2), 1.92)); // cap
    g.add(part(box(0.3, 0.06, 0.2), base.clone().lerp(new THREE.Color(1, 1, 1), 0.2), 1.86, -0.32)); // brim
    for (const sx of [-0.12, 0.12]) g.add(part(box(0.08, 0.1, 0.02), new THREE.Color(0x2a2f3a), 1.66, -0.26).translateX(sx));
    g.add(part(box(0.14, 0.04, 0.02), new THREE.Color(0xd98a7a), 1.53, -0.26)); // smile
    g.userData.limbs = [legL, legR, armL, armR];
    this.tintAvatar(g);
    return g;
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
        a = this.makeAvatar(p.color, p.robot);
        a.position.set(p.x, p.y, p.z);
        a.rotation.y = p.yaw;
        this.avatars.set(p.id, a);
        this.scene.add(a);
      }
      const before = a.position.clone();
      a.position.lerp(new THREE.Vector3(p.x, p.y, p.z), k);
      // Walk cycle: swing speed follows how fast they're moving across the ground.
      const speed = dt > 0 ? Math.hypot(a.position.x - before.x, a.position.z - before.z) / dt : 0;
      const limbs = a.userData.limbs as THREE.Group[] | undefined;
      if (limbs) {
        a.userData.phase = ((a.userData.phase as number) ?? 0) + dt * Math.min(12, speed * 2.4);
        const amp = Math.min(0.7, speed * 0.18);
        const sw = Math.sin(a.userData.phase as number) * amp;
        limbs[0].rotation.x = sw;
        limbs[1].rotation.x = -sw;
        limbs[2].rotation.x = -sw * 0.8;
        limbs[3].rotation.x = sw * 0.8;
      }
      let d = p.yaw - a.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.rotation.y += d * k;
    }
    for (const [id, a] of this.avatars) {
      if (seen.has(id)) continue;
      this.scene.remove(a);
      a.traverse((o) => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose(); });
      this.avatars.delete(id);
    }
  }

  /** Builds up to `budget` missing chunk meshes near (px, pz), nearest first; drops far ones. */
  stream(px: number, pz: number, budget = 2) {
    const ccx = toChunk(Math.floor(px)), ccz = toChunk(Math.floor(pz));
    const r = this.viewRadius;
    const missing: [number, number, number][] = [];
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const d = dx * dx + dz * dz;
        if (d > r * r + 1) continue;
        if (!this.meshes.has(chunkKey(ccx + dx, ccz + dz))) missing.push([d, ccx + dx, ccz + dz]);
      }
    missing.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < missing.length && i < budget; i++) this.rebuild(missing[i][1], missing[i][2]);

    const far = (r + 2) * (r + 2);
    for (const [key, group] of this.meshes) {
      const [cx, cz] = key.split(',').map(Number);
      if ((cx - ccx) ** 2 + (cz - ccz) ** 2 > far) {
        this.dispose(group);
        this.meshes.delete(key);
        this.world.unload(cx, cz);
      }
    }
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

  /** Marks the chunk holding (x,z), and any neighbour it touches, for a rebuild before the next frame. */
  blockChanged(x: number, z: number) {
    const cx = toChunk(x), cz = toChunk(z);
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    const todo = new Set([chunkKey(cx, cz)]);
    if (lx === 0) todo.add(chunkKey(cx - 1, cz));
    if (lx === CHUNK - 1) todo.add(chunkKey(cx + 1, cz));
    if (lz === 0) todo.add(chunkKey(cx, cz - 1));
    if (lz === CHUNK - 1) todo.add(chunkKey(cx, cz + 1));
    for (const k of todo) if (this.meshes.has(k)) this.dirty.add(k);
  }

  private flushDirty() {
    for (const k of this.dirty) {
      const [a, b] = k.split(',').map(Number);
      if (this.meshes.has(k)) this.rebuild(a, b);
    }
    this.dirty.clear();
  }

  render(dt = 0) {
    dt = Math.min(dt, 0.1);
    this.flushDirty();
    if (this.dim !== 'space') this.sky.update(this.camera, this.time, (this.daylight - 0.3) / 0.7, dt, SKY_NIGHT);
    this.waterTex.offset.x = (this.waterTex.offset.x + dt * 0.03) % 1;
    this.waterTex.offset.y = (this.waterTex.offset.y + dt * 0.017) % 1;
    this.effects.update(dt, (this.daylight - 0.3) / 0.7);
    this.updateWeather(dt);
    this.updateScenery(dt);
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
    this.renderer.render(this.scene, this.camera);
    this.gl.endFrameEXP();
  }

  private dispose(group: THREE.Group) {
    this.scene.remove(group);
    group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}
