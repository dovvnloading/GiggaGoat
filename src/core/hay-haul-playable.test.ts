import { expect, it } from 'vitest';
import { BOARD_CYCLE_TICKS, type Difficulty } from '../gigs';
import { forward, V } from '../physics';
import { Game, type PlayerIntent } from './Game';

async function createWithPostedTier(tier: Difficulty): Promise<Game> {
  const game = await Game.create();
  if (tier === 'easy') return game;

  // Advance the board calendar through a normal saved game. The goat still
  // starts at its real spawn and walks to the live offer before accepting.
  const snapshot = game.exportProgress();
  const cycle = [1, 2, 3, 4, 5, 6].find(number =>
    game.gigs.catalog.board('hoofington', number * BOARD_CYCLE_TICKS).offers
      .some(offer => offer.gigId === 'hay-haul' && offer.difficulty === tier));
  game.dispose();
  expect(cycle).toBeDefined();
  snapshot.gigs.tick = cycle! * BOARD_CYCLE_TICKS;
  return Game.create({ progress: snapshot });
}

it.each([
  ['easy', 3, 'gold'], ['medium', 4, 'gold'], ['hard', 5, 'silver'],
] as const)('completes the posted %s Hay Haul on foot through real tongue and reel input', async (tier, count, rating) => {
  const game = await createWithPostedTier(tier);
  try {
    const farm = game.island.pois.find(p => p.id === 'hoofington')!.center;
    function walk(dx: number, dz: number, input: PlayerIntent = {}): void {
      const x = farm.x + dx, z = farm.z + dz;
      for (let i = 0; i < 850; i++) {
        const p = game.goat.torso.translation();
        if (Math.hypot(p.x - x, p.z - z) < .63) return;
        game.step({ moveZ: 1, cameraYaw: Math.atan2(x - p.x, p.z - z), ...input });
        if (game.gigs.active?.status === 'failed') throw new Error(game.gigs.active.failReason);
      }
      const p = game.goat.torso.translation();
      throw new Error('Walk to local (' + dx + ', ' + dz + ') stopped at (' +
        (p.x - farm.x).toFixed(2) + ', ' + (p.z - farm.z).toFixed(2) + ')');
    }

    function attach(id: string) {
      const body = game.colliders.bodies.get(id)!;
      for (let tick = 0; tick < 260; tick++) {
        const goat = game.goat.torso.translation(), target = body.translation();
        const yaw = Math.atan2(target.x - goat.x, goat.z - target.z);
        const range = Math.hypot(target.x - goat.x, target.z - goat.z);
        const heading = forward(game.goat.locomotion.heading);
        const ray = game.physics.raycast(game.goat.head.translation(), V(heading.x, -.10, heading.z), 5.4,
          { predicate: collider => !game.goat.ownsBody(collider.parent()) });
        if (ray?.body?.handle === body.handle && range < 3.5) {
          game.step({ tongue: true, cameraYaw: yaw });
          if (game.goat.interactions.tongueBody?.handle === body.handle) break;
          game.step();
        }
        game.step({ moveZ: range > 2.1 ? .63 : .10, cameraYaw: yaw });
      }
      expect(game.goat.interactions.tongueBody?.handle, id).toBe(body.handle);
      expect(game.gigs.active!.seenIds).toContain(id);
      for (let i = 0; i < 100 && (game.goat.interactions.tongueLength ?? 0) > 1.1; i++)
        game.step({ tongue: true, reelTongue: true });
      return body;
    }

    walk(3.2, 3);
    const offer = game.gigs.board('hoofington').find(b => b.gigId === 'hay-haul')!;
    expect(offer.difficulty).toBe(tier);
    const wallet = game.rules.wallet.coins;
    game.gigs.accept(offer.id);
    const config = game.gigs.active!.setup.config;
    if (config.kind !== 'hay-haul') throw new Error('Expected Hay Haul');

    // Leave the village road through the west yard opening into the loading lane.
    walk(.5, 3.5);
    walk(.5, -20, { sprint: true });
    walk(-11, -20);
    walk(-25.8, -17.2);

    const bales = [...config.bales].sort((a, b) => a.start.z - b.start.z);
    expect(bales).toHaveLength(count);
    for (const { id } of bales) {
      const z = game.colliders.bodies.get(id)!.translation().z - farm.z;
      walk(-26.6, -16.3);
      walk(-26.6, z, { sprint: true });
      const bale = attach(id);
      // Leave extra room west of the farmhouse for the longer Hard tows.
      const route = tier === 'hard' && z > -10
        ? [[-27.25, z - 1.65], [-27.4, -14.5], [-26.2, -17.05], [-24.6, -21.8]] as const
        : [[-26.75, z], [-26.1, -17.05], [-24.6, -21.8]] as const;
      for (const [x, along] of route) {
        walk(x, along, { tongue: true });
        expect(bale.isValid(), id).toBe(true);
        expect(game.goat.interactions.tongueBody?.handle, id).toBe(bale.handle);
      }
      for (let i = 0; i < 100 && !game.gigs.active!.finishedIds.includes(id); i++)
        game.step({ tongue: true, reelTongue: true });
      expect(game.gigs.active!.finishedIds).toContain(id);
      game.step({ tongue: false });
    }

    const result = game.gigs.active!;
    expect(result.status).toBe('completed');
    expect(result.elapsedTicks).toBeLessThan(result.setup.maxTicks);
    expect(result.objective).toMatchObject({ kind: 'deliver', done: count, required: count });
    expect(result.rating).toBe(rating);
    expect(result.payout).toBeGreaterThan(0);
    expect(game.rules.wallet.coins).toBeGreaterThanOrEqual(wallet + result.payout!);
  } finally {
    game.dispose();
  }
}, 65_000);
