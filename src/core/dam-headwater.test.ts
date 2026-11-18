import { expect, it } from 'vitest';
import { getDamHeadwater } from '../world/dam-landscape';
import { V } from '../physics';
import { Game } from './Game';

it('splashes into the visible upper lake and keeps the rear road and back shore dry', async () => {
  const game = await Game.create();
  try {
    const { position, level } = getDamHeadwater(game.island);
    const wet = game.physics.createBox(V(position.x - 10, level + 2.8, position.z - 42),
      V(.3, .3, .3), 12, 'prop');
    const dryBank = game.physics.createBox(V(position.x + 29, level - .5, position.z - 42),
      V(.3, .3, .3), 12, 'prop');
    const oldRoad = game.island.roads.find(road =>
      road.id === 'the-dam--whispering-pines')!.points.find(point => point.x < position.x - 5)!;
    const dryCauseway = game.physics.createBox(V(oldRoad.x, level - .5, oldRoad.z),
      V(.3, .3, .3), 12, 'prop');
    expect(game.water.sample(dryBank).fraction).toBe(0);
    expect(game.water.sample(dryCauseway).fraction).toBe(0);
    expect(game.water.sample(wet).fraction).toBe(0);

    let splash = '';
    game.water.events.on(event => {
      if (event.bodyHandle === wet.handle && event.type === 'splash') splash = event.volumeId;
    });
    game.water.track(wet);
    for (let tick = 0; tick < 150 && !splash; tick++) game.step();
    expect(splash).toBe('dam-upper-reservoir');
    expect(game.water.sample(wet).volumeId).toBe('dam-upper-reservoir');
    expect(wet.translation().y).toBeCloseTo(level, 0);
  } finally {
    game.dispose();
  }
});
