import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { sectionCenter, type AccessSection } from './access-path';
import type { Vec3 } from './types';

function pathSurface(sections: readonly AccessSection[], thickness: number, smooth = false): THREE.BufferGeometry {
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
  return smooth ? toCreasedNormals(geometry, Math.PI / 7) : geometry;
}

interface PaintedPart {
  geometry: THREE.BufferGeometry;
  color: number;
}

const lerpPoint = (a: Vec3, b: Vec3, amount: number): Vec3 => ({
  x: a.x + (b.x - a.x) * amount,
  y: a.y + (b.y - a.y) * amount,
  z: a.z + (b.z - a.z) * amount,
});

/** Sample the same two triangles as the rendered deck. */
function deckPoint(a: AccessSection, b: AccessSection, across: number, along: number): Vec3 {
  if (across >= along) {
    const diagonal = lerpPoint(a.outer, b.inner, along);
    return lerpPoint(diagonal, lerpPoint(a.inner, b.inner, along), (across - along) / (1 - along));
  }
  const edge = lerpPoint(a.outer, b.outer, along);
  return lerpPoint(edge, lerpPoint(a.outer, b.inner, along), across / along);
}

type DeckCoordinate = readonly [across: number, along: number];

/** Split the paint along the same diagonal as a turning ramp's two top faces. */
function clipPaintToDeckFace(triangle: readonly DeckCoordinate[], side: 1 | -1): DeckCoordinate[] {
  const face: DeckCoordinate[] = [];
  for (let i = 0; i < triangle.length; i++) {
    const a = triangle[i]!, b = triangle[(i + 1) % triangle.length]!;
    const from = side * (a[0] - a[1]), to = side * (b[0] - b[1]);
    if (from >= 0) face.push(a);
    if (from * to < 0) {
      const t = from / (from - to);
      const crossing = THREE.MathUtils.lerp(a[0], b[0], t);
      face.push([crossing, crossing]);
    }
  }
  return face;
}

/** Painted chevrons lead the player forward around corners without another draw. */
export function accessArrows(sections: readonly AccessSection[], scale: number, color: number): PaintedPart {
  const vertices: number[] = [];
  let remaining = 1.35 * scale;
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1]!, b = sections[i]!;
    const start = sectionCenter(a), end = sectionCenter(b);
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    const half = .48 * scale / Math.hypot(a.inner.x - a.outer.x, a.inner.z - a.outer.z);
    const depth = Math.min(.48, .55 * scale / length);
    for (; remaining < length; remaining += 4.6 * scale) {
      const t = Math.max(depth, Math.min(1 - depth, remaining / length));
      const vertex = ([u, v]: DeckCoordinate): void => {
        const p = deckPoint(a, b, u, v);
        vertices.push(p.x, p.y + .028 * scale, p.z);
      };
      const tip: DeckCoordinate = [.5, t + depth];
      const notch: DeckCoordinate = [.5, t + depth * .20];
      const wings: DeckCoordinate[][] = [
        [[.5 - half, t - depth], tip, notch],
        [tip, [.5 + half, t - depth], notch],
      ];
      for (const wing of wings) for (const side of [1, -1] as const) {
        const face = clipPaintToDeckFace(wing, side);
        for (let index = 1; index < face.length - 1; index++) {
          vertex(face[0]!);
          vertex(face[index]!);
          vertex(face[index + 1]!);
        }
      }
    }
    remaining -= length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return { geometry, color };
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
  const panels = paths.map(path => pathSurface(path, thickness, true));
  const heights = [.9, .24];
  const bars = guards.flatMap(path => heights.map(drop => pathSurface(path.map(({ outer, inner }) => ({
    outer: { ...outer, y: outer.y - drop * scale },
    inner: { ...inner, y: inner.y - drop * scale },
  })), .15 * scale)));
  const post = (point: Vec3): void => {
    const height = 1.22 * scale;
    bars.push(new THREE.BoxGeometry(.17 * scale, height, .17 * scale)
      .translate(point.x, point.y - height / 2, point.z));
  };
  for (const path of guards) {
    const spacing = 2.7 * scale;
    let remaining = spacing;
    post(path[0]!.outer);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!.outer, b = path[i]!.outer;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      for (; remaining < length - .14 * scale; remaining += spacing) {
        post(lerpPoint(a, b, remaining / length));
      }
      remaining -= length;
      if (remaining <= 0) {
        post(b);
        remaining += spacing;
      }
    }
    if (remaining < spacing - .14 * scale) post(path.at(-1)!.outer);
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
