import RAPIER, { type ImpulseJoint, type RigidBody, type Collider } from '@dimforge/rapier3d-compat';
import type { GoatRagdoll } from './GoatRagdoll';
import type { PhysicsWorld } from './PhysicsWorld';
import { add, clamp, distance, dot, forward, length, localPoint, mul, normalize,
  sub, V, worldPoint, type Vec3 } from './math';

export interface KnockedBody {
  bodyHandle: number;
  mass: number;
  speed: number;
  impulse: number;
}
/** Applied at a world-space point to create both linear and angular motion. */
export function applyImpulseAt(body: RigidBody, impulse: Vec3, point = body.translation()): void {
  if (body.isDynamic()) body.applyImpulseAtPoint(impulse, point, true);
}
/** Physics-only utility: returns real affected bodies for gameplay to score. */
export function applyExplosion(world: PhysicsWorld, center: Vec3, radius: number,
  impulse: number, ignore?: (body: RigidBody) => boolean): KnockedBody[] {
  if (!(radius > 0) || !(impulse > 0)) return [];
  const affected: KnockedBody[] = [];
  world.raw.forEachRigidBody(body => {
    if (!body.isDynamic() || ignore?.(body)) return;
    const delta = sub(body.translation(),center);
    const d = length(delta);
    if (d >= radius) return;
    const falloff = (1-d/radius)**2;
    const direction = d > 1e-4 ? mul(delta,1/d) : V(0,1,0);
    const kick = mul(direction,impulse*falloff);
    applyImpulseAt(body,kick);
    affected.push({bodyHandle:body.handle,mass:body.mass(),
      speed:length(body.linvel()),impulse:length(kick)});
  });
  return affected;
}
export interface InteractionTuning {
  headbuttRange: number;
  headbuttCooldown: number;
  bleatRadius: number;
  bleatImpulse: number;
  bleatCooldown: number;
  tongueRange: number;
  tongueSpring: number;
  tongueDamping: number;
  tongueBreakForce: number;
  tongueReelSpeed: number;
}
interface Tether {
  target: RigidBody;
  targetLocal: Vec3;
  headLocal: Vec3;
  length: number;
  maxLength: number;
  joint: ImpulseJoint;
  anchorBody: RigidBody | null;
}
export class GoatInteractions {
  readonly tuning: InteractionTuning = {
    headbuttRange: 1.95, headbuttCooldown: .28,
    bleatRadius: 3.1, bleatImpulse: 34, bleatCooldown: .9,
    tongueRange: 9, tongueSpring: 180, tongueDamping: 17,
    tongueBreakForce: 550, tongueReelSpeed: 3.5,
  };
  private lastHeadbutt = -Infinity;
  private lastBleat = -Infinity;
  private tether: Tether | null = null;
  private reelDirection = 0;
  constructor(private readonly goat: GoatRagdoll) {}
  get isTongueAttached(): boolean { return this.tether !== null; }
  get tongueLength(): number | null { return this.tether?.length ?? null; }
  get tongueBody(): RigidBody | null { return this.tether?.target ?? null; }
  get tongueJoint(): ImpulseJoint | null { return this.tether?.joint ?? null; }
  get tongueOrigin(): Vec3 {
    const g = this.goat;
    return worldPoint(g.head.translation(), g.head.rotation(), V(0, 0, -.2 * g.size));
  }

  /** Keep the same attachment point when an already-held parcel outlives the head body. */
  rebuildHeadWithDynamicTether(rebuild: () => void): void {
    const tether = this.tether;
    if (!tether || tether.anchorBody || !tether.target.isDynamic()) {
      this.detachTongue('replaced');
      rebuild();
      return;
    }
    const g = this.goat;
    g.world.raw.removeImpulseJoint(tether.joint, true);
    this.tether = null;
    rebuild();

    const headLocal = V(0, 0, -.2 * g.size);
    const maxLength = this.tuning.tongueRange * g.size;
    const headPoint = worldPoint(g.head.translation(), g.head.rotation(), headLocal);
    const targetPoint = worldPoint(tether.target.translation(), tether.target.rotation(), tether.targetLocal);
    const gap = distance(headPoint, targetPoint);
    if (gap > maxLength) {
      this.reelDirection = 0;
      g.events.emit({ type: 'tongueDetach', goatId: g.id, time: g.world.time, reason: 'replaced' });
      return;
    }
    const length = clamp(Math.max(tether.length, gap + .05 * g.size), .3 * g.size, maxLength);
    const joint = g.world.raw.createImpulseJoint(
      RAPIER.JointData.rope(length, headLocal, tether.targetLocal), g.head, tether.target, true);
    this.tether = { ...tether, joint, headLocal, length, maxLength };
  }

