import * as THREE from 'three';
import { LANTERN_HEIGHT } from '../world/lantern';

type Vertex = { point: THREE.Vector3; normal: THREE.Vector3 };

function clipHeight(face: Vertex[], y: number, keepAbove: boolean): Vertex[] {
  const result: Vertex[] = [];
  for (let i = 0; i < face.length; i++) {
    const a = face[i]!, b = face[(i + 1) % face.length]!;
    const inside = keepAbove ? a.point.y >= y : a.point.y <= y;
    if (inside) result.push(a);
    if (Math.min(a.point.y, b.point.y) < y && Math.max(a.point.y, b.point.y) > y) {
      const fraction = (y - a.point.y) / (b.point.y - a.point.y);
      result.push({ point: a.point.clone().lerp(b.point, fraction),
        normal: a.normal.clone().lerp(b.normal, fraction).normalize() });
    }
  }
  return result;
}

/** Cut the existing untextured ironwork, glass and pennant at the physics fracture planes. */
export function cutLanternSection(model: THREE.Object3D, index: number, count: number): THREE.Group {
  const low = LANTERN_HEIGHT * index / count, high = LANTERN_HEIGHT * (index + 1) / count;
  const center = (low + high) / 2;
  const section = new THREE.Group();
  model.updateWorldMatrix(true, true);
  model.traverse(part => {
    if (!(part instanceof THREE.Mesh)) return;
    const geometry = part.geometry, indices = geometry.getIndex();
    const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    const normalsToWorld = new THREE.Matrix3().getNormalMatrix(part.matrixWorld);
    const points: number[] = [], normals: number[] = [];
    for (let i = 0; i < (indices?.count ?? position.count); i += 3) {
      const face = [i, i + 1, i + 2].map(offset => {
        const vertex = indices ? indices.getX(offset) : offset;
        return { point: new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(part.matrixWorld),
          normal: new THREE.Vector3().fromBufferAttribute(normal, vertex).applyNormalMatrix(normalsToWorld) };
      });
      const polygon = clipHeight(clipHeight(face, low, true), high, false);
      for (let j = 1; j + 1 < polygon.length; j++) {
        for (const v of [polygon[0]!, polygon[j]!, polygon[j + 1]!]) {
          points.push(v.point.x, v.point.y - center, v.point.z);
          normals.push(v.normal.x, v.normal.y, v.normal.z);
        }
      }
    }
    if (!points.length) return;
    const clipped = new THREE.BufferGeometry();
    clipped.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    clipped.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    clipped.computeBoundingSphere();
    const piece = new THREE.Mesh(clipped, part.material);
    piece.castShadow = true; piece.receiveShadow = true;
    section.add(piece);
  });
  return section;
}
