import { expect, it } from 'vitest';
import { Game } from './Game';
import { LANTERN_HEIGHT } from '../world/lantern';

it('keeps streetlights on their footings until the player breaks one in free roam', async () => {
  const game = await Game.create();
  try {
    const lamps = game.island.props.filter(prop => prop.kind === 'lamp' && prop.breakable);
    const downtown = lamps.filter(prop => prop.poiId === 'downtown-bleatsville');
    expect(downtown).toHaveLength(12);
    for (let i = 0; i < 360; i++) game.step();
    for (const lamp of lamps) {
      expect(game.destroyedProps.has(lamp.id), lamp.id).toBe(false);
      const body = game.colliders.bodies.get(lamp.id)!;
      const position = body.translation(), authored = lamp.transform.position;
      const base = authored.y - lamp.size.y / 2;
      expect(Math.hypot(position.x - authored.x, position.y - (base + LANTERN_HEIGHT / 2),
        position.z - authored.z)).toBeLessThan(.001);
      expect(Math.abs(body.rotation().x) + Math.abs(body.rotation().z)).toBeLessThan(.001);
      const above = game.physics.raycast({ x: authored.x, y: base + LANTERN_HEIGHT + .5, z: authored.z },
        { x: 0, y: -1, z: 0 }, 1, { predicate: c => c.parent()?.handle === body.handle });
      expect(above?.distance).toBeCloseTo(.5, 3);
    }

    const target = downtown[0]!;
    const targetHandle = game.colliders.bodies.get(target.id)!.handle;
    let fragments: number[] = [];
    game.breakables.events.on(event => {
      if (event.bodyHandle === targetHandle) fragments = event.debrisHandles;
    });
    const { x, y, z } = target.transform.position;
    for (let strike = 0; strike < 5 && !game.destroyedProps.has(target.id); strike++) {
      game.teleport({ x, y: y - target.size.y / 2, z: z + 1.65 }, 0);
      for (let i = 0; i < 48; i++) game.step();
      expect(game.destroyedProps.has(target.id)).toBe(false);
      for (let i = 0; i < 65; i++) game.step({ chargeHeadbutt: true });
      game.step({ chargeHeadbutt: false });
      for (let i = 0; i < 15; i++) game.step();
    }
    expect(game.destroyedProps.has(target.id)).toBe(true);
    expect(game.colliders.props.has(target.id)).toBe(false);
    expect(fragments).toHaveLength(6);
    for (const [index, handle] of fragments.entries()) {
      expect(game.physics.bodyData(handle)).toMatchObject({ kind: 'debris', data: 'post-section' });
      expect(game.breakables.postSection(handle)).toEqual({ index, count: 6 });
      const collider = game.physics.raw.getRigidBody(handle)!.collider(0);
      expect(collider.halfHeight() * 2).toBeCloseTo(.94 * LANTERN_HEIGHT / fragments.length);
      expect(collider.radius() * 2).toBeCloseTo(.94 * target.size.x);
    }
  } finally { game.dispose(); }
});
