import type * as THREE from 'three';
import { hashString } from './random';
import type { PropDescriptor } from './types';

const orchard = ['tree_detailed', 'tree_oak', 'tree_thin'] as const;
const woodland = ['tree_pineTallA_detailed', 'tree_pineTallC_detailed', 'tree_pineRoundB'] as const;
const coastal = ['tree_plateau', 'tree_oak'] as const;
const shrubs = ['plant_bushDetailed', 'plant_bushLarge', 'plant_flatTall'] as const;
const blooms = ['flower_purpleA', 'flower_yellowB', 'flower_redC'] as const;

/** Reserve some of each district's original painted stock, with different
 * canopy shapes, heathers and flowering plants on the remaining footprints. */
export function plantKitBatches(entries: readonly PropDescriptor[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  entries.forEach((prop, index) => {
    if (prop.body.type !== 'static') return;
    const hash = hashString(prop.id);
    if (hash % 5 === 0) return;
    let palette: readonly string[];
    switch (prop.kind) {
      case 'tree-oak':
        palette = prop.poiId === 'old-lighthouse' || prop.poiId === 'baa-ardwalk' ? coastal : orchard;
        break;
      case 'tree-pine': palette = woodland; break;
      case 'bush': palette = shrubs; break;
      case 'flower': palette = blooms; break;
      default: return;
    }
    const model = palette[Math.floor(hash / 5) % palette.length]!;
    const indices = groups.get(model);
    if (indices) indices.push(index);
    else groups.set(model, [index]);
  });
  return groups;
}

/** Grounded source geometry comes in native metres. Align a tree's trunk
 * (rather than the centre of an asymmetric crown) with its solid collider. */
export function fitPlantGeometry(geometry: THREE.BufferGeometry, trunk: boolean): void {
  const box = geometry.boundingBox!;
  const height = Math.max(.001, box.max.y - box.min.y);
  const p = geometry.getAttribute('position');
  let cx = 0, cz = 0;
  if (trunk) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > box.min.y + height * .025) continue;
      minX = Math.min(minX, p.getX(i)); maxX = Math.max(maxX, p.getX(i));
      minZ = Math.min(minZ, p.getZ(i)); maxZ = Math.max(maxZ, p.getZ(i));
    }
    cx = (minX + maxX) / 2; cz = (minZ + maxZ) / 2;
  }
  const radius = Math.max(.001, box.max.x - cx, cx - box.min.x, box.max.z - cz, cz - box.min.z);
  geometry.translate(-cx, -box.min.y, -cz);
  geometry.scale(.49 / radius, .98 / height, .49 / radius);
  geometry.translate(0, -.49, 0);
}
