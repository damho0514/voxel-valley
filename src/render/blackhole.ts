import * as THREE from 'three';
import { glowTexture } from './textures';

/** A hot accretion disk texture: white-hot inside, through gold and orange, fading to nothing. */
function diskTexture(): THREE.DataTexture {
  const n = 256, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      // RingGeometry UVs map (0.5,0.5) to the centre; radius 0..0.5 across the ring.
      const dx = x / n - 0.5, dy = y / n - 0.5;
      const r = Math.hypot(dx, dy) * 2; // 0 centre .. 1 edge
      const a = Math.atan2(dy, dx);
      const t = Math.max(0, Math.min(1, (r - 0.33) / 0.67)); // 0 inner rim .. 1 outer rim
      const streak = 0.75 + 0.25 * Math.sin(a * 9 + r * 40) * Math.sin(a * 3 - r * 17);
      const heat = (1 - t) ** 1.6;
      const R = 255, G = 120 + 135 * heat, B = 40 + 215 * heat ** 3;
      const alpha = Math.max(0, Math.min(1, (1 - t) * 1.4)) * streak * (r < 0.33 ? 0 : 1);
      const o = (y * n + x) * 4;
      data[o] = R; data[o + 1] = Math.min(255, G); data[o + 2] = Math.min(255, B); data[o + 3] = Math.min(255, alpha * 255);
    }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A black hole: a pitch-black event horizon, a thin blazing photon ring, a spinning accretion
 * disk seen nearly edge-on, and a lensed copy of the disk arching over and under the shadow.
 */
export class BlackHole {
  readonly group = new THREE.Group();
  private readonly disk: THREE.Mesh;
  private readonly lensed: THREE.Mesh;
  private t = 0;

  constructor(x: number, y: number, z: number, r: number) {
    this.group.position.set(x, y, z);
    const additive = (map: THREE.Texture, opacity = 1) =>
      new THREE.MeshBasicMaterial({ map, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const tex = diskTexture();

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(0xffd9a0, 0xff7a30), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.55 }));
    halo.scale.set(r * 9, r * 9, 1);
    this.group.add(halo);

    this.disk = new THREE.Mesh(new THREE.RingGeometry(r * 1.25, r * 4.2, 128, 1), additive(tex));
    this.disk.rotation.x = Math.PI / 2 - 0.22; // almost edge-on
    this.group.add(this.disk);

    // The far side of the disk, bent by gravity into a ring around the shadow.
    this.lensed = new THREE.Mesh(new THREE.RingGeometry(r * 1.12, r * 1.9, 128, 1), additive(tex, 0.85));
    this.group.add(this.lensed);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.06, r * 0.035, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0xfff4dc, blending: THREE.AdditiveBlending, transparent: true, fog: false }));
    this.group.add(ring);

    const horizon = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 24), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    this.group.add(horizon);
    // The photon ring and the lensed disk always face the viewer.
    this.group.userData.faceCamera = [ring, this.lensed];
  }

  update(dt: number, camera: THREE.Camera) {
    this.t += dt;
    this.disk.rotation.z += dt * 0.35;
    this.lensed.rotation.z -= dt * 0.25;
    for (const m of this.group.userData.faceCamera as THREE.Object3D[]) {
      const spin = m === this.lensed ? m.rotation.z : 0;
      m.lookAt(camera.position);
      m.rotation.z = spin;
    }
  }
}