  private emitKnock(body: RigidBody, impulse: number): void {
    if (!body.isDynamic() || this.goat.ownsBody(body)) return;
    const g = this.goat;
    g.events.emit({type:'knockedBody',goatId:g.id,time:g.world.time,
      bodyHandle:body.handle,mass:body.mass(),speed:length(body.linvel()),impulse});
  }

  /** 0 = tap, 1 = full charge. Returns the first body actually struck. */
  headbutt(charge = 0): RigidBody | null {
    const g = this.goat, time = g.world.time;
    if (time - this.lastHeadbutt < this.tuning.headbuttCooldown || g.isRagdoll) return null;
    this.lastHeadbutt = time;
    const c = clamp(charge,0,1), s = g.size;
    const facing = forward(g.locomotion.heading);
    // The lunge is physical, so the torso and linked body follow through.
    const lunge = mul(add(facing,V(0,.12,0)),g.mass*(.35+c*1.55));
    g.torso.applyImpulse(lunge,true);
    const origin = worldPoint(g.head.translation(),g.head.rotation(),V(0,0,-.06*s));
    const ignoreOwn = (collider: Collider): boolean => !g.ownsBody(collider.parent());
    const straight = g.world.shapeCast(origin, g.head.rotation(), facing,
      new RAPIER.Ball(.24*s), this.tuning.headbuttRange*s, {predicate:ignoreOwn});
    // Head height exceeds a floor crate's height: allow a downward grazing hit.
    const angled = g.world.raycast(origin,add(facing,V(0,-.58,0)),
      this.tuning.headbuttRange*s,{predicate:ignoreOwn});
    const hit = straight && angled
      ? (straight.distance <= angled.distance ? straight : angled)
      : straight ?? angled;
    const target = hit?.body ?? null;
    if (target?.isDynamic()) {
      const kick = mul(add(facing,V(0,.16,0)),g.mass*(.85+c*2.05));
      // Center-of-mass impulse ensures a clear shove, while the contact-point
      // component adds the wobbly rotation expected from an off-centre hit.
      target.applyImpulse(mul(kick,.7),true);
      applyImpulseAt(target,mul(kick,.3),hit!.point);
      this.emitKnock(target,length(kick));
      return target;
    }
    return null;
  }

  /** Short range crowd-control shove. Does not apply damage or stamina rules. */
  bleat(): KnockedBody[] {
    const g = this.goat;
    if (g.world.time-this.lastBleat < this.tuning.bleatCooldown || g.isRagdoll) return [];
    this.lastBleat = g.world.time;
    const results = applyExplosion(g.world,g.torso.translation(),
      this.tuning.bleatRadius*g.size,this.tuning.bleatImpulse*g.size**3,
      b=>g.ownsBody(b));
    for (const result of results) {
      const body = g.world.raw.getRigidBody(result.bodyHandle);
      if (body) this.emitKnock(body,result.impulse);
    }
    return results;
  }

