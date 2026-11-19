import * as THREE from 'three';
import { expect, it } from 'vitest';
import { Game } from '../core/Game';
import { V } from '../physics';
import { createWorldScene, generateIsland } from './index';
import { damAccess } from './the-dam';

it('paints the lower Dam fork on the visible asphalt outside the upper ramp', () => {
  const island = generateIsland({ seed: 'billy-isle' });
  const view = createWorldScene(island);
  try {
    view.group.updateMatrixWorld(true);
    const guide = view.group.getObjectByName('dam-lower-road-guide') as THREE.Mesh;
    const pavement = view.group.getObjectByName('paths-road')!;
    const [ramp] = damAccess(island);
    const toe = ramp[0]!.outer;
    const paint = guide.geometry.getAttribute('position');
    expect(paint.count).toBeGreaterThanOrEqual(100);

    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    const triangle = new THREE.Triangle();
    const centre = new THREE.Vector3();
    for (let i = 0; i < paint.count; i += 3) {
      for (const [offset, point] of [triangle.a, triangle.b, triangle.c].entries()) {
        point.fromBufferAttribute(paint, i + offset).applyMatrix4(guide.matrixWorld);
        // At the ramp's western side, the guide stays south of its rails.
        if (point.x <= toe.x) expect(point.z).toBeLessThan(toe.z - .28);
      }
      triangle.getMidpoint(centre);
      ray.ray.origin.set(centre.x, centre.y + 2, centre.z);
      const road = ray.intersectObject(pavement)[0]!;
      expect(centre.y - road.point.y).toBeGreaterThan(.01);
      expect(centre.y - road.point.y).toBeLessThan(.04);
      expect(ray.intersectObject(guide)[0]!.point.y).toBeCloseTo(centre.y, 4);
    }
  } finally {
    view.dispose();
  }
});

it('follows the marked lower fork both ways with ordinary walking and continuous pavement support', async () => {
  const game = await Game.create();
  try {
    const board = game.gigs.boards.find(entry => entry.poiId === 'the-dam')!.position;
    const route = [
      [board.x, board.z],
      [-18.8, -207.3], [-19.4, -208.15], [-21, -208.72], [-24.8, -209.38],
      [-31.25, -211.25], [-40, -212.3],
    ] as const;
    game.step();
    for (const direction of [route, [...route].reverse()]) {
      const [x, z] = direction[0]!;
      const point = game.physics.raycast(V(x, 60, z), V(0, -1, 0), 90, {
        predicate: collider => !game.goat.ownsBody(collider.parent()),
      })!.point;
      game.teleport(point, 0);
      for (let tick = 0; tick < 35; tick++) game.step();
      const unsupported: string[] = [];

      for (const [targetX, targetZ] of direction.slice(1)) {
        let arrived = false;
        for (let tick = 0; tick < 400; tick++) {
          const p = game.goat.torso.translation();
          const dx = targetX - p.x, dz = targetZ - p.z;
          if (Math.hypot(dx, dz) < .50) {
            arrived = true;
            break;
          }
          game.step({ moveZ: 1, cameraYaw: Math.atan2(dx, -dz) });
          const locomotion = game.goat.locomotion;
          if (!locomotion.grounded || locomotion.groundHit?.collider.handle !== game.colliders.paths[0]!.handle) {
            unsupported.push(`${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
          }
        }
        expect(arrived, `Lower fork at (${targetX}, ${targetZ})`).toBe(true);
      }
      expect(unsupported).toEqual([]);
    }
    expect(game.respawns).toBe(0);
  } finally {
    game.dispose();
  }
});
