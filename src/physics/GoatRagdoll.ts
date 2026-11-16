import RAPIER, { type ImpulseJoint, type RevoluteImpulseJoint, type RigidBody } from '@dimforge/rapier3d-compat';
import { collisionGroups } from './CollisionGroups';
import { PhysicsEventBus, type PhysicsContact } from './events';
import { add, clamp, mul, Q, V, yawQuaternion, type Vec3 } from './math';
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
type Motor = { name: Exclude<GoatPart, 'torso'>; joint: RevoluteImpulseJoint };
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
  private destroyed = false;

  constructor(world: PhysicsWorld, options: GoatOptions = {}) {
    this.world = world;
    this.id = options.id ?? 'goat-' + nextGoatId++;
    this.size = options.size ?? 1;
    if (!GOAT_SIZES.includes(this.size)) throw new RangeError('Unsupported goat size');
    this.createBodies(options.position ?? V(), options.yaw ?? 0);
    this.balance = new BalanceController(this);
    this.locomotion = new LocomotionController(this);
    this.interactions = new GoatInteractions(this);
    this.detachBefore = this.world.onBeforeStep(dt => {
      this.locomotion.update(dt);
      this.balance.update(dt);
      this.interactions.update(dt);
      this.driveMotors();
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
    const addBody = (name: GoatPart, offset: Vec3, shape: RAPIER.ColliderDesc, mass: number): RigidBody => {
      const at = add(origin, mul(offset, s));
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
      this.hinges.push({ name, joint });
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
    for (const { name, joint } of this.hinges) {
      const target = standing ? this.targetAngle(name) : 0;
      const strength = standing ? 1 : 0;
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
    if (this.pose === 'climb') return front ? .43 : -.38;
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
    this.balance.handleImpact(contact.impulse, mineA ? contact.bodyB : contact.bodyA);
  }

  /** Live size progression: rebuild joints/colliders, preserving heading and velocity. */
  resize(size: GoatSize): void {
    if (!GOAT_SIZES.includes(size)) throw new RangeError('Unsupported goat size');
    if (size === this.size) return;
    this.interactions.detachTongue('replaced');
    const torso = this.torso;
    const position = torso.translation();
    const velocity = { ...torso.linvel() };
    const rotation = torso.rotation();
    const yaw = Math.atan2(2*(rotation.w*rotation.y+rotation.x*rotation.z),
      1-2*(rotation.y*rotation.y+rotation.z*rotation.z));
    const groundOrigin = add(position,V(0,-.92*this.size,0));
    this.clearBodies();
    this.size = size;
    this.createBodies(groundOrigin,yaw);
    for (const body of this.bodies) body.setLinvel(velocity,true);
  }
  private clearBodies(): void {
    for (const body of this.bodies) this.world.removeBody(body);
    this.parts.clear();
    this.hinges.length = 0;
  }
  flop(): void { this.balance.flop(); }
  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.detachBefore(); this.detachAfter(); this.detachContact();
    this.interactions.detachTongue('destroyed');
    this.clearBodies();
    this.events.clear();
  }
}
