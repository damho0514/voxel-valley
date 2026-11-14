import * as THREE from 'three';
import { crackTextures } from './textures';

const CHIPS = 360;

type Chip = { p: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3; rot: THREE.Euler; life: number; size: number };

/** Block-breaking feedback: cracks spreading over the block you dig, and chips flying when it breaks. */
export class BreakEffects {
  private readonly crack: THREE.Mesh;
  private readonly stages = crackTextures();
  private readonly chips: THREE.InstancedMesh;
  private live: Chip[] = [];
  private next = 0;
  /** Chips still flying (when 0, update skips the whole buffer). */
  private alive = 0;
  private settled = true;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  constructor(scene: THREE.Scene, private readonly isSolid: (x: number, y: number, z: number) => boolean) {
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.crack.visible = false;
    this.crack.renderOrder = 3;
    scene.add(this.crack);

    this.chips = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), CHIPS);
    this.chips.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CHIPS * 3), 3);
    this.chips.frustumCulled = false;
    scene.add(this.chips);
  }

  /** progress 0..1 on block (x,y,z); null hides the cracks. */
  setDig(progress: number, x?: number, y?: number, z?: number) {
    if (progress <= 0.02 || x === undefined) {
      this.crack.visible = false;
      return;
    }
    const stage = Math.min(this.stages.length - 1, Math.floor(progress * this.stages.length));
    const mat = this.crack.material as THREE.MeshBasicMaterial;
    if (mat.map !== this.stages[stage]) {
      mat.map = this.stages[stage];
      mat.needsUpdate = true;
    }
    this.crack.position.set(x + 0.5, (y ?? 0) + 0.5, (z ?? 0) + 0.5);
    // A tiny shudder as it gives way.
    this.crack.position.x += (Math.random() - 0.5) * 0.02 * progress;
    this.crack.visible = true;
  }

  /** Chips in the block's colours burst out of (x,y,z) and tumble to the ground. */
  burst(x: number, y: number, z: number, colors: [number, number, number][], count = 14) {
    for (let i = 0; i < count; i++) {
      const chip: Chip = {
        p: new THREE.Vector3(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6),
        v: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3.5, (Math.random() - 0.5) * 4),
        spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
        rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        life: 0.7 + Math.random() * 0.6,
        size: 0.1 + Math.random() * 0.1,
      };
      const c = colors[i % colors.length];
      const slot = this.next;
      this.next = (this.next + 1) % CHIPS;
      this.live[slot] = chip;
      this.alive = CHIPS; // re-count on the next update
      this.settled = false;
      this.chips.instanceColor!.setXYZ(slot, c[0] * (0.85 + Math.random() * 0.25), c[1] * (0.85 + Math.random() * 0.25), c[2] * (0.85 + Math.random() * 0.25));
    }
    this.chips.instanceColor!.needsUpdate = true;
  }

  update(dt: number, daylight: number) {
    if (this.settled) return;
    let alive = 0;
    for (let i = 0; i < CHIPS; i++) {
      const c = this.live[i];
      if (!c || c.life <= 0) {
        this.m.makeScale(0, 0, 0);
        this.chips.setMatrixAt(i, this.m);
        continue;
      }
      alive++;
      c.life -= dt;
      c.v.y -= 18 * dt;
      const nx = c.p.x + c.v.x * dt, ny = c.p.y + c.v.y * dt, nz = c.p.z + c.v.z * dt;
      if (this.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        // Bounce off the ground with heavy damping, then slide to rest.
        c.v.y = Math.abs(c.v.y) * 0.25;
        c.v.x *= 0.5;
        c.v.z *= 0.5;
      } else c.p.set(nx, ny, nz);
      c.rot.x += c.spin.x * dt; c.rot.y += c.spin.y * dt; c.rot.z += c.spin.z * dt;
      const sz = c.size * Math.min(1, c.life * 3);
      this.q.setFromEuler(c.rot);
      this.s.set(sz, sz, sz);
      this.m.compose(c.p, this.q, this.s);
      this.chips.setMatrixAt(i, this.m);
    }
    this.chips.instanceMatrix.needsUpdate = true;
    // Once everything has landed and faded, stop touching the buffer until the next burst.
    this.alive = alive;
    if (!alive) this.settled = true;
    (this.chips.material as THREE.MeshBasicMaterial).color.setScalar(0.3 + 0.7 * daylight);
  }
}
