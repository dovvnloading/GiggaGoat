import * as THREE from 'three';
import { SeededRandom } from './random';
import { TOON_RAMP } from './visual-props';
import type { IslandData, Vec2 } from './types';

/** Flat, non-colliding details, in world X/Z metres. All outlines are convex. */
export interface PavementPatch {
  outline: readonly Vec2[];
  color: number;
  opacity: number;
}

const cross = (a: Vec2, b: Vec2, p: Vec2) =>
  (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);

function clip(outline: readonly Vec2[], a: Vec2, b: Vec2, sign: number): Vec2[] {
  const result: Vec2[] = [];
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]!, q = outline[(i + 1) % outline.length]!;
    const u = cross(a, b, p) * sign, v = cross(a, b, q) * sign;
    if (u >= 0) result.push(p);
    if ((u < 0) !== (v < 0)) {
      const t = u / (u - v);
      result.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return result;
}

function bounds(points: readonly Vec2[]) {
  return {
    minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minZ: Math.min(...points.map(p => p.z)), maxZ: Math.max(...points.map(p => p.z)),
  };
}

/**
 * Clip each decal against the actual indexed surface triangles, interpolating
 * their heights instead of sampling the terrain underneath. This keeps marks
 * seated on graded asphalt, sidewalks and concrete at any terrain resolution.
 * Source geometries in the world renderer use world-space positions.
 */
