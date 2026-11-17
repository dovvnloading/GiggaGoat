import { groundDirection, type Vec3Like } from './dustMath';

/** Pure, absolute-time CRATE BREAK DEBRIS animation. +Y up, XZ ground. */
export interface CrateBreakBurst {
  /** World-space crate base center (ground contact). */
  readonly position: Vec3Like;
  /** Horizontal direction of the incoming impact, normalized. */
  readonly direction: Vec3Like;
  /** Crate side length in world units, capped at 3. */
  readonly size: number;
  readonly lifetime: number;
}

export interface CrateBreakFrame {
  readonly crateOpacity: number;
  readonly crackOpacity: number;
  readonly flashOpacity: number;
  readonly flashSize: number;
  readonly debrisOpacity: number;
  readonly dustOpacity: number;
}

export interface CrateFragmentFrame {
  /** World-space displacement from the crate's ground contact. */
  readonly offset: Vec3Like;
  /** Euler rotation in radians. */
  readonly rotation: Vec3Like;
  readonly opacity: number;
  /** Relative size of a wooden shard (before multiplying by crate size). */
  readonly scale: number;
}

export interface CrateDustFrame {
  readonly offset: Vec3Like;
  readonly diameter: number;
  readonly opacity: number;
}

export const CRATE_PLANK_COUNT = 7;
export const CRATE_CHIP_COUNT = 11;
export const CRATE_DUST_COUNT = 5;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const smoothstep = (a: number, b: number, value: number): number => {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Finite inputs only; a zero-size crate emits nothing. A vertical/zero impact uses +X. */
export function makeCrateBreakBurst(
  position: Vec3Like,
  impactDirection: Vec3Like,
  crateSize: number,
): CrateBreakBurst | null {
  if (![position.x, position.y, position.z,
    impactDirection.x, impactDirection.y, impactDirection.z].every(Number.isFinite)) {
    throw new RangeError('Crate position and impact direction must have finite coordinates');
  }
  if (!Number.isFinite(crateSize) || crateSize < 0) {
    throw new RangeError('Crate size must be finite and non-negative');
  }
  if (crateSize === 0) return null;
  const size = Math.min(crateSize, 3);
  return {
    position: { x: position.x, y: position.y, z: position.z },
    direction: groundDirection(impactDirection),
    size,
    lifetime: 0.88 + 0.09 * Math.sqrt(size),
  };
}

/** Intact -> cracked -> golden strike -> scattering wood -> disappearing dust. */
export function sampleCrateBreak(
  burst: CrateBreakBurst,
  age: number,
): CrateBreakFrame | null {
  if (!Number.isFinite(age) || age < 0 || age >= burst.lifetime) return null;
  const t = age / burst.lifetime;
  return {
    crateOpacity: 1 - smoothstep(0.11, 0.20, t),
    crackOpacity: smoothstep(0.025, 0.10, t) * (1 - smoothstep(0.15, 0.21, t)),
    flashOpacity: smoothstep(0.12, 0.16, t) * (1 - smoothstep(0.32, 0.49, t)),
    flashSize: burst.size * (0.26 + 1.07 * smoothstep(0.12, 0.32, t)),
    debrisOpacity: smoothstep(0.17, 0.23, t) * (1 - smoothstep(0.78, 1, t)),
    dustOpacity: smoothstep(0.17, 0.28, t) * (1 - smoothstep(0.66, 0.96, t)),
  };
}

/**
 * Preselected irregular fan; planks carry most of the silhouette, while tiny
 * chips scatter farther. No randomness, physics impulses or time integration.
 */
export function sampleCrateFragment(
  burst: CrateBreakBurst,
  kind: 'plank' | 'chip',
  index: number,
  age: number,
): CrateFragmentFrame | null {
  const count = kind === 'plank' ? CRATE_PLANK_COUNT : CRATE_CHIP_COUNT;
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError('Crate fragment index is out of bounds');
  }
  const frame = sampleCrateBreak(burst, age);
  if (!frame || frame.debrisOpacity <= 0.001) return null;
  const t = age / burst.lifetime;
  const flight = Math.max(0, (t - 0.17) * 0.97);
  const side = kind === 'plank'
    ? [-1.10, -0.64, -0.18, 0.35, 0.82, 1.12, -0.46][index]!
    : Math.sin(index * 2.4) * (0.63 + (index % 3) * 0.25);
  const forward = kind === 'plank'
    ? [0.26, 0.78, 1.06, 0.42, 0.92, 0.33, -0.36][index]!
    : 0.10 + (index % 5) * 0.31;
  const spin = (index % 2 ? -1 : 1);
  const lift = kind === 'plank'
    ? 1.65 + (index % 4) * 0.31
    : 1.12 + (index % 5) * 0.38;
  const gravity = kind === 'plank' ? 6.0 : 7.7;
  const height = kind === 'plank' ? 0.47 : 0.39;
  // A small piece never tunnels under the ground; it settles until fadeout.
  const y = Math.max(kind === 'plank' ? 0.055 : 0.025,
    height + lift * flight - 0.5 * gravity * flight * flight);
  const lateral = side * flight * (kind === 'plank' ? 1.45 : 1.8);
  const travel = forward * flight * (kind === 'plank' ? 1.55 : 1.75);
  const dx = burst.direction.x;
  const dz = burst.direction.z;
  return {
    offset: {
      x: burst.size * (dx * travel - dz * lateral),
      y: burst.size * y,
      z: burst.size * (dz * travel + dx * lateral),
    },
    rotation: {
      x: spin * (0.25 * index + flight * (2.4 + index * 0.19)),
      y: index * 0.59 + flight * spin * 3.1,
      z: spin * (0.18 * index + flight * (4.2 + (index % 3))),
    },
    opacity: frame.debrisOpacity,
    scale: kind === 'plank' ? 1 : 0.050 + (index % 4) * 0.019,
  };
}

/** Five low apricot dust lobes at the crate base, drifting opposite the hit. */
export function sampleCrateDust(
  burst: CrateBreakBurst,
  index: number,
  age: number,
): CrateDustFrame | null {
  if (!Number.isInteger(index) || index < 0 || index >= CRATE_DUST_COUNT) {
    throw new RangeError('Crate dust index is out of bounds');
  }
  const frame = sampleCrateBreak(burst, age);
  if (!frame || frame.dustOpacity <= 0.001) return null;
  const t = age / burst.lifetime;
  const drift = Math.max(0, t - 0.17);
  const side = (index - 2) * 0.19;
  const back = -0.12 - (index % 3) * 0.13 - drift * 0.31;
  return {
    offset: {
      x: burst.size * (burst.direction.x * back - burst.direction.z * side),
      y: burst.size * (0.12 + (index % 2) * 0.10 + drift * 0.42),
      z: burst.size * (burst.direction.z * back + burst.direction.x * side),
    },
    diameter: burst.size * (0.21 + (index % 3) * 0.13 + drift * 0.39),
    opacity: frame.dustOpacity * (0.58 + (index % 3) * 0.11),
  };
}
