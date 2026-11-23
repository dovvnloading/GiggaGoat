import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { generateIsland } from './island';
import type { PropDescriptor } from './types';

function footprint(prop: PropDescriptor, margin = 0): OBB {
  return new OBB(new THREE.Vector3(prop.transform.position.x, 0, prop.transform.position.z),
    new THREE.Vector3(prop.size.x / 2 + margin, 1, prop.size.z / 2 + margin),
    new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationY(prop.transform.rotationY)));
}

describe('procedural foliage around buildings', () => {
  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'foliage-small', size: 400, resolution: 97 },
    { seed: 'foliage-large', size: 900, resolution: 97 },
  ])('keeps visible crowns out of authored building footprints at $size m', options => {
    const island = generateIsland(options);
    const plants = island.props.filter(p => ['tree-oak', 'tree-pine', 'bush'].includes(p.kind) &&
      (p.id.startsWith('detail-island-') || p.id.startsWith('detail-downtown-bleatsville-')));
    const buildings = island.props.filter(p =>
      ['shop', 'house', 'barn', 'cottage', 'booth', 'windmill', 'silo'].includes(p.kind));
    expect(plants.length).toBeGreaterThan(30);
    const collisions: string[] = [];
    for (const plant of plants) for (const building of buildings) {
      if (footprint(plant, .15 * options.size / 600).intersectsOBB(footprint(building))) {
        collisions.push(`${plant.id} / ${building.id}`);
      }
    }
    expect(collisions).toEqual([]);
  });
});
