import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import type { PropDescriptor } from './types';
import { fitLibraryModel, isAuthoredLibraryAsset } from './library-fit';
import { buildPropVisuals } from './visual-props';
import { bakeLibraryGeometry } from './visual-hoofington';
import { instantiateLibraryModel } from './visual-lighthouse';
import { instanceDamAsset } from './visual-dam-landscape';

function boxBounds(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): THREE.Box3 {
  const bounds = new THREE.Box3().setFromBufferAttribute(
    geometry.getAttribute('position') as THREE.BufferAttribute);
  return matrix ? bounds.applyMatrix4(matrix) : bounds;
}

function expectExtent(bounds: THREE.Box3, size: [number, number, number],
  floor: number): void {
  const span = bounds.getSize(new THREE.Vector3());
  expect(span.x).toBeCloseTo(size[0], 5);
  expect(span.y).toBeCloseTo(size[1], 5);
  expect(span.z).toBeCloseTo(size[2], 5);
  expect(bounds.min.y).toBeCloseTo(floor, 5);
}

function makeModel(width: number, height: number, depth: number): THREE.Group {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial()));
  return group;
}

describe('aspect-preserving library model fitting', () => {
  it('turns a Z-long 1x1x4 model into an X-long 4x1x1 box, without distortion', () => {
    const fit = fitLibraryModel(new THREE.Vector3(1, 1, 4),
      new THREE.Vector3(4, 1, 1), 'assets/library/kenney/city-kit-industrial/shipping-container-a.glb');
    expect(fit.yaw).toBeCloseTo(Math.PI / 2, 8);
    expect(fit.scale).toEqual(new THREE.Vector3(1, 1, 1));
  });

  it('fits a 2x1x1 model uniformly by 2 into 4x4x4', () => {
    const fit = fitLibraryModel(new THREE.Vector3(2, 1, 1),
      new THREE.Vector3(4, 4, 4), 'assets/library/kenney/platformer-kit/crate.glb');
    expect(fit.yaw).toBe(0);
    expect(fit.scale).toEqual(new THREE.Vector3(2, 2, 2));
  });

  it('keeps authored custom/ and usdcraft/ paths on their old per-axis fit', () => {
    for (const path of [
      'assets/library/custom/hoofington-props/windmill.glb',
      'assets/library/usdcraft/street-lamp-lantern.glb',
    ]) {
      expect(isAuthoredLibraryAsset(path)).toBe(true);
      const fit = fitLibraryModel(new THREE.Vector3(1, 1, 4),
        new THREE.Vector3(4, 4, 4), path);
      expect(fit.yaw).toBe(0);
      expect(fit.scale).toEqual(new THREE.Vector3(4, 4, 1));
    }
    expect(isAuthoredLibraryAsset('assets/library/kenney/nature-kit/rock_largeB.glb')).toBe(false);
  });

  it('grounds and rotates the Hoofington/Downtown merged baker without extra draws', () => {
    const root = makeModel(1, 1, 4);
    const fit = bakeLibraryGeometry([{
      model: 'cow', position: { x: 12, y: 5, z: -8 },
      size: { x: 4, y: 1, z: 1 }, yaw: 0,
    }], new Map([['cow', root]]))!;
    const bounds = boxBounds(fit);
    expectExtent(bounds, [4, 1, 1], 4.5);
    expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(12, 5);
    expect(bounds.getCenter(new THREE.Vector3()).z).toBeCloseTo(-8, 5);
    fit.dispose();

    // The same baker preserves a custom GLB's prior independent X/Y/Z stretch.
    const authored = bakeLibraryGeometry([{
      model: 'windmill', position: { x: 0, y: 5, z: 0 },
      size: { x: 4, y: 4, z: 4 }, yaw: 0,
    }], new Map([['windmill', root]]))!;
    expectExtent(boxBounds(authored), [3.84, 3.92, 3.84], 3.04);
    authored.dispose();
    root.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
  });

  it('scales and grounds lighthouse model instances, keeping one batch per part', () => {
    const root = makeModel(2, 1, 1);
    const group = instantiateLibraryModel(root, [{
      x: 10, y: 3, z: -12, width: 4, height: 4, depth: 4, yaw: 0,
    }], 'lighthouse-fit-test', false, 'assets/library/kenney/platformer-kit/crate.glb');
    expect(group.children).toHaveLength(1);
    const mesh = group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(1);
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixScale(matrix))
      .toEqual(new THREE.Vector3(2, 2, 2));
    const bounds = boxBounds(mesh.geometry, matrix);
    expectExtent(bounds, [4, 2, 2], 3);
    expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(10, 5);
    expect(bounds.getCenter(new THREE.Vector3()).z).toBeCloseTo(-12, 5);

    const custom = instantiateLibraryModel(root, [{
      x: 0, y: 3, z: 0, width: 4, height: 4, depth: 4,
    }], 'lighthouse-custom-test', false, 'assets/library/custom/hoofington-props/windmill.glb');
    const instance = custom.children[0] as THREE.InstancedMesh;
    instance.getMatrixAt(0, matrix);
    expectExtent(boxBounds(instance.geometry, matrix), [4, 4, 4], 3);
    mesh.geometry.dispose();
    instance.geometry.dispose();
    root.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
  });

  it('keeps Dam parts batched, rotates their long axis and grounds each instance', () => {
    const root = makeModel(1, 1, 4);
    const group = instanceDamAsset(root, {
      name: 'dam-fit-test', path: 'kenney/city-kit-industrial/shipping-container-a.glb',
      placements: [
        { x: 0, y: 5, z: 0, width: 4, height: 1, depth: 1, yaw: 0 },
        { x: 12, y: 6, z: 0, width: 8, height: 2, depth: 2, yaw: 0 },
      ],
    });
    expect(group.children).toHaveLength(1);
    const mesh = group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(2);
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    expectExtent(boxBounds(mesh.geometry, matrix), [4, 1, 1], 5);
    mesh.getMatrixAt(1, matrix);
    expect(new THREE.Vector3().setFromMatrixScale(matrix))
      .toEqual(new THREE.Vector3(2, 2, 2));
    expectExtent(boxBounds(mesh.geometry, matrix), [8, 2, 2], 6);
    mesh.geometry.dispose();
    root.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
  });

  it('renders uniformly fitted prop copies while preserving descriptor physics matrices and LOD', async () => {
    const source = makeModel(1, 1, 4);
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValue({ scene: source } as Awaited<ReturnType<GLTFLoader['loadAsync']>>);
    vi.stubGlobal('document', {});
    // Containers now use authored custom GLBs; a Kenney crate still exercises
    // the uniform-fit path without changing the source physics descriptor.
    const prop: PropDescriptor = {
      id: 'crate-fit', kind: 'crate',
      transform: { position: { x: 4, y: 5, z: -3 }, rotationY: 0 },
      size: { x: 4, y: 1, z: 1 },
      body: { type: 'static' }, shape: 'cuboid', collidable: false,
      breakable: false, lickable: false, climbable: false,
    };
    const visuals = buildPropVisuals([prop]);
    try {
      const original = visuals.group.getObjectByName('props-crate') as THREE.InstancedMesh;
      const saved = new THREE.Matrix4();
      original.getMatrixAt(0, saved);
      await vi.waitFor(() => expect(visuals.group.userData['libraryReady']).toBe(true));
      expect(visuals.group.userData['libraryFailed']).toBe(0);
      const after = new THREE.Matrix4();
      original.getMatrixAt(0, after);
      expect(after.elements).toEqual(saved.elements);
      const allVisible = { intersectsSphere: () => true } as unknown as THREE.Frustum;
      visuals.updateCulling(new THREE.Vector3(4, 5, 17), allVisible, 500, () => false);
      const near = visuals.group.getObjectByName('render-near-crate') as THREE.InstancedMesh;
      expect(near).toBeInstanceOf(THREE.InstancedMesh);
      expect(near.count).toBe(1);
      near.getMatrixAt(0, after);
      expect(new THREE.Vector3().setFromMatrixScale(after))
        .toEqual(new THREE.Vector3(1, 1, 1));
      const bounds = boxBounds(near.geometry, after);
      expectExtent(bounds, [4, 1, 1], 4.5);
      expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(4, 5);
      expect(bounds.getCenter(new THREE.Vector3()).z).toBeCloseTo(-3, 5);
      visuals.updateCulling(new THREE.Vector3(4, 5, 120), allVisible, 500, () => false);
      const far = visuals.group.getObjectByName('render-far-crate') as THREE.InstancedMesh;
      expect(far).toBeInstanceOf(THREE.InstancedMesh);
      // The same transform is reused when the far LOD becomes visible.
      expect(far.count).toBe(1);
      far.getMatrixAt(0, after);
      expect(new THREE.Vector3().setFromMatrixScale(after))
        .toEqual(new THREE.Vector3(1, 1, 1));
    } finally {
      visuals.dispose();
      loader.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
