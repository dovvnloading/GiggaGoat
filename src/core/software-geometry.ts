import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

export type GeometryDetail = 'full' | 'near' | 'far';
export interface SoftwareGeometry {
  sources: Uint32Array;
  corners: Uint32Array;
  normals: Float32Array;
  colours?: Float32Array;
  materials: Uint16Array;
}

const cache = new WeakMap<THREE.BufferGeometry, Map<GeometryDetail, SoftwareGeometry>>();
let canSimplify = false;
if (MeshoptSimplifier.supported) {
  void MeshoptSimplifier.ready.then(() => { canSimplify = true; }, () => {});
}

/** A post, a rail and a lamp fitting can all be separate parts of one mesh.
 * Collapse connected edges within a bounded error so thin parts keep their silhouettes. */
function simplify(geometry: THREE.BufferGeometry, indices: Uint32Array, detail: GeometryDetail): Uint32Array {
  if (detail === 'full' || indices.length < 360) return indices;
  const position = geometry.getAttribute('position');
  const colour = geometry.getAttribute('color'), uv = geometry.getAttribute('uv');
  const stride = (colour ? 3 : 0) + (uv ? 2 : 0);
  const positions = new Float32Array(position.count * 3);
  const attributes = new Float32Array(position.count * stride);
  let j = 0;
  for (let i = 0; i < position.count; i++) {
    positions[3 * i] = position.getX(i);
    positions[3 * i + 1] = position.getY(i);
    positions[3 * i + 2] = position.getZ(i);
    if (colour) {
      attributes[j++] = colour.getX(i);
      attributes[j++] = colour.getY(i);
      attributes[j++] = colour.getZ(i);
    }
    if (uv) { attributes[j++] = uv.getX(i); attributes[j++] = uv.getY(i); }
  }
  const target = 3 * Math.max(12, Math.floor(indices.length / 3 * (detail === 'near' ? .45 : .14)));
  const error = detail === 'near' ? .0035 : .018;
  if (!stride) return MeshoptSimplifier.simplify(indices, positions, 3, target, error)[0];
  const weights = [...(colour ? [.6, .6, .6] : []), ...(uv ? [1, 1] : [])];
  return MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attributes, stride, weights,
    null, target, error, ['Permissive'])[0];
}

export function softwareGeometry(geometry: THREE.BufferGeometry, detail: GeometryDetail): SoftwareGeometry {
  if (!canSimplify) detail = 'full';
  let levels = cache.get(geometry);
  if (!levels) { levels = new Map(); cache.set(geometry, levels); }
  const existing = levels.get(detail);
  if (existing) return existing;
  const position = geometry.getAttribute('position'), colour = geometry.getAttribute('color');
  const count = geometry.index?.count ?? position.count;
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
  const sources: number[] = [], corners: number[] = [], normals: number[] = [];
  const colours: number[] = [], materials: number[] = [];
  const remap = new Map<number, number>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const group of groups) {
    const start = Math.max(group.start, geometry.drawRange.start);
    const end = Math.min(group.start + group.count, geometry.drawRange.start + geometry.drawRange.count, count);
    if (start >= end) continue;
    const indices = Uint32Array.from({ length: end - start }, (_, i) => geometry.index?.getX(start + i) ?? start + i);
    const faces = simplify(geometry, indices, detail);
    for (let k = 0; k < faces.length; k++) {
      const i = faces[k]!;
      let mapped = remap.get(i);
      if (mapped === undefined) { mapped = sources.length; remap.set(i, mapped); sources.push(i); }
      corners.push(mapped);
    }
    for (let k = 0; k + 2 < faces.length; k += 3) {
      const i = faces[k]!, j = faces[k + 1]!, l = faces[k + 2]!;
      a.fromBufferAttribute(position, i);
      b.fromBufferAttribute(position, j).sub(a);
      c.fromBufferAttribute(position, l).sub(a);
      b.cross(c).normalize();
      normals.push(b.x, b.y, b.z);
      if (colour) colours.push((colour.getX(i) + colour.getX(j) + colour.getX(l)) / 3,
        (colour.getY(i) + colour.getY(j) + colour.getY(l)) / 3,
        (colour.getZ(i) + colour.getZ(j) + colour.getZ(l)) / 3);
      materials.push(group.materialIndex ?? 0);
    }
  }
  const result: SoftwareGeometry = { sources: Uint32Array.from(sources), corners: Uint32Array.from(corners),
    normals: Float32Array.from(normals), colours: colour ? Float32Array.from(colours) : undefined,
    materials: Uint16Array.from(materials) };
  levels.set(detail, result);
  return result;
}
