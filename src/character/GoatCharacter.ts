import * as THREE from 'three';
import type { GoatRagdoll, GoatPart, GoatSize } from '../physics';
import {
  ACTIONS, actionFromPhysics, clamp01, decayLanding, previewRig, sampleMotion,
  tierFromPhysicsScale, TIER_PROFILES,
  type CharacterAction, type CharacterPart, type GoatTier, type MotionFrame,
} from './motion';
import { animateRibbon, sculptGoat, type GoatMesh } from './mesh';

const PARTS: readonly CharacterPart[] = [
  'torso', 'neck', 'head', 'frontLeft', 'frontRight', 'backLeft', 'backRight',
];
const V3 = (x: number, y: number, z: number): THREE.Vector3 =>
  new THREE.Vector3(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);
const MOUTH = new THREE.Vector3(0, -.20, -.36);

/**
 * Seven independently transformed art pieces, one per authoritative Rapier body.
 * Secondary motion never sets rigid-body poses or invokes simulation steps.
 *
 * Include character.root in an unscaled/world-space Three scene (NOT a scaled
 * parent), and call update() after physics.step(). All physics imports are types.
 */
export class GoatCharacter {
  readonly root: THREE.Group;
  /** Stable costume anchors; add gear to these groups and it follows animations. */
  readonly mounts: GoatMesh['mounts'];
  private readonly mesh: GoatMesh;
  private bound: GoatRagdoll | null = null;
  private unsubscribe: (() => void) | null = null;
  private tierValue: GoatTier = 'BILLY';
  private actionValue: CharacterAction = 'stand';
  private previewAction: CharacterAction = 'stand';
  private clock = 0;
  private landing = 0;
  private override: { action: CharacterAction; remaining: number } | null = null;
  private disposed = false;
  private readonly target = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor(goat?: GoatRagdoll) {
    this.mesh = sculptGoat();
    this.root = this.mesh.root;
    this.mounts = this.mesh.mounts;
    this.applyTier('BILLY');
    if (goat) this.bind(goat);
    else this.update(0);
  }
  get tier(): GoatTier { return this.tierValue; }
  get action(): CharacterAction { return this.actionValue; }
  get physics(): GoatRagdoll | null { return this.bound; }

  /** Attach/detach without taking ownership of the physics world or rigid bodies. */
  bind(goat: GoatRagdoll | null): void {
    if (this.disposed) throw new Error('GoatCharacter is disposed');
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.bound = goat;
    this.override = null;
    this.landing = 0;
    if (!goat) {
      this.actionValue = this.previewAction;
      return;
    }
    this.applyTier(tierFromPhysicsScale(goat.size));
    this.unsubscribe = goat.events.on(event => {
      if (event.type === 'landed') {
        this.landing = Math.max(this.landing, clamp01(Math.abs(event.verticalSpeed) / 9));
      } else if (event.type === 'impact') {
        this.landing = Math.max(this.landing, clamp01(event.impulse / (goat.mass * 7)) * .6);
      } else if (event.type === 'ragdollStart') {
        this.play('flop', 0.35);
      }
    });
    this.update(0, goat.world.alpha);
  }

  /**
   * Read-only presentation for model-sheet poses (not physically simulated).
   * If bound, call bind(null) first; physical gameplay always wins.
   */
  setPreview(action: CharacterAction, tier: GoatTier = this.tierValue): void {
    if (!ACTIONS.includes(action)) throw new RangeError('Unknown character pose');
    if (!(tier in TIER_PROFILES)) throw new RangeError('Unknown character tier');
    if (this.bound) throw new Error('Unbind physics before setting a preview pose');
    this.previewAction = action;
    this.actionValue = action;
    this.applyTier(tier);
    this.update(0);
  }

  /** Short visual accents for actions without a Rapier event (bleat/headbutt/glide). */
  play(action: CharacterAction, seconds = 0.65): void {
    if (!ACTIONS.includes(action)) throw new RangeError('Unknown character action');
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid duration');
    this.override = { action, remaining: seconds };
  }

  /** Force secondary animation time for deterministic screenshots/art comparisons. */
  seek(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid time');
    this.clock = seconds;
    this.update(0);
  }

  /** Stable, tier-scaled mount in world coordinates (requires prior update). */
  mountWorldPosition(name: 'head' | 'neck' | 'back', out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateWorldMatrix(true, true);
    return this.mounts[name].getWorldPosition(out);
  }

