import type { RigidBody } from '@dimforge/rapier3d-compat';
import { GigCatalog, GigDirector, GigGameplayBridge, type AbilityFact, type GigEvent,
  type GigOffer, type GigRun, type GigPropSpawn, type GigSnapshot, type PropFact, type StyleFact } from '../gigs';
import { RAPIER, collisionGroups, type PhysicsContact } from '../physics';
import { heightAt, type PoiId } from '../world';
import type { Game } from './Game';

export interface GigBodySave {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  broken: boolean;
}
interface TemporaryProp { descriptor: GigPropSpawn; body: RigidBody; broken: boolean }

/** Turns completed Rapier ticks into *observations*, never invented gig actions. */
export class GigSession {
  readonly catalog: GigCatalog;
  readonly director: GigDirector;
  private readonly bridge: GigGameplayBridge;
  private readonly temporary = new Map<string, TemporaryProp>();
  private readonly restockedHayBales = new Map<string, RigidBody>();
  private readonly impacts = new Map<number, number>();
  private readonly abilities: AbilityFact[] = [];
  private readonly style: StyleFact[] = [];
  private readonly off: Array<() => void> = [];
  private readonly game: Game;
  latestEvents: GigEvent[] = [];
  latestPayout = 0;

  constructor(game: Game, seed: string | number, snapshot?: GigSnapshot, bodies: GigBodySave[] = []) {
    this.game = game;
    this.catalog = new GigCatalog(game.island, seed);
    this.director = snapshot ? GigDirector.fromJSON(snapshot, this.catalog) : new GigDirector(this.catalog);
    this.bridge = new GigGameplayBridge(this.director, game.rules.wallet,
      game.rules.challenges, game.rules.events, false);
    this.off.push(game.physics.onContact(contact => this.onContact(contact)));
    this.off.push(game.rules.events.on('style:scored', event =>
      this.style.push({ type: event.trick, points: event.points })));
    const run = this.director.active;
    if (run?.status === 'running') {
      this.spawn(run.setup.spawns, bodies);
      this.keepHayBalesAvailable(run);
      if (run.setup.config.kind === 'hay-haul') {
        const saved = new Map(bodies.map(body => [body.id, body]));
        for (const { id } of run.setup.config.bales) {
          const state = saved.get(id);
          const body = game.colliders.bodies.get(id);
          if (!state || state.broken || !body) continue;
          body.setTranslation(state.position, true);
          body.setRotation(state.rotation, true);
          body.setLinvel(state.velocity, true);
          game.physics.registerBody(body, { kind: 'prop', owner: id, data: 'hay-bale' });
        }
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
    this.clear();
    const setup = this.director.accept(offerId);
    this.spawn(setup.spawns);
    const run = this.active;
    if (run) this.keepHayBalesAvailable(run);
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

  noteAbility(fact: AbilityFact): void { this.abilities.push(fact); }
  private onContact(contact: PhysicsContact): void {
    if (contact.type !== 'impact' || !this.active || this.active.status !== 'running') return;
    for (const handle of [contact.bodyA, contact.bodyB]) {
      if (handle === null) continue;
      this.impacts.set(handle, (this.impacts.get(handle) ?? 0) + contact.impulse);
    }
  }
  /** Called after each completed physics tick, including catch-up substeps. */
  tick(climbed: number): void {
    const run = this.active;
    const p = this.game.goat.torso.translation();
    const abilities = this.abilities.splice(0);
    if (climbed > 0) abilities.push({ type: 'climb', metres: climbed });
    const style = this.style.splice(0);
    const props: PropFact[] = [];
    if (run?.status === 'running') {
      this.keepHayBalesAvailable(run);
      const relevant = new Set<string>(run.setup.spawns.map(s => s.id));
      if (run.setup.config.kind === 'hay-haul') {
        for (const bale of run.setup.config.bales) relevant.add(bale.id);
      }
      const held = this.game.goat.interactions.tongueBody?.handle;
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
          if (impact >= threshold) entry.broken = true;
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
    this.latestEvents = events;
    const awards = this.bridge.settle();
    this.latestPayout = awards.reduce((sum, award) => sum + award.coins, 0);
    if (events.some(event => ['gig.completed', 'gig.failed', 'gig.abandoned'].includes(event.type))) this.clear();
    this.impacts.clear();
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
        const body = this.game.colliders.bodies.get(id);
        if (body?.isValid()) bodies.push(save(id, body, false));
      }
    }
    return bodies;
  }
  get props(): ReadonlyMap<string, TemporaryProp> { return this.temporary; }
  private clear(): void {
    for (const { body } of this.temporary.values()) {
      this.game.water.untrack(body);
      if (this.game.physics.raw.getRigidBody(body.handle)) this.game.physics.removeBody(body);
    }
    this.temporary.clear();
    for (const [id, body] of this.restockedHayBales) this.game.removeRestockedHayBale(id, body);
    this.restockedHayBales.clear();
    this.impacts.clear();
  }
  dispose(): void { this.clear(); for (const off of this.off.splice(0)) off(); }
}
