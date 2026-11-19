import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland } from './index';
import { roadRibbonRuns } from './road-ribbons';
import { getDamPlacement } from './the-dam';
import type { IslandData, RoadPoint } from './types';
import { TOON_RAMP } from './visual-props';

type Surface = 'road' | 'trail';

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

  const runs = roadRibbonRuns(island, type);
  const segments = runs.reduce((sum, run) => sum + run.points.length - 1, 0);
  const positions = surface.geometry.getAttribute('position');
  const crossSections = surface.geometry.getAttribute('roadCrossSection');
  if (type === 'road') expect(crossSections.count).toBe(positions.count);
  else expect(crossSections).toBeUndefined();
  const normals = surface.geometry.getAttribute('normal');
  const indices = surface.geometry.getIndex()!;
  expect(indices.count / 3).toBe(6 * segments);
  expect(positions.count).toBe(6 * runs.reduce((sum, run) => sum + run.points.length, 0));
  const lift = type === 'road' ? 0.2 : 0.19;
  const damTrailEnd = island.roads.find(road => road.id === 'mt-gigga--the-dam')?.points.at(-1);
  let vertex = 0, index = 0;

  for (const run of runs) {
    const first = vertex;
    for (const [pointIndex, point] of run.points.entries()) {
      const lx = positions.getX(vertex), lz = positions.getZ(vertex);
      const rx = positions.getX(vertex + 1), rz = positions.getZ(vertex + 1);
      // Each segment connects to the identical left/right edge at a joint.
      expect((lx + rx) / 2).toBeCloseTo(point.x, 3);
      expect((lz + rz) / 2).toBeCloseTo(point.z, 3);
      const mitre = Math.hypot(lx - point.x, lz - point.z) / ((run.widths?.[pointIndex] ?? run.width) / 2);
      expect(mitre).toBeGreaterThanOrEqual(0.999);
      expect(mitre).toBeLessThanOrEqual(2.001);
      const damTerminal = type === 'trail' && run.points.at(-1) === damTrailEnd &&
        pointIndex >= run.points.length - 2;
      for (const side of [0, 1]) {
        const top = positions.getY(vertex + side);
        if (damTerminal) expect(top).toBeLessThanOrEqual(point.y + lift + .0001);
        else expect(top).toBeCloseTo(point.y + lift, 4);
        expect(positions.getY(vertex + side + 2)).toBe(top);
        expect(positions.getY(vertex + side + 4)).toBeCloseTo(top - lift - .15, 4);
      }
      // Skirt top coordinates coincide with the asphalt edge, but have
      // independent normals so no side-facing normal leaks into the top.
      expect(positions.getX(vertex + 2)).toBe(lx);
      expect(positions.getZ(vertex + 2)).toBe(lz);
      expect(positions.getX(vertex + 3)).toBe(rx);
      expect(positions.getZ(vertex + 3)).toBe(rz);
      expect(normals.getY(vertex)).toBeGreaterThan(0);
      expect(normals.getY(vertex + 1)).toBeGreaterThan(0);
      if (crossSections) for (let side = 0; side < 6; side++) {
        expect(crossSections.getX(vertex + side)).toBe(side % 2 ? 1 : -1);
        expect(crossSections.getY(vertex + side)).toBeCloseTo(
          (run.widths?.[pointIndex] ?? run.width) / 2, 5);
      }
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
  it('shows world-space asphalt wear and a narrow shoulder on the original strip', () => {
    const island = generateIsland();
    const view = createWorldScene(island);
    try {
      const path = view.group.getObjectByName('paths-road') as
        THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>;
      const toon = THREE.ShaderLib.toon!;
      const shader = {
        vertexShader: toon.vertexShader,
        fragmentShader: toon.fragmentShader,
        uniforms: {} as Record<string, { value: unknown }>,
      };
      path.material.onBeforeCompile(shader as unknown as
        Parameters<typeof path.material.onBeforeCompile>[0], null as unknown as THREE.WebGLRenderer);
      expect(shader.vertexShader).toContain('vAsphaltSection = roadCrossSection;');
      expect(shader.fragmentShader).toContain('smoothstep(0.04, 0.29, metresToRoadEdge)');
      expect(shader.fragmentShader).toContain('vAsphaltXZ * uAsphaltMapScale + 0.5');
      const map = shader.uniforms['uAsphaltWear']!.value as THREE.DataTexture;
      expect(map.format).toBe(THREE.RedFormat);
      expect(map.generateMipmaps).toBe(true);
      expect(map.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      const { x, z } = island.spawns[0]!.position;
      const { width } = map.image;
      const data = map.image.data as Uint8Array;
      const cell = (world: number): number => Math.floor((world / island.size + .5) * width);
      const values = Array.from({ length: 10 }, (_, i) =>
        data[cell(z - 10 + i * 2) * width + cell(x)]!);
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(25);
    } finally {
      view.dispose();
    }
  });

  it('fills the shared Dam road joint and keeps the terminal trail under the pavement', () => {
    const island = generateIsland();
    const east = island.roads.find(road => road.id === 'downtown-bleatsville--the-dam')!;
    const west = island.roads.find(road => road.id === 'the-dam--whispering-pines')!;
    const joined = roadRibbonRuns(island, 'road').find(run =>
      run.points.includes(east.points.at(-2)!) && run.points.includes(west.points[1]!))!;
    const junction = joined.points.indexOf(east.points.at(-1)!);
    expect(joined.points[junction + 1]).toBe(west.points[1]);

    const view = createWorldScene(island);
    try {
      const road = view.group.getObjectByName('paths-road')!;
      const trail = view.group.getObjectByName('paths-trail')!;
      const { position } = getDamPlacement(island);
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      for (const [x, z] of [[14.43, -4.35], [15.26, -6.99], [14.84, -5.42], [15.16, -6.53]]) {
        ray.ray.origin.set(position.x + x!, position.y + 35, position.z + z!);
        const asphalt = ray.intersectObject(road)[0];
        const dirt = ray.intersectObject(trail)[0];
        expect(asphalt).toBeDefined();
        expect(dirt).toBeDefined();
        expect(asphalt!.point.y - dirt!.point.y).toBeGreaterThan(.02);
      }
      const approach = island.roads.find(road => road.id === 'mt-gigga--the-dam')!.points.at(-4)!;
      ray.ray.origin.set(approach.x, approach.y + 10, approach.z);
      expect(ray.intersectObject(road)).toHaveLength(0);
      expect(ray.intersectObject(trail)[0]?.point.y).toBeCloseTo(approach.y + .19, 4);
    } finally {
      view.dispose();
    }
  });

  it('seats both Downtown approaches below the local street at the north junction', () => {
    const island = generateIsland();
    const street = island.pois.find(poi => poi.id === 'downtown-bleatsville')!.center;
    const roadRuns = roadRibbonRuns(island, 'road');
    const trailRuns = roadRibbonRuns(island, 'trail');
    const approaches = [
      roadRuns.find(run => run.squareNorthStart)!,
      trailRuns.find(run => run.squareNorthStart)!,
    ];
    const cap = street.z - 43;
    const view = createWorldScene(island);
    try {
      const road = view.group.getObjectByName('paths-road')!;
      const trail = view.group.getObjectByName('paths-trail')!;
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      const sample = (surface: THREE.Object3D, x: number, z: number) => {
        ray.ray.origin.set(x, 50, z);
        return ray.intersectObject(surface).map(hit => hit.point.y);
      };
      for (const [index, run] of approaches.entries()) {
        const joint = run.points[0]!;
        const approach = index === 0 ? road : trail;
        expect(joint.z - cap).toBeCloseTo(.04);
        for (const x of [joint.x - run.widths![0]! * .25, joint.x, joint.x + run.widths![0]! * .25]) {
          const incoming = sample(approach, x, cap - .10)[0]!;
          const overlap = sample(road, x, cap + .02);
          const outgoing = sample(road, x, cap + .10);
          expect(Math.abs(incoming - outgoing[0]!)).toBeLessThan(.10);
          expect(outgoing).toHaveLength(1);
          if (index === 0) expect(overlap[0]! - overlap.at(-1)!).toBeGreaterThan(.005);
          else expect(overlap[0]! - sample(trail, x, cap + .02)[0]!).toBeGreaterThan(.005);
        }
      }
      // Original live reproduction was more than a metre inside the painted street.
      expect(sample(trail, 145.39, 77.29)).toHaveLength(0);
      expect(sample(road, 140.67, 77.29)).toHaveLength(1);
    } finally {
      view.dispose();
    }
  });

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
      const runs = roadRibbonRuns(island, 'road');
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
    const special = roadRibbonRuns(island, 'road').filter(run => run.width === 5);
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
