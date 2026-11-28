import { describe, expect, it } from 'vitest';
import { Game } from './Game';
import { V } from '../physics';

type Response = 'reverse' | 'release' | 'lateral turn' | 'airborne reversal';

async function measureResponse(action: Response, withReversalBraking: boolean, strength = 1) {
  const game = await Game.create();
  try {
    const { goat } = game;
    if (!withReversalBraking) goat.locomotion.tuning.reversalBrakeAcceleration = 0;
    // Reserve the flat test lane for the braking comparison. A goat reversing
    // into the waiting post van measures a bumper impact instead of locomotion.
    for (const vehicle of game.traffic.vehicles) vehicle.available = false;
    const centre = game.island.pois.find(poi => poi.id === 'hoofington')!.center;
    const x = centre.x - 1.8, z = centre.z - 13;
    const yaw = Math.PI;
    const forward = { moveZ: 1, cameraYaw: yaw, sprint: true };

    game.step();
    const floor = game.physics.raycast(V(x,20,z),V(0,-1,0),30, {
      predicate: collider => !goat.ownsBody(collider.parent()),
    });
    expect(floor?.normal.y).toBeGreaterThan(.995);
    expect(game.colliders.paths.some(path => path.handle === floor?.collider.handle)).toBe(true);
    game.teleport(V(x,floor!.point.y,z),-yaw);
    for (let tick = 0; tick < 40; tick++) game.step();
    for (let tick = 0; tick < 90; tick++) game.step(forward);

    if (action === 'airborne reversal') {
      game.step({ ...forward, jump: true });
      for (let tick = 0; tick < 5; tick++) game.step(forward);
    }

    const initialSpeed = goat.torso.linvel().z;
    const start = goat.torso.translation();
    const ticks = action === 'reverse' ? 60 : 18;
    const frames = [];
    for (let tick = 1; tick <= ticks; tick++) {
      game.step({
        moveX: action === 'lateral turn' ? 1 : 0,
        moveZ: action === 'reverse' || action === 'airborne reversal' ? -strength : 0,
        cameraYaw: yaw,
        sprint: action !== 'release',
      });
      const position = goat.torso.translation();
      const velocity = goat.torso.linvel();
      expect(goat.locomotion.grounded,
        `${action} tick ${tick} at z=${position.z.toFixed(3)}, vertical speed=${velocity.y.toFixed(3)}, ground=${goat.locomotion.groundHit?.distance.toFixed(3)}`)
        .toBe(action !== 'airborne reversal');
      frames.push({ tick, forwardTravel: position.z - start.z, vx: velocity.x, vz: velocity.z });
    }
    expect(game.respawns).toBe(0);
    return { initialSpeed, frames };
  } finally {
    game.dispose();
  }
}

describe('grounded sprint reversal', () => {
  it.each([1, .5])('reduces overshoot at input strength %s', async strength => {
    const legacy = await measureResponse('reverse', false, strength);
    const improved = await measureResponse('reverse', true, strength);
    expect(legacy.initialSpeed).toBeGreaterThan(6);
    expect(improved.initialSpeed).toBeCloseTo(legacy.initialSpeed,6);
    const overshoot = (result: typeof legacy) => Math.max(...result.frames.map(frame => frame.forwardTravel));
    const reverseTick = (result: typeof legacy) => result.frames.find(frame => frame.vz <= 0)!.tick;
    const speedTick = (result: typeof legacy) =>
      result.frames.find(frame => frame.vz <= -.9 * result.initialSpeed * strength)!.tick;
    expect(overshoot(improved)).toBeLessThan(overshoot(legacy) * .85);
    expect(reverseTick(improved)).toBeLessThan(reverseTick(legacy));
    expect(speedTick(improved)).toBeLessThan(speedTick(legacy));
    const finalVelocity = (result: typeof legacy) =>
      result.frames.slice(-10).reduce((sum,frame) => sum + frame.vz,0) / 10;
    expect(finalVelocity(improved)).toBeCloseTo(finalVelocity(legacy),1);
  });

  it.each(['release','lateral turn','airborne reversal'] as const)(
    'preserves the response for %s', async action => {
      const legacy = await measureResponse(action, false);
      const improved = await measureResponse(action, true);
      expect(improved).toEqual(legacy);
    },
  );
});
