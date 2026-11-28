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
    expect(WORLD_LOD.distantTriangleRatio).toBe(0.19);
    expect(WORLD_LOD.minSimplifyTriangles).toBe(600);
    for (const kind of ['flower', 'bush', 'mailbox', 'lamp'])
      expect(isSmallWorldModel(kind)).toBe(true);
    expect(isSmallWorldModel('house')).toBe(false);
  });

  it('keeps 100-triangle boxy props and other sub-600 meshes unchanged', async () => {
    const crate = new THREE.BoxGeometry(1, 1, 1, 1, 1, 12);
    const nearThreshold = new THREE.PlaneGeometry(1, 1, 13, 23);
    expect(triangleCount(crate)).toBe(100);
    expect(triangleCount(nearThreshold)).toBe(598);
    expect(await simplifiedWorldGeometry(crate)).toBe(crate);
    expect(await simplifiedWorldGeometry(nearThreshold)).toBe(nearThreshold);
    crate.dispose();
    nearThreshold.dispose();
  });

  it('still simplifies a 2,000-triangle geometry', async () => {
    const source = new THREE.SphereGeometry(1, 50, 21);
    expect(triangleCount(source)).toBe(2_000);
    const distant = await simplifiedWorldGeometry(source);
    expect(distant).not.toBe(source);
    expect(triangleCount(distant)).toBeLessThan(triangleCount(source));
    distant.dispose();
    source.dispose();
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

  it('keeps the painted building mesh at street level and restores it after a flight', async () => {
    const island = generateIsland({ seed: 'skyline', resolution: 65 });
    const high = new THREE.BoxGeometry(8, 10, 8, 12, 12, 12).toNonIndexed();
    high.translate(0, 200, 0);
    const vertices = high.getAttribute('position').count;
    high.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(vertices * 3).fill(.72), 3));
    high.setAttribute('hoofingtonFacade', new THREE.Float32BufferAttribute(new Float32Array(vertices * 4), 4));
    const group = new THREE.Group();
    const lod = await createDistrictLod(island, high, [{
      placement: { model: 'pinkHome', position: { x: 0, y: 200, z: 0 }, size: { x: 8, y: 10, z: 8 }, yaw: 0 },
      start: 0, count: vertices,
    }], group, 'house');
    const house = group.children[0] as THREE.Mesh;
    const original = house.geometry;
    const view = new THREE.Frustum(), distant = new THREE.Vector3(0, 260, 95);
    lod.updateCulling(distant, view, true);
    expect(triangleCount(house.geometry)).toBeLessThan(triangleCount(original));
    expect(house.geometry.hasAttribute('hoofingtonFacade')).toBe(true);
    const skyline = house.geometry;
    lod.updateCulling(new THREE.Vector3(0, 205, 260), view, true);
    expect(triangleCount(house.geometry)).toBeLessThan(triangleCount(skyline));
    expect(house.geometry.hasAttribute('hoofingtonFacade')).toBe(true);
    lod.updateCulling(distant, view, true);
    expect(house.geometry).toBe(skyline);
    lod.updateCulling(distant, view);
    expect(house.geometry).toBe(original);
    lod.updateCulling(new THREE.Vector3(0, 213, 4), view, true);
    expect(house.geometry).toBe(original);
    lod.dispose();
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
