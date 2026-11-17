import type { Vec3Like } from './dustMath';

/** Effect 10: a quick pop, spinning pickup swoosh, then white-gold twinkle burst. */
export const COIN_PICKUP_SECONDS = 1.32;
export const COIN_SPARKLE_COUNT = 12;

export interface CoinPickupCue {
  /** Immutable snapshot of the world-space pickup position. */
  readonly position: Readonly<Vec3Like>;
  readonly lifetime: number;
}

/** Mutable, caller-owned result; never allocate a frame while animating. */
export interface CoinPickupFrame {
  coinX: number;
  coinY: number;
  coinZ: number;
  coinScale: number;
  coinSpin: number;
  coinTilt: number;
  ringOpacity: number;
  ringScale: number;
  ringAngle: number;
  starX: number;
  starY: number;
  starZ: number;
  sparkleOpacity: number;
  scatter: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smooth(a: number, b: number, value: number): number {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Validate *before* acquiring a pooled instance. Positions are Y-up. */
export function makeCoinPickupCue(position: Vec3Like): CoinPickupCue {
  if (!position || !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
    throw new RangeError('Coin pickup position must contain finite x, y and z');
  }
  return {
    position: { x: position.x, y: position.y, z: position.z },
    lifetime: COIN_PICKUP_SECONDS,
  };
}

export function makeCoinPickupFrame(): CoinPickupFrame {
  return {
    coinX: 0, coinY: 0, coinZ: 0, coinScale: 0, coinSpin: 0,
    coinTilt: 0, ringOpacity: 0, ringScale: 0, ringAngle: 0,
    starX: 0, starY: 0, starZ: 0, sparkleOpacity: 0, scatter: 0,
  };
}

/**
 * Read-only age sampling. `target` is a world-space point (e.g. a goat's
 * chest anchor); omitted targets give a short upward/rightward pickup hop.
 * A caller can refresh a moving target before each sample. The same age and
 * target always yield exactly the same pose regardless of frame increments.
 */
export function sampleCoinPickup(
  cue: CoinPickupCue, age: number, out: CoinPickupFrame,
  target?: Vec3Like,
): CoinPickupFrame | null {
  if (!Number.isFinite(age) || age < 0 || age >= cue.lifetime) return null;
  const p = cue.position;
  const tx = target ? target.x : p.x + 0.65;
  const ty = target ? target.y : p.y + 0.55;
  const tz = target ? target.z : p.z;
  if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz)) {
    throw new RangeError('Coin pickup target must contain finite x, y and z');
  }

  const travel = smooth(0.16, 0.72, age);
  const pop = smooth(0, 0.13, age);
  const settle = smooth(0.16, 0.31, age);
  const vanish = 1 - smooth(0.66, 0.80, age);

  out.coinX = p.x + (tx - p.x) * travel;
  out.coinY = p.y + (ty - p.y) * travel +
    0.43 * Math.sin(Math.PI * travel) + 0.13 * Math.sin(Math.PI * smooth(0, 0.30, age));
  out.coinZ = p.z + (tz - p.z) * travel;
  out.coinScale = (0.67 + 0.53 * pop - 0.20 * settle) * vanish;
  out.coinSpin = 0.27 + age * 16.7; // spin about Y, preserving a readable hoof face early
  out.coinTilt = -0.10 + 0.24 * Math.sin(age * 8.0);

  out.ringOpacity = smooth(0.08, 0.24, age) *
    (1 - smooth(0.53, 0.76, age));
  out.ringScale = 0.79 + 0.40 * smooth(0.13, 0.60, age);
  out.ringAngle = age * 8.4;
  out.starX = tx;
  out.starY = ty;
  out.starZ = tz;
  out.sparkleOpacity = smooth(0.59, 0.75, age) *
    (1 - smooth(1.04, COIN_PICKUP_SECONDS, age));
  out.scatter = smooth(0.59, 1.02, age);
  return out;
}
