import RAPIER, { type Collider, type RigidBody, type Shape, type World, type EventQueue } from '@dimforge/rapier3d-compat';
import { collisionGroups, type CollisionGroupName } from './CollisionGroups';
import { type PhysicsContact } from './events';
import { add, clamp, lerp, mul, normalize, Q, slerp, V, type Quat, type Vec3 } from './math';

export interface PhysicsWorldOptions {
  gravity?: Vec3;
  fixedDt?: number;
  maxSubsteps?: number;
  solverIterations?: number;
}
export interface BodyRecord<T = unknown> {
  kind: string;
  owner?: string;
  data?: T;
}
export interface Transform {
  translation: Vec3;
  rotation: Quat;
}
export interface PhysicsStepResult { steps: number; alpha: number; droppedSeconds: number; time: number }
export interface QueryOptions {
  groups?: number;
  excludeBody?: RigidBody;
  excludeCollider?: Collider;
  predicate?: (collider: Collider) => boolean;
  includeSensors?: boolean;
}
export interface RayHit {
  collider: Collider;
  body: RigidBody | null;
  point: Vec3;
  normal: Vec3;
  distance: number;
}
export interface ShapeHit {
  collider: Collider;
  body: RigidBody | null;
  point: Vec3;
  normal: Vec3;
  distance: number;
}

const copyTransform = (body: RigidBody): Transform => ({
  translation: { ...body.translation() }, rotation: { ...body.rotation() },
});
type FixedListener = (dt: number) => void;
type ContactListener = (contact: PhysicsContact) => void;

/**
 * Owns a Rapier World and EventQueue. All impulses/controllers run in the
 * before-step phase; events and pose snapshots are published after each step.
 * Consumers must call PhysicsWorld.create(): WASM must be initialized first.
 */
export class PhysicsWorld {
  readonly raw: World;
  readonly bodyRegistry = new Map<number, BodyRecord>();
  readonly fixedDt: number;
  readonly maxSubsteps: number;
  readonly eventQueue: EventQueue;
  private readonly before = new Set<FixedListener>();
  private readonly after = new Set<FixedListener>();
  private readonly contactListeners = new Set<ContactListener>();
  private readonly transforms = new Map<number, { previous: Transform; current: Transform }>();
  private readonly contacts: PhysicsContact[] = [];
  private accumulator = 0;
  private disposed = false;
  time = 0;
  stepCount = 0;