  /** Lick the first collider (including a static world collider) along the look ray. */
  attachTongue(direction?: Vec3): boolean {
    const g = this.goat;
    if (this.tether) this.detachTongue('replaced');
    const s = g.size;
    const rayDirection = direction ?? add(forward(g.locomotion.heading),V(0,-.12,0));
    const from = this.tongueOrigin;
    const hit = g.world.raycast(from,rayDirection,this.tuning.tongueRange*s,{
      predicate:collider=>!g.ownsBody(collider.parent()),
    });
    if (!hit) return false;
    let target = hit.body;
    let anchorBody: RigidBody | null = null;
    if (!target) {
      target = g.world.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed()
        .setTranslation(hit.point.x,hit.point.y,hit.point.z));
      g.world.registerBody(target,{kind:'tongueAnchor',owner:g.id});
      anchorBody = target;
    }
    const headLocal = V(0,0,-.2*s);
    const targetLocal = localPoint(target.translation(),target.rotation(),hit.point);
    const lengthMeters = clamp(distance(from,hit.point)+.05*s,.3*s,this.tuning.tongueRange*s);
    const joint = g.world.raw.createImpulseJoint(
      RAPIER.JointData.rope(lengthMeters,headLocal,targetLocal),g.head,target,true);
    this.tether = {target,targetLocal,headLocal,length:lengthMeters,
      maxLength:this.tuning.tongueRange*s,joint,anchorBody};
    g.events.emit({type:'tongueAttach',goatId:g.id,time:g.world.time,
      bodyHandle:target.handle,length:lengthMeters});
    return true;
  }

  /** -1 reels in, +1 pays out, 0 holds. Call from fixed-step gameplay input. */
  setReel(direction: number): void { this.reelDirection = clamp(direction,-1,1); }
  reel(meters: number): void {
    const tether = this.tether;
    if (!tether) return;
    const next = clamp(tether.length+meters,.28*this.goat.size,tether.maxLength);
    if (Math.abs(next-tether.length) < .003*this.goat.size) return;
    const g = this.goat;
    g.world.raw.removeImpulseJoint(tether.joint,true);
    tether.joint = g.world.raw.createImpulseJoint(
      RAPIER.JointData.rope(next,tether.headLocal,tether.targetLocal),
      g.head,tether.target,true);
    tether.length = next;
  }
  update(dt: number): void {
    const tether = this.tether;
    if (!tether) return;
    const g = this.goat;
    if (!g.world.raw.getRigidBody(tether.target.handle)) {
      this.detachTongue('destroyed'); return;
    }
    if (this.reelDirection) this.reel(this.reelDirection*this.tuning.tongueReelSpeed*g.size*dt);
    const headPoint = worldPoint(g.head.translation(),g.head.rotation(),tether.headLocal);
    const targetPoint = worldPoint(tether.target.translation(),tether.target.rotation(),tether.targetLocal);
    const delta = sub(targetPoint,headPoint), d = length(delta);
    if (d < 1e-5) return;
    const direction = mul(delta,1/d);
    const relativeVelocity = dot(sub(tether.target.linvel(),g.head.linvel()),direction);
    const force = Math.max(0,
      (d-tether.length*.86)*this.tuning.tongueSpring*g.size**2 +
      relativeVelocity*this.tuning.tongueDamping*g.size**3);
    const maxForce = this.tuning.tongueBreakForce*g.size**3;
    if (force > maxForce) { this.detachTongue('broken'); return; }
    const impulse = mul(direction,force*dt);
    // Damped spring takes up slack; Rapier rope joint is the hard maximum length.
    applyImpulseAt(g.head,impulse,headPoint);
    applyImpulseAt(tether.target,mul(impulse,-1),targetPoint);
  }
  /** Release under tension to fling the attached dynamic body away from the goat. */
  detachTongue(reason: 'released' | 'broken' | 'replaced' | 'destroyed' = 'released'): void {
    const tether = this.tether;
    if (!tether) return;
    const g = this.goat;
    if (reason === 'released' && tether.target.isDynamic()) {
      const from = g.head.translation(), to = tether.target.translation();
      const tension = Math.max(0,distance(from,to)-tether.length*.7);
      const fling = Math.min(13*g.size,g.mass*tension*.14);
      const impulse = mul(normalize(sub(to,from)),fling);
      applyImpulseAt(tether.target,impulse);
      if (fling > 0) this.emitKnock(tether.target,fling);
    }
    g.world.raw.removeImpulseJoint(tether.joint,true);
    if (tether.anchorBody) g.world.removeBody(tether.anchorBody);
    this.tether = null;
    this.reelDirection = 0;
    g.events.emit({type:'tongueDetach',goatId:g.id,time:g.world.time,reason});
  }
}