export function projectPavementPatches(
  surface: THREE.BufferGeometry, patches: readonly PavementPatch[], lift: number,
): THREE.BufferGeometry {
  const pos = surface.getAttribute('position'), index = surface.index;
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const triangles: {
    a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; area: number;
    box: ReturnType<typeof bounds>;
  }[] = [];
  const count = index?.count ?? pos.count;
  for (let i = 0; i + 2 < count; i += 3) {
    const vertex = (j: number) => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(j) : j);
    const a = vertex(i), b = vertex(i + 1), c = vertex(i + 2);
    const area = cross(a, b, c);
    // Vertical kerb sides and road skirts have no projected surface.
    if (Math.abs(area) > 1e-8) triangles.push({ a, b, c, area, box: bounds([a, b, c]) });
  }
  // Preserve patch order (rim, cover, slats) within one merged draw.
  for (const patch of patches) {
    const box = bounds(patch.outline), color = new THREE.Color(patch.color);
    for (const { a, b, c, area, box: triangleBox } of triangles) {
      if (box.maxX <= triangleBox.minX || box.minX >= triangleBox.maxX ||
          box.maxZ <= triangleBox.minZ || box.minZ >= triangleBox.maxZ) continue;
      const sign = Math.sign(area);
      const polygon = clip(clip(clip(patch.outline, a, b, sign), b, c, sign), c, a, sign);
      if (polygon.length < 3) continue;
      const first = positions.length / 3;
      for (const p of polygon) {
        const u = cross(a, p, c) / area, v = cross(a, b, p) / area;
        positions.push(p.x, a.y + u * (b.y - a.y) + v * (c.y - a.y) + lift, p.z);
        colors.push(color.r, color.g, color.b, patch.opacity);
      }
      for (let i = 1; i + 1 < polygon.length; i++) {
        const winding = cross(polygon[0]!, polygon[i]!, polygon[i + 1]!);
        if (Math.abs(winding) < 1e-10) continue;
        if (winding > 0) indices.push(first, first + i + 1, first + i);
        else indices.push(first, first + i, first + i + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Local authored dimensions scale with the island; seed only varies the wear. */
function painter(center: Vec2, scale: number) {
  const patches: PavementPatch[] = [];
  const polygon = (points: readonly (readonly [number, number])[], color: number, opacity: number) =>
    patches.push({ outline: points.map(([x, z]) => ({
      x: center.x + x * scale, z: center.z + z * scale,
    })), color, opacity });
  const rect = (x: number, z: number, w: number, l: number, color: number, opacity: number, yaw = 0) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    polygon(([[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]] as const)
      .map(([u, v]) => [x + c * u + s * v, z - s * u + c * v] as const), color, opacity);
  };
  const disc = (x: number, z: number, rx: number, rz: number, color: number, opacity: number, phase = 0) =>
    polygon(Array.from({ length: 12 }, (_, i) => {
      const a = i * Math.PI / 6 + phase;
      return [x + Math.cos(a) * rx, z + Math.sin(a) * rz] as const;
    }), color, opacity);
  const drain = (x: number, z: number) => {
    rect(x, z, .72, .94, 0x343c3d, .84);
    rect(x, z, .61, .83, 0x858b87, .88);
    for (let i = -3; i <= 3; i++) rect(x, z + i * .104, .49, .046, 0x242b2c, .94);
  };
  const hatch = (x: number, z: number) => {
    disc(x, z, .48, .48, 0x333a3a, .88);
    disc(x, z, .405, .405, 0x777c78, .95);
    for (let j = -2; j <= 2; j++) {
      rect(x, z + j * .115, j % 2 === 0 ? .48 : .55, .025, 0x343b39, .8);
    }
  };
  return { patches, rect, polygon, disc, drain, hatch };
}

function apronWear(center: Vec2, scale: number, seed: string) {
  const p = painter(center, scale), rng = new SeededRandom(seed + ':apron-wear');
  // The existing 8 m slab grid remains intact. Sealant and a pale worn edge
  // describe the joints without cutting holes or changing the collision floor.
  for (let x = -32; x <= 32; x += 8) {
    p.rect(x + .065, 0, .038, 71.7, 0xc7c1b7, .33);
    p.rect(x, 0, .055, 71.7, 0x514e49, .57);
  }
  for (let z = -28; z <= 28; z += 8) {
    p.rect(0, z + .065, 79.7, .038, 0xc7c1b7, .33);
    p.rect(0, z, 79.7, .055, 0x514e49, .57);
  }
  // Maintenance repairs and grease spots near working areas, not uniformly
  // scattered grime. Low contrast keeps the original yellow route paint legible.
  for (const [x, z] of [[-22, 9], [26, -16], [19, 12], [-14, -18], [29, 23]] as const) {
    p.polygon([[-1.2, -.45], [-.45, -.8], [.95, -.63], [1.38, .16], [.6, .78], [-.9, .6]]
      .map(([u, v]) => [x + u!, z + v!] as const), 0x77746d, .21);
    for (let i = 0; i < 5; i++) {
      p.disc(x + rng.range(-.8, .8), z + rng.range(-.45, .45),
        rng.range(.12, .39), rng.range(.09, .25), 0x514b41, rng.range(.12, .25), rng.next());
    }
  }
  // Paired rubber scuffs on the gate approaches, broken into softly tinted
  // segments rather than ruler-straight black stripes.
  for (const [x, z] of [[20, 23], [-4, -23], [24, -5]] as const) {
    for (const side of [-1, 1]) for (let j = 0; j < 8; j++) {
      p.rect(x + side * 1.05 + .13 * Math.sin(j * .6), z + j * .72 - 2.5,
        rng.range(.17, .25), .64, 0x494842, .10 + .14 * Math.sin((j + 1) * Math.PI / 9), .06);
    }
  }
  for (const x of [-37.5, 37.5]) for (const z of [-23, 1, 25]) p.drain(x, z);
  p.hatch(27, 5); p.hatch(-21, -15);
  // Stencilled bay IDs aligned with the existing loading stripe row. Their
  // seven-segment geometry works in the headless/software renderer too.
  const digits = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgecd', 'abc', 'abcdefg', 'abfgcd'];
  const stroke = (x: number, z: number, digit: number) => {
    const paint = (u: number, v: number, w: number, l: number) =>
      p.rect(x + u, z + v, w, l, 0xe3c36c, .76);
    const on = (segment: string) => digits[digit]!.includes(segment);
    if (on('a')) paint(0, -.37, .36, .065);
    if (on('g')) paint(0, 0, .36, .065);
    if (on('d')) paint(0, .37, .36, .065);
    if (on('f')) paint(-.19, -.18, .065, .29);
    if (on('b')) paint(.19, -.18, .065, .29);
    if (on('e')) paint(-.19, .18, .065, .29);
    if (on('c')) paint(.19, .18, .065, .29);
  };
  for (let i = 0; i < 6; i++) {
    const x = -27 + i * 8.6;
    stroke(x - .25, 20.15, 0); stroke(x + .25, 20.15, i + 1);
  }
  return p.patches;
}

function streetWear(center: Vec2, scale: number, seed: string, city: boolean) {
  const p = painter(center, scale), rng = new SeededRandom(seed + (city ? ':city-street' : ':village-street'));
  const edge = city ? 4.55 : 3.4;
  // Leave junctions and zebra crossings readable. Drain covers sit at the
  // carriageway edge; maintenance lids and repairs stay away from centre dashes.
  for (const side of [-1, 1]) for (const z of [-34, -8, 15, 36]) {
    p.drain(side * (edge - .48), z);
    const x = side * (city ? 2.1 : 1.55), at = z + 2.6;
    p.polygon([[x - .55, at - .73], [x + .53, at - .67], [x + .64, at + .18],
      [x + .26, at + .85], [x - .61, at + .66]], 0x454e52, rng.range(.21, .34));
  }
  for (const z of [-25, 2, 23]) p.hatch((z === 2 ? -1 : 1) * (edge * .48), z);
  return p.patches;
}

function sidewalkWear(center: Vec2, scale: number, seed: string) {
  const p = painter(center, scale), rng = new SeededRandom(seed + ':sidewalk-debris');
  // Subtle concrete slab divisions and inspection lids in the walking band.
  for (const side of [-1, 1]) {
    for (let z = -41; z < 42; z += 2.3) {
      p.rect(side * 5.92, z, 1.91, .035, 0x686359, .45);
    }
    // Gutter-side leaf drifts and occasional folded paper scraps, rather
    // than evenly peppered random litter across the walking band.
    for (const z of [-35, -14, 4, 16, 32]) {
      for (let i = 0; i < 8; i++) {
        const x = side * (5.12 + rng.range(0, .36)), at = z + rng.range(-.65, .65);
        const l = rng.range(.12, .29), yaw = rng.range(0, Math.PI * 2);
        p.rect(x, at, l * .42, l, rng.pick([0x9f7f46, 0xb89b61, 0x8c7753]), rng.range(.40, .72), yaw);
      }
      const x = side * 5.38;
      p.polygon([[x - .09, z + .31], [x + .12, z + .35], [x + .08, z + .51], [x - .07, z + .46]],
        0xc5c3b2, .67);
    }
    for (const z of [-31, -4, 19, 38]) {
      p.rect(side * 6.09, z, .55, .68, 0x555b57, .65);
      p.rect(side * 6.09, z, .47, .59, 0x9b9c90, .85);
      p.rect(side * 6.09, z, .26, .035, 0x4f5551, .8);
    }
  }
  return p.patches;
}

/** Four small, frustum-culled batches, with no new assets, lights or colliders. */
export function buildPavementDetails(
  island: IslandData, ground: THREE.Group, streets: THREE.Group, roads: THREE.Group,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lived-in-pavement';
  const scale = island.size / 600, seed = String(island.seed);
  const material = new THREE.MeshToonMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    gradientMap: TOON_RAMP, side: THREE.DoubleSide,
  });
  const add = (source: THREE.Object3D | undefined, name: string, patches: PavementPatch[]) => {
    if (!(source instanceof THREE.Mesh)) return;
    const geometry = projectPavementPatches(source.geometry, patches, .004 * scale);
    if (!geometry.index?.count) { geometry.dispose(); return; }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = source.receiveShadow;
    // Draw before other transparent surfaces (notably the existing puddles).
    mesh.renderOrder = -1;
    group.add(mesh);
  };
  const yard = island.pois.find(p => p.id === 'crane-yard')?.center;
  const city = island.pois.find(p => p.id === 'downtown-bleatsville')?.center;
  const village = island.pois.find(p => p.id === 'hoofington')?.center;
  if (yard) add(ground.getObjectByName('ground-detail-crane-apron'),
    'crane-apron-joints-and-wear', apronWear(yard, scale, seed));
  const asphalt = roads.getObjectByName('paths-road');
  if (city) {
    add(asphalt, 'downtown-road-maintenance', streetWear(city, scale, seed, true));
    add(streets.getObjectByName('paved-village-sidewalks'),
      'downtown-sidewalk-joints-and-utility-lids', sidewalkWear(city, scale, seed));
  }
  if (village) add(asphalt, 'hoofington-road-maintenance', streetWear(village, scale, seed, false));
  if (!group.children.length) material.dispose();
  return group;
}