  private constructor(options: PhysicsWorldOptions) {
    this.fixedDt = options.fixedDt ?? 1 / 60;
    this.maxSubsteps = options.maxSubsteps ?? 5;
    if (!(this.fixedDt > 0) || !Number.isFinite(this.fixedDt) ||
        !Number.isInteger(this.maxSubsteps) || this.maxSubsteps < 1) {
      throw new RangeError('fixedDt must be finite and positive; maxSubsteps must be a positive integer');
    }
    this.raw = new RAPIER.World(options.gravity ?? V(0, -9.81, 0));
    this.raw.timestep = this.fixedDt;
    this.raw.numSolverIterations = options.solverIterations ?? 8;
    this.eventQueue = new RAPIER.EventQueue(true);
  }
  static async create(options: PhysicsWorldOptions = {}): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld(options);
  }

  onBeforeStep(listener: FixedListener): () => void {
    this.before.add(listener); return () => { this.before.delete(listener); };
  }
  onAfterStep(listener: FixedListener): () => void {
    this.after.add(listener); return () => { this.after.delete(listener); };
  }
  onContact(listener: ContactListener): () => void {
    this.contactListeners.add(listener); return () => { this.contactListeners.delete(listener); };
  }

  registerBody<T>(body: RigidBody, record: BodyRecord<T>): void {
    this.bodyRegistry.set(body.handle, record);
    const transform = copyTransform(body);
    this.transforms.set(body.handle, { previous: transform, current: transform });
  }
  bodyData(handle: number): BodyRecord | undefined { return this.bodyRegistry.get(handle); }
  unregisterBody(body: RigidBody): void {
    this.bodyRegistry.delete(body.handle);
    this.transforms.delete(body.handle);
  }
  removeBody(body: RigidBody): void {
    this.unregisterBody(body);
    this.raw.removeRigidBody(body);
  }
  /** Use to interpolate visuals. Physics always uses the latest fixed state. */
  getInterpolatedTransform(body: RigidBody, alpha = this.alpha): Transform {
    const snapshots = this.transforms.get(body.handle);
    if (!snapshots) return copyTransform(body);
    const t = clamp(alpha, 0, 1);
    return {
      translation: lerp(snapshots.previous.translation, snapshots.current.translation, t),
      rotation: slerp(snapshots.previous.rotation, snapshots.current.rotation, t),
    };
  }

  /** Snap a registered body's visual history after an intentional warp. */
  resetInterpolation(body: RigidBody): void {
    const snapshots = this.transforms.get(body.handle);
    if (!snapshots) return;
    const transform = copyTransform(body);
    snapshots.previous = transform;
    snapshots.current = transform;
  }
  get alpha(): number { return clamp(this.accumulator / this.fixedDt, 0, 1); }

  /** Drop excess wall-clock time instead of a spiral of death. Call with seconds. */
  step(frameSeconds: number): PhysicsStepResult {
    if (this.disposed) throw new Error('PhysicsWorld has been disposed');
    if (!Number.isFinite(frameSeconds) || frameSeconds < 0) {
      throw new RangeError('frameSeconds must be a finite, non-negative number');
    }
    const available = this.accumulator + frameSeconds;
    const budget = this.fixedDt * this.maxSubsteps;
    const droppedSeconds = Math.max(0, available - budget);
    this.accumulator = Math.min(available, budget);
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.fixedDt && steps < this.maxSubsteps) {
      for (const listener of [...this.before]) listener(this.fixedDt);
      for (const [handle, snapshots] of this.transforms) {
        if (!this.raw.getRigidBody(handle)) {
          this.transforms.delete(handle); this.bodyRegistry.delete(handle);
        } else snapshots.previous = snapshots.current;
      }
      this.raw.step(this.eventQueue);
      this.time += this.fixedDt;
      this.stepCount++;
      for (const [handle, snapshots] of this.transforms) {
        const body = this.raw.getRigidBody(handle);
        if (body) snapshots.current = copyTransform(body);
      }
      this.collectContacts();
      for (const listener of [...this.after]) listener(this.fixedDt);
      this.accumulator = Math.max(0, this.accumulator - this.fixedDt);
      steps++;
    }
    return { steps, alpha: this.alpha, droppedSeconds, time: this.time };
  }

  private collectContacts(): void {
    const dispatch = (contact: PhysicsContact): void => {
      this.contacts.push(contact);
      for (const listener of [...this.contactListeners]) listener(contact);
    };
    const parentHandle = (handle: number): number | null =>
      this.raw.getCollider(handle)?.parent()?.handle ?? null;
    this.eventQueue.drainCollisionEvents((a, b, began) => {
      dispatch({
        type: began ? 'begin' : 'end', time: this.time, colliderA: a, colliderB: b,
        bodyA: parentHandle(a), bodyB: parentHandle(b), impulse: 0,
      });
    });
    this.eventQueue.drainContactForceEvents(event => {
      const a = event.collider1(), b = event.collider2();
      const impulse = event.totalForceMagnitude() * this.fixedDt;
      if (Number.isFinite(impulse) && impulse > 0) {
        dispatch({ type: 'impact', time: this.time, colliderA: a, colliderB: b,
          bodyA: parentHandle(a), bodyB: parentHandle(b), impulse });
      }
    });
  }
  drainContacts(): PhysicsContact[] { return this.contacts.splice(0); }

  raycast(origin: Vec3, direction: Vec3, maxDistance: number, opts: QueryOptions = {}): RayHit | null {
    if (!(maxDistance > 0)) return null;
    const dir = normalize(direction);
    if (dir.x === 0 && dir.y === 0 && dir.z === 0) return null;
    const hit = this.raw.castRayAndGetNormal(
      new RAPIER.Ray(origin, dir), maxDistance, true,
      opts.includeSensors ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      opts.groups, opts.excludeCollider, opts.excludeBody, opts.predicate,
    );
    if (!hit) return null;
    return {
      collider: hit.collider, body: hit.collider.parent(), normal: { ...hit.normal },
      distance: hit.timeOfImpact, point: add(origin, mul(dir, hit.timeOfImpact)),
    };
  }
  shapeCast(position: Vec3, rotation: Quat, direction: Vec3, shape: Shape,
    maxDistance: number, opts: QueryOptions = {}): ShapeHit | null {
    if (!(maxDistance > 0)) return null;
    const dir = normalize(direction);
    const hit = this.raw.castShape(position, rotation, dir, shape, 0, maxDistance, false,
      opts.includeSensors ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      opts.groups, opts.excludeCollider, opts.excludeBody, opts.predicate);
    if (!hit) return null;
    return {
      collider: hit.collider, body: hit.collider.parent(),
      normal: { ...hit.normal1 }, point: { ...hit.witness1 },
      distance: hit.time_of_impact,
    };
  }
  /**
   * Flat terrain convenience. Registration is optional for externally created
   * colliders/bodies; events still include their Rapier handles.
   */
  createGround(halfExtents = V(100, 0.5, 100), center = V(0, -0.5, 0)): RigidBody {
    const body = this.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z));
    this.raw.createCollider(RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setFriction(1.1).setCollisionGroups(collisionGroups('terrain'))
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), body);
    this.registerBody(body, { kind: 'terrain' });
    return body;
  }
  createBox(position: Vec3, halfExtents: Vec3, mass = 10,
    layer: CollisionGroupName = 'prop'): RigidBody {
    const body = this.raw.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z).setCanSleep(true).setCcdEnabled(true));
    this.raw.createCollider(RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setMass(mass).setFriction(0.9).setCollisionGroups(collisionGroups(layer))
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), body);
    this.registerBody(body, { kind: layer });
    return body;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.before.clear(); this.after.clear(); this.contactListeners.clear();
    this.transforms.clear(); this.bodyRegistry.clear(); this.contacts.length = 0;
    this.eventQueue.free(); this.raw.free();
  }
}
