import * as THREE from 'three';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IslandData, PropDescriptor, Vec3 } from './types';
import { gridSample } from './terrain';

/** One place for visual LOD distances (world metres) and mesh budgets. */
export const WORLD_LOD = {
  detailedDistance: 60,
  smallPropDistance: 140,
  districtCellSize: 42,
  distantTriangleRatio: 0.19,
  minSimplifyTriangles: 600,
  smallModels: [
    'flower', 'bush', 'mailbox', 'lamp', 'grass-tuft', 'mushroom',
    'gnome', 'cone', 'planter',
  ],
} as const;

const smallModels = new Set<string>(WORLD_LOD.smallModels);
export function isSmallWorldModel(model: string): boolean {
  return smallModels.has(model);
}

export function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

const simplified = new WeakMap<THREE.BufferGeometry, Promise<THREE.BufferGeometry>>();

/**
 * Meshoptimizer-backed SimplifyModifier. Each baked geometry is simplified at
 * most once, on asset arrival, never while the camera is moving. Position and
 * vertex paint are welded together, so silhouettes and painted facades survive
 * while far-away internal detail is removed. The source geometry is untouched.
 */
export function simplifiedWorldGeometry(source: THREE.BufferGeometry):
Promise<THREE.BufferGeometry> {
  let pending = simplified.get(source);
  if (pending) return pending;
  pending = (async () => {
    if (triangleCount(source) < WORLD_LOD.minSimplifyTriangles) return source;
    const input = source.clone();
    // Recompute smoothed far normals; original per-face normals otherwise stop
    // meshoptimizer welding vertices shared by adjacent triangles.
    input.deleteAttribute('normal');
    const welded = mergeVertices(input, 1e-4);
    input.dispose();
    try {
      const vertices = welded.getAttribute('position').count;
      const remove = Math.floor(vertices * (1 - WORLD_LOD.distantTriangleRatio));
      const result = await new SimplifyModifier().modify(welded, remove);
      result.computeVertexNormals();
      result.computeBoundingSphere();
      // Do not replace geometry unless the actual indexed triangle count fell.
      if (triangleCount(result) >= triangleCount(source)) {
        result.dispose();
        return source;
      }
      return result;
    } catch (error) {
      console.warn('World LOD simplification failed; keeping original mesh', error);
      return source;
    } finally {
      welded.dispose();
    }
  })();
  simplified.set(source, pending);
  return pending;
}

const solidBuildingKinds = new Set<string>([
  'house', 'shop', 'tower', 'barn', 'cottage', 'silo',
  'control-house', 'lookout',
]);

/**
 * Conservative visibility rejection. Only remove a mesh if its *entire*
 * bounding envelope lies below terrain or well inside a solid building.
 * Nearby facades, roof furniture, and colliders are never modified.
 */
export function completelyOccluded(
  island: IslandData, position: Vec3, size: Vec3, source?: PropDescriptor,
): boolean {
  const halfHeight = size.y * 0.5;
  if (position.y + halfHeight < gridSample(island, position.x, position.z) - 0.15)
    return true;
  for (const building of island.props) {
    if (!solidBuildingKinds.has(building.kind) || building === source) continue;
    const centre = building.transform.position;
    const vertical = Math.abs(position.y - centre.y) + halfHeight;
    if (vertical >= building.size.y * 0.5 - 0.65) continue;
    const dx = position.x - centre.x, dz = position.z - centre.z;
    const yaw = building.transform.rotationY;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    // A circumscribed radius is intentionally more conservative than an AABB
    // for rotated models: only geometry truly hidden inside is discarded.
    const radius = Math.hypot(size.x, size.z) * 0.5;
    if (Math.abs(localX) + radius < building.size.x * 0.5 - 0.65 &&
        Math.abs(localZ) + radius < building.size.z * 0.5 - 0.65) return true;
  }
  return false;
}
