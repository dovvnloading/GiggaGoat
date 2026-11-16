import { RAPIER, PhysicsWorld, V, add, rotate } from '../physics';
import type { Vec3 } from '../physics';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { colliderHalfExtents, EventStream, finitePositive, unit } from './internal';
import type { DynamicBodyBudget } from './DynamicBodyBudget';

export type DestructionCause = 'impact' | 'damage' | 'script' | 'soda';
export interface BreakableOptions {
  /** A single solver contact impulse (N·s) that shatters this prop. */
  impulseThreshold?: number;
  /** Accumulated N·s of damage before shattering. */
  damageThreshold?: number;
  chunks?: number;
  /** Total outward N·s split across chunks. */
  burstImpulse?: number;
}
export interface DestructionEvent {
  type: 'destruction';
  time: number;
  bodyHandle: number;
  mass: number;
  cause: DestructionCause;
  position: Vec3;
  debrisHandles: number[];
}
interface Breakable {
  body: RigidBody;
  options: Required<BreakableOptions>;
  damage: number;
}
interface Debris {
  handle: number;
  spawnedAt: number;
  sleepingFor: number;
}
export interface DestructionOptions {
  maxDebris?: number;
  debrisLifetime?: number;
  sleepCleanupSeconds?: number;
  /** Optional shared budget for newly spawned dynamic props. */
  bodyBudget?: DynamicBodyBudget;
}
/**
 * Deterministic box-lattice pre-fracturing. Original mass/linear/angular velocity
 * are transferred to real dynamic chunks; oldest debris is evicted first.
 */
