import { expect, it } from 'vitest';
import { GoatRagdoll } from './GoatRagdoll';
import { PhysicsWorld } from './PhysicsWorld';
import { groundMotorTarget } from './ground-motor-contact';
import { V } from './math';

it.each([true, false])('slides along fixed contact planes in either collider order (wall first = %s)', async wallFirst => {
  const world = await PhysicsWorld.create({ gravity: V() });
  const wall = () => world.createGround(V(3, 3, .05), V(0, 1, -1.11));
  if (wallFirst) wall();
  const goat = new GoatRagdoll(world);
  if (!wallFirst) wall();
  try {
    world.step(world.fixedDt);
    const slide = groundMotorTarget(goat, V(2, 0, -3));
    expect(slide.x).toBeCloseTo(2);
    expect(slide.z).toBeCloseTo(0);
    expect(groundMotorTarget(goat, V(2, 0, 3))).toEqual(V(2, 0, 3));

    // Only the outer shoulder fixture reaches the second wall.
    world.createGround(V(.05, 3, 3), V(.545, 1, 0));
    world.step(world.fixedDt);
    const corner = groundMotorTarget(goat, V(2, 0, -3));
    expect(Math.hypot(corner.x, corner.z)).toBeLessThan(.001);
  } finally {
    goat.dispose();
    world.dispose();
  }
});

it('brakes for a raised rail beside the shoulder before the trunk reaches it', async () => {
  const world = await PhysicsWorld.create({ gravity: V() });
  const goat = new GoatRagdoll(world);
  try {
    const rail = world.createGround(V(.03, .05, .15), V(.86, 1.32, -.09));
    world.step(world.fixedDt);
    const contact = goat.locomotion.findSafetyRail(V(1, 0, 0), new Set([rail.collider(0).handle]));
    expect(contact?.distance).toBeCloseTo(.33, 2);
    expect(contact?.normal.x).toBeCloseTo(-1);
  } finally {
    goat.dispose();
    world.dispose();
  }
});

it('retains the drive into a movable obstacle', async () => {
  const world = await PhysicsWorld.create({ gravity: V() });
  const goat = new GoatRagdoll(world);
  try {
    world.createBox(V(0, 1, -1.11), V(3, 3, .05));
    world.step(world.fixedDt);
    expect(groundMotorTarget(goat, V(0, 0, -3))).toEqual(V(0, 0, -3));
  } finally {
    goat.dispose();
    world.dispose();
  }
});

it('lets the player steer along a thin wall under sustained diagonal input', async () => {
  const world = await PhysicsWorld.create();
  world.createGround();
  world.createGround(V(30, 3, .025), V(0, 3, -2));
  const goat = new GoatRagdoll(world);
  try {
    for (let i = 0; i < 45; i++) world.step(world.fixedDt);
    goat.locomotion.setInput({ x: .65, z: 1, canClimb: false });
    for (let i = 0; i < 180; i++) {
      world.step(world.fixedDt);
      for (const part of goat.bodies) expect(part.translation().z).toBeGreaterThan(-1.98);
    }
    expect(goat.torso.translation().x).toBeGreaterThan(3);
    expect(goat.isRagdoll).toBe(false);
  } finally {
    goat.dispose();
    world.dispose();
  }
});

it('keeps a knocked-back ragdoll on the approach side of a thin corner', async () => {
  const world = await PhysicsWorld.create({ gravity: V() });
  world.createGround(V(.015, 8, 12), V(0, 0, 0));
  world.createGround(V(12, 8, .015), V(0, 0, 0));
  const goat = new GoatRagdoll(world, { size: .6, position: V(-2, 1, 2) });
  try {
    goat.flop();
    for (const part of goat.bodies) part.setLinvel(V(90, 0, -90), true);
    // Each fixed step covers 1.5 m per axis, fifty times the wall thickness.
    for (let i = 0; i < 12; i++) {
      world.step(world.fixedDt);
      for (const part of goat.bodies) {
        expect(part.translation().x).toBeLessThan(0);
        expect(part.translation().z).toBeGreaterThan(0);
      }
    }
  } finally {
    goat.dispose();
    world.dispose();
  }
});
