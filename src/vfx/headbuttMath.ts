import type { Vec3Like } from './dustMath';

/** +Y is up. Headbutt travel is projected onto the XZ ground plane. */
export interface HeadbuttBurst {
  readonly position: Vec3Like;
  readonly direction: Vec3Like;
  /** Bounded power in (0, 4]; a zero-power hit does not emit. */
  readonly power: number;
  readonly size: number;
  readonly lifetime: number;
}

export interface HeadbuttFlashFrame {
  readonly scale: number;
  readonly opacity: number;
}

export interface HeadbuttStarFrame {
  /** Offset from the contact point, in world coordinates. */
  readonly offset: Vec3Like;
  readonly scale: number;
  readonly opacity: number;
  readonly rotation: number;
}

export const HEADBUTT_STAR_COUNT = 3;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const smoothstep = (a: number, b: number, n: number): number => {
  const t = clamp01((n - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Validated, detached values; zero heading faces +X like running dust. */
export function makeHeadbuttBurst(
  position: Vec3Like,
  direction: Vec3Like,
  power: number,
): HeadbuttBurst | null {
  if (![position.x, position.y, position.z, direction.x, direction.y, direction.z]
    .every(Number.isFinite)) {
    throw new RangeError('Headbutt position and direction must be finite');
  }
  if (!Number.isFinite(power) || power < 0) {
    throw new RangeError('Headbutt power must be finite and non-negative');
  }
  if (power === 0) return null;
  const length = Math.hypot(direction.x, direction.z);
  const strength = Math.sqrt(Math.min(4, power));
  return {
    position: { x: position.x, y: position.y, z: position.z },
    direction: length > 1e-8
      ? { x: direction.x / length, y: 0, z: direction.z / length }
      : { x: 1, y: 0, z: 0 },
    power: Math.min(4, power),
    size: 0.54 + 0.51 * strength,
    lifetime: 0.43 + 0.09 * strength,
  };
}

/** Small ivory spark -> expanding eight-point burst -> rapid disappearance. */
export function sampleHeadbuttFlash(
  burst: HeadbuttBurst,
  age: number,
): HeadbuttFlashFrame | null {
  if (!Number.isFinite(age) || age < 0 || age >= burst.lifetime) return null;
  const t = age / burst.lifetime;
  return {
    scale: burst.size * (0.32 + 0.92 * smoothstep(0, 0.34, t)) *
      (1 - 0.17 * smoothstep(0.52, 1, t)),
    opacity: 1 - smoothstep(0.41, 0.73, t),
  };
}

/** Three outlined gold stars eject forwards/up, then shrink/fade away. */
export function sampleHeadbuttStar(
  burst: HeadbuttBurst,
  index: number,
  age: number,
): HeadbuttStarFrame | null {
  if (!Number.isInteger(index) || index < 0 || index >= HEADBUTT_STAR_COUNT) {
    throw new RangeError('Headbutt star index is out of bounds');
  }
  if (!Number.isFinite(age) || age < 0 || age >= burst.lifetime) return null;
  const t = age / burst.lifetime;
  if (t < 0.23) return null;
  const opacity = smoothstep(0.23, 0.35, t) * (1 - smoothstep(0.72, 1, t));
  if (opacity <= 0.001) return null;
  const travel = smoothstep(0.25, 0.93, t);
  const forward = [0.47, 0.79, 0.62][index]!;
  const side = [-0.31, 0.20, 0.39][index]!;
  const height = [0.60, 1.01, 0.43][index]!;
  const dx = burst.direction.x;
  const dz = burst.direction.z;
  const spread = Math.sqrt(burst.power);
  return {
    offset: {
      x: dx * (0.11 + spread * forward * travel) - dz * side * spread * travel,
      y: spread * (height * travel + 0.19 * Math.sin(Math.PI * travel)),
      z: dz * (0.11 + spread * forward * travel) + dx * side * spread * travel,
    },
    scale: burst.size * [0.40, 0.30, 0.25][index]! *
      (0.70 + 0.45 * smoothstep(0.24, 0.51, t)) *
      (1 - 0.22 * smoothstep(0.79, 1, t)),
    opacity,
    rotation: (index - 1) * 0.30 + (index % 2 === 0 ? 1 : -1) * travel * 0.90,
  };
}
