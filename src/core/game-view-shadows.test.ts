import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameView } from './GameView';

function selectCasters(group: THREE.Group, graphics: 'medium' | 'high' = 'high'): () => void {
  // Exercise the real selection method without constructing a WebGL renderer or DOM.
  const view = Object.create(GameView.prototype) as GameView;
  Object.assign(view, {
    world: { group },
    currentSettings: { graphics },
    cameraTarget: new THREE.Vector3(),
    shadowDefaults: new WeakMap<THREE.Mesh, boolean>(),
  });
  const refresh = () =>
    (view as unknown as { refreshShadowCasters(): void }).refreshShadowCasters();
  refresh();
  return refresh;
}

describe('GameView shadow caster selection', () => {
  it('selects a merged district cell whose distant centre still overlaps the player', () => {
    const group = new THREE.Group();
    group.position.x = 100; // both mesh origins are too distant under the old check

    // The merged cell's geometry lives away from its mesh origin, as in district LOD.
    const overlapping = new THREE.Mesh(new THREE.BoxGeometry(340, 10, 10));
    overlapping.name = 'hoofington-library-batched-cell-2';
    overlapping.geometry.translate(100, 0, 0); // world-space sphere centre ~200, radius ~170
    overlapping.castShadow = true;

    const outside = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 10));
    outside.name = 'downtown-library-batched-cell-3';
    outside.geometry.translate(100, 0, 80);
    outside.castShadow = true;

    group.add(overlapping, outside);
    selectCasters(group);

    expect(overlapping.geometry.boundingSphere).not.toBeNull();
    expect(overlapping.castShadow).toBe(true);
    expect(outside.castShadow).toBe(false);
  });

  it('uses active instance bounds and excludes batches wholly outside the shadow area', () => {
    const group = new THREE.Group();
    const makeBatch = (x: number): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial(), 1);
      mesh.castShadow = true;
      mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(x, 0, 0));
      group.add(mesh);
      return mesh;
    };
    const overlapping = makeBatch(35);
    const outside = makeBatch(200);
    const empty = makeBatch(0);
    empty.count = 0;

    const refresh = selectCasters(group);

    expect(overlapping.castShadow).toBe(true);
    expect(outside.castShadow).toBe(false);
    expect(empty.castShadow).toBe(false);

    // Recompaction must not reuse the previous instance bounding sphere.
    overlapping.setMatrixAt(0, new THREE.Matrix4().makeTranslation(200, 0, 0));
    outside.setMatrixAt(0, new THREE.Matrix4().makeTranslation(2, 0, 0));
    refresh();
    expect(overlapping.castShadow).toBe(false);
    expect(outside.castShadow).toBe(true);
  });

  it('keeps the medium preset caster cap and favours closer bounds', () => {
    const group = new THREE.Group();
    const meshes = Array.from({ length: 8 }, (_, index) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      mesh.position.x = 2 + index * 3;
      mesh.castShadow = true;
      group.add(mesh);
      return mesh;
    });
    selectCasters(group, 'medium');
    expect(meshes.map(mesh => mesh.castShadow)).toEqual([
      true, true, true, true, true, true, false, false,
    ]);
  });
});
