import * as THREE from 'three';

/*
 * The frame is drawn into an offscreen target, then put on screen in one pass that adds bloom
 * (windows, the moon, magic sparks glow and bleed light), a gentle colour grade and a vignette.
 * Bloom is computed at a quarter of the size, so it costs little next to the scene itself.
 */

const FULLSCREEN_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Keeps only what's bright (soft knee), at a quarter of the frame size. */
const BRIGHT_FS = /* glsl */ `
uniform sampler2D tMap;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold, uThreshold + 0.25, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

/** 9-tap gaussian along one axis (linear sampling makes it 5 fetches wide). */
const BLUR_FS = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv).rgb * 0.2270270270;
  c += texture2D(tMap, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tMap, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tMap, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tMap, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE_FS = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uNight;
uniform float uVignette;
uniform vec3 uFlash;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  vec3 b = texture2D(tBloom, vUv).rgb;
  c += b * uBloom;
  // Clamp before grading: the S-curve below folds values over 1 back down (bright turned black).
  c = clamp(c, 0.0, 1.0);
  // Grade: a little more contrast and colour, cool shadows at night, warm highlights.
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = clamp(mix(vec3(l), c, 1.12), 0.0, 1.0);
  c = c * c * (3.0 - 2.0 * c) * 0.32 + c * 0.68;
  c += vec3(-0.012, 0.0, 0.035) * (1.0 - l) * uNight;
  // Vignette.
  vec2 d = vUv - 0.5;
  c *= 1.0 - uVignette * dot(d, d) * 1.6;
  c += uFlash;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function target(w: number, h: number, depth: boolean) {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    depthBuffer: depth,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  t.texture.colorSpace = THREE.LinearSRGBColorSpace;
  return t;
}

export type PostQuality = 'high' | 'low';

export class PostFX {
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private sceneRT: THREE.WebGLRenderTarget;
  private brightRT: THREE.WebGLRenderTarget;
  private blurRT: THREE.WebGLRenderTarget;
  private readonly bright: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private screenW = 1;
  private screenH = 1;
  /**
   * Offscreen size relative to the GL drawing buffer. Kept at 1 so the picture stays as sharp as
   * before: speed and heat are handled by frame pacing, not by rendering fewer pixels.
   */
  scale = 1;
  private minScale = 1;
  private maxScale = 1;
  bloom = 0.9;
  /** Draw calls and triangles of the world pass (the post passes aren't counted). */
  calls = 0;
  triangles = 0;
  threshold = 0.72;
  night = 0;
  enabled = true;
  /** Recent frame times, for the automatic resolution. */
  private frameAvg = 1 / 60;
  private sinceChange = 0;

  constructor(w: number, h: number) {
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    const mat = (fs: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    this.bright = mat(BRIGHT_FS, { tMap: { value: null }, uThreshold: { value: 0.72 } });
    this.blur = mat(BLUR_FS, { tMap: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.composite = mat(COMPOSITE_FS, {
      tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.9 }, uNight: { value: 0 },
      uVignette: { value: 0.55 }, uFlash: { value: new THREE.Color(0, 0, 0) },
    });
    this.sceneRT = target(1, 1, true);
    this.brightRT = target(1, 1, false);
    this.blurRT = target(1, 1, false);
    this.setSize(w, h);
  }

  setSize(w: number, h: number) {
    this.screenW = w;
    this.screenH = h;
    const sw = Math.round(w * this.scale), sh = Math.round(h * this.scale);
    this.sceneRT.setSize(sw, sh);
    const bw = Math.max(1, Math.round(sw / 4)), bh = Math.max(1, Math.round(sh / 4));
    this.brightRT.setSize(bw, bh);
    this.blurRT.setSize(bw, bh);
  }

  /** Brief full-screen colour wash (white flash of a big blast, red when hurt), 0..1 per channel. */
  get flash() {
    return this.composite.uniforms.uFlash.value as THREE.Color;
  }

  /**
   * Called once per frame with the real time between frames. Below ~48 fps the resolution
   * steps down; with headroom for a while it steps back up.
   */
  adapt(dt: number) {
    if (dt <= 0 || dt > 0.25) return;
    this.frameAvg += (dt - this.frameAvg) * 0.05;
    this.sinceChange += dt;
    if (this.sinceChange < 2) return;
    const fps = 1 / this.frameAvg;
    let next = this.scale;
    if (fps < 47) next = Math.max(this.minScale, this.scale - 0.06);
    else if (fps > 58 && this.sinceChange > 6) next = Math.min(this.maxScale, this.scale + 0.04);
    if (next !== this.scale) {
      this.scale = next;
      this.sinceChange = 0;
      this.setSize(this.screenW, this.screenH);
    }
  }

  private pass(r: THREE.WebGLRenderer, m: THREE.Material, to: THREE.WebGLRenderTarget | null) {
    this.quad.material = m;
    r.setRenderTarget(to);
    r.render(this.scene, this.cam);
  }

  /** Draws `scene` through the post chain onto the screen. */
  render(r: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      this.calls = r.info.render.calls;
      this.triangles = r.info.render.triangles;
      return;
    }
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);
    this.calls = r.info.render.calls;
    this.triangles = r.info.render.triangles;
    if (this.bloom > 0.01) {
      this.bright.uniforms.tMap.value = this.sceneRT.texture;
      this.bright.uniforms.uThreshold.value = this.threshold;
      this.pass(r, this.bright, this.brightRT);
      const bw = this.brightRT.width, bh = this.brightRT.height;
      for (let i = 0; i < 2; i++) {
        const spread = 1 + i;
        this.blur.uniforms.tMap.value = this.brightRT.texture;
        (this.blur.uniforms.uDir.value as THREE.Vector2).set(spread / bw, 0);
        this.pass(r, this.blur, this.blurRT);
        this.blur.uniforms.tMap.value = this.blurRT.texture;
        (this.blur.uniforms.uDir.value as THREE.Vector2).set(0, spread / bh);
        this.pass(r, this.blur, this.brightRT);
      }
    }
    const u = this.composite.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tBloom.value = this.brightRT.texture;
    u.uBloom.value = this.bloom;
    u.uNight.value = this.night;
    this.pass(r, this.composite, null);
  }
}
