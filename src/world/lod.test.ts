import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateIsland } from './island';
import { createDistrictLod } from './district-lod';
import {
  WORLD_LOD, completelyOccluded, isSmallWorldModel,
  simplifiedWorldGeometry, triangleCount,
} from './lod';
import type { HoofPlacement } from './visual-hoofington';

describe('cached world mesh LOD', () => {
  it('uses one central metre-scale config and identifies distant small props', () => {
    expect(WORLD_LOD.detailedDistance).toBe(60);
    expect(WORLD_LOD.smallPropDistance).toBe(140);
    for (const kind of ['flower', 'bush', 'mailbox', 'lamp'])
      expect(isSmallWorldModel(kind)).toBe(true);
    expect(isSmallWorldModel('house')).toBe(false);
  });

  it('welds painted triangles and reuses meshoptimizer simplification', async () => {
    const high = new THREE.SphereGeometry(1, 36, 24);
    const count = high.getAttribute('position').count;
    const colors = new Float32Array(count * 3).fill(0.75);
    high.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const first = simplifiedWorldGeometry(high);
    expect(simplifiedWorldGeometry(high)).toBe(first);
    const low = await first;
    expect(triangleCount(low)).toBeLessThan(triangleCount(high) * 0.7);
    expect(low.getAttribute('color')).toBeDefined();
    expect(low.getAttribute('normal')).toBeDefined();
    expect(low.boundingSphere).not.toBeNull();
    if (low !== high) low.dispose();
    high.dispose();
  });

  it('drops wholly buried art and preserves exposed building objects', () => {
    const island = generateIsland({ seed: 'lod-occlusion', resolution: 65 });
    const size = { x: 1, y: 1, z: 1 };
    expect(completelyOccluded(island, { x: 0, y: -100, z: 0 }, size)).toBe(true);
    expect(completelyOccluded(island, { x: 0, y: 250, z: 0 }, size)).toBe(false);
    const building = island.props.find(p => p.kind === 'house' && p.size.y > 4)!;
    expect(completelyOccluded(island, building.transform.position, size)).toBe(true);
    expect(completelyOccluded(island, building.transform.position,
      building.size, building)).toBe(false);
  });

  it('swaps spatial cell geometry and hides small art past 140 m', async () => {
    const island = generateIsland({ seed: 'lod-cells', resolution: 65 });
    const part = new THREE.SphereGeometry(1, 30, 20).toNonIndexed();
    part.translate(0, 200, 0);
    const vertices = part.getAttribute('position').count;
    const baked = new THREE.BufferGeometry();
    for (const attribute of ['position', 'normal'] as const) {
      const source = part.getAttribute(attribute).array as Float32Array;
      const both = new Float32Array(source.length * 2);
      both.set(source);
      both.set(source, source.length);
      baked.setAttribute(attribute, new THREE.BufferAttribute(both, 3));
    }
    baked.setAttribute('color', new THREE.BufferAttribute(
      new Float32Array(vertices * 6).fill(0.7), 3));
    type Model = 'house' | 'flower';
    const placement = (model: Model): HoofPlacement<Model> => ({
      model, position: { x: 0, y: 200, z: 0 },
      size: { x: 2, y: 2, z: 2 }, yaw: 0,
    });
    const root = new THREE.Group();
    const lod = await createDistrictLod(island, baked, [
      { placement: placement('house'), start: 0, count: vertices },
      { placement: placement('flower'), start: vertices, count: vertices },
    ], root, 'district-lod');
    const large = root.getObjectByName('district-lod') as THREE.Mesh;
    const small = root.children.find(node => node !== large) as THREE.Mesh;
    expect(large).toBeInstanceOf(THREE.Mesh);
    expect(small).toBeInstanceOf(THREE.Mesh);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);
    const frustum = new THREE.Frustum();
    const update = (distance: number): void => {
      camera.position.set(0, 200, distance);
      camera.lookAt(0, 200, 0);
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(new THREE.Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      lod.updateCulling(camera.position, frustum);
    };
    update(35);
    const highTriangles = triangleCount(large.geometry);
    expect(large.visible).toBe(true);
    expect(small.visible).toBe(true);
    update(120);
    expect(large.visible).toBe(true);
    expect(triangleCount(large.geometry)).toBeLessThan(highTriangles);
    expect(small.visible).toBe(true);
    update(190);
    expect(small.visible).toBe(false);
    lod.dispose();
    part.dispose();
  });
});
