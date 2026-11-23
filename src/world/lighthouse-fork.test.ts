import { expect, it } from 'vitest';
import { Game } from '../core/Game';
import { roadSideOffset } from './roads';
import { segmentProjection } from './terrain';

it('walks the paved Lighthouse fork both ways on asphalt without changing the bridge deck', async () => {
  const game = await Game.create();
  try {
    const road = game.island.roads.find(item => item.id === 'whispering-pines--hoofington')!;
    const lighthouse = game.island.roads.find(item => item.id === 'whispering-pines--old-lighthouse')!;
    const bridge = lighthouse.points.filter(point => point.bridge);
    expect(bridge).toHaveLength(14);
    const landmarks = [
      [0, -203.59, 4.13, -29.78],
      [6, -216.72, 8.36, -12.09],
      [11, -238.81, 13.72, -14.74],
      [13, -245.60, 15.39, -16.05],
    ] as const;
    for (const [index, x, y, z] of landmarks) {
      expect(bridge[index]!.x).toBeCloseTo(x, 2);
      expect(bridge[index]!.y).toBeCloseTo(y, 2);
      expect(bridge[index]!.z).toBeCloseTo(z, 2);
    }

    const spans = lighthouse.points.slice(1).flatMap((b, i) => {
      const a = lighthouse.points[i]!;
      return a.bridge || b.bridge ? [{ a, b }] : [];
    });
    const route = road.points.filter(point => point.z >= -85 && point.z <= 9);
    expect(route.length).toBeGreaterThan(15);
    const asphalt = game.colliders.paths[0]!.handle;
    const trail = game.colliders.paths[1]!.handle;
    const terrain = game.colliders.terrain.handle;
    const down = { x: 0, y: -1, z: 0 };
    game.step();
    for (const point of route) {
      for (const span of spans) {
        expect(segmentProjection(point, span.a, span.b).distance)
          .toBeGreaterThan(road.width / 2 + (lighthouse.width + 1) / 2);
      }
      const index = road.points.indexOf(point);
      for (const lane of [-3.25, 0, 3.25]) {
        const offset = roadSideOffset(road, index, lane);
        const origin = { x: point.x + offset.x, y: 60, z: point.z + offset.z };
        const roadFloor = game.physics.raycast(origin, down, 90, {
          predicate: collider => collider.handle === asphalt,
        })!;
        const terrainFloor = game.physics.raycast(origin, down, 90, {
          predicate: collider => collider.handle === terrain,
        })!;
        const dirtFloor = game.physics.raycast(origin, down, 90, {
          predicate: collider => collider.handle === trail,
        });
        expect(roadFloor.point.y - terrainFloor.point.y).toBeGreaterThan(.09);
        if (dirtFloor) expect(dirtFloor.point.y).toBeLessThan(roadFloor.point.y);
      }
    }

    const first = route[0]!;
    game.teleport({ x: first.x, y: first.y + .2, z: first.z });
    for (let tick = 0; tick < 30; tick++) game.step();
    let airborne = 0, longestAirborne = 0, totalAirborne = 0, steps = 0;
    for (const target of [...route.slice(1), ...route.slice(0, -1).reverse()]) {
      let arrived = false;
      for (let tick = 0; tick < 160; tick++) {
        const p = game.goat.torso.translation();
        const dx = target.x - p.x;
        const dz = target.z - p.z;
        if (Math.hypot(dx, dz) < .65) {
          arrived = true;
          break;
        }
        game.step({ moveZ: 1, cameraYaw: Math.atan2(dx, -dz) });
        steps++;
        airborne = game.goat.locomotion.grounded ? 0 : airborne + 1;
        longestAirborne = Math.max(longestAirborne, airborne);
        if (airborne) totalAirborne++;
        expect(game.goat.locomotion.groundHit?.collider.handle).toBe(asphalt);
      }
      expect(arrived, `Waypoint at ${target.x}, ${target.z}`).toBe(true);
    }
    // Allow a brief gait bounce but not a sustained flight or false airtime.
    expect(longestAirborne).toBeLessThanOrEqual(12);
    expect(totalAirborne / steps).toBeLessThan(.01);
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
}, 30_000);
