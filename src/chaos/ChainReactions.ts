import type { RigidBody } from '@dimforge/rapier3d-compat';
import { PhysicsWorld, V, rotate, applyExplosion } from '../physics';
import type { Vec3 } from '../physics';
import { colliderHalfExtents, EventStream, finitePositive, horizontal, magnitude, unit } from './internal';

export interface DominoOptions {
  neighbourRadius?: number;
  toppleAngle?: number;
  minKnockSpeed?: number;
  /** Horizontal speed added to a neighbour at its upper half (m/s). */
  neighbourKickSpeed?: number;
}
interface Domino {
  handle: number;
  settings: Required<DominoOptions>;
  triggered: boolean;
  toppled: boolean;
}
export interface SodaOptions {
  impactThreshold?: number;
  radius?: number;
  shoveImpulse?: number;
}
interface Soda {
  handle: number;
  impactThreshold: number;
  radius: number;
  shoveImpulse: number;
  shaken: number;
  popped: boolean;
}
export type ChainEvent =
  | { type:'knock'; time:number; bodyHandle:number; neighbourHandles:number[] }
  | { type:'topple'; time:number; bodyHandle:number; tiltRadians:number }
  | { type:'sodaPop'; time:number; bodyHandle:number; mass:number; affectedHandles:number[] };

/**
 * Wake-and-nudge neighbour propagation, plus a harmless fizzy soda pop.
 * Each domino only propagates once, so long rows cannot trigger infinite loops.
 */
export class ChainReactions {
  readonly events = new EventStream<ChainEvent>();
  private readonly dominos = new Map<number, Domino>();
  private readonly sodas = new Map<number, Soda>();
  private readonly pendingSoda = new Set<number>();
  private readonly newContactPairs = new Set<string>();
  private readonly offContact: () => void;
  private readonly offStep: () => void;
  constructor(readonly physics: PhysicsWorld) {
    this.offContact = physics.onContact(event => {
      const pair = Math.min(event.colliderA,event.colliderB) + ':' + Math.max(event.colliderA,event.colliderB);
      if (event.type === 'begin') { this.newContactPairs.add(pair); return; }
      if (event.type !== 'impact' || !this.newContactPairs.has(pair)) return;
      for (const handle of [event.bodyA,event.bodyB]) {
        if (handle === null) continue;
        const soda = this.sodas.get(handle);
        if (soda && !soda.popped) {
          soda.shaken += event.impulse;
          if (soda.shaken >= soda.impactThreshold) this.pendingSoda.add(handle);
        }
      }
    });
    this.offStep = physics.onAfterStep(() => {
      for (const handle of this.pendingSoda) this.pop(handle);
      this.pendingSoda.clear();
      this.newContactPairs.clear();
      this.updateDominos();
    });
  }
  registerDomino(body: RigidBody, options: DominoOptions = {}): () => void {
    if (!body.isDynamic()) throw new Error('Dominos must be dynamic');
    const settings = {
      neighbourRadius: options.neighbourRadius ?? 1.25,
      toppleAngle: options.toppleAngle ?? .42,
      minKnockSpeed: options.minKnockSpeed ?? .7,
      neighbourKickSpeed: options.neighbourKickSpeed ?? 1.8,
    };
    for (const [key,value] of Object.entries(settings)) finitePositive(value,key);
    this.dominos.set(body.handle,{handle:body.handle,settings,triggered:false,toppled:false});
    return () => { this.dominos.delete(body.handle); };
  }
  registerSoda(body: RigidBody, options: SodaOptions = {}): () => void {
    if (!body.isDynamic()) throw new Error('Soda crate must be dynamic');
    const impactThreshold = options.impactThreshold ?? 10, radius = options.radius ?? 4;
    const shoveImpulse = options.shoveImpulse ?? 35;
    for (const [key,value] of Object.entries({impactThreshold,radius,shoveImpulse})) finitePositive(value,key);
    this.sodas.set(body.handle,{handle:body.handle,impactThreshold,radius,shoveImpulse,shaken:0,popped:false});
    return () => { this.sodas.delete(body.handle); };
  }
  /** Add shaken energy (N·s); a sufficiently hard hit pops once. */
  shakeSoda(body: RigidBody, impulse: number): boolean {
    if (!Number.isFinite(impulse) || impulse < 0) throw new RangeError('shake must be nonnegative');
    const soda = this.sodas.get(body.handle);
    if (!soda || soda.popped) return false;
    soda.shaken += impulse;
    return soda.shaken >= soda.impactThreshold && this.pop(body.handle);
  }
  private pop(handle: number): boolean {
    const soda = this.sodas.get(handle), body = this.physics.raw.getRigidBody(handle);
    if (!soda || soda.popped || !body || !body.isValid()) return false;
    soda.popped = true;
    const mass = body.mass(), center = { ...body.translation() };
    // This is a radial playful shove: no projectiles, combustion or weapon damage.
    const affected = applyExplosion(this.physics,center,soda.radius,soda.shoveImpulse,b => b.handle===handle);
    body.applyImpulse(V(0,mass*2,0),true);
    this.events.emit({type:'sodaPop',time:this.physics.time,bodyHandle:handle,mass,
      affectedHandles:affected.map(a=>a.bodyHandle)});
    return true;
  }
  private updateDominos(): void {
    for (const [handle, domino] of this.dominos) {
      const body = this.physics.raw.getRigidBody(handle);
      if (!body || !body.isValid()) { this.dominos.delete(handle); continue; }
      const upright = rotate(body.rotation(),V(0,1,0)).y;
      const tilt = Math.acos(Math.max(-1,Math.min(1,upright)));
      if (!domino.toppled && tilt >= domino.settings.toppleAngle) {
        domino.toppled = true;
        this.events.emit({type:'topple',time:this.physics.time,bodyHandle:handle,tiltRadians:tilt});
      }
      if (domino.triggered ||
          (tilt < domino.settings.toppleAngle && magnitude(body.linvel()) < domino.settings.minKnockSpeed)) continue;
      domino.triggered = true;
      const neighbours: number[] = [];
      const center = body.translation();
      for (const [otherHandle, other] of this.dominos) {
        if (otherHandle === handle || other.triggered) continue;
        const target = this.physics.raw.getRigidBody(otherHandle);
        if (!target || !target.isValid()) continue;
        const delta = horizontal(V(target.translation().x-center.x,0,target.translation().z-center.z));
        const dist = magnitude(delta);
        if (dist < .02 || dist > domino.settings.neighbourRadius) continue;
        const dir = unit(delta), h = target.numColliders() ? colliderHalfExtents(target.collider(0)).y : .5;
        target.wakeUp();
        const impulse = target.mass() * domino.settings.neighbourKickSpeed;
        target.applyImpulseAtPoint(V(dir.x*impulse,0,dir.z*impulse),
          V(target.translation().x,target.translation().y + Math.max(.2,h*.7),target.translation().z),true);
        neighbours.push(otherHandle);
      }
      this.events.emit({type:'knock',time:this.physics.time,bodyHandle:handle,neighbourHandles:neighbours});
    }
  }
  dispose(): void {
    this.offContact(); this.offStep();
    this.dominos.clear(); this.sodas.clear(); this.pendingSoda.clear();
    this.newContactPairs.clear(); this.events.clear();
  }
}
