import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';

describe('toolchain smoke test', () => {
  it('initialises Rapier headlessly and drops a ball onto the ground', async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.1, 10));
    const ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0));
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), ball);
    for (let i = 0; i < 240; i++) world.step();
    expect(ball.translation().y).toBeGreaterThan(0.5);
    expect(ball.translation().y).toBeLessThan(0.7);
  });
});
