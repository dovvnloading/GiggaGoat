import * as THREE from 'three';
import { WORLD_LOD, simplifiedWorldGeometry } from './lod';

/**
 * Distant scenery has several independently-instanced GLTF batches outside
 * the descriptor prop renderer (Dam pine forests, lighthouse stones, meadow
 * grass and textured Hoofington gnomes). Each used to draw *every* instance
 * whenever the enormous group sphere intersected the camera.
 *
 * Preserve the source as an inert, full-index copy; the two visible batches
 * contain only individual instances inside the camera and its distance LOD.
 * No source model, texture or placement is changed, and each mesh geometry is
 * simplified at most once, off the frame update path.
 */
export function createEnvironmentLod(group: THREE.Group): {
  updateCulling(camera: THREE.Camera, position: THREE.Vector3,
    frustum: THREE.Frustum): boolean;
  dispose(): void;
} {
  interface Entry {
    source: THREE.InstancedMesh;
    near: THREE.InstancedMesh;
    far: THREE.InstancedMesh;
    matrices: Float32Array;
    colors: Float32Array | null;
    low?: THREE.BufferGeometry;
    nearIndices: number[];
    farIndices: number[];
    small: boolean;
  }
  const entries: Entry[] = [];
  const registered = new Set<THREE.InstancedMesh>();
  const lowGeometries = new Set<THREE.BufferGeometry>();
  let disposed = false;
  let lastPose: number[] | undefined;
  let shadowDirty = false;

  function eligible(name: string): boolean {
    return name.startsWith('meadow-') || name.startsWith('planted-') ||
      name === 'hoofington-garden-gnomes' ||
      (name.startsWith('dam-') &&
        /pines|tree|rock|boulder|shrub|wildflower|cattail|reed/.test(name)) ||
      (name.startsWith('lighthouse-') &&
        /instanced|rocks/.test(name));
  }

  function register(source: THREE.InstancedMesh): void {
    if (registered.has(source)) return;
    registered.add(source);
    const count = source.count;
    if (!count) return;
    const small = /meadow-|planted-|gnome|shrub|wildflower|cattail|reed/.test(source.name);
    const makeBatch = (name: string): THREE.InstancedMesh => {
      const copy = new THREE.InstancedMesh(source.geometry, source.material, count);
      copy.name = 'environment-lod-' + name + '-' + source.name;
      copy.position.copy(source.position);
      copy.quaternion.copy(source.quaternion);
      copy.scale.copy(source.scale);
      copy.castShadow = source.castShadow;
      copy.receiveShadow = source.receiveShadow;
      copy.frustumCulled = false; // each instance is tested below
      copy.count = 0;
      copy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      source.parent!.add(copy);
      return copy;
    };
    const near = makeBatch('near'), far = makeBatch('far');
    const entry: Entry = {
      source, near, far, small,
      matrices: new Float32Array(source.instanceMatrix.array),
      colors: source.instanceColor
        ? new Float32Array(source.instanceColor.array) : null,
      nearIndices: [], farIndices: [],
    };
    entries.push(entry);
    source.visible = false;
    void simplifiedWorldGeometry(source.geometry).then(low => {
      if (disposed) {
        if (low !== source.geometry) low.dispose();
        return;
      }
      entry.low = low;
      far.geometry = low;
      lastPose = undefined;
      if (low !== source.geometry) lowGeometries.add(low);
      if (far.castShadow) shadowDirty = true;
    });
  }

  function compact(entry: Entry, mesh: THREE.InstancedMesh,
    indices: readonly number[]): void {
    const matrix = new THREE.Matrix4();
    for (let at = 0; at < indices.length; at++) {
      const index = indices[at]!;
      matrix.fromArray(entry.matrices, index * 16);
      mesh.setMatrixAt(at, matrix);
      if (entry.colors) {
        const offset = index * 3;
        mesh.setColorAt(at, new THREE.Color().setRGB(
          entry.colors[offset]!, entry.colors[offset + 1]!,
          entry.colors[offset + 2]!));
      }
    }
    mesh.count = indices.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  return {
    updateCulling(camera, position, frustum): boolean {
      if (disposed) return false;
      // Asset arrivals can add new batches even at an unmoving camera.
      // Otherwise do not reclassify thousands of static instances every frame;
      // an unchanged camera/projection produces exactly the same visibility.
      const candidates: THREE.InstancedMesh[] = [];
      group.traverse(object => {
        if (object instanceof THREE.InstancedMesh &&
            eligible(object.name) && !registered.has(object))
          candidates.push(object);
      });
      const pose = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements];
      if (candidates.length === 0 && lastPose &&
          pose.every((value, i) => value === lastPose![i])) {
        const changed = shadowDirty;
        shadowDirty = false;
        return changed;
      }
      lastPose = pose;
      group.updateMatrixWorld(true);
      for (const candidate of candidates) register(candidate);

      const localMatrix = new THREE.Matrix4();
      const centre = new THREE.Vector3();
      const bounds = new THREE.Sphere();
      let changed = shadowDirty;
      shadowDirty = false;
      for (const entry of entries) {
        const high = entry.source.geometry;
        if (!high.boundingSphere) high.computeBoundingSphere();
        const base = high.boundingSphere!;
        const nearIndices: number[] = [], farIndices: number[] = [];
        for (let i = 0; i < entry.source.count; i++) {
          localMatrix.fromArray(entry.matrices, i * 16);
          centre.copy(base.center).applyMatrix4(localMatrix)
            .applyMatrix4(entry.source.matrixWorld);
          const radius = base.radius * localMatrix.getMaxScaleOnAxis() *
            entry.source.matrixWorld.getMaxScaleOnAxis();
          const distance = position.distanceTo(centre) - radius;
          if (distance > (entry.small ? WORLD_LOD.smallPropDistance : 900))
            continue;
          bounds.center.copy(centre);
          bounds.radius = radius;
          if (!frustum.intersectsSphere(bounds)) continue;
          (distance <= WORLD_LOD.detailedDistance || entry.low === high ?
            nearIndices : farIndices).push(i);
        }
        const same = (a: number[], b: number[]): boolean =>
          a.length === b.length && a.every((value, i) => value === b[i]);
        if (!same(entry.nearIndices, nearIndices) ||
            !same(entry.farIndices, farIndices)) {
          compact(entry, entry.near, nearIndices);
          compact(entry, entry.far, farIndices);
          entry.nearIndices = nearIndices;
          entry.farIndices = farIndices;
          if (entry.source.castShadow) changed = true;
        }
        entry.near.visible = nearIndices.length > 0;
        entry.far.visible = farIndices.length > 0;
      }
      return changed;
    },
    dispose(): void {
      disposed = true;
      for (const entry of entries) {
        entry.near.removeFromParent();
        entry.far.removeFromParent();
        entry.near.dispose();
        entry.far.dispose();
        // Original batches still own their own meshes/materials/geometry.
      }
      for (const geometry of lowGeometries) geometry.dispose();
    },
  };
}
