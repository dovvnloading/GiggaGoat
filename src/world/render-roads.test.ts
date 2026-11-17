import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland } from './index';
import { makeLocalStreets } from './roads';
import { isDowntownRoadOverlay, isHoofingtonTrailOverlay } from './render';
import type { IslandData, RoadPoint } from './types';
import { TOON_RAMP } from './visual-props';

type Surface = 'road' | 'trail';
interface Run { points: RoadPoint[]; width: number }

/** Independently apply the unchanged per-segment visual exclusions. */
function keptRuns(island: IslandData, type: Surface): Run[] {
  const runs: Run[] = [];
  for (const road of [...island.roads, ...makeLocalStreets(island)]) {
    if (road.type !== type) continue;
    let points: RoadPoint[] = [];
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i]!, b = road.points[i + 1]!;
      const keep = !isDowntownRoadOverlay(island, road.id, a, b) &&
        !(type === 'trail' && isHoofingtonTrailOverlay(island, road.width, a, b));
      if (keep) {
        if (!points.length) points.push(a);
        points.push(b);
      } else {
        if (points.length > 1) runs.push({ points, width: road.width });
        points = [];
      }
    }
    if (points.length > 1) runs.push({ points, width: road.width });
  }
  return runs;
}

function inspectRibbon(island: IslandData, group: THREE.Group, type: Surface): void {
  const found = group.children.filter(child => child.name === 'paths-' + type);
  expect(found).toHaveLength(1);
  const mesh = found[0]!;
  expect(mesh).toBeInstanceOf(THREE.Mesh);
  expect(mesh).not.toBeInstanceOf(THREE.InstancedMesh);
  const surface = mesh as THREE.Mesh;
  expect(surface.geometry).toBeInstanceOf(THREE.BufferGeometry);
  expect(surface.geometry).not.toBeInstanceOf(THREE.BoxGeometry);
  expect(surface.receiveShadow).toBe(true);
  expect(surface.material).toBeInstanceOf(THREE.MeshToonMaterial);
  const material = surface.material as THREE.MeshToonMaterial;
  expect(material.gradientMap).toBe(TOON_RAMP);
  expect(material.color.getHex()).toBe(type === 'road' ? 0x727e8a : 0xc3a06c);

  const runs = keptRuns(island, type);
  const segments = runs.reduce((sum, run) => sum + run.points.length - 1, 0);
  const positions = surface.geometry.getAttribute('position');
  const normals = surface.geometry.getAttribute('normal');
  const indices = surface.geometry.getIndex()!;
  expect(indices.count / 3).toBe(6 * segments);
  expect(positions.count).toBe(6 * runs.reduce((sum, run) => sum + run.points.length, 0));
  const lift = type === 'road' ? 0.2 : 0.19;
  let vertex = 0, index = 0;

  for (const run of runs) {
    const first = vertex;
    for (const point of run.points) {
      const lx = positions.getX(vertex), lz = positions.getZ(vertex);
      const rx = positions.getX(vertex + 1), rz = positions.getZ(vertex + 1);
      // Each segment connects to the identical left/right edge at a joint.
      expect((lx + rx) / 2).toBeCloseTo(point.x, 3);
      expect((lz + rz) / 2).toBeCloseTo(point.z, 3);
      const mitre = Math.hypot(lx - point.x, lz - point.z) / (run.width / 2);
      expect(mitre).toBeGreaterThanOrEqual(0.999);
      expect(mitre).toBeLessThanOrEqual(2.001);
      for (const side of [0, 1, 2, 3]) {
        expect(positions.getY(vertex + side)).toBeCloseTo(point.y + lift, 4);
      }
      for (const side of [4, 5]) {
        expect(positions.getY(vertex + side)).toBeCloseTo(point.y - 0.15, 4);
      }
      // Skirt top coordinates coincide with the asphalt edge, but have
      // independent normals so no side-facing normal leaks into the top.
      expect(positions.getX(vertex + 2)).toBe(lx);
      expect(positions.getZ(vertex + 2)).toBe(lz);
      expect(positions.getX(vertex + 3)).toBe(rx);
      expect(positions.getZ(vertex + 3)).toBe(rz);
      expect(normals.getY(vertex)).toBeGreaterThan(0);
      expect(normals.getY(vertex + 1)).toBeGreaterThan(0);
      vertex += 6;
    }
    let priorLeft = -1, priorRight = -1;
    for (let i = 0; i < run.points.length - 1; i++) {
      const startLeft = indices.getX(index);
      const endLeft = indices.getX(index + 1);
      const startRight = indices.getX(index + 2);
      const endRight = indices.getX(index + 5);
      expect(startLeft).toBe(first + i * 6);
      expect(startRight).toBe(first + i * 6 + 1);
      expect(endLeft).toBe(first + (i + 1) * 6);
      expect(endRight).toBe(first + (i + 1) * 6 + 1);
      if (i > 0) {
        expect(startLeft).toBe(priorLeft);
        expect(startRight).toBe(priorRight);
      }
      priorLeft = endLeft;
      priorRight = endRight;
      index += 18; // 2 top + 2 left skirt + 2 right skirt triangles
    }
  }
  expect(vertex).toBe(positions.count);
  expect(index).toBe(indices.count);
}

