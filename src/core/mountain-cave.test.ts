import { expect, it } from 'vitest';
import { Game } from './Game';

it('walks from the terrace into the mountain cave above its rendered floor', async () => {
  const game = await Game.create();
  try {
    game.step();
    const cave = game.island.props.find(prop =>
      prop.kind === 'cave-mouth' && prop.poiId === 'mt-gigga')!;
    const at = cave.transform.position;
    const floor = at.y - .49 * cave.size.y;
    const groundAt = (x: number, z: number) => game.physics.raycast(
      { x, y: at.y + 10, z }, { x: 0, y: -1, z: 0 }, 42,
      { predicate: c => c.handle === game.colliders.terrain.handle ||
        game.colliders.paths.some(path => c.handle === path.handle) })!.point.y;
    for (const dx of [-1.8, 0, 1.8]) {
      for (const dz of [-1.5, 0, 1.5, 2.1]) {
        expect(groundAt(at.x + dx, at.z + dz)).toBeCloseTo(floor, 1);
      }
    }
    game.teleport({ x: at.x, y: groundAt(at.x, at.z + 9.25), z: at.z + 9.25 }, 0);
    let crossed = false;
    for (let tick = 0; tick < 210; tick++) {
      game.step({ moveZ: 1, cameraYaw: 0 });
      const position = game.goat.torso.translation();
      if (position.z <= at.z + 1) {
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
