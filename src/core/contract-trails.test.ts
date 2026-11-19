import { expect, it } from 'vitest';
import { GameSimulation } from '../gameplay';
import { BOARD_CYCLE_TICKS, GigCatalog, GigDirector, type Difficulty, type GigId, type Point } from '../gigs';
import { V } from '../physics';
import { generateIsland, heightAt } from '../world';
import { SPLASH_DIVE_BOARD_ID } from '../world/boardwalk';
import { Game } from './Game';

const seed = 'billy-isle';

async function accept(gig: GigId, difficulty: Difficulty, grown?: 'Big' | 'GIGGA'): Promise<Game> {
  const island = generateIsland({ seed });
  const catalog = new GigCatalog(island, island.seed);
  const poi = catalog.info(gig).poiId;
  const cycle = [0, 1, 2].find(index => catalog.board(poi, index * BOARD_CYCLE_TICKS)
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

function walk(game: Game, target: Pick<Point, 'x' | 'z'>, tolerance = .65, maxTicks = 500): void {
  for (let tick = 0; tick < maxTicks; tick++) {
    const { x, z } = game.goat.torso.translation();
    if (Math.hypot(target.x - x, target.z - z) < tolerance) return;
    game.step({ moveZ: 1, cameraYaw: Math.atan2(target.x - x, z - target.z) });
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
    expect(game.gigs.active?.status).toBe('running');
    expect(gnome.isValid()).toBe(true);
    const end = gnome.translation();
    expect(Math.hypot(end.x - from.x, end.z - from.z)).toBeGreaterThan(1);
  } finally { game.dispose(); }
}, 25_000);

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
