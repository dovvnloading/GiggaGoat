import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../gameplay';
import { BOARD_CYCLE_TICKS, GigCatalog, GigDirector } from '../gigs';
import { V } from '../physics';
import { generateIsland } from '../world';
import { Game } from './Game';

const seed = 'billy-isle';
const resolution = 193;

async function startCourier(cycle: number, grown = false) {
  const island = generateIsland({ seed, resolution });
  const gigs = new GigDirector(new GigCatalog(island, island.seed)).toJSON();
  gigs.tick = cycle * BOARD_CYCLE_TICKS;
  const gameplay = new GameSimulation().toJSON();
  if (grown) Object.assign(gameplay.style, { tier: 'Big', scale: 1.6, meter: 70 });
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
    const heading = parcel.translation().z > setup.start.z ? Math.PI : 0;
    game.teleport(setup.start, -heading);
    for (let tick = 0; tick < 45; tick++) game.step({ cameraYaw: heading });
    for (let tick = 0; tick < 10; tick++) game.step({ cameraYaw: heading, tongue: true });
    expect(game.goat.interactions.tongueBody?.handle).toBe(parcel.handle);
    expect(game.gigs.active?.checkpointIndex).toBe(1);
    return { game, heading, parcel, required: setup.config.checkpoints.length };
  } catch (error) {
    game.dispose();
    throw error;
  }
}

describe('Rooftop Express on actual Rapier steps', () => {
  it.each([[2, false, 5], [1, true, 4]] as const)(
    'finishes board cycle %i through the real ramp collisions (grown: %s)',
    async (cycle, grown, roofs) => {
      const { game, heading, required } = await startCourier(cycle, grown);
      try {
        expect(required).toBe(roofs);
        for (let tick = 0; tick < 1300 && game.gigs.active?.status === 'running'; tick++) {
          game.step({ cameraYaw: heading, tongue: true, moveZ: 1 });
        }
        expect(game.gigs.active).toMatchObject({ status: 'completed', checkpointIndex: roofs });
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
});
