import type { RigidBody, ColliderDesc } from '@dimforge/rapier3d-compat';
import {
  PhysicsWorld, GoatRagdoll, RAPIER, V, forward, add, sub, mul, rotate, collisionGroups,
  type Vec3, type Quat, type GoatSize, type PhysicsEvent,
} from '../physics';
import {
  generateIsland, buildRapierColliders, heightAt, zoneAt,
  type ColliderBuild, type IslandData, type PropDescriptor,
} from '../world';
import {
  GameSimulation, TUNING, type GoatIntent, type GoatPhysicsFacts,
  type AbilityCommands, type BuiltinTrick, type PieceType, type BuildPiece,
} from '../gameplay';
import {
  WaterSystem, BreakableRegistry, ChainReactions, SurfaceSystem,
  DynamicBodyBudget, applyPhysicsMaterial,
} from '../chaos';
import { GigSession } from './GigSession';
import { PartySession } from './PartySession';
import type { GameProgress } from './Persistence';

export const FIXED_DT = 1 / 60;

/** Compose rotations for a whole-ragdoll rescue without modifying joint angles. */
const multiplyRotation = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
export interface PlayerIntent extends GoatIntent {
  moveX?: number;
  moveZ?: number;
  cameraYaw?: number;
  toggleBuild?: boolean;
  placeBuild?: boolean;
  buildPiece?: PieceType;
  graze?: boolean;
  interact?: boolean;
}
export interface SurfaceMarker {
  id: string;
  kind: 'trampoline' | 'launch';
  position: Vec3;
  halfExtents: Vec3;
  direction?: Vec3;
}
export interface FallingPiece { body: RigidBody; type: PieceType; born: number }
export interface GameOptions { seed?: string | number; resolution?: number; progress?: GameProgress }
/** Read-only presentation cue for an ability accepted by the fixed-tick simulation. */
export interface GoatVisualCue { goatId: string; action: 'headbutt' | 'bleat' | 'glide' }
/** Headless, one-shot cues for contact information removed during simulation callbacks. */
export type GameVfxCue =
  | { type: 'headbutt-hit'; position: Vec3; direction: Vec3; power: number }
  | { type: 'crate-break'; position: Vec3; direction: Vec3; size: number };

/**
 * The entire game simulation, including collision, chaos, and scoring, is headless.
 * physics.step is the single clock. No DOM, Three, timers, or browser APIs live here.
 */
export class Game {
  readonly physics: PhysicsWorld;
  readonly island: IslandData;
  readonly colliders: ColliderBuild;
  readonly rules: GameSimulation;
  readonly goat: GoatRagdoll;
  readonly water: WaterSystem;
  readonly breakables: BreakableRegistry;
  readonly chains: ChainReactions;
  readonly surfaces: SurfaceSystem;
  readonly budget: DynamicBodyBudget;
  readonly gigs: GigSession;
  readonly party: PartySession;
  readonly surfaceMarkers: SurfaceMarker[] = [];
  readonly destroyedProps = new Set<string>();
  readonly buildBodies = new Map<number, RigidBody>();
  readonly fallingPieces = new Map<number, FallingPiece>();
  readonly propByBody = new Map<number, PropDescriptor>();
  buildMode = false;
  buildPiece: PieceType = 'floor';
  respawns = 0;
  private readonly off: Array<() => void> = [];
  private readonly visualCueListeners = new Set<(cue: GoatVisualCue) => void>();
  private readonly vfxCueListeners = new Set<(cue: GameVfxCue) => void>();
  private intent: PlayerIntent = {};
  private pendingSize: GoatSize | null = null;
  private drownSeconds = 0;
  private lastY = 0;
  private climbMetres = 0;
  private climbRunMetres = 0;
  private lastTongueTime = 0;
  private lastActionTime = -Infinity;
  private lastStyle = new Map<string, number>();
  private buildOrigin: Vec3;
  private readonly pierDecks: readonly PropDescriptor[];
  private readonly spawnGround: number;
  private disposed = false;

  static async create(options: GameOptions = {}): Promise<Game> {
    const island = generateIsland({
      seed: options.seed ?? 'billy-isle',
      resolution: options.resolution ?? 193,
    });
    const physics = await PhysicsWorld.create({ fixedDt: FIXED_DT, maxSubsteps: 5, solverIterations: 8 });
    try {
      const colliders = buildRapierColliders(physics.raw, island);
      return new Game(physics, island, colliders, options);
    } catch (error) {
      physics.dispose();
      throw error;
    }
  }

