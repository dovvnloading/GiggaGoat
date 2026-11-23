import { expect, it } from 'vitest';
import { GameSimulation } from '../gameplay';
import { BOARD_CYCLE_TICKS, GigCatalog, GigDirector, type Difficulty, type GigId, type Point } from '../gigs';
import { V } from '../physics';
import { generateIsland, heightAt } from '../world';
import { SPLASH_DIVE_BOARD_ID } from '../world/boardwalk';
import { Game } from './Game';

const seed = 'billy-isle';

async function accept(gig: GigId, difficulty: Difficulty, grown?: 'Big' | 'GIGGA', postedCycle?: number): Promise<Game> {
  const island = generateIsland({ seed });
  const catalog = new GigCatalog(island, island.seed);
  const poi = catalog.info(gig).poiId;
  const cycle = postedCycle ?? [0, 1, 2].find(index => catalog.board(poi, index * BOARD_CYCLE_TICKS)
    .offers.some(offer => offer.gigId === gig && offer.difficulty === difficulty))!;
  const gigs = new GigDirector(catalog).toJSON();
  gigs.tick = cycle * BOARD_CYCLE_TICKS;
  const gameplay = new GameSimulation().toJSON();
  if (grown === 'Big') Object.assign(gameplay.style, { tier: 'Big', scale: 1.6, meter: 70 });
  if (grown === 'GIGGA') Object.assign(gameplay.style, { tier: 'GIGGA', scale: 3, meter: 100 });
  const game = await Game.create({ seed, progress: { gameplay, gigs, gigBodies: [] } });
  const board = game.gigs.boards.find(board => board.poiId === poi)!;
  game.teleport(board.position);
  const offer = game.gigs.board(poi).find(offer => offer.gigId === gig)!;
  expect(offer.difficulty).toBe(difficulty);
  game.gigs.accept(offer.id);
  return game;
}

function walk(game: Game, target: Pick<Point, 'x' | 'z'>, tolerance = .65, maxTicks = 500, sprint = false): void {
  for (let tick = 0; tick < maxTicks; tick++) {
    const { x, z } = game.goat.torso.translation();
    if (Math.hypot(target.x - x, target.z - z) < tolerance) return;
    game.step({ moveZ: 1, cameraYaw: Math.atan2(target.x - x, z - target.z), sprint });
  }
  throw new Error('Stopped at ' + JSON.stringify(game.goat.torso.translation()) + ' walking to ' + JSON.stringify(target));
}

it('walks to the side diving board and lands a real Hard Splash Dive in clear water', async () => {
  const game = await accept('splash-dive', 'hard');
  try {
    const board = game.island.props.find(prop => prop.id === SPLASH_DIVE_BOARD_ID)!;
    const pier = game.island.props.find(prop => prop.kind === 'pier' && prop.poiId === 'baa-ardwalk')!;
    const config = game.gigs.active!.setup.config;
    if (config.kind !== 'splash-dive') throw new Error('Expected Splash Dive');
    game.step();
    for (const tier of ['easy', 'medium', 'hard'] as const) {
      const plan = game.gigs.catalog.build(game.gigs.catalog.makeOffer('splash-dive', tier));
      if (plan.config.kind !== 'splash-dive') throw new Error('Expected Splash Dive');
      expect(plan.config.jumpPoint.x).toBe(config.jumpPoint.x);
      expect(Math.abs(plan.config.jumpPoint.z - board.transform.position.z)).toBeLessThan(.8);
      expect(plan.config.jumpPoint.y - plan.config.waterY).toBeGreaterThan(plan.config.minDrop);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        const hit = game.physics.raycast(V(plan.config.landing.x + Math.cos(angle) * 3.6, 35,
          plan.config.landing.z + Math.sin(angle) * 3.6), V(0, -1, 0), 50,
        { predicate: collider => !game.goat.ownsBody(collider.parent()) });
        expect(hit?.point.y ?? -Infinity).toBeLessThan(plan.config.waterY);
      }
    }
    walk(game, { x: pier.transform.position.x, z: board.transform.position.z }, .65, 2400);
    walk(game, config.jumpPoint, .44);
    // The quicker approach needs a short pause before an accurately aimed jump.
    for (let tick = 0; tick < 6; tick++) game.step();
    game.step({ moveZ: 1, cameraYaw: Math.PI / 2, jump: true });
    for (let tick = 0; tick < 165 && game.gigs.active?.status === 'running'; tick++)
      game.step({ moveZ: 1, cameraYaw: Math.PI / 2 });
    expect(game.gigs.active).toMatchObject({ status: 'completed' });
    expect(game.respawns).toBe(0);
  } finally { game.dispose(); }
}, 35_000);

