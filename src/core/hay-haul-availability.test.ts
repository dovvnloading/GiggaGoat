import { describe, expect, it } from 'vitest';
import { BOARD_CYCLE_TICKS, GigCatalog, type GigConfig } from '../gigs';
import { add, forward, mul, RAPIER, V } from '../physics';
import { generateIsland, heightAt } from '../world';
import { HOOFINGTON_HAUL_BALE_PREFIX } from '../world/hoofington-entrances';
import { Game } from './Game';
import { hayHaulGuidance } from './GigPresentation';
import type { GameProgress } from './Persistence';

const options = { resolution: 97 };

function mediumHayHaul(game: Game) {
  const board = game.gigs.boards.find(board => board.poiId === 'hoofington')!;
  game.teleport(board.position);
  const director = game.gigs.director;
  for (let cycle = 0; cycle < 6; cycle++) {
    const offer = game.gigs.board('hoofington').find(offer =>
      offer.gigId === 'hay-haul' && offer.difficulty === 'medium');
    if (offer) return { offer, config: hayHaulConfig(game.gigs.catalog.build(offer).config) };
    for (let t = 0; t < BOARD_CYCLE_TICKS; t++) {
      director.step({ goat: { position: board.position, size: .6 } });
    }
  }
  throw new Error('Expected an active Medium Hay Haul offer');
}

function hayHaulConfig(config: GigConfig) {
  if (config.kind !== 'hay-haul') throw new Error('Expected Hay Haul');
  return config;
}

function tag(game: Game, id: string) {
  game.respawn();
  for (let tick = 0; tick < 23; tick++) game.step();
  const body = game.colliders.bodies.get(id)!;
  const direction = forward(game.goat.locomotion.heading);
  body.setTranslation(add(game.goat.head.translation(), mul(direction, 2.3)), true);
  body.setLinvel(V(), true);
  body.setAngvel(V(), true);
  game.step();
  game.step({ tongue: true });
  expect(game.goat.interactions.tongueBody?.handle).toBe(body.handle);
  expect(game.gigs.active?.seenIds).toContain(id);
  game.step();
}

function placeAtDrop(game: Game, id: string, slot: number) {
  const { barn } = hayHaulConfig(game.gigs.active!.setup.config);
  const body = game.colliders.bodies.get(id)!;
  const x = barn.x + (slot % 2 === 0 ? -1.25 : 1.25);
  const z = barn.z + (slot < 2 ? -1.25 : 1.25);
  body.setTranslation({ x, y: heightAt(game.island, x, z) + 1, z }, true);
  body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  body.setLinvel(V(), true);
  body.setAngvel(V(), true);
  game.step();
}

