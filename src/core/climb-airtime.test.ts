import { expect, it } from 'vitest';
import { V } from '../physics';
import { Game } from './Game';

it('awards a real wall-to-roof climb without an airtime trick', async () => {
  const game = await Game.create({ seed: 'billy-isle', resolution: 97 });
  try {
    const spawn = game.goat.torso.translation();
    const floorY = spawn.y + 25;
    game.physics.createGround(V(20, .5, 20), V(spawn.x, floorY - .5, spawn.z));
    game.physics.createGround(V(5, 1.8, 10), V(spawn.x, floorY + 1.8, spawn.z - 11));
    game.teleport(V(spawn.x, floorY, spawn.z + 2), 0);
    for (let tick = 0; tick < 35; tick++) game.step();
    expect(game.goat.locomotion.grounded).toBe(true);
    const tricks: string[] = [];
    game.rules.events.on('style:scored', event => tricks.push(event.trick));
    let climbed = false;
    for (let tick = 0; tick < 300; tick++) {
      game.step({ moveZ: 1, cameraYaw: 0, climb: true });
      climbed ||= game.goat.locomotion.isClinging;
      if (game.goat.torso.translation().z < spawn.z - 3 && game.goat.locomotion.grounded) break;
    }
    expect(climbed).toBe(true);
    expect(game.goat.locomotion.grounded).toBe(true);
    expect(game.goat.torso.translation().z).toBeLessThan(spawn.z - 3);
    expect(tricks).toContain('wall-climb');
    expect(tricks).not.toContain('airtime');
  } finally { game.dispose(); }
});
