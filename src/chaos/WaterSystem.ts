import type { RigidBody } from '@dimforge/rapier3d-compat';
import { PhysicsWorld, V } from '../physics';
import type { Vec3 } from '../physics';
import { clamp01, colliderWorldExtents, EventStream, finitePositive, horizontal, magnitude, unit } from './internal';

export interface WaterVolume {
  readonly id: string;
  readonly center: Vec3;
  readonly halfExtents: Vec3;
  readonly flow: Vec3;
  readonly containsXZ?: (x: number, z: number) => boolean;
  /** World height within the volume's envelope, for sloped water surfaces. */
  readonly surfaceYAt?: (x: number, z: number) => number;
}
export interface WaterOptions {
  seaLevel?: number;
  /** Fluid density, kg/m^3. Default 1000 (fresh water). */
  density?: number;
  /** Velocity relaxation per second in water. Default 2.5. */
  linearDrag?: number;
  /** Angular velocity relaxation per second. Default 3. */
  angularDrag?: number;
  splashSpeed?: number;
  /** Maximum buoyancy acceleration, m/s^2; avoids light-prop explosions. */
  maxBuoyancyAcceleration?: number;
}
export type WaterEvent =
  | { type: 'enter' | 'exit'; time: number; bodyHandle: number; mass: number; impactSpeed: number; volumeId: string }
  | { type: 'splash'; time: number; bodyHandle: number; mass: number; impactSpeed: number; volumeId: string; displacedVolume: number };
export interface WaterBodyOptions {
  /** Multiplier for displaced volume, e.g. foam or a paddling goat's flotation aid. */
  buoyancyScale?: number;
  /** Paddle target speed in metres per second. Default 2.2. */
  paddleSpeed?: number;
}
interface TrackedBody {
  body: RigidBody;
  options: Required<WaterBodyOptions>;
  paddle: Vec3;
  wet: boolean;
  volumeId: string;
}
interface Immersion { displaced: number; fraction: number; flow: Vec3; volumeId: string }

/**
 * Fixed-tick water with a mutable infinite sea and bounded local water volumes.
 * Track dynamic bodies explicitly: this costs O(tracked colliders + local volumes) per tick.
 * Water volumes are math regions, not solid colliders, so they do not impede the goat.
 */
export class WaterSystem {
  readonly events = new EventStream<WaterEvent>();
  readonly physics: PhysicsWorld;
  private readonly tracked = new Map<number, TrackedBody>();
  private readonly volumes = new Map<string, WaterVolume>();
  private readonly unsubscribe: () => void;
  private nextId = 0;
  private _seaLevel: number;
  readonly density: number;
  readonly linearDrag: number;
  readonly angularDrag: number;
  readonly splashSpeed: number;
  readonly maxBuoyancyAcceleration: number;

