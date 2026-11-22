import { describe, expect, it } from 'vitest';
import { V } from '../physics';
import { heightAt } from '../world';
import { Game } from './Game';

function expectSnapped(game: Game): void {
  for (const body of game.goat.bodies) {
    const position = body.translation();
    const rotation = body.rotation();
    for (const alpha of [0, .5, 1]) {
      const rendered = game.physics.getInterpolatedTransform(body, alpha);
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(rendered.translation[axis]).toBeCloseTo(position[axis], 5);
      }
      const q = rendered.rotation;
      expect(Math.abs(q.x * rotation.x + q.y * rotation.y + q.z * rotation.z + q.w * rotation.w))
        .toBeCloseTo(1, 5);
    }
  }
}

describe('teleport interpolation', () => {
  it('snaps all goat bodies on teleport, respawn, and party transition', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 97 });
    try {
      for (let tick = 0; tick < 30; tick++) game.step();
      const initial = game.goat.torso.translation();
      const x = initial.x + 45, z = initial.z - 50;
      const version = game.teleportVersion;
      game.teleport(V(x, heightAt(game.island, x, z), z), Math.PI * .6);
      expect(game.teleportVersion).toBe(version + 1);
      expectSnapped(game);

      const destination = new Map(game.goat.bodies.map(body => [body.handle, { ...body.translation() }]));
      game.step();
      for (const body of game.goat.bodies) {
        const start = destination.get(body.handle)!;
        const live = body.translation();
        for (const alpha of [0, .5, 1]) {
          const rendered = game.physics.getInterpolatedTransform(body, alpha).translation;
          for (const axis of ['x', 'y', 'z'] as const) {
            expect(rendered[axis]).toBeCloseTo(start[axis] * (1 - alpha) + live[axis] * alpha, 4);
          }
        }
      }

      game.respawn();
      expectSnapped(game);
      game.party.start('hay-heist', 3, 'normal');
      expectSnapped(game);
      game.party.returnToFreeRoam();
      expectSnapped(game);
    } finally { game.dispose(); }
  });
});