it.each([undefined, 'Big', 'GIGGA'] as const)('allows an ordinary %s nudge to move the gnome', async grown => {
  const game = await accept('escort-the-gnome', 'medium', grown);
  try {
    const config = game.gigs.active!.setup.config;
    if (config.kind !== 'escort-the-gnome') throw new Error('Expected Escort the Gnome');
    const from = config.route[0]!, next = config.route[1]!;
    const angle = Math.atan2(next.x - from.x, from.z - next.z);
    const setback = 1.5 + 1.5 * game.goat.size;
    const x = from.x - Math.sin(angle) * setback, z = from.z + Math.cos(angle) * setback;
    game.teleport(V(x, heightAt(game.island, x, z), z), -angle);
    const gnome = game.gigs.props.get(config.gnomeId)!.body;
    for (let tick = 0; tick < 125 && game.gigs.active?.status === 'running'; tick++) {
      game.step({ moveZ: 1, cameraYaw: angle });
      if (game.gigs.active!.checkpointIndex >= 2) break;
    }
    expect(game.gigs.active?.status, game.gigs.active?.failReason).toBe('running');
    expect(gnome.isValid()).toBe(true);
    const end = gnome.translation();
    expect(Math.hypot(end.x - from.x, end.z - from.z)).toBeGreaterThan(1);
  } finally { game.dispose(); }
}, 25_000);

it.each([['easy', 'Big', 102], ['medium', undefined, undefined], ['hard', undefined, undefined]] as const)(
  'tows the gnome through every %s flag using ordinary controls', async (difficulty, grown, cycle) => {
    const game = await accept('escort-the-gnome', difficulty, grown, cycle);
    try {
      const config = game.gigs.active!.setup.config;
      if (config.kind !== 'escort-the-gnome') throw new Error('Expected Escort the Gnome');
      const first = config.route[0]!, second = config.route[1]!;
      const yaw = Math.atan2(second.x - first.x, first.z - second.z);
      const dx = Math.sin(yaw), dz = -Math.cos(yaw);
      const lead = 1.8 + game.goat.size * .9;
      const approach = { x: first.x + dx * lead, z: first.z + dz * lead };
      walk(game, { x: approach.x + dz * 1.6, z: approach.z - dx * 1.6 });
      walk(game, approach, .36);
      const gnome = game.gigs.props.get(config.gnomeId)!.body;
      const latch = () => {
        for (let tick = 0; tick < 36 && game.goat.interactions.tongueBody?.handle !== gnome.handle; tick++) {
          const at = game.goat.torso.translation();
          const target = gnome.translation();
          game.step({ moveZ: 1, cameraYaw: Math.atan2(target.x - at.x, at.z - target.z), tongue: true });
        }
        expect(game.goat.interactions.tongueBody?.handle).toBe(gnome.handle);
      };
      latch();
      for (let tick = 0; tick < 700 && game.gigs.active?.status === 'running'; tick++) {
        if (cycle === 102 && tick === 42) {
          const before = gnome.linvel();
          game.step();
          const after = gnome.linvel();
          expect(game.goat.interactions.isTongueAttached).toBe(false);
          expect((after.x - before.x) * dx + (after.z - before.z) * dz).toBeGreaterThan(-1.2);
          for (let rest = 0; rest < 23; rest++) game.step();
          latch();
        }
        const next = config.route[game.gigs.active!.checkpointIndex] ?? config.route.at(-1)!;
        const at = game.goat.torso.translation();
        game.step({ moveZ: 1, cameraYaw: Math.atan2(next.x + dx * lead - at.x,
          at.z - next.z - dz * lead), tongue: true });
      }
      expect(game.gigs.active).toMatchObject({ status: 'completed', checkpointIndex: config.route.length });
      expect(game.respawns).toBe(0);
    } finally { game.dispose(); }
  }, 35_000);

