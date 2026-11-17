import * as THREE from 'three';
import type { IslandData } from './types';
import type { HoofPlacement } from './visual-hoofington';
import { BUILDING_RAMP, TOON_RAMP } from './visual-props';
import {
  WORLD_LOD, completelyOccluded, isSmallWorldModel,
  simplifiedWorldGeometry,
} from './lod';

export interface DistrictLod {
  updateCulling(position: THREE.Vector3, frustum: THREE.Frustum): boolean;
  dispose(): void;
}

export interface BakedPlacement<Model extends string> {
  placement: HoofPlacement<Model>;
  start: number;
  count: number;
}

interface Cell<Model extends string> {
  small: boolean;
  ranges: BakedPlacement<Model>[];
  vertices: number;
  keepSilhouette: boolean;
}

/**
 * Partition the existing single draw of painted district art into fixed-size
 * spatial *merged* cells. Never create one draw per imported GLTF primitive or
 * per repeated placement; each cell has just one high/low mesh whose geometry
 * is switched at a camera distance. The original painterly geometry and
 * object positions are preserved in the near cells.
 */
export async function createDistrictLod<Model extends string>(
  island: IslandData,
  baked: THREE.BufferGeometry,
  placements: readonly BakedPlacement<Model>[],
  group: THREE.Group,
  meshName: string,
): Promise<DistrictLod> {
  const cells = new Map<string, Cell<Model>>();
  // Art rule (docs/art/qa/hoofington-qa-1.md, pass 2): buildings are never
  // decimated. At the distant ratio, houses, the silo and the barn crumpled
  // into faceted shards in the World Lab art camera. Only foliage and small
  // dressing simplify; slender landmarks keep their silhouette as before.
  const silhouetteModels = new Set([
    'skylineCrane', 'waterTower', 'windmill',
    // Hoofington buildings
    'pinkHome', 'creamHome', 'yellowHome', 'farmhouse', 'cottage', 'barn', 'silo',
    // Downtown buildings
    'bakery', 'arcade', 'cinema', 'cafe', 'market', 'boutique', 'cornerShop',
    'kayShop', 'townhouse', 'brickHouse', 'kayHouse', 'highrise', 'fountain',
  ]);
  for (const range of placements) {
    if (range.count === 0) continue;
    const p = range.placement;
    const small = isSmallWorldModel(p.model);
    if (completelyOccluded(island, p.position, p.size, p.source)) continue;
    const x = Math.floor(p.position.x / WORLD_LOD.districtCellSize);
    const z = Math.floor(p.position.z / WORLD_LOD.districtCellSize);
    const key = x + ':' + z + ':' + (small ? 'small' : 'large');
    let cell = cells.get(key);
    if (!cell) {
      cell = { small, ranges: [], vertices: 0, keepSilhouette: false };
      cells.set(key, cell);
    }
    cell.ranges.push(range);
    cell.vertices += range.count;
    if (silhouetteModels.has(p.model)) cell.keepSilhouette = true;
  }

  const positions = baked.getAttribute('position').array as Float32Array;
  const colours = baked.getAttribute('color').array as Float32Array;
  const normals = baked.getAttribute('normal').array as Float32Array;
  const entries: Array<{
    mesh: THREE.Mesh;
    high: THREE.BufferGeometry;
    low: THREE.BufferGeometry;
    sphere: THREE.Sphere;
    small: boolean;
  }> = [];
  // Largest (usually architectural) cell keeps the historical QA mesh name.
  const ordered = [...cells.values()].sort((a, b) =>
    Number(a.small) - Number(b.small) || b.vertices - a.vertices);
  for (let i = 0; i < ordered.length; i++) {
    const cell = ordered[i]!;
    const high = new THREE.BufferGeometry();
    for (const [attribute, values] of [
      ['position', positions], ['color', colours], ['normal', normals],
    ] as const) {
      const buffer = new Float32Array(cell.vertices * 3);
      let offset = 0;
      for (const range of cell.ranges) {
        buffer.set(values.subarray(range.start * 3,
          (range.start + range.count) * 3), offset);
        offset += range.count * 3;
      }
      high.setAttribute(attribute, new THREE.BufferAttribute(buffer, 3));
    }
    high.computeBoundingSphere();
    const low = cell.keepSilhouette ? high : await simplifiedWorldGeometry(high);
    const mesh = new THREE.Mesh(high, new THREE.MeshToonMaterial({
      color: 0xffffff, vertexColors: true,
      // Buildings/trees read as solid lit volumes (BUILDING_RAMP); small
      // flowers and bushes keep the soft foliage ramp. Back faces go into
      // the shadow map so sunlit walls never self-shadow into acne.
      gradientMap: cell.small ? TOON_RAMP : BUILDING_RAMP, side: THREE.DoubleSide,
      shadowSide: THREE.BackSide,
    }));
    mesh.name = i === 0 ? meshName : meshName + '-cell-' + i;
    mesh.castShadow = !cell.small;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // the whole spatial cell is culled below
    group.add(mesh);
    entries.push({ mesh, high, low, sphere: high.boundingSphere!.clone(),
      small: cell.small });
  }
  baked.dispose();
  let disposed = false;
  return {
    updateCulling(position, frustum): boolean {
      if (disposed) return false;
      let changed = false;
      for (const entry of entries) {
        const dist = position.distanceTo(entry.sphere.center);
        const visible = frustum.intersectsSphere(entry.sphere) &&
          dist - entry.sphere.radius <= island.size * 1.4 &&
          (!entry.small || dist - Math.min(entry.sphere.radius, 12) <
            WORLD_LOD.smallPropDistance);
        const far = dist > WORLD_LOD.detailedDistance;
        const geometry = far ? entry.low : entry.high;
        if (entry.mesh.castShadow && (entry.mesh.visible !== visible ||
            entry.mesh.geometry !== geometry)) changed = true;
        entry.mesh.visible = visible;
        entry.mesh.geometry = geometry;
      }
      return changed;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const entry of entries) {
        entry.high.dispose();
        if (entry.low !== entry.high) entry.low.dispose();
        (entry.mesh.material as THREE.Material).dispose();
      }
    },
  };
}
