import { describe, expect, it } from 'vitest';
import { TUNING } from '../gameplay/config';
import { GoatRagdoll, GOAT_SIZES } from './GoatRagdoll';
import { PhysicsWorld } from './PhysicsWorld';
import { V } from './math';

describe('size-specific locomotion speed', () => {
  it.each([false, true])('makes smaller goats faster on level ground (sprint=%s)', async sprint => {
    const speeds: number[] = [];
    for (const size of GOAT_SIZES) {
      const world = await PhysicsWorld.create();
      world.createGround(V(500, .5, 500));
      const goat = new GoatRagdoll(world, { size, position: V(0, 0, 0) });
      try {
        for (let tick = 0; tick < 80; tick++) world.step(1 / 60);
        goat.locomotion.setInput({ z: 1, sprint, canClimb: false });
        let speed = 0;
        for (let tick = 0; tick < 180; tick++) {
          world.step(1 / 60);
          if (tick >= 120) speed += -goat.torso.linvel().z / 60;
        }
        expect(goat.isRagdoll).toBe(false);
        const configured = Object.values(TUNING.size).find(tier => tier.scale === size)!;
        const target = (sprint ? goat.locomotion.tuning.sprintSpeed : goat.locomotion.tuning.walkSpeed) * configured.speed;
        // The steady physical velocity can be slightly lower due to Rapier damping.
        expect(speed).toBeGreaterThan(target * .95);
        expect(speed).toBeLessThan(target * 1.05);
        speeds.push(speed);
      } finally { goat.dispose(); world.dispose(); }
    }
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i - 1], JSON.stringify(speeds)).toBeGreaterThan(speeds[i]!);
    }
  }, 30_000);
});
