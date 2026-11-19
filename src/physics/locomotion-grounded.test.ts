import { expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { GoatRagdoll, GOAT_SIZES, type GoatSize } from './GoatRagdoll';
import { collisionGroups } from './CollisionGroups';
import { PhysicsWorld } from './PhysicsWorld';
import { dot, normalize, rotate, V } from './math';

it('continues the walk cycle across a shallow dip and tucks after an intentional jump', async () => {
  const world = await PhysicsWorld.create();
  world.createGround(V(20, .5, 20), V(0, -.64, 0));
  world.createGround(V(4, .3, 2), V(0, -.3, 2));
  const goat = new GoatRagdoll(world, { size: .6, position: V(0, 0, 2) });
  try {
    for (let tick = 0; tick < 40; tick++) world.step(1 / 60);
    const poses = new Set();
    goat.locomotion.setInput({ z: 1 });
    for (let tick = 0; tick < 65; tick++) {
      world.step(1 / 60);
      poses.add(goat.pose);
    }
    expect(goat.torso.translation().z).toBeLessThan(-1);
    expect([...poses]).toEqual(['walk']);

    goat.locomotion.requestJump();
    world.step(1 / 60);
    expect(goat.pose).toBe('jumpTuck');
  } finally {
    goat.dispose();
    world.dispose();
  }
});

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

const RAMP_RISE = 6.2;
const RAMP_RUN = 15;
const FIXED_DT = 1 / 60;

async function rampFixture(size: GoatSize, uphill = false, drop = 0) {
  const world = await PhysicsWorld.create({ solverIterations: 8 });
  const place = (desc: RAPIER.ColliderDesc) => world.raw.createCollider(desc
    .setFriction(.65).setRestitution(.17).setCollisionGroups(collisionGroups('prop')));
  const pitch = -Math.atan2(RAMP_RISE, RAMP_RUN);
  const halfThickness = .13;
  const halfLength = Math.hypot(RAMP_RUN, RAMP_RISE) / 2;
  const ramp = place(RAPIER.ColliderDesc.cuboid(1.7, halfThickness, halfLength)
    .setTranslation(0, RAMP_RISE / 2 - halfThickness * Math.cos(pitch), -halfThickness * Math.sin(pitch))
    .setRotation({ x: Math.sin(pitch / 2), y: 0, z: 0, w: Math.cos(pitch / 2) }));
  place(RAPIER.ColliderDesc.cuboid(3, .4, 4).setTranslation(0, RAMP_RISE - .4, 11.5));
  place(RAPIER.ColliderDesc.cuboid(3, .4, 8).setTranslation(0, -.4 - drop, -15.5));
  const goat = new GoatRagdoll(world, {
    size,
    position: uphill ? V(0, 0, -10.75) : V(0, RAMP_RISE, 10.75),
    yaw: uphill ? Math.PI : 0,
  });
  for (let tick = 0; tick < 50; tick++) world.step(FIXED_DT);
  return { world, goat, ramp };
}

const gaits = [
  { sprint: false, pose: 'walk' },
  { sprint: true, pose: 'gallop' },
] as const;

it.each(GOAT_SIZES.flatMap(size => gaits.map(gait => ({ size, ...gait }))))(
  'keeps size $size in $pose on the downhill run without false style airtime',
  async ({ size, sprint, pose }) => {
    const { world, goat, ramp } = await rampFixture(size);
    try {
      const landings: number[] = [];
      goat.events.on(event => { if (event.type === 'landed') landings.push(event.airtime); });
      goat.locomotion.setInput({ z: 1, sprint, canClimb: false });
      let samples = 0, stride = 0, supported = 0, speed = 0;
      for (let tick = 0; tick < 430 && goat.torso.translation().z > -12; tick++) {
        const z = goat.torso.translation().z;
        world.step(FIXED_DT);
        if (Math.abs(z) >= 6.5) continue;
        const ground = goat.locomotion.groundHit;
        expect(ground?.collider.handle).toBe(ramp.handle);
        expect(ground?.normal.y).toBeGreaterThan(.92);
        samples++;
        if (goat.pose === pose) stride++;
        if (goat.locomotion.grounded) supported++;
        speed += Math.abs(goat.torso.linvel().z);
      }
      expect(goat.torso.translation().z).toBeLessThan(-12);
      expect(samples).toBeGreaterThan(70);
      expect(stride / samples).toBeGreaterThan(.95);
      expect(supported / samples).toBeGreaterThan(.95);
      if (sprint) expect(speed / samples).toBeGreaterThan(goat.locomotion.tuning.walkSpeed);
      // A short crest transition can be real. A normal descent must stay well
      // below the game's .48-second threshold for an airtime style award.
      expect(Math.max(0, ...landings)).toBeLessThan(.30);
      expect(goat.isRagdoll).toBe(false);
    } finally {
      goat.dispose();
      world.dispose();
    }
  },
);

it.each(gaits)('accepts one intentional jump during a downhill $pose', async ({ sprint }) => {
  const { world, goat } = await rampFixture(.6);
  try {
    goat.locomotion.setInput({ z: 1, sprint, canClimb: false });
    for (let tick = 0; tick < 240 && goat.torso.translation().z > .4; tick++) world.step(FIXED_DT);
    expect(goat.torso.translation().z).toBeLessThanOrEqual(.4);
    expect(goat.locomotion.grounded).toBe(true);

    let starts = 0;
    goat.events.on(event => { if (event.type === 'airtimeStart') starts++; });
    goat.locomotion.requestJump();
    world.step(FIXED_DT);
    expect(starts).toBe(1);
    expect(goat.pose).toBe('jumpTuck');
    expect(goat.torso.linvel().y).toBeGreaterThan(2);
  } finally {
    goat.dispose();
    world.dispose();
  }
});

it('can still walk uphill on the same grade without climbing or jumping', async () => {
  const { world, goat } = await rampFixture(.6, true);
  try {
    goat.locomotion.setInput({ z: 1, cameraYaw: Math.PI, canClimb: false });
    for (let tick = 0; tick < 520 && goat.torso.translation().z < 10; tick++) world.step(FIXED_DT);
    expect(goat.torso.translation().z).toBeGreaterThan(10);
    expect(goat.torso.translation().y).toBeGreaterThan(RAMP_RISE);
    expect(goat.locomotion.grounded).toBe(true);
    expect(goat.isRagdoll).toBe(false);
  } finally {
    goat.dispose();
    world.dispose();
  }
});

it('still tucks and emits a real landing when walking off a descending ledge', async () => {
  const { world, goat } = await rampFixture(.6, false, 3.5);
  try {
    const landings: number[] = [];
    goat.events.on(event => { if (event.type === 'landed') landings.push(event.airtime); });
    goat.locomotion.setInput({ z: 1, canClimb: false });
    let clearAir = 0;
    for (let tick = 0; tick < 430 && goat.torso.translation().z > -13; tick++) {
      world.step(FIXED_DT);
      if (goat.torso.translation().z < -8 && !goat.locomotion.groundHit) {
        expect(goat.locomotion.grounded).toBe(false);
        expect(goat.pose).toBe('jumpTuck');
        clearAir++;
      }
    }
    expect(clearAir).toBeGreaterThan(15);
    expect(Math.max(0, ...landings)).toBeGreaterThan(.48);
  } finally {
    goat.dispose();
    world.dispose();
  }
});
