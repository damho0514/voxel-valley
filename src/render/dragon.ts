import * as THREE from 'three';

const SEGMENTS = 46;
const SPACING = 2.4; // world units between body segments along the flight path
const SPEED = 22; // units per second along the path
const RADIUS = 30;
const HEIGHT = 22;

type Particle = { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; color: THREE.Color };
type Breath = { from: THREE.Vector3; to: THREE.Vector3; t: number; onArrive: () => void; done: boolean };

/**
 * A colossal sky dragon (an original design: a long crimson serpent with gold horns, belly plates
 * and dorsal spikes) that circles the area in a figure-eight, breathes fire at targets and throws
 * out embers and debris when the fire lands. Purely visual: the caller does the terrain damage.
 */
export class Dragon {
  readonly group = new THREE.Group();
  private readonly segments: THREE.Group[] = [];
  private readonly head: THREE.Group;
  private readonly jaw: THREE.Mesh;
  private center = new THREE.Vector3();
  private u = 0; // distance travelled along the path
  private arrive = 1; // 1 → 0 while swooping in from far away
  private leaving = -1; // ≥ 0 while flying off
  private breaths: Breath[] = [];
  private particles: Particle[] = [];
  private readonly points: THREE.Points;
  private readonly pointPos: Float32Array;
  private readonly pointCol: Float32Array;
  private static readonly MAX_PARTICLES = 900;
  gone = false;

  constructor(private readonly scene: THREE.Scene, center: THREE.Vector3) {
    this.center.copy(center);
    const mat = (c: number) => new THREE.MeshBasicMaterial({ color: c, fog: false });
    const scale = new THREE.BoxGeometry(1, 1, 1);
    const crimson = mat(0xc4303d), dark = mat(0x8a1d2a), gold = mat(0xf2b544), spikeMat = mat(0xf7d27a);

    for (let i = 0; i < SEGMENTS; i++) {
      const k = 1 - i / SEGMENTS;
      const size = 1.2 + 3.0 * Math.pow(k, 0.7); // thick neck tapering to a thin tail
      const seg = new THREE.Group();
      const body = new THREE.Mesh(scale, i % 2 ? crimson : dark);
      body.scale.set(size, size * 0.9, SPACING * 1.15);
      const belly = new THREE.Mesh(scale, gold);
      belly.scale.set(size * 0.7, size * 0.2, SPACING * 1.1);
      belly.position.y = -size * 0.45;
      const spike = new THREE.Mesh(scale, spikeMat);
      spike.scale.set(size * 0.18, size * 0.55, size * 0.35);
      spike.position.y = size * 0.6;
      spike.rotation.x = -0.5;
      seg.add(body, belly, spike);
      if (i === 8 || i === 9) {
        // Wing-like fins near the shoulders.
        for (const side of [-1, 1]) {
          const fin = new THREE.Mesh(scale, mat(0xe8554f));
          fin.scale.set(size * 2.6, 0.2, size * 1.4);
          fin.position.set(side * size * 1.6, size * 0.2, 0);
          fin.rotation.z = side * 0.35;
          seg.add(fin);
        }
      }
      this.segments.push(seg);
      this.group.add(seg);
    }

    // Head: snout, horns, glowing eyes and a jaw that opens to breathe.
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(scale, crimson);
    skull.scale.set(4.6, 3.4, 5.2);
    const snout = new THREE.Mesh(scale, dark);
    snout.scale.set(3.4, 2.0, 3.4);
    snout.position.set(0, -0.2, -4.0);
    this.jaw = new THREE.Mesh(scale, mat(0x6e1621));
    this.jaw.scale.set(3.2, 0.9, 4.0);
    this.jaw.position.set(0, -1.7, -3.6);
    const eyeMat = mat(0xffe25a);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(scale, eyeMat);
      eye.scale.set(0.8, 0.6, 0.4);
      eye.position.set(side * 1.6, 0.9, -2.6);
      const horn = new THREE.Mesh(scale, gold);
      horn.scale.set(0.6, 0.6, 4.2);
      horn.position.set(side * 1.5, 2.2, 2.4);
      horn.rotation.x = 0.55;
      const whisker = new THREE.Mesh(scale, spikeMat);
      whisker.scale.set(0.2, 0.2, 4.5);
      whisker.position.set(side * 2.2, -0.6, -4.0);
      whisker.rotation.y = side * 0.6;
      this.head.add(eye, horn, whisker);
    }
    this.head.add(skull, snout, this.jaw);
    this.group.add(this.head);

    this.pointPos = new Float32Array(Dragon.MAX_PARTICLES * 3);
    this.pointCol = new Float32Array(Dragon.MAX_PARTICLES * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pointPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pointCol, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.1, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
    this.points.frustumCulled = false;
    this.group.add(this.points);
    scene.add(this.group);
  }