function isCrossingDash(island: IslandData, a: RoadPoint, b: RoadPoint): boolean {
  const farm = island.pois.find(p => p.id === 'hoofington')?.center;
  if (!farm) return false;
  const scale = island.size / 600;
  return Math.abs((a.x + b.x) / 2 - farm.x) < 3.4 * scale + 1.3 &&
    Math.abs((a.z + b.z) / 2 - (farm.z - 18 * scale)) < 3.25 * scale + 1.3;
}

describe('IS-6 joined road/trail visual ribbons', () => {
  it('merges kept runs per type with six triangles per segment and shared mitred joints', () => {
    for (const [seed, size] of [
      ['billy-isle', 600], ['ribbon-curves', 400], ['ribbon-alt', 900],
    ] as const) {
      const island = generateIsland({ seed, size, resolution: 65 });
      const scene = createWorldScene(island, { chunkSegments: 16 });
      try {
        const group = scene.group.getObjectByName('graded-ring-road-and-trails');
        expect(group).toBeInstanceOf(THREE.Group);
        const roads = group as THREE.Group;
        inspectRibbon(island, roads, 'road');
        inspectRibbon(island, roads, 'trail');
        // Two ribbon draw calls plus the original one for instanced dashes.
        expect(roads.children.map(child => child.name).sort()).toEqual([
          'paths-road', 'paths-trail', 'road-centre-dashes',
        ].sort());
      } finally {
        scene.dispose();
      }
    }
  });

  it('keeps the every-fifth-segment dash spacing, crossing exclusion, and 1 cm clearance', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const scene = createWorldScene(island, { chunkSegments: 16 });
    try {
      const runs = keptRuns(island, 'road');
      const kept = runs.flatMap(run => run.points.slice(1).map((b, i) =>
        ({ a: run.points[i]!, b })));
      const marked = kept.filter((segment, i) => i % 5 === 0 &&
        !isCrossingDash(island, segment.a, segment.b));
      const dashes = scene.group.getObjectByName('road-centre-dashes');
      expect(dashes).toBeInstanceOf(THREE.InstancedMesh);
      const mesh = dashes as THREE.InstancedMesh;
      expect(mesh.count).toBe(marked.length);
      const matrix = new THREE.Matrix4();
      const centre = new THREE.Vector3(), rotation = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      for (let i = 0; i < marked.length; i++) {
        const { a, b } = marked[i]!;
        mesh.getMatrixAt(i, matrix);
        matrix.decompose(centre, rotation, scale);
        expect(centre.x).toBeCloseTo((a.x + b.x) / 2, 4);
        expect(centre.z).toBeCloseTo((a.z + b.z) / 2, 4);
        const clearance = centre.y - ((a.y + b.y) / 2 + 0.2);
        expect(clearance).toBeCloseTo(0.01, 4);
        expect(clearance).toBeGreaterThan(0);
        expect(clearance).toBeLessThan(0.02);
        expect(scale.y).toBeCloseTo(0.01, 5);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
        const segment = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
        expect(forward.dot(segment)).toBeGreaterThan(0.6);
      }
    } finally {
      scene.dispose();
    }
  });

  it('splits one filtered polyline into separate flat-ended runs without changing roads', () => {
    const island = generateIsland({ seed: 'ribbon-split', resolution: 65 });
    const downtown = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    island.roads = [{
      id: 'hoofington--downtown-bleatsville',
      from: 'hoofington', to: 'downtown-bleatsville', type: 'road', width: 5,
      points: [-70, -55, -20, 0, 20, 55, 70].map((z, i) => ({
        x: downtown.x + 10, y: i * 0.5, z: downtown.z + z, bridge: false,
      })),
    }];
    const originalRoad = JSON.stringify(island.roads);
    const special = keptRuns(island, 'road').filter(run => run.width === 5);
    expect(special.map(run => run.points.length)).toEqual([2, 2]);
    const scene = createWorldScene(island, { chunkSegments: 16 });
    try {
      const group = scene.group.getObjectByName('graded-ring-road-and-trails') as THREE.Group;
      inspectRibbon(island, group, 'road');
      inspectRibbon(island, group, 'trail');
      expect(JSON.stringify(island.roads)).toBe(originalRoad);
    } finally {
      scene.dispose();
    }
  });
});
