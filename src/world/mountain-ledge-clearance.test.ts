import { expect, it } from 'vitest';
import { Game } from '../core/Game';
import { GigCatalog } from '../gigs/catalog';
import { GigDirector } from '../gigs/engine';
import { DIFFICULTIES } from '../gigs/types';
import { generateIsland } from './island';

it.each([
  { routeId: 'mt-gigga--the-dam', first: 167, last: 173, ledge: 'detail-mt-gigga-ledge-360' },
  { routeId: 'mt-gigga--the-dam', first: 127, last: 133, ledge: 'detail-mt-gigga-ledge-356' },
  { routeId: 'mt-gigga--hoofington', first: 122, last: 127, ledge: 'detail-mt-gigga-ledge-354' },
  { routeId: 'downtown-bleatsville--mt-gigga', first: 116, last: 121, ledge: 'mt-gigga-ledge-118' },
])('walks both ways on $routeId past $ledge', async ({ routeId, first, last, ledge }) => {
  const game = await Game.create();
  try {
    const road = game.island.roads.find(route => route.id === routeId)!;
    const section = road.points.slice(first, last + 1).reverse();
    const start = section[0]!;
    const shelves = game.island.props.filter(prop => prop.kind === 'ledge' && prop.poiId === 'mt-gigga');
    expect(shelves).toHaveLength(49);
    const tracked = new Set(shelves.map(prop => game.colliders.props.get(prop.id)!.handle));
    const support = new Set([game.colliders.terrain.handle, ...game.colliders.paths.map(path => path.handle)]);
    game.step();
    const floor = game.physics.raycast({ ...start, y: start.y + 3 }, { x: 0, y: -1, z: 0 }, 10, {
      predicate: collider => support.has(collider.handle),
    })!;
    game.teleport(floor.point);
    for (let tick = 0; tick < 30; tick++) game.step();

    let impacts = 0;
    const stop = game.physics.onContact(event => {
      if (event.type !== 'impact') return;
      const other = tracked.has(event.colliderA) ? event.bodyB :
        tracked.has(event.colliderB) ? event.bodyA : undefined;
      if (game.goat.bodies.some(body => body.handle === other)) impacts++;
    });
    try {
      for (const waypoint of [...section.slice(1), ...section.slice(0, -1).reverse()]) {
        for (let tick = 0; tick < 155; tick++) {
          const position = game.goat.torso.translation();
          const dx = waypoint.x - position.x;
          const dz = waypoint.z - position.z;
          if (Math.hypot(dx, dz) <= .85) break;
          game.step({ moveZ: 1, cameraYaw: Math.atan2(dx, -dz) });
        }
        const position = game.goat.torso.translation();
        expect(Math.hypot(waypoint.x - position.x, waypoint.z - position.z),
          `Traversal stalled near X ${position.x.toFixed(2)}, Z ${position.z.toFixed(2)} after ${impacts} ledge impacts`)
          .toBeLessThanOrEqual(.85);
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

it('restores pre-reroute Summit Sprint saves against the original shelf positions', () => {
  const island = generateIsland();
  const original = island.legacySummitLedgePositions!;
  const catalog = new GigCatalog(island);
  const previousCatalog = new GigCatalog({
    ...island,
    legacySummitLedgePositions: {},
    props: island.props.map(prop => original[prop.id] ? {
      ...prop, transform: { ...prop.transform, position: original[prop.id]! },
    } : prop),
  });
  expect(Object.keys(original)).toContain('mt-gigga-ledge-118');
  for (const difficulty of DIFFICULTIES) {
    const director = new GigDirector(previousCatalog);
    const current = director.startPractice('summit-sprint', difficulty);
    const saved = director.toJSON();
    saved.run!.setup = previousCatalog['buildVariant'](current.offer, true);
    expect(saved.run!.setup).not.toEqual(current);
    expect(GigDirector.fromJSON(saved, catalog).active?.setup).toEqual(current);
    expect(catalog.build(current.offer)).toEqual(current);
  }
});
