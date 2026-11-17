import type { Vec3Like } from './dustMath';

/** Visual escalation: 4 is the maximal art tier, not a cap on the number displayed. */
export type ComboPopTier = 2 | 3 | 4;

export interface ComboPopCue {
  readonly position: Vec3Like;
  readonly count: number;
  readonly tier: ComboPopTier;
  readonly lifetime: number;
}

/** A caller-owned output frame. Sampling never creates an object. */
export interface ComboPopFrame {
  scaleX: number;
  scaleY: number;
  lift: number;
  opacity: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function smoothstep(a: number, b: number, value: number): number {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** 0 and 1 are not combos. Counts above four retain their real number in tier-four art. */
export function selectComboPopTier(count: number): ComboPopTier | null {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('Combo count must be a non-negative safe integer');
  }
  return count < 2 ? null : count === 2 ? 2 : count === 3 ? 3 : 4;
}

export function makeComboPopCue(position: Vec3Like, count: number): ComboPopCue | null {
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new RangeError('Combo position must contain finite coordinates');
  }
  const tier = selectComboPopTier(count);
  if (!tier) return null;
  return {
    position: { x: position.x, y: position.y, z: position.z },
    count,
    tier,
    lifetime: tier === 2 ? 1.10 : tier === 3 ? 1.22 : 1.36,
  };
}

export function makeComboPopFrame(): ComboPopFrame {
  return { scaleX: 0, scaleY: 0, lift: 0, opacity: 0 };
}

/**
 * An absolute-age squash/stretch spring: a fast overshoot, a counter-squash,
 * a short hold, then an upward drift and fade. Deterministic at any frame rate.
 */
export function sampleComboPop(
  cue: ComboPopCue, age: number, out: ComboPopFrame,
): ComboPopFrame | null {
  if (!Number.isFinite(age) || age < 0 || age >= cue.lifetime) return null;
  const t = age / cue.lifetime;
  const spring = 1 - Math.exp(-18 * t) * Math.cos(32 * t);
  const squash = 0.33 * Math.exp(-13 * t) * Math.sin(42 * t);
  out.scaleX = Math.max(0, spring * (1 + squash));
  out.scaleY = Math.max(0, spring * (1 - squash));
  out.lift = 0.06 * smoothstep(0, 0.22, t) +
    (cue.tier === 4 ? 0.75 : 0.56) * smoothstep(0.34, 1, t);
  out.opacity = smoothstep(0, 0.035, t) * (1 - smoothstep(0.65, 0.995, t));
  return out;
}