  /**
   * Render-frame work. alpha is the PhysicsWorld.step() interpolation fraction;
   * omitted alpha defaults to the world's current interpolation fraction.
   * Never advances physics, changes motor targets or modifies Rapier transforms.
   */
  update(dt: number, alpha?: number): MotionFrame {
    if (this.disposed) throw new Error('GoatCharacter is disposed');
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be non-negative and finite');
    const frameDt = Math.min(dt, .1);
    this.clock += frameDt;
    this.landing = decayLanding(this.landing, frameDt);
    const goat = this.bound;
    let selected = this.previewAction;
    if (goat) {
      const tier = tierFromPhysicsScale(goat.size);
      if (tier !== this.tierValue) this.applyTier(tier);
      selected = actionFromPhysics({
        ragdoll: goat.isRagdoll,
        tongueAttached: goat.interactions.isTongueAttached,
        clinging: goat.locomotion.isClinging,
        pose: goat.pose,
        sprinting: goat.locomotion.input.sprint,
        grounded: goat.locomotion.grounded,
      });
      // Always place all seven parts from physics each frame. Goat.resize()
      // replaces body handles, so deliberately do not cache RigidBody objects.
      const interpolation = alpha === undefined ? goat.world.alpha : clamp01(alpha);
      const scale = goat.size;
      for (const name of PARTS) {
        const transform = goat.world.getInterpolatedTransform(
          goat.getPart(name as GoatPart), interpolation);
        const part = this.mesh.parts[name];
        part.position.set(transform.translation.x, transform.translation.y,
          transform.translation.z);
        part.quaternion.set(transform.rotation.x, transform.rotation.y,
          transform.rotation.z, transform.rotation.w);
        part.scale.setScalar(scale);
      }
    } else {
      const pose = previewRig(selected, this.clock);
      const scale = TIER_PROFILES[this.tierValue].physicsScale;
      for (const name of PARTS) {
        const part = this.mesh.parts[name];
        const transform = pose[name];
        part.position.set(
          transform.position[0] * scale,
          transform.position[1] * scale,
          transform.position[2] * scale,
        );
        part.quaternion.setFromEuler(new THREE.Euler(...transform.rotation, 'XYZ'));
        part.scale.setScalar(scale);
      }
    }

    if (this.override) {
      selected = this.override.action;
      this.override.remaining -= frameDt;
      if (this.override.remaining <= 0) this.override = null;
    }
    this.actionValue = selected;
    const motion = sampleMotion(selected, this.clock, this.landing);
    this.animateSecondary(motion, selected, goat);
    return motion;
  }

  private applyTier(tier: GoatTier): void {
    this.tierValue = tier;
    const profile = TIER_PROFILES[tier];
    for (const horn of this.mesh.horns) horn.scale.setScalar(profile.hornScale);
    const gigga = profile.glow > 0;
    for (const aura of this.mesh.aura) aura.visible = gigga;
    this.mesh.purpleLight.intensity = gigga ? 0.85 : 0;
  }

  private animateSecondary(motion: MotionFrame, action: CharacterAction,
    goat: GoatRagdoll | null): void {
    // Stretch fluffy skin, not ragdoll bones. A landing compresses the barrel.
    this.mesh.torsoFur.scale.set(
      1 + motion.squash * .30,
      1 - motion.squash,
      1 + motion.squash * .22);
    this.mesh.torsoFur.position.y = -motion.squash * .055;
    this.mesh.headFur.position.y = motion.bodyBob;
    this.mesh.headFur.rotation.x = motion.bodyLean;
    this.mesh.jaw.position.y = -.186 - motion.jawOpen * .077;
    this.mesh.mouthOpening.scale.y = .020 + motion.jawOpen * .105;
    this.mesh.jaw.rotation.x = motion.jawOpen * .15;
    for (let index = 0; index < 2; index++) {
      const sign = index === 0 ? -1 : 1;
      const ear = this.mesh.ears[index]!;
      ear.rotation.z = sign * (.08 + motion.earWag);
      ear.rotation.x = motion.earWag * .56;
      const brow = this.mesh.eyebrows[index]!;
      brow.position.y = .167 + motion.browLift * .064;
      brow.rotation.z = sign * motion.browTilt;
      const lid = this.mesh.eyelids[index]!;
      lid.scale.y = .012 + motion.blink * .102;
      lid.position.y = .152 - motion.blink * .067;
    }
    this.mesh.tail.rotation.z = motion.tailWag;
    const speed = goat ? Math.hypot(
      goat.torso.linvel().x, goat.torso.linvel().z,
    ) / Math.max(.1, goat.size) : (action === 'sprint' ? 7 : 1);
    const wind = clamp01(speed / 10);
    for (const ribbon of this.mesh.scarf) {
      animateRibbon(ribbon, this.clock, wind);
    }
    this.mesh.glider.visible = action === 'glide';
    this.mesh.purpleLight.intensity =
      TIER_PROFILES[this.tierValue].glow * (0.75 + motion.glowPulse * .27);
    this.updateTongue(action, motion, goat);
  }

  private updateTongue(action: CharacterAction, motion: MotionFrame,
    goat: GoatRagdoll | null): void {
    const tethered = !!goat?.interactions.isTongueAttached;
    const active = tethered || motion.tongueOut > 0;
    this.mesh.tongue.visible = active;
    this.mesh.tongueTip.visible = active;
    if (!active) return;
    const size = TIER_PROFILES[this.tierValue].physicsScale;
    const head = this.mesh.parts.head;
    // Head bone is at real Rapier position, possibly upside-down and rotating.
    this.target.copy(MOUTH);
    if (tethered && goat?.interactions.tongueBody) {
      const targetBody = goat.interactions.tongueBody;
      const point = targetBody.translation();
      this.tip.set(point.x, point.y, point.z);
      this.tip.sub(head.position).applyQuaternion(head.quaternion.clone().invert())
        .divideScalar(size);
    } else {
      const length = action === 'flop' ? .17 : 1.75;
      this.tip.set(0, -.20, -.36 - length * motion.tongueOut);
    }
    this.direction.subVectors(this.tip, this.target);
    const length = Math.max(.001, this.direction.length());
    this.mesh.tongue.position.copy(this.target).addScaledVector(this.direction, .5);
    this.mesh.tongue.quaternion.setFromUnitVectors(UP, this.direction.normalize());
    this.mesh.tongue.scale.set(1, length, 1);
    this.mesh.tongueTip.position.copy(this.tip);
  }

  dispose(): void {
    if (this.disposed) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.bound = null;
    this.disposed = true;
    this.mesh.dispose();
  }
}

/** Convenient typed constructor for core integration without owning the ragdoll. */
export function createGoatCharacter(goat: GoatRagdoll): GoatCharacter {
  return new GoatCharacter(goat);
}
export { type GoatTier, type CharacterAction, type MotionFrame, type GoatSize };
