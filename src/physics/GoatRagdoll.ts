import RAPIER, { type ImpulseJoint, type RevoluteImpulseJoint, type RigidBody, type ColliderDesc } from '@dimforge/rapier3d-compat';
import { collisionGroups } from './CollisionGroups';
import { PhysicsEventBus, type PhysicsContact } from './events';
import { add, clamp, cross, dot, mul, rotate, sub, V, yawQuaternion, type Vec3 } from './math';
import type { PhysicsWorld } from './PhysicsWorld';
import { BalanceController, LocomotionController } from './Controllers';
import { GoatInteractions } from './Interactions';

export const GOAT_SIZES = [0.6, 1, 1.6, 3] as const;
export type GoatSize = (typeof GOAT_SIZES)[number];
export type GoatPart = 'torso' | 'neck' | 'head' | 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight';
export type GoatPose = 'stand' | 'walk' | 'gallop' | 'jumpTuck' | 'climb' | 'flop';
export interface GoatOptions {
  /** Ground-level spawn position, not the torso's center. */
  position?: Vec3;
  /** Physical rotation about +Y; steering heading uses the opposite sign. */
  yaw?: number;
  size?: GoatSize;
  id?: string;
}
export interface MotorTuning {
  /** Joint spring constants at Billy size (scaled with moment of inertia, s^5). */
  stiffness: number;
  damping: number;
  maxTorque: number;
}
type Motor = {
  name: Exclude<GoatPart, 'torso'>;
  joint: RevoluteImpulseJoint;
  recoveryAngle: number | undefined;
};
const HIP_NAMES = ['frontLeft','frontRight','backLeft','backRight'] as const;
let nextGoatId = 1;

/**
 * Seven collision-bearing rigid bodies and six motorized hinge joints.
 * Controllers and interactions are called by the world's fixed-step hook,
 * never once-per-render-frame.
 */
export class GoatRagdoll {
  readonly id: string;
  readonly world: PhysicsWorld;
  readonly events = new PhysicsEventBus();
  readonly balance: BalanceController;
  readonly locomotion: LocomotionController;
  readonly interactions: GoatInteractions;
  readonly motors: MotorTuning = { stiffness: 135, damping: 17, maxTorque: 250 };
  size: GoatSize;
  pose: GoatPose = 'stand';
  phase = 0;
  private parts = new Map<GoatPart, RigidBody>();
  private hinges: Motor[] = [];
  private detachBefore: () => void;
  private detachAfter: () => void;
  private detachContact: () => void;
  private plantedAtWalkingSpeed = false;
  private hasStepped = false;
  private destroyed = false;

  constructor(world: PhysicsWorld, options: GoatOptions = {}) {
    this.world = world;
    this.id = options.id ?? 'goat-' + nextGoatId++;
    this.size = options.size ?? 1;
    if (!GOAT_SIZES.includes(this.size)) throw new RangeError('Unsupported goat size');
    this.createBodies(options.position ?? V(), options.yaw ?? 0);
    this.balance = new BalanceController(this);
    this.locomotion = new LocomotionController(this);
    // yawQuaternion rotates local -Z toward -X; forward(heading) uses +X.
    this.locomotion.heading = -(options.yaw ?? 0);
    this.interactions = new GoatInteractions(this);
    this.detachBefore = this.world.onBeforeStep(dt => {
      this.hasStepped = true;
      this.locomotion.update(dt);
      this.balance.update(dt);
      this.interactions.update(dt);
      this.driveMotors();
      // Sample before the contact solver changes velocity. A planted goat
      // walking into scenery can generate a large impulse as its legs and
      // torso are stopped together, even during an ordinary walking bump.
      const velocity = this.torso.linvel();
      const walkSpeed = this.locomotion.tuning.walkSpeed * this.size ** .16;
      this.plantedAtWalkingSpeed = this.locomotion.grounded && !this.isRagdoll &&
        Math.abs(velocity.y) < 2 * Math.sqrt(this.size) &&
        Math.hypot(velocity.x, velocity.z) <= walkSpeed * 1.05;
    });
    this.detachAfter = this.world.onAfterStep(dt => { this.locomotion.afterStep(dt); });
    this.detachContact = this.world.onContact(contact => { this.handleContact(contact); });
  }
  get torso(): RigidBody { return this.getPart('torso'); }
  get neck(): RigidBody { return this.getPart('neck'); }
  get head(): RigidBody { return this.getPart('head'); }
  get legs(): readonly RigidBody[] { return HIP_NAMES.map(name => this.getPart(name)); }
  get bodies(): readonly RigidBody[] { return [...this.parts.values()]; }
  get joints(): readonly ImpulseJoint[] { return this.hinges.map(h => h.joint); }
  get mass(): number { return 27 * this.size ** 3; }
  get isRagdoll(): boolean { return this.balance.isRagdoll; }
  get balanceValue(): number { return this.balance.value; }
  getPart(part: GoatPart): RigidBody {
    const body = this.parts.get(part);
    if (!body) throw new Error('Goat has no body part: ' + part);
    return body;
  }
  ownsBody(body: RigidBody | number | null): boolean {
    const handle = typeof body === 'number' ? body : body?.handle;
    return handle !== undefined && [...this.parts.values()].some(b => b.handle === handle);
  }
  setPose(pose: GoatPose, phase = this.phase): void {
    this.pose = pose; this.phase = phase;
  }

