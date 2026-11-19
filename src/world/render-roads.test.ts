import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildRapierColliders, createWorldScene, generateIsland } from './index';
import { DAM_EAST_ROAD, DAM_MOUNTAIN_TRAIL, DAM_PINES_BRIDGE_PREFIX, DAM_PINES_ROAD,
  damMountainTrailDirt } from './roads';
import { roadRibbonData, roadRibbonRuns, SUMMIT_ASCENT_TRAIL } from './road-ribbons';
import { damChannelAt, isDamHeadwater } from './dam-landscape';
import { getDamPlacement } from './the-dam';
import type { IslandData, RoadPoint } from './types';
import { TOON_RAMP } from './visual-props';

type Surface = 'road' | 'trail';

function pavedBridgeSpans(island: IslandData) {
  const road = island.roads.find(item => item.id === DAM_PINES_ROAD);
  if (!road) return [];
  return road.points.slice(0, -1).flatMap((p, i) => {
    const q = road.points[i + 1]!;
    return (p.bridge || q.bridge) && Math.hypot(q.x - p.x, q.z - p.z) >= .05 ? [{ p, q, i }] : [];
  });
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

  const runs = roadRibbonRuns(island, type);
  const segments = runs.reduce((sum, run) => sum + run.points.length - 1, 0);
  const pavedSpans = type === 'road' ? pavedBridgeSpans(island) : [];
  const bridgePoints = new Set(pavedSpans.flatMap(({ p, q }) => [p, q]));
  const bridgeEnds = new Map(pavedSpans.map(({ p, q }) => [p, q]));
  const positions = surface.geometry.getAttribute('position');
  const crossSections = surface.geometry.getAttribute('roadCrossSection');
  if (type === 'road') expect(crossSections.count).toBe(positions.count);
  else expect(crossSections).toBeUndefined();
  const normals = surface.geometry.getAttribute('normal');
  const indices = surface.geometry.getIndex()!;
  expect(indices.count / 3).toBe(6 * segments + 2 * pavedSpans.length);
  expect(positions.count).toBe(6 * runs.reduce((sum, run) => sum + run.points.length, 0));
  const lift = type === 'road' ? 0.2 : 0.19;
  const damTrail = island.roads.find(road => road.id === DAM_MOUNTAIN_TRAIL);
  const damTrailEnd = damTrail ? damMountainTrailDirt(island, damTrail).at(-1) : undefined;
  const summitStart = island.roads.find(road => road.id === SUMMIT_ASCENT_TRAIL)?.points[0];
  let vertex = 0, index = 0;

  for (const run of runs) {
    const first = vertex;
    for (const [pointIndex, point] of run.points.entries()) {
      const lx = positions.getX(vertex), lz = positions.getZ(vertex);
      const rx = positions.getX(vertex + 1), rz = positions.getZ(vertex + 1);
      // Each segment connects to the identical left/right edge at a joint.
      expect((lx + rx) / 2).toBeCloseTo(point.x, 3);
      expect((lz + rz) / 2).toBeCloseTo(point.z, 3);
      const bridge = bridgePoints.has(point);
      const halfWidth = (run.widths?.[pointIndex] ?? run.width) / 2 + (bridge ? .5 : 0);
      const mitre = Math.hypot(lx - point.x, lz - point.z) / halfWidth;
      expect(mitre).toBeGreaterThanOrEqual(0.999);
      expect(mitre).toBeLessThanOrEqual(2.001);
      const damTerminal = type === 'trail' && damTrailEnd && run.points.at(-1) === damTrailEnd &&
        Math.hypot(point.x - damTrailEnd.x, point.z - damTrailEnd.z) < 9 * island.size / 600;
      for (const side of [0, 1]) {
        const top = positions.getY(vertex + side);
        if (damTerminal) expect(top).toBeLessThanOrEqual(point.y + lift + .0001);
        else expect(top).toBeCloseTo(point.y + lift, 4);
        expect(positions.getY(vertex + side + 2)).toBe(top);
        const toe = positions.getY(vertex + side + 4);
        if (run.points[0] === summitStart) expect(toe).toBeLessThanOrEqual(top - lift - .15 + .0001);
        else expect(toe).toBeCloseTo(top - (bridge ? .77 * island.size / 600 : lift + .15), 4);
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
        expect(crossSections.getY(vertex + side)).toBeCloseTo(halfWidth, 5);
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
      const bridge = bridgeEnds.get(run.points[i]!) === run.points[i + 1];
      index += bridge ? 24 : 18; // Top, skirts, and the underside on the paved bridge.
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
  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'cy-12-west-approach', size: 450, resolution: 97 },
    { seed: 9137, size: 900, resolution: 97 },
  ])('matches visible and physical Dam–Pines bridge surfaces ($size m)', async options => {
    await RAPIER.init();
    const island = generateIsland(options);
    const road = island.roads.find(item => item.id === DAM_PINES_ROAD)!;
    const view = createWorldScene(island);
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      const { paths, props, terrain } = buildRapierColliders(world, island);
      const roadMesh = view.group.getObjectByName('paths-road')!;
      const down = new THREE.Vector3(0, -1, 0);
      const up = new THREE.Vector3(0, 1, 0);
      const scale = island.size / 600;
      function verify(x: number, z: number, deck: RAPIER.Collider, label: string) {
        const origin = new THREE.Vector3(x, 45, z);
        const rendered = new THREE.Raycaster(origin, down).intersectObject(roadMesh)[0]!.distance;
        const ray = new RAPIER.Ray(origin, down);
        const paved = paths[0]!.castRay(ray, 45, false);
        expect(paved, label).toBeGreaterThan(0);
        expect(paved, label).toBeCloseTo(rendered, 4);
        const slab = deck.castRay(ray, 45, false);
        expect(slab - paved, label).toBeGreaterThan(.05 * scale);
        expect(slab - paved, label).toBeLessThan(.10 * scale);
        const ground = terrain.castRay(ray, 45, false);
        if (ground >= 0) expect(paved - ground, label).toBeLessThan(.06 * scale);
      }

      const spans = pavedBridgeSpans(island);
      expect(spans).toHaveLength(6);
      for (const { p, q, i } of spans) {
        const id = DAM_PINES_BRIDGE_PREFIX + i;
        const deck = props.get(id)!;
        expect(deck.shape.type, id).toBe(RAPIER.ShapeType.ConvexPolyhedron);
        expect(deck.parent(), id).toBeNull();
        const dx = q.x - p.x, dz = q.z - p.z, length = Math.hypot(dx, dz);
        for (const progress of [.02, .2, .5, .8, .98]) {
          for (const across of [-.95, -.5, 0, .5, .95]) {
            const side = (road.width + 1) / 2 * across;
            verify(p.x + dx * progress - dz * side / length,
              p.z + dz * progress + dx * side / length, deck, id + '/' + progress + '/' + across);
          }
        }
        const origin = new THREE.Vector3((p.x + q.x) / 2, (p.y + q.y) / 2 - 1.5 * scale, (p.z + q.z) / 2);
        const underside = deck.castRay(new RAPIER.Ray(origin, up), 2 * scale, false);
        const drawnUnderside = new THREE.Raycaster(origin, up).intersectObject(roadMesh)[0]!.distance;
        expect(underside, id).toBeGreaterThan(0);
        expect(Math.abs(underside - drawnUnderside), id).toBeLessThan(.01 * scale);
      }
      if (options.seed === 'billy-isle') {
        verify(-120.9846, -176.6251, props.get(DAM_PINES_BRIDGE_PREFIX + '27')!, 'reported hoof overlap');
      }
    } finally {
      view.dispose();
      world.free();
    }
  });

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

  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'billy-isle', size: 400, resolution: 97 },
    { seed: 9137, size: 900, resolution: 97 },
  ])('joins the dry mountain trail onto the existing Dam road ($size m)', async options => {
    await RAPIER.init();
    const island = generateIsland(options);
    const east = island.roads.find(road => road.id === DAM_EAST_ROAD)!;
    const west = island.roads.find(road => road.id === DAM_PINES_ROAD)!;
    const mountain = island.roads.find(road => road.id === DAM_MOUNTAIN_TRAIL)!;
    const dirtPoints = damMountainTrailDirt(island, mountain);
    const junction = dirtPoints.at(-1)!;
    const asphaltTail = east.points.slice(east.points.indexOf(junction));
    expect(asphaltTail.length).toBeGreaterThan(2);
    for (const [index, point] of asphaltTail.entries()) {
      expect(mountain.points[dirtPoints.length - 1 + index]).toBe(point);
    }
    const paved = roadRibbonRuns(island, 'road').find(run =>
      run.points.includes(east.points.at(-2)!) && run.points.includes(west.points[1]!))!;
    expect(paved.points[paved.points.indexOf(east.points.at(-1)!) + 1]).toBe(west.points[1]);
    const trailRun = roadRibbonRuns(island, 'trail').find(run => run.points.includes(junction))!;
    expect(trailRun.points.at(-1)).toBe(junction);
    expect(trailRun.points).not.toContain(east.points.at(-1));

    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const view = createWorldScene(island);
    try {
      const { paths } = buildRapierColliders(world, island);
      const meshes = ['paths-road', 'paths-trail'].map(name => view.group.getObjectByName(name)!);
      const { position, scale } = getDamPlacement(island);
      const { reservoir } = island;
      const down = new THREE.Vector3(0, -1, 0);
      const ray = new THREE.Raycaster(new THREE.Vector3(), down);
      const label = (x: number, z: number) => x.toFixed(2) + ', ' + z.toFixed(2);
      let pavedOverlap = 0;
      let openTrail = 0;
      const foothillPoint = [...dirtPoints].reverse().find(point => point.z > position.z + 71 * scale)!;
      const foothill = dirtPoints.indexOf(foothillPoint);
      expect(foothill).toBeGreaterThan(0);
      for (let i = foothill; i + 1 < dirtPoints.length; i++) {
        const a = dirtPoints[i]!, b = dirtPoints[i + 1]!;
        const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
        const steps = Math.ceil(length / (.6 * scale));
        for (let j = 0; j < steps; j++) {
          const progress = (j + .5) / steps;
          for (const across of [-1.5 * scale, 0, 1.5 * scale]) {
            const x = a.x + dx * progress - dz * across / length;
            const z = a.z + dz * progress + dx * across / length;
            const note = label(x, z);
            expect(isDamHeadwater(island, x, z), note).toBe(false);
            if (Math.abs(z - reservoir.center.z) < reservoir.radiusZ + .35 * scale) {
              expect(x, note).toBeGreaterThan(reservoir.center.x + reservoir.radiusX + .35 * scale);
            }
            const localZ = (z - position.z) / scale;
            if (localZ >= 5 && localZ <= 110) {
              const channel = damChannelAt(localZ);
              expect((x - position.x) / scale, note).toBeGreaterThan(channel.x + channel.halfWidth);
            }
            ray.ray.origin.set(x, Math.max(a.y, b.y) + 10, z);
            const rapierRay = new RAPIER.Ray(ray.ray.origin, down);
            const [asphalt, dirt] = meshes.map((mesh, index) => {
              const renderHit = ray.intersectObject(mesh)[0]?.distance;
              const solidHit = paths[index]!.castRay(rapierRay, 20, false);
              if (renderHit === undefined) expect(solidHit, note).toBeLessThan(0);
              else expect(solidHit, note).toBeCloseTo(renderHit, 4);
              return renderHit;
            });
            expect(dirt, note).toBeDefined();
            if (asphalt === undefined) openTrail++;
            else {
              pavedOverlap++;
              expect(dirt! - asphalt, note).toBeGreaterThan(.002);
              expect(dirt! - asphalt, note).toBeLessThan(.25 * scale);
            }
          }
        }
      }
      expect(openTrail).toBeGreaterThan(50);
      expect(pavedOverlap).toBeGreaterThan(3);

      const board = east.points.at(-1)!;
      ray.ray.origin.set(board.x, board.y + 10, board.z);
      expect(ray.intersectObject(meshes[0]!).length).toBeGreaterThan(0);
      expect(ray.intersectObject(meshes[1]!)).toHaveLength(0);
      if (options.size === 600) {
        // The old approach ran through the wall below the entrance.
        ray.ray.origin.set(-17.56, 16, -199.05);
        expect(ray.intersectObject(meshes[1]!)).toHaveLength(0);
        expect(paths[1]!.castRay(new RAPIER.Ray(ray.ray.origin, down), 16, false)).toBeLessThan(0);
      }
    } finally {
      view.dispose();
      world.free();
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

  it('seats the Summit trail side panels in both drawn terrain LODs without changing the walk or bridge profiles', () => {
    const island = generateIsland();
    const summit = island.roads.find(road => road.id === SUMMIT_ASCENT_TRAIL)!;
    const runs = roadRibbonRuns(island, 'trail');
    const index = runs.findIndex(run => run.points[0] === summit.points[0]);
    const first = runs.slice(0, index).reduce((count, run) => count + run.points.length * 6, 0);
    const points = runs[index]!.points;
    const base = roadRibbonData(island, 'trail');
    const view = createWorldScene(island);
    try {
      view.group.updateMatrixWorld(true);
      const mesh = view.group.getObjectByName('paths-trail') as THREE.Mesh;
      const position = mesh.geometry.getAttribute('position');
      const previous = Float32Array.from(base.positions);
      expect(Array.from(mesh.geometry.index!.array)).toEqual(base.indices);
      const moved = [];
      for (let component = 0; component < previous.length; component++) {
        if (position.array[component] === previous[component]) continue;
        const vertex = Math.floor(component / 3) - first;
        const point = Math.floor(vertex / 6);
        // Only the two right toes at the summit entrance splay outwards.
        if (component % 3 !== 1) expect([5, 11]).toContain(vertex);
        expect(point).toBeGreaterThanOrEqual(0);
        expect(point).toBeLessThan(points.length);
        expect(vertex % 6).toBeGreaterThanOrEqual(4);
        expect(points.slice(Math.max(0, point - 1), point + 2).some(p => p.bridge)).toBe(false);
        moved.push(component);
      }
      expect(moved.length).toBeGreaterThan(50);

      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      const camera = new THREE.PerspectiveCamera(113, 1.6, .05, 2000);
      const near = view.chunks.map(chunk => chunk.geometry);
      for (const low of [false, true]) {
        if (low) {
          camera.position.set(0, 510, 0);
          camera.up.set(0, 0, -1);
          camera.lookAt(0, 55, 0);
          view.updateCulling(camera);
          expect(view.chunks.some((mesh, i) => mesh.geometry !== near[i])).toBe(true);
        }
        // Include both visible sides between Hard flags 2 and 3 and a
        // midmountain joint where the far terrain's seam fan changes grade.
        for (const span of [8, 29, 32, 37, 42, 58, 108, 163]) for (const side of [4, 5]) {
          const a = first + span * 6 + side, b = a + 6;
          for (const t of [.15, .5, .85]) {
            ray.ray.origin.set(
              THREE.MathUtils.lerp(position.getX(a), position.getX(b), t), 140,
              THREE.MathUtils.lerp(position.getZ(a), position.getZ(b), t),
            );
            const terrain = ray.intersectObjects(view.chunks, false)[0]!.point.y;
            const bottom = THREE.MathUtils.lerp(position.getY(a), position.getY(b), t);
            expect(bottom, 'side panel ' + span + '/' + side + ', coarse=' + low)
              .toBeLessThan(terrain - .04);
          }
        }
      }
    } finally {
      view.dispose();
    }
  });

  it('merges kept runs per type with shared mitred joints and a closed bridge underside', () => {
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
