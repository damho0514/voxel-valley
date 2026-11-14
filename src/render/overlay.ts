import * as THREE from 'three';

/** A point on screen (touch coordinates: points, y down). */
export type Pt = { x: number; y: number };

/*
 * Screen-space layer drawn on top of the world for drawing-to-break: the glowing trail your finger
 * leaves, and the closed loop flashing gold when it blows up what's inside.
 */

const MAX_PTS = 400;
/** A thick line as triangles (WebGL ignores line widths). */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly pos = new Float32Array(MAX_PTS * 6 * 3);
  constructor(color: number, opacity: number, z: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.position.z = z;
  }
  set(pts: Pt[], width: number, closed = false) {
    const p = closed && pts.length > 2 ? [...pts, pts[0]] : pts;
    const n = Math.min(p.length, MAX_PTS);
    let k = 0;
    const half = width / 2;
    for (let i = 0; i < n - 1; i++) {
      const a = p[i], b = p[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      // Overlap each segment a little so joints have no gaps.
      const ex = (dx / len) * half * 0.6, ey = (dy / len) * half * 0.6;
      const nx = (-dy / len) * half, ny = (dx / len) * half;
      const ax = a.x - ex, ay = -(a.y - ey), bx = b.x + ex, by = -(b.y + ey);
      const quad = [ax + nx, ay - ny, ax - nx, ay + ny, bx + nx, by - ny, bx + nx, by - ny, ax - nx, ay + ny, bx - nx, by + ny];
      for (let j = 0; j < 6; j++) { this.pos[k++] = quad[j * 2]; this.pos[k++] = quad[j * 2 + 1]; this.pos[k++] = 0; }
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, k / 3);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = k > 0;
  }
  get material() { return this.mesh.material as THREE.MeshBasicMaterial; }
}

export class DrawOverlay {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  private readonly glow = new Ribbon(0xffd166, 0.4, 0);
  private readonly core = new Ribbon(0xffffff, 0.95, 1);
  private readonly loopGlow = new Ribbon(0xffd166, 0.45, 2);
  private readonly loopCore = new Ribbon(0xfff4c2, 0.95, 3);
  private loopPts: Pt[] = [];
  private loopAge = Infinity;
  private trailFade = 0;
  private t = 0;
  visible = true;

  constructor() {
    for (const r of [this.glow, this.core, this.loopGlow, this.loopCore]) this.scene.add(r.mesh);
  }

  setSize(w: number, h: number) {
    this.camera.right = w;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * The stroke being drawn, in the weapon's colour. `spent` greys it out (out of energy).
   * An empty stroke lets the last one fade away.
   */
  setTrail(stroke: Pt[], color: number, width: number, spent: boolean) {
    if (!stroke.length) return;
    this.glow.set(stroke, width * 2.6);
    this.core.set(stroke, Math.max(4, width * 0.8));
    this.glow.material.color.setHex(spent ? 0x8a8f99 : color);
    this.core.material.color.setHex(spent ? 0xc8ccd4 : 0xffffff);
    this.trailFade = 1;
  }

  /** The stroke ended: let the trail fade out. */
  release() {
    this.trailFade = Math.min(this.trailFade, 0.999);
  }

  /** A closed loop was drawn: flash it gold and let it swell as it fades. */
  flashLoop(pts: Pt[]) {
    this.loopPts = pts;
    this.loopAge = 0;
  }

  update(dt: number) {
    this.t += dt;
    if (this.trailFade < 1) {
      this.trailFade = Math.max(0, this.trailFade - dt * 3.5);
      this.glow.material.opacity = 0.4 * this.trailFade;
      this.core.material.opacity = 0.95 * this.trailFade;
      if (this.trailFade <= 0) this.glow.mesh.visible = this.core.mesh.visible = false;
    } else {
      // A slight shimmer while drawing.
      this.glow.material.opacity = 0.34 + Math.sin(this.t * 18) * 0.08;
      this.core.material.opacity = 0.95;
    }
    this.loopAge += dt;
    const life = 0.9;
    if (this.loopAge < life && this.loopPts.length) {
      const u = this.loopAge / life;
      const cx = this.loopPts.reduce((s, p) => s + p.x, 0) / this.loopPts.length, cy = this.loopPts.reduce((s, p) => s + p.y, 0) / this.loopPts.length;
      const k = 1 + u * 0.12;
      const pts = this.loopPts.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
      this.loopGlow.set(pts, 24, true);
      this.loopCore.set(pts, 8, true);
      this.loopGlow.material.opacity = 0.5 * (1 - u);
      this.loopCore.material.opacity = 1 - u * u;
    } else {
      this.loopGlow.mesh.visible = this.loopCore.mesh.visible = false;
    }
  }
}

/** Glowing boxes over blocks the stroke has touched, in the moment before they shatter. */
export class SelectionGlow {
  readonly mesh: THREE.InstancedMesh;
  readonly edges: THREE.LineSegments;
  private count = 0;
  private t = 0;
  static readonly MAX = 2000;

