import * as THREE from 'three';

/*
 * GPU particles. Each spark is written once when it's born (position, velocity, birth time, life,
 * size, colour); the vertex shader works out where it is now, so a frame costs one uniform update
 * no matter how many are flying. Additive and soft, so they glow (and bloom) like magic.
 */

const SPARK_VS = /* glsl */ `
attribute vec3 aVel;
attribute vec4 aLife; // born, life, size, drag
attribute vec3 aColor;
uniform float uTime;
uniform float uGravity;
uniform float uScale;
varying vec3 vColor;
varying float vFade;
void main() {
  float t = uTime - aLife.x;
  if (t < 0.0 || t > aLife.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float drag = aLife.w;
  // Velocity decays with drag (integrated), gravity pulls down.
  float k = drag > 0.0 ? (1.0 - exp(-drag * t)) / drag : t;
  vec3 p = position + aVel * k + vec3(0.0, 0.5 * uGravity * t * t, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float u = t / aLife.y;
  vFade = (1.0 - u) * (1.0 - u) * smoothstep(0.0, 0.06, u);
  // A quick twinkle so a cloud of sparks shimmers.
  vFade *= 0.75 + 0.25 * sin(t * 40.0 + aLife.x * 113.0);
  vColor = aColor;
  gl_PointSize = aLife.z * uScale / max(0.2, -mv.z) * (1.0 - 0.5 * u);
}`;

const SPARK_FS = /* glsl */ `
varying vec3 vColor;
varying float vFade;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float core = exp(-r * r * 9.0);
  float halo = (1.0 - r) * 0.5;
  vec3 c = vColor * (halo + core) + vec3(core * 0.8);
  gl_FragColor = vec4(c * vFade, 1.0);
}`;

export type SparkOpts = {
  count?: number;
  /** Initial speed range (blocks/s). */
  speed?: number;
  /** Extra upward push. */
  up?: number;
  life?: number;
  size?: number;
  drag?: number;
  /** Spread of the start position around the point. */
  spread?: number;
};

export class Sparks {
  readonly points: THREE.Points;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly col: Float32Array;
  private next = 0;
  private time = 0;
  private dirtyFrom = -1;
  private dirtyTo = -1;
  private readonly mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, n = 2400, gravity = -6) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n * 4);
    this.col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.life[i * 4] = -1e6; // all dead
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VS,
      fragmentShader: SPARK_FS,
      uniforms: { uTime: { value: 0 }, uGravity: { value: gravity }, uScale: { value: 300 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  /** Point size scale: the drawing height in pixels (keeps sparks the same size at any resolution). */
  setViewHeight(px: number) {
    this.mat.uniforms.uScale.value = px * 0.42;
  }

  /** One spark. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number, drag = 1.6) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i * 4] = this.time; this.life[i * 4 + 1] = life; this.life[i * 4 + 2] = size; this.life[i * 4 + 3] = drag;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    if (this.dirtyFrom < 0) { this.dirtyFrom = i; this.dirtyTo = i; }
    else if (i === 0) { this.dirtyFrom = 0; this.dirtyTo = this.n - 1; } // wrapped: upload everything
    else this.dirtyTo = Math.max(this.dirtyTo, i);
  }

  /** A burst from a point, in random directions, coloured from `colors`. */
  burst(x: number, y: number, z: number, colors: [number, number, number][], o: SparkOpts = {}) {
    const count = o.count ?? 18, speed = o.speed ?? 4, up = o.up ?? 2, life = o.life ?? 0.9, size = o.size ?? 0.22, spread = o.spread ?? 0.4;
    for (let i = 0; i < count; i++) {
      // Uniform direction on a sphere.
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const v = speed * (0.35 + Math.random() * 0.65);
      const c = colors[i % colors.length];
      this.emit(
        x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread,
        Math.cos(a) * s * v, u * v + up, Math.sin(a) * s * v,
        life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), c[0], c[1], c[2], o.drag ?? 1.6,
      );
    }
  }

  update(dt: number) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (this.dirtyFrom < 0) return;
    const g = this.points.geometry;
    const from = this.dirtyFrom, count = this.dirtyTo - this.dirtyFrom + 1;
    for (const [name, size] of [['position', 3], ['aVel', 3], ['aLife', 4], ['aColor', 3]] as const) {
      const a = g.attributes[name] as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(from * size, count * size);
      a.needsUpdate = true;
    }
    this.dirtyFrom = this.dirtyTo = -1;
  }
}