  private createBodies(origin: Vec3, yaw: number): void {
    const s = this.size;
    const orientation = yawQuaternion(yaw);
    const addBody = (name: GoatPart, offset: Vec3, shape: ColliderDesc, mass: number): RigidBody => {
      const at = add(origin, rotate(orientation,mul(offset, s)));
      const body = this.world.raw.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z)
          .setRotation(orientation).setLinearDamping(0.45).setAngularDamping(0.75)
          .setCcdEnabled(true),
      );
      this.world.raw.createCollider(shape.setMass(mass * s ** 3).setFriction(1.15)
        .setRestitution(0.04).setCollisionGroups(collisionGroups('goat'))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), body);
      this.world.registerBody(body, { kind: 'goat', owner: this.id, data: { part: name } });
      this.parts.set(name, body);
      return body;
    };
    const torso = addBody('torso', V(0, .92, 0), RAPIER.ColliderDesc.cuboid(.29*s,.27*s,.52*s),14);
    const neck = addBody('neck', V(0, 1.24, -.62), RAPIER.ColliderDesc.cuboid(.15*s,.22*s,.19*s),2);
    const head = addBody('head', V(0, 1.48, -.84), RAPIER.ColliderDesc.ball(.23*s),3);
    const attach = (name: Motor['name'], a: RigidBody, b: RigidBody, anchorA: Vec3, anchorB: Vec3): void => {
      const desc = RAPIER.JointData.revolute(mul(anchorA,s),mul(anchorB,s),V(1,0,0));
      const joint = this.world.raw.createImpulseJoint(desc,a,b,true) as RevoluteImpulseJoint;
      joint.setContactsEnabled(false);
      joint.setLimits(-.95,.95);
      this.hinges.push({ name, joint, recoveryAngle: undefined });
    };
    attach('neck',torso,neck,V(0,.17,-.5),V(0,-.15,.12));
    attach('head',neck,head,V(0,.13,-.12),V(0,-.11,.10));
    for (const [i, name] of HIP_NAMES.entries()) {
      const x = i % 2 === 0 ? -.24 : .24;
      const z = i < 2 ? -.40 : .40;
      const leg = addBody(name,V(x,.44,z),
        RAPIER.ColliderDesc.cuboid(.10*s,.38*s,.115*s),2);
      attach(name,torso,leg,V(x,-.23,z),V(0,.25,0));
    }
    this.driveMotors();
  }

  /** Drives actual hinge motors, not simulated animation transforms. */
  private driveMotors(): void {
    const s5 = this.size ** 5;
    const standing = !this.balance?.isRagdoll;
    const hipGain = this.balance?.hipRecoveryGain ?? 1;
    for (const motor of this.hinges) {
      const { name, joint } = motor;
      const isHip = name !== 'neck' && name !== 'head';
      const strength = standing ? (isHip ? hipGain : 1) : 0;
      const desired = standing ? this.targetAngle(name) : 0;
      let target = desired;
      if (strength === 0 || strength === 1) {
        motor.recoveryAngle = undefined;
      } else {
        // Resume from the real folded angle, so a planted hoof cannot turn
        // a sudden full-size hinge correction into a jump.
        if (motor.recoveryAngle === undefined) {
          const q = this.torso.rotation();
          const up = rotate(q, V(0, 1, 0));
          const legUp = rotate(this.getPart(name).rotation(), V(0, 1, 0));
          motor.recoveryAngle = Math.atan2(dot(cross(up, legUp), rotate(q, V(1, 0, 0))), dot(up, legUp));
        }
        target = motor.recoveryAngle + (desired - motor.recoveryAngle) * strength;
      }
      joint.configureMotorPosition(target, this.motors.stiffness*s5*strength,
        this.motors.damping*s5*strength);
      joint.setMotorMaxForce(this.motors.maxTorque*s5*strength);
    }
  }
  private targetAngle(name: Motor['name']): number {
    if (this.pose === 'flop') return 0;
    if (name === 'neck') return this.pose === 'climb' ? -.24 : this.pose === 'jumpTuck' ? -.13 : .07;
    if (name === 'head') return this.pose === 'climb' ? -.12 : -.06;
    const front = name.startsWith('front');
    if (this.pose === 'jumpTuck') return front ? .58 : -.53;
    if (this.pose === 'climb') {
      const diagonal = name === 'frontLeft' || name === 'backRight' ? 0 : Math.PI;
      return (front ? .28 : -.21) + .38 * Math.sin(this.phase + diagonal);
    }
    if (this.pose === 'stand') return front ? .03 : -.03;
    const gallop = this.pose === 'gallop';
    const amplitude = gallop ? .61 : .33;
    const diagonal = name === 'frontLeft' || name === 'backRight' ? 0 : Math.PI;
    const offset = gallop ? (front ? 0 : Math.PI * .55) : diagonal;
    return clamp(Math.sin(this.phase + offset)*amplitude + (front ? .04 : -.04), -.88,.88);
  }

  private handleContact(contact: PhysicsContact): void {
    if (contact.type !== 'impact') return;
    const mineA = this.ownsBody(contact.bodyA);
    const mineB = this.ownsBody(contact.bodyB);
    if (mineA === mineB) return; // self-contact and non-goat contacts are not damage.
    const other = mineA ? contact.bodyB : contact.bodyA;
    const fixed = other === null || this.world.raw.getRigidBody(other)?.isFixed();
    const otherCollider = mineA ? contact.colliderB : contact.colliderA;
    // The fixed face currently carrying the climbing gait pushes back on its
    // planted limbs. That support impulse is expected and must not trigger a flop.
    if (fixed && this.locomotion.climbSurface?.collider.handle === otherCollider) return;
    // Keep the real solid-body stop. Only hard collisions can knock the goat
    // down, so holding movement against a rail cannot chain ragdolls.
    if (fixed && this.plantedAtWalkingSpeed) return;
    this.balance.handleImpact(contact.impulse, other);
  }

  /** Live size progression: rebuild joints/colliders without interrupting traversal. */
  resize(size: GoatSize, keepDynamicTether = false): void {
    if (!GOAT_SIZES.includes(size)) throw new RangeError('Unsupported goat size');
    if (size === this.size) return;
    const torso = this.torso;
    const position = torso.translation();
    const velocity = { ...torso.linvel() };
    const rotation = torso.rotation();
    const oldSize = this.size;
    // A newly spawned standing goat has not had a ground query yet. Rebuild
    // it around its feet as before, unless it already has active motion.
    const angular = torso.angvel();
    const initialStand = !this.hasStepped && this.pose === 'stand' &&
      Math.hypot(velocity.x, velocity.y, velocity.z, angular.x, angular.y, angular.z) < .001;
    const preservePose = this.isRagdoll || this.locomotion.isClinging ||
      (!this.locomotion.grounded && !initialStand);
    const previous = preservePose ? [...this.parts].map(([name, body]) => ({
      name, position: { ...body.translation() }, rotation: { ...body.rotation() },
      linear: { ...body.linvel() }, angular: { ...body.angvel() },
    })) : [];
    let nextPosition = { ...position };
    const wall = this.locomotion.isClinging ? this.locomotion.climbSurface : null;
    if (wall) {
      const clearance = Math.max(0, dot(sub(position, wall.point), wall.normal));
      nextPosition = add(position, mul(wall.normal, clearance * (size / oldSize - 1)));
    }
    const yaw = Math.atan2(2*(rotation.w*rotation.y+rotation.x*rotation.z),
      1-2*(rotation.y*rotation.y+rotation.z*rotation.z));
    const groundOrigin = add(position,V(0,-.92*this.size,0));
    const rebuild = () => {
      this.clearBodies();
      this.size = size;
      this.createBodies(groundOrigin,yaw);
      if (preservePose) {
        const ratio = size / oldSize;
        for (const old of previous) {
          const body = this.getPart(old.name);
          body.setTranslation(add(nextPosition, mul(sub(old.position, position), ratio)), true);
          body.setRotation(old.rotation, true);
          body.setLinvel(add(velocity, mul(sub(old.linear, velocity), ratio)), true);
          body.setAngvel(old.angular, true);
          this.world.resetInterpolation(body);
        }
      } else {
        for (const body of this.bodies) body.setLinvel(velocity,true);
      }
    };
    if (keepDynamicTether) this.interactions.rebuildHeadWithDynamicTether(rebuild);
    else {
      this.interactions.detachTongue('replaced');
      rebuild();
    }
  }
  private clearBodies(): void {
    for (const body of this.bodies) this.world.removeBody(body);
    this.parts.clear();
    this.hinges.length = 0;
  }
  flop(): void {
    const planted = !this.isRagdoll && this.pose === 'stand' && this.locomotion.grounded;
    this.balance.flop();
    if (!planted) return;
    // Turning off the motors leaves four braced legs bearing weight on flat
    // ground. Deliberately fold the joints so a standing flop actually falls.
    const curl = mul(rotate(this.torso.rotation(), V(1, 0, 0)), 3.7 * this.size ** (5 / 3));
    for (const leg of this.legs) leg.applyTorqueImpulse(mul(curl, .10 * leg.mass()), true);
    this.torso.applyTorqueImpulse(mul(curl, -.035 * this.mass), true);
  }
  resetForRespawn(): void {
    this.locomotion.resetForRespawn();
    this.balance.resetForRespawn();
    this.plantedAtWalkingSpeed = false;
    this.setPose('stand', 0);
  }
  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.detachBefore(); this.detachAfter(); this.detachContact();
    this.interactions.detachTongue('destroyed');
    this.clearBodies();
    this.events.clear();
  }
}
