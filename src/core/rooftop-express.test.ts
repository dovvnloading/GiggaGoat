import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../gameplay';
import { BOARD_CYCLE_TICKS, GigCatalog, GigDirector } from '../gigs';
import { V } from '../physics';
import { generateIsland } from '../world';
import { Game } from './Game';

const seed = 'billy-isle';
const resolution = 193;
const grownState = {
  Big: { tier: 'Big', scale: 1.6, meter: 70 },
  GIGGA: { tier: 'GIGGA', scale: 3, meter: 100 },
} as const;

async function startCourier(cycle: number, tier: 'Kid' | keyof typeof grownState = 'Kid') {
  const island = generateIsland({ seed, resolution });
  const gigs = new GigDirector(new GigCatalog(island, island.seed)).toJSON();
  gigs.tick = cycle * BOARD_CYCLE_TICKS;
  const gameplay = new GameSimulation().toJSON();
  if (tier !== 'Kid') Object.assign(gameplay.style, grownState[tier]);
  const game = await Game.create({ seed, resolution, progress: { gameplay, gigs, gigBodies: [] } });
  try {
    const board = game.gigs.boards.find(entry => entry.poiId === 'downtown-bleatsville')!;
    game.teleport(board.position, 0);
    const offer = game.gigs.board(board.poiId)[0]!;
    game.gigs.accept(offer.id);
    const setup = game.gigs.active!.setup;
    if (setup.config.kind !== 'rooftop-express') throw new Error('Expected the courier contract');
    const id = setup.config.parcelId;
    const parcel = game.gigs.props.get(id)!.body;
    const heading = game.goat.locomotion.heading;
    expect(game.goat.torso.translation().y).toBeGreaterThan(setup.config.streetY + 1.3);
    for (let tick = 0; tick < 45; tick++) game.step({ cameraYaw: heading });
    for (let tick = 0; tick < 10; tick++) game.step({ cameraYaw: heading, tongue: true });
    expect(game.goat.interactions.tongueBody?.handle).toBe(parcel.handle);
    expect(game.gigs.active?.checkpointIndex).toBe(1);
    return { game, heading, parcel, maxTicks: setup.maxTicks, required: setup.config.checkpoints.length };
  } catch (error) {
    game.dispose();
    throw error;
  }
}

describe('Rooftop Express on actual Rapier steps', () => {
  it.each([[0, 'Kid', 3], [1, 'Kid', 4], [2, 'Kid', 5], [1, 'Big', 4], [6, 'GIGGA', 3]] as const)(
    'finishes board cycle %i through the real ramp collisions as %s',
    async (cycle, tier, roofs) => {
      const { game, heading, maxTicks, required } = await startCourier(cycle, tier);
      try {
        const launchSize = game.goat.size;
        if (tier === 'GIGGA') expect(launchSize).toBe(3);
        expect(required).toBe(roofs);
        for (let tick = 0; tick < maxTicks && game.gigs.active?.status === 'running'; tick++) {
          game.step({ cameraYaw: heading, tongue: true, moveZ: 1 });
        }
        expect(game.gigs.active).toMatchObject({ status: 'completed', checkpointIndex: roofs });
        if (tier === 'GIGGA') expect(game.goat.size).toBeLessThan(launchSize);
      } finally { game.dispose(); }
    }, 90_000);

  it('still breaks an attached parcel under a real external impact', async () => {
    const { game, heading, parcel } = await startCourier(0);
    try {
      const at = parcel.translation();
      const incoming = game.physics.createBox(V(at.x, at.y + 3, at.z), V(.6, .5, .6), 90);
      incoming.setLinvel(V(0, -22, 0), true);
      for (let tick = 0; tick < 45 && game.gigs.active?.status === 'running'; tick++) {
        game.step({ cameraYaw: heading, tongue: true });
      }
      expect(game.gigs.active).toMatchObject({
        status: 'failed', failReason: 'The parcel got squashed',
      });
    } finally { game.dispose(); }
  });

  it('still breaks the parcel under an external impact immediately after a shrink', async () => {
    const { game, heading, maxTicks, parcel } = await startCourier(6, 'GIGGA');
    try {
      for (let tick = 0; tick < maxTicks && game.goat.size === 3 &&
          game.gigs.active?.status === 'running'; tick++) {
        game.step({ cameraYaw: heading, tongue: true, moveZ: 1 });
      }
      expect(game.goat.size).toBe(1.6);
      expect(game.goat.interactions.tongueBody?.handle).toBe(parcel.handle);
      const at = parcel.translation();
      const side = at.x >= game.goat.torso.translation().x ? 1 : -1;
      const incoming = game.physics.createBox(V(at.x + side * 1.2, at.y, at.z), V(.4, .35, .35), 90);
      incoming.setLinvel(V(-side * 28, 0, 0), true);
      for (let tick = 0; tick < 12 && game.gigs.active?.status === 'running'; tick++) {
        game.step({ cameraYaw: heading, tongue: true, moveZ: 1 });
      }
      expect(game.gigs.active).toMatchObject({
        status: 'failed', failReason: 'The parcel got squashed',
      });
    } finally { game.dispose(); }
  }, 90_000);
});
