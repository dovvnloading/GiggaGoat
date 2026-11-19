import * as THREE from 'three';
import { expect, it } from 'vitest';
import { Game } from '../core/Game';
import { RAPIER, V, forward } from '../physics';
import { buildRapierColliders, createWorldScene, generateIsland } from './index';
import { SUMMIT_ASCENT_TRAIL } from './road-ribbons';

const bankApproach = [
  { x: -32.570183, y: 59.775763, z: 51.254276, yaw: .69885126 },
  { x: -.813832, y: 103.046980, z: 7.339665, yaw: -2.07157776 },
] as const;

it('matches the two exposed Summit bank faces and leaves shallow and bridge-adjacent skirts open', async () => {
  await RAPIER.init();
  const island = generateIsland();
  const scene = createWorldScene(island);
  const world = new RAPIER.World(V(0, -9.81, 0));
  try {
    const { paths } = buildRapierColliders(world, island);
    const walls = paths[2]!;
    const trail = scene.group.getObjectByName('paths-trail')!;
    world.step();

    const cases = [
      ...bankApproach.map(origin => ({ origin, solid: true })),
      // Low lip near Summit and the adjoining slope of a marked bridge opening.
      { origin: { x: -6.364581, y: 103.472122, z: 6.259152, yaw: 1.43528112 }, solid: false },
      { origin: { x: -40.545309, y: 28.517239, z: -85.232532, yaw: 2.78335420 }, solid: false },
    ];
    for (const { origin, solid } of cases) {
      const source = new THREE.Vector3().copy(origin);
      const direction = new THREE.Vector3().copy(forward(origin.yaw));
      const drawn = new THREE.Raycaster(source, direction, 0, 1.25).intersectObject(trail)[0];
      const ray = new RAPIER.Ray(source, direction);
      expect(drawn?.distance).toBeCloseTo(.60, 3);
      if (solid) {
        const hit = world.castRay(ray, 1.25, false);
        expect(hit?.collider.handle).toBe(walls.handle);
        expect(hit?.timeOfImpact).toBeCloseTo(drawn!.distance, 4);
      } else {
        expect(walls.castRay(ray, 1.25, false)).toBeLessThan(0);
      }
    }

    const entrance = V(.73842, 102.62, 3.48286);
    const inward = new THREE.Vector3(.121 - entrance.x, 0, 2.326 - entrance.z).normalize();
    expect(walls.castRay(new RAPIER.Ray(entrance, inward), 1.25, false)).toBeLessThan(0);

    // The east shoulder and its collision are the same gentle surface.
    const down = new THREE.Vector3(0, -1, 0);
    for (const [x, z] of [[.36, 4.43], [.37, 3.60], [.31, 2.94]] as const) {
      const origin = new THREE.Vector3(x, 108, z);
      const drawn = new THREE.Raycaster(origin, down, 0, 10).intersectObject(trail)[0];
      const hit = paths[1]!.castRayAndGetNormal(new RAPIER.Ray(origin, down), 10, false);
      expect(drawn).toBeDefined();
      expect(hit?.timeOfImpact).toBeCloseTo(drawn!.distance, 4);
      expect(hit?.normal.y).toBeGreaterThan(.88);
      expect(hit?.normal.y).toBeLessThan(.96);
    }
  } finally {
    scene.dispose();
    world.free();
  }
});

it('sprints all the way across the summit entrance without tumbling or grabbing a wall', async () => {
  const game = await Game.create();
  try {
    const start = V(.3575, 108, 6.725), goal = V(.121, 0, 2.326);
    const down = new RAPIER.Ray(start, V(0, -1, 0));
    const floor = Math.min(...[game.colliders.terrain, game.colliders.paths[1]!]
      .map(shape => shape.castRay(down, 10, false)).filter(distance => distance >= 0));
    expect(Number.isFinite(floor)).toBe(true);
    const yaw = Math.atan2(goal.x - start.x, start.z - goal.z);
    game.teleport(V(start.x, start.y - floor, start.z), -yaw);
    for (let i = 0; i < 40; i++) game.step({ cameraYaw: yaw });

    let reached = false;
    for (let i = 0; i < 105; i++) {
      const p = game.goat.torso.translation();
      const dx = goal.x - p.x, dz = goal.z - p.z;
      if (Math.hypot(dx, dz) < .65) {
        reached = true;
        break;
      }
      game.step({ moveZ: 1, sprint: true, cameraYaw: Math.atan2(dx, -dz) });
      expect(game.goat.isRagdoll).toBe(false);
      expect(game.goat.locomotion.isClinging).toBe(false);
    }
    expect(reached).toBe(true);
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});

it('meets the earth bank with the native goat and crosses it only above the crest', async () => {
  const game = await Game.create();
  try {
    const x = -.462949, z = 7.147621, yaw = bankApproach[1].yaw;
    const down = new RAPIER.Ray(V(x, 140, z), V(0, -1, 0));
    const ground = 140 - game.colliders.terrain.castRay(down, 140, false);
    game.teleport(V(x, ground, z), -yaw);
    for (let tick = 0; tick < 40; tick++) game.step({ cameraYaw: yaw });

    const direction = forward(yaw);
    let beneath = 0, above = 0, clung = false;
    for (let tick = 0; tick < 56; tick++) {
      game.step({ moveZ: 1, cameraYaw: yaw });
      const head = game.goat.head.translation();
      const advance = (head.x - x) * direction.x + (head.z - z) * direction.z;
      if (head.y < 103.55) beneath = Math.max(beneath, advance);
      if (head.y > 103.68) above = Math.max(above, advance);
      clung ||= game.goat.locomotion.isClinging;
    }
    // The outer face is one metre from the start. Ordinary walking can
    // engage the climb, but cannot enter the bank before clearing its top.
    expect(beneath).toBeGreaterThan(.55);
    expect(beneath).toBeLessThan(.88);
    expect(clung).toBe(true);
    expect(above).toBeGreaterThan(.97);
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});

it('keeps the original trail crest grounded for ordinary walking in both directions', async () => {
  const game = await Game.create();
  try {
    const road = game.island.roads.find(road => road.id === SUMMIT_ASCENT_TRAIL)!;
    const route = [110, 112, 114, 116, 118].map(i => road.points[i]!);
    for (const way of [route, [...route].reverse()]) {
      const start = way[0]!, next = way[1]!;
      const yaw = Math.atan2(next.x - start.x, start.z - next.z);
      const down = new RAPIER.Ray(V(start.x, 140, start.z), V(0, -1, 0));
      const trail = game.colliders.paths[1]!;
      const ground = 140 - trail.castRay(down, 140, false);
      game.teleport(V(start.x, ground, start.z), -yaw);
      for (let i = 0; i < 40; i++) game.step({ cameraYaw: yaw });

      let unsupported = 0;
      for (const goal of way.slice(1)) {
        let reached = false;
        for (let step = 0; step < 200; step++) {
          const current = game.goat.torso.translation();
          const dx = goal.x - current.x, dz = goal.z - current.z;
          if (Math.hypot(dx, dz) < .55) {
            reached = true;
            break;
          }
          game.step({ moveZ: 1, cameraYaw: Math.atan2(dx, -dz) });
          if (!game.goat.locomotion.grounded) unsupported++;
        }
        expect(reached).toBe(true);
      }
      expect(unsupported).toBe(0);
    }
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});
