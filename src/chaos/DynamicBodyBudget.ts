import type { RigidBody } from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics';
import { finitePositive } from './internal';

interface Managed {
  handle: number;
  sleepingFor: number;
}
/**
 * Opt-in cap for spawned dynamic props. Reclaims long-sleeping bodies instead of
 * scanning or deleting foreign (goat/player) bodies from the Rapier world.
 */
export class DynamicBodyBudget {
  private readonly managed = new Map<number, Managed>();
  private readonly unsubscribe: () => void;
  constructor(readonly physics: PhysicsWorld, readonly maxDynamic = 800,
    readonly sleepCleanupSeconds = 15) {
    finitePositive(maxDynamic, 'maxDynamic');
    if (!Number.isInteger(maxDynamic)) throw new RangeError('maxDynamic must be an integer');
    finitePositive(sleepCleanupSeconds, 'sleepCleanupSeconds');
    this.unsubscribe = physics.onAfterStep(dt => this.cleanup(dt));
  }
  get count(): number { return this.managed.size; }
  get available(): number { return Math.max(0, this.maxDynamic - this.count); }
  /** Returns false without mutating the body if the budget is exhausted. */
  admit(body: RigidBody): boolean {
    if (!body.isDynamic()) throw new Error('Only dynamic bodies count against the budget');
    if (this.managed.has(body.handle)) return true;
    if (!this.available) return false;
    this.managed.set(body.handle, {handle:body.handle,sleepingFor:0});
    return true;
  }
  release(body: RigidBody): void { this.managed.delete(body.handle); }
  /** Allocate only when a slot exists; caller owns the created body. */
  spawn(factory: () => RigidBody): RigidBody | null {
    if (!this.available) return null;
    const body = factory();
    this.admit(body);
    return body;
  }
  cleanup(dt: number): void {
    for (const [handle, item] of this.managed) {
      const body = this.physics.raw.getRigidBody(handle);
      if (!body) { this.managed.delete(handle); continue; }
      item.sleepingFor = body.isSleeping() ? item.sleepingFor + dt : 0;
      if (item.sleepingFor >= this.sleepCleanupSeconds) {
        this.physics.removeBody(body);
        this.managed.delete(handle);
      }
    }
  }
  dispose(): void { this.unsubscribe(); this.managed.clear(); }
}
