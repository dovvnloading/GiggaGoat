import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AccessSection } from './access-path';
import type { Vec3 } from './types';

function pathSurface(sections: readonly AccessSection[], thickness: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const vertex = (point: Vec3, lift = 0): void => {
    positions.push(point.x, point.y + lift, point.z);
  };
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1]!, b = sections[i]!;
    vertex(a.outer); vertex(a.inner); vertex(b.inner);
    vertex(a.outer); vertex(b.inner); vertex(b.outer);
    for (const side of ['outer', 'inner'] as const) {
      vertex(a[side]); vertex(b[side]); vertex(b[side], -thickness);
      vertex(a[side]); vertex(b[side], -thickness); vertex(a[side], -thickness);
    }
  }
  for (const end of [sections[0]!, sections.at(-1)!]) {
    vertex(end.outer); vertex(end.inner); vertex(end.inner, -thickness);
    vertex(end.outer); vertex(end.inner, -thickness); vertex(end.outer, -thickness);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

interface PaintedPart {
  geometry: THREE.BufferGeometry;
  color: number;
}

function bakeColor({ geometry, color }: PaintedPart): THREE.BufferGeometry {
  const plain = geometry.index ? geometry.toNonIndexed() : geometry;
  if (plain !== geometry) geometry.dispose();
  plain.deleteAttribute('uv');
  const paint = new THREE.Color(color);
  const count = plain.getAttribute('position').count;
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) paint.toArray(values, i * 3);
  plain.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return plain;
}

export function mergePaintedParts(parts: readonly PaintedPart[]): THREE.BufferGeometry {
  const prepared = parts.map(bakeColor);
  const geometry = mergeGeometries(prepared, false);
  for (const part of prepared) part.dispose();
  if (!geometry) throw new Error('Could not merge the painted access geometry');
  return geometry;
}

export function accessPathVisual(name: string, paths: readonly AccessSection[][],
  guards: readonly AccessSection[][], thickness: number, scale: number, deck: number, rail: number,
  architecture: readonly PaintedPart[] = []): THREE.Mesh {
  const panels = paths.map(path => pathSurface(path, thickness));
  const heights = [.9, .24];
  const bars = guards.flatMap(path => heights.map(drop => pathSurface(path.map(({ outer, inner }) => ({
    outer: { ...outer, y: outer.y - drop * scale },
    inner: { ...inner, y: inner.y - drop * scale },
  })), .15 * scale)));
  for (const path of guards) {
    let length = 0;
    for (let i = 0; i < path.length; i++) {
      const point = path[i]!.outer;
      const previous = path[i - 1]?.outer ?? point;
      length += Math.hypot(point.x - previous.x, point.z - previous.z);
      if (i > 0 && i < path.length - 1 && length < 2.7 * scale) continue;
      const height = 1.22 * scale;
      bars.push(new THREE.BoxGeometry(.17 * scale, height, .17 * scale)
        .translate(point.x, point.y - height / 2, point.z));
      length = 0;
    }
  }
  const parts = [
    ...panels.map(geometry => ({ geometry, color: deck })),
    ...bars.map(geometry => ({ geometry, color: rail })),
    ...architecture,
  ];
  const mesh = new THREE.Mesh(mergePaintedParts(parts),
    new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, vertexColors: true }));
  mesh.name = name;
  mesh.receiveShadow = true;
  return mesh;
}