  constructor(physics: PhysicsWorld, options: WaterOptions = {}) {
    this.physics = physics;
    this._seaLevel = options.seaLevel ?? 0;
    this.density = options.density ?? 1000;
    this.linearDrag = options.linearDrag ?? 2.5;
    this.angularDrag = options.angularDrag ?? 3;
    this.splashSpeed = options.splashSpeed ?? 2.5;
    this.maxBuoyancyAcceleration = options.maxBuoyancyAcceleration ?? 32;
    if (!Number.isFinite(this._seaLevel)) throw new RangeError('seaLevel must be finite');
    for (const [name, value] of Object.entries({ density: this.density,
      linearDrag: this.linearDrag, angularDrag: this.angularDrag,
      splashSpeed: this.splashSpeed, maxBuoyancyAcceleration: this.maxBuoyancyAcceleration })) {
      if (!Number.isFinite(value) || (name === 'density' ? value <= 0 : value < 0)) {
        throw new RangeError(name + ' must be finite and nonnegative (density positive)');
      }
    }
    this.unsubscribe = physics.onBeforeStep(dt => this.step(dt));
  }
  get seaLevel(): number { return this._seaLevel; }
  setSeaLevel(height: number): void {
    if (!Number.isFinite(height)) throw new RangeError('seaLevel must be finite');
    if (height !== this._seaLevel) {
      this._seaLevel = height;
      // Previously sleeping dry props must respond to rising tide.
      for (const tracked of this.tracked.values()) tracked.body.wakeUp();
    }
  }
  addVolume(input: Omit<WaterVolume, 'id'> & { id?: string }): string {
    const { center, halfExtents, flow } = input;
    for (const n of [...Object.values(center), ...Object.values(halfExtents), ...Object.values(flow)]) {
      if (!Number.isFinite(n)) throw new RangeError('water volume components must be finite');
    }
    for (const n of Object.values(halfExtents)) finitePositive(n, 'water halfExtent');
    const id = input.id ?? 'water-' + this.nextId++;
    if (id === 'sea' || this.volumes.has(id)) throw new Error('duplicate or reserved water volume id: ' + id);
    this.volumes.set(id, { id, center: { ...center }, halfExtents: { ...halfExtents }, flow: { ...flow },
      ...(input.containsXZ ? { containsXZ: input.containsXZ } : {}),
      ...(input.surfaceYAt ? { surfaceYAt: input.surfaceYAt } : {}) });
    return id;
  }
  removeVolume(id: string): boolean { return this.volumes.delete(id); }
  listVolumes(): WaterVolume[] { return [...this.volumes.values()]; }
  track(body: RigidBody, options: WaterBodyOptions = {}): () => void {
    if (!body.isDynamic()) throw new Error('Only dynamic bodies can float');
    const buoyancyScale = options.buoyancyScale ?? 1;
    const paddleSpeed = options.paddleSpeed ?? 2.2;
    if (!Number.isFinite(buoyancyScale) || buoyancyScale < 0) throw new RangeError('buoyancyScale must be nonnegative');
    if (!Number.isFinite(paddleSpeed) || paddleSpeed < 0) throw new RangeError('paddleSpeed must be nonnegative');
    this.tracked.set(body.handle, {
      body, options: { buoyancyScale, paddleSpeed }, paddle: V(), wet: false, volumeId: 'sea',
    });
    return () => this.untrack(body);
  }
  untrack(body: RigidBody): void { this.tracked.delete(body.handle); }
  /** Input in the horizontal X/Z plane, magnitude capped at one. */
  setPaddle(body: RigidBody, input: Vec3): void {
    const tracked = this.tracked.get(body.handle);
    if (!tracked) throw new Error('Paddling body must be tracked');
    if (![input.x, input.y, input.z].every(Number.isFinite)) throw new RangeError('paddle input must be finite');
    const planar = horizontal(input), length = magnitude(planar);
    tracked.paddle = length > 1 ? unit(planar) : planar;
  }
  get submergedCount(): number { return [...this.tracked.values()].filter(t => t.wet).length; }
  /** Returns current displaced volume; also useful for debug waterline visualisation. */
  sample(body: RigidBody): Immersion { return this.immersion(body); }

