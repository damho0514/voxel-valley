import * as THREE from 'three';
import { glowTexture } from './textures';

const DOME = 130; // inside the camera's far plane
type Palette = { zenith: number; horizon: number };

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Gradient from horizon to zenith, warm glow around the sun, a cool halo around the moon. */
const SKY_FS = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uDusk;
uniform float uNight;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.55));
  // Below the horizon fade to a deep tone (the far ground is fogged anyway).
  c = mix(c, uHorizon * 0.85, smoothstep(0.0, 0.25, -d.y));
  float s = max(dot(d, uSunDir), 0.0);
  c += vec3(1.0, 0.62, 0.32) * (pow(s, 6.0) * 0.35 + pow(s, 64.0) * 0.6) * uDusk;
  c += vec3(1.0, 0.95, 0.8) * pow(s, 24.0) * 0.25 * (1.0 - uNight);
  float m = max(dot(d, uMoonDir), 0.0);
  c += vec3(0.55, 0.68, 1.0) * (pow(m, 10.0) * 0.28 + pow(m, 80.0) * 0.35) * uNight;
  gl_FragColor = vec4(c, 1.0);
}`;

const STAR_VS = /* glsl */ `
attribute vec2 aStar; // size, phase
uniform float uTime;
uniform float uScale;
varying float vTw;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vTw = 0.55 + 0.45 * sin(uTime * (0.8 + fract(aStar.y) * 2.5) + aStar.y * 6.28);
  gl_PointSize = aStar.x * uScale;
}`;

const STAR_FS = /* glsl */ `
uniform float uOpacity;
varying float vTw;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float a = exp(-r * r * 6.0) * vTw * uOpacity;
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, 1.0);
}`;

/** A full moon with maria, craters and a soft limb, drawn once into a texture. */
function moonTexture(): THREE.DataTexture {
  const n = 128, data = new Uint8Array(n * n * 4);
  // Deterministic pseudo-random so the moon looks the same every time.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blobs = Array.from({ length: 7 }, () => ({ x: 0.3 + rnd() * 0.45, y: 0.25 + rnd() * 0.5, r: 0.1 + rnd() * 0.16 }));
  const craters = Array.from({ length: 26 }, () => ({ x: 0.15 + rnd() * 0.7, y: 0.15 + rnd() * 0.7, r: 0.015 + rnd() * rnd() * 0.08 }));
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n;
      const dx = u - 0.5, dy = v - 0.5, r = Math.hypot(dx, dy) / 0.48;
      const o = (y * n + x) * 4;
      if (r > 1.04) { data[o + 3] = 0; continue; }
      let l = 0.93;
      // Maria: big soft dark patches.
      for (const b of blobs) l -= Math.max(0, 1 - Math.hypot(u - b.x, v - b.y) / b.r) ** 1.5 * 0.2;
      // Craters: a dark floor and a bright rim on the lit side.
      for (const c of craters) {
        const d = Math.hypot(u - c.x, v - c.y) / c.r;
        if (d < 1) l -= 0.1 * (1 - d * d);
        else if (d < 1.3) l += 0.06 * (1.3 - d) / 0.3 * (u - c.x > 0 ? 1 : 0.4);
      }
      l += (Math.sin(u * 91 + v * 37) * Math.sin(u * 23 - v * 71)) * 0.025;
      // Limb darkening.
      l *= 0.78 + 0.22 * Math.sqrt(Math.max(0, 1 - r * r));
      const a = Math.max(0, Math.min(1, (1.04 - r) / 0.06));
      data[o] = Math.min(255, l * 238);
      data[o + 1] = Math.min(255, l * 242);
      data[o + 2] = Math.min(255, l * 255);
      data[o + 3] = a * 255;
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const TRAIL_N = 48;

/**
 * The sky: a shader gradient dome, sun and a big detailed moon that follow the time of day, stars
 * that twinkle, golden shooting trails on clear nights, and a layer of soft drifting clouds.
 * Per frame it only moves things and sets uniforms; nothing is allocated.
 */
export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly sun: THREE.Sprite;
  private readonly moon: THREE.Sprite;
  private readonly moonHalo: THREE.Sprite;
  private readonly stars: THREE.Points;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly clouds: THREE.InstancedMesh;
  private readonly trails: { line: THREE.Line; pos: Float32Array; t: number; period: number; seed: number }[] = [];
  private cloudCells: { x: number; z: number; w: number; d: number }[] = [];
  private drift = 0;
  private clock = 0;
  private zen = new THREE.Color();
  private hor = new THREE.Color();
  private readonly tmpA = new THREE.Color();
  private readonly tmpB = new THREE.Color();
  private readonly m4 = new THREE.Matrix4();
  private readonly sunDir = new THREE.Vector3();
  private palette: Palette = { zenith: 0x5aa8e6, horizon: 0xd8eefa };
  horizonColor = new THREE.Color(0xd8eefa);
  /** 0 day .. 1 deep night, for the renderer's grading and lights. */
  night = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uDusk: { value: 0 }, uNight: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(DOME, 32, 16), this.domeMat);
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(0xfffbe8, 0xffd27a), fog: false, depthWrite: false, transparent: true }));
    this.sun.scale.set(30, 30, 1);
    this.moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(0xdfe8ff, 0x7f9cff), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.5 }));
    this.moonHalo.scale.set(110, 110, 1);
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), fog: false, depthWrite: false, transparent: true }));
    this.moon.scale.set(30, 30, 1);
    this.sun.renderOrder = -9;
    this.moonHalo.renderOrder = -9;
    this.moon.renderOrder = -8;
    this.group.add(this.sun, this.moonHalo, this.moon);

    const n = 1100, pos = new Float32Array(n * 3), star = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 0.97 + 0.03, a = Math.random() * Math.PI * 2, r = DOME * 0.95;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r], i * 3);
      const big = Math.random();
      star.set([big > 0.97 ? 3.4 : big > 0.85 ? 2.2 : 1.3, Math.random() * 10], i * 2);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aStar', new THREE.BufferAttribute(star, 2));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VS, fragmentShader: STAR_FS,
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uOpacity: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // Golden shooting trails: a bright head and a long tapering tail of light.
    for (let i = 0; i < 2; i++) {
      const g = new THREE.BufferGeometry();
      const p = new Float32Array(TRAIL_N * 3), c = new Float32Array(TRAIL_N * 3);
      for (let k = 0; k < TRAIL_N; k++) {
        const f = (1 - k / TRAIL_N) ** 2;
        c.set([1 * f, 0.82 * f, 0.45 * f], k * 3);
      }
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      line.frustumCulled = false;
      line.renderOrder = -8;
      this.group.add(line);
      this.trails.push({ line, pos: p, t: i * 9, period: 14 + i * 7, seed: i * 2.3 + 0.7 });
    }

    // Clouds: flat puffy slabs in a band high above, laid out once and drifted.
    for (let gx = -12; gx < 12; gx++)
      for (let gz = -12; gz < 12; gz++) {
        const h = Math.abs(Math.sin(gx * 12.9898 + gz * 78.233) * 43758.5453) % 1;
        if (h < 0.8) continue;
        this.cloudCells.push({ x: gx * 14, z: gz * 14, w: 10 + h * 16, d: 8 + ((h * 7) % 1) * 12 });
      }
    this.clouds = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, fog: false, depthWrite: false }), this.cloudCells.length);
    this.clouds.renderOrder = -7;
    this.clouds.frustumCulled = false;
    this.group.add(this.clouds);
    scene.add(this.group);
  }

  setPalette(p: Palette, clouds: boolean) {
    this.palette = p;
    this.clouds.visible = clouds;
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  /** Star and trail point size follows the drawing size. */
  setViewHeight(px: number) {
    this.starMat.uniforms.uScale.value = Math.max(1, px / 700);
  }

  /**
   * time: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight. daylight 0..1.
   * Returns the horizon colour (use it for fog and the clear colour).
   */
  update(camera: THREE.Camera, time: number, daylight: number, dt: number) {
    this.clock += dt;
    this.group.position.copy(camera.position);
    this.night = Math.max(0, Math.min(1, 1 - daylight * 1.25));
    const zen = this.zen.setHex(this.palette.zenith), hor = this.hor.setHex(this.palette.horizon);
    // Night: a deep navy zenith over a muted moonlit horizon (fog takes the horizon colour).
    zen.lerp(this.tmpA.setHex(0x0a0f24), 1 - daylight);
    hor.lerp(this.tmpB.setHex(0x2b3a62), 1 - daylight);
    // Warm the horizon around sunrise and sunset.
    const dusk = Math.max(0, 1 - Math.abs(Math.sin(time * Math.PI * 2)) * 3.2) * (daylight > 0.12 ? 1 : 0);
    hor.lerp(this.tmpA.setHex(0xff9f7a), dusk * 0.6);
    zen.lerp(this.tmpA.setHex(0x5a5aa8), dusk * 0.35);
    this.horizonColor.copy(hor);

    // The sun's path leans toward -z (the castle, seen from spawn), so the moon rises low and big behind it.
    const a = time * Math.PI * 2;
    const sunDir = this.sunDir.set(Math.cos(a), Math.sin(a) * 0.82, -0.5).normalize();
    const u = this.domeMat.uniforms;
    (u.uZenith.value as THREE.Color).copy(zen);
    (u.uHorizon.value as THREE.Color).copy(hor);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    // The moon has its own low arc: it rises at sunset, rides about 30° high behind the castle at
    // midnight and sets at dawn, so it's always in the picture at night (like a big film moon).
    const am = (time - 0.5) * Math.PI * 2;
    (u.uMoonDir.value as THREE.Vector3).set(Math.cos(am) * 0.55, Math.sin(am) * 0.5, -0.8).normalize();
    u.uDusk.value = dusk;
    u.uNight.value = this.night;
    this.sun.position.copy(sunDir).multiplyScalar(DOME * 0.9);
    const md = u.uMoonDir.value as THREE.Vector3;
    this.moon.position.copy(md).multiplyScalar(DOME * 0.88);
    this.moonHalo.position.copy(md).multiplyScalar(DOME * 0.9);
    this.sun.visible = sunDir.y > -0.1;
    this.moon.visible = this.moonHalo.visible = md.y > -0.08;
    (this.moonHalo.material as THREE.SpriteMaterial).opacity = 0.15 + 0.4 * this.night;
    this.starMat.uniforms.uOpacity.value = Math.max(0, 1 - daylight * 1.5);
    this.starMat.uniforms.uTime.value = this.clock;
    this.updateTrails(dt);

    this.drift += dt * 1.2;
    const span = 24 * 14;
    const wrap = (v: number) => ((v + span / 2) % span + span) % span - span / 2;
    const cx = camera.position.x % span, cz = camera.position.z % span, cy = 66 - camera.position.y;
    for (let i = 0; i < this.cloudCells.length; i++) {
      const c = this.cloudCells[i];
      // Positions relative to the camera, wrapped so the cloud field never runs out.
      this.m4.makeScale(c.w, 3, c.d);
      this.m4.setPosition(wrap(wrap(c.x + this.drift) - cx), cy, wrap(wrap(c.z) - cz));
      this.clouds.setMatrixAt(i, this.m4);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    const cm = this.clouds.material as THREE.MeshBasicMaterial;
    // Day: white; night: moonlit blue-grey, thinner so the stars and moon show.
    cm.color.setRGB(0.36 + 0.64 * daylight, 0.42 + 0.58 * daylight, 0.62 + 0.38 * daylight);
    cm.opacity = 0.22 + 0.62 * daylight;
    return hor;
  }

  /** Each trail streaks across the night sky, then waits below the horizon for its next pass. */
  private updateTrails(dt: number) {
    for (const tr of this.trails) {
      tr.t += dt;
      const u = (tr.t % tr.period) / (tr.period * 0.28); // visible for the first 28% of the period
      const show = this.night > 0.35 && u < 1;
      tr.line.visible = show;
      if (!show) continue;
      const cycle = Math.floor(tr.t / tr.period);
      const a = tr.seed + cycle * 2.4;
      const r = DOME * 0.85;
      // An arc high across the sky.
      for (let k = 0; k < TRAIL_N; k++) {
        const s = Math.max(0, u - k * 0.006);
        const ang = a + (s - 0.5) * 1.6;
        const y = 0.35 + 0.35 * Math.sin(s * Math.PI) + 0.1 * Math.sin(a);
        const h = Math.sqrt(1 - y * y);
        tr.pos[k * 3] = Math.cos(ang) * h * r;
        tr.pos[k * 3 + 1] = y * r;
        tr.pos[k * 3 + 2] = Math.sin(ang) * h * r;
      }
      (tr.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (tr.line.material as THREE.LineBasicMaterial).opacity = Math.sin(Math.min(1, u) * Math.PI) * this.night;
    }
  }
}
