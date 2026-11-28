import type { Collider, CoefficientCombineRule, RigidBody } from '@dimforge/rapier3d-compat';
import { GigCatalog, GigDirector, GigGameplayBridge, type AbilityFact, type GigEvent,
  type GigOffer, type GigRun, type GigPropSpawn, type GigSetup, type GigSnapshot,
  type PropFact, type StyleFact } from '../gigs';
import { gigSetupRelocated } from '../gigs/catalog';
import { RAPIER, V, collisionGroups, type GoatRagdoll, type PhysicsContact, type RayHit, type Vec3 } from '../physics';
import { lerp, distance, forward, Q, slerp, sub } from '../physics/math';
import { heightAt, type PoiId, type RoadPoint } from '../world';
import { segmentProjection } from '../world/terrain';
import { ROOFTOP_DECK_PREFIX, ROOFTOP_SPAN_PREFIX, rooftopDecks } from '../world/rooftop-course';
import type { Game } from './Game';
import type { GigPlayerPose, RooftopPose } from './Persistence';

export interface GigBodySave {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  broken: boolean;
}
interface TemporaryProp { descriptor: GigPropSpawn; body: RigidBody; broken: boolean }
interface StackLift {
  body: RigidBody;
  supportId: string | undefined;
  waypoints: Vec3[];
  clearRadius: number;
}
interface SummitAscent {
  trail: RoadPoint[];
  radius: number;
  startY: number;
  peak: number;
  previous: Vec3 | null;
  respawns: number;
  recovery: 'on-trail' | 'stumble' | 'interrupted';
}
const SUMMIT_TRAIL_ID = 'mt-gigga--hoofington';
const COURIER_SHRINK_SETTLE_TICKS = 24;
const STACK_LIFT_RANGE = 4;

/** Turns completed Rapier ticks into *observations*, never invented gig actions. */
export class GigSession {
  readonly catalog: GigCatalog;
  readonly director: GigDirector;
  private readonly bridge: GigGameplayBridge;
  private readonly temporary = new Map<string, TemporaryProp>();
  private readonly restockedHayBales = new Map<string, RigidBody>();
  private readonly collectedHay = new Map<string, RigidBody>();
  private stackLift: StackLift | null = null;
  private towingHay: { collider: Collider; friction: number; combine: CoefficientCombineRule } | null = null;
  private readonly impacts = new Map<number, number>();
  private readonly courierSupports = new Set<number>();
  private readonly courierRamps = new Set<number>();
  readonly isCourierRamp = (handle: number): boolean => this.courierRamps.has(handle);
  private courierPressure = 0;
  private courierShrink: { previousSize: number; expiresAt: number } | null = null;
  private gnomePressure = 0;
  private gnomeFloorPressure = 0;
  private gnomeRiskUntil = -1;
  private summitAscent: SummitAscent | null = null;
  private readonly abilities: AbilityFact[] = [];
  private readonly style: StyleFact[] = [];
  private readonly off: Array<() => void> = [];
  private readonly game: Game;
  latestEvents: GigEvent[] = [];
  latestPayout = 0;

