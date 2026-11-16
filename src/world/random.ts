/** Small reproducible generators; no Math.random or platform-dependent trig for hashes. */
export function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 16777619) >>> 0;
  }
  return h;
}

export class SeededRandom {
  private state: number;
  constructor(seed: string | number) { this.state = hashString(String(seed)); }
  /** Mulberry32: one unsigned 32-bit step per sample. */
  next(): number {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number { return min + (max - min) * this.next(); }
  int(min: number, maxExclusive: number): number { return Math.floor(this.range(min, maxExclusive)); }
  pick<T>(values: readonly T[]): T {
    const value = values[this.int(0, values.length)];
    if (value === undefined) throw new Error('Cannot pick from an empty array');
    return value;
  }
}

export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}
export function smoothstep(a: number, b: number, value: number): number {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/** Integer-hashed gradient noise (not a dependency on simplex/perlin packages). */
export class GradientNoise {
  constructor(private readonly seed: number) {}
  private gradient(ix: number, iz: number): { x: number; z: number } {
    let h = Math.imul(ix, 0x9e3779b1) ^ Math.imul(iz, 0x85ebca6b) ^ this.seed;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    h ^= h >>> 16;
    // Eight unit-ish lattice gradients; stable at negative coordinates.
    const directions = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [0.70710678118, 0.70710678118], [-0.70710678118, 0.70710678118],
      [0.70710678118, -0.70710678118], [-0.70710678118, -0.70710678118],
    ] as const;
    const v = directions[(h >>> 0) & 7]!;
    return { x: v[0], z: v[1] };
  }
  sample(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const dot = (dx: number, dz: number): number => {
      const g = this.gradient(ix + dx, iz + dz);
      return g.x * (fx - dx) + g.z * (fz - dz);
    };
    const u = smoothstep(0, 1, fx), v = smoothstep(0, 1, fz);
    return lerp(lerp(dot(0, 0), dot(1, 0), u),
      lerp(dot(0, 1), dot(1, 1), u), v) * 1.41421356237;
  }
  fractal(x: number, z: number, octaves = 4): number {
    let value = 0, amplitude = 1, frequency = 1, weight = 0;
    for (let i = 0; i < octaves; i++) {
      value += this.sample(x * frequency, z * frequency) * amplitude;
      weight += amplitude;
      frequency *= 2;
      amplitude *= 0.5;
    }
    return value / weight;
  }
}
