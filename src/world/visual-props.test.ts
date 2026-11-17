import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fitLibraryModel } from './library-fit';
import { PROP_LIBRARY_MODELS } from './library-props';
import type { PropDescriptor, PropKind } from './types';
import { buildPropVisuals } from './visual-props';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('library prop draw-call compaction', () => {
  it('draws mixed-distance authored geometry once, keeps simplified LODs separate, and suppresses hidden props', async () => {
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 36, 24),
        new THREE.MeshStandardMaterial({ color: 0x73a5c4 })));
      return { scene } as Awaited<ReturnType<GLTFLoader['loadAsync']>>;
    });
    vi.stubGlobal('document', {});

    const prop = (kind: PropKind, id: string, x: number, z: number): PropDescriptor => ({
      id, kind,
      transform: { position: { x, y: 1.5, z }, rotationY: 0.27 },
      size: { x: 1.3, y: 2.4, z: 0.9 },
      body: { type: 'static' }, shape: 'cuboid',
      collidable: false, breakable: false, lickable: false, climbable: false,
      color: 0x42a7d1,
    });
    // Descriptor order deliberately alternates near and far. The final authored
    // descriptor will be zero-scaled by the game and must never be copied.
    const fences = [
      prop('chain-fence', 'fence-near-0', 0, 0),
      prop('chain-fence', 'fence-far', 2, -110),
      prop('chain-fence', 'fence-near-1', 4, 0),
      prop('chain-fence', 'fence-suppressed', 6, 0),
    ];
    const pines = [
      prop('tree-pine', 'pine-near', 10, 0),
      prop('tree-pine', 'pine-far', 10, -110),
    ];
    const crates = [
      prop('crate', 'crate-near', -10, 0),
      prop('crate', 'crate-far', -10, -110),
    ];
    const visuals = buildPropVisuals([...fences, ...pines, ...crates]);
    const originalFence = visuals.group.getObjectByName('props-chain-fence') as THREE.InstancedMesh;
    originalFence.setMatrixAt(3, new THREE.Matrix4().makeScale(0, 0, 0));
    originalFence.instanceMatrix.needsUpdate = true;

    try {
      await vi.waitFor(() => expect(visuals.group.userData['libraryReady']).toBe(true),
        { timeout: 15000 });
      expect(visuals.group.userData['libraryFailed']).toBe(0);
      expect(load).toHaveBeenCalledTimes(3);

      const fenceDraw = visuals.group.getObjectByName(
        'render-near-chain-fence') as THREE.InstancedMesh;
      expect(fenceDraw).toBeInstanceOf(THREE.InstancedMesh);
      expect(fenceDraw.name).toBe('render-near-chain-fence');
      expect(visuals.group.getObjectByName('render-far-chain-fence')).toBe(fenceDraw);
      // THREE.Object3D recurses through child getObjectByProperty when called
      // on the containing scene rather than directly on the prop group.
      const root = new THREE.Group();
      root.add(visuals.group);
      expect(root.getObjectByName('render-far-chain-fence')).toBe(fenceDraw);
      expect(visuals.batches[0]!.meshes).toEqual([fenceDraw]);
      expect(fenceDraw.castShadow).toBe(originalFence.castShadow);
      expect(fenceDraw.receiveShadow).toBe(originalFence.receiveShadow);
      expect(fenceDraw.material).toBe(originalFence.material);
      expect(fenceDraw.geometry).toBe(originalFence.geometry);
      expect(originalFence.visible).toBe(false);

      const originalPine = visuals.group.getObjectByName('props-tree-pine') as THREE.InstancedMesh;
      const pineNear = visuals.group.getObjectByName('render-near-tree-pine') as THREE.InstancedMesh;
      const pineFar = visuals.group.getObjectByName('render-far-tree-pine') as THREE.InstancedMesh;
      expect(pineNear).not.toBe(pineFar);
      expect(pineNear.geometry).toBe(originalPine.geometry);
      expect(pineFar.geometry).not.toBe(pineNear.geometry);
      expect(visuals.batches[1]!.meshes).toEqual([pineNear, pineFar]);
      expect((pineNear.material as THREE.MeshToonMaterial).onBeforeCompile.toString())
        .toContain('uWorldWind');

      const originalCrate = visuals.group.getObjectByName('props-crate') as THREE.InstancedMesh;
      const crateNear = visuals.group.getObjectByName('render-near-crate') as THREE.InstancedMesh;
      const crateFar = visuals.group.getObjectByName('render-far-crate') as THREE.InstancedMesh;
      expect(crateNear).not.toBe(crateFar);

      const frustum = { intersectsSphere: () => true } as unknown as THREE.Frustum;
      const camera = new THREE.Vector3(0, 1.5, 20);
      visuals.updateCulling(camera, frustum, 500, () => false);
      expect(fenceDraw.count).toBe(3); // 2 near + 1 far, never the zero-scaled prop
      expect(fenceDraw.visible).toBe(true);
      const drawnFences = visuals.group.children.filter(child =>
        child instanceof THREE.InstancedMesh && child.visible && child.count > 0 &&
        child.name.startsWith('render-') && child.name.endsWith('chain-fence'));
      expect(drawnFences).toEqual([fenceDraw]);
      expect(pineNear.count).toBe(1);
      expect(pineFar.count).toBe(1);
      expect(pineNear.visible).toBe(true);
      expect(pineFar.visible).toBe(true);

      const expected = new THREE.Matrix4(), actual = new THREE.Matrix4();
      const expectedColor = new THREE.Color(), actualColor = new THREE.Color();
      const compare = (source: THREE.InstancedMesh, target: THREE.InstancedMesh,
        sourceIndex: number, drawnIndex: number, adjustment?: THREE.Matrix4): void => {
        source.getMatrixAt(sourceIndex, expected);
        if (adjustment) expected.multiply(adjustment);
        target.getMatrixAt(drawnIndex, actual);
        expect(actual.elements).toEqual(expected.elements);
        source.getColorAt(sourceIndex, expectedColor);
        target.getColorAt(drawnIndex, actualColor);
        expect(actualColor.getHex()).toBe(expectedColor.getHex());
      };
      // Near indices in descriptor order, then far indices in descriptor order.
      [0, 2, 1].forEach((sourceIndex, drawnIndex) =>
        compare(originalFence, fenceDraw, sourceIndex, drawnIndex));
      expect(actualColor.getHex()).toBe(0xffffff); // authored GLB paint is not tinted
      compare(originalPine, pineNear, 0, 0);
      compare(originalPine, pineFar, 1, 0);

      // Kenney geometry has an extra visual-space fit; keep applying it on
      // both sides of the detailed-distance threshold.
      const native = originalCrate.geometry.boundingBox!.getSize(new THREE.Vector3());
      for (const [index, copy] of [crateNear, crateFar].entries()) {
        expect(copy.count).toBe(1);
        const box = crates[index]!.size;
        const fit = fitLibraryModel(native, new THREE.Vector3(box.x, box.y, box.z),
          PROP_LIBRARY_MODELS.crate);
        const adjustment = new THREE.Matrix4().makeTranslation(0, -0.5, 0)
          .multiply(new THREE.Matrix4().makeScale(
            1 / Math.max(box.x, 0.001), 1 / Math.max(box.y, 0.001),
            1 / Math.max(box.z, 0.001)))
          .multiply(new THREE.Matrix4().makeRotationY(fit.yaw))
          .multiply(new THREE.Matrix4().makeScale(
            fit.scale.x, fit.scale.y, fit.scale.z));
        compare(originalCrate, copy, index, 0, adjustment);
      }

      // Distance cutoffs remain unchanged even though full-detail far props
      // now share one draw; hiding and restoring also updates visibility.
      visuals.updateCulling(camera, frustum, 70, () => false);
      expect(fenceDraw.count).toBe(2);
      expect(pineFar.count).toBe(0);
      visuals.updateCulling(camera, frustum, 500, () => true);
      for (const mesh of [fenceDraw, pineNear, pineFar, crateNear, crateFar]) {
        expect(mesh.count).toBe(0);
        expect(mesh.visible).toBe(false);
      }
      visuals.updateCulling(camera, frustum, 500, () => false);
      expect(fenceDraw.count).toBe(3);
      expect(fenceDraw.visible).toBe(true);
      expect(pineNear.count).toBe(1);
      expect(pineFar.count).toBe(1);
    } finally {
      for (const kind of ['chain-fence', 'tree-pine', 'crate']) {
        const source = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
        const far = visuals.group.getObjectByName('render-far-' + kind) as THREE.InstancedMesh;
        if (far && far.geometry !== source.geometry) far.geometry.dispose();
        source.geometry.dispose();
        (source.material as THREE.Material).dispose();
      }
      visuals.dispose();
    }
  });
});
