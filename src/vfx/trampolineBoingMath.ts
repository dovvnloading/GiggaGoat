import type { Vec3Like } from './dustMath';

/** Pure, absolute-age visuals for panel 06. +Y is up; position is ground center. */
export interface TrampolineBoingBurst {
  readonly position: Vec3Like;
  /** Bounded visual dimensions, not the physics body's size. */
  readonly scale: number;
  readonly strength: number;
  readonly lifetime: number;
}

/** Mutable sample owned by the caller; sampling never allocates. */
export interface TrampolineBoingFrame {
  matDip: number;
  arrowOpacity: number;
  burstOpacity: number;
  burstHeight: number;
  arcOpacity: number;
  arcHeight: number;
  /** Local +Y preview offset for a goat standing on the center of the mat.
   *  This is art direction only, not a gameplay impulse. */
  goatLift: number;
}

export const TRAMPOLINE_MAT_Y = 0.54;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const smoothstep = (a: number, b: number, n: number): number => {
  const t = clamp01((n - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function makeTrampolineBoingFrame(): TrampolineBoingFrame {
  return {
    matDip: 0, arrowOpacity: 0, burstOpacity: 0, burstHeight: 0,
    arcOpacity: 0, arcHeight: 0, goatLift: 0,
  };
}

/** A zero scale or strength is an intentional no-op; positive values are capped. */
export function makeTrampolineBoingBurst(
  position: Vec3Like, scale: number, strength: number,
): TrampolineBoingBurst | null {
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new RangeError('Trampoline position must be finite');
  }
  if (!Number.isFinite(scale) || scale < 0 ||
      !Number.isFinite(strength) || strength < 0) {
    throw new RangeError('Trampoline scale and strength must be finite and non-negative');
  }
  if (scale === 0 || strength === 0) return null;
  const cappedStrength = Math.min(strength, 4);
  return {
    position: { x: position.x, y: position.y, z: position.z },
    scale: Math.min(scale, 4),
    strength: cappedStrength,
    lifetime: 1.36 + 0.16 * Math.sqrt(cappedStrength),
  };
}

/**
 * At rest -> downward compression -> hard upward spring + yellow rim rays ->
 * climbing goat with trailing purple arcs -> fade/rest.
 * All expressions are functions of absolute age, not summed frame deltas.
 * Use a preallocated 'out' every frame (no temporary objects or arrays).
 */
export function sampleTrampolineBoing(
  burst: TrampolineBoingBurst, age: number, out: TrampolineBoingFrame,
): TrampolineBoingFrame | null {
  if (!Number.isFinite(age) || age < 0 || age >= burst.lifetime) return null;
  const t = age / burst.lifetime;
  const power = Math.sqrt(burst.strength);
  const compress = smoothstep(0.015, 0.20, t) *
    (1 - smoothstep(0.25, 0.39, t));
  const overshoot = smoothstep(0.36, 0.43, t) *
    (1 - smoothstep(0.46, 0.57, t));
  out.matDip = (0.20 + 0.095 * power) * compress - 0.060 * power * overshoot;
  out.arrowOpacity = smoothstep(0.025, 0.12, t) *
    (1 - smoothstep(0.27, 0.36, t));
  out.burstOpacity = smoothstep(0.295, 0.365, t) *
    (1 - smoothstep(0.57, 0.76, t));
  out.burstHeight = 0.36 + (0.55 + 0.19 * power) * smoothstep(0.32, 0.49, t);
  out.arcOpacity = smoothstep(0.40, 0.52, t) *
    (1 - smoothstep(0.76, 0.95, t));
  out.arcHeight = 0.38 + (0.56 + 0.10 * power) * smoothstep(0.40, 0.68, t);
  // The lab can position its existing goat, while gameplay controls real flight.
  const flight = clamp01((t - 0.34) / 0.66);
  out.goatLift = t < 0.34
    ? (out.matDip === 0 ? 0 : -out.matDip * 0.88)
    : (1.45 + 0.50 * power) * Math.pow(Math.sin(Math.PI * flight), 0.87);
  return out;
}