  private constructor(physics: PhysicsWorld, island: IslandData, colliders: ColliderBuild, options: GameOptions) {
    this.physics = physics;
    this.island = island;
    this.colliders = colliders;
    this.pierDecks = island.props.filter(prop =>
      prop.poiId === 'baa-ardwalk' && prop.kind === 'pier' && prop.collidable);
    // Restore only validated, complete progression. Any corrupt save is ignored.
    try {
      this.rules = options.progress ? GameSimulation.fromJSON(options.progress.gameplay) :
        new GameSimulation(1987);
    } catch {
      this.rules = new GameSimulation(1987);
    }
    const spawn = island.spawns[0]!;
    const floor = [colliders.terrain, ...colliders.paths];
    const terrainY = heightAt(island, spawn.position.x, spawn.position.z);
    const spawnRay = new RAPIER.Ray(spawn.position, V(0, -1, 0));
    // Cast against the shapes directly. The world broad phase is not populated
    // until the first physics step, and the playable goat must start on asphalt.
    let nearest = Infinity;
    for (const collider of floor) {
      applyPhysicsMaterial(collider, 'grass');
      collider.setCollisionGroups(collisionGroups('terrain'));
      collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      const hit = collider.castRay(spawnRay, spawn.position.y - terrainY + 1, false);
      if (hit >= 0) nearest = Math.min(nearest, hit);
    }
    this.spawnGround = Number.isFinite(nearest) ? spawn.position.y - nearest : terrainY;
    this.buildOrigin = V(0, terrainY, 0);
    this.prepareProps();

    this.budget = new DynamicBodyBudget(physics, 240, 45);
    this.water = new WaterSystem(physics, { seaLevel: island.seaLevel });
    this.addWaterVolumes();
    this.breakables = new BreakableRegistry(physics, {
      maxDebris: 144, debrisLifetime: 18, sleepCleanupSeconds: 4, bodyBudget: this.budget,
    });
    this.chains = new ChainReactions(physics);
    this.surfaces = new SurfaceSystem(physics);
    this.registerChaosProps();
    this.makePlaySurfaces();

    // Registered BEFORE the ragdoll's own before-step hook. Commands therefore
    // reach locomotion and joint motors within the same fixed simulation tick.
    this.off.push(physics.onBeforeStep(dt => this.beforeTick(dt)));
    // World spawn points include 1.25m of clearance for placement checks,
    // whereas GoatRagdoll.position is a *ground-level* origin. Passing the
    // elevated point makes KID fall and tumble before the first playable frame.
    this.goat = new GoatRagdoll(physics, {
      position: V(spawn.position.x, this.spawnGround, spawn.position.z),
      yaw: spawn.heading, size: TUNING.size[this.rules.style.tier].scale,
      id: 'player',
    });
    // GoatRagdoll's yawQuaternion rotates local -Z opposite to the
    // physics lane's forward(yaw) steering vector. The world spawn heading
    // was therefore forcing the balance controller to torque a correctly
    // assembled, stationary goat against its actual facing on every tick.
    // Match its physical facing without changing any physics-lane code.
    this.goat.locomotion.heading = -spawn.heading;
    // Registered after GoatRagdoll's motor hook so standing-only head
    // corrections reach Rapier before the same physical tick is solved.
    this.off.push(physics.onBeforeStep(dt => this.holdStandingHead(dt)));
    this.water.track(this.goat.torso, { buoyancyScale: 0.7, paddleSpeed: 2.6 });
    this.lastY = this.goat.torso.translation().y;
    this.off.push(physics.onAfterStep(dt => this.afterTick(dt)));
    this.off.push(this.goat.events.on(event => this.onGoatEvent(event)));
    this.off.push(this.rules.events.on('size:changed', event => {
      this.pendingSize = TUNING.size[event.to].scale;
    }));
    this.off.push(this.breakables.events.on(event => {
      const prop = this.propByBody.get(event.bodyHandle);
      if (prop?.kind === 'crate') {
        this.sendVfxCue({ type: 'crate-break',
          position: { x: event.position.x,
            y: event.position.y - prop.size.y / 2, z: event.position.z },
          direction: forward(this.goat.locomotion.heading),
          size: Math.max(prop.size.x, prop.size.y, prop.size.z) });
      }
      if (prop) {
        const removed = this.colliders.bodies.get(prop.id);
        if (removed) this.water.untrack(removed);
        this.destroyedProps.add(prop.id);
        this.colliders.bodies.delete(prop.id);
        this.propByBody.delete(event.bodyHandle);
      }
      if (this.nearPlayer(event.position, 24) && this.recentChaos()) {
        this.award('destruction', 1 + Math.min(1, event.mass / 50));
      }
    }));
    this.off.push(this.chains.events.on(event => {
      const body = physics.raw.getRigidBody(event.bodyHandle);
      if (!body || !this.nearPlayer(body.translation(), 20) || !this.recentChaos()) return;
      if (event.type === 'topple') this.award('topple', Math.min(2, event.tiltRadians));
      else if (event.type === 'sodaPop') this.award('destruction', 1.6);
    }));
    this.off.push(this.water.events.on(event => {
      if (event.type !== 'splash') return;
      const body = physics.raw.getRigidBody(event.bodyHandle);
      if (body && (this.goat.ownsBody(body) || this.nearPlayer(body.translation(), 15))) {
        this.award('big-splash', Math.min(2, event.impactSpeed / 6));
      }
    }));
    this.off.push(this.surfaces.events.on(event => {
      if (this.goat.ownsBody(event.bodyHandle) && (event.type === 'bounce' || event.type === 'launch')) {
        this.award(event.type === 'bounce' ? 'ragdoll-bounce' : 'airtime', 1.5);
      }
    }));
    this.installBuildEvents();
    for (const piece of this.rules.build.pieces) this.addBuildBody(piece);
    // Both deterministic lanes are stepped only at completed Rapier tick boundaries.
    try {
      this.gigs = new GigSession(this, island.seed, options.progress?.gigs, options.progress?.gigBodies);
    } catch {
      this.gigs = new GigSession(this, island.seed);
    }
    this.party = new PartySession(this);
  }

