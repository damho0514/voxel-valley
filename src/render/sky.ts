import * as THREE from 'three';
import { glowTexture } from './textures';

const DOME = 130; // inside the camera's far plane
type Palette = { zenith: number; horizon: number };

/**
 * A gradient sky dome that follows the camera, a sun and a moon that track the time of day,
 * stars that come out at night, and a layer of soft drifting clouds.
 */
export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly sun: THREE.Sprite;
  private readonly moon: THREE.Sprite;
  private readonly stars: THREE.Points;
  private readonly clouds: THREE.InstancedMesh;
  private cloudCells: { x: number; z: number; w: number; d: number }[] = [];
  private drift = 0;
  private palette: Palette = { zenith: 0x5aa8e6, horizon: 0xd8eefa };
  horizonColor = new THREE.Color(0xd8eefa);

  constructor(private readonly scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(DOME, 32, 16);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    this.dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(0xfffbe8, 0xffd27a), fog: false, depthWrite: false, transparent: true }));
    this.sun.scale.set(34, 34, 1);
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(0xf4f6ff, 0x9fb4ff), fog: false, depthWrite: false, transparent: true }));
    this.moon.scale.set(20, 20, 1);
    this.sun.renderOrder = this.moon.renderOrder = -9;
    this.group.add(this.sun, this.moon);

    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 0.95 + 0.05, a = Math.random() * Math.PI * 2, r = DOME * 0.95;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
    this.stars.renderOrder = -9;
    this.group.add(this.stars);

    // Clouds: flat puffy slabs in a band high above, laid out once and drifted.
    for (let gx = -12; gx < 12; gx++)
      for (let gz = -12; gz < 12; gz++) {
        const h = Math.abs(Math.sin(gx * 12.9898 + gz * 78.233) * 43758.5453) % 1;
        if (h < 0.78) continue;
        this.cloudCells.push({ x: gx * 14, z: gz * 14, w: 10 + h * 16, d: 8 + ((h * 7) % 1) * 12 });
      }
    this.clouds = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, fog: false, depthWrite: false }), this.cloudCells.length);
    this.clouds.renderOrder = -8;
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

  /**
   * time: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight. daylight 0..1.
   * Returns the horizon colour (use it for fog and the clear colour).
   */
  update(camera: THREE.Camera, time: number, daylight: number, dt: number, night: THREE.Color) {
    this.group.position.copy(camera.position);
    const zen = new THREE.Color(this.palette.zenith), hor = new THREE.Color(this.palette.horizon);
    const nightZen = night.clone().multiplyScalar(0.7);
    zen.lerp(nightZen, 1 - daylight);
    hor.lerp(night, 1 - daylight);
    // Warm the horizon around sunrise and sunset.
    const dusk = Math.max(0, 1 - Math.abs(Math.sin(time * Math.PI * 2)) * 4) * (daylight > 0.2 ? 1 : 0);
    hor.lerp(new THREE.Color(0xffb38a), dusk * 0.55);
    const pos = this.dome.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.dome.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, Math.min(1, pos.getY(i) / DOME));
      const c = hor.clone().lerp(zen, Math.pow(t, 0.6));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    this.horizonColor.copy(hor);

    const a = time * Math.PI * 2; // sun rises in the east (+x), sets in the west
    const sunDir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.25).normalize();
    this.sun.position.copy(sunDir).multiplyScalar(DOME * 0.9);
    this.moon.position.copy(sunDir).multiplyScalar(-DOME * 0.9);
    this.sun.visible = sunDir.y > -0.1;
    this.moon.visible = sunDir.y < 0.1;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - daylight * 1.6);

    this.drift += dt * 1.2;
    const m = new THREE.Matrix4();
    const span = 24 * 14;
    this.cloudCells.forEach((c, i) => {
      // Positions relative to the camera, wrapped so the cloud field never runs out.
      let x = ((c.x + this.drift + span / 2) % span + span) % span - span / 2 - (camera.position.x % span);
      let z = ((c.z + span / 2) % span + span) % span - span / 2 - (camera.position.z % span);
      x = ((x + span / 2) % span + span) % span - span / 2;
      z = ((z + span / 2) % span + span) % span - span / 2;
      m.makeScale(c.w, 3, c.d);
      m.setPosition(x, 66 - camera.position.y, z);
      this.clouds.setMatrixAt(i, m);
    });
    this.clouds.instanceMatrix.needsUpdate = true;
    const k = 0.3 + 0.7 * daylight;
    const cm = this.clouds.material as THREE.MeshBasicMaterial;
    cm.color.setRGB(k, k, k * 1.03);
    cm.opacity = 0.25 + 0.6 * daylight; // thin, dim clouds at night so the stars show
    return hor;
  }
}
