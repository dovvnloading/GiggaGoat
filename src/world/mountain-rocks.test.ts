import { expect, it } from 'vitest';
import { Game } from '../core/Game';
import { generateIsland } from './island';
import { gridSample } from './terrain';

const DOWNTOWN_TRAIL = 'downtown-bleatsville--mt-gigga';
const DAM_TRAIL = 'mt-gigga--the-dam';
const FARM_TRAIL = 'mt-gigga--hoofington';

it('seats the Downtown approach boulder off the trail without thinning its collider', () => {
  const island = generateIsland();
  const rocks = island.props.filter(prop => prop.poiId === 'mt-gigga' && prop.kind === 'rock');
  expect(rocks).toHaveLength(27);
  const rock = rocks.find(prop => prop.id === 'detail-mt-gigga-rock-381')!;
  const { x, y, z } = rock.transform.position;
  expect(x).toBeLessThan(-90.5);
  expect(z).toBeGreaterThan(14.5);
  expect(z).toBeLessThan(19);
  expect(y - rock.size.y / 2).toBeCloseTo(gridSample(island, x, z), 3);
  expect(rock.size.x).toBeCloseTo(2.029, 3);
  expect(rock.size.y).toBeCloseTo(4.198, 3);
  expect(rock.size.z).toBeCloseTo(2.153, 3);
  const collider = island.colliders.find(item => 'id' in item && item.id === rock.id);
  expect(collider).toMatchObject({ shape: 'convex', transform: rock.transform, size: rock.size });
});

it.each([
  { route: DOWNTOWN_TRAIL, first: 70, last: 77, rocks: ['detail-mt-gigga-rock-381'] },
  { route: DOWNTOWN_TRAIL, first: 116, last: 121, rocks: ['mt-gigga-rock-119'] },
  { route: FARM_TRAIL, first: 122, last: 127, rocks: ['detail-mt-gigga-rock-373'] },
  { route: DAM_TRAIL, first: 144, last: 150, rocks: ['detail-mt-gigga-rock-384', 'detail-mt-gigga-rock-387'] },
])('walks the $route boulder section $first–$last in both directions', async ({ route, first, last, rocks }) => {
  const game = await Game.create();
  try {
    const road = game.island.roads.find(item => item.id === route)!;
    const support = new Set([game.colliders.terrain, ...game.colliders.paths].map(collider => collider.handle));
    const boulders = new Set(rocks.map(id => game.colliders.props.get(id)!.handle));
    let impacts = 0;
    const stop = game.physics.onContact(event => {
      if (event.type !== 'impact') return;
      const body = boulders.has(event.colliderA) ? event.bodyB :
        boulders.has(event.colliderB) ? event.bodyA : null;
      if (game.goat.bodies.some(part => part.handle === body)) impacts++;
    });
    try {
      for (const direction of [1, -1]) {
        const start = direction === 1 ? first : last;
        const end = direction === 1 ? last : first;
        const origin = road.points[start]!;
        game.step();
        const floor = game.physics.raycast({ ...origin, y: origin.y + 1.5 }, { x: 0, y: -1, z: 0 }, 6, {
          predicate: collider => support.has(collider.handle),
        })!;
        expect(floor).not.toBeNull();
        game.teleport(floor.point);
        for (let tick = 0; tick < 24; tick++) game.step();
        for (let index = start + direction; direction * (end - index) >= 0; index += direction) {
          const target = road.points[index]!;
          for (let tick = 0; tick < 230; tick++) {
            const position = game.goat.torso.translation();
            const dx = target.x - position.x, dz = target.z - position.z;
            if (Math.hypot(dx, dz) <= .83) break;
            game.step({ moveZ: 1, cameraYaw: Math.atan2(dx, -dz) });
          }
          const position = game.goat.torso.translation();
          expect(Math.hypot(target.x - position.x, target.z - position.z),
            'walking stopped before node ' + index).toBeLessThanOrEqual(.83);
        }
      }
    } finally {
      stop();
    }
    expect(impacts).toBe(0);
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
}, 20_000);
