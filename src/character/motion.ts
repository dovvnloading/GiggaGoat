/**
 * Pure, deterministic art controls. No Three.js, Rapier, DOM or wall-clock dependencies.
 * World/physics state is authoritative; these values drive ONLY the visual secondary rig.
 */
export const TIERS = ['KID', 'BILLY', 'BIG', 'GIGGA'] as const;
export type GoatTier = (typeof TIERS)[number];
export const ACTIONS = [
  'stand', 'sprint', 'jump-flip', 'headbutt', 'tongue-grab',
  'bleat', 'flop', 'wall-climb', 'glide',
] as const;
export type CharacterAction = (typeof ACTIONS)[number];
export type CharacterPart =
  'torso' | 'neck' | 'head' | 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight';

export interface TierProfile {
  readonly physicsScale: 0.6 | 1 | 1.6 | 3;
  /** Relative to the physical size, to keep GIGGA's spirals disproportionately heroic. */
  readonly hornScale: number;
  readonly glow: number;
  readonly woolLayers: number;
}
export const TIER_PROFILES: Readonly<Record<GoatTier, TierProfile>> = {
  KID: { physicsScale: 0.6, hornScale: 0.78, glow: 0, woolLayers: 0.92 },
  BILLY: { physicsScale: 1, hornScale: 1, glow: 0, woolLayers: 1 },
  BIG: { physicsScale: 1.6, hornScale: 1.11, glow: 0, woolLayers: 1.05 },
  GIGGA: { physicsScale: 3, hornScale: 1.32, glow: 1, woolLayers: 1.08 },
};
export type PhysicsScale = TierProfile['physicsScale'];

export function tierFromPhysicsScale(size: number): GoatTier {
  for (const tier of TIERS) if (size === TIER_PROFILES[tier].physicsScale) return tier;
  throw new RangeError('Unsupported physics goat scale: ' + size);
}
export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Minimal, separately-testable view of gameplay/physics state. */
export interface PhysicsVisualState {
  readonly ragdoll: boolean;
  readonly tongueAttached: boolean;
  readonly clinging: boolean;
  readonly gliding?: boolean;
  readonly pose: 'stand' | 'walk' | 'gallop' | 'jumpTuck' | 'climb' | 'flop';
  readonly sprinting: boolean;
  readonly grounded: boolean;
}
export function actionFromPhysics(state: PhysicsVisualState): CharacterAction {
  if (state.ragdoll || state.pose === 'flop') return 'flop';
  if (state.tongueAttached) return 'tongue-grab';
  if (state.clinging || state.pose === 'climb') return 'wall-climb';
  if (state.gliding) return 'glide';
  if (!state.grounded || state.pose === 'jumpTuck') return 'jump-flip';
  if (state.sprinting || state.pose === 'gallop') return 'sprint';
  return 'stand';
}

/** Read-only snapshot of animator values; apply after rigid-body interpolation. */
export interface MotionFrame {
  readonly bodyBob: number;
  readonly bodyLean: number;
  readonly squash: number;
  readonly legSwing: number;
  readonly earWag: number;
  readonly scarfWave: number;
  readonly tailWag: number;
  readonly blink: number;
  readonly browLift: number;
  readonly browTilt: number;
  readonly jawOpen: number;
  readonly tongueOut: number;
  readonly glowPulse: number;
}
export function sampleMotion(
  action: CharacterAction, timeSeconds: number, landing = 0,
): MotionFrame {
  const time = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
  const speed = action === 'sprint' ? 12 : action === 'wall-climb' ? 7 : 3.5;
  const wave = Math.sin(time * speed);
  // A quick squint every 4.3 seconds, never tied to frame rate or Math.random.
  const blinkPhase = (time + 0.65) % 4.3;
  const naturalBlink = Math.max(0, 1 - Math.abs(blinkPhase - 4.06) / 0.12);
  const closed = action === 'flop' ? 0.8 : action === 'headbutt' ? 0.48 : 0;
  const mouth =
    action === 'bleat' ? 0.98 :
    action === 'tongue-grab' ? 0.72 :
    action === 'sprint' ? 0.52 :
    action === 'flop' ? 0.2 : 0.07;
  const brow =
    action === 'bleat' ? 0.52 :
    action === 'jump-flip' ? 0.32 :
    action === 'flop' ? -0.27 :
    action === 'headbutt' ? -0.36 : 0.13;
  const exertion = action === 'sprint' || action === 'wall-climb' ? 1 : 0.3;
  return {
    bodyBob: (action === 'sprint' ? 0.045 : action === 'stand' ? 0.009 : 0.015) * Math.abs(wave),
    bodyLean: action === 'headbutt' ? -0.14 : action === 'sprint' ? -0.07 : 0,
    squash: clamp01(landing) * 0.24,
    legSwing: wave * (action === 'sprint' ? 0.3 : action === 'wall-climb' ? 0.18 : 0.04),
    earWag: Math.sin(time * 9.2 + 0.6) * (0.075 + 0.17 * exertion),
    scarfWave: Math.sin(time * (6.5 + exertion * 3)) * (0.11 + exertion * 0.16),
    tailWag: Math.sin(time * 6) * 0.17,
    blink: clamp01(Math.max(naturalBlink, closed)),
    browLift: brow,
    browTilt: action === 'headbutt' ? -0.26 : action === 'bleat' ? 0.19 : 0.04,
    jawOpen: mouth,
    tongueOut: action === 'tongue-grab' ? 1 : action === 'flop' ? 0.23 : 0,
    glowPulse: 0.82 + 0.18 * Math.sin(time * 3.8),
  };
}

