import * as THREE from 'three';
import { union, type Polygon } from 'polygon-clipping';

type Point = { x: number; z: number };

/** Replace overlapping summit triangles with a single rendered and physical surface. */
export function addSummitJunction(
  positions: number[], indices: number[], support: number[], skirts: number[],
  faces: readonly number[], cuts: readonly [number, number][], anchors: readonly Point[],
  height: (x: number, z: number) => number,
  ground: ((x: number, z: number) => number) | undefined, scale: number,
): void {
  const shapes: Polygon[] = [];
  for (let i = 0; i < faces.length; i += 3) {
    const corners = faces.slice(i, i + 3).map(index => [positions[index * 3]!, positions[index * 3 + 2]!] as [number, number]);
    const [a, b, c] = corners;
    if (Math.abs((b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0])) < 1e-8) continue;
    shapes.push([[...corners, corners[0]!]]);
  }
  if (shapes.length === 0) return;
  const merged = union(shapes[0]!, ...shapes.slice(1));
  const onCut = (a: Point, b: Point): boolean => cuts.some(([first, second]) => {
    const x = positions[first * 3]!, z = positions[first * 3 + 2]!;
    const dx = positions[second * 3]! - x, dz = positions[second * 3 + 2]! - z;
    const length2 = dx * dx + dz * dz;
    const on = (p: Point): boolean => {
      const t = ((p.x - x) * dx + (p.z - z) * dz) / length2;
      return t >= -1e-6 && t <= 1 + 1e-6 && Math.abs((p.x - x) * dz - (p.z - z) * dx) < 1e-5;
    };
    return length2 > 1e-8 && on(a) && on(b);
  });
  for (const polygon of merged) {
    const rings = polygon.map(ring => ring.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z)));
    const contour = rings[0];
    if (!contour || contour.length < 3) continue;
    const vertices = rings.flat();
    const start = positions.length / 3;
    for (const p of vertices) positions.push(p.x, height(p.x, p.y), p.y);
    const triangles: [number, number, number][] = [];
    for (const triangle of THREE.ShapeUtils.triangulateShape(contour, rings.slice(1))) {
      let [a, b, c] = triangle.map(index => start + index) as [number, number, number];
      const cross = (positions[b * 3]! - positions[a * 3]!) * (positions[c * 3 + 2]! - positions[a * 3 + 2]!) -
        (positions[b * 3 + 2]! - positions[a * 3 + 2]!) * (positions[c * 3]! - positions[a * 3]!);
      if (cross > 0) [b, c] = [c, b];
      triangles.push([a, b, c]);
    }
    // Keep the original graded centre lines as interior control points.
    // A tiny offset avoids placing a sample exactly on an existing diagonal.
    for (const anchor of anchors) {
      const x = anchor.x + .0017 * scale, z = anchor.z + .0011 * scale;
      const triangle = triangles.findIndex(([a, b, c]) => {
        const ax = positions[a * 3]! - positions[c * 3]!, az = positions[a * 3 + 2]! - positions[c * 3 + 2]!;
        const bx = positions[b * 3]! - positions[c * 3]!, bz = positions[b * 3 + 2]! - positions[c * 3 + 2]!;
        const dx = x - positions[c * 3]!, dz = z - positions[c * 3 + 2]!;
        const area = ax * bz - bx * az;
        if (Math.abs(area) < 1e-10) return false;
        const u = (dx * bz - bx * dz) / area, v = (ax * dz - dx * az) / area;
        return Math.min(u, v, 1 - u - v) > 1e-8;
      });
      if (triangle < 0) continue;
      const [a, b, c] = triangles[triangle]!;
      const p = positions.length / 3;
      positions.push(x, height(x, z), z);
      triangles.splice(triangle, 1, [a, b, p], [b, c, p], [c, a, p]);
    }
    for (const triangle of triangles) {
      indices.push(...triangle);
      support.push(...triangle);
    }
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      if (onCut({ x: a.x, z: a.y }, { x: b.x, z: b.y })) continue;
      const ay = height(a.x, a.y), by = height(b.x, b.y);
      const bottom = (p: THREE.Vector2, y: number) => {
        const terrain = ground?.(p.x, p.y);
        return terrain !== undefined && Number.isFinite(terrain) ? Math.min(y - .34, terrain - .12 * scale) : y - .34;
      };
      const first = positions.length / 3;
      positions.push(a.x, ay, a.y, a.x, bottom(a, ay), a.y, b.x, by, b.y, b.x, bottom(b, by), b.y);
      skirts.push(first, first + 1, first + 2, first + 3);
      indices.push(first, first + 1, first + 2, first + 2, first + 1, first + 3);
    }
  }
}