  /** Point on the figure-eight flight path at distance u (swoops in from far away while arriving). */
  private pathAt(u: number, out: THREE.Vector3) {
    const a = u / (RADIUS * 1.6);
    const far = 1 + this.arrive * 3 + Math.max(0, this.leaving) * 4;
    out.set(
      this.center.x + Math.sin(a) * RADIUS * far,
      this.center.y + HEIGHT + Math.sin(a * 3) * 7 + this.arrive * 30 + Math.max(0, this.leaving) * 60,
      this.center.z + Math.sin(a) * Math.cos(a) * RADIUS * 1.5 * far,
    );
    return out;
  }

  get headPosition() {
    return this.head.position;
  }

  /** Re-centre the circling on a new spot (the player moved far). */
  follow(center: THREE.Vector3) {
    this.center.lerp(center, 0.02);
  }

  /** Fire from the mouth to `to`; calls onArrive when it lands (≈0.7 s). */
  breathe(to: THREE.Vector3, onArrive: () => void) {
    this.breaths.push({ from: this.head.position.clone(), to: to.clone(), t: 0, onArrive, done: false });
  }

  leave() {
    if (this.leaving < 0) this.leaving = 0;
  }

  private spawn(p: THREE.Vector3, v: THREE.Vector3, life: number, color: number) {
    if (this.particles.length >= Dragon.MAX_PARTICLES) this.particles.shift();
    this.particles.push({ p: p.clone(), v, life, max: life, color: new THREE.Color(color) });
  }

  /** Embers, smoke and debris bursting out of an impact. */
  burst(at: THREE.Vector3) {
    for (let i = 0; i < 140; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 1.2, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 14);
      const r = Math.random();
      this.spawn(at, v, 0.8 + Math.random() * 1.2, r < 0.45 ? 0xff8a2a : r < 0.7 ? 0xffd34d : r < 0.85 ? 0x9a8a80 : 0xff3b2a);
    }
  }

  update(dt: number) {
    if (this.arrive > 0) this.arrive = Math.max(0, this.arrive - dt * 0.35);
    if (this.leaving >= 0) {
      this.leaving += dt * 0.5;
      if (this.leaving > 1.6) {
        this.dispose();
        return;
      }
    }
    this.u += SPEED * dt;
    const tmp = new THREE.Vector3(), ahead = new THREE.Vector3();
    for (let i = 0; i < SEGMENTS; i++) {
      const u = this.u - (i + 1) * SPACING;
      this.pathAt(u, tmp);
      this.pathAt(u + 0.5, ahead);
      const seg = this.segments[i];
      seg.position.copy(tmp);
      seg.lookAt(ahead);
      seg.rotateY(Math.PI); // boxes face -z forward
      seg.position.y += Math.sin(this.u * 0.15 - i * 0.4) * 0.6; // ripple down the body
    }
    this.pathAt(this.u, tmp);
    this.pathAt(this.u + 0.5, ahead);
    this.head.position.copy(tmp);

    // While breathing, the head turns to face its target and the jaw opens.
    const active = this.breaths.find((b) => !b.done);
    if (active) {
      this.head.lookAt(active.to);
      this.head.rotateY(Math.PI);
      this.jaw.rotation.x = Math.min(0.6, this.jaw.rotation.x + dt * 4);
    } else {
      this.head.lookAt(ahead);
      this.head.rotateY(Math.PI);
      this.jaw.rotation.x = Math.max(0, this.jaw.rotation.x - dt * 3);
    }

    // Fire streams: a cone of flame particles from the mouth that reaches the target in ~0.7 s.
    for (const b of this.breaths) {
      if (b.done) continue;
      b.t += dt;
      b.from.copy(this.head.position);
      const dir = b.to.clone().sub(b.from);
      const dist = dir.length();
      dir.normalize();
      for (let k = 0; k < 18; k++) {
        const v = dir.clone().multiplyScalar(dist / 0.7).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4));
        const r = Math.random();
        this.spawn(b.from, v, 0.7 * (0.6 + Math.random() * 0.5), r < 0.5 ? 0xff7a1f : r < 0.85 ? 0xffd34d : 0xfff3c2);
      }
      if (b.t > 0.7) {
        b.done = true;
        this.burst(b.to);
        b.onArrive();
      }
    }
    this.breaths = this.breaths.filter((b) => !b.done || b.t < 0);

    // Particles: drift, a little gravity on debris, fade by shrinking toward black.
    let n = 0;
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.v.y -= 6 * dt;
      p.p.addScaledVector(p.v, dt);
      // Dim a little as they die, but never to black (black specks look like holes in the sky).
      const fade = 0.55 + 0.45 * (p.life / p.max);
      this.pointPos.set([p.p.x, p.p.y, p.p.z], n * 3);
      this.pointCol.set([p.color.r * fade, p.color.g * fade, p.color.b * fade], n * 3);
      n++;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    if (this.gone) return;
    this.gone = true;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
