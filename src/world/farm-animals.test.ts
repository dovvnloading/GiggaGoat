import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { createFarmAnimal } from './farm-animals';
import { HOOFINGTON_MODELS } from './visual-hoofington';

it.each(['cow', 'horse', 'pig', 'sheep'] as const)('poses the shipped %s skin on its feet using its own clips', async model => {
  const bytes = readFileSync('public/' + HOOFINGTON_MODELS[model]);
  const asset = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
  const place = { model, size: { x: 2, y: 3, z: 4 }, position: { x: 8, y: 3.5, z: 5 }, yaw: .3 };
  const a = createFarmAnimal(asset, place, 0), b = createFarmAnimal(asset, place, 1);
  function joints(root: THREE.Object3D) {
    return root.getObjectByProperty('type', 'SkinnedMesh') as THREE.SkinnedMesh;
  }
  const first = joints(a.root), second = joints(b.root);
  function points() {
    a.root.updateMatrixWorld(true);
    const p = new THREE.Vector3(), values: THREE.Vector3[] = [];
    for (let i = 0; i < first.geometry.getAttribute('position').count; i += 4)
      values.push(first.getVertexPosition(i, p).clone().applyMatrix4(first.matrixWorld));
    return values;
  }
  try {
    expect(first.skeleton.bones[0]).not.toBe(second.skeleton.bones[0]);
    expect(Math.abs(new THREE.Box3().setFromObject(a.root, true).min.y - 2)).toBeLessThan(.08);
    const before = points();
    for (let i = 0; i <= 36; i++) a.update(i / 30);
    const after = points();
    expect(Math.max(...after.map((v, i) => v.distanceTo(before[i]!)))).toBeGreaterThan(.008);
    expect(a.root.position.toArray()).toEqual([8, 2, 5]);
  } finally {
    a.dispose(); b.dispose();
  }
});

