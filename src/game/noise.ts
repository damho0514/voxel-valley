/** Deterministic integer-hash value noise (same on every device). */
export class Noise {
  constructor(private readonly seed: number) {}

  hash01(x: number, z: number, salt = 0): number {
    let h = (this.seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
    h = (h ^ Math.imul(x | 0, 0x85ebca6b)) >>> 0;
    h = ((h << 13) | (h >>> 19)) >>> 0;
    h = (h ^ Math.imul(z | 0, 0xc2b2ae35)) >>> 0;
    h = Math.imul(h, 0x27d4eb2f) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x165667b1) >>> 0;
    h ^= h >>> 13;
    return (h & 0xffffff) / 16777216;
  }

  value(x: number, z: number, salt = 0): number {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = this.hash01(x0, z0, salt), b = this.hash01(x0 + 1, z0, salt);
    const c = this.hash01(x0, z0 + 1, salt), d = this.hash01(x0 + 1, z0 + 1, salt);
    const ab = a + (b - a) * u, cd = c + (d - c) * u;
    return ab + (cd - ab) * v;
  }

  fractal(x: number, z: number, octaves: number, salt = 0): number {
    let sum = 0, amp = 1, norm = 0, freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += this.value(x * freq, z * freq, salt + i * 31) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}
