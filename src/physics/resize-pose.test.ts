import { describe, expect, it } from 'vitest';
import { GoatRagdoll, type GoatPart } from './GoatRagdoll';
import { PhysicsWorld } from './PhysicsWorld';
import { distance, dot, mul, sub, V } from './math';

const parts: GoatPart[] = ['torso', 'neck', 'head', 'frontLeft', 'frontRight', 'backLeft', 'backRight'];

describe('goat resize during traversal', () => {
  it('settles safely when resized before its first ground query', async () => {
    const world = await PhysicsWorld.create();
    world.createGround();
    const goat = new GoatRagdoll(world, { size: .6, position: V(0, 0, 0) });
    try {
      goat.resize(1);
      expect(goat.torso.translation().y).toBeCloseTo(.92, 4);
      for (let tick = 0; tick < 120; tick++) world.step(1 / 60);
      expect(goat.locomotion.grounded).toBe(true);
      expect(goat.isRagdoll).toBe(false);
      expect(goat.torso.translation().y).toBeGreaterThan(.6);
    } finally { goat.dispose(); world.dispose(); }
  });

  it.each([{ from: .6, to: 1 }, { from: 1.6, to: .6 }, { from: .6, to: 3 }, { from: 3, to: .6 }] as const)(
    'preserves every body pose and velocity through a real airborne flip ($from to $to)', async ({ from, to }) => {
    const world = await PhysicsWorld.create();
    world.createGround();
    const goat = new GoatRagdoll(world, { size: from, position: V(0, 20, 0) });
    try {
      for (let tick = 0; tick < 5; tick++) world.step(1 / 60);
      let flips = 0;
      goat.events.on(event => { if (event.type === 'flipped') flips++; });
      goat.locomotion.requestFlip();
      for (let tick = 0; tick < 12; tick++) world.step(1 / 60);
      expect(goat.locomotion.isFlipping).toBe(true);
      const torso = { p: { ...goat.torso.translation() }, v: { ...goat.torso.linvel() } };
      const before = parts.map(part => {
        const body = goat.getPart(part);
        return { part, p: { ...body.translation() }, q: { ...body.rotation() },
          v: { ...body.linvel() }, w: { ...body.angvel() } };
      });
      goat.resize(to);
      expect(distance(goat.torso.translation(), torso.p)).toBeLessThan(.001);
      for (const old of before) {
        const body = goat.getPart(old.part), q = body.rotation();
        const quaternionAgreement = Math.abs(q.x * old.q.x + q.y * old.q.y + q.z * old.q.z + q.w * old.q.w);
        expect(quaternionAgreement, old.part).toBeCloseTo(1, 5);
        expect(distance(sub(body.translation(), goat.torso.translation()), mul(sub(old.p, torso.p), to / from)), old.part)
          .toBeLessThan(.001);
        expect(distance(body.angvel(), old.w), old.part).toBeLessThan(.001);
        expect(distance(body.linvel(), { x: torso.v.x + (old.v.x - torso.v.x) * to / from,
          y: torso.v.y + (old.v.y - torso.v.y) * to / from, z: torso.v.z + (old.v.z - torso.v.z) * to / from }), old.part)
          .toBeLessThan(.001);
        const interpolation = world.getInterpolatedTransform(body, 0);
        expect(distance(interpolation.translation, body.translation()), old.part).toBeLessThan(.001);
        expect(Math.abs(interpolation.rotation.x * q.x + interpolation.rotation.y * q.y +
          interpolation.rotation.z * q.z + interpolation.rotation.w * q.w), old.part).toBeCloseTo(1, 5);
      }
      for (let tick = 0; tick < 100 && flips === 0; tick++) world.step(1 / 60);
      expect(flips).toBe(1);
    } finally { goat.dispose(); world.dispose(); }
  });

  it('keeps a tumbling goat in the same physical pose', async () => {
    const world = await PhysicsWorld.create();
    world.createGround();
    const goat = new GoatRagdoll(world, { size: .6, position: V(0, 10, 0) });
    try {
      goat.flop();
      for (const body of goat.bodies) body.setAngvel(V(1.2, -.3, 2), true);
      for (let tick = 0; tick < 20; tick++) world.step(1 / 60);
      const before = { ...goat.torso.rotation() }, angular = { ...goat.torso.angvel() };
      goat.resize(1);
      const after = goat.torso.rotation();
      expect(goat.isRagdoll).toBe(true);
      expect(Math.abs(before.x * after.x + before.y * after.y + before.z * after.z + before.w * after.w))
        .toBeCloseTo(1, 5);
      expect(distance(goat.torso.angvel(), angular)).toBeLessThan(.001);
    } finally { goat.dispose(); world.dispose(); }
  });

  it('maintains a climbable clearance and continues upward after growth on a wall', async () => {
    const world = await PhysicsWorld.create();
    world.createGround();
    world.createGround(V(10, 8, 1), V(0, 8, -2));
    const goat = new GoatRagdoll(world, { size: .6, position: V(0, 0, 2) });
    try {
      for (let tick = 0; tick < 35; tick++) world.step(1 / 60);
      goat.locomotion.setInput({ z: 1 });
      for (let tick = 0; tick < 150 && !goat.locomotion.isClinging; tick++) world.step(1 / 60);
      expect(goat.locomotion.isClinging).toBe(true);
      for (let tick = 0; tick < 30; tick++) world.step(1 / 60);
      const wall = goat.locomotion.climbSurface!;
      const clearance = dot(sub(goat.torso.translation(), wall.point), wall.normal);
      const y = goat.torso.translation().y;
      goat.resize(1);
      expect(dot(sub(goat.torso.translation(), wall.point), wall.normal)).toBeGreaterThan(clearance);
      for (let tick = 0; tick < 60; tick++) world.step(1 / 60);
      expect(goat.locomotion.isClinging).toBe(true);
      expect(goat.torso.translation().y).toBeGreaterThan(y + .5);
      expect(goat.isRagdoll).toBe(false);
    } finally { goat.dispose(); world.dispose(); }
  });
});
