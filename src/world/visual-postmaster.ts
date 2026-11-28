import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Postmaster } from '../core/Postmaster';
import type { Vec3 } from './types';
import { publicAssetUrl } from './public-assets';

function release(model: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  model.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    for (const m of Array.isArray(node.material) ? node.material : [node.material]) materials.add(m);
    if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
  });
  for (const m of materials) {
    if (m instanceof THREE.MeshStandardMaterial) m.map?.dispose();
    m.dispose();
  }
}

export class PostmasterVisual {
  readonly root = new THREE.Group();
  private model?: THREE.Group;
  private close?: THREE.Object3D;
  private street?: THREE.Object3D;
  private shadow?: THREE.Mesh;
  private head?: THREE.Object3D;
  private wing?: THREE.Object3D;
  private loading = false;
  private disposed = false;
  private retryAt = 0;
  private wasNear = false;
  private welcomedAt = -Infinity;

  constructor(private clerk: Postmaster) {
    this.root.name = 'Marnie the Island Post postmaster';
    if (clerk.position) this.root.position.copy(clerk.position);
    this.root.scale.setScalar(clerk.scale);
    this.root.rotation.y = Math.PI / 2;
    this.root.visible = false;
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const { scene } = await new GLTFLoader().loadAsync(publicAssetUrl('assets/island-post/marnie.glb'));
      const close = scene.getObjectByName('Marnie-close'), street = scene.getObjectByName('Marnie-street');
      if (this.disposed) { release(scene); return; }
      if (!close || !(street instanceof THREE.Mesh)) {
        release(scene);
        throw new Error('Missing postmaster detail meshes');
      }
      this.close = close;
      this.street = street;
      this.head = scene.getObjectByName('Postmaster-head');
      this.wing = scene.getObjectByName('Postmaster-wing-L');
      scene.scale.setScalar(.82);
      scene.position.y = .9566 * .82;
      scene.traverse(node => {
        if (node instanceof THREE.Mesh) node.receiveShadow = true;
      });
      this.shadow = street.clone();
      this.shadow.layers.set(1);
      this.shadow.castShadow = true;
      scene.add(this.shadow);
      this.root.add(scene);
      this.model = scene;
      this.clerk.available = true;
    } catch {
      // The village mailboxes continue to offer dispatches during a failed asset request.
      this.retryAt = performance.now() + 30000;
    } finally {
      this.loading = false;
    }
  }

  update(time: number, dt: number, camera: Vec3, goat: Vec3, enabled: boolean, reduced: boolean): void {
    const p = this.clerk.position;
    if (!p) return;
    const k = this.clerk.scale;
    const distance = Math.hypot(camera.x - p.x, camera.y - p.y, camera.z - p.z) / k;
    if (enabled && distance < 55 && !this.model && !this.loading && performance.now() >= this.retryAt)
      void this.load();
    this.root.visible = enabled && this.clerk.onDuty && distance < 62 && !!this.model;
    if (!this.root.visible || !this.close || !this.street) { this.wasNear = false; return; }
    // Hysteresis keeps the feather detail steady at the boundary of the conversation view.
    const detailed = !reduced && distance < (this.close.visible ? 14 : 12);
    this.close.visible = detailed;
    this.street.visible = !detailed;
    if (this.shadow) this.shadow.visible = !reduced && distance < 22;
    const dx = goat.x - p.x, dz = goat.z - p.z, meters = Math.hypot(dx, dz) / k;
    if (meters < 5 && !this.wasNear) { this.wasNear = true; this.welcomedAt = time; }
    if (meters > 7) this.wasNear = false;
    if (!detailed || !this.head || !this.wing) return;
    const age = THREE.MathUtils.clamp(time - Math.max(this.welcomedAt, this.clerk.greetedAt), 0, 1.65);
    const wave = Math.sin(age * Math.PI / 1.65) ** 2;
    const toward = THREE.MathUtils.euclideanModulo(Math.atan2(dx, dz) - this.root.rotation.y + Math.PI,
      2 * Math.PI) - Math.PI;
    const turn = meters < 7 ? THREE.MathUtils.clamp(toward, -.52, .52) : .11 * Math.sin(time * .7);
    this.head.rotation.y = THREE.MathUtils.damp(this.head.rotation.y, turn, 5, dt);
    this.head.rotation.x = .025 * Math.sin(time * 1.7) + .12 * wave * Math.sin(age * 7);
    this.wing.rotation.z = -.035 - wave * (.49 + .12 * Math.sin(age * 13));
  }

  dispose(): void {
    this.disposed = true;
    this.clerk.available = false;
    this.shadow?.removeFromParent();
    if (this.model) release(this.model);
    this.root.clear();
  }
}
