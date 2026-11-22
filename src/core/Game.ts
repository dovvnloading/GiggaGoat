import { Toybox } from './Toybox';
import type { RigidBody, ColliderDesc } from '@dimforge/rapier3d-compat';
import {
  PhysicsWorld, GoatRagdoll, RAPIER, V, forward, add, sub, mul, rotate, collisionGroups,
  type Vec3, type Quat, type GoatSize, type MovementInput, type PhysicsEvent, type RayHit,
} from '../physics';
import {
  generateIsland, buildRapierColliders, heightAt, zoneAt,
  type ColliderBuild, type IslandData, type PropDescriptor,
} from '../world';
import {
  GameSimulation, TUNING, BUILD_RAMP_VERTICES, type GoatIntent, type GoatPhysicsFacts,
  type AbilityCommands, type BuiltinTrick, type PieceType, type BuildPiece,
  type Placement, type Validation,
} from '../gameplay';
import {
  WaterSystem, BreakableRegistry, ChainReactions, SurfaceSystem,
  DynamicBodyBudget, applyPhysicsMaterial, type DestructionEvent,
} from '../chaos';
import { addRapierPropCollider } from '../world/colliders';
import { isSodaBarrel } from '../world/types';
import { BOARDWALK_SHORE_GUARD_ID, BOARDWALK_SHORE_ID, boardwalkFarEnd, boardwalkPierDecks } from '../world/boardwalk';
import { PINES_LOG_ENTRY_ID } from '../world/pines-log-access';
import { HOOFINGTON_HAUL_BALE_PREFIX } from '../world/hoofington-entrances';
import { DAM_FOREST_RIVER_START, DAM_UPSTREAM_RIVER_END, getDamHeadwater, getDamOutflow,
  isDamHeadwater } from '../world/dam-landscape';
import { DAM_ACCESS_GUARD_ID, DAM_BACK_GUARD, DAM_FRONT_GUARD } from '../world/the-dam';
import { LIGHTHOUSE_ACCESS_GUARD_ID } from '../world/lighthouse-access';
import { COAST_TURNOUT_GNOME_ID } from '../world/roadside-stops';
import { CRANE_YARD_PLAN } from '../world/crane-yard';
import { HAY_HAUL_TAG_RADIUS } from '../gigs';
import { GigSession } from './GigSession';
import { PartySession } from './PartySession';
import type { GameProgress } from './Persistence';
import { findStockBaleSeat, isLegacyStockBale } from './HoofingtonStock';

export const FIXED_DT = 1 / 60;
const SODA_POP_IMPULSE = 35;
const EDGE_BUTTONS = ['jump', 'bleat', 'flop', 'flingTongue'] as const;
type EdgeButton = (typeof EDGE_BUTTONS)[number];
type ButtonTransition = { pressed: boolean; glide?: boolean; tongue?: boolean };
type ButtonTransitions = { sampled: boolean; applied: boolean; pending: ButtonTransition[] };

function buttonTransitions(): Record<EdgeButton, ButtonTransitions> {
  return {
    jump: { sampled: false, applied: false, pending: [] },
    bleat: { sampled: false, applied: false, pending: [] },
    flop: { sampled: false, applied: false, pending: [] },
    flingTongue: { sampled: false, applied: false, pending: [] },
  };
}

const buildHalfHeight: Record<PieceType, number> = {
  floor: .23, wall: 1, ramp: .9, 'launch-pad': .23,
};

/** Compose rotations for a whole-ragdoll rescue without modifying joint angles. */
const multiplyRotation = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
export interface PlayerIntent extends GoatIntent {
  cameraPitch?: number;
  cycleToy?: number;
  useToy?: boolean;
  moveX?: number;
  moveZ?: number;
  cameraYaw?: number;
  toggleBuild?: boolean;
  placeBuild?: boolean;
  buildPiece?: PieceType;
  graze?: boolean;
  interact?: boolean;
}
export interface BuildPreview {
  placement: Placement;
  position: Vec3;
  validation: Validation;
}
export interface SurfaceMarker {
  id: string;
  kind: 'trampoline' | 'launch';
  position: Vec3;
  halfExtents: Vec3;
  direction?: Vec3;
  hasWorldArt?: true;
  artAtGround?: true;
}
export interface FallingPiece { body: RigidBody; type: PieceType; born: number }
export interface GameOptions { seed?: string | number; resolution?: number; progress?: GameProgress }
/** Read-only presentation cue for an ability accepted by the fixed-tick simulation. */
export interface GoatVisualCue { goatId: string; action: 'headbutt' | 'bleat' }
/** Headless, one-shot cues for contact information removed during simulation callbacks. */
export type GameVfxCue =
  | { type: 'headbutt-hit'; position: Vec3; direction: Vec3; power: number }
  | { type: 'crate-break'; position: Vec3; direction: Vec3; size: number };

type KnockedBodyEvent = Extract<PhysicsEvent, { type: 'knockedBody' }>;
type ImpactAudioMaterial = import('../world/types').ScenerySurface;
type SceneryAudioMaterial = Exclude<ImpactAudioMaterial, 'soft'> | 'hay';

/** Contact material retained when the simulation can remove the body in the same tick. */
export type MaterialAudioContact =
  | { type: 'headbutt'; event?: KnockedBodyEvent; material: ImpactAudioMaterial;
      position: Vec3; goatId: string; intensity: number }
  | { type: 'break'; event: DestructionEvent; material: SceneryAudioMaterial; position: Vec3 }
  | { type: 'gnome-break'; position: Vec3 };

