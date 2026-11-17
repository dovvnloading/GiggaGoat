/** Deterministic, absolute-age timeline for effect 09. No Three/DOM dependency. */
export type GrowthTier = 0 | 1 | 2 | 3;
export const GROWTH_TIER_SCALES = [0.6, 1, 1.6, 3] as const;
export const GROWTH_BURST_SECONDS = [0, 1.18, 1.46, 1.96] as const;

export interface GrowthAuraFrame {
  radius: number;
  height: number;
  ring: number;
  pillars: number;
  ribbons: number;
  motes: number;
  flare: number;
  twist: number;
}

export function assertGrowthTier(tier: number): asserts tier is GrowthTier {
  if (!Number.isInteger(tier) || tier < 0 || tier > 3) {
    throw new RangeError('Growth tier must be an integer from 0 (Kid) to 3 (GIGGA)');
  }
}

export function makeGrowthAuraFrame(): GrowthAuraFrame {
  return { radius: 0, height: 0, ring: 0, pillars: 0, ribbons: 0,
    motes: 0, flare: 0, twist: 0 };
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Burst: hoof ring first, then rising beams/spirals, GIGGA flash, and fade. */
export function sampleGrowthBurst(
  tier: GrowthTier, age: number, out: GrowthAuraFrame,
): GrowthAuraFrame | null {
  assertGrowthTier(tier);
  if (!Number.isFinite(age) || age < 0 || tier === 0 ||
      age >= GROWTH_BURST_SECONDS[tier]) return null;
  const p = age / GROWTH_BURST_SECONDS[tier];
  const fade = 1 - smooth(0.76, 1, p);
  const lift = smooth(0.065, 0.34, p);
  const peak = smooth(0.27, 0.53, p) * (1 - smooth(0.69, 0.86, p));
  const scale = GROWTH_TIER_SCALES[tier];
  out.radius = 0.77 * scale + 0.08;
  out.height = 1.38 * scale;
  out.ring = smooth(0, 0.085, p) * fade * (0.75 + 0.25 * peak);
  out.pillars = lift * fade * (0.42 + 0.5 * peak);
  out.ribbons = smooth(0.10, 0.34, p) * fade * (0.50 + 0.50 * peak);
  out.motes = smooth(0.075, 0.25, p) * fade;
  out.flare = tier === 3 ? peak : 0;
  out.twist = age * 2.8;
  return out;
}

/** Subtle aura which remains alive indefinitely while the goat is GIGGA. */
export function sampleGiggaHold(age: number, out: GrowthAuraFrame): GrowthAuraFrame {
  if (!Number.isFinite(age) || age < 0) {
    throw new RangeError('GIGGA hold age must be finite and non-negative');
  }
  const breathe = Math.sin(age * 1.65);
  out.radius = 0.77 * GROWTH_TIER_SCALES[3] + 0.08;
  out.height = 1.38 * GROWTH_TIER_SCALES[3];
  out.ring = 0.27 + 0.07 * breathe;
  out.pillars = 0.12 + 0.025 * breathe;
  out.ribbons = 0.19 + 0.035 * breathe;
  out.motes = 0.34;
  out.flare = 0;
  out.twist = age * 0.72;
  return out;
}