it('fails a buried gnome promptly and can retry with a reachable one', async () => {
  const game = await accept('escort-the-gnome', 'medium');
  try {
    const config = game.gigs.active!.setup.config;
    if (config.kind !== 'escort-the-gnome') throw new Error('Expected Escort the Gnome');
    const gnome = game.gigs.props.get(config.gnomeId)!.body;
    const from = config.route[0]!;
    gnome.setTranslation(V(from.x, from.y - 1.35, from.z), true);
    game.step();
    expect(game.gigs.active).toMatchObject({ status: 'failed', failReason: expect.stringContaining('out of reach') });
    game.gigs.retryFailed();
    walk(game, { x: from.x - 2, z: from.z });
    game.step();
    expect(game.gigs.active).toMatchObject({ status: 'running', checkpointIndex: 1 });
  } finally { game.dispose(); }
});

it('still cracks the gnome under an external collision', async () => {
  const game = await accept('escort-the-gnome', 'medium', 'Big');
  try {
    const config = game.gigs.active!.setup.config;
    if (config.kind !== 'escort-the-gnome') throw new Error('Expected Escort the Gnome');
    const at = game.gigs.props.get(config.gnomeId)!.body.translation();
    const incoming = game.physics.createBox(V(at.x, at.y + 3, at.z), V(.6, .5, .6), 90);
    incoming.setLinvel(V(0, -18, 0), true);
    for (let tick = 0; tick < 50 && game.gigs.active?.status === 'running'; tick++) game.step();
    expect(game.gigs.active).toMatchObject({ status: 'failed', failReason: expect.stringContaining('cracked') });
  } finally { game.dispose(); }
});

it('still cracks the gnome after a hard landing without goat contact', async () => {
  const game = await accept('escort-the-gnome', 'medium', 'Big');
  try {
    const config = game.gigs.active!.setup.config;
    if (config.kind !== 'escort-the-gnome') throw new Error('Expected Escort the Gnome');
    const body = game.gigs.props.get(config.gnomeId)!.body;
    const { x, y, z } = body.translation();
    game.teleport(V(x - 5, heightAt(game.island, x - 5, z), z), 0);
    body.setTranslation(V(x, y + 9, z), true);
    for (let tick = 0; tick < 125 && game.gigs.active?.status === 'running'; tick++) game.step();
    expect(game.gigs.active).toMatchObject({ status: 'failed', failReason: expect.stringContaining('cracked') });
  } finally { game.dispose(); }
});

it.each([['easy', 3, 4], ['medium', 4, 6], ['hard', 5, 8]] as const)(
  'starts the %s Summit Sprint clock at flag one and finishes by walking its marked trail uphill',
  async (difficulty, checkpointCount, ascent) => {
    const game = await accept('summit-sprint', difficulty);
    try {
      const { setup } = game.gigs.active!;
      expect(game.gigs.active?.elapsedTicks).toBe(0);
      expect(game.goat.torso.translation().y).toBeGreaterThan(setup.start.y);
      expect(Math.hypot(game.goat.torso.translation().x - setup.start.x,
        game.goat.torso.translation().z - setup.start.z)).toBeLessThan(.05);
      game.step();
      expect(game.gigs.active?.checkpointIndex).toBe(1);
      const trail = game.island.roads.find(road => road.id === 'mt-gigga--hoofington')!;
      const start = trail.points.findIndex(point => point.x === setup.start.x && point.z === setup.start.z);
      expect(start).toBeGreaterThan(0);
      for (const point of trail.points.slice(0, start).reverse()) {
        if (game.gigs.active?.status !== 'running') break;
        walk(game, point);
      }
      expect(game.gigs.active).toMatchObject({ status: 'completed', checkpointIndex: checkpointCount, rating: 'gold' });
      expect(game.gigs.active?.metrics.climbed).toBeGreaterThan(ascent);
      expect(game.respawns).toBe(0);
    } finally { game.dispose(); }
  }, 35_000);

it('finishes Hard Summit Sprint at normal sprint pace on the browser QA route', async () => {
  const game = await accept('summit-sprint', 'hard');
  try {
    game.step();
    const turns = [
      [24.567, -14.53], [25.615, -9.866], [25.598, -4.361], [25.414, -3.276],
      [22.305, 4.556], [19.03, 8.771], [16.210, 10.885], [8.797, 13.576],
      [3.544, 13.358], [1.03, 12.534], [.508, 8.701], [.276, 6.097], [.121, 2.326],
    ] as const;
    for (const [x, z] of turns) {
      if (game.gigs.active?.status !== 'running') break;
      // Faster, momentum-preserving strides can require another turn at a
      // waypoint; the gold-time assertion still checks the whole route.
      walk(game, { x, z }, .65, 200, true);
    }
    expect(game.gigs.active).toMatchObject({ status: 'completed', checkpointIndex: 5, rating: 'gold' });
    expect(game.gigs.active!.metrics.climbed).toBeGreaterThan(9);
    expect(game.respawns).toBe(0);
  } finally { game.dispose(); }
}, 35_000);

