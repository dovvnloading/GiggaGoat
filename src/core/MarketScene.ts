import { PhysicsWorld, RAPIER, V, add, rotate, collisionGroups, type Vec3 } from '../physics';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { IslandData, ColliderBuild } from '../world';
import type { DynamicBodyBudget } from '../chaos';

export const MARKET_CRATE_ID = 'downtown-market-produce-crate';
export const MARKET_FRUIT_LIMIT = 6;
export interface MarketFruit {
  id: string;
  model: 'apple' | 'orange';
  radius: number;
  position: Vec3;
  rotation: { x: number; y: number; z: number; w: number };
  visible: boolean;
  body?: RigidBody;
}

/** A finite physical micro-scene on the existing, interactive produce crate.
 * Fruit never creates money, damage, actors, saves or an independent reward loop.
 * Six shared-budget bodies are the maximum, even under repeated headbutts.
 */
export class MarketScene {
  readonly items: MarketFruit[] = [];
  readonly listeners = new Set<(position: Vec3) => void>();
  private readonly offsets: Vec3[] = [];
  private spilledAt = -Infinity;
  private enabled = true;
  private finished = false;
  private disposed = false;
  private readonly crate: RigidBody | undefined;

  constructor(private readonly physics: PhysicsWorld, island: IslandData,
    colliders: ColliderBuild, private readonly budget: DynamicBodyBudget) {
    const prop = island.props.find(p => p.id === MARKET_CRATE_ID);
    this.crate = colliders.bodies.get(MARKET_CRATE_ID);
    if (!prop || !this.crate?.isValid()) return;
    const radius = .145 * island.size / 600;
    for (let i = 0; i < MARKET_FRUIT_LIMIT; i++) {
      this.offsets.push(V((i % 3 - 1) * radius * 2.25, prop.size.y / 2 + radius,
        (Math.floor(i / 3) - .5) * radius * 2.3));
      this.items.push({ id: 'living-market-fruit-' + i, model: i % 2 ? 'orange' : 'apple',
        radius, position: V(), rotation: {x:0,y:0,z:0,w:1}, visible: true });
    }
    this.attach();
  }

  get activeBodies(): number { return this.items.reduce((n, item) => n + (item.body?.isValid() ? 1 : 0), 0); }
  get spilled(): boolean { return this.spilledAt !== -Infinity; }

  /** Apply mode policy before the next physics tick, not after contacts occur. */
  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    for (const item of this.items) if (item.body?.isValid()) item.body.setEnabled(enabled);
  }

  private attach(): void {
    if (!this.crate?.isValid()) return;
    const at = this.crate.translation(), rotation = this.crate.rotation();
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      Object.assign(item.position, add(at, rotate(rotation, this.offsets[i]!)));
      Object.assign(item.rotation, rotation);
    }
  }

  /** Only a real hit, destruction or physical displacement of this exact crate can spill it. */
  disrupt(crateId: string, direction: Vec3, power: number, time: number): boolean {
    if (crateId !== MARKET_CRATE_ID || !this.enabled || this.spilled || this.finished || this.disposed ||
      !this.items.length || !Number.isFinite(time) || !Number.isFinite(power) ||
      !Number.isFinite(direction.x) || !Number.isFinite(direction.y) || !Number.isFinite(direction.z)) return false;
    // Reserve the complete finite burst or keep the display intact under pressure.
    if (this.budget.available < this.items.length) return false;
    this.attach();
    const strength = Math.max(.6, Math.min(2.2, power));
    const length = Math.hypot(direction.x, direction.z) || 1;
    this.spilledAt = time;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!, p = item.position;
      const body = this.physics.raw.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z).setCcdEnabled(true).setLinearDamping(.22).setAngularDamping(.7));
      this.physics.raw.createCollider(RAPIER.ColliderDesc.ball(item.radius)
        .setMass(.22).setFriction(.7).setRestitution(.26)
        .setCollisionGroups(collisionGroups('prop'))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), body);
      this.physics.registerBody(body, { kind:'prop', owner:item.id, data:'fruit' });
      // This scene owns hidden cleanup; ordinary budget sleepers retain their old policy.
      if (!this.budget.admit(body, {cleanupWhenSleeping:false})) {
        this.physics.removeBody(body); continue;
      }
      body.setLinvel(V(direction.x / length * strength + (i % 3 - 1) * .55,
        1.6 + (i % 2) * .5, direction.z / length * strength + (Math.floor(i / 3) - .5) * .65), true);
      body.setAngvel(V(i % 2 ? 3 : -3, 1.5, 2), true);
      item.body = body;
    }
    for (const listener of this.listeners) listener({ ...this.items[0]!.position });
    return true;
  }

  update(time: number, player: Vec3, enabled: boolean, tideLevel: number): void {
    if (this.disposed || this.finished) return;
    this.setEnabled(enabled);
    if (!this.spilled) {
      if (this.crate?.isValid()) {
        this.attach();
        const v = this.crate.linvel(), q = this.crate.rotation();
        if (enabled && (Math.hypot(v.x, v.z) > 1.6 || 2 * (q.x * q.x + q.z * q.z) > .28))
          this.disrupt(MARKET_CRATE_ID, v, 1, time);
      } else {
        // Destruction gets one synchronous spill through the real break event.
        // If that was suppressed or the shared budget could not admit all six,
        // the vanished source cannot leave floating fruit or retry a later burst.
        this.clearBodies();
        this.finished = true;
      }
      return;
    }
    let allHidden = true;
    for (const item of this.items) {
      const body = item.body;
      if (!body?.isValid()) { item.visible = false; continue; }
      Object.assign(item.position, body.translation());
      Object.assign(item.rotation, body.rotation());
      const p = item.position;
      // No on-screen time-to-live pop. Cleanup only well outside near visibility or submerged.
      if (Math.hypot(p.x-player.x,p.y-player.y,p.z-player.z) < 110 && p.y > tideLevel - .7) allHidden = false;
    }
    if (enabled && time - this.spilledAt > 24 && allHidden) {
      this.clearBodies();
      this.finished = true; // No invisible crate restoration or repeated-spawn economy.
    }
  }

  private clearBodies(): void {
    for (const item of this.items) {
      if (item.body?.isValid()) {
        this.budget.release(item.body);
        this.physics.removeBody(item.body);
      }
      delete item.body;
      item.visible = false;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearBodies();
    this.listeners.clear();
  }
}
