import { expect, it } from 'vitest';
import { getDamHeadwater, getDamOutflow } from '../world/dam-landscape';
import { V } from '../physics';
import { Game } from './Game';

it('splashes into the visible upper lake and keeps the rear road, shore and wall footing dry', async () => {
  const game = await Game.create();
  try {
    const { position, level } = getDamHeadwater(game.island);
    const wet = game.physics.createBox(V(position.x - 10, level + 2.8, position.z - 42),
      V(.3, .3, .3), 12, 'prop');
    const dryBank = game.physics.createBox(V(position.x + 29, level - .5, position.z - 42),
      V(.3, .3, .3), 12, 'prop');
    const dryFooting = game.physics.createBox(V(position.x - 10, level - .5, position.z - 5),
      V(.3, .3, .3), 12, 'prop');
    const oldRoad = game.island.roads.find(road =>
      road.id === 'the-dam--whispering-pines')!.points.find(point => point.x < position.x - 5)!;
    const dryCauseway = game.physics.createBox(V(oldRoad.x, level - .5, oldRoad.z),
      V(.3, .3, .3), 12, 'prop');
    expect(game.water.sample(dryBank).fraction).toBe(0);
    expect(game.water.sample(dryFooting).fraction).toBe(0);
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


it('keeps the air above the visible plunge pool dry and scores at its waterline', async () => {
  const game = await Game.create();
  try {
    const setup = game.gigs.director.startPractice('dam-bomb', 'easy');
    if (setup.config.kind !== 'splash-dive') throw new Error('Dam Bomb must use a splash objective');
    const { landing, waterY } = setup.config;
    const outflow = getDamOutflow(game.island);
    expect(outflow.containsXZ(landing.x, landing.z)).toBe(true);
    expect(waterY).toBeCloseTo(outflow.surfaceY(landing.z), 6);
    expect(landing.y).toBeCloseTo(waterY, 6);
    const air = game.physics.createBox(V(landing.x, waterY + 2.7, landing.z),
      V(.22, .22, .22), 12, 'prop');
    const below = game.physics.createBox(V(landing.x, waterY - .25, landing.z),
      V(.22, .22, .22), 12, 'prop');
    expect(game.water.sample(air).fraction).toBe(0);
    expect(game.water.sample(below).volumeId).toBe('reservoir');

    let actual: { volume: string; y: number } | undefined;
    game.water.events.on(event => {
      if (event.bodyHandle === air.handle && event.type === 'splash') {
        actual = { volume: event.volumeId, y: air.translation().y };
      }
    });
    game.water.track(air);
    for (let tick = 0; tick < 100 && !actual; tick++) game.step();
    expect(actual?.volume).toBe('reservoir');
    expect(actual?.y).toBeCloseTo(waterY, 0);
  } finally {
    game.dispose();
  }
});