function sceneryAudioMaterial(prop: PropDescriptor | undefined): SceneryAudioMaterial | undefined {
  switch (prop?.kind) {
    case 'barrel':
      // Downtown's numbered stock uses the painted steel drum.
      return /^downtown-bleatsville-barrel-\d+$/.test(prop.id) ? 'metal' : 'wood';
    case 'crate': case 'fence': case 'sign': case 'bench': case 'log':
    case 'pallet-stack': case 'cable-spool':
      return 'wood';
    case 'rock': case 'ledge': case 'dam-wall': case 'planter': case 'gnome':
    case 'concrete-slab': case 'concrete-column':
      return 'stone';
    case 'hay-bale':
      return 'hay';
    case 'lamp': case 'ac-unit': case 'container': case 'chain-fence': case 'pipe-stack':
    case 'water-tower': case 'mailbox':
      return 'metal';
    default: return undefined;
  }
}

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
  readonly toys = new Toybox(this);
  readonly water: WaterSystem;
  readonly breakables: BreakableRegistry;
  readonly chains: ChainReactions;
  readonly surfaces: SurfaceSystem;
  readonly budget: DynamicBodyBudget;
  readonly gigs: GigSession;
  private acknowledgedGigAttempt = 0;
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
  private readonly materialAudioListeners = new Set<(contact: MaterialAudioContact) => void>();
  private intent: PlayerIntent = {};
  private readonly buttons = buttonTransitions();
  private pendingSize: GoatSize | null = null;
  private drownSeconds = 0;
  private lastY = 0;
  private climbMetres = 0;
  private climbRunMetres = 0;
  private lastTongueTime = 0;
  private lastActionTime = -Infinity;
  private lastStyle = new Map<string, number>();
  private readonly buildOrigin: Vec3;
  private readonly pierDecks: readonly PropDescriptor[];
  readonly scenerySurfaces = new Map<number, ImpactAudioMaterial>();
  private readonly blockedClimbHandles = new Set<number>();
  private readonly safetyRailHandles = new Set<number>();
  private readonly boardwalkEnd: ReturnType<typeof boardwalkFarEnd>;
  private readonly craneCenter: Vec3;
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
    this.craneCenter = island.pois.find(poi => poi.id === 'crane-yard')!.center;
    const noClimbGuardPrefixes = [DAM_FRONT_GUARD.prefix, DAM_BACK_GUARD.prefix,
      DAM_ACCESS_GUARD_ID, LIGHTHOUSE_ACCESS_GUARD_ID, BOARDWALK_SHORE_GUARD_ID];
    for (const [id, collider] of colliders.props) {
      if (noClimbGuardPrefixes.some(prefix => id.startsWith(prefix))) {
        this.blockedClimbHandles.add(collider.handle);
      }
    }
    for (const descriptor of island.colliders) {
      if (descriptor.shape === 'heightfield' || !descriptor.surface) continue;
      const collider = colliders.props.get(descriptor.id);
      if (collider) this.scenerySurfaces.set(collider.handle, descriptor.surface);
    }
    this.pierDecks = boardwalkPierDecks(island);
    this.boardwalkEnd = boardwalkFarEnd(island);
    for (const rail of this.boardwalkEnd?.rails ?? []) {
      const collider = colliders.props.get(rail.id);
      if (collider) this.safetyRailHandles.add(collider.handle);
    }
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
    this.surfaces = new SurfaceSystem(physics, body => {
      const record = physics.bodyData(body.handle);
      if (record?.kind !== 'goat' || !record.owner) return;
      return record.owner === this.goat.id ? this.goat : this.party?.bots.get(record.owner)?.goat;
    });
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
      const material = sceneryAudioMaterial(prop);
      if (material && event.cause !== 'soda') {
        this.sendMaterialAudio({ type: 'break', event, material, position: event.position });
      }
      if (prop?.kind === 'crate') {
        this.sendVfxCue({ type: 'crate-break',
          position: { x: event.position.x,
            y: event.position.y - prop.size.y / 2, z: event.position.z },
          direction: forward(this.goat.locomotion.heading),
          size: Math.max(prop.size.x, prop.size.y, prop.size.z) });
      }
      if (prop) this.forgetWorldProp(prop.id);
      if (this.nearPlayer(event.position, 24) && this.recentChaos()) {
        this.award('destruction', 1 + Math.min(1, event.mass / 50));
      }
    }));
    this.off.push(this.chains.events.on(event => {
      const body = physics.raw.getRigidBody(event.bodyHandle);
      if (body && event.type === 'sodaPop' && this.propByBody.get(body.handle)?.breakable) {
        // A full barrel pops first. Its empty shell breaks like ordinary stock.
        this.breakables.register(body, { impulseThreshold: 12, damageThreshold: 30, chunks: 6 });
      }
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
      this.gigs = new GigSession(this, island.seed, options.progress?.gigs,
        options.progress?.gigBodies, options.progress?.rooftopPose, options.progress?.gigPlayerPose);
    } catch {
      this.gigs = new GigSession(this, island.seed);
    }
    const restoredGig = this.gigs.active;
    const acknowledgement = options.progress?.acknowledgedGigAttempt;
    if (typeof acknowledgement === 'number' && Number.isSafeInteger(acknowledgement) &&
      acknowledgement >= 0 && acknowledgement <= (restoredGig?.attemptId ?? 0)) {
      this.acknowledgedGigAttempt = acknowledgement;
    } else if (restoredGig?.status === 'completed' || restoredGig?.status === 'failed') {
      // Legacy saves could retain the terminal attempt after its modal closed.
      this.acknowledgedGigAttempt = restoredGig.attemptId;
    }
    this.party = new PartySession(this);
    // Saved active cargo already has its own pose. The static world and gig
    // catalog still own the original authored coordinates for every bale.
    const restoredHay = new Set<string>();
    if (restoredGig?.status === 'running' && restoredGig.setup.config.kind === 'hay-haul' &&
      Array.isArray(options.progress?.gigBodies)) {
      const assigned = new Set(restoredGig.setup.config.bales.map(bale => bale.id));
      for (const saved of options.progress.gigBodies) {
        if (!saved.broken && assigned.has(saved.id)) restoredHay.add(saved.id);
      }
    }
    this.physics.raw.propagateModifiedBodyPositionsToColliders();
    for (const prop of island.props) {
      if (!isLegacyStockBale(prop) || restoredHay.has(prop.id)) continue;
      const body = colliders.bodies.get(prop.id);
      if (body?.isEnabled()) this.seatStockHayBale(prop, body);
    }
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
      this.configureWorldProp(prop, body);
    }
  }

  private configureWorldProp(prop: PropDescriptor, body: RigidBody | undefined): void {
    const collider = this.colliders.props.get(prop.id)!;
    collider.setCollisionGroups(collisionGroups('prop'));
    const craneRail = prop.poiId === 'crane-yard' && prop.kind === 'safety-rail' &&
      prop.restitution === 0 && !body;
    if (craneRail) this.safetyRailHandles.add(collider.handle);
    if (craneRail || !prop.climbable) this.blockedClimbHandles.add(collider.handle);
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

  private forgetWorldProp(id: string): void {
    const body = this.colliders.bodies.get(id);
    if (body) {
      this.water.untrack(body);
      this.propByBody.delete(body.handle);
    }
    const collider = this.colliders.props.get(id);
    if (collider) {
      this.blockedClimbHandles.delete(collider.handle);
      this.safetyRailHandles.delete(collider.handle);
    }
    this.colliders.bodies.delete(id);
    this.colliders.props.delete(id);
    this.destroyedProps.add(id);
  }

  seatStockHayBale(prop: PropDescriptor, body: RigidBody): void {
    if (!isLegacyStockBale(prop)) return;
    const seat = findStockBaleSeat(this.island, this.colliders, prop, body.translation(), body.rotation());
    if (seat) {
      body.setTranslation(seat, true);
      this.physics.registerBody(body, { kind: 'prop', owner: prop.id, data: prop.kind });
    }
    this.physics.raw.propagateModifiedBodyPositionsToColliders();
  }

  /** Lend a contract a replacement for a lost world bale using its original art and shape. */
  restockHayBale(id: string): RigidBody | undefined {
    if (this.colliders.bodies.get(id)?.isValid()) return;
    const prop = this.island.props.find(p => p.id === id && p.kind === 'hay-bale');
    const shape = this.island.colliders.find(c => c.shape !== 'heightfield' && c.id === id);
    if (!prop || !shape || shape.shape === 'heightfield' || shape.body.type !== 'dynamic') return;
    this.forgetWorldProp(id);
    addRapierPropCollider(this.physics.raw, this.colliders, shape);
    const body = this.colliders.bodies.get(id)!;
    this.configureWorldProp(prop, body);
    this.seatStockHayBale(prop, body);
    this.water.track(body, { buoyancyScale: 1.15 });
    // Contract replacements can still be pushed and licked. Skipping breakable
    // registration keeps the same lost bale from creating infinite debris or score.
    this.destroyedProps.delete(id);
    return body;
  }

  removeRestockedHayBale(id: string, body: RigidBody): void {
    if (this.colliders.bodies.get(id) !== body) return;
    const tether = this.goat.interactions;
    if (tether.tongueBody?.handle === body.handle) tether.detachTongue('replaced');
    if (body.isValid()) this.physics.removeBody(body);
    this.forgetWorldProp(id);
  }

  private registerChaosProps(): void {
    for (const [id, body] of this.colliders.bodies) {
      const prop = this.island.props.find(p => p.id === id);
      if (!prop) continue;
      this.water.track(body, { buoyancyScale: prop.kind === 'barrel' || prop.kind === 'hay-bale' ? 1.15 : .8 });
      if (prop.breakable && !isSodaBarrel(prop)) {
        // Packed loading bales endure routine handling and still break on a hard hit.
        const threshold = id.startsWith(HOOFINGTON_HAUL_BALE_PREFIX) ? 36 :
          Math.max(9, Math.min(38, body.mass() * .92));
        this.breakables.register(body, {
          impulseThreshold: threshold, damageThreshold: threshold * 2.5,
          chunks: prop.kind === 'hay-bale' ? 4 : 6, burstImpulse: 13,
        });
      }
      if (prop.kind === 'fence' || prop.kind === 'crate' || prop.kind === 'sign') {
        this.chains.registerDomino(body, { neighbourRadius: 4.6 });
      }
      if (isSodaBarrel(prop)) {
        this.chains.registerSoda(body, { impactThreshold: SODA_POP_IMPULSE, radius: 4.5, shoveImpulse: 38 });
      }
    }
  }

  private addWaterVolumes(): void {
    const upper = getDamHeadwater(this.island);
    const depth = 4 * upper.scale;
    this.water.addVolume({
      id: 'dam-upper-reservoir',
      center: V((upper.left + upper.right) / 2, upper.level - depth / 2, (upper.rear + upper.front) / 2),
      halfExtents: V((upper.right - upper.left) / 2, depth / 2, (upper.front - upper.rear) / 2),
      flow: V(),
      containsXZ: (x, z) => isDamHeadwater(this.island, x, z),
    });
    const outflow = getDamOutflow(this.island);
    this.water.addVolume({
      id: 'reservoir',
      center: V((outflow.left + outflow.right) / 2, (outflow.top + outflow.bottom) / 2,
        (outflow.near + outflow.far) / 2),
      halfExtents: V((outflow.right - outflow.left) / 2, (outflow.top - outflow.bottom) / 2,
        (outflow.far - outflow.near) / 2),
      flow: V(0, 0, 1.2),
      containsXZ: outflow.containsXZ,
      surfaceYAt: (_x, z) => outflow.surfaceY(z),
    });
    for (let i = 1; i < this.island.river.length; i++) {
      // The visible outflow replaces these original river reaches.
      if (i >= DAM_UPSTREAM_RIVER_END && i <= DAM_FOREST_RIVER_START) continue;
      const a = this.island.river[i - 1]!, b = this.island.river[i]!;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const level = (a.level + b.level) / 2;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const speed = Math.min(4, 1.2 + (a.level - b.level) / Math.max(1, length));
      const widthX = Math.abs(b.x - a.x) / 2 + Math.max(a.width, b.width) * .42;
      const widthZ = Math.abs(b.z - a.z) / 2 + Math.max(a.width, b.width) * .42;
      const touchesDam = mx + widthX > upper.left && mx - widthX < upper.right &&
        mz + widthZ > upper.rear && mz - widthZ < outflow.far;
      this.water.addVolume({
        id: 'river-' + i,
        center: V(mx, level - 1.7, mz),
        halfExtents: V(widthX, 1.7, widthZ),
        ...(touchesDam ? { containsXZ: (x: number, z: number) =>
          (x < upper.left || x > upper.right || z < upper.rear || z >= outflow.near) &&
          !outflow.containsXZ(x, z) } : {}),
        flow: V((b.x - a.x) / Math.max(1, length) * speed, -.15,
          (b.z - a.z) / Math.max(1, length) * speed),
      });
    }
  }

  private makePlaySurfaces(): void {
    const farm = this.island.pois.find(p => p.id === 'hoofington')!;
    const place = (kind: SurfaceMarker['kind'], x: number, z: number,
      yard?: { direction: Vec3 }): void => {
      const ground = heightAt(this.island, x, z);
      const halfExtents = V(2.1, .23, 2.1);
      const pos = V(x, ground + .22, z);
      if (yard) {
        const ray = new RAPIER.Ray(V(x, ground + 1, z), V(0, -1, 0));
        const hit = this.colliders.terrain.castRay(ray, 2, false);
        pos.y = (hit >= 0 ? ray.origin.y - hit : ground) + halfExtents.y;
      }
      const direction = yard?.direction ?? (kind === 'launch' ? V(.2, .93, -.3) : V(0, 1, 0));
      const id = kind === 'trampoline'
        ? this.surfaces.createTrampoline({ position: pos, halfExtents, bounceSpeed: 13 })
        : this.surfaces.createLaunchPad({ position: pos, halfExtents,
          direction, launchSpeed: 15 });
      this.surfaceMarkers.push({ id, kind, position: pos, halfExtents, direction,
        ...(yard ? { artAtGround: true } : {}) });
    };
    place('trampoline', farm.center.x + 11, farm.center.z + 2);
    // The lawn beyond the east sidewalk has a clear landing to the north.
    place('launch', farm.center.x + 9.5, farm.center.z - 4, { direction: V(0, .93, -.34) });
    const boardwalk = this.island.pois.find(p => p.id === 'baa-ardwalk')!;
    place('launch', boardwalk.center.x + 6, boardwalk.center.z + 12);
    for (const prop of this.island.props) {
      if (prop.kind !== 'trampoline' || (prop.poiId !== 'hoofington' && prop.poiId !== 'baa-ardwalk')) continue;
      const position = prop.transform.position;
      const halfExtents = V(prop.size.x / 2, prop.size.y / 2, prop.size.z / 2);
      const id = this.surfaces.createTrampoline({
        id: prop.id, position, halfExtents, bounceSpeed: 13,
        sensorOnly: this.colliders.props.has(prop.id),
      });
      this.surfaceMarkers.push({ id, kind: 'trampoline', position, halfExtents, hasWorldArt: true });
    }
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

  buildPosition(piece: Placement, origin = this.buildOrigin): Vec3 {
    const grid = TUNING.build.gridSize;
    const base = piece.foundationOffset === undefined
      ? grid / 2 : piece.foundationOffset + buildHalfHeight[piece.type];
    return V(origin.x + piece.cell.x * grid, origin.y + piece.cell.y * grid + base,
      origin.z + piece.cell.z * grid);
  }

  private addBuildBody(piece: BuildPiece): void {
    const p = this.buildPosition(piece), yaw = piece.rotation * Math.PI / 2;
    const rotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const body = this.physics.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(p.x, p.y, p.z).setRotation(rotation));
    const collider = piece.type === 'ramp'
      ? RAPIER.ColliderDesc.convexHull(new Float32Array(BUILD_RAMP_VERTICES))
      : RAPIER.ColliderDesc.cuboid(
        piece.type === 'wall' ? .23 : 1, buildHalfHeight[piece.type], 1);
    if (!collider) throw new Error('Invalid Hay-Build ramp');
    this.physics.raw.createCollider(collider.setCollisionGroups(collisionGroups('build-piece'))
      .setFriction(.85).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS |
        RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), body);
    this.physics.registerBody(body, { kind: 'build-piece', owner: String(piece.id) });
    this.buildBodies.set(piece.id, body);
    if (piece.type === 'launch-pad') {
      this.surfaces.createLaunchPad({ id: 'hay-' + piece.id,
        position: p, halfExtents: V(.97, buildHalfHeight[piece.type], .97),
        sensorOnly: true, direction: rotate(rotation, V(0, 1, -.45)), launchSpeed: 13 });
    }
  }

  private removeBuildBody(id: number): void {
    this.surfaces.remove('hay-' + id);
    const body = this.buildBodies.get(id);
    if (body) { this.physics.removeBody(body); this.buildBodies.delete(id); }
  }

  /** Sample the footprint below the aim point and keep the base on solid support. */
  private buildGround(x: number, z: number, feet: number): number | undefined {
    const halfWidth = this.buildPiece === 'wall' ? .18 : .85;
    const samples = [[0, 0], [-halfWidth, -.85], [halfWidth, -.85], [-halfWidth, .85], [halfWidth, .85]] as const;
    const heights: number[] = [];
    for (const [dx, dz] of samples) {
      const sample = this.buildSupportSample(V(x + dx, feet + 1.2, z + dz));
      if (sample === undefined) return;
      heights.push(sample);
    }
    const high = Math.max(...heights);
    if (high - Math.min(...heights) <= .60) return high;
  }

  private buildSupportSample(origin: Vec3): number | undefined {
    const down = V(0, -1, 0);
    const maxDepth = 9;
    const isFixedSupport = (collider: typeof this.colliders.terrain): boolean => {
      const body = collider.parent();
      return !collider.isSensor() &&
        (!body || (body.isFixed() && this.physics.bodyData(body.handle)?.kind !== 'build-piece'));
    };
    if (this.physics.stepCount > 0) {
      const hit = this.physics.raycast(origin, down, maxDepth, { predicate: isFixedSupport });
      return hit && hit.normal.y >= .56 ? hit.point.y : undefined;
    }

    // The first build preview can run before Rapier creates its query index.
    const ray = new RAPIER.Ray(origin, down);
    let nearest = maxDepth;
    let normalY = 0;
    for (const collider of [this.colliders.terrain, ...this.colliders.paths, ...this.colliders.props.values()]) {
      if (!isFixedSupport(collider)) continue;
      const hit = collider.castRayAndGetNormal(ray, nearest, true);
      if (hit && hit.timeOfImpact < nearest) {
        nearest = hit.timeOfImpact;
        normalY = hit.normal.y;
      }
    }
    return normalY >= .56 ? origin.y - nearest : undefined;
  }

  buildPreview(cameraYaw = this.intent.cameraYaw ?? this.goat.locomotion.heading): BuildPreview | null {
    if (!this.buildMode) return null;
    const torso = this.goat.torso.translation(), dir = forward(cameraYaw);
    const feet = torso.y - .97 * this.goat.size;
    const grid = TUNING.build.gridSize;
    const origin = this.buildOrigin;
    const x = torso.x + dir.x * 4.5, z = torso.z + dir.z * 4.5;
    // Camera heading turns clockwise from -Z. Build rotations use the
    // opposite yaw, and the ramp's ascending tread points toward local +Z.
    const degrees = -cameraYaw * 180 / Math.PI + (this.buildPiece === 'ramp' ? 180 : 0);
    const snap = this.rules.build.snap(V(x - origin.x, 0, z - origin.z), degrees);
    const ground = this.buildGround(origin.x + snap.cell.x * grid, origin.z + snap.cell.z * grid, feet);
    let placement: Placement = { ...snap, type: this.buildPiece, foundationOffset: (ground ?? feet) - origin.y };
    let validation: Validation = ground === undefined ? { valid: false, reason: 'no-support' } :
      this.rules.build.validatePlacement(placement);
    let closest = ground === undefined ? Infinity : Math.abs(feet - ground);

    // Extend an existing grid at the player's height. Different foundations do
    // not prop each other up, even if their integer cells are adjacent.
    const foundations = new Set(this.rules.build.pieces.filter(piece =>
      Math.abs(piece.cell.x - snap.cell.x) + Math.abs(piece.cell.z - snap.cell.z) <= 1)
      .map(piece => piece.foundationOffset));
    for (const offset of foundations) {
      const datum = origin.y + (offset ?? 0);
      const y = Math.round((feet - datum) / grid);
      const height = datum + y * grid;
      const distance = Math.abs(feet - height);
      if (y < 1 || distance >= closest || (ground !== undefined && height < ground - .05)) continue;
      const candidate: Placement = { ...snap, type: this.buildPiece, cell: { ...snap.cell, y },
        ...(offset === undefined ? {} : { foundationOffset: offset }) };
      const support = this.rules.build.validatePlacement(candidate);
      if (!support.valid) continue;
      closest = distance;
      placement = candidate;
      validation = support;
    }
    return { placement, position: this.buildPosition(placement), validation };
  }

  private placeBuild(): void {
    const preview = this.buildPreview();
    if (preview?.validation.valid) this.rules.build.place(preview.placement);
  }

  /** Advance by wall-clock elapsed seconds; Rapier alone handles accumulator and fixed ticks. */
  advance(seconds: number, intent: PlayerIntent = {}): ReturnType<PhysicsWorld['step']> {
    if (this.disposed) throw new Error('Game is disposed');
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new RangeError('frameSeconds must be a finite, non-negative number');
    }
    this.intent = intent;
    // The renderer can sample both edges before physics advances. Keep their
    // order so the ability state machine sees every press and its release.
    for (const button of EDGE_BUTTONS) {
      const state = this.buttons[button];
      const pressed = Boolean(intent[button]);
      if (pressed !== state.sampled) {
        state.pending.push({ pressed,
          ...(button === 'jump' ? { glide: Boolean(intent.glide) } : {}),
          ...(button === 'flingTongue' ? { tongue: Boolean(intent.tongue) } : {}),
        });
      }
      state.sampled = pressed;
    }
    if (intent.toggleBuild) this.buildMode = !this.buildMode;
    if (intent.buildPiece) this.buildPiece = intent.buildPiece;
    if (intent.placeBuild && this.buildMode) this.placeBuild();
    this.toys.input(intent);
    const result = this.physics.step(seconds);
    this.party.advanceDroppedCountdown(result.droppedSeconds);
    // WaterSystem.setSeaLevel wakes all tracked Rapier bodies. It must run
    // outside PhysicsWorld's callbacks to avoid re-entering Rapier during step.
    if (this.party.match && this.water.seaLevel !== this.party.match.tideLevel) {
      // Breakable bodies can be removed by other lanes before water's next
      // before-step maintenance. Never wake a stale Rapier handle on tide rise.
      for (const [id, body] of this.colliders.bodies) {
        if (this.physics.raw.getRigidBody(body.handle)) continue;
        this.forgetWorldProp(id);
      }
      this.water.setSeaLevel(this.party.match.tideLevel);
    }
    return result;
  }

  /** One and exactly one deterministic fixed tick for Node/Vitest. */
  step(intent: PlayerIntent = {}): void { this.advance(FIXED_DT, intent); }

  private beforeTick(dt: number): void {
    const intent = { ...this.intent };
    for (const button of EDGE_BUTTONS) {
      const state = this.buttons[button];
      const transition = state.pending.shift();
      if (transition) {
        state.applied = transition.pressed;
        if (button === 'jump') intent.glide = transition.glide;
        if (button === 'flingTongue') intent.tongue = transition.tongue;
      }
      intent[button] = state.applied;
    }
    if (this.pendingSize !== null && this.goat.size !== this.pendingSize) {
      this.water.untrack(this.goat.torso);
      const run = this.gigs.active;
      const held = this.goat.interactions.tongueBody;
      const courier = run?.setup.config;
      const keepParcel = !!intent.tongue && !!held && run?.status === 'running' &&
        courier?.kind === 'rooftop-express' &&
        this.gigs.props.get(courier.parcelId)?.body.handle === held.handle;
      const previousSize = this.goat.size;
      this.goat.resize(this.pendingSize, keepParcel);
      if (keepParcel && previousSize > this.goat.size &&
          this.goat.interactions.tongueBody?.handle === held.handle) {
        this.gigs.noteCourierShrink(previousSize);
      }
      this.water.track(this.goat.torso, { buoyancyScale: .7, paddleSpeed: 2.6 });
      this.lastY = this.goat.torso.translation().y;
      this.pendingSize = null;
    }
    this.driveGoat(this.goat, intent, this.rules, true, dt);
    this.toys.tick(dt, intent);
    this.party.beforeTick(intent);
  }

  /** Shared player/bot gameplay intent -> ability rules -> physical ragdoll route. */
  driveGoat(goat: GoatRagdoll, input: PlayerIntent, sim: GameSimulation,
    player: boolean, dt = FIXED_DT): void {
    const torso = goat.torso;
    const velocity = torso.linvel();
    const cameraYaw = input.cameraYaw ?? goat.locomotion.heading;
    const match = this.party.match;
    const hayHeist = match?.mode === 'hay-heist';
    // PartySession already applies the carrying effect to bot movement. The
    // human enters here with raw input and needs the same effect once.
    const carryEffects = hayHeist && player ? match.getEffects(goat.id) : undefined;
    const speed = carryEffects?.speedMultiplier ?? 1;
    const mx = Math.max(-1, Math.min(1, input.moveX ?? 0)) * speed;
    const mz = Math.max(-1, Math.min(1, input.moveZ ?? 0)) * speed;
    const wish = V(Math.sin(cameraYaw) * mz + Math.cos(cameraYaw) * mx, 0,
      -Math.cos(cameraYaw) * mz + Math.sin(cameraYaw) * mx);
    const held = goat.interactions.tongueBody;
    const towingParcel = player && input.tongue === true && held !== null &&
      this.physics.bodyData(held.handle)?.data === 'parcel';
    const wall = goat.locomotion.findClimbSurface(wish);
    // Rooftop Express was tuned around its active parcel making chest contact
    // on a loaded approach. Keep that route independent of ordinary prop climbs.
    const courierParcelContact = towingParcel && wall?.body?.handle === held.handle;
    const blockedClimb = wall !== null && (this.blockedClimbHandles.has(wall.collider.handle) ||
      (wall.body?.isDynamic() === true && !courierParcelContact));
    const climbContact = blockedClimb ? null : wall;
    const head = goat.head.translation();
    const seekingTongueTarget = player && input.tongue && !goat.interactions.isTongueAttached;
    const courierAim = seekingTongueTarget && goat.size > 1
      ? this.rooftopParcelAim(goat) : undefined;
    // PartyMatch owns Hay Heist pickup/drop from the original tongue input.
    // The generic tongue ray would also tether the goat to nearby terrain.
    const directHit = hayHeist ? null : this.physics.raycast(courierAim ? goat.interactions.tongueOrigin : head,
      courierAim ?? add(forward(goat.locomotion.heading), V(0, -.10, 0)),
      9 * goat.size, { predicate: collider => !goat.ownsBody(collider.parent()) });
    const assistedAim = seekingTongueTarget && !match
      ? this.gigs.escortGnomeAim(goat, wish) ?? this.hayHaulBaleAim(goat, wish, cameraYaw, directHit?.body?.handle)
        ?? (courierAim ? undefined : this.coastGnomeAim(goat, directHit))
      : undefined;
    const hit = assistedAim?.hit ?? directHit;
    const prop = hit ? [...this.colliders.props].find(([, c]) => c.handle === hit.collider.handle) : undefined;
    const lickable = !!hit && (!prop || this.island.props.find(p => p.id === prop[0])?.lickable !== false);
    const facts: GoatPhysicsFacts = {
      grounded: goat.locomotion.grounded && climbContact === null,
      canCoyoteJump: goat.locomotion.canCoyoteJump,
      airborneTime: goat.locomotion.airborneSeconds,
      climbEffort: Math.hypot(mx, mz),
      touchingSteepWall: climbContact !== null,
      speed: Math.hypot(velocity.x, velocity.z),
      size: sim.style.tier,
      tongueTarget: lickable && hit ? 'hit-' + hit.collider.handle : null,
      climbDistance: player ? this.climbMetres : 0,
    };
    if (player) this.climbMetres = 0;
    const rulesIntent: GoatIntent = {
      sprint: input.sprint && (carryEffects?.canSprint ?? true),
      climb: input.climb ?? (goat.locomotion.isClinging || Math.hypot(mx, mz) > .1),
      chargeHeadbutt: (player ? !this.buildMode : true) && input.chargeHeadbutt,
      tongue: !hayHeist && input.tongue, reelTongue: !hayHeist && input.reelTongue,
      flingTongue: !hayHeist && input.flingTongue, bleat: input.bleat, flop: input.flop,
      jump: input.jump, glide: input.glide,
    };
    const result = sim.update(dt, rulesIntent, facts);
    const commands = result.commands[0]!;
    if (player && !match && facts.grounded && !goat.isRagdoll && sim.abilities.headbuttCharge > 0 &&
        Math.hypot(mx, mz) <= .08 && !commands.jump && !commands.ragdoll) {
      this.faceDemolitionCharge(goat, cameraYaw);
    }
    const parcelHeld = towingParcel && commands.tongue?.action !== 'fling';
    const safetyRail = !commands.jump && !commands.ragdoll
      ? this.nearbySafetyRail(goat, wish) : undefined;
    goat.locomotion.setInput({
      x: mx, z: mz, cameraYaw, sprint: commands.setSprint,
      canSprint: commands.setSprint, canClimb: commands.setClimb, canGlide: commands.setGlide, climbContact,
      acceptForwardSupport: parcelHeld ? this.gigs.isCourierRamp : undefined,
      safetyRail,
    });
    this.water.setPaddle(goat.torso, wish);
    this.executeCommands(commands, goat, player, assistedAim?.direction ?? courierAim);
    if (player && input.graze && this.canGraze() &&
        this.gigs.active?.setup.config.kind === 'mow-down') {
      this.gigs.noteAbility({ type: 'eat' });
    }
  }

  /** Turn the grounded body during the charge when a contract crate is in reach and in view. */
  private faceDemolitionCharge(goat: GoatRagdoll, look: number): void {
    const run = this.gigs.active;
    if (run?.status !== 'running' || run.setup.config.kind !== 'demolition-contract') return;
    const torso = goat.torso.translation();
    const head = goat.head.translation();
    const reach = goat.interactions.tuning.headbuttRange * goat.size +
      Math.hypot(head.x - torso.x, head.z - torso.z);
    const hit = this.physics.raycast(V(torso.x, head.y, torso.z), forward(look), reach, {
      predicate: collider => !goat.ownsBody(collider.parent()),
    });
    const owner = hit?.body && this.physics.bodyData(hit.body.handle)?.owner;
    if (owner && run.setup.config.pieces.some(piece => piece.id === owner)) goat.locomotion.heading = look;
  }

  private nearbySafetyRail(goat: GoatRagdoll, wish: Vec3): MovementInput['safetyRail'] {
    if (!goat.locomotion.grounded || goat.isRagdoll) return;
    const position = goat.torso.translation();
    const scale = this.island.size / 600;
    const inCraneYard = Math.abs(position.x - this.craneCenter.x) <= CRANE_YARD_PLAN.halfWidth * scale &&
      Math.abs(position.z - this.craneCenter.z) <= CRANE_YARD_PLAN.halfDepth * scale;
    if (!inCraneYard) {
      const end = this.boardwalkEnd;
      if (!end || position.z < end.edgeZ - 5 * scale || position.z > end.edgeZ ||
          Math.abs(position.x - end.deck.transform.position.x) > end.deck.size.x / 2) return;
    }
    return goat.locomotion.findSafetyRail(wish, this.safetyRailHandles);
  }

  /** The courier can lick the parcel below a grown goat's normal shallow aim.
   * The usual first-hit ray still needs a clear path from the mouth. */
  private rooftopParcelAim(goat: GoatRagdoll): Vec3 | undefined {
    const run = this.gigs.active;
    const course = run?.setup.config;
    if (run?.status !== 'running' || course?.kind !== 'rooftop-express') return;
    const parcel = this.gigs.props.get(course.parcelId);
    if (!parcel || parcel.broken) return;
    const target = parcel.body.translation();
    const offset = sub(target, goat.torso.translation());
    if (Math.hypot(offset.x, offset.y, offset.z) >= 5 * goat.size) return;
    const facing = forward(goat.locomotion.heading);
    if (facing.x * offset.x + facing.z * offset.z < Math.hypot(offset.x, offset.z) * .7) return;
    return sub(target, goat.interactions.tongueOrigin);
  }

  /** The loose gnome can roll above or below the normal tongue ray on the turnout slope. */
  private coastGnomeAim(goat: GoatRagdoll, directHit: RayHit | null):
    { direction: Vec3; hit: RayHit } | undefined {
    const gnome = this.colliders.bodies.get(COAST_TURNOUT_GNOME_ID);
    if (!gnome?.isValid() || !gnome.isEnabled()) return;
    const target = gnome.translation();
    const offset = sub(target, goat.torso.translation());
    if (Math.hypot(offset.x, offset.y, offset.z) > 3.5) return;
    const facing = forward(goat.locomotion.heading);
    if (facing.x * offset.x + facing.z * offset.z < Math.hypot(offset.x, offset.z) * Math.cos(Math.PI / 9)) return;

    // Keep an ordinary prop or scenery hit, even if only one of the two rays sees it.
    const terrain = this.colliders.terrain.handle;
    const hitsOtherScenery = (hit: RayHit | null): boolean =>
      hit !== null && hit.collider.handle !== terrain && hit.body?.handle !== gnome.handle;
    const tongue = goat.interactions;
    if (hitsOtherScenery(directHit) || hitsOtherScenery(tongue.raycastTongue())) return;
    const direction = sub(target, tongue.tongueOrigin);
    const hit = tongue.raycastTongue(direction);
    if (hit?.body?.handle === gnome.handle) return { direction, hit };
  }

  /** Let a stationary player aim at a nearby marked bale by looking toward it. */
  private hayHaulBaleAim(goat: GoatRagdoll, wish: Vec3, cameraYaw: number,
    directBodyHandle: number | undefined):
    { direction: Vec3; hit: RayHit } | undefined {
    const run = this.gigs.active;
    if (run?.status !== 'running' || run.setup.config.kind !== 'hay-haul') return;
    const bales = run.setup.config.bales.filter(({ id }) => !run.finishedIds.includes(id));
    const tongue = goat.interactions;
    const origin = tongue.tongueOrigin;
    const torso = goat.torso.translation();
    const movement = Math.hypot(wish.x, wish.z);
    const aim = movement > .08 ? mul(wish, 1 / movement) : forward(cameraYaw);
    let bestDistance = Math.min(4, HAY_HAUL_TAG_RADIUS * goat.size);
    let best: { direction: Vec3; hit: RayHit } | undefined;
    for (const { id } of bales) {
      const body = this.colliders.bodies.get(id);
      if (!body?.isValid() || !body.isEnabled()) continue;
      const target = body.translation();
      const offset = sub(target, torso);
      const distance = Math.hypot(offset.x, offset.y, offset.z);
      const alignment = aim.x * offset.x + aim.z * offset.z;
      if (alignment < Math.hypot(offset.x, offset.z) * .7) continue;
      if (body.handle === directBodyHandle && tongue.raycastTongue()?.body?.handle === body.handle) return;
      if (distance > bestDistance) continue;
      const direction = sub(target, origin);
      const hit = tongue.raycastTongue(direction);
      if (hit?.body?.handle !== body.handle) continue;
      bestDistance = distance;
      best = { direction, hit };
    }
    return best;
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

  onMaterialAudio(listener: (contact: MaterialAudioContact) => void): () => void {
    this.materialAudioListeners.add(listener);
    return () => { this.materialAudioListeners.delete(listener); };
  }

  reportGnomeBreak(position: Vec3): void {
    this.sendMaterialAudio({ type: 'gnome-break', position: { ...position } });
  }

  private sendMaterialAudio(contact: MaterialAudioContact): void {
    for (const listener of this.materialAudioListeners) listener(contact);
  }

  private sendVisualCue(goat: GoatRagdoll, action: GoatVisualCue['action']): void {
    const cue = { goatId: goat.id, action };
    for (const listener of this.visualCueListeners) listener(cue);
  }

  private executeCommands(commands: AbilityCommands, g = this.goat, player = true,
    tongueAim?: Vec3): void {
    if (commands.jump) {
      if (commands.jump.kind === 'wall-kick') g.locomotion.kickOffWall();
      else if (commands.jump.kind === 'flip') g.locomotion.requestFlip();
      else g.locomotion.requestJump();
    }
    if (commands.headbutt) {
      this.sendVisualCue(g, 'headbutt');
      if (player) this.lastActionTime = this.physics.time;
      const charge = Math.min(1, commands.headbutt.charge / TUNING.headbutt.maxCharge);
      // The physics lane's downward grazing ray can choose the terrain before a
      // nearby crate. Retain its torso lunge, then resolve an explicitly dynamic
      // forward target in core when that ray did not find one.
      const facing = forward(g.locomotion.heading);
      if (!g.isRagdoll) this.party.noteHeadbutt(g.id, facing);
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
      let knock: KnockedBodyEvent | undefined;
      const stopCapture = this.materialAudioListeners.size ? g.events.on(event => {
        if (event.type === 'knockedBody') knock = event;
      }) : undefined;
      let struck: RigidBody | null;
      try {
        struck = g.interactions.headbutt(charge);
      } finally {
        stopCapture?.();
      }
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
          knock = { type: 'knockedBody', goatId: g.id, time: this.physics.time,
            bodyHandle: target.handle, mass: target.mass(), speed: Math.hypot(
              target.linvel().x, target.linvel().y, target.linvel().z),
            impulse };
          g.events.emit(knock);
          struck = target;
        }
      }
      if (player) {
        const targetId = struck ? this.physics.bodyData(struck.handle)?.owner : undefined;
        this.gigs.noteAbility({ type: 'headbutt', targetId });
      }
      if (this.materialAudioListeners.size && !g.isRagdoll) {
        // Sample the wood/metal role while the body still exists. A stopped
        // headbutt can also reach a solid scenery collider without a knock.
        const kitSurface = contact && (!struck || contact.body?.handle === struck.handle)
          ? this.scenerySurfaces.get(contact.collider.handle) : undefined;
        const prop = struck ? this.propByBody.get(struck.handle)
          : contact && !kitSurface && !contact.body?.isDynamic() ? this.island.props.find(item =>
            this.colliders.props.get(item.id)?.handle === contact.collider.handle) : undefined;
        const role = struck && !prop ? this.physics.bodyData(struck.handle)?.data : undefined;
        const material = role === 'tower' || role === 'stack-crate' ? 'wood' : kitSurface ?? sceneryAudioMaterial(prop);
        const position = struck?.translation() ?? contact?.point;
        if (material && material !== 'hay' && position) {
          this.sendMaterialAudio({ type: 'headbutt', event: knock, material, position: { ...position },
            goatId: g.id, intensity: Math.min(1, commands.headbutt.impulse / 70) });
        }
      }
      // The preferred body can be removed immediately by the break below.
      const fixedBuildHandle = preferred?.body && !preferred.body.isDynamic() ? preferred.body.handle : undefined;
      if (struck) {
        const impact = commands.headbutt.impulse * .75;
        const shake = commands.headbutt.level === 'meteor' ? Math.max(SODA_POP_IMPULSE, impact) : impact;
        if (!this.chains.shakeSoda(struck, shake)) this.breakables.hit(struck, impact);
      }
      // Fixed Hay-Build pieces cannot be returned from GoatInteractions.headbutt,
      // so use the same forward query to route impact to logical HP.
      let hitPiece = false;
      if (fixedBuildHandle !== undefined) {
        const pieceId = [...this.buildBodies].find(([, body]) => body.handle === fixedBuildHandle)?.[0];
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
        if (g.interactions.attachTongue(tongueAim)) {
          if (player) {
            this.lastTongueTime = this.physics.time;
            const body = g.interactions.tongueBody;
            this.gigs.noteAbility({ type: 'tongue', targetId: body ?
              this.physics.bodyData(body.handle)?.owner : undefined });
          }
        }
      } else if (cmd.action === 'reel') {
        if (!player || !this.gigs.startStackLift()) g.interactions.setReel(-1);
      } else if (cmd.action === 'fling') {
        const target = g.interactions.tongueBody;
        if (target?.isDynamic()) {
          const direction = forward(g.locomotion.heading);
          target.applyImpulse(mul(add(direction, V(0, .3, 0)), cmd.impulse), true);
        }
        g.interactions.detachTongue('released');
      } else if (cmd.action === 'detach') {
        const target = g.interactions.tongueBody;
        const escortGnome = player && target && this.physics.bodyData(target.handle)?.data === 'gnome';
        g.interactions.detachTongue('released', !escortGnome);
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
  }

  /** The authored decking is raised above both the coastline and the offshore rescue boundary. */
  isAbovePierDeck(p: Vec3): boolean {
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
    const zone = this.isAbovePierDeck(p) ? 'baa-ardwalk' : zoneAt(this.island, p.x, p.z);
    const poi = this.island.pois.find(site => site.id === zone) ??
      this.island.pois.find(site => Math.hypot(site.center.x - p.x, site.center.z - p.z) < site.radius * 1.25);
    return poi?.name ?? 'Billy Isle';
  }

  /** Reposition a whole linked ragdoll without destroying its joints. Also used by rescue. */
  teleport(position: Vec3, uprightHeading?: number): void {
    this.goat.locomotion.leaveTraversal();
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
    this.toys.reset();
    const spawn = this.island.spawns[0]!.position;
    // A rescue is also a physical spawn; don't reapply the world lane's
    // clearance height on top of the ragdoll's own standing torso offset.
    this.teleport(V(spawn.x, this.spawnGround, spawn.z),
      this.island.spawns[0]!.heading);
    this.respawns++;
  }

  /** Use the same offshore limits as rescue, including the authored pier. */
  canResumeGigAt(position: Vec3): boolean {
    if (![position.x, position.y, position.z].every(Number.isFinite) ||
        position.y < this.island.seaLevel - .2 || position.y > 500) return false;
    const outside = Math.max(Math.abs(position.x), Math.abs(position.z)) > this.island.size * .57;
    if (outside) return this.isAbovePierDeck(position);
    return position.y >= heightAt(this.island, position.x, position.z) - this.goat.size;
  }

  /** Older saves can carry a bank height below the new timber crossings. */
  gigResumeGround(position: Vec3): Vec3 {
    const clearance = 3 * this.island.size / 600;
    const fromY = position.y + clearance;
    const ray = new RAPIER.Ray(V(position.x, fromY, position.z), V(0, -1, 0));
    let y = position.y;
    // The world query index is still empty while Game restores the running gig.
    for (const [id, collider] of this.colliders.props) {
      const shoreDeck = id.startsWith(BOARDWALK_SHORE_ID + 'deck-');
      const logTread = id.startsWith(PINES_LOG_ENTRY_ID) && id.includes('-tread-');
      if (!shoreDeck && !logTread) continue;
      const hit = collider.castRay(ray, clearance, false);
      if (hit >= 0) y = Math.max(y, fromY - hit);
    }
    return V(position.x, y, position.z);
  }

  exportProgress(): GameProgress {
    const progress: GameProgress = { gameplay: this.rules.toJSON(), gigs: this.gigs.director.toJSON(),
      gigBodies: this.gigs.saveBodies(), acknowledgedGigAttempt: this.acknowledgedGigAttempt };
    const run = this.gigs.active;
    if (run?.status === 'running') {
      const { x, y, z } = this.goat.torso.translation();
      const position = { x, y: y - .92 * this.goat.size, z };
      if (this.canResumeGigAt(position)) {
        progress.gigPlayerPose = { attemptId: run.attemptId, position, heading: this.goat.locomotion.heading };
      }
    }
    return progress;
  }

  get pendingGigResult() {
    const run = this.gigs.active;
    return (run?.status === 'completed' || run?.status === 'failed') &&
      run.attemptId > this.acknowledgedGigAttempt ? run : null;
  }

  acknowledgeGigResult(): void {
    const result = this.pendingGigResult;
    if (result) this.acknowledgedGigAttempt = result.attemptId;
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
    this.materialAudioListeners.clear();
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