it('preserves actual Summit Sprint ascent across reload and ignores interrupted movement', async () => {
  const game = await accept('summit-sprint', 'hard');
  let restored: Game | undefined;
  try {
    for (let tick = 0; tick < 20; tick++) game.step();
    const standY = game.goat.torso.translation().y;
    let highY = standY;
    for (let tick = 0; tick < 100; tick++) {
      game.step({ jump: tick === 0 });
      highY = Math.max(highY, game.goat.torso.translation().y);
    }
    expect(highY - standY).toBeGreaterThan(.3);
    expect(game.gigs.active?.metrics.climbed).toBe(0);

    const run = game.gigs.active!;
    const trail = game.island.roads.find(road => road.id === 'mt-gigga--hoofington')!;
    const start = trail.points.findIndex(point => point.x === run.setup.start.x && point.z === run.setup.start.z);
    const middle = start - 20;
    for (const point of trail.points.slice(middle, start).reverse()) walk(game, point);
    const earned = game.gigs.active!.metrics.climbed;
    expect(earned).toBeGreaterThan(2);

    restored = await Game.create({ seed, progress: game.exportProgress() });
    expect(restored.gigs.active).toMatchObject({
      status: 'running', attemptId: run.attemptId, metrics: { climbed: earned },
    });
    for (const point of trail.points.slice(0, middle).reverse()) {
      if (restored.gigs.active?.status !== 'running') break;
      walk(restored, point);
    }
    expect(restored.gigs.active).toMatchObject({ status: 'completed', checkpointIndex: 5 });

    game.step({ flop: true });
    expect(game.goat.isRagdoll).toBe(true);
    for (let tick = 0; tick < 60; tick++) game.step();
    expect(game.gigs.active?.metrics.climbed).toBe(earned);
    game.respawn();
    game.step();
    expect(game.respawns).toBe(1);
    expect(game.gigs.active?.metrics.climbed).toBe(earned);

    game.teleport(trail.points[5]!, 0);
    for (let tick = 0; tick < 45; tick++) game.step();
    expect(game.goat.locomotion.grounded).toBe(true);
    expect(game.gigs.active?.metrics.climbed).toBe(earned);
    for (const point of trail.points.slice(0, 5).reverse()) walk(game, point);
    expect(game.gigs.active?.metrics.climbed).toBe(earned);
  } finally {
    restored?.dispose();
    game.dispose();
  }
}, 35_000);

it('lets the older 5/5 Summit Sprint save earn its missing ascent by walking the trail', async () => {
  const original = await accept('summit-sprint', 'hard');
  const progress = original.exportProgress();
  original.dispose();

  const run = progress.gigs.run!;
  run.metrics.climbed = 6.572;
  run.checkpointIndex = 5;
  progress.gigPlayerPose = {
    attemptId: run.attemptId, position: { x: .121, y: 102.62, z: 2.326 }, heading: 0,
  };

  const game = await Game.create({ seed, progress });
  try {
    const trail = game.island.roads.find(road => road.id === 'mt-gigga--hoofington')!;
    const start = trail.points.findIndex(point => point.x === run.setup.start.x && point.z === run.setup.start.z);
    const upperTrail = trail.points.slice(0, start - 12);
    for (let tick = 0; tick < 45; tick++) game.step();
    expect(game.gigs.active).toMatchObject({
      status: 'running', checkpointIndex: 5, metrics: { climbed: 6.572 },
    });
    for (const point of upperTrail) walk(game, point);
    expect(game.gigs.active!.metrics.climbed).toBe(6.572);
    for (const point of upperTrail.slice().reverse()) {
      if (game.gigs.active?.status !== 'running') break;
      walk(game, point);
    }
    expect(game.gigs.active).toMatchObject({ status: 'completed', checkpointIndex: 5 });
    expect(game.gigs.active!.metrics.climbed).toBeGreaterThanOrEqual(8);
    expect(game.respawns).toBe(0);
  } finally { game.dispose(); }
}, 35_000);
