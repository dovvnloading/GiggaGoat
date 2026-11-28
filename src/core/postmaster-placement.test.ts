import { expect, it } from 'vitest';
import { RAPIER } from '../physics';
import { Game } from './Game';

it('gives the postmaster clear footing beside the village mailbox and only solidifies her while on duty', async () => {
  const game = await Game.create();
  try {
    const clerk = game.postmaster, p = clerk.position!;
    expect(p).toBeDefined();
    const boxes = game.island.props.filter(prop => prop.kind === 'mailbox');
    expect(Math.min(...boxes.map(box => Math.hypot(box.transform.position.x - p.x, box.transform.position.z - p.z))))
      .toBeLessThan(2);
    const at = { x: p.x + 2.1, y: p.y + .55, z: p.z };
    const world = game.physics.raw, rotation = { x: 0, y: 0, z: 0, w: 1 };
    const shape = new RAPIER.Cylinder(.48, .31);
    const overlaps = () => {
      world.step();
      const handles: number[] = [];
      world.intersectionsWithShape({ ...p, y: p.y + .74 }, rotation, shape, collider => {
        handles.push(collider.handle);
        return true;
      });
      return handles;
    };
    clerk.step(true, p.y - 1, at);
    expect(clerk.nearby(at)).toBe(false);
    expect(overlaps()).toEqual([]);
    clerk.available = true;
    clerk.step(true, p.y - 1, p);
    expect(overlaps()).toEqual([]);
    clerk.step(true, p.y - 1, at);
    expect(clerk.nearby(at)).toBe(true);
    expect(overlaps()).toHaveLength(1);
    clerk.step(false, p.y - 1, at);
    expect(overlaps()).toEqual([]);
    clerk.step(true, p.y + 1, at);
    expect(clerk.nearby(at)).toBe(false);
    expect(overlaps()).toEqual([]);
  } finally {
    game.dispose();
  }
});
