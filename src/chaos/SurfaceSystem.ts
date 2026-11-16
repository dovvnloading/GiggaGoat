import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import { PhysicsWorld, RAPIER, V } from '../physics';
import type { Vec3 } from '../physics';
import { EventStream, finitePositive, horizontal, magnitude, unit } from './internal';

export type MaterialName = 'grass' | 'rock' | 'wood' | 'ice' | 'mud' | 'rubber';
export interface PhysicsMaterial { readonly friction: number; readonly restitution: number }
/** Tuned for readable arcade movement, not scientifically exact soil mechanics. */
export const PHYSICS_MATERIALS: Readonly<Record<MaterialName, PhysicsMaterial>> = Object.freeze({
  grass: {friction:1.05,restitution:.04},
  rock: {friction:.9,restitution:.1},
  wood: {friction:.65,restitution:.17},
  ice: {friction:.012,restitution:0},
  mud: {friction:1.65,restitution:0},
  rubber: {friction:1.3,restitution:.9},
});
export function applyPhysicsMaterial(collider: Collider, material: MaterialName): void {
  const settings = PHYSICS_MATERIALS[material];
  collider.setFriction(settings.friction);
  collider.setRestitution(settings.restitution);
  // Ice really stays slippery against default props rather than averaging to wood.
  collider.setFrictionCombineRule(material === 'ice'
    ? RAPIER.CoefficientCombineRule.Min : RAPIER.CoefficientCombineRule.Average);
  collider.setRestitutionCombineRule(material === 'rubber'
    ? RAPIER.CoefficientCombineRule.Max : RAPIER.CoefficientCombineRule.Average);
}
export interface SurfaceOptions {
  id?: string;
  position: Vec3;
  halfExtents: Vec3;
  material?: MaterialName;
}
export interface TrampolineOptions extends SurfaceOptions {
  bounceSpeed?: number;
  cooldownSeconds?: number;
}
export interface LaunchPadOptions extends SurfaceOptions {
  direction: Vec3;
  launchSpeed?: number;
  cooldownSeconds?: number;
}
export interface ConveyorOptions extends SurfaceOptions {
  direction: Vec3;
  speed?: number;
  acceleration?: number;
}
export type SurfaceEvent =
  | { type:'bounce' | 'launch'; time:number; surfaceId:string; bodyHandle:number; speed:number }
  | { type:'conveyorEnter' | 'conveyorExit'; time:number; surfaceId:string; bodyHandle:number };
type SurfaceKind = 'trampoline' | 'launch' | 'conveyor';
interface Surface {
  id: string;
  kind: SurfaceKind;
  body: RigidBody;
  sensor: Collider;
  direction: Vec3;
  speed: number;
  acceleration: number;
  cooldown: number;
  lastUsed: Map<number,number>;
  touching: Set<number>;
}
/**
 * Small real fixed platforms with sensor skins. Only intersecting colliders are
 * enumerated; no O(number of props) spatial scan for each pad.
 */
