import * as THREE from 'three';

/** The representative vertices retain their source indices for animated meshes.
 * Face colours and UV seams are sampled from the original authored triangles. */
export interface SoftwareGeometry {
  sources: Uint32Array;
  corners: Uint32Array;
  originals: Uint32Array;
  normals: Float32Array;
  colours?: Float32Array;
  materials: Uint16Array;
}

const cache = new WeakMap<THREE.BufferGeometry, Map<number, SoftwareGeometry>>();

export function softwareGeometry(geometry: THREE.BufferGeometry, cells: number): SoftwareGeometry {
  let levels = cache.get(geometry);
  if (!levels) { levels = new Map(); cache.set(geometry, levels); }
  const existing = levels.get(cells);
  if (existing) return existing;
  const position = geometry.getAttribute('position');
  const colour = geometry.getAttribute('color');
  const representatives: number[] = [];
  const remap = new Uint32Array(position.count);
  if (cells > 0) {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const extent = bounds.getSize(new THREE.Vector3());
    const step = Math.max(extent.x, extent.y, extent.z, .00001) / cells;
    const row = cells + 2;
    const occupied = new Map<number, number>();
    for (let i = 0; i < position.count; i++) {
      const x = Math.floor((position.getX(i) - bounds.min.x) / step);
      const y = Math.floor((position.getY(i) - bounds.min.y) / step);
      const z = Math.floor((position.getZ(i) - bounds.min.z) / step);
      const key = (z * row + y) * row + x;
      let id = occupied.get(key);
      if (id === undefined) {
        id = representatives.length;
        occupied.set(key, id);
        representatives.push(i);
      }
      remap[i] = id;
    }
  } else {
    for (let i = 0; i < position.count; i++) { remap[i] = i; representatives.push(i); }
  }
  const corners: number[] = [], originals: number[] = [], normals: number[] = [];
  const colours: number[] = [], materials: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const count = geometry.index?.count ?? position.count;
  const start = geometry.drawRange.start;
  const end = Math.min(count, start + geometry.drawRange.count);
  let group = 0;
  for (let k = start; k + 2 < end; k += 3) {
    const i = geometry.index?.getX(k) ?? k;
    const j = geometry.index?.getX(k + 1) ?? k + 1;
    const l = geometry.index?.getX(k + 2) ?? k + 2;
    const p = remap[i]!, q = remap[j]!, r = remap[l]!;
    if (p === q || q === r || p === r) continue;
    corners.push(p, q, r);
    originals.push(i, j, l);
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, j).sub(a);
    c.fromBufferAttribute(position, l).sub(a);
    b.cross(c).normalize();
    normals.push(b.x, b.y, b.z);
    if (colour) colours.push((colour.getX(i) + colour.getX(j) + colour.getX(l)) / 3,
      (colour.getY(i) + colour.getY(j) + colour.getY(l)) / 3,
      (colour.getZ(i) + colour.getZ(j) + colour.getZ(l)) / 3);
    while (group + 1 < geometry.groups.length && geometry.groups[group + 1]!.start <= k) group++;
    materials.push(geometry.groups[group]?.materialIndex ?? 0);
  }
  const result: SoftwareGeometry = { sources: Uint32Array.from(representatives),
    corners: Uint32Array.from(corners), originals: Uint32Array.from(originals),
    normals: Float32Array.from(normals), colours: colour ? Float32Array.from(colours) : undefined,
    materials: Uint16Array.from(materials) };
  levels.set(cells, result);
  return result;
}