  /**
   * At KID scale the neck/head hinge motors sag under the weight of the
   * forward-extending head. A damped physical spring to each body's original
   * *relative* standing anchor gives the six real hinges enough lift during
   * idle, without changing their constraint or the character's render pose.
   * All movement, tricks, climbing and ragdoll states use the native physics.
   */
  private holdStandingHead(dt: number): void {
    const g = this.goat;
    if (g.pose !== 'stand' || g.isRagdoll || g.size !== .6) return;
    const torso = g.torso;
    const origin = torso.translation();
    const orientation = torso.rotation();
    const velocity = torso.linvel();
    const support = (body: RigidBody, rest: Vec3): void => {
      const target = add(origin, rotate(orientation, mul(rest, g.size)));
      const displacement = sub(target, body.translation());
      const relativeVelocity = sub(body.linvel(), velocity);
      const acceleration = sub(mul(displacement, 110), mul(relativeVelocity, 18));
      const magnitude = Math.hypot(acceleration.x, acceleration.y, acceleration.z);
      const limited = mul(acceleration, Math.min(1, 55 / Math.max(1, magnitude)));
      body.applyImpulse(mul(limited, body.mass() * dt), true);
    };
    support(g.neck, V(0, .32, -.62));
    support(g.head, V(0, .56, -.84));
  }