/** Critically simple impact envelope; returned state is 0..1 for all dt values. */
export function decayLanding(previous: number, dt: number): number {
  return clamp01(previous) * Math.exp(-12 * Math.max(0, Number.isFinite(dt) ? dt : 0));
}

/** Used by the art lab only. Physical mode always reads real rigid-body transforms. */
export type Point3 = readonly [number, number, number];
export interface PreviewPart {
  readonly position: Point3;
  readonly rotation: Point3; // Euler XYZ radians
}
export type PreviewRig = Record<CharacterPart, PreviewPart>;
const REST: Readonly<Record<CharacterPart, Point3>> = {
  torso: [0, .92, 0],
  neck: [0, 1.24, -.62],
  head: [0, 1.48, -.84],
  frontLeft: [-.24, .44, -.40],
  frontRight: [.24, .44, -.40],
  backLeft: [-.24, .44, .40],
  backRight: [.24, .44, .40],
};

/** A posed character sheet, centred on the torso, with convincing action silhouettes. */
export function previewRig(action: CharacterAction, seconds = 0): PreviewRig {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const gait = Math.sin(t * 12);
  const pitch =
    action === 'jump-flip' ? (t * 2.1 % 1) * Math.PI * 2 :
    action === 'wall-climb' ? .55 :
    action === 'headbutt' ? -.29 :
    action === 'bleat' ? .22 :
    action === 'glide' ? .11 :
    action === 'sprint' ? -.11 : 0;
  const roll = action === 'flop' ? 1.38 : action === 'glide' ? -.07 : 0;
  const cosX = Math.cos(pitch), sinX = Math.sin(pitch);
  const cosZ = Math.cos(roll), sinZ = Math.sin(roll);
  const pivotY =
    action === 'flop' ? .30 :
    action === 'jump-flip' ? 1.73 :
    action === 'glide' ? 1.58 :
    action === 'wall-climb' ? 1.40 :
    action === 'sprint' ? .92 + .075 * Math.abs(gait) : .92;
  const parts = {} as Record<CharacterPart, PreviewPart>;
  for (const name of Object.keys(REST) as CharacterPart[]) {
    const base = REST[name];
    const rx = base[0], ry = base[1] - .92, rz = base[2];
    const py = ry * cosX - rz * sinX;
    const pz = ry * sinX + rz * cosX;
    const px = rx * cosZ - py * sinZ;
    const newY = rx * sinZ + py * cosZ;
    const front = name === 'frontLeft' || name === 'frontRight';
    const leg = name.endsWith('Left') || name.endsWith('Right');
    const phaseOffset = name === 'frontLeft' || name === 'backRight' ? 1 : -1;
    const legAngle =
      action === 'sprint' && leg ? gait * .7 * phaseOffset :
      action === 'wall-climb' && leg ? (front ? .48 : -.42) :
      action === 'jump-flip' && leg ? (front ? .65 : -.52) :
      action === 'glide' && leg ? (front ? .34 : -.27) : 0;
    const headPitch = name === 'head' ? (
      action === 'bleat' ? .34 :
      action === 'headbutt' ? -.12 :
      action === 'tongue-grab' ? -.12 : 0
    ) : 0;
    parts[name] = {
      position: [px, pivotY + newY, pz - (action === 'headbutt' ? .12 : 0)],
      rotation: [pitch + legAngle + headPitch, 0, roll],
    };
  }
  return parts;
}