  private immersion(body: RigidBody): Immersion {
    let displaced = 0, fullVolume = 0, weightedFlow = V(), dominantId = 'sea', dominantAmount = 0;
    for (let i = 0; i < body.numColliders(); i++) {
      const c = body.collider(i);
      if (!c || c.isSensor()) continue;
      const volume = c.volume();
      if (!(volume > 0) || !Number.isFinite(volume)) continue;
      fullVolume += volume;
      const p = c.translation(), h = colliderWorldExtents(c);
      const bottom = p.y - h.y, top = p.y + h.y;
      const height = Math.max(1e-6, top - bottom);
      let fraction = clamp01((this._seaLevel - bottom) / height);
      let flow = V(), volumeId = 'sea';
      for (const local of this.volumes.values()) {
        const a = local.halfExtents, o = local.center;
        const lowest = Math.max(bottom, o.y - a.y);
        const highest = Math.min(top, o.y + a.y);
        if (highest <= lowest) continue;
        const left = Math.max(p.x - h.x, o.x - a.x), right = Math.min(p.x + h.x, o.x + a.x);
        const rear = Math.max(p.z - h.z, o.z - a.z), front = Math.min(p.z + h.z, o.z + a.z);
        const overlapX = right - left, overlapZ = front - rear;
        if (overlapX <= 0 || overlapZ <= 0) continue;
        const surface = local.surfaceYAt?.((left + right) / 2, (rear + front) / 2) ?? highest;
        const overlapY = Math.min(highest, surface) - lowest;
        if (overlapY <= 0) continue;
        const footprint = clamp01(overlapX / Math.max(2 * h.x, 1e-6)) *
          clamp01(overlapZ / Math.max(2 * h.z, 1e-6));
        let wetShare = 1;
        if (local.containsXZ) {
          // Sample the overlap at cell centres so a hull can straddle the bank.
          let wet = 0;
          for (const x of [1 / 6, .5, 5 / 6]) for (const z of [1 / 6, .5, 5 / 6]) {
            if (local.containsXZ(left + x * overlapX, rear + z * overlapZ)) wet++;
          }
          wetShare = wet / 9;
        }
        const localFraction = wetShare * footprint * clamp01(overlapY / height);
        // Local currents win an equal-depth tie with the ambient sea.
        if (localFraction >= fraction && localFraction > 0) {
          fraction = localFraction; flow = local.flow; volumeId = local.id;
        }
      }
      const amount = volume * fraction;
      displaced += amount;
      weightedFlow.x += amount * flow.x;
      weightedFlow.y += amount * flow.y;
      weightedFlow.z += amount * flow.z;
      if (amount > dominantAmount) { dominantAmount = amount; dominantId = volumeId; }
    }
    return { displaced, fraction: fullVolume > 0 ? clamp01(displaced / fullVolume) : 0,
      flow: displaced > 0 ? V(weightedFlow.x/displaced,weightedFlow.y/displaced,weightedFlow.z/displaced) : V(),
      volumeId: dominantId };
  }
  private step(dt: number): void {
    // Impulses are one-shot; do not use persistent Rapier addForce each tick.
    for (const [handle, tracked] of this.tracked) {
      const body = this.physics.raw.getRigidBody(handle);
      if (!body || !body.isValid() || !body.isDynamic()) { this.tracked.delete(handle); continue; }
      const immersion = this.immersion(body);
      const wet = immersion.displaced > 1e-7;
      const velocity = body.linvel();
      const mass = body.mass();
      const impactSpeed = Math.max(0, immersion.flow.y - velocity.y);
      if (wet !== tracked.wet) {
        this.events.emit({type:wet?'enter':'exit',time:this.physics.time,bodyHandle:handle,
          mass,impactSpeed,volumeId:wet?immersion.volumeId:tracked.volumeId});
        if (wet && impactSpeed >= this.splashSpeed) {
          this.events.emit({type:'splash',time:this.physics.time,bodyHandle:handle,
            mass,impactSpeed,volumeId:immersion.volumeId,displacedVolume:immersion.displaced});
        }
      }
      tracked.wet = wet;
      tracked.volumeId = immersion.volumeId;
      if (!wet || !(mass > 0)) continue;
      const fraction = immersion.fraction;
      const up = Math.min(this.maxBuoyancyAcceleration,
        this.density * Math.max(0,-this.physics.raw.gravity.y) *
        immersion.displaced * tracked.options.buoyancyScale / mass);
      const drag = Math.min(.9, this.linearDrag * fraction * dt);
      const paddle = tracked.paddle, target = V(
        immersion.flow.x + paddle.x * tracked.options.paddleSpeed,
        immersion.flow.y, immersion.flow.z + paddle.z * tracked.options.paddleSpeed);
      const dv = V((target.x - velocity.x)*drag, up*dt + (target.y-velocity.y)*drag,
        (target.z - velocity.z)*drag);
      body.applyImpulse(V(dv.x*mass, dv.y*mass, dv.z*mass), true);
      const spin = body.angvel();
      const spinDrag = Math.min(.65, this.angularDrag * fraction * dt);
      // Approximate angular impulse using mass and mean squared collider radius.
      let radius2 = 0;
      for (let i=0;i<body.numColliders();i++) {
        const c=body.collider(i);
        if (!c || c.isSensor()) continue;
        const h=colliderWorldExtents(c);
        radius2 = Math.max(radius2, (h.x*h.x+h.y*h.y+h.z*h.z)/3);
      }
      const inertia = mass * radius2 * .4;
      body.applyTorqueImpulse(V(-spin.x*inertia*spinDrag,-spin.y*inertia*spinDrag,-spin.z*inertia*spinDrag),true);
    }
  }
  dispose(): void { this.unsubscribe(); this.tracked.clear(); this.volumes.clear(); this.events.clear(); }
}
