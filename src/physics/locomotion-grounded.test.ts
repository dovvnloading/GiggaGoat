import { expect, it } from 'vitest';
import { GoatRagdoll, GOAT_SIZES } from './GoatRagdoll';
import { PhysicsWorld } from './PhysicsWorld';
import { dot, normalize, rotate, V } from './math';

it.each(GOAT_SIZES)('keeps normal walk, turn and stop planted with goat size %s', async size => {
  const world = await PhysicsWorld.create();
  world.createGround();
  const goat = new GoatRagdoll(world, { size });
  const steps = (count: number) => {
    let minimumUp = 1, ungrounded = 0;
    for (let i = 0; i < count; i++) {
      world.step(1 / 60);
      minimumUp = Math.min(minimumUp, rotate(goat.torso.rotation(), V(0, 1, 0)).y);
      if (!goat.locomotion.grounded) ungrounded++;
    }
    return { minimumUp, ungrounded };
  };
  try {
    steps(40);
    goat.locomotion.setInput({ z: 1 });
    const straight = steps(54);
    goat.locomotion.setInput({ x: 1, z: 0 });
    const turn = steps(24);
    const { x, z } = rotate(goat.torso.rotation(), V(0, 0, -1));
    const facingTurn = dot(normalize(V(x, 0, z)), V(1, 0, 0));
    goat.locomotion.setInput({ x: 0, z: -1 });
    const reverseCorner = steps(32);
    goat.locomotion.setInput({ z: 0 });
    const stopping = steps(24);
    const vel = goat.torso.linvel();
    for (const phase of [straight, turn, reverseCorner, stopping]) {
      expect(phase.minimumUp).toBeGreaterThan(.93);
      expect(phase.ungrounded).toBe(0);
    }
    expect(facingTurn).toBeGreaterThan(.87);
    expect(Math.hypot(vel.x, vel.z)).toBeLessThan(.12);
    expect(goat.isRagdoll).toBe(false);
  } finally {
    goat.dispose();
    world.dispose();
  }
});
