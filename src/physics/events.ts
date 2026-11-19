import type { Vec3 } from './math';
export interface PhysicsContact {
  readonly type: 'begin' | 'end' | 'impact';
  readonly time: number;
  readonly colliderA: number;
  readonly colliderB: number;
  readonly bodyA: number | null;
  readonly bodyB: number | null;
  /** Solver contact force integrated over the fixed timestep, in N·s. */
  readonly impulse: number;
}
interface BaseEvent { readonly goatId: string; readonly time: number }
export type PhysicsEvent =
  | (BaseEvent & { type: 'jumped' })
  | (BaseEvent & { type: 'landed'; airtime: number; verticalSpeed: number })
  | (BaseEvent & { type: 'impact'; impulse: number; otherBodyHandle: number | null })
  | (BaseEvent & { type: 'flipped'; rotations: number })
  | (BaseEvent & { type: 'airtimeStart'; height: number })
  | (BaseEvent & { type: 'airtimeEnd'; duration: number })
  | (BaseEvent & { type: 'wallClingStart'; normal: Vec3 })
  | (BaseEvent & { type: 'wallClingEnd' })
  | (BaseEvent & { type: 'ragdollStart'; reason: 'flop' | 'impact' })
  | (BaseEvent & { type: 'ragdollEnd' })
  | (BaseEvent & { type: 'tongueAttach'; bodyHandle: number; length: number })
  | (BaseEvent & { type: 'tongueDetach'; reason: 'released' | 'broken' | 'replaced' | 'destroyed' })
  | (BaseEvent & { type: 'knockedBody'; bodyHandle: number; mass: number; speed: number; impulse: number });
export class PhysicsEventBus {
  private readonly listeners = new Set<(event: PhysicsEvent) => void>();
  private readonly pending: PhysicsEvent[] = [];
  on(listener: (event: PhysicsEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  emit(event: PhysicsEvent): void {
    this.pending.push(event);
    for (const listener of [...this.listeners]) listener(event);
  }
  drain(): PhysicsEvent[] { return this.pending.splice(0); }
  clear(): void { this.pending.length = 0; this.listeners.clear(); }
}