export class SurfaceSystem {
  readonly events = new EventStream<SurfaceEvent>();
  private readonly surfaces = new Map<string, Surface>();
  private readonly unsubscribe: () => void;
  private nextId = 0;
  constructor(readonly physics: PhysicsWorld) {
    this.unsubscribe = physics.onAfterStep(dt => this.step(dt));
  }
  get count(): number { return this.surfaces.size; }
  createTrampoline(options: TrampolineOptions): string {
    return this.create('trampoline', options, V(0,1,0),
      options.bounceSpeed ?? 10, 0, options.cooldownSeconds ?? .55);
  }
  createLaunchPad(options: LaunchPadOptions): string {
    if (!magnitude(options.direction)) throw new RangeError('launch direction cannot be zero');
    return this.create('launch', options, unit(options.direction),
      options.launchSpeed ?? 12, 0, options.cooldownSeconds ?? 1);
  }
  createConveyor(options: ConveyorOptions): string {
    if (!magnitude(horizontal(options.direction))) throw new RangeError('conveyor direction must be horizontal');
    return this.create('conveyor', options, unit(horizontal(options.direction)),
      options.speed ?? 3.5, options.acceleration ?? 15, 0);
  }
  private create(kind: SurfaceKind, opts: SurfaceOptions, direction: Vec3,
    speed: number, acceleration: number, cooldown: number): string {
    for (const value of [...Object.values(opts.position), ...Object.values(opts.halfExtents)]) {
      if (!Number.isFinite(value)) throw new RangeError('surface dimensions must be finite');
    }
    for (const h of Object.values(opts.halfExtents)) finitePositive(h,'surface halfExtent');
    finitePositive(speed,'surface speed');
    if (!Number.isFinite(acceleration) || acceleration < 0) throw new RangeError('acceleration must be nonnegative');
    if (!Number.isFinite(cooldown) || cooldown < 0) throw new RangeError('cooldown must be nonnegative');
    const id = opts.id ?? 'surface-' + this.nextId++;
    if (this.surfaces.has(id)) throw new Error('duplicate surface id: ' + id);
    const p=opts.position, h=opts.halfExtents;
    const body = this.physics.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(p.x,p.y,p.z));
    const collider = this.physics.raw.createCollider(RAPIER.ColliderDesc.cuboid(h.x,h.y,h.z),body);
    applyPhysicsMaterial(collider,opts.material ?? (kind === 'trampoline' ? 'rubber' : 'wood'));
    const sensor = this.physics.raw.createCollider(
      RAPIER.ColliderDesc.cuboid(h.x,.32,h.z)
        .setTranslation(0,h.y + .27,0).setSensor(true),body);
    this.physics.registerBody(body,{kind:'chaos-surface',owner:id});
    this.surfaces.set(id,{id,kind,body,sensor,direction,speed,acceleration,cooldown,
      lastUsed:new Map(),touching:new Set()});
    return id;
  }
  remove(id: string): boolean {
    const surface = this.surfaces.get(id);
    if (!surface) return false;
    this.surfaces.delete(id);
    this.physics.removeBody(surface.body);
    return true;
  }
  private step(dt: number): void {
    for (const surface of this.surfaces.values()) {
      const currentlyTouching = new Set<number>();
      this.physics.raw.intersectionPairsWith(surface.sensor, other => {
        const body = other.parent();
        if (!body || !body.isDynamic()) return;
        const handle=body.handle;
        currentlyTouching.add(handle);
        if (surface.kind === 'conveyor') {
          if (!surface.touching.has(handle)) {
            this.events.emit({type:'conveyorEnter',time:this.physics.time,
              surfaceId:surface.id,bodyHandle:handle});
          }
          const velocity = body.linvel();
          const along = velocity.x*surface.direction.x + velocity.z*surface.direction.z;
          const delta = Math.min(surface.acceleration*dt,Math.max(0,surface.speed-along));
          if (delta > 0) body.applyImpulse(V(surface.direction.x*delta*body.mass(),0,
            surface.direction.z*delta*body.mass()),true);
          return;
        }
        const previous = surface.lastUsed.get(handle) ?? -Infinity;
        if (this.physics.time - previous + 1e-9 < surface.cooldown) return;
        if (surface.kind === 'trampoline' && body.linvel().y > 1.5) return;
        const velocity = body.linvel();
        if (surface.kind === 'trampoline') {
          const dv = Math.max(0,surface.speed - velocity.y);
          if (dv > 0) body.applyImpulse(V(0,body.mass()*dv,0),true);
          this.events.emit({type:'bounce',time:this.physics.time,
            surfaceId:surface.id,bodyHandle:handle,speed:surface.speed});
        } else {
          body.applyImpulse(V(surface.direction.x*surface.speed*body.mass(),
            surface.direction.y*surface.speed*body.mass(),
            surface.direction.z*surface.speed*body.mass()),true);
          this.events.emit({type:'launch',time:this.physics.time,
            surfaceId:surface.id,bodyHandle:handle,speed:surface.speed});
        }
        surface.lastUsed.set(handle,this.physics.time);
      });
      if (surface.kind === 'conveyor') {
        for (const handle of surface.touching) if (!currentlyTouching.has(handle)) {
          this.events.emit({type:'conveyorExit',time:this.physics.time,
            surfaceId:surface.id,bodyHandle:handle});
        }
      }
      surface.touching = currentlyTouching;
      // Prevent maps accumulating handles from years of spawned/despawned props.
      if (this.physics.stepCount % 120 === 0) {
        for (const [handle,time] of surface.lastUsed)
          if (!this.physics.raw.getRigidBody(handle) ||
              this.physics.time-time > Math.max(3,surface.cooldown*2)) surface.lastUsed.delete(handle);
      }
    }
  }
  dispose(): void {
    this.unsubscribe();
    for (const id of [...this.surfaces.keys()]) this.remove(id);
    this.events.clear();
  }
}
