import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { PhysicsWorld, RAPIER, V } from '../physics';
import type { Game } from './Game';
import { IslandAtmosphere } from './IslandAtmosphere';

it('mixes shelter at the goat and hides rain at the camera only beneath a solid fixed roof', async () => {
  const physics = await PhysicsWorld.create();
  const atmosphere = new IslandAtmosphere({ island: { props: [] }, physics } as unknown as Game);
  try {
    const slab = () => RAPIER.ColliderDesc.cuboid(1.5, .15, 1.5);
    physics.raw.createCollider(slab().setTranslation(0, 4, 0));
    physics.createGround(V(1.5, .15, 1.5), V(6, 4, 0));
    physics.createBox(V(12, 4, 0), V(1.5, .15, 1.5));
    physics.raw.createCollider(slab().setSensor(true).setTranslation(18, 4, 0));
    physics.raw.createCollider(slab(), physics.raw.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(24, 4, 0)));
    physics.step(physics.fixedDt);
    const camera = new Vector3(40, 2, 0);
    const weather = { time: 0, phase: .5, rain: 1, wet: 1, mist: 0, cloud: 1 };
    const rain = atmosphere.group.getObjectByName('island-rain')!;
    function sample(x: number, y = 2) {
      weather.time++;
      atmosphere.update(weather, camera, V(x, y, 0), false);
      return atmosphere.playerUnderCover;
    }
    expect(sample(0)).toBe(true);
    expect(rain.visible).toBe(true);
    expect(sample(6)).toBe(true);
    camera.set(0, 2, 0);
    expect(sample(0, 4.5)).toBe(false); // A goat standing on the roof is exposed.
    expect(rain.visible).toBe(false);
    expect(sample(12)).toBe(false);
    expect(sample(18)).toBe(false);
    expect(sample(24)).toBe(false);
    weather.rain = 0;
    expect(sample(0)).toBe(true); // The eaves keep dripping after a shower.
    weather.wet = 0;
    expect(sample(0)).toBe(false);
  } finally {
    atmosphere.dispose();
    physics.dispose();
  }
});