  /** `xray`: drawn through walls (the 보물 투시 effect shows buried treasure). */
  constructor(scene: THREE.Scene, opts: { color?: number; xray?: boolean } = {}) {
    const xray = !!opts.xray;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.03, 1.03, 1.03),
      new THREE.MeshBasicMaterial({ color: opts.color ?? 0x5ff2ff, transparent: true, opacity: 0.35, depthWrite: false, depthTest: !xray, fog: false,
        // Marked blocks glow (additive) so they read as enchanted, and bloom at night.
        blending: opts.color !== undefined && !xray ? THREE.AdditiveBlending : THREE.NormalBlending }), SelectionGlow.MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: xray ? opts.color ?? 0xffffff : 0xffffff, transparent: true, opacity: 0.9, depthTest: !xray, fog: false }));
    this.edges.frustumCulled = false;
    this.edges.renderOrder = 5;
    scene.add(this.mesh, this.edges);
  }

  set(blocks: { x: number; y: number; z: number }[]) {
    const m = new THREE.Matrix4();
    const n = Math.min(blocks.length, SelectionGlow.MAX);
    for (let i = 0; i < n; i++) {
      m.makeTranslation(blocks[i].x + 0.5, blocks[i].y + 0.5, blocks[i].z + 0.5);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    // Outline: only the edges between selected and unselected neighbours, so a selected wall
    // reads as one glowing slab rather than a grid of boxes.
    const has = new Set(blocks.map((b) => `${b.x},${b.y},${b.z}`));
    const seg: number[] = [];
    const E = 0.015;
    const edge = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => seg.push(ax, ay, az, bx, by, bz);
    for (const b of blocks.slice(0, n)) {
      const x0 = b.x - E, y0 = b.y - E, z0 = b.z - E, x1 = b.x + 1 + E, y1 = b.y + 1 + E, z1 = b.z + 1 + E;
      const free = (dx: number, dy: number, dz: number) => !has.has(`${b.x + dx},${b.y + dy},${b.z + dz}`);
      // Each of the 12 edges is drawn when either face touching it is on the outside.
      if (free(0, -1, 0) || free(0, 0, -1)) edge(x0, y0, z0, x1, y0, z0);
      if (free(0, 1, 0) || free(0, 0, -1)) edge(x0, y1, z0, x1, y1, z0);
      if (free(0, -1, 0) || free(0, 0, 1)) edge(x0, y0, z1, x1, y0, z1);
      if (free(0, 1, 0) || free(0, 0, 1)) edge(x0, y1, z1, x1, y1, z1);
      if (free(-1, 0, 0) || free(0, 0, -1)) edge(x0, y0, z0, x0, y1, z0);
      if (free(1, 0, 0) || free(0, 0, -1)) edge(x1, y0, z0, x1, y1, z0);
      if (free(-1, 0, 0) || free(0, 0, 1)) edge(x0, y0, z1, x0, y1, z1);
      if (free(1, 0, 0) || free(0, 0, 1)) edge(x1, y0, z1, x1, y1, z1);
      if (free(-1, 0, 0) || free(0, -1, 0)) edge(x0, y0, z0, x0, y0, z1);
      if (free(1, 0, 0) || free(0, -1, 0)) edge(x1, y0, z0, x1, y0, z1);
      if (free(-1, 0, 0) || free(0, 1, 0)) edge(x0, y1, z0, x0, y1, z1);
      if (free(1, 0, 0) || free(0, 1, 0)) edge(x1, y1, z0, x1, y1, z1);
    }
    this.edges.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seg), 3));
    this.edges.geometry = g;
    this.count = n;
    this.edges.visible = this.mesh.visible = n > 0;
  }

  update(dt: number) {
    if (!this.count) return;
    this.t += dt;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.28 + 0.16 * Math.sin(this.t * 5);
    (this.edges.material as THREE.LineBasicMaterial).opacity = 0.65 + 0.35 * Math.sin(this.t * 5);
  }
}