describe('Hay Haul assigned bales', () => {
  it('fits the drop disk outside the barn and has a bale-width approach from the pasture', async () => {
    const game = await Game.create({ ...options, resolution: 193 });
    try {
      const { config } = mediumHayHaul(game);
      const farm = game.island.pois.find(poi => poi.id === 'hoofington')!.center;
      const rotation = { x: 0, y: 0, z: 0, w: 1 };
      const scenery = game.island.props.filter(prop =>
        prop.poiId === 'hoofington' && prop.collidable && prop.body.type === 'static');
      const blockers = (x: number, z: number, radius: number) => {
        const p = { x, y: heightAt(game.island, x, z) + .85, z };
        const volume = new RAPIER.Cylinder(.8, radius);
        return scenery.filter(({ id, size, transform }) =>
          Math.hypot(x - transform.position.x, z - transform.position.z) <=
            radius + Math.hypot(size.x, size.z) / 2 &&
          game.colliders.props.get(id)?.intersectsShape(volume, p, rotation)).map(prop => prop.id);
      };
      expect(blockers(config.barn.x, config.barn.z, config.radius)).toEqual([]);

      // Round the south end of the pasture fence, then take the lane between the silo and house.
      const route: ReadonlyArray<readonly [number, number]> = [
        [-41, 36], [-36, 36], [-36, 39.5], [-35.5, 39.5], [-35.5, 40],
        [-26.5, 40], [-26.5, -15], [-26, -15.5], [-25.5, -16],
        [config.barn.x - farm.x, config.barn.z - farm.z],
      ];
      for (let segment = 1; segment < route.length; segment++) {
        const [ax, az] = route[segment - 1]!;
        const [bx, bz] = route[segment]!;
        const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / .25);
        for (let step = 0; step <= steps; step++) {
          const x = ax + (bx - ax) * step / steps;
          const z = az + (bz - az) * step / steps;
          expect(blockers(farm.x + x, farm.z + z, 1.14), JSON.stringify({ x, z })).toEqual([]);
        }
      }
    } finally {
      game.dispose();
    }
  });

  it('restocks all four assigned bales when the field was already destroyed and pays once for delivery', async () => {
    const game = await Game.create(options);
    try {
      const { offer, config } = mediumHayHaul(game);
      expect(config.required).toBe(4);
      const field = game.island.props.filter(prop => prop.kind === 'hay-bale' && prop.poiId === 'hoofington');
      for (const { id } of field) expect(game.breakables.shatter(game.colliders.bodies.get(id)!)).toBe(true);
      expect(config.bales.every(({ id }) => !game.colliders.bodies.has(id))).toBe(true);

      game.gigs.accept(offer.id);
      const assigned = config.bales.map(bale => bale.id);
      expect(game.gigs.active?.objective).toMatchObject({ kind: 'deliver', done: 0, required: 4 });
      expect(field.filter(({ id }) => game.colliders.bodies.has(id)).map(p => p.id).sort()).toEqual(assigned.sort());
      expect(hayHaulGuidance(game, game.gigs.active)?.kind).toBe('pickup');
      for (const { id, start } of config.bales) {
        const body = game.colliders.bodies.get(id)!;
        expect(body.isValid()).toBe(true);
        expect(game.destroyedProps.has(id)).toBe(false);
        expect(game.physics.bodyData(body.handle)).toMatchObject({ kind: 'prop', owner: id, data: 'hay-bale' });
        expect(body.translation().x).toBeCloseTo(start.x);
        expect(body.translation().z).toBeCloseTo(start.z);
        expect(game.breakables.shatter(body)).toBe(false);
      }

      const wallet = game.rules.wallet.coins;
      placeAtDrop(game, config.bales[0]!.id, 0);
      expect(game.gigs.active?.objective).toMatchObject({ kind: 'deliver', done: 0 });
      for (const [index, { id }] of config.bales.entries()) {
        tag(game, id);
        placeAtDrop(game, id, index);
        expect(game.gigs.active?.objective).toMatchObject({ kind: 'deliver', done: index + 1 });
      }
      const result = game.gigs.active!;
      expect(result.status).toBe('completed');
      expect(game.rules.wallet.coins - wallet).toBe(result.payout);
      expect(result.payout).toBeGreaterThan(0);
      expect(game.gigs.director.pendingAwards).toHaveLength(0);
      expect(assigned.every(id => !game.colliders.bodies.has(id))).toBe(true);
      game.step();
      expect(game.rules.wallet.coins - wallet).toBe(result.payout);
    } finally {
      game.dispose();
    }
  });

  it('replaces an in-flight loss and retains legitimate deliveries and score when resuming new or old saves', async () => {
    const game = await Game.create(options);
    let snapshot: GameProgress;
    try {
      const { offer, config } = mediumHayHaul(game);
      game.gigs.accept(offer.id);
      const [first, second] = config.bales;
      // Stage a surviving original away from seeded farm contacts so its
      // scripted break below is the first loss of this assigned ID.
      const original = game.colliders.bodies.get(second!.id)!;
      original.setTranslation({ ...second!.start, y: second!.start.y + 40 }, true);
      original.setGravityScale(0, true);
      tag(game, first!.id);
      placeAtDrop(game, first!.id, 0);
      expect(game.gigs.active?.objective).toMatchObject({ kind: 'deliver', done: 1 });
      const collected = game.colliders.bodies.get(first!.id)!;
      expect(collected.isEnabled()).toBe(false);
      expect(collected.translation().z).toBeGreaterThan(config.barn.z + config.radius);

      tag(game, second!.id);
      expect(game.colliders.bodies.get(second!.id)).toBe(original);
      game.rules.awardStyle({ type: 'flip', quality: 1 });
      expect(game.breakables.shatter(original)).toBe(true);
      expect(game.colliders.bodies.get(second!.id)).toBeUndefined();
      game.step();
      const replacement = game.colliders.bodies.get(second!.id)!;
      expect(replacement.isValid()).toBe(true);
      expect(replacement.handle).not.toBe(original.handle);
      expect(game.colliders.bodies.get(first!.id)).toBe(collected);
      expect(game.gigs.active?.finishedIds).toEqual([first!.id]);
      expect(game.gigs.active?.seenIds).toEqual([first!.id, second!.id]);
      expect(game.gigs.active?.metrics.stylePoints).toBeGreaterThan(0);
      const location = replacement.translation();
      replacement.setTranslation({ ...location, x: location.x + 3 }, true);
      snapshot = JSON.parse(JSON.stringify(game.exportProgress()));
      expect(snapshot.gigBodies.some(body => body.id === first!.id)).toBe(false);
      expect(snapshot.gigBodies.find(body => body.id === second!.id)?.position.x).toBeCloseTo(location.x + 3);
    } finally {
      game.dispose();
    }

    const island = generateIsland({ ...options, seed: 'billy-isle' });
    const pastCatalog = new GigCatalog({ ...island, props: island.props.filter(prop =>
      !prop.id.startsWith(HOOFINGTON_HAUL_BALE_PREFIX)) }, island.seed);
    const previous: GameProgress = structuredClone(snapshot);
    const fieldRun = previous.gigs.run!;
    const currentBales = hayHaulConfig(fieldRun.setup.config).bales;
    fieldRun.setup = pastCatalog.build(fieldRun.setup.offer);
    fieldRun.setup.info.instruction = 'Drag the marked bales to the drop beside the barn. Chain-tow two for a combo.';
    const idMap = new Map(currentBales.map(({ id }, index) =>
      [id, hayHaulConfig(fieldRun.setup.config).bales[index]!.id]));
    fieldRun.seenIds = fieldRun.seenIds.map(id => idMap.get(id)!);
    fieldRun.finishedIds = fieldRun.finishedIds.map(id => idMap.get(id)!);
    previous.gigBodies = previous.gigBodies.map(body => ({ ...body, id: idMap.get(body.id)! }));
    // A pre-collection save can still retain a received bale's old drop pose.
    previous.gigBodies.push({ id: fieldRun.finishedIds[0]!,
      position: hayHaulConfig(fieldRun.setup.config).barn,
      rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: V(), broken: false });

    const legacy: GameProgress = structuredClone(previous);
    const oldRun = legacy.gigs.run!;
    const barn = island.props.find(p => p.poiId === 'hoofington' && p.kind === 'barn')!;
    const oldDrop = { ...barn.transform.position, y: barn.transform.position.y - barn.size.y / 2 + 1 };
    const oldConfig = hayHaulConfig(oldRun.setup.config);
    oldConfig.barn = oldDrop;
    oldConfig.radius = 6.5;
    oldRun.setup.markers[0]!.position = oldDrop;
    oldRun.setup.markers[0]!.radius = 6.5;
    oldRun.setup.info.instruction = 'Lick the marked bales into the barn. Chain-tow two for a combo.';
    if (oldRun.objective.kind !== 'deliver') throw new Error('Expected delivery objective');
    oldRun.objective = { ...oldRun.objective, label: 'Bales inside the barn', destination: oldDrop };
    legacy.gigBodies = [];

    for (const [progress, expected] of [[snapshot, snapshot], [previous, previous], [legacy, previous]] as const) {
      const resumed = await Game.create({ ...options, progress });
      try {
        const run = resumed.gigs.active!;
        expect(run).toEqual(expected.gigs.run);
        const config = hayHaulConfig(run.setup.config);
        const [first, second, ...remaining] = config.bales;
        const received = resumed.colliders.bodies.get(first!.id)!;
        expect(received.isEnabled()).toBe(false);
        expect(received.translation().z).toBeGreaterThan(config.barn.z + config.radius);
        const savedBale = progress.gigBodies.find(body => body.id === second!.id);
        const pending = resumed.colliders.bodies.get(second!.id)!;
        expect(pending.translation().x).toBeCloseTo(savedBale?.position.x ?? second!.start.x);
        if (savedBale) {
          expect(pending.translation()).toEqual(savedBale.position);
          expect(pending.rotation()).toEqual(savedBale.rotation);
          expect(pending.linvel()).toEqual(savedBale.velocity);
        }
        expect(run.objective).toMatchObject({ kind: 'deliver', done: 1, required: 4 });
        const wallet = resumed.rules.wallet.coins;
        resumed.step();
        expect(resumed.gigs.active?.objective).toMatchObject({ kind: 'deliver', done: 1 });
        placeAtDrop(resumed, second!.id, 1);
        expect(resumed.gigs.active?.objective).toMatchObject({ kind: 'deliver', done: 2 });
        for (const [index, { id }] of remaining.entries()) {
          tag(resumed, id);
          placeAtDrop(resumed, id, index + 2);
          expect(resumed.gigs.active?.objective).toMatchObject({ kind: 'deliver', done: index + 3 });
        }
        expect(resumed.gigs.active?.status).toBe('completed');
        expect(resumed.rules.wallet.coins - wallet).toBe(resumed.gigs.active?.payout);
      } finally {
        resumed.dispose();
      }
    }
  });
});