  constructor(game: Game, seed: string | number, snapshot?: GigSnapshot,
    bodies: GigBodySave[] = [], rooftopPose?: RooftopPose, gigPlayerPose?: GigPlayerPose) {
    this.game = game;
    const laneX = rooftopDecks(game.island.props)[0]?.transform.position.x;
    for (const prop of game.island.props) {
      if (prop.poiId !== 'downtown-bleatsville') continue;
      const { position, rotationY } = prop.transform;
      const alongLane = laneX !== undefined && (prop.kind === 'shop' || prop.kind === 'house') &&
        Math.abs(position.x - laneX) <=
        (prop.size.x * Math.abs(Math.cos(rotationY)) + prop.size.z * Math.abs(Math.sin(rotationY))) / 2;
      if (!alongLane && !prop.id.startsWith(ROOFTOP_DECK_PREFIX) &&
          !prop.id.startsWith(ROOFTOP_SPAN_PREFIX)) continue;
      const collider = game.colliders.props.get(prop.id);
      if (collider) {
        this.courierSupports.add(collider.handle);
        // Shallow spans already work with the torso's ordinary ground probe.
        if (prop.id.startsWith(ROOFTOP_SPAN_PREFIX) && prop.size.y > .35 * prop.size.z) {
          this.courierRamps.add(collider.handle);
        }
      }
    }
    this.catalog = new GigCatalog(game.island, seed);
    this.director = snapshot ? GigDirector.fromJSON(snapshot, this.catalog) : new GigDirector(this.catalog);
    this.bridge = new GigGameplayBridge(this.director, game.rules.wallet,
      game.rules.challenges, game.rules.events, false);
    this.off.push(game.physics.onContact(contact => this.onContact(contact)));
    this.off.push(game.rules.events.on('style:scored', event =>
      this.style.push({ type: event.trick, points: event.points })));
    const run = this.director.active;
    if (run?.status === 'running') {
      const previous = snapshot?.run?.setup;
      const relocated = previous && run.setup.config.kind !== 'hay-haul' &&
        run.setup.config.kind !== 'mow-down' && gigSetupRelocated(previous, run.setup);
      this.spawn(run.setup.spawns, relocated ? [] : bodies);
      const saved = !relocated && gigPlayerPose?.attemptId === run.attemptId ? gigPlayerPose : undefined;
      if (run.setup.config.kind === 'rooftop-express') {
        this.stageRooftop(run.setup, saved ?? (relocated ? undefined : rooftopPose));
      } else {
        this.restorePlayer(run.setup, saved);
      }
      this.keepHayBalesAvailable(run);
      if (run.setup.config.kind === 'hay-haul') {
        const saved = new Map(bodies.map(body => [body.id, body]));
        for (const { id } of run.setup.config.bales) {
          const state = saved.get(id);
          const body = game.colliders.bodies.get(id);
          if (run.finishedIds.includes(id) || !state || state.broken || !body) continue;
          body.setTranslation(state.position, true);
          body.setRotation(state.rotation, true);
          body.setLinvel(state.velocity, true);
          game.physics.registerBody(body, { kind: 'prop', owner: id, data: 'hay-bale' });
        }
        this.collectHayDeliveries(run);
      }
    }
    // A snapshot can contain a pending, verified award. Settle it once on load.
    this.bridge.settle();
  }

  get active() { return this.director.active; }
  get boards(): { poiId: PoiId; position: { x: number; y: number; z: number }; name: string }[] {
    const { island } = this.game;
    const scale = island.size / 600;
    return island.pois.filter(poi => this.director.board(poi.id).offers.length > 0).map(poi => {
      const position = { ...poi.center };
      if (poi.id === 'hoofington') {
        // Put the introductory board beyond the sidewalk, beside the start lane.
        position.x += 6.4 * scale;
        position.z += 3 * scale;
        position.y = heightAt(island, position.x, position.z);
      } else if (poi.id === 'downtown-bleatsville') {
        position.x += 8.1 * scale;
        position.z += 2.2 * scale;
        position.y = heightAt(island, position.x, position.z);
      } else if (poi.id === 'crane-yard') {
        // Open apron beside the public gate, clear of both switchback lanes.
        position.x += 7.6 * scale;
        position.z += 2 * scale;
        position.y = heightAt(island, position.x, position.z);
      } else if (poi.id === 'mt-gigga') {
        // South shoulder of the last Hoofington switchback, clear of the summit ring.
        position.x -= scale;
        position.z += 17.5 * scale;
        position.y = heightAt(island, position.x, position.z);
      } else if (poi.id === 'old-lighthouse') {
        position.x += 7.2 * scale;
        position.z += 4.8 * scale;
        position.y = heightAt(island, position.x, position.z);
      }
      return { poiId: poi.id, position, name: poi.name };
    });
  }
  nearBoard(radius = 9): PoiId | null {
    if (this.game.party.match || this.active?.status === 'running') return null;
    const p = this.game.goat.torso.translation();
    const nearest = this.boards.filter(board =>
      Math.hypot(board.position.x - p.x, board.position.z - p.z) < radius &&
      Math.abs(board.position.y - p.y) < 8)
      .sort((a, b) => Math.hypot(a.position.x - p.x, a.position.z - p.z) -
        Math.hypot(b.position.x - p.x, b.position.z - p.z))[0];
    return nearest?.poiId ?? null;
  }
  board(poiId: PoiId): GigOffer[] {
    if (this.nearBoard() !== poiId) throw new Error('Walk up to the job board first');
    return this.director.board(poiId).offers;
  }
  accept(offerId: string): void {
    const poi = this.nearBoard();
    if (!poi || !this.director.board(poi).offers.some(offer => offer.id === offerId)) {
      throw new Error('Offer unavailable at this board');
    }
    this.startOffer(offerId);
  }