export class BreakableRegistry {
  readonly events = new EventStream<DestructionEvent>();
  private readonly entries = new Map<number, Breakable>();
  private readonly fragments: Debris[] = [];
  private readonly pending = new Map<number, number>();
  private readonly offContact: () => void;
  private readonly offStep: () => void;
  readonly maxDebris: number;
  readonly debrisLifetime: number;
  readonly sleepCleanupSeconds: number;
  private readonly bodyBudget?: DynamicBodyBudget;
  constructor(readonly physics: PhysicsWorld, config: DestructionOptions = {}) {
    this.maxDebris = config.maxDebris ?? 128;
    this.debrisLifetime = config.debrisLifetime ?? 20;
    this.sleepCleanupSeconds = config.sleepCleanupSeconds ?? 3;
    this.bodyBudget = config.bodyBudget;
    if (!Number.isInteger(this.maxDebris) || this.maxDebris < 0) throw new RangeError('maxDebris must be nonnegative integer');
    finitePositive(this.debrisLifetime,'debrisLifetime');
    finitePositive(this.sleepCleanupSeconds,'sleepCleanupSeconds');
    this.offContact = physics.onContact(e => {
      if (e.type !== 'impact') return;
      for (const handle of [e.bodyA, e.bodyB]) {
        if (handle !== null && this.entries.has(handle))
          this.pending.set(handle,(this.pending.get(handle) ?? 0) + e.impulse);
      }
    });
    this.offStep = physics.onAfterStep(dt => {
      for (const [handle, impulse] of this.pending) {
        const entry = this.entries.get(handle);
        if (entry) this.hit(entry.body,impulse,'impact');
      }
      this.pending.clear();
      this.cleanup(dt);
    });
  }
  get breakableCount(): number { return this.entries.size; }
  get debrisCount(): number { return this.fragments.length; }
  get debrisHandles(): number[] { return this.fragments.map(f=>f.handle); }
  register(body: RigidBody, options: BreakableOptions): () => void {
    if (!body.isDynamic() || !body.numColliders()) throw new Error('Breakable needs a dynamic body with a collider');
    if (options.impulseThreshold === undefined && options.damageThreshold === undefined)
      throw new Error('Specify an impulseThreshold or damageThreshold');
    const resolved = {
      impulseThreshold: options.impulseThreshold ?? Infinity,
      damageThreshold: options.damageThreshold ?? Infinity,
      chunks: options.chunks ?? 8,
      burstImpulse: options.burstImpulse ?? 10,
    };
    for (const key of ['impulseThreshold','damageThreshold','burstImpulse'] as const) {
      const value = resolved[key];
      if (value !== Infinity && (!Number.isFinite(value) || value < 0))
        throw new RangeError(key + ' must be nonnegative');
    }
    if (!Number.isInteger(resolved.chunks) || resolved.chunks < 1 || resolved.chunks > 64)
      throw new RangeError('chunks must be an integer in 1..64');
    this.entries.set(body.handle,{body,options:resolved,damage:0});
    return () => { this.entries.delete(body.handle); };
  }
  /** Scripted headbutts and damage work even without a collision event. */
  hit(body: RigidBody, impulse: number, cause: DestructionCause = 'impact'): boolean {
    if (!Number.isFinite(impulse) || impulse < 0) throw new RangeError('hit impulse must be finite and nonnegative');
    const entry = this.entries.get(body.handle);
    if (!entry) return false;
    entry.damage += impulse;
    if (impulse < entry.options.impulseThreshold && entry.damage < entry.options.damageThreshold) return false;
    return this.shatter(body,cause);
  }
  damage(body: RigidBody, amount: number): boolean { return this.hit(body,amount,'damage'); }
  shatter(body: RigidBody, cause: DestructionCause = 'script'): boolean {
    const original = this.entries.get(body.handle);
    if (!original) return false;
    this.entries.delete(body.handle);
    this.pending.delete(body.handle);
    const { options } = original;
    const mass = body.mass(), position = { ...body.translation() }, rotation = { ...body.rotation() };
    const linear = { ...body.linvel() }, angular = { ...body.angvel() };
    const collider = body.collider(0);
    const bounds = colliderHalfExtents(collider);
    const friction = collider.friction(), restitution = collider.restitution();
    // Remove source before adding children to avoid interpenetrating its old collider.
    this.physics.removeBody(body);
    const n = Math.min(options.chunks,this.maxDebris,this.bodyBudget?.available ?? Infinity);
    const nx = Math.ceil(Math.cbrt(n || 1)), ny = Math.ceil(Math.sqrt((n || 1) / nx));
    const nz = Math.ceil((n || 1) / (nx * ny));
    const piece = V(bounds.x / nx, bounds.y / ny, bounds.z / nz);
    const handles: number[] = [];
    for (let i=0;i<n;i++) {
      if (this.bodyBudget && !this.bodyBudget.available) break;
      while (this.fragments.length >= this.maxDebris) this.removeOldest();
      const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx*ny));
      const offset = V((2*x+1-nx)*piece.x,(2*y+1-ny)*piece.y,(2*z+1-nz)*piece.z);
      const rotated = rotate(rotation,offset), center = add(position,rotated);
      const chunk = this.physics.raw.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(center.x,center.y,center.z)
          .setCanSleep(true).setCcdEnabled(true));
      chunk.setRotation(rotation,true);
      this.physics.raw.createCollider(RAPIER.ColliderDesc.cuboid(
        Math.max(.012,piece.x*.94),Math.max(.012,piece.y*.94),Math.max(.012,piece.z*.94))
        .setMass(Math.max(.001,mass/Math.max(1,n))).setFriction(friction).setRestitution(restitution),chunk);
      const tangential = V(angular.y*rotated.z-angular.z*rotated.y,
        angular.z*rotated.x-angular.x*rotated.z,angular.x*rotated.y-angular.y*rotated.x);
      chunk.setLinvel(add(linear,tangential),true);
      chunk.setAngvel(angular,true);
      const outward = unit(V(offset.x + .13 * Math.sin(i*37),
        offset.y + .4,offset.z + .13 * Math.cos(i*53)));
      chunk.applyImpulse(V(outward.x*options.burstImpulse/n,
        outward.y*options.burstImpulse/n,outward.z*options.burstImpulse/n),true);
      this.physics.registerBody(chunk,{kind:'debris'});
      this.bodyBudget?.admit(chunk);
      this.fragments.push({handle:chunk.handle,spawnedAt:this.physics.time,sleepingFor:0});
      handles.push(chunk.handle);
    }
    this.events.emit({type:'destruction',time:this.physics.time,bodyHandle:body.handle,
      mass,cause,position,debrisHandles:handles});
    return true;
  }
  private removeOldest(): void {
    const oldest = this.fragments.shift();
    if (!oldest) return;
    const body = this.physics.raw.getRigidBody(oldest.handle);
    if (body) {
      this.bodyBudget?.release(body);
      this.physics.removeBody(body);
    }
  }
  cleanup(dt: number): void {
    for (let i=this.fragments.length-1;i>=0;i--) {
      const item = this.fragments[i];
      if (!item) continue;
      const body = this.physics.raw.getRigidBody(item.handle);
      if (!body) { this.fragments.splice(i,1); continue; }
      item.sleepingFor = body.isSleeping() ? item.sleepingFor+dt : 0;
      if (item.sleepingFor >= this.sleepCleanupSeconds ||
          this.physics.time-item.spawnedAt >= this.debrisLifetime) {
        this.bodyBudget?.release(body);
        this.physics.removeBody(body);
        this.fragments.splice(i,1);
      }
    }
  }
  dispose(): void {
    this.offContact(); this.offStep(); this.entries.clear(); this.pending.clear();
    while (this.fragments.length) this.removeOldest();
    this.events.clear();
  }
}
