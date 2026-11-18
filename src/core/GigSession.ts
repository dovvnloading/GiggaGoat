import type { Collider, CoefficientCombineRule, RigidBody } from '@dimforge/rapier3d-compat';
import { GigCatalog, GigDirector, GigGameplayBridge, type AbilityFact, type GigEvent,
  type GigOffer, type GigRun, type GigPropSpawn, type GigSetup, type GigSnapshot,
  type PropFact, type StyleFact } from '../gigs';
import { RAPIER, V, collisionGroups, type PhysicsContact } from '../physics';
import { heightAt, type PoiId } from '../world';
import { ROOFTOP_DECK_PREFIX, ROOFTOP_SPAN_PREFIX, rooftopDecks } from '../world/rooftop-course';
import type { Game } from './Game';
import type { RooftopPose } from './Persistence';

export interface GigBodySave {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  broken: boolean;
}
interface TemporaryProp { descriptor: GigPropSpawn; body: RigidBody; broken: boolean }
const COURIER_SHRINK_SETTLE_TICKS = 24;

/** Turns completed Rapier ticks into *observations*, never invented gig actions. */
export class GigSession {
  readonly catalog: GigCatalog;
  readonly director: GigDirector;
  private readonly bridge: GigGameplayBridge;
  private readonly temporary = new Map<string, TemporaryProp>();
  private readonly restockedHayBales = new Map<string, RigidBody>();
  private readonly collectedHay = new Map<string, RigidBody>();
  private towingHay: { collider: Collider; friction: number; combine: CoefficientCombineRule } | null = null;
  private readonly impacts = new Map<number, number>();
  private readonly courierSupports = new Set<number>();
  private readonly courierRamps = new Set<number>();
  readonly isCourierRamp = (handle: number): boolean => this.courierRamps.has(handle);
  private courierPressure = 0;
  private courierShrink: { previousSize: number; expiresAt: number } | null = null;
  private readonly abilities: AbilityFact[] = [];
  private readonly style: StyleFact[] = [];
  private readonly off: Array<() => void> = [];
  private readonly game: Game;
  latestEvents: GigEvent[] = [];
  latestPayout = 0;

  constructor(game: Game, seed: string | number, snapshot?: GigSnapshot,
    bodies: GigBodySave[] = [], rooftopPose?: RooftopPose) {
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
      const start = run.setup.start;
      const relocatedRoof = previous?.config.kind === 'rooftop-express' &&
        run.setup.config.kind === 'rooftop-express' &&
        (previous.start.x !== start.x || previous.start.y !== start.y || previous.start.z !== start.z);
      this.spawn(run.setup.spawns, relocatedRoof ? [] : bodies);
      this.stageRooftop(run.setup, relocatedRoof ? undefined : rooftopPose);
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
    const run = this.active;
    if (run) this.keepHayBalesAvailable(run);
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
      this.game.physics.raw.createCollider(RAPIER.ColliderDesc.cuboid(
        descriptor.size.x / 2, descriptor.size.y / 2, descriptor.size.z / 2)
        .setMass(descriptor.mass).setFriction(.85)
        .setCollisionGroups(collisionGroups('prop'))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS |
          RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), body);
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
  /** Called after each completed physics tick, including catch-up substeps. */
  tick(climbed: number): void {
    const run = this.active;
    if (this.courierShrink && (this.game.physics.stepCount > this.courierShrink.expiresAt ||
        !this.game.goat.interactions.isTongueAttached)) {
      this.courierShrink = null;
    }
    const p = this.game.goat.torso.translation();
    const abilities = this.abilities.splice(0);
    if (climbed > 0) abilities.push({ type: 'climb', metres: climbed });
    const style = this.style.splice(0);
    const props: PropFact[] = [];
    const held = this.game.goat.interactions.tongueBody?.handle;
    const hay = run?.status === 'running' && run.setup.config.kind === 'hay-haul' && held !== undefined
      ? run.setup.config.bales.find(({ id }) => this.game.colliders.bodies.get(id)?.handle === held)
      : undefined;
    this.setHayTowCollider(hay ? this.game.colliders.props.get(hay.id) ?? null : null);
    if (run?.status === 'running') {
      this.keepHayBalesAvailable(run);
      const relevant = new Set<string>(run.setup.spawns.map(s => s.id));
      if (run.setup.config.kind === 'hay-haul') {
        for (const bale of run.setup.config.bales) relevant.add(bale.id);
      }
      for (const id of relevant) {
        const entry = this.temporary.get(id);
        const body = entry?.body ?? this.game.colliders.bodies.get(id);
        if (!body || !this.game.physics.raw.getRigidBody(body.handle)) continue;
        const position = body.translation(), rotation = body.rotation();
        const up = Math.max(-1, Math.min(1, 1 - 2 * (rotation.x ** 2 + rotation.z ** 2)));
        const impact = this.impacts.get(body.handle) ?? 0;
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
          if (testedImpact >= threshold) entry.broken = true;
        }
        props.push({ id, position: { ...position }, velocity: { ...body.linvel() },
          tilt: Math.acos(up), impact, heldByTongue: held === body.handle,
          carried: held === body.handle, broken: !!entry?.broken || this.game.destroyedProps.has(id) });
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
  }
  saveBodies(): GigBodySave[] {
    const save = (id: string, body: RigidBody, broken: boolean): GigBodySave => ({
      id, position: { ...body.translation() }, velocity: { ...body.linvel() },
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
  }
  dispose(): void { this.clear(); for (const off of this.off.splice(0)) off(); }
}
