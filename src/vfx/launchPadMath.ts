import type { Vec3Like } from './dustMath';

/** Effect 07: ground-center contact, horizontal launch heading, cosmetic strength. */
export interface LaunchPadBurstCue {
  readonly position: Vec3Like;
  readonly direction: Vec3Like;
  readonly strength: number;
  readonly lifetime: number;
}

/** Caller-owned mutable output. Everything is sampled at absolute age. */
export interface LaunchPadBurstFrame {
  arrowGlow: number;
  fountainOpacity: number;
  fountainHeight: number;
  trailOpacity: number;
  flightProgress: number;
  /** Local-space preview position for the goat, relative to the pad center. */
  goatX: number;
  goatY: number;
  goatZ: number;
  goatPitch: number;
}

export const LAUNCH_PAD_TOP_Y = 0.30;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const smoothstep = (a: number, b: number, n: number): number => {
  const t = clamp01((n - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function makeLaunchPadBurstFrame(): LaunchPadBurstFrame {
  return {
    arrowGlow: 0, fountainOpacity: 0, fountainHeight: 0,
    trailOpacity: 0, flightProgress: 0,
    goatX: 0, goatY: LAUNCH_PAD_TOP_Y, goatZ: 0, goatPitch: 0,
  };
}

export function makeLaunchPadBurstCue(
  position: Vec3Like, direction: Vec3Like, strength: number,
): LaunchPadBurstCue | null {
  if (![position.x, position.y, position.z,
    direction.x, direction.y, direction.z].every(Number.isFinite)) {
    throw new RangeError('Launch pad position and direction must be finite');
  }
  if (!Number.isFinite(strength) || strength < 0) {
    throw new RangeError('Launch pad strength must be finite and non-negative');
  }
  if (strength === 0) return null;
  const horizontal = Math.hypot(direction.x, direction.z);
  const unitX = horizontal > 1e-7 ? direction.x / horizontal : 1;
  const unitZ = horizontal > 1e-7 ? direction.z / horizontal : 0;
  const capped = Math.min(4, strength);
  return {
    position: { x: position.x, y: position.y, z: position.z },
    direction: { x: unitX, y: 0, z: unitZ },
    strength: capped,
    lifetime: 1.40 + 0.12 * Math.sqrt(capped),
  };
}

/** Local +X trajectory for the *art preview*, not a physical impulse.
 * These two scalar helpers also feed the preallocated ribbon vertices. */
export function launchFlightX(strength: number, progress: number): number {
  const u = clamp01(progress);
  return (3.65 + 0.65 * Math.sqrt(strength)) * (1 - Math.pow(1 - u, 1.35));
}
export function launchFlightY(strength: number, progress: number): number {
  const u = clamp01(progress);
  return LAUNCH_PAD_TOP_Y + 0.17 +
    (2.00 + 0.54 * Math.sqrt(strength)) * Math.sin(u * Math.PI * 0.78) +
    0.27 * u;
}

/** Charge arrow -> upright gold fan -> long swept flight ribbons -> fade.
 * No arrays, temporary vectors, or frame objects are created here. */
export function sampleLaunchPadBurst(
  cue: LaunchPadBurstCue, age: number, out: LaunchPadBurstFrame,
): LaunchPadBurstFrame | null {
  if (!Number.isFinite(age) || age < 0 || age >= cue.lifetime) return null;
  const t = age / cue.lifetime;
  const power = Math.sqrt(cue.strength);
  out.arrowGlow = 0.25 + 0.75 * smoothstep(0.035, 0.15, t) *
    (1 - smoothstep(0.80, 0.99, t));
  out.fountainOpacity = smoothstep(0.085, 0.19, t) *
    (1 - smoothstep(0.39, 0.64, t));
  out.fountainHeight = 0.40 + (0.77 + 0.20 * power) *
    smoothstep(0.10, 0.31, t);
  out.trailOpacity = smoothstep(0.255, 0.38, t) *
    (1 - smoothstep(0.79, 0.99, t));
  const u = clamp01((t - 0.245) / 0.70);
  out.flightProgress = u;
  out.goatX = launchFlightX(cue.strength, u);
  out.goatY = launchFlightY(cue.strength, u);
  out.goatZ = 0;
  out.goatPitch = -0.28 * Math.sin(Math.PI * u) * smoothstep(0.04, 0.20, u);
  return out;
}
