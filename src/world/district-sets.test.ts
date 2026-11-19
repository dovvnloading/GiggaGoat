import { expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { addRapierPropCollider } from './colliders';
import { districtSetVisuals } from './visual-district-sets';
import { makeLocalStreets } from './roads';
import { generateIsland } from './island';
import { POI_IDS } from './types';
import { gridSample, segmentProjection } from './terrain';

it('seats kit ensembles in all eight districts and gives every object a scaled triangle collider', async () => {
  const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
  const sets = island.districtSets!;
  expect(sets).toHaveLength(17);
  expect(sets.reduce((n, set) => n + set.pieces.length, 0)).toBe(67);
  expect(new Set(sets.map(s => s.district))).toEqual(new Set(POI_IDS));
  const roads = [...island.roads, ...makeLocalStreets(island)];
  const visuals = districtSetVisuals(sets);
  expect(visuals.group.children).toHaveLength(17);
  for (const mesh of visuals.group.children as THREE.Mesh[]) {
    expect(mesh.geometry.getAttribute('color').count).toBe(mesh.geometry.getAttribute('position').count);
    expect(mesh.userData.kitDetail).toBe('distant');
  }
  const near = new THREE.Vector3().copy(sets.find(s => s.name === 'Tractor yard')!.pieces[0]!.bottom);
  expect(visuals.update(near)).toBe(true);
  expect(visuals.group.getObjectByName('kit-set-hoofington-Tractor yard')!.castShadow).toBe(true);
  expect(visuals.group.getObjectByName('kit-set-hoofington-Roadside pumpkin cart')!.castShadow).toBe(false);
  expect(visuals.update(near)).toBe(false);
  expect(visuals.update(near.clone().addScalar(1000))).toBe(true);
  expect(visuals.group.children.some(mesh => mesh.castShadow)).toBe(false);
  visuals.dispose();
  for (const set of sets) for (const [i, p] of set.pieces.entries()) {
    const shape = island.colliders.find(c => c.shape !== 'heightfield' && c.id === 'kit-' + set.district + '-' + set.name + '-' + i);
    expect(shape?.shape).toBe('trimesh');
    if (shape?.shape !== 'trimesh') throw Error('Missing triangle collider');
    for (const road of roads) {
      const radius = Math.hypot(shape.size.x, shape.size.z) / 2;
      const gap = Math.min(...road.points.slice(1).map((end, j) =>
        segmentProjection(p.bottom, road.points[j]!, end).distance)) - radius - road.width / 2;
      expect(gap, set.name + ' at ' + road.id).toBeGreaterThan(.98);
    }
    expect(shape.transform.position).toEqual(p.bottom);
    expect(shape.transform.rotationY).toBe(p.yaw);
    expect(shape.vertices!.length).toBeGreaterThan(9);
    expect(shape.indices!.length % 3).toBe(0);
    expect(Math.abs(gridSample(island, p.bottom.x, p.bottom.z) - p.bottom.y)).toBeLessThan(.31);
  }
  const yard = sets.find(s => s.name === 'Tractor yard')!;
  const id = 'kit-hoofington-Tractor yard-0';
  const tractor = island.colliders.find(s => s.shape === 'trimesh' && s.id === id)!;
  if (tractor.shape !== 'trimesh') throw Error('Missing tractor');
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    const registry = { props: new Map<string, RAPIER.Collider>(), bodies: new Map<string, RAPIER.RigidBody>() };
    addRapierPropCollider(world, registry, tractor);
    world.step();
    const p = yard.pieces[0]!.bottom;
    const hit = world.castRay(new RAPIER.Ray({ x: p.x, y: p.y + 7, z: p.z }, { x: 0, y: -1, z: 0 }), 8, true);
    expect(hit?.collider.handle).toBe(registry.props.get(id)?.handle);
    expect(hit!.timeOfImpact).toBeLessThan(6.3);
  } finally { world.free(); }
});
