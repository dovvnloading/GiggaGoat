import { describe, expect, it } from 'vitest';
import { RAPIER, V } from '../physics';
import { heightAt } from '../world';
import { Game } from './Game';

describe('party match spawns', () => {
  it('finds a raised road even before the first physics step', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 193 });
    try {
      expect(game.physics.stepCount).toBe(0);
      game.party.start('rising-tide', 7, 'normal');
      const goat = game.party.bots.get('bot-3')!.goat;
      const { x, y, z } = goat.torso.translation();
      const terrain = heightAt(game.island, x, z);
      expect(y - .92 * goat.size - terrain).toBeGreaterThan(.15);
      const ray = new RAPIER.Ray(V(x, y + 2, z), V(0, -1, 0));
      const hits = game.colliders.paths.map(surface => surface.castRay(ray, 4, false))
        .filter(hit => hit >= 0);
      expect(y - .92 * goat.size).toBeCloseTo(y + 2 - Math.min(...hits), 4);
    } finally { game.dispose(); }
  });

  it.each((['billy-isle', 'party-spawn-alt'] as const).flatMap(seed =>
    (['rising-tide', 'king-of-the-peak', 'hay-heist'] as const).map(mode => ({ seed, mode }))))(
    'starts the player and bots on walkable support in $mode ($seed)', async ({ mode, seed }) => {
      const game = await Game.create({ seed, resolution: 193 });
      try {
        game.step();
        game.party.start(mode, 7, 'normal');
        const goats = [game.goat, ...[...game.party.bots.values()].map(bot => bot.goat)];
        for (const goat of goats) {
          const { x, y, z } = goat.torso.translation();
          expect(Math.abs(y - .92 * goat.size - heightAt(game.island, x, z)), `${mode} ${goat.id}`)
            .toBeLessThan(1.25);
          const ray = new RAPIER.Ray(V(x, y + 5, z), V(0, -1, 0));
          const surfaces = [game.colliders.terrain, ...game.colliders.paths];
          const hits = surfaces.map(surface => surface.castRay(ray, 10, false)).filter(hit => hit >= 0);
          const surfaceY = y + 5 - Math.min(...hits);
          expect(Math.abs(y - .92 * goat.size - surfaceY), `${mode} ${goat.id} support surface`)
            .toBeLessThan(.08);
        }
        const knockdowns: string[] = [];
        for (const goat of goats) goat.events.on(event => {
          if (event.type === 'ragdollStart') knockdowns.push(goat.id);
        });
        game.step();
        for (const goat of goats) {
          expect(goat.locomotion.grounded, `${mode} ${goat.id} at first tick`).toBe(true);
        }
        for (let tick = 1; tick < 30; tick++) game.step();
        expect(knockdowns, mode).toEqual([]);
        for (const goat of goats) {
          expect(goat.isRagdoll, `${mode} ${goat.id}`).toBe(false);
        }
      } finally { game.dispose(); }
    },
  );
});
