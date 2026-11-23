import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { generateIsland } from './island';
import { roadRibbonData, SUMMIT_JOIN_SEGMENTS } from './road-ribbons';
import { buildRapierColliders } from './colliders';
import { createWorldScene } from './render';
import { GoatRagdoll } from '../physics/GoatRagdoll';
import { PhysicsWorld } from '../physics/PhysicsWorld';

describe('Mt. Gigga summit junction', () => {
  it.each([
    425, 450, 500, 537, 700, 713, 800, 827, 1000, 1013, 1100, 1177,
  ])('builds the junction at %i m without geometry errors', size => {
    const island = generateIsland({ seed: `summit-${size}`, size, resolution: 65 });
    expect(roadRibbonData(island, 'trail').supportIndices.length).toBeGreaterThan(0);
  });

  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'summit-small', size: 400, resolution: 97 },
    { seed: 'summit-large', size: 900, resolution: 97 },
    { seed: 'pines-alt', size: 900, resolution: 65 },
    { seed: 'wp4-low', size: 400, resolution: 65 },
    { seed: 'wp4-cliff', size: 1200, resolution: 65 },
    { seed: 'art-deck-A', size: 850, resolution: 97 },
  ])('has a single physical trail surface through the junction at $size m', options => {
    const island = generateIsland(options);
    const summit = island.pois.find(p => p.id === 'mt-gigga')!.center;
    const surface = roadRibbonData(island, 'trail');
    const triangles: number[][] = [];
    for (let i = 0; i < surface.supportIndices.length; i += 3) {
      const t = surface.supportIndices.slice(i, i + 3).flatMap(index => surface.positions.slice(index * 3, index * 3 + 3));
      if (Math.min(...[t[0]!, t[3]!, t[6]!]) > summit.x + 12 ||
          Math.max(...[t[0]!, t[3]!, t[6]!]) < summit.x - 12 ||
          Math.min(...[t[2]!, t[5]!, t[8]!]) > summit.z + 12 ||
          Math.max(...[t[2]!, t[5]!, t[8]!]) < summit.z - 12) continue;
      // At large island sizes, a separate lower switchback can cross the
      // junction in plan view without touching the summit surface.
      const verticalRange = 3 * options.size / 600;
      if (Math.max(t[1]!, t[4]!, t[7]!) < summit.y - verticalRange ||
          Math.min(t[1]!, t[4]!, t[7]!) > summit.y + verticalRange) continue;
      triangles.push(t);
    }
    const hits = (x: number, z: number) => triangles.filter(t => {
      const ax = t[0]! - t[6]!, az = t[2]! - t[8]!;
      const bx = t[3]! - t[6]!, bz = t[5]! - t[8]!;
      const dx = x - t[6]!, dz = z - t[8]!;
      const area = ax * bz - bx * az;
      if (Math.abs(area) < 1e-8) return false;
      const u = (dx * bz - bx * dz) / area, v = (ax * dz - dx * az) / area;
      return Math.min(u, v, 1 - u - v) > 1e-6;
    }).length;
    let covered = 0;
    for (let x = -9.97; x < 10; x += .23) for (let z = -9.91; z < 10; z += .23) {
      const count = hits(summit.x + x, summit.z + z);
      expect(count, `overlap at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBeLessThanOrEqual(1);
      if (count) covered++;
    }
    expect(covered).toBeGreaterThan(100);
    for (const road of island.roads.filter(r => r.type === 'trail' &&
      (r.from === 'mt-gigga' || r.to === 'mt-gigga'))) {
      const points = road.from === 'mt-gigga' ? road.points : [...road.points].reverse();
      const a = points[0]!, b = points[1]!;
      expect(hits(a.x * .35 + b.x * .65, a.z * .35 + b.z * .65), road.id).toBe(1);
    }
  });

  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'wp4-cliff', size: 1200, resolution: 65 },
    { seed: 0, size: 2000, resolution: 65 },
  ])('matches rendered and physical trail heights on all three summit approaches at $size m', async options => {
    await RAPIER.init();
    const island = generateIsland(options);
    const summit = island.pois.find(p => p.id === 'mt-gigga')!.center;
    const scene = createWorldScene(island);
    const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      scene.group.updateMatrixWorld(true);
      const mesh = scene.group.getObjectByName('paths-trail')!;
      const { paths } = buildRapierColliders(physics, island);
      const down = new THREE.Vector3(0, -1, 0);
      const approaches = island.roads.filter(r => r.type === 'trail' &&
        (r.from === 'mt-gigga' || r.to === 'mt-gigga'));
      expect(approaches).toHaveLength(3);
      let worstGrade = 0;
      for (const road of approaches) {
        const points = road.from === 'mt-gigga' ? road.points : [...road.points].reverse();
        for (let i = 0; i < SUMMIT_JOIN_SEGMENTS + 2; i++) for (const t of [.25, .65]) {
          const a = points[i]!, b = points[i + 1]!;
          const x = THREE.MathUtils.lerp(a.x, b.x, t), z = THREE.MathUtils.lerp(a.z, b.z, t);
          const origin = new THREE.Vector3(x, summit.y + 40, z);
          const rendered = new THREE.Raycaster(origin, down).intersectObject(mesh)[0];
          expect(rendered, `${road.id}/${i}/${t}`).toBeDefined();
          const ray = new RAPIER.Ray(origin, down);
          const physical = paths[1]!.castRay(ray, 80, false);
          expect(physical, `${road.id}/${i}/${t}`).toBeCloseTo(rendered!.distance, 3);
          const graded = THREE.MathUtils.lerp(a.y, b.y, t) + .19;
          const error = Math.abs(rendered!.point.y - graded);
          worstGrade = Math.max(worstGrade, error);
        }
      }
      expect(worstGrade).toBeLessThan(.4 * Math.max(1, options.size / 600));
    } finally { scene.dispose(); physics.free(); }
  }, 60_000);

  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'wp4-cliff', size: 1200, resolution: 65 },
    { seed: 0, size: 2000, resolution: 65 },
  ])('walks a real goat from the summit along each of the three exits at $size m', async options => {
    const island = generateIsland(options);
    const approaches = island.roads.filter(r => r.type === 'trail' &&
      (r.from === 'mt-gigga' || r.to === 'mt-gigga'));
    for (const road of approaches) {
      const points = road.from === 'mt-gigga' ? road.points : [...road.points].reverse();
      const world = await PhysicsWorld.create();
      buildRapierColliders(world.raw, island);
      const summit = points[0]!;
      const goat = new GoatRagdoll(world, { size: .6,
        position: { x: summit.x, y: summit.y + .25, z: summit.z } });
      try {
        for (let i = 0; i < 70; i++) world.step(1 / 60);
        for (const index of [1, 4, 7, SUMMIT_JOIN_SEGMENTS + 2]) {
          const target = points[index]!;
          let distance = Infinity;
          for (let tick = 0; tick < 240; tick++) {
            const pos = goat.torso.translation(), dx = target.x - pos.x, dz = target.z - pos.z;
            distance = Math.hypot(dx, dz);
            if (distance < .8) break;
            goat.locomotion.setInput({ x: dx / distance, z: -dz / distance, cameraYaw: 0,
              canClimb: false, canSprint: false });
            world.step(1 / 60);
          }
          expect(distance, `${road.id} point ${index}`).toBeLessThan(.8);
          expect(goat.isRagdoll, `${road.id} point ${index}`).toBe(false);
        }
      } finally { goat.dispose(); world.dispose(); }
    }
  }, 60_000);
});