/*
 * A field of drifting specks (snow, petals, leaves, fireflies) that lives in a box around the
 * camera. Everything moves in the vertex shader, wrapped into the box, so there's no per-frame
 * work on the JS thread.
 */
const DRIFT_VS = /* glsl */ `
attribute vec4 aSeed; // phase, speed jitter, size jitter, twinkle
uniform float uTime;
uniform vec3 uCam;
uniform float uBox;
uniform float uFall;
uniform float uSway;
uniform float uSize;
uniform float uScale;
uniform float uGlow;
varying float vAlpha;
void main() {
  float t = uTime;
  vec3 p = position;
  p.y -= uFall * (0.7 + 0.3 * aSeed.y) * t;
  p.x += sin(t * 0.9 + aSeed.x) * uSway + sin(t * 0.23 + aSeed.x * 3.0) * uSway * 2.0;
  p.z += cos(t * 0.7 + aSeed.x) * uSway * 0.6;
  // Wrap into a box centred on the camera.
  vec3 c = uCam + vec3(0.0, uBox * 0.15, 0.0);
  p = c + mod(p - c + uBox * 0.5, uBox) - uBox * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = uGlow > 0.5 ? 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * (1.5 + aSeed.w * 2.0) + aSeed.x * 7.0), 3.0) : 1.0;
  float dist = length(mv.xyz);
  vAlpha = tw * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, dist));
  gl_PointSize = uSize * (0.6 + 0.8 * aSeed.z) * uScale / max(0.3, -mv.z);
}`;

const DRIFT_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uGlow;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float a = uGlow > 0.5 ? exp(-r * r * 5.0) : 1.0 - smoothstep(0.55, 1.0, r);
  gl_FragColor = vec4(uColor * (uGlow > 0.5 ? a * vAlpha * uOpacity : 1.0), uGlow > 0.5 ? 1.0 : a * vAlpha * uOpacity);
}`;

export type DriftSpec = { color: number; size: number; fall: number; sway: number; count: number; box: number; glow?: boolean; opacity?: number };

export class DriftField {
  readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;
  private t = 0;

  constructor(readonly spec: DriftSpec) {
    const n = spec.count, pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * spec.box;
      pos[i * 3 + 1] = Math.random() * spec.box;
      pos[i * 3 + 2] = Math.random() * spec.box;
      seed.set([Math.random() * Math.PI * 2, Math.random(), Math.random(), Math.random()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: DRIFT_VS,
      fragmentShader: DRIFT_FS,
      uniforms: {
        uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: spec.box }, uFall: { value: spec.fall },
        uSway: { value: spec.sway }, uSize: { value: spec.size }, uScale: { value: 300 }, uGlow: { value: spec.glow ? 1 : 0 },
        uColor: { value: new THREE.Color(spec.color) }, uOpacity: { value: spec.opacity ?? 0.9 },
      },
      transparent: true,
      depthWrite: false,
      blending: spec.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setViewHeight(px: number) {
    this.mat.uniforms.uScale.value = px * 0.42;
  }

  /** brightness 0..1 dims non-glowing specks at night; `opacity` fades the whole field. */
  update(dt: number, cam: THREE.Vector3, brightness = 1, opacity = this.spec.opacity ?? 0.9) {
    this.t += dt;
    const u = this.mat.uniforms;
    u.uTime.value = this.t;
    (u.uCam.value as THREE.Vector3).copy(cam);
    u.uOpacity.value = opacity;
    (u.uColor.value as THREE.Color).setHex(this.spec.color);
    if (!this.spec.glow) (u.uColor.value as THREE.Color).multiplyScalar(brightness);
    this.points.visible = opacity > 0.01;
  }

  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
