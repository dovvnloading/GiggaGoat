import { expect, it } from 'vitest';
import { forward, V } from '../physics';
import { heightAt } from '../world';
import { Game } from './Game';

it('routes Hay Heist tongue to cargo, keeps carry limits and allows a normal headbutt punt', async () => {
  const game = await Game.create();
  try {
    const match = game.party.start('hay-heist', 3, 'normal', { countdownTicks: 0 });
    const target = match.bales.find(bale => bale.homeTeam === 'blue')!;
    // Stage near a pickup to isolate control routing from the arena's length.
    game.teleport(V(target.position.x, target.position.y - .7, target.position.z), 0);
    game.step();
    const head = game.goat.head.translation();
    const worldTarget = game.physics.createBox(V(head.x, head.y - .23, head.z - 2.5), V(.35, .55, .4), 8);
    game.step();
    game.step({ tongue: true });
    const carriedId = match.getEffects('player').carryingBaleId;
    expect(carriedId).toMatch(/^blue-hay-/);
    expect(game.goat.interactions.tongueBody).toBeNull();

    game.step({ moveZ: -1, cameraYaw: 0, tongue: true, sprint: true });
    expect(game.goat.locomotion.input.z).toBeCloseTo(-.7);
    expect(game.goat.locomotion.input.sprint).toBe(false);
    expect(game.goat.interactions.tongueBody).toBeNull();
    expect([...game.party.bots.values()].every(({ goat }) => !goat.interactions.isTongueAttached)).toBe(true);
    expect(worldTarget.isValid()).toBe(true);

    game.step({ tongue: false });
    expect(game.party.latestEvents).toContainEqual(expect.objectContaining({
      type: 'hay.dropped', playerId: 'player', reason: 'released',
    }));
    const released = match.bales.find(bale => bale.id === carriedId)!;
    const { x, z } = released.position;
    game.teleport(V(x, heightAt(game.island, x, z + .95), z + .95), 0);
    for (let i = 0; i < 20; i++) game.step();
    for (let i = 0; i < 18; i++) {
      game.step({ chargeHeadbutt: true });
      expect(game.party.latestEvents.some(event => event.type === 'hay.punted' && event.playerId === 'player'))
        .toBe(false);
    }
    game.step();
    expect(game.party.latestEvents).toContainEqual(expect.objectContaining({
      type: 'hay.punted', playerId: 'player', baleId: released.id,
    }));

    game.party.returnToFreeRoam();
    game.step();
    const mouth = game.goat.head.translation();
    const aim = forward(game.goat.locomotion.heading);
    const ordinaryCrate = game.physics.createBox(V(mouth.x + aim.x * 2, mouth.y - .2,
      mouth.z + aim.z * 2), V(.48, .55, .48), 8);
    for (let i = 0; i < 3 && !game.goat.interactions.isTongueAttached; i++) game.step({ tongue: true });
    expect(game.goat.interactions.tongueBody?.handle).toBe(ordinaryCrate.handle);
  } finally {
    game.dispose();
  }
});
