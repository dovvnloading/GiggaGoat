import type { Vec3Like } from './dustMath';

/** Pure, absolute-time animation for panel four: ripple -> crown -> droplets. */
export interface WaterSplashBurst {
  readonly position: Vec3Like;
  /** Clamped entry speed (world units/second) and relative mass (1 = goat-sized). */
  readonly speed: number;
  readonly mass: number;
  readonly radius: number;
  readonly height: number;
  readonly lifetime: number;
}

export interface WaterSplashFrame {
  readonly rippleRadius: number;
  readonly rippleOpacity: number;
  readonly haloOpacity: number;
  readonly crownRadius: number;
  readonly crownHeight: number;
  readonly crownOpacity: number;
  readonly foamOpacity: number;
}

export interface WaterDropletFrame {
  /** Relative to the surface contact; positive Y is up. */
  readonly offset: Vec3Like;
  readonly size: number;
  readonly opacity: number;
  readonly rotation: number;
}

export const WATER_DROPLET_COUNT = 12;
const TAU = Math.PI * 2;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const smoothstep = (a: number, b: number, n: number): number => {
  const t = clamp01((n - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Non-moving or massless contact is silent; invalid values always throw. */
export function makeWaterSplashBurst(
  position: Vec3Like,
  speed: number,
  mass: number,
): WaterSplashBurst | null {
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new RangeError('Water splash position must be finite');
  }
  if (!Number.isFinite(speed) || speed < 0 || !Number.isFinite(mass) || mass < 0) {
    throw new RangeError('Water splash speed and mass must be finite and non-negative');
  }
  if (speed === 0 || mass === 0) return null;
  const cappedSpeed = Math.min(speed, 16);
  const cappedMass = Math.min(mass, 8);
  const velocityScale = Math.sqrt(cappedSpeed / 6);
  const volumeScale = Math.sqrt(cappedMass / 1.5);
  return {
    position: { x: position.x, y: position.y, z: position.z },
    speed: cappedSpeed,
    mass: cappedMass,
    // More mass yields a broader crown; more speed sends the jets higher.
    radius: 0.32 + 0.85 * volumeScale * (0.65 + 0.35 * velocityScale),
    height: 0.24 + 0.84 * velocityScale * (0.75 + 0.25 * volumeScale),
    lifetime: 0.58 + 0.10 * Math.min(2.2, (velocityScale + volumeScale) / 2),
  };
}

/** First a blue concentric ripple, then a rising cyan crown that collapses. */
export function sampleWaterSplash(
  burst: WaterSplashBurst,
  age: number,
): WaterSplashFrame | null {
  if (!Number.isFinite(age) || age < 0 || age >= burst.lifetime) return null;
  const t = age / burst.lifetime;
  const rise = smoothstep(0.08, 0.56, t);
  const fade = 1 - smoothstep(0.65, 1, t);
  return {
    rippleRadius: burst.radius * (0.36 + 0.80 * smoothstep(0, 0.92, t)),
    rippleOpacity: (0.84 - 0.17 * t) * (1 - smoothstep(0.70, 1, t)),
    haloOpacity: (0.35 + 0.23 * smoothstep(0, 0.30, t)) * fade,
    crownRadius: burst.radius * (0.38 + 0.48 * rise),
    crownHeight: burst.height * (0.10 + 0.90 * rise) *
      (1 - 0.35 * smoothstep(0.75, 1, t)),
    crownOpacity: smoothstep(0.07, 0.19, t) * (1 - smoothstep(0.68, 1, t)),
    foamOpacity: smoothstep(0.11, 0.30, t) * (1 - smoothstep(0.74, 1, t)),
  };
}

/** Fixed radial pattern; each glossy teardrop flies up/out on a short arc. */
export function sampleWaterDroplet(
  burst: WaterSplashBurst,
  index: number,
  age: number,
): WaterDropletFrame | null {
  if (!Number.isInteger(index) || index < 0 || index >= WATER_DROPLET_COUNT) {
    throw new RangeError('Water droplet index out of bounds');
  }
  if (!Number.isFinite(age) || age < 0 || age >= burst.lifetime) return null;
  const t = age / burst.lifetime;
  const start = 0.13 + (index % 4) * 0.032;
  const end = 0.84 + (index % 3) * 0.022;
  if (t < start || t >= end) return null;
  const travel = (t - start) / (end - start);
  const angle = index * TAU / WATER_DROPLET_COUNT + Math.sin(index * 3.2) * 0.24;
  const spread = burst.radius * (0.29 + 0.83 * travel) * (0.83 + (index % 4) * 0.10);
  const arc = 4.8 * travel * (1 - travel);
  const opacity = smoothstep(0, 0.14, travel) * (1 - smoothstep(0.70, 1, travel));
  if (opacity <= 0.001) return null;
  return {
    offset: {
      x: Math.cos(angle) * spread,
      y: burst.height * (0.13 + arc * (0.73 + (index % 5) * 0.10)),
      z: Math.sin(angle) * spread,
    },
    size: (0.12 + (index % 4) * 0.022) * Math.sqrt(burst.mass / 1.5) *
      (1 - 0.28 * travel),
    opacity,
    rotation: 0.17 * Math.sin(index * 1.7) + 0.30 * travel,
  };
}
