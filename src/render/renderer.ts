import * as THREE from 'three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { Platform } from 'react-native';
import type { Season } from '../game/blocks';
import { buildChunkMesh, MeshArrays } from '../game/mesher';
import { CHUNK, chunkKey, toChunk, World } from '../game/world';

/** Where another player is, as the renderer needs it. */
export type Avatar = { id: string; color: number; x: number; y: number; z: number; yaw: number };

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
  private readonly solidMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private readonly waterMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide });
  private readonly meshes = new Map<string, THREE.Group>();
  private readonly highlight: THREE.LineSegments;
  private readonly avatars = new Map<string, THREE.Group>();
  private readonly avatarGeo = {
    body: new THREE.BoxGeometry(0.56, 0.9, 0.4),
    head: new THREE.BoxGeometry(0.62, 0.62, 0.62),
    visor: new THREE.BoxGeometry(0.46, 0.18, 0.04),
  };
  private daylight = 1;
  private skyDay = new THREE.Color(SKY.summer);
  private weather: { points: THREE.Points; pos: Float32Array; phase: Float32Array; spec: NonNullable<(typeof WEATHER)[Season]> } | null = null;
  private clock = 0;
  viewRadius = 3;

  constructor(private readonly gl: ExpoWebGLRenderingContext, private readonly world: World) {
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

    this.camera = new THREE.PerspectiveCamera(72, w / h, 0.05, 140);
    this.camera.rotation.order = 'YXZ';
    this.scene.fog = new THREE.Fog(this.skyDay, 28, 46);

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

  /** 0..1 daylight tints the sky, fog and every block. */
  setDaylight(d: number) {
    const sky = SKY_NIGHT.clone().lerp(this.skyDay, d);
    this.renderer.setClearColor(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    const k = 0.3 + 0.7 * d;
    this.solidMat.color.setRGB(k, k, k);
    this.waterMat.color.setRGB(k, k, k);
    this.daylight = k;
    for (const a of this.avatars.values()) this.tintAvatar(a);
  }

  private tintAvatar(a: THREE.Group) {
    a.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshBasicMaterial;
        m.color.copy(o.userData.base as THREE.Color).multiplyScalar(this.daylight);
      }
    });
  }

  private makeAvatar(color: number) {
    const part = (geo: THREE.BufferGeometry, c: THREE.Color, y: number, z = 0) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      m.userData.base = c;
      m.position.set(0, y, z);
      return m;
    };
    const base = new THREE.Color(color);
    const g = new THREE.Group();
    g.add(part(this.avatarGeo.body, base.clone().multiplyScalar(0.8), 0.45));
    g.add(part(this.avatarGeo.head, base.clone().lerp(new THREE.Color(1, 1, 1), 0.25), 1.22));
    // Forward is -z (matches the camera at yaw 0).
    g.add(part(this.avatarGeo.visor, new THREE.Color(0x24313a), 1.28, -0.32));
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
        a = this.makeAvatar(p.color);
        a.position.set(p.x, p.y, p.z);
        a.rotation.y = p.yaw;
        this.avatars.set(p.id, a);
        this.scene.add(a);
      }
      a.position.lerp(new THREE.Vector3(p.x, p.y, p.z), k);
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
    const { solid, water } = buildChunkMesh(this.world, cx, cz);
    const group = new THREE.Group();
    group.position.set(cx * CHUNK, 0, cz * CHUNK);
    if (solid.indices.length) group.add(new THREE.Mesh(geometryOf(solid), this.solidMat));
    if (water.indices.length) {
      const m = new THREE.Mesh(geometryOf(water), this.waterMat);
      m.renderOrder = 1;
      group.add(m);
    }
    this.scene.add(group);
    this.meshes.set(key, group);
  }

  /** Rebuilds the chunk holding (x,z) and any neighbour it touches. */
  blockChanged(x: number, z: number) {
    const cx = toChunk(x), cz = toChunk(z);
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    const todo = new Set([chunkKey(cx, cz)]);
    if (lx === 0) todo.add(chunkKey(cx - 1, cz));
    if (lx === CHUNK - 1) todo.add(chunkKey(cx + 1, cz));
    if (lz === 0) todo.add(chunkKey(cx, cz - 1));
    if (lz === CHUNK - 1) todo.add(chunkKey(cx, cz + 1));
    for (const k of todo) if (this.meshes.has(k)) {
      const [a, b] = k.split(',').map(Number);
      this.rebuild(a, b);
    }
  }

  render(dt = 0) {
    this.updateWeather(Math.min(dt, 0.1));
    this.renderer.render(this.scene, this.camera);
    this.gl.endFrameEXP();
  }

  private dispose(group: THREE.Group) {
    this.scene.remove(group);
    group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}
