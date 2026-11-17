import * as THREE from 'three';

interface Part { root: THREE.Group; source: THREE.Mesh }
interface Batch { mesh: THREE.InstancedMesh; parts: Part[] }

/**
 * Render PropFactory roots as shared geometry/material InstancedMeshes rather
 * than submitting every decorative strip, rivet and loaded GLB mesh separately.
 * Logical roots are never added to the scene: their matrices still track Rapier,
 * while the only visible objects are these GPU instancing batches.
 *
 * The factory increments assetRevision when a GLB replaces its fallback. That
 * change (and add/remove) rebuilds the relevant topology, never each frame.
 */
export class InstancedPropRenderer {
  readonly group = new THREE.Group();
  private readonly roots = new Set<THREE.Group>();
  private readonly revisions = new Map<THREE.Group, number>();
  private readonly batches: Batch[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly center = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly rootScale = new THREE.Vector3();
  private readonly sphere = new THREE.Sphere();
  private dirty = true;

  constructor(parent: THREE.Object3D) {
    this.group.name = 'library-prop-instances';
    parent.add(this.group);
  }

  add(root: THREE.Group): THREE.Group {
    this.roots.add(root);
    this.dirty = true;
    return root;
  }

  remove(root: THREE.Group): void {
    if (this.roots.delete(root)) {
      this.revisions.delete(root);
      this.dirty = true;
    }
  }

  get drawCalls(): number { return this.batches.length; }

  private rebuild(): void {
    for (const batch of this.batches) {
      batch.mesh.removeFromParent();
      batch.mesh.dispose(); // only the instance buffer; the factory owns geometry and materials
    }
    this.batches.length = 0;
    const groups = new Map<string, Part[]>();
    for (const root of this.roots) {
      this.revisions.set(root, (root.userData.assetRevision as number | undefined) ?? 0);
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const key = object.geometry.uuid + ':' + materials.map(m => m.uuid).join(',');
        const parts = groups.get(key) ?? [];
        parts.push({ root, source: object });
        groups.set(key, parts);
      });
    }
    for (const parts of groups.values()) {
      const source = parts[0]!.source;
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, parts.length);
      mesh.name = 'library-batch';
      mesh.count = 0;
      mesh.frustumCulled = false; // cull individual roots before compacting visible instances
      mesh.castShadow = false; // GameView limits shadow pass separately to stay at 60 Hz
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.batches.push({ mesh, parts });
    }
    this.dirty = false;
  }

  /** Update matrices after camera positioning, including the async loading transition. */
  update(camera?: THREE.Camera, drawDistance = Infinity): void {
    for (const root of this.roots) {
      if (this.revisions.get(root) !==
        ((root.userData.assetRevision as number | undefined) ?? 0)) {
        this.dirty = true;
        break;
      }
    }
    if (this.dirty) this.rebuild();

    if (camera) {
      camera.updateMatrixWorld();
      this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.projection);
      camera.getWorldPosition(this.cameraPosition);
    }
    const visible = new Set<THREE.Group>();
    for (const root of this.roots) {
      if (!root.visible) continue;
      root.updateMatrixWorld(true);
      if (camera) {
        this.center.setFromMatrixPosition(root.matrixWorld);
        root.getWorldScale(this.rootScale);
        const nominal = root.userData.nominalSize as
          { x: number; y: number; z: number } | undefined;
        // Boards are anchored at ground level, not their visual centre.
        const radius = nominal ? Math.hypot(
          nominal.x * this.rootScale.x, nominal.y * this.rootScale.y,
          nominal.z * this.rootScale.z) + 1 : 5;
        if (this.center.distanceToSquared(this.cameraPosition) >
          (drawDistance + radius) ** 2) continue;
        this.sphere.set(this.center, radius);
        if (!this.frustum.intersectsSphere(this.sphere)) continue;
      }
      visible.add(root);
    }
    for (const batch of this.batches) {
      let count = 0;
      for (const { root, source } of batch.parts) {
        if (!visible.has(root) || !source.visible) continue;
        batch.mesh.setMatrixAt(count++, source.matrixWorld);
      }
      batch.mesh.count = count;
      if (count) batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const batch of this.batches) {
      batch.mesh.removeFromParent();
      batch.mesh.dispose();
    }
    this.batches.length = 0;
    this.roots.clear();
    this.revisions.clear();
    this.group.removeFromParent();
  }
}