  /** A result can restart its exact failed offer from the field while it is still posted. */
  get retryableOffer(): GigOffer | null {
    const run = this.active;
    if (run?.status !== 'failed' || this.game.party.match) return null;
    const { id, poiId } = run.setup.offer;
    return this.director.board(poiId).offers.find(offer => offer.id === id) ?? null;
  }

  retryFailed(): void {
    const offer = this.retryableOffer;
    if (!offer) throw new Error('This contract is no longer available to retry.');
    this.startOffer(offer.id);
  }

  private startOffer(offerId: string): void {
    this.clear();
    const setup = this.director.accept(offerId);
    this.spawn(setup.spawns);
    this.stageRooftop(setup);
    this.stageSummit(setup);
    const run = this.active;
    if (run) this.keepHayBalesAvailable(run);
  }

  private stageSummit(setup: GigSetup): void {
    if (setup.offer.gigId !== 'summit-sprint' || setup.config.kind !== 'summit-sprint' ||
        setup.markers[0]?.type !== 'start') return;
    const trail = this.game.island.roads.find(road => road.id === SUMMIT_TRAIL_ID)?.points;
    const { start } = setup;
    const index = trail?.findIndex(point => point.x === start.x && point.z === start.z) ?? -1;
    const ahead = trail?.[index - 1] ?? setup.config.checkpoints[1]!;
    const heading = Math.atan2(ahead.x - start.x, start.z - ahead.z);
    this.game.teleport(start, -heading);
  }

  private restorePlayer(setup: GigSetup, saved?: GigPlayerPose): void {
    if (saved?.position && Number.isFinite(saved.heading) && this.game.canResumeGigAt(saved.position)) {
      this.game.teleport(this.game.gigResumeGround(saved.position), -saved.heading);
      return;
    }
    if (setup.offer.gigId === 'summit-sprint' && setup.markers[0]?.type === 'start') {
      this.stageSummit(setup);
      return;
    }
    // Older saves have a running clock and objective but no player location.
    // Put the goat back on the local course at a reliable starting point.
    const start = setup.start;
    const position = this.game.canResumeGigAt(start) ? start :
      this.boards.find(board => board.poiId === setup.offer.poiId)?.position;
    if (!position) return;
    const target = setup.markers[0]?.position ?? start;
    const heading = Math.atan2(target.x - position.x, position.z - target.z);
    this.game.teleport(position, -heading);
  }

  private stageRooftop(setup: GigSetup, saved?: RooftopPose): void {
    const config = setup.config;
    if (config.kind !== 'rooftop-express') return;
    const point = saved?.position;
    const limit = this.game.island.size / 2;
    if (saved && point && [point.x, point.y, point.z, saved.heading].every(Number.isFinite) &&
        Math.abs(point.x) < limit && Math.abs(point.z) < limit &&
        point.y >= config.streetY + 1.3 && point.y < setup.start.y + 25) {
      this.game.teleport(point, -saved.heading);
      return;
    }
    const pickup = setup.spawns.find(prop => prop.id === config.parcelId)?.position ??
      config.checkpoints[0] ?? setup.start;
    const start = { ...setup.start };
    if (this.game.goat.size === 3) {
      const deck = rooftopDecks(this.game.island.props).find(prop =>
        prop.transform.position.x === pickup.x && prop.transform.position.z === pickup.z);
      if (deck) {
        // Leave room to aim past the GIGGA goat's front hooves. The shorter
        // roof limits the runway, so the launch always remains on the deck.
        const scale = this.game.island.size / 600;
        const runway = Math.min(3.8 * scale, deck.size.z / 2 - .4 * scale);
        start.z = pickup.z + Math.sign(start.z - pickup.z) * runway;
      }
    }
    const heading = Math.atan2(pickup.x - start.x, start.z - pickup.z);
    this.game.teleport(start, -heading);
  }
  abandon(): void {
    this.director.abandon();
    this.clear();
  }

