import { expect, it } from 'vitest';
import { RAPIER, V } from '../physics';
import { MOUNTAIN_SPIRAL_TRAIL } from '../world/roads';
import { Game } from './Game';

it('walks from the terrace into the mountain cave above its rendered floor', async () => {
  const game = await Game.create();
  try {
    game.step();
    const cave = game.island.props.find(prop =>
      prop.kind === 'cave-mouth' && prop.poiId === 'mt-gigga')!;
    const { position: at, rotationY } = cave.transform;
    const cos = Math.cos(rotationY), sin = Math.sin(rotationY);
    const floor = at.y - .49 * cave.size.y;
    const point = (across: number, depth: number) => {
      const x = at.x + cos * across + sin * depth;
      const z = at.z - sin * across + cos * depth;
      const hit = game.physics.raycast(V(x, at.y + 10, z), V(0, -1, 0), 42,
        { predicate: c => c.handle === game.colliders.terrain.handle ||
          game.colliders.paths.some(path => c.handle === path.handle) });
      return hit!.point;
    };
    for (const dx of [-1.8, 0, 1.8]) {
      for (const dz of [-1.5, 0, 1.5, 2.1]) {
        expect(Math.abs(point(dx, dz).y - floor)).toBeLessThan(.12);
      }
    }
    game.teleport(point(0, 9.25), rotationY);
    let crossed = false;
    for (let tick = 0; tick < 210; tick++) {
      game.step({ moveZ: 1, cameraYaw: -rotationY });
      const position = game.goat.torso.translation();
      const depth = (position.x - at.x) * sin + (position.z - at.z) * cos;
      if (depth <= 1) {
        crossed = true;
        expect(position.y).toBeGreaterThan(floor + .4);
        break;
      }
    }
    expect(crossed).toBe(true);
    expect(game.goat.locomotion.grounded).toBe(true);
    expect(game.respawns).toBe(0);
  } finally { game.dispose(); }
});

it('walks the Spiral trail past the cave in both directions without touching the arch', async () => {
  const game = await Game.create();
  try {
    const cave = game.island.props.find(prop =>
      prop.kind === 'cave-mouth' && prop.poiId === 'mt-gigga')!;
    const walls = new Set([...game.colliders.props].filter(([id]) => id === cave.id ||
      id.startsWith(cave.id + '-')).map(([, collider]) => collider.handle));
    const road = game.island.roads.find(entry => entry.id === MOUNTAIN_SPIRAL_TRAIL)!;
    const path = road.points.slice(129, 137);
    game.step();
    for (const way of [path, [...path].reverse()]) {
      const first = way[0]!, next = way[1]!;
      const ray = new RAPIER.Ray(V(first.x, 100, first.z), V(0, -1, 0));
      const floor = Math.min(...[game.colliders.terrain, game.colliders.paths[1]!]
        .map(c => c.castRay(ray, 100, false)).filter(distance => distance >= 0));
      const yaw = Math.atan2(next.x - first.x, first.z - next.z);
      game.teleport(V(first.x, 100 - floor, first.z), -yaw);
      for (let i = 0; i < 45; i++) game.step({ cameraYaw: yaw });
      game.physics.drainContacts();

      for (const target of way.slice(1)) {
        let reached = false;
        for (let i = 0; i < 140; i++) {
          const at = game.goat.torso.translation();
          const dx = target.x - at.x, dz = target.z - at.z;
          if (Math.hypot(dx, dz) < .55) {
            reached = true;
            break;
          }
          game.step({ moveZ: 1, cameraYaw: Math.atan2(dx, -dz) });
          expect(game.physics.drainContacts().some(contact =>
            walls.has(contact.colliderA) || walls.has(contact.colliderB))).toBe(false);
          expect(game.goat.locomotion.grounded).toBe(true);
        }
        expect(reached, 'Spiral waypoint ' + target.z.toFixed(2)).toBe(true);
      }
    }
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});
