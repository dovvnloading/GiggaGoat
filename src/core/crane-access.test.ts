import { describe, expect, it } from 'vitest';
import { Game } from './Game';
import { heightAt } from '../world';

describe('Crane Yard public access', () => {
  it('walks from the entry markers to the roof using all four ramps', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 193 });
    try {
      const center = game.island.pois.find(poi => poi.id === 'crane-yard')!.center;
      const x = center.x + .15, z = center.z + 10;
      game.teleport({ x, y: heightAt(game.island, x, z), z });
      const roof = [
        [.15, -13.2], [4.55, -13.2], [4.55, 5.30], [.15, 5.30],
        [.15, -13.2], [4.55, -13.2], [4.55, 5.30], [-5.19, 5.30],
      ] as const;
      const respawns = game.respawns;
      for (const [dx, dz] of roof) {
        let distance = Infinity;
        for (let tick = 0; tick < 420 && distance > .19; tick++) {
          const goat = game.goat.torso.translation();
          const mx = center.x + dx - goat.x, mz = center.z + dz - goat.z;
          distance = Math.hypot(mx, mz);
          game.step({ moveZ: Math.min(1, distance * 2), cameraYaw: Math.atan2(mx, -mz) });
        }
        expect(distance, JSON.stringify({ target: [dx, dz], actual: game.goat.torso.translation() }))
          .toBeLessThanOrEqual(.19);
      }
      const roofGround = heightAt(game.island, center.x, center.z) + 24.25;
      expect(game.goat.torso.translation().y).toBeGreaterThan(roofGround + .3);
      expect(game.goat.locomotion.grounded).toBe(true);
      expect(game.respawns).toBe(respawns);
    } finally {
      game.dispose();
    }
  });
});
