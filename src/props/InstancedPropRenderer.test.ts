import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { InstancedPropRenderer } from './InstancedPropRenderer';
import { PropFactory } from './PropFactory';

function model(): THREE.Group {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xc09045 })));
  return root;
}

describe('instanced GameView prop rendering', () => {
  it('shares one draw per geometry/material even across loaded factory clones', async () => {
    const load = vi.fn(async () => model());
    const factory = new PropFactory({ loadModel: load,
      assetBaseUrl: 'https://game.example/GiggaGoat/' });
    const scene = new THREE.Scene();
    const batch = new InstancedPropRenderer(scene);
    const a = factory.createCrate();
    const b = factory.createCrate();
    batch.add(a);
    batch.update();
    const singletonCalls = batch.drawCalls;
    batch.add(b);
    batch.update();
    expect(batch.drawCalls).toBe(singletonCalls);
    expect(singletonCalls).toBeLessThan(10);
    await factory.whenReady();
    batch.update();
    expect(load).toHaveBeenCalledTimes(1);
    expect(a.userData.assetStatus).toBe('ready');
    expect(b.userData.assetStatus).toBe('ready');
    expect(batch.drawCalls).toBeLessThanOrEqual(singletonCalls + 1);
    expect(scene.children).toContain(batch.group);
    expect(batch.group.children.every(x => x instanceof THREE.InstancedMesh)).toBe(true);
    batch.dispose();
    factory.dispose();
  });

  it('updates Rapier-style world transforms and compacts offscreen instances', () => {
    const scene = new THREE.Scene();
    const batch = new InstancedPropRenderer(scene);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshToonMaterial();
    const near = new THREE.Group(), far = new THREE.Group();
    near.add(new THREE.Mesh(geometry, material));
    far.add(new THREE.Mesh(geometry, material));
    far.position.x = 100;
    batch.add(near); batch.add(far);
    const camera = new THREE.PerspectiveCamera(60, 1, .1, 500);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    batch.update(camera, 30);
    expect(batch.drawCalls).toBe(1);
    const mesh = batch.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(1);
    far.position.set(2, 0, 0);
    batch.update(camera, 30);
    expect(mesh.count).toBe(2);
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(1, matrix);
    expect(matrix.elements[12]).toBeCloseTo(2);
    near.visible = false;
    batch.update(camera, 30);
    expect(mesh.count).toBe(1);
    batch.remove(far);
    batch.update(camera, 30);
    expect(mesh.count).toBe(1); // stale mesh is detached; new batch has no visible roots
    expect((batch.group.children[0] as THREE.InstancedMesh).count).toBe(0);
    batch.dispose();
    geometry.dispose();
    material.dispose();
  });

  it('retains visible fallback parts after failed loading and releases removed roots', async () => {
    const load = vi.fn(async (): Promise<THREE.Object3D> => {
      throw new Error('offline');
    });
    const factory = new PropFactory({ loadModel: load,
      assetBaseUrl: 'https://game.example/GiggaGoat/' });
    const batch = new InstancedPropRenderer(new THREE.Scene());
    const root = factory.createBuildPiece('floor');
    batch.add(root);
    await factory.whenReady();
    batch.update();
    expect(root.userData.assetStatus).toBe('fallback');
    expect(batch.drawCalls).toBeGreaterThan(0);
    expect(batch.group.children.some(x => (x as THREE.InstancedMesh).count > 0)).toBe(true);
    batch.remove(root);
    factory.release(root);
    batch.update();
    expect(batch.group.children).toHaveLength(0);
    batch.dispose();
    factory.dispose();
  });
});