  private spawn(spawns: readonly GigPropSpawn[], saved: readonly GigBodySave[] = []): void {
    for (const descriptor of spawns) {
      const savedBody = saved.find(b => b.id === descriptor.id);
      const p = savedBody?.position ?? descriptor.position;
      const body = this.game.physics.raw.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z).setCcdEnabled(true)
        .setLinearDamping(.25).setAngularDamping(.45));
      const collider = RAPIER.ColliderDesc.cuboid(
        descriptor.size.x / 2, descriptor.size.y / 2, descriptor.size.z / 2)
        .setMass(descriptor.mass).setFriction(.85)
        .setCollisionGroups(collisionGroups('prop'))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS |
          RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      // The practice tower's sled crates can slide out from under a stack
      // when a Kid hits its base. The surrounding worksite keeps its traction.
      if (descriptor.role === 'tower') {
        collider.setFriction(.24).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
      }
      this.game.physics.raw.createCollider(collider, body);
      if (savedBody) {
        body.setRotation(savedBody.rotation, true);
        body.setLinvel(savedBody.velocity, true);
      }
      this.game.physics.registerBody(body, { kind: 'prop', owner: descriptor.id, data: descriptor.role });
      this.game.water.track(body);
      this.temporary.set(descriptor.id, { descriptor, body, broken: savedBody?.broken ?? false });
    }
  }

  private keepHayBalesAvailable(run: GigRun): void {
    if (run.setup.config.kind !== 'hay-haul') return;
    for (const { id } of run.setup.config.bales) {
      if (run.finishedIds.includes(id)) continue;
      const replacement = this.game.restockHayBale(id);
      if (replacement) this.restockedHayBales.set(id, replacement);
    }
  }

  private collectHayDeliveries(run: GigRun): void {
    if (run.setup.config.kind !== 'hay-haul') return;
    const { barn } = run.setup.config;
    const { game } = this;
    const scale = game.island.size / 600;
    for (const [i, id] of run.finishedIds.entries()) {
      if (this.collectedHay.has(id)) continue;
      // Older active saves can have already destroyed the received bale.
      const replacement = game.restockHayBale(id);
      if (replacement) this.restockedHayBales.set(id, replacement);
      const body = game.colliders.bodies.get(id);
      if (!body?.isValid()) continue;
      const prop = game.propByBody.get(body.handle);
      if (!prop) continue;
      if (game.goat.interactions.tongueBody?.handle === body.handle) {
        game.goat.interactions.detachTongue('replaced');
        this.setHayTowCollider(null);
      }

      // Received bales are shown on the apron beside the barn, clear of the
      // unloading approach. They leave the physics course as soon as counted.
      const upperRow = i >= 3;
      const x = barn.x + (2.5 + (upperRow ? i - 2.5 : i) * 2.35) * scale;
      const z = barn.z + 4 * scale;
      const y = heightAt(game.island, x, z) + prop.size.y * (upperRow ? 1.5 : .5);
      body.setEnabled(false);
      body.setTranslation(V(x, y, z), true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      game.physics.registerBody(body, { kind: 'prop', owner: id, data: 'hay-bale' });
      this.collectedHay.set(id, body);
    }
  }

  private resetCollectedHay(): void {
    for (const [id, body] of this.collectedHay) {
      if (this.restockedHayBales.has(id) || !body.isValid()) continue;
      const prop = this.game.propByBody.get(body.handle);
      if (!prop) continue;
      const { position, rotationY } = prop.transform;
      body.setTranslation(position, true);
      body.setRotation({ x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) }, true);
      body.setLinvel(V(), true);
      body.setAngvel(V(), true);
      body.setEnabled(true);
      this.game.seatStockHayBale(prop, body);
      this.game.physics.registerBody(body, { kind: 'prop', owner: id, data: 'hay-bale' });
    }
    this.collectedHay.clear();
  }

  private setHayTowCollider(collider: Collider | null): void {
    const previous = this.towingHay;
    if ((previous?.collider ?? null) === collider) return;
    if (previous?.collider.isValid()) {
      previous.collider.setFriction(previous.friction);
      previous.collider.setFrictionCombineRule(previous.combine);
    }
    this.towingHay = null;
    if (!collider?.isValid()) return;
    // An assigned bale needs to slide under a Kid's tongue pull while
    // retaining its weight and normal contact when released at the drop.
    this.towingHay = { collider, friction: collider.friction(), combine: collider.frictionCombineRule() };
    collider.setFriction(.19);
    collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
  }

  noteAbility(fact: AbilityFact): void { this.abilities.push(fact); }
  noteCourierShrink(previousSize: number): void {
    this.courierShrink = {
      previousSize: Math.max(previousSize, this.courierShrink?.previousSize ?? 0),
      expiresAt: this.game.physics.stepCount + COURIER_SHRINK_SETTLE_TICKS,
    };
  }

  private onContact(contact: PhysicsContact): void {
    if (contact.type !== 'impact') return;
    const run = this.active;
    if (run?.status !== 'running') return;
    if (run.setup.config.kind === 'escort-the-gnome') {
      const gnome = this.temporary.get(run.setup.config.gnomeId)?.body.handle;
      const goat = this.game.goat;
      if (gnome !== undefined && (contact.bodyA === gnome || contact.bodyB === gnome)) {
        const other = contact.bodyA === gnome ? contact.bodyB : contact.bodyA;
        const collider = contact.bodyA === gnome ? contact.colliderB : contact.colliderA;
        if (other !== null && goat.ownsBody(this.game.physics.raw.getRigidBody(other))) {
          this.gnomePressure += contact.impulse;
        } else if (collider === this.game.colliders.terrain.handle ||
            this.game.colliders.paths.some(path => path.handle === collider)) {
          this.gnomeFloorPressure += contact.impulse;
        }
      }
    }
    if (run.setup.config.kind === 'rooftop-express') {
      const parcel = this.temporary.get(run.setup.config.parcelId)?.body.handle;
      const goat = this.game.goat;
      if (parcel !== undefined && goat.interactions.tongueBody?.handle === parcel) {
        const a = contact.bodyA === parcel;
        if (a || contact.bodyB === parcel) {
          const otherBody = a ? contact.bodyB : contact.bodyA;
          const otherCollider = a ? contact.colliderB : contact.colliderA;
          if (this.courierSupports.has(otherCollider) ||
              (otherBody !== null && goat.ownsBody(this.game.physics.raw.getRigidBody(otherBody)))) {
            this.courierPressure += contact.impulse;
          }
        }
      }
    }
    for (const handle of [contact.bodyA, contact.bodyB]) {
      if (handle === null) continue;
      this.impacts.set(handle, (this.impacts.get(handle) ?? 0) + contact.impulse);
    }
  }

  private getStackLiftTarget(): { body: RigidBody; supportId?: string; drop: Vec3; height: number } | null {
    const run = this.active;
    const config = run?.setup.config;
    const goat = this.game.goat;
    const body = goat.interactions.tongueBody;
    if (this.stackLift || run?.status !== 'running' || config?.kind !== 'stack-up' ||
        !body?.isValid() || !body.isDynamic() || goat.isRagdoll) return null;
    const id = this.game.physics.bodyData(body.handle)?.owner;
    if (!id || !config.crateIds.includes(id) || run.finishedIds.includes(id)) return null;
    const nearby = (point: Vec3) =>
      Math.hypot(point.x - config.center.x, point.z - config.center.z) <= STACK_LIFT_RANGE;
    const position = body.translation();
    if (!nearby(goat.torso.translation()) || !nearby(position)) return null;
    const supportId = run.finishedIds.at(-1);
    const support = supportId ? this.temporary.get(supportId)?.body : undefined;
    if (supportId && !support?.isValid()) return null;
    const base = support?.translation();
    const height = config.crateHeight;
    return {
      body, supportId, height,
      drop: V(base?.x ?? config.center.x, base ? base.y + height + .12 :
        config.groundY + height / 2 + .12, base?.z ?? config.center.z),
    };
  }

  get stackLiftCue(): 'ready' | 'moving' | 'clear' | null {
    const lift = this.stackLift;
    if (!lift) return this.getStackLiftTarget() ? 'ready' : null;
    return lift.waypoints.length === 1 && this.underStackLift(lift) ? 'clear' : 'moving';
  }

  startStackLift(): boolean {
    const target = this.getStackLiftTarget();
    if (!target) return false;
    const { body, supportId, drop, height } = target;
    const position = body.translation();
    const clearanceY = Math.max(position.y, drop.y) + height;
    this.game.goat.interactions.detachTongue('released');
    this.game.water.untrack(body);
    body.setLinvel(V(), true);
    body.setAngvel(V(), true);
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.stackLift = {
      body, supportId,
      waypoints: [V(position.x, clearanceY, position.z), V(drop.x, clearanceY, drop.z), drop],
      clearRadius: height / 2 + this.game.goat.size * .65,
    };
    return true;
  }

  private underStackLift(lift: StackLift): boolean {
    const target = lift.waypoints.at(-1)!;
    const goat = this.game.goat.torso.translation();
    return Math.hypot(target.x - goat.x, target.z - goat.z) < lift.clearRadius;
  }

  private moveStackLift(run: GigRun): void {
    const lift = this.stackLift;
    if (!lift) return;
    const { body, supportId, waypoints } = lift;
    if (!body.isValid()) { this.stackLift = null; return; }
    const position = body.translation();
    const target = waypoints[0]!;
    if (run.finishedIds.at(-1) !== supportId) {
      this.releaseStackLift(body);
      return;
    }
    if (waypoints.length === 1 && this.underStackLift(lift)) {
      body.setNextKinematicTranslation(position);
      return;
    }
    const gap = distance(position, target);
    if (gap <= .01) {
      waypoints.shift();
      if (!waypoints.length) this.releaseStackLift(body);
      return;
    }
    // Move in separate vertical and horizontal legs to clear the actual stack.
    const speed = waypoints.length === 1 ? 2.8 : 4.8;
    body.setNextKinematicTranslation(lerp(position, target, Math.min(1, speed * this.game.physics.fixedDt / gap)));
    body.setNextKinematicRotation(slerp(body.rotation(), Q(), .16));
  }

  private releaseStackLift(body: RigidBody): void {
    this.stackLift = null;
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    body.setLinvel(V(), true);
    body.setAngvel(V(), true);
    this.game.water.track(body);
  }

  /** Keep the small, toppled objective selectable, with the same first-hit rule as a normal lick. */
  escortGnomeAim(goat: GoatRagdoll, wish: Vec3): { direction: Vec3; hit: RayHit } | undefined {
    const run = this.active;
    if (run?.status !== 'running' || run.setup.config.kind !== 'escort-the-gnome') return;
    const entry = this.temporary.get(run.setup.config.gnomeId);
    if (!entry || entry.broken || !entry.body.isValid()) return;
    const target = entry.body.translation();
    const torso = goat.torso.translation();
    const offset = sub(target, torso);
    if (distance(target, torso) > Math.min(5, 2 + 1.8 * goat.size)) return;
    const movement = Math.hypot(wish.x, wish.z);
    const aim = movement > .08 ? wish : forward(goat.locomotion.heading);
    const projected = (aim.x * offset.x + aim.z * offset.z) / (movement > .08 ? movement : 1);
    if (projected < Math.hypot(offset.x, offset.z) * .7) return;
    const direction = sub(target, goat.interactions.tongueOrigin);
    const hit = goat.interactions.raycastTongue(direction);
    if (hit?.body?.handle === entry.body.handle) return { direction, hit };
  }

  private gnomeBuried(position: { x: number; y: number; z: number }): boolean {
    const { island, colliders } = this.game;
    const approximate = heightAt(island, position.x, position.z);
    if (position.y > approximate + .4) return false;
    if (Math.abs(position.x) > island.size / 2 || Math.abs(position.z) > island.size / 2) return true;
    const ray = new RAPIER.Ray(V(position.x, approximate + 2.5, position.z), V(0, -1, 0));
    return [colliders.terrain, ...colliders.paths].some(floor => {
      const distance = floor.castRay(ray, 4, false);
      return distance >= 0 && position.y < ray.origin.y - distance - .23;
    });
  }

  private beginSummitAscent(run: GigRun): SummitAscent | null {
    const { island, colliders } = this.game;
    const { start } = run.setup;
    const road = island.roads.find(({ id }) => id === SUMMIT_TRAIL_ID);
    const startIndex = road?.points.findIndex(({ x, z }) => x === start.x && z === start.z) ?? -1;
    if (!road || startIndex < 1) return null;

    // Rebuild the earned-height floor from the existing score on reload.
    const ray = new RAPIER.Ray(V(start.x, start.y + 1, start.z), V(0, -1, 0));
    const hits = [colliders.terrain, ...colliders.paths]
      .map(floor => floor.castRay(ray, 3, false)).filter(distance => distance >= 0);
    const startY = hits.length ? ray.origin.y - Math.min(...hits) : start.y;
    return {
      trail: road.points.slice(0, startIndex + 1),
      radius: road.width, // Include the graded shoulders of the trail.
      startY,
      peak: startY + run.metrics.climbed,
      previous: null,
      respawns: this.game.respawns,
      recovery: 'interrupted',
    };
  }

  private measuredSummitAscent(position: Vec3, run: GigRun, flopped: boolean): number {
    const ascent = this.summitAscent ??= this.beginSummitAscent(run);
    if (!ascent) return 0;
    const { goat, colliders, respawns } = this.game;
    const { previous, trail, radius } = ascent;
    ascent.previous = { ...position };
    const travel = previous ? Math.hypot(position.x - previous.x, position.z - previous.z) : 0;
    const onTrail = trail.some((point, index) => index > 0 &&
      segmentProjection(position, trail[index - 1]!, point).distance <= radius);
    const scale = Math.max(1, goat.size);
    if (flopped || ascent.respawns !== respawns || !onTrail || !previous ||
        travel >= .45 * scale || Math.abs(position.y - previous.y) >= .35 * scale) {
      ascent.recovery = 'interrupted';
    } else if (goat.isRagdoll && ascent.recovery === 'on-trail') {
      ascent.recovery = 'stumble';
    }
    ascent.respawns = respawns;
    if (!onTrail || goat.isRagdoll) return 0;
    const support = goat.locomotion.groundHit;
    if (!goat.locomotion.grounded || !support || (support.collider.handle !== colliders.terrain.handle &&
        !colliders.paths.some(path => path.handle === support.collider.handle))) return 0;

    // A runner can slide uphill before regaining footing after an incidental trip.
    // Rescues, deliberate flops and route skips must rejoin at the earned height.
    if (ascent.recovery !== 'on-trail') {
      const rejoinHeight = (ascent.recovery === 'stumble' ? 1 : .1) * scale;
      if (support.point.y > ascent.peak + rejoinHeight) return 0;
      ascent.recovery = 'on-trail';
    }

    // Measure the supported trail height so an airborne torso cannot consume ascent.
    if (travel > .005) ascent.peak = Math.max(ascent.peak, support.point.y);
    const climbed = Math.round((ascent.peak - ascent.startY) * 1000) / 1000;
    return climbed - run.metrics.climbed;
  }
  /** Called after each completed physics tick, including catch-up substeps. */
  tick(climbed: number): void {
    const run = this.active;
    if (this.courierShrink && (this.game.physics.stepCount > this.courierShrink.expiresAt ||
        !this.game.goat.interactions.isTongueAttached)) {
      this.courierShrink = null;
    }
    const p = this.game.goat.torso.translation();
    const abilities = this.abilities.splice(0);
    if (run?.status === 'running' && run.setup.offer.gigId === 'summit-sprint' &&
        run.setup.markers[0]?.type === 'start') {
      climbed = this.measuredSummitAscent(p, run, abilities.some(action => action.type === 'flop'));
    }
    if (climbed > 0) abilities.push({ type: 'climb', metres: climbed });
    const style = this.style.splice(0);
    const props: PropFact[] = [];
    const held = this.game.goat.interactions.tongueBody?.handle;
    const hay = run?.status === 'running' && run.setup.config.kind === 'hay-haul' && held !== undefined
      ? run.setup.config.bales.find(({ id }) => this.game.colliders.bodies.get(id)?.handle === held)
      : undefined;
    this.setHayTowCollider(hay ? this.game.colliders.props.get(hay.id) ?? null : null);
    if (run?.status === 'running') {
      if (run.setup.config.kind === 'stack-up') this.moveStackLift(run);
      if (run.setup.config.kind === 'escort-the-gnome' &&
          abilities.some(action => action.type === 'headbutt' || action.type === 'flop' || action.type === 'bleat')) {
        this.gnomeRiskUntil = this.game.physics.stepCount + 12;
      }
      this.keepHayBalesAvailable(run);
      const relevant = new Set<string>(run.setup.spawns.map(s => s.id));
      if (run.setup.config.kind === 'hay-haul') {
        for (const bale of run.setup.config.bales) relevant.add(bale.id);
      }
      for (const id of relevant) {
        const entry = this.temporary.get(id);
        const body = entry?.body ?? this.game.colliders.bodies.get(id);
        const gnome = run.setup.config.kind === 'escort-the-gnome' && id === run.setup.config.gnomeId;
        if (!body || !this.game.physics.raw.getRigidBody(body.handle)) {
          if (gnome) props.push({ id, position: run.setup.start, unreachable: true });
          continue;
        }
        const position = body.translation(), rotation = body.rotation();
        const up = Math.max(-1, Math.min(1, 1 - 2 * (rotation.x ** 2 + rotation.z ** 2)));
        let impact = this.impacts.get(body.handle) ?? 0;
        if (gnome && this.game.physics.stepCount > this.gnomeRiskUntil && !this.game.goat.isRagdoll) {
          // A hoof pressing into the gnome also loads the supporting floor.
          // Count only the reaction matched by this tick's direct pressure.
          const supported = Math.min(this.gnomePressure, this.gnomeFloorPressure);
          const gentle = Math.min(impact, this.gnomePressure + supported);
          impact -= gentle - gentle / (1 + 4 * this.game.goat.size ** 3);
        }
        // A fragile prop visibly breaks only under an actual measured contact impulse.
        if (entry?.descriptor.fragile) {
          const threshold = run.setup.config.kind === 'escort-the-gnome' ?
            run.setup.config.breakImpulse : 35;
          // The larger goat can load the rope and ramp heavily during an ordinary
          // tow. Discount only that measured pressure, leaving other impacts,
          // loose parcels and deliberate headbutts at the usual fragility.
          const inCourierCarry = run.setup.config.kind === 'rooftop-express' && held === body.handle &&
            !abilities.some(action => action.type === 'headbutt' || action.type === 'flop');
          const pressure = inCourierCarry ? Math.min(impact, this.courierPressure) : 0;
          // Newly rebuilt hooves can briefly overlap their own parcel on a slope.
          // Keep the larger size only while those contacts settle.
          const carrySize = Math.max(this.game.goat.size, this.courierShrink?.previousSize ?? 0);
          const testedImpact = (impact - pressure) + pressure / (1 + 4 * carrySize ** 3);
          if (testedImpact >= threshold && !entry.broken) {
            entry.broken = true;
            if (gnome) this.game.reportGnomeBreak(position);
          }
        }
        props.push({ id, position: { ...position }, velocity: { ...body.linvel() },
          tilt: Math.acos(up), impact, heldByTongue: held === body.handle,
          carried: held === body.handle || this.stackLift?.body.handle === body.handle,
          broken: !!entry?.broken || this.game.destroyedProps.has(id),
          ...(gnome && this.gnomeBuried(position) ? { unreachable: true } : {}) });
      }
    }
    const events = this.director.step({
      goat: { position: { ...p }, size: this.game.goat.size,
        grounded: this.game.goat.locomotion.grounded },
      abilities, style, props,
    });
    if (run?.setup.config.kind === 'hay-haul' && events.some(event => event.type === 'objective.progress')) {
      const updated = this.active;
      if (updated) this.collectHayDeliveries(updated);
    }
    this.latestEvents = events;
    const awards = this.bridge.settle();
    this.latestPayout = awards.reduce((sum, award) => sum + award.coins, 0);
    if (events.some(event => ['gig.completed', 'gig.failed', 'gig.abandoned'].includes(event.type))) this.clear();
    this.impacts.clear();
    this.courierPressure = 0;
    this.gnomePressure = 0;
    this.gnomeFloorPressure = 0;
  }
  saveBodies(): GigBodySave[] {
    const save = (id: string, body: RigidBody, broken: boolean): GigBodySave => ({
      id, position: { ...body.translation() },
      velocity: this.stackLift?.body.handle === body.handle ? V() : { ...body.linvel() },
      rotation: { ...body.rotation() }, broken,
    });
    const bodies = [...this.temporary].map(([id, { body, broken }]) => save(id, body, broken));
    const run = this.active;
    if (run?.status === 'running' && run.setup.config.kind === 'hay-haul') {
      for (const { id } of run.setup.config.bales) {
        if (run.finishedIds.includes(id)) continue;
        const body = this.game.colliders.bodies.get(id);
        if (body?.isValid()) bodies.push(save(id, body, false));
      }
    }
    return bodies;
  }
  get props(): ReadonlyMap<string, TemporaryProp> { return this.temporary; }
  private clear(): void {
    this.stackLift = null;
    this.setHayTowCollider(null);
    for (const { body } of this.temporary.values()) {
      this.game.water.untrack(body);
      if (this.game.physics.raw.getRigidBody(body.handle)) this.game.physics.removeBody(body);
    }
    this.temporary.clear();
    this.resetCollectedHay();
    for (const [id, body] of this.restockedHayBales) this.game.removeRestockedHayBale(id, body);
    this.restockedHayBales.clear();
    this.impacts.clear();
    this.courierPressure = 0;
    this.courierShrink = null;
    this.gnomePressure = 0;
    this.gnomeFloorPressure = 0;
    this.gnomeRiskUntil = -1;
    this.summitAscent = null;
  }
  dispose(): void { this.clear(); for (const off of this.off.splice(0)) off(); }
}
