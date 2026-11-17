import type { Vec3Like } from './dustMath';

/** All measurements are in world units, with +Y up and XZ as the ground. */
export interface LandingRingBurst {
  readonly position: Vec3Like;
  /** Validated, capped impact strength; zero strength never creates a burst. */
  readonly strength: number;
  readonly radius: number;
  readonly lifetime: number;
}

export interface LandingRingFrame {
  readonly radius: number;
  readonly ringOpacity: number;
  readonly glowOpacity: number;
  readonly spikeOpacity: number;
  readonly spikeHeight: number;
  readonly debrisOpacity: number;
}

export interface LandingDebrisFrame {
  /** Position relative to the landing contact point, not an absolute world position. */
  readonly offset: Vec3Like;
  readonly scale: number;
}

export const LANDING_DEBRIS_COUNT = 8;
const TAU = Math.PI * 2;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const smoothstep = (a: number, b: number, n: number): number => {
  const t = clamp01((n - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Create a single grounded shockwave. `strength=0` is an intentional no-op. */
export function makeLandingRingBurst(
  position: Vec3Like,
  strength: number,
): LandingRingBurst | null {
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new RangeError('Landing position must have finite coordinates');
  }
  if (!Number.isFinite(strength) || strength < 0) {
    throw new RangeError('Landing strength must be finite and non-negative');
  }
  if (strength === 0) return null;
  // Diminishing returns keep a huge gameplay impulse visually bounded.
  const power = Math.sqrt(Math.min(4, strength));
  return {
    position: { x: position.x, y: position.y, z: position.z },
    strength: Math.min(4, strength),
    radius: 0.68 + 0.75 * power,
    lifetime: 0.38 + 0.12 * power,
  };
}

/** Absolute-age sampling: no integration drift across different frame rates. */
export function sampleLandingRing(
  burst: LandingRingBurst,
  age: number,
): LandingRingFrame | null {
  if (!Number.isFinite(age) || age < 0 || age >= burst.lifetime) return null;
  const t = age / burst.lifetime;
  const fade = 1 - smoothstep(0.62, 1, t);
  return {
    // Thin initial outline -> broad, ground-hugging impact ring.
    radius: burst.radius * (0.31 + 0.69 * smoothstep(0, 0.68, t)),
    ringOpacity: (0.37 + 0.63 * smoothstep(0, 0.18, t)) * fade,
    glowOpacity: (0.14 + 0.58 * smoothstep(0.03, 0.30, t)) * fade,
    // Sharp golden teeth arrive after the initial, cream-colored outline.
    spikeOpacity: smoothstep(0.09, 0.34, t) * (1 - smoothstep(0.63, 1, t)),
    spikeHeight: 0.25 + 0.75 * smoothstep(0.09, 0.48, t),
    debrisOpacity: smoothstep(0.02, 0.15, t) * (1 - smoothstep(0.52, 0.84, t)),
  };
}

/** Eight lightweight, deterministic sandstone chips flying up and away. */
export function sampleLandingDebris(
  burst: LandingRingBurst,
  index: number,
  age: number,
): LandingDebrisFrame | null {
  if (!Number.isInteger(index) || index < 0 || index >= LANDING_DEBRIS_COUNT) {
    throw new RangeError('Landing debris index is out of bounds');
  }
  const frame = sampleLandingRing(burst, age);
  if (!frame || frame.debrisOpacity <= 0.001) return null;
  const t = age / burst.lifetime;
  const heading = index * (TAU / LANDING_DEBRIS_COUNT) + Math.sin(index * 2.1) * 0.18;
  const spread = burst.radius * (0.28 + (0.66 + (index % 3) * 0.12) * t);
  const lift = (0.29 + (index % 4) * 0.10) * Math.sin(Math.PI * Math.min(1, t / 0.87));
  return {
    offset: {
      x: Math.cos(heading) * spread,
      y: 0.04 + lift * Math.sqrt(burst.strength),
      z: Math.sin(heading) * spread,
    },
    scale: (0.9 + (index % 4) * 0.18) * Math.sqrt(burst.strength) *
      (1 - smoothstep(0.58, 0.85, t)),
  };
}
