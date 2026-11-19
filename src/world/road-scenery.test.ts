import { describe, expect, it } from 'vitest';
import { Game } from '../core/Game';
import { RAPIER } from '../physics';
import { generateIsland } from './island';
import { pavedRoadOverlap } from './road-scenery';

describe('paved road scenery', () => {
  it.each(['billy-isle', 'hoofington-geometry', 'full-loop-core-test'])(
    'keeps the full solid footprint of generic plants off the asphalt on %s', seed => {
      const island = generateIsland({ seed });
      const overlapsRoad = pavedRoadOverlap(island);
      const blocked = island.colliders.flatMap(collider => {
        if (collider.shape !== 'cylinder' || !collider.id.startsWith('detail-island-')) return [];
        const radius = Math.max(collider.size.x, collider.size.z) / 2;
        return overlapsRoad(collider.transform.position, radius) ? [collider.id] : [];
      });
      expect(blocked).toEqual([]);
    },
  );

  it('preserves the seeded Crane bypass bushes and clears the center and edge for a sprint', async () => {
    const game = await Game.create();
    try {
      game.step();
      const probes = [
        ['detail-island-bush-470', 123.11, -39, 2.40317],
        ['detail-island-bush-500', 120.42, -42.56, 2.23989],
      ] as const;
      const down = { x: 0, y: -1, z: 0 };
      const onPavement = (x: number, z: number) => game.physics.raycast({ x, y: 25, z }, down, 30, {
        predicate: collider => game.colliders.paths.some(path => path.handle === collider.handle),
      })!;
      const goat = new RAPIER.Capsule(.23, .31);
      const rotation = { x: 0, y: 0, z: 0, w: 1 };
      for (const [id, x, z, radius] of probes) {
        const bush = game.colliders.props.get(id)!;
        expect(bush.isEnabled(), id).toBe(true);
        expect(bush.radius(), id).toBeCloseTo(radius, 4);
        const y = onPavement(x, z).point.y + .5;
        expect(bush.intersectsShape(goat, { x, y, z }, rotation), id).toBe(false);
      }

      const road = game.island.roads.find(x => x.id === 'downtown-bleatsville--the-dam')!;
      const first = road.points[63]!;
      const last = road.points[67]!;
      game.teleport(onPavement(first.x, first.z).point);
      for (let tick = 0; tick < 30; tick++) game.step();
      const startY = game.goat.torso.translation().y;
      let peak = startY;
      for (const target of road.points.slice(64, 68)) {
        for (let tick = 0; tick < 120; tick++) {
          const pos = game.goat.torso.translation();
          const dx = target.x - pos.x, dz = target.z - pos.z;
          if (Math.hypot(dx, dz) < .6) break;
          game.step({ moveZ: 1, sprint: true, cameraYaw: Math.atan2(dx, -dz) });
          peak = Math.max(peak, game.goat.torso.translation().y);
        }
      }
      const pos = game.goat.torso.translation();
      expect(Math.hypot(pos.x - last.x, pos.z - last.z)).toBeLessThan(.65);
      expect(peak - startY).toBeLessThan(.2);
      expect(game.goat.locomotion.grounded).toBe(true);
      expect(game.respawns).toBe(0);
    } finally {
      game.dispose();
    }
  });
});
