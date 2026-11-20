import { describe, expect, it } from 'vitest';
import { GoatRagdoll, GOAT_SIZES, type GoatSize } from './GoatRagdoll';
import { PhysicsWorld } from './PhysicsWorld';
import { V, type Vec3 } from './math';

async function scene(size: GoatSize, start: Vec3, run: (world: PhysicsWorld, goat: GoatRagdoll,
  step: (count: number) => void) => void) {
  const world = await PhysicsWorld.create();
  world.createGround(V(140, .5, 140), V(0, -.5, 0));
  const goat = new GoatRagdoll(world, { size, position: start });
  try {
    run(world, goat, count => { for (let i = 0; i < count; i++) world.step(1 / 60); });
  } finally {
    goat.dispose();
    world.dispose();
  }
}

describe('air and wall traversal', () => {
  it.each(GOAT_SIZES)('carries speed, banks into a turn, folds and lands at size %s', async size => {
    await scene(size, V(0, 16, 0), (_, goat, step) => {
      const motor = goat.locomotion;
      motor.setInput({ canGlide: true, canClimb: false });
      step(90);
      const cruise = goat.torso.translation();
      expect(motor.isGliding).toBe(true);
      expect(cruise.z).toBeLessThan(-6);
      expect(goat.torso.linvel().y).toBeGreaterThan(-2.6);
      expect(goat.torso.linvel().y).toBeLessThan(-1);
      motor.setInput({ x: 1 });
      step(25);
      expect(motor.glideBank).toBeGreaterThan(.12);
      step(75);
      expect(goat.torso.translation().x - cruise.x).toBeGreaterThan(6);
      expect(goat.torso.translation().y).toBeLessThan(cruise.y - 2);
      motor.setInput({ x: 0, canGlide: false });
      step(18);
      expect(motor.isGliding).toBe(false);
      expect(goat.torso.linvel().y).toBeLessThan(-3.2);
      motor.setInput({ canGlide: true });
      step(15);
      expect(motor.isGliding).toBe(true);
      step(600);
      expect(motor.grounded).toBe(true);
      expect(motor.isGliding).toBe(false);
    });
  });

  it.each([.6, 1, 1.6] as const)('holds, traverses, downclimbs and kicks free at size %s', async size => {
    await scene(size, V(0, 0, 2), (world, goat, step) => {
      world.createGround(V(10, 8, 1), V(0, 8, -2));
      const motor = goat.locomotion;
      step(35);
      motor.setInput({ z: 1 });
      step(125);
      expect(motor.isClinging).toBe(true);
      expect(goat.torso.translation().y).toBeGreaterThan(2);
      motor.setInput({ z: 0 });
      step(15);
      const hold = goat.torso.translation();
      step(45);
      expect(Math.abs(goat.torso.translation().y - hold.y)).toBeLessThan(.22 * size);
      motor.setInput({ x: 1 });
      step(45);
      const across = goat.torso.translation();
      expect(across.x - hold.x).toBeGreaterThan(.8 * size);
      expect(Math.abs(across.y - hold.y)).toBeLessThan(.30 * size);
      motor.setInput({ x: 0, z: -1 });
      step(28);
      expect(goat.torso.translation().y).toBeLessThan(across.y - .5 * size);
      expect(motor.isClinging).toBe(true);
      let takeoffs = 0;
      goat.events.on(event => { if (event.type === 'jumped') takeoffs++; });
      motor.kickOffWall();
      motor.setInput({ z: 1 });
      step(12);
      expect(motor.isClinging).toBe(false);
      expect(takeoffs).toBe(1);
      expect(goat.torso.translation().z - across.z).toBeGreaterThan(.45 * size);
      expect(goat.torso.linvel().y).toBeGreaterThan(1);
    });
  });

  it.each([.6, 1, 1.6] as const)('climbs onto a supported roof and continues walking at size %s', async size => {
    await scene(size, V(0, 0, 2), (world, goat, step) => {
      world.createGround(V(5, 1.8, 10), V(0, 1.8, -11));
      step(35);
      goat.locomotion.setInput({ z: 1 });
      let climbed = false;
      for (let i = 0; i < 240; i++) {
        step(1);
        climbed ||= goat.locomotion.isClinging;
        if (goat.torso.translation().z < -3 && goat.locomotion.grounded) break;
      }
      expect(climbed).toBe(true);
      expect(goat.torso.translation().z).toBeLessThan(-3);
      expect(goat.torso.translation().y).toBeGreaterThan(3.6);
      expect(goat.locomotion.grounded).toBe(true);
    });
  });
});