  private prepareProps(): void {
    const descriptors = new Map(this.island.colliders
      .filter(c => c.shape !== 'heightfield').map(c => [c.id, c]));
    for (const prop of this.island.props) {
      const existing = this.colliders.props.get(prop.id);
      if (!existing) continue;
      let body = this.colliders.bodies.get(prop.id);
      // World describes some fences, lamps, signs and benches as "static" AND
      // "breakable". The chaos registry accepts only dynamics. Convert only
      // those explicitly marked breakable, keeping their footprint and yaw.
      if (!body && prop.breakable && prop.body.type === 'static') {
        const desc = descriptors.get(prop.id);
        if (!desc) continue;
        this.physics.raw.removeCollider(existing, true);
        const p = desc.transform.position;
        const a = desc.transform.rotationY;
        const rotation = { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
        body = this.physics.raw.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z).setRotation(rotation)
          .setLinearDamping(.35).setAngularDamping(.48).setCcdEnabled(true));
        let shape: ColliderDesc;
        if (desc.shape === 'cuboid') shape = RAPIER.ColliderDesc.cuboid(desc.size.x / 2, desc.size.y / 2, desc.size.z / 2);
        else if (desc.shape === 'cylinder') shape = RAPIER.ColliderDesc.cylinder(desc.size.y / 2, Math.max(desc.size.x, desc.size.z) / 2);
        else {
          const hull = RAPIER.ColliderDesc.convexHull(desc.vertices!);
          if (!hull) throw new Error('Bad breakable hull: ' + prop.id);
          shape = hull;
        }
        const mass = Math.max(7, Math.min(55, prop.size.x * prop.size.y * prop.size.z * .24));
        const replacement = this.physics.raw.createCollider(shape.setMass(mass), body);
        this.colliders.props.set(prop.id, replacement);
        this.colliders.bodies.set(prop.id, body);
      }
      const collider = this.colliders.props.get(prop.id)!;
      collider.setCollisionGroups(collisionGroups('prop'));
      collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      const material = prop.kind === 'rock' ? 'rock' :
        prop.kind === 'ramp' ? 'wood' : prop.kind === 'hay-bale' ? 'grass' :
        prop.kind === 'bumper' ? 'rubber' : 'wood';
      applyPhysicsMaterial(collider, material);
      if (body) {
        this.physics.registerBody(body, { kind: 'prop', owner: prop.id, data: prop.kind });
        this.propByBody.set(body.handle, prop);
      }
    }
  }

  private registerChaosProps(): void {
    for (const [id, body] of this.colliders.bodies) {
      const prop = this.island.props.find(p => p.id === id);
      if (!prop) continue;
      this.water.track(body, { buoyancyScale: prop.kind === 'barrel' || prop.kind === 'hay-bale' ? 1.15 : .8 });
      if (prop.breakable) {
        const threshold = Math.max(9, Math.min(38, body.mass() * .92));
        this.breakables.register(body, {
          impulseThreshold: threshold, damageThreshold: threshold * 2.5,
          chunks: prop.kind === 'hay-bale' ? 4 : 6, burstImpulse: 13,
        });
      }
      if (prop.kind === 'fence' || prop.kind === 'crate' || prop.kind === 'sign') {
        this.chains.registerDomino(body, { neighbourRadius: 4.6 });
      }
      if (prop.kind === 'barrel' && id.endsWith('0')) {
        this.chains.registerSoda(body, { impactThreshold: 35, radius: 4.5, shoveImpulse: 38 });
      }
    }
  }

  private addWaterVolumes(): void {
    const lake = this.island.reservoir;
    this.water.addVolume({
      id: 'reservoir',
      center: V(lake.center.x, lake.level - 3.5, lake.center.z),
      halfExtents: V(lake.radiusX, 3.5, lake.radiusZ), flow: V(0, 0, 0),
    });
    for (let i = 1; i < this.island.river.length; i++) {
      const a = this.island.river[i - 1]!, b = this.island.river[i]!;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const level = (a.level + b.level) / 2;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const speed = Math.min(4, 1.2 + (a.level - b.level) / Math.max(1, length));
      this.water.addVolume({
        id: 'river-' + i,
        center: V(mx, level - 1.7, mz),
        halfExtents: V(Math.abs(b.x - a.x) / 2 + Math.max(a.width, b.width) * .42,
          1.7, Math.abs(b.z - a.z) / 2 + Math.max(a.width, b.width) * .42),
        flow: V((b.x - a.x) / Math.max(1, length) * speed, -.15,
          (b.z - a.z) / Math.max(1, length) * speed),
      });
    }
  }

  private makePlaySurfaces(): void {
    const farm = this.island.pois.find(p => p.id === 'hoofington')!;
    const place = (kind: SurfaceMarker['kind'], x: number, z: number): void => {
      const pos = V(x, heightAt(this.island, x, z) + .22, z);
      const halfExtents = V(2.1, .23, 2.1);
      const direction = kind === 'launch' ? V(.2, .93, -.3) : V(0, 1, 0);
      const id = kind === 'trampoline'
        ? this.surfaces.createTrampoline({ position: pos, halfExtents, bounceSpeed: 13 })
        : this.surfaces.createLaunchPad({ position: pos, halfExtents,
          direction, launchSpeed: 15 });
      this.surfaceMarkers.push({ id, kind, position: pos, halfExtents, direction });
    };
    place('trampoline', farm.center.x + 11, farm.center.z + 2);
    place('launch', farm.center.x + 3, farm.center.z - 8);
    const boardwalk = this.island.pois.find(p => p.id === 'baa-ardwalk')!;
    place('launch', boardwalk.center.x + 6, boardwalk.center.z + 12);
  }

  private installBuildEvents(): void {
    this.off.push(this.rules.events.on('build:placed', e => { this.addBuildBody(e.piece); }));
    this.off.push(this.rules.events.on('build:edited', e => {
      this.removeBuildBody(e.before.id); this.addBuildBody(e.after);
    }));
    this.off.push(this.rules.events.on('build:removed', e => { this.removeBuildBody(e.piece.id); }));
    this.off.push(this.rules.events.on('build:broken', e => {
      this.removeBuildBody(e.piece.id); this.award('destruction', 1);
    }));
    this.off.push(this.rules.events.on('build:collapsed', e => {
      for (const piece of e.pieces) {
        this.removeBuildBody(piece.id);
        const p = this.buildPosition(piece);
        const body = this.physics.createBox(p, V(.92, .45, .92), 7, 'build-piece');
        body.applyImpulse(V((piece.id % 3 - 1) * 5, 5, 2), true);
        this.fallingPieces.set(body.handle, { body, type: piece.type, born: this.physics.time });
      }
      if (e.pieces.length) this.award('topple', 1);
    }));
  }

  buildPosition(piece: BuildPiece): Vec3 {
    return V(this.buildOrigin.x + piece.cell.x * 2,
      this.buildOrigin.y + piece.cell.y * 2 + 1,
      this.buildOrigin.z + piece.cell.z * 2);
  }

  private addBuildBody(piece: BuildPiece): void {
    const p = this.buildPosition(piece), yaw = piece.rotation * Math.PI / 2;
    const rotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const body = this.physics.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(p.x, p.y, p.z).setRotation(rotation));
    const collider = piece.type === 'ramp'
      ? RAPIER.ColliderDesc.convexHull(new Float32Array([
        -1, -.9, -1, 1, -.9, -1, -1, -.9, 1, 1, -.9, 1, -1, .9, 1, 1, .9, 1,
      ]))
      : RAPIER.ColliderDesc.cuboid(
        piece.type === 'wall' ? .23 : 1, piece.type === 'wall' ? 1 : .23, 1);
    if (!collider) throw new Error('Invalid Hay-Build ramp');
    this.physics.raw.createCollider(collider.setCollisionGroups(collisionGroups('build-piece'))
      .setFriction(.85).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS |
        RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), body);
    this.physics.registerBody(body, { kind: 'build-piece', owner: String(piece.id) });
    this.buildBodies.set(piece.id, body);
    if (piece.type === 'launch-pad') {
      this.surfaces.createLaunchPad({ id: 'hay-' + piece.id,
        position: V(p.x, p.y + .30, p.z), halfExtents: V(.97, .16, .97),
        direction: V(0, 1, -.45), launchSpeed: 13 });
    }
  }

  private removeBuildBody(id: number): void {
    this.surfaces.remove('hay-' + id);
    const body = this.buildBodies.get(id);
    if (body) { this.physics.removeBody(body); this.buildBodies.delete(id); }
  }

  private placeBuild(): boolean {
    const torso = this.goat.torso.translation(), dir = forward(this.intent.cameraYaw ?? this.goat.locomotion.heading);
    const x = torso.x + dir.x * 4.5, z = torso.z + dir.z * 4.5;
    if (this.rules.build.pieces.length === 0) {
      this.buildOrigin = V(0, heightAt(this.island, x, z), 0);
    }
    const local = V(x - this.buildOrigin.x,
      Math.max(0, torso.y - this.buildOrigin.y - this.goat.size * .7),
      z - this.buildOrigin.z);
    const snap = this.rules.build.snap(local);
    const result = this.rules.build.place({ ...snap, type: this.buildPiece });
    return !!result.piece;
  }

  /** Advance by wall-clock elapsed seconds; Rapier alone handles accumulator and fixed ticks. */
  advance(seconds: number, intent: PlayerIntent = {}): ReturnType<PhysicsWorld['step']> {
    if (this.disposed) throw new Error('Game is disposed');
    this.intent = intent;
    if (intent.toggleBuild) this.buildMode = !this.buildMode;
    if (intent.buildPiece) this.buildPiece = intent.buildPiece;
    if (intent.placeBuild && this.buildMode) this.placeBuild();
    const result = this.physics.step(seconds);
    // WaterSystem.setSeaLevel wakes all tracked Rapier bodies. It must run
    // outside PhysicsWorld's callbacks to avoid re-entering Rapier during step.
    if (this.party.match && this.water.seaLevel !== this.party.match.tideLevel) {
      // Breakable bodies can be removed by other lanes before water's next
      // before-step maintenance. Never wake a stale Rapier handle on tide rise.
      for (const [id, body] of this.colliders.bodies) {
        if (this.physics.raw.getRigidBody(body.handle)) continue;
        this.water.untrack(body);
        this.colliders.bodies.delete(id);
        this.propByBody.delete(body.handle);
        this.destroyedProps.add(id);
      }
      this.water.setSeaLevel(this.party.match.tideLevel);
    }
    return result;
  }

  /** One and exactly one deterministic fixed tick for Node/Vitest. */
  step(intent: PlayerIntent = {}): void { this.advance(FIXED_DT, intent); }

  private beforeTick(dt: number): void {
    if (this.pendingSize !== null && this.goat.size !== this.pendingSize) {
      this.water.untrack(this.goat.torso);
      this.goat.resize(this.pendingSize);
      this.water.track(this.goat.torso, { buoyancyScale: .7, paddleSpeed: 2.6 });
      this.lastY = this.goat.torso.translation().y;
      this.pendingSize = null;
    }
    this.driveGoat(this.goat, this.intent, this.rules, true, dt);
    this.party.beforeTick(this.intent);
  }

  /** Shared player/bot gameplay intent -> ability rules -> physical ragdoll route. */
  driveGoat(goat: GoatRagdoll, input: PlayerIntent, sim: GameSimulation,
    player: boolean, dt = FIXED_DT): void {
    const torso = goat.torso;
    const velocity = torso.linvel();
    const cameraYaw = input.cameraYaw ?? goat.locomotion.heading;
    const mx = Math.max(-1, Math.min(1, input.moveX ?? 0));
    const mz = Math.max(-1, Math.min(1, input.moveZ ?? 0));
    const wish = V(Math.sin(cameraYaw) * mz + Math.cos(cameraYaw) * mx, 0,
      -Math.cos(cameraYaw) * mz + Math.sin(cameraYaw) * mx);
    const steep = Math.hypot(wish.x, wish.z) > .1 && this.isFacingWall(wish, goat);
    const head = goat.head.translation();
    const hit = this.physics.raycast(head, add(forward(goat.locomotion.heading), V(0, -.10, 0)),
      9 * goat.size, { predicate: collider => !goat.ownsBody(collider.parent()) });
    const prop = hit ? [...this.colliders.props].find(([, c]) => c.handle === hit.collider.handle) : undefined;
    const lickable = !!hit && (!prop || this.island.props.find(p => p.id === prop[0])?.lickable !== false);
    const facts: GoatPhysicsFacts = {
      grounded: goat.locomotion.grounded && !steep,
      airborneTime: goat.locomotion.airborneSeconds,
      touchingSteepWall: steep || goat.locomotion.isClinging,
      speed: Math.hypot(velocity.x, velocity.z),
      size: sim.style.tier,
      tongueTarget: lickable && hit ? 'hit-' + hit.collider.handle : null,
      climbDistance: player ? this.climbMetres : 0,
    };
    if (player) this.climbMetres = 0;
    const rulesIntent: GoatIntent = {
      sprint: input.sprint, climb: input.climb ?? Math.hypot(mx, mz) > .1,
      chargeHeadbutt: (player ? !this.buildMode : true) && input.chargeHeadbutt,
      tongue: input.tongue, reelTongue: input.reelTongue,
      flingTongue: input.flingTongue, bleat: input.bleat, flop: input.flop,
      jump: input.jump, glide: input.glide,
    };
    const result = sim.update(dt, rulesIntent, facts);
    const commands = result.commands[0]!;
    goat.locomotion.setInput({
      x: mx, z: mz, cameraYaw, sprint: commands.setSprint,
      canSprint: commands.setSprint, canClimb: commands.setClimb,
    });
    this.water.setPaddle(goat.torso, wish);
    this.executeCommands(commands, goat, player);
    if (player && input.graze && this.canGraze() &&
        this.gigs.active?.setup.config.kind === 'mow-down') {
      this.gigs.noteAbility({ type: 'eat' });
    }
  }

  /** Test terrain proximity (not an overlapping prop's zero-normal ray).
   * Origin starts above the goat so the ray cannot begin inside the ground. */
  canGraze(): boolean {
    const torso = this.goat.torso.translation();
    const size = this.goat.size;
    const origin = add(torso, V(0, 2 * size, 0));
    const ground = this.physics.raycast(origin, V(0, -1, 0), 3.7 * size, {
      predicate: collider => collider.handle === this.colliders.terrain.handle,
    });
    return !!ground && ground.normal.y >= .55 &&
      torso.y - ground.point.y <= 1.5 * size &&
      torso.y >= ground.point.y - .25 * size;
  }

  private isFacingWall(wish: Vec3, goat = this.goat): boolean {
    const origin = add(goat.torso.translation(), V(0, .1 * goat.size, 0));
    const hit = this.physics.raycast(origin, wish, 1.05 * goat.size, {
      predicate: collider => !goat.ownsBody(collider.parent()),
    });
    return !!hit && hit.normal.y < .46 && hit.normal.x * wish.x + hit.normal.z * wish.z < -.45;
  }

  /** Cosmetic events come from executed commands, never unaccepted input edges. */
  onVisualCue(listener: (cue: GoatVisualCue) => void): () => void {
    this.visualCueListeners.add(listener);
    return () => { this.visualCueListeners.delete(listener); };
  }

  onVfxCue(listener: (cue: GameVfxCue) => void): () => void {
    this.vfxCueListeners.add(listener);
    return () => { this.vfxCueListeners.delete(listener); };
  }

  private sendVfxCue(cue: GameVfxCue): void {
    for (const listener of this.vfxCueListeners) listener(cue);
  }

  private sendVisualCue(goat: GoatRagdoll, action: GoatVisualCue['action']): void {
    const cue = { goatId: goat.id, action };
    for (const listener of this.visualCueListeners) listener(cue);
  }

  private executeCommands(commands: AbilityCommands, g = this.goat, player = true): void {
    if (commands.jump) {
      g.locomotion.requestJump();
      if (commands.jump.kind === 'wall-kick') {
        const away = forward(g.locomotion.heading);
        g.torso.applyImpulse(V(-away.x * g.mass * 2, g.mass * 2.8, -away.z * g.mass * 2), true);
      }
    }
    if (commands.headbutt) {
      this.sendVisualCue(g, 'headbutt');
      if (player) {
        this.lastActionTime = this.physics.time;
        this.gigs.noteAbility({ type: 'headbutt' });
      }
      const charge = Math.min(1, commands.headbutt.charge / TUNING.headbutt.maxCharge);
      // The physics lane's downward grazing ray can choose the terrain before a
      // nearby crate. Retain its torso lunge, then resolve an explicitly dynamic
      // forward target in core when that ray did not find one.
      const facing = forward(g.locomotion.heading);
      const origin = add(g.head.translation(), V(0, .04 * g.size, 0));
      const range = g.interactions.tuning.headbuttRange * g.size;
      const preferred = this.physics.shapeCast(origin, g.head.rotation(), facing,
        new RAPIER.Ball(.22 * g.size), range, {
          predicate: collider => !g.ownsBody(collider.parent()) &&
            (collider.parent()?.isDynamic() === true || [...this.buildBodies.values()]
              .some(body => body.handle === collider.parent()?.handle)),
        });
      const contact = this.physics.shapeCast(origin, g.head.rotation(), facing,
        new RAPIER.Ball(.22 * g.size), range, {
          predicate: collider => !g.ownsBody(collider.parent()),
        });
      const hit = g.interactions.headbutt(charge);
      let struck = hit;
      if (!struck && preferred?.body?.isDynamic()) {
        const target = preferred.body;
        // Do not reach through solid walls just because a movable target
        // happens to be visible to the dynamic-only shape query.
        const wall = this.physics.raycast(origin, facing, preferred.distance, {
          predicate: collider => !g.ownsBody(collider.parent()) && !collider.parent()?.isDynamic(),
        });
        if (!wall || wall.distance >= preferred.distance - .15 * g.size) {
          const impulse = g.mass * (1.1 + 1.9 * charge);
          target.applyImpulseAtPoint(V(facing.x * impulse, impulse * .18,
            facing.z * impulse), preferred.point, true);
          g.events.emit({ type: 'knockedBody', goatId: g.id, time: this.physics.time,
            bodyHandle: target.handle, mass: target.mass(), speed: Math.hypot(
              target.linvel().x, target.linvel().y, target.linvel().z),
            impulse });
          struck = target;
        }
      }
      if (struck) this.breakables.hit(struck, commands.headbutt.impulse * .75);
      // Fixed Hay-Build pieces cannot be returned from GoatInteractions.headbutt,
      // so use the same forward query to route impact to logical HP.
      let hitPiece = false;
      if (preferred?.body && !preferred.body.isDynamic()) {
        const pieceId = [...this.buildBodies].find(([, body]) => body.handle === preferred.body?.handle)?.[0];
        if (pieceId !== undefined) {
          hitPiece = true;
          this.rules.build.damage(pieceId, commands.headbutt.impulse * 3);
        }
      }
      if (struck || hitPiece || contact) {
        this.sendVfxCue({ type: 'headbutt-hit',
          position: contact?.point ?? preferred?.point ?? origin,
          direction: facing, power: .8 + charge * 1.8 });
      }
    }
    if (commands.tongue) {
      const cmd = commands.tongue;
      if (cmd.action === 'attach') {
        if (g.interactions.attachTongue()) {
          if (player) {
            this.lastTongueTime = this.physics.time;
            const body = g.interactions.tongueBody;
            this.gigs.noteAbility({ type: 'tongue', targetId: body ?
              this.physics.bodyData(body.handle)?.owner : undefined });
          }
        }
      } else if (cmd.action === 'reel') {
        g.interactions.setReel(-1);
      } else if (cmd.action === 'fling') {
        const target = g.interactions.tongueBody;
        if (target?.isDynamic()) {
          const direction = forward(g.locomotion.heading);
          target.applyImpulse(mul(add(direction, V(0, .3, 0)), cmd.impulse), true);
        }
        g.interactions.detachTongue('released');
      } else if (cmd.action === 'detach') {
        g.interactions.detachTongue('released');
      } else g.interactions.setReel(0);
    } else g.interactions.setReel(0);
    if (commands.bleat) {
      this.sendVisualCue(g, 'bleat');
      if (player) {
        this.lastActionTime = this.physics.time;
        this.gigs.noteAbility({ type: 'bleat' });
      }
      g.interactions.bleat();
    }
    if (commands.ragdoll) {
      g.flop();
      if (player) this.gigs.noteAbility({ type: 'flop' });
    }
    if (commands.setGlide && g.torso.linvel().y < -3.2) {
      this.sendVisualCue(g, 'glide');
      const slow = Math.min(12, -3.2 - g.torso.linvel().y);
      g.torso.applyImpulse(V(0, slow * g.mass * .5, 0), true);
    }
  }

  /** The authored pier extends beyond the normal offshore rescue boundary. */
  private isAbovePierDeck(p: Vec3): boolean {
    return this.pierDecks.some(deck => {
      const { position, rotationY } = deck.transform;
      if (p.y < position.y) return false;
      const x = p.x - position.x, z = p.z - position.z;
      const c = Math.cos(rotationY), s = Math.sin(rotationY);
      return Math.abs(c * x - s * z) <= deck.size.x / 2 &&
        Math.abs(s * x + c * z) <= deck.size.z / 2;
    });
  }

  private afterTick(dt: number): void {
    const g = this.goat, p = g.torso.translation();
    let tickClimb = 0;
    if (g.locomotion.isClinging) {
      const climbed = Math.max(0, p.y - this.lastY);
      tickClimb = climbed;
      this.climbMetres += climbed;
      this.climbRunMetres += climbed;
    }
    this.lastY = p.y;
    const offshoreLimit = Math.max(Math.abs(p.x), Math.abs(p.z)) > this.island.size * .57;
    const out = (offshoreLimit && !this.isAbovePierDeck(p)) ||
      p.y < -35 || p.y > 500 || !Number.isFinite(p.y);
    const offshore = heightAt(this.island, Math.max(-this.island.size/2, Math.min(this.island.size/2, p.x)),
      Math.max(-this.island.size/2, Math.min(this.island.size/2, p.z))) < this.water.seaLevel - .3;
    const swimming = offshore && p.y < this.water.seaLevel + 2.1 * g.size;
    this.drownSeconds = swimming ? this.drownSeconds + dt : 0;
    if (out || (!this.party.match && this.drownSeconds > 2.5)) this.respawn();
    for (const [handle, piece] of this.fallingPieces) {
      if (!this.physics.raw.getRigidBody(handle) || this.physics.time - piece.born > 14 ||
          piece.body.translation().y < -25) {
        const body = this.physics.raw.getRigidBody(handle);
        if (body) this.physics.removeBody(body);
        this.fallingPieces.delete(handle);
      }
    }
    if (!this.party.match) this.gigs.tick(tickClimb);
    this.party.afterTick();
  }

  private onGoatEvent(event: PhysicsEvent): void {
    switch (event.type) {
      case 'flipped': this.award('flip', event.rotations); break;
      case 'landed':
        if (event.airtime > .48) this.award('airtime', Math.min(2, event.airtime / 1.3));
        if (event.verticalSpeed > 9 && this.goat.isRagdoll) this.award('ragdoll-bounce', 1.3);
        break;
      case 'wallClingEnd':
        if (this.climbRunMetres > 0.8) {
          this.award('wall-climb', Math.min(2, this.climbRunMetres / 3));
        }
        this.climbRunMetres = 0;
        break;
      case 'tongueDetach':
        if (this.physics.time - this.lastTongueTime > .5 &&
          Math.hypot(this.goat.torso.linvel().x, this.goat.torso.linvel().z) > 3) {
          this.award('tongue-swing', 1);
        }
        break;
      case 'knockedBody':
        if (event.impulse > 2.5) this.award('knockback', Math.min(2, event.impulse / 20));
        break;
      case 'impact': this.rules.abilities.applyImpact(Math.min(24, event.impulse / this.goat.mass * 2)); break;
      default: break;
    }
  }

  private award(type: BuiltinTrick, quality = 1): void {
    const now = this.physics.time;
    const previous = this.lastStyle.get(type) ?? -Infinity;
    if (now - previous < (type === 'knockback' ? .28 : .42)) return;
    this.lastStyle.set(type, now);
    this.rules.awardStyle({ type, quality: Math.max(.25, Math.min(2, quality)) });
  }

  private recentChaos(): boolean {
    const v = this.goat.torso.linvel();
    return this.physics.time - this.lastActionTime < 4 || Math.hypot(v.x, v.z) > 3;
  }

  private nearPlayer(position: Vec3, distance: number): boolean {
    const p = this.goat.torso.translation();
    return Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z) < distance;
  }

  get location(): string {
    const p = this.goat.torso.translation();
    const zone = zoneAt(this.island, p.x, p.z);
    const poi = this.island.pois.find(site => site.id === zone) ??
      this.island.pois.find(site => Math.hypot(site.center.x - p.x, site.center.z - p.z) < site.radius * 1.25);
    return poi?.name ?? 'Billy Isle';
  }

  /** Reposition a whole linked ragdoll without destroying its joints. Also used by rescue. */
  teleport(position: Vec3, uprightHeading?: number): void {
    this.goat.interactions.detachTongue('replaced');
    const current = this.goat.torso.translation();
    const target = V(position.x, position.y + .92 * this.goat.size, position.z);
    // Ordinary gig teleports preserve the ragdoll's pose. Respawn instead
    // rotates the complete connected assembly back upright about its torso,
    // preserving all six joints and their current relative rotations.
    const q = this.goat.torso.rotation();
    const wanted = uprightHeading === undefined ? null : {
      x: 0, y: Math.sin(uprightHeading / 2), z: 0, w: Math.cos(uprightHeading / 2),
    };
    const rotation = wanted && multiplyRotation(wanted,
      { x: -q.x, y: -q.y, z: -q.z, w: q.w });
    for (const body of this.goat.bodies) {
      const local = sub(body.translation(), current);
      body.setTranslation(add(target, rotation ? rotate(rotation, local) : local), true);
      if (rotation) body.setRotation(multiplyRotation(rotation, body.rotation()), true);
      body.setLinvel(V(), true);
      body.setAngvel(V(), true);
    }
    if (uprightHeading !== undefined) {
      // Teleport rotates the physical assembly to yaw=uprightHeading;
      // forward() expects the opposite sign for the same facing.
      this.goat.locomotion.heading = -uprightHeading;
      this.goat.setPose('stand');
    }
    this.drownSeconds = 0;
    this.climbMetres = 0;
    this.climbRunMetres = 0;
    this.lastY = this.goat.torso.translation().y;
  }

  respawn(): void {
    const spawn = this.island.spawns[0]!.position;
    // A rescue is also a physical spawn; don't reapply the world lane's
    // clearance height on top of the ragdoll's own standing torso offset.
    this.teleport(V(spawn.x, this.spawnGround, spawn.z),
      this.island.spawns[0]!.heading);
    this.respawns++;
  }

  exportProgress(): GameProgress {
    return { gameplay: this.rules.toJSON(), gigs: this.gigs.director.toJSON(),
      gigBodies: this.gigs.saveBodies() };
  }

  get bodyCount(): number {
    let count = 0;
    this.physics.raw.forEachRigidBody(() => { count++; });
    return count;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsub of this.off.splice(0)) unsub();
    this.visualCueListeners.clear();
    this.vfxCueListeners.clear();
    this.party.dispose();
    this.gigs.dispose();
    this.goat.dispose();
    this.surfaces.dispose();
    this.chains.dispose();
    this.breakables.dispose();
    this.water.dispose();
    this.budget.dispose();
    this.buildBodies.clear();
    this.fallingPieces.clear();
    this.physics.dispose();
  }
}
