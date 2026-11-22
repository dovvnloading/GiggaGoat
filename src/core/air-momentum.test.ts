import { describe, expect, it } from 'vitest';
import { GoatRagdoll, PhysicsWorld, V } from '../physics';
import { Game } from './Game';

type AirInput = 'forward' | 'release' | 'reverse' | 'sideways';

async function sprintJump(input: AirInput, airControl: boolean) {
  const game = await Game.create({ seed: 'billy-isle', resolution: 97 });
  try {
    const goat = game.goat;
    if (!airControl) goat.locomotion.tuning.airAcceleration = 0;
    const spawn = goat.torso.translation();
    const floor = spawn.y + 25;
    game.physics.createGround(V(100, .5, 100), V(spawn.x, floor - .5, spawn.z));
    game.teleport(V(spawn.x, floor, spawn.z + 30), 0);
    for (let tick = 0; tick < 90; tick++) game.step();
    for (let tick = 0; tick < 90; tick++) game.step({ moveZ: 1, cameraYaw: 0, sprint: true });
    const takeoff = goat.torso.linvel();
    expect(-takeoff.z).toBeGreaterThan(5.5);
    game.step({ moveZ: 1, cameraYaw: 0, sprint: true, jump: true });
    expect(goat.locomotion.grounded).toBe(false);
    const start = { ...goat.torso.translation() };
    for (let tick = 0; tick < 20; tick++) {
      game.step({ cameraYaw: 0, sprint: true,
        moveZ: input === 'forward' ? 1 : input === 'reverse' ? -1 : 0,
        moveX: input === 'sideways' ? 1 : 0 });
      expect(goat.locomotion.grounded).toBe(false);
    }
    return { takeoff, velocity: { ...goat.torso.linvel() }, position: { ...goat.torso.translation() }, start };
  } finally { game.dispose(); }
}

describe('sprint-jump air control', () => {
  it.each(['forward', 'release'] as const)(
    'preserves takeoff momentum with %s input apart from passive damping', async input => {
      const passive = await sprintJump(input, false);
      const controlled = await sprintJump(input, true);
      expect(controlled.velocity.z).toBeCloseTo(passive.velocity.z, 2);
      expect(controlled.position.z - controlled.start.z).toBeCloseTo(passive.position.z - passive.start.z, 2);
    }, 30_000);

  it('allows intentional reverse and lateral steering without an air-speed boost', async () => {
    const passive = await sprintJump('release', false);
    const reverse = await sprintJump('reverse', true);
    const sideways = await sprintJump('sideways', true);
    expect(reverse.velocity.z).toBeGreaterThan(passive.velocity.z + .5);
    expect(sideways.velocity.x).toBeGreaterThan(.3);
    expect(Math.hypot(sideways.velocity.x, sideways.velocity.z))
      .toBeLessThan(Math.hypot(passive.velocity.x, passive.velocity.z) + .35);
  }, 30_000);

  it('steers in a sustained airborne turn without accelerating past takeoff speed', async () => {
    const world = await PhysicsWorld.create();
    const goat = new GoatRagdoll(world, { size: 1, position: V(0, 60, 0) });
    try {
      for (const body of goat.bodies) body.setLinvel(V(0, 0, -7), true);
      let maxSpeed = 0;
      for (let tick = 0; tick < 90; tick++) {
        goat.locomotion.setInput({ z: 1, cameraYaw: tick * .02, canClimb: false });
        world.step(1 / 60);
        const v = goat.torso.linvel();
        maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.z));
      }
      expect(maxSpeed).toBeLessThan(7.5);
      expect(goat.torso.linvel().x).toBeGreaterThan(.5);
    } finally { goat.dispose(); world.dispose(); }
  });
});
