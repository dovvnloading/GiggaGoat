/**
 * Renderer-independent motion for the RUNNING DUST PUFFS reference panel.
 * Units are Three.js world units, Y is up, and 'position' is a ground contact.
 * A burst forms a low, overlapping cream/tan cloud behind the running direction,
 * with a few fast-moving grit flecks. No randomness is used during update().
 */
export type Vec3Like = Readonly<{ x: number; y: number; z: number }>;
export type DustKind = 'puff' | 'fleck';

export interface DustParticle {
  readonly kind: DustKind;
  readonly origin: Vec3Like;
  readonly velocity: Vec3Like;
  /** Target radius, in world units (before the age-dependent swell). */
  readonly radius: number;
  readonly lifetime: number;
  readonly delay: number;
  readonly opacity: number;
  readonly rotation: number;
}

export interface DustFrame {
  readonly position: Vec3Like;
  readonly diameter: number;
  readonly opacity: number;
  readonly rotation: number;
}

const LOBES = [
  // Near the hoof: little puffs. Farther back: a round, rising cloud.
  { back: 0.10, side: -0.07, up: 0.11, radius: 0.15, delay: 0.00 },
  { back: 0.25, side:  0.14, up: 0.16, radius: 0.22, delay: 0.01 },
  { back: 0.38, side: -0.20, up: 0.20, radius: 0.26, delay: 0.03 },
  { back: 0.53, side:  0.06, up: 0.28, radius: 0.34, delay: 0.04 },
  { back: 0.65, side:  0.25, up: 0.17, radius: 0.28, delay: 0.05 },
  { back: 0.81, side: -0.05, up: 0.37, radius: 0.39, delay: 0.06 },
  { back: 0.94, side: -0.23, up: 0.14, radius: 0.27, delay: 0.08 },
  { back: 1.10, side:  0.18, up: 0.29, radius: 0.32, delay: 0.09 },
] as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (a: number, b: number, value: number): number => {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function checkVector(v: Vec3Like): void {
  if (![v.x, v.y, v.z].every(Number.isFinite)) {
    throw new RangeError('Dust position and direction must be finite');
  }
}

/** Normalize the horizontal component; stationary/vertical input uses +X. */
export function groundDirection(direction: Vec3Like): Vec3Like {
  checkVector(direction);
  const length = Math.hypot(direction.x, direction.z);
  return length < 1e-7
    ? { x: 1, y: 0, z: 0 }
    : { x: direction.x / length, y: 0, z: direction.z / length };
}

/** Repeatable, platform-independent PRNG for visual QA and tests. */
export function seededRandom(seed = 0x6a09e667): () => number {
  if (!Number.isFinite(seed)) throw new RangeError('Dust seed must be finite');
  let value = Math.trunc(seed) >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One hoof-strike worth of dust. The cloud is deliberately built from
 * individually rounded lobes rather than one uniformly scaled particle.
 * Directions are world-space travel directions, NOT where the dust should go.
 */
export function makeDustBurst(
  position: Vec3Like,
  direction: Vec3Like,
  random: () => number = Math.random,
): DustParticle[] {
  checkVector(position);
  const forward = groundDirection(direction);
  const side = { x: -forward.z, z: forward.x };
  const particles: DustParticle[] = [];

  for (const lobe of LOBES) {
    const back = lobe.back + (random() - 0.5) * 0.09;
    const lateral = lobe.side + (random() - 0.5) * 0.10;
    const radius = lobe.radius * (0.88 + random() * 0.24);
    const drift = (random() - 0.5) * 0.23;
    particles.push({
      kind: 'puff',
      origin: {
        x: position.x - forward.x * back + side.x * lateral,
        y: position.y + lobe.up + (random() - 0.5) * 0.045,
        z: position.z - forward.z * back + side.z * lateral,
      },
      velocity: {
        x: -forward.x * (0.22 + random() * 0.27) + side.x * drift,
        y: 0.19 + random() * 0.23,
        z: -forward.z * (0.22 + random() * 0.27) + side.z * drift,
      },
      radius,
      lifetime: 0.57 + random() * 0.20,
      delay: lobe.delay,
      opacity: 0.76 + random() * 0.13,
      rotation: (random() - 0.5) * 0.25,
    });
  }

  // Little chips and airborne dots curl away from the main soft cloud.
  for (let i = 0; i < 6; i++) {
    const back = 0.12 + random() * 1.28;
    const lateral = (random() - 0.5) * 0.85;
    const drift = (random() - 0.5) * 0.75;
    particles.push({
      kind: 'fleck',
      origin: {
        x: position.x - forward.x * back + side.x * lateral,
        y: position.y + 0.04 + random() * 0.23,
        z: position.z - forward.z * back + side.z * lateral,
      },
      velocity: {
        x: -forward.x * (0.45 + random() * 0.55) + side.x * drift,
        y: 0.24 + random() * 0.68,
        z: -forward.z * (0.45 + random() * 0.55) + side.z * drift,
      },
      radius: 0.025 + random() * 0.055,
      lifetime: 0.29 + random() * 0.24,
      delay: random() * 0.07,
      opacity: 0.66 + random() * 0.25,
      rotation: (random() - 0.5) * 1.5,
    });
  }

  return particles;
}

/**
 * Absolute-age sampling avoids numerical drift and gives the same result for
 * one large delta or many small deltas. null means not born or fully expired.
 */
export function sampleDustParticle(particle: DustParticle, age: number): DustFrame | null {
  if (!Number.isFinite(age) || age < particle.delay ||
      age >= particle.delay + particle.lifetime) return null;
  const elapsed = age - particle.delay;
  const t = elapsed / particle.lifetime;
  const grow = 0.48 + 1.04 * smoothstep(0, 0.62, t);
  const fade = smoothstep(0, 0.09, t) * (1 - smoothstep(0.50, 1, t));
  return {
    position: {
      x: particle.origin.x + particle.velocity.x * elapsed,
      y: particle.origin.y + particle.velocity.y * elapsed,
      z: particle.origin.z + particle.velocity.z * elapsed,
    },
    diameter: particle.radius * 2 * grow,
    opacity: particle.opacity * fade,
    rotation: particle.rotation + (particle.kind === 'fleck' ? elapsed * 0.9 : elapsed * 0.12),
  };
}
