import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import type { IslandData } from './types';
import type { HoofPlacement } from './visual-hoofington';
import { BUILDING_RAMP, TOON_RAMP } from './visual-props';
import { paintHoofingtonFacades } from './surface-paint';
import {
  WORLD_LOD, completelyOccluded, isSmallWorldModel,
  simplifiedWorldGeometry,
} from './lod';

export interface DistrictLod {
  updateCulling(position: THREE.Vector3, frustum: THREE.Frustum, sightseeing?: boolean): boolean;
  dispose(): void;
}

export interface BakedPlacement<Model extends string> {
  placement: HoofPlacement<Model>;
  start: number;
  count: number;
}

// Limit the deviation in world metres. From the travel camera the allowed error
// projects to roughly one pixel; vertex paint and the original normals survive.
function skylineGeometry(source: THREE.BufferGeometry, fraction: number, errorMetres: number): THREE.BufferGeometry {
  if (!MeshoptSimplifier.supported) return source;
  const mesh = mergeVertices(source, 1e-4);
  const positions = mesh.getAttribute('position').array as Float32Array;
  const paint = mesh.getAttribute('color').array as Float32Array;
  const indices = Uint32Array.from(mesh.index!.array);
  const [reduced] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, paint, 3,
    [.35, .35, .35], null, Math.floor(indices.length * fraction / 3) * 3, errorMetres, ['ErrorAbsolute', 'Permissive']);
  if (reduced.length >= indices.length) {
    mesh.dispose();
    return source;
  }
  mesh.setIndex(new THREE.BufferAttribute(reduced, 1));
  return mesh;
}

/** Paint seams and window normals do not affect a sun shadow. Weld positions alone
 * and preserve the outer shape to within the shadow map's ground resolution. */
function architecturalShadow(skyline: THREE.BufferGeometry): THREE.BufferGeometry {
  const surface = new THREE.BufferGeometry();
  surface.setAttribute('position', skyline.getAttribute('position'));
  surface.setIndex(skyline.index);
  const welded = mergeVertices(surface, 1e-4);
  const indices = Uint32Array.from(welded.index!.array);
  const [reduced] = MeshoptSimplifier.simplify(indices, welded.getAttribute('position').array as Float32Array,
    3, Math.floor(indices.length / 9) * 3, .16, ['ErrorAbsolute']);
  welded.setIndex(new THREE.BufferAttribute(reduced, 1));
  welded.computeBoundingSphere();
  return welded;
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
  // sent through the generic far-mesh reduction. Houses, the silo and the barn crumpled
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

  const attributes = ['position', 'color', 'normal', 'hoofingtonFacade'].flatMap(name => {
    const attribute = baked.getAttribute(name);
    return attribute ? [{ name, itemSize: attribute.itemSize, values: attribute.array as Float32Array }] : [];
  });
  const entries: Array<{
    mesh: THREE.Mesh;
    high: THREE.BufferGeometry;
    low: THREE.BufferGeometry;
    sphere: THREE.Sphere;
    small: boolean;
    skyline?: THREE.BufferGeometry;
    horizon?: THREE.BufferGeometry;
    shadow?: THREE.BufferGeometry;
  }> = [];
  // Largest (usually architectural) cell keeps the historical QA mesh name.
  const ordered = [...cells.values()].sort((a, b) =>
    Number(a.small) - Number(b.small) || b.vertices - a.vertices);
  for (let i = 0; i < ordered.length; i++) {
    const cell = ordered[i]!;
    const high = new THREE.BufferGeometry();
    for (const { name, values, itemSize } of attributes) {
      if (cell.small && name === 'hoofingtonFacade') continue;
      const buffer = new Float32Array(cell.vertices * itemSize);
      let offset = 0;
      for (const range of cell.ranges) {
        buffer.set(values.subarray(range.start * itemSize,
          (range.start + range.count) * itemSize), offset);
        offset += range.count * itemSize;
      }
      high.setAttribute(name, new THREE.BufferAttribute(buffer, itemSize));
    }
    high.computeBoundingBox();
    high.computeBoundingSphere();
    high.userData.preserveSilhouette = cell.keepSilhouette;
    const low = cell.keepSilhouette ? high : await simplifiedWorldGeometry(high);
    const material = new THREE.MeshToonMaterial({
      color: 0xffffff, vertexColors: true,
      // Buildings/trees read as solid lit volumes (BUILDING_RAMP); small
      // flowers and bushes keep the soft foliage ramp. Back faces go into
      // the shadow map so sunlit walls never self-shadow into acne.
      gradientMap: cell.small ? TOON_RAMP : BUILDING_RAMP, side: THREE.DoubleSide,
      shadowSide: THREE.BackSide,
    });
    if (high.hasAttribute('hoofingtonFacade')) paintHoofingtonFacades(material, island.size / 600);
    const mesh = new THREE.Mesh(high, material);
    mesh.name = i === 0 ? meshName : meshName + '-cell-' + i;
    mesh.castShadow = !cell.small;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // the whole spatial cell is culled below
    group.add(mesh);
    const skyline = cell.keepSilhouette ? undefined : low;
    entries.push({ mesh, high, low, skyline, sphere: high.boundingSphere!.clone(),
      small: cell.small });
  }
  baked.dispose();
  let simplifierReady = false;
  if (MeshoptSimplifier.supported) void MeshoptSimplifier.ready.then(() => { simplifierReady = true; });
  let disposed = false;
  return {
    updateCulling(position, frustum, sightseeing = false): boolean {
      if (disposed) return false;
      let changed = false;
      let preparedCell = false;
      for (const entry of entries) {
        const dist = position.distanceTo(entry.sphere.center);
        const visible = frustum.intersectsSphere(entry.sphere) &&
          dist - entry.sphere.radius <= island.size * 1.4 &&
          (!entry.small || dist - Math.min(entry.sphere.radius, 12) <
            WORLD_LOD.smallPropDistance);
        const far = dist > WORLD_LOD.detailedDistance;
        // The loose sphere often encloses the street outside a long or tall cell.
        // Measure to the closest point of the painted buildings' actual bounds.
        const nearest = entry.high.boundingBox!.distanceToPoint(position);
        const skyline = sightseeing && nearest > 25;
        const horizon = sightseeing && nearest > 200 && entry.high.userData.preserveSilhouette;
        // Prepare at most one visible architectural cell per district each frame.
        if (visible && sightseeing && !preparedCell && simplifierReady) {
          if (!entry.skyline) {
            entry.skyline = skylineGeometry(entry.high, .25, .10);
            entry.shadow = architecturalShadow(entry.skyline);
            preparedCell = true;
          } else if (horizon && !entry.horizon) {
            // Beyond 200 m the extra 14 cm of error projects to less than a
            // pixel at the default 1080p field of view. Keep the painted seams.
            entry.horizon = skylineGeometry(entry.skyline, .5, .14);
            preparedCell = true;
          }
        }
        entry.mesh.userData.shadowSilhouette = sightseeing ? (entry.shadow ?? entry.skyline) : undefined;
        const distant = horizon ? entry.horizon ?? entry.skyline : entry.skyline;
        const geometry = skyline && distant ? distant : far ? entry.low : entry.high;
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
        if (entry.horizon && entry.horizon !== entry.skyline) entry.horizon.dispose();
        entry.shadow?.dispose();
        if (entry.skyline && entry.skyline !== entry.high && entry.skyline !== entry.low) entry.skyline.dispose();
        entry.high.dispose();
        if (entry.low !== entry.high) entry.low.dispose();
        (entry.mesh.material as THREE.Material).dispose();
      }
    },
  };
}
