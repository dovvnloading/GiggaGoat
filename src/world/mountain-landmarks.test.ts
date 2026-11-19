import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { generateIsland } from './island';
import { bakeLibraryPropGeometry } from './library-props';
import { gridSample, segmentProjection } from './terrain';
import type { PropDescriptor } from './types';
import { findBookmark } from './viewer/bookmarks';
import { buildPropVisuals } from './visual-props';

async function loadMountainAsset(file: string): Promise<THREE.Group> {
  const bytes = readFileSync(new URL('../../public/assets/library/custom/mt-gigga/' + file,
    import.meta.url));
  return (await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '')).scene;
}

it.each([
  { seed: 'billy-isle', size: 600, resolution: 193 },
  { seed: 'gigga-alt', size: 400, resolution: 97 },
  { seed: 'first-playable-test', size: 720, resolution: 97 },
  { seed: 'other', size: 900, resolution: 97 },
  { seed: 'scale2', size: 1080, resolution: 65 },
  { seed: 'floor', size: 200, resolution: 33 },
  { seed: 'scale', size: 2000, resolution: 33 },
  { seed: 'scale', size: 2000, resolution: 193 },
])('seats the summit dish beside the upper trails on $seed / $size', options => {
  const island = generateIsland(options);
  const dish = island.props.find(prop => prop.kind === 'satellite-dish' && prop.poiId === 'mt-gigga')!;
  expect(dish).toBeDefined();
  const summit = island.pois.find(poi => poi.id === 'mt-gigga')!.center;
  const footing = dish.transform.position;
  const scale = island.size / 600;
  const ground = gridSample(island, footing.x, footing.z);
  expect(footing.y - dish.size.y / 2).toBeCloseTo(ground, 4);
  // The authored pedestal is asymmetric after its visual scale and yaw.
  const footingScale = dish.size.x / 7;
  const cosine = Math.cos(.64), sine = Math.sin(.64);
  const terrainHeights = [ground, ...[-4.7, 2.69].flatMap(x => [-2.32, 4.05].map(z =>
    gridSample(island, footing.x + (x * cosine + z * sine) * footingScale,
      footing.z + (-x * sine + z * cosine) * footingScale)))];
  expect(Math.max(...terrainHeights) - Math.min(...terrainHeights)).toBeLessThan(3.201 * scale);
  expect(Math.hypot(footing.x - summit.x, footing.z - summit.z) - dish.size.x / 2)
    .toBeGreaterThan(7.4 * scale);
  for (const road of island.roads) {
    if (road.from !== 'mt-gigga' && road.to !== 'mt-gigga') continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!;
      const hit = segmentProjection(footing, a, b);
      const x = a.x + hit.t * (b.x - a.x), z = a.z + hit.t * (b.z - a.z);
      const standingHeight = Math.max(a.y + hit.t * (b.y - a.y) + .19, gridSample(island, x, z));
      if (standingHeight < ground - Math.max(1.6, 2.1 * scale)) continue;
      expect(hit.distance, `${road.id} segment ${i}`).toBeGreaterThanOrEqual(dish.size.x / 2 + road.width / 2 + .44 * scale);
    }
  }
});

it('keeps the authored cave entrance open with a projecting lip and a warm recess', async () => {
  const cave = await loadMountainAsset('cave-arch.glb');
  cave.updateMatrixWorld(true);
  const meshes: Record<string, THREE.BufferGeometry> = {};
  cave.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material as THREE.MeshStandardMaterial;
    // Probe the actual opening even when the mouth is viewed from its inner face.
    material.side = THREE.DoubleSide;
    meshes[material.name] = object.geometry;
  });

  const ray = new THREE.Raycaster();
  for (const x of [-2, 0, 2]) for (const y of [2.2, 4.6]) {
    ray.set(new THREE.Vector3(x, y, 9), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(cave)[0];
    expect(hit?.point.z).toBeCloseTo(-1.8);
  }

  const lip = meshes['rockLight']!;
  lip.computeBoundingBox();
  expect(lip.boundingBox!.max.z).toBeGreaterThan(3.3);

  const recess = meshes['caveDark']!;
  const positions = recess.getAttribute('position'), paint = recess.getAttribute('color');
  const front: number[] = [], back: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const z = positions.getZ(i);
    const warmth = paint.getX(i) - paint.getZ(i);
    if (z > 2.3) front.push(warmth);
    if (z < -2) back.push(warmth);
  }
  expect(front.length).toBeGreaterThan(0);
  expect(back.length).toBeGreaterThan(0);
  expect(Math.max(...front)).toBeGreaterThan(0.05);
  expect(Math.max(...back)).toBeLessThan(0);
});

function descriptorMatrix(prop: PropDescriptor): THREE.Matrix4 {
  const { position, rotationY } = prop.transform;
  return new THREE.Matrix4().compose(
    new THREE.Vector3().copy(position),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
    new THREE.Vector3().copy(prop.size),
  );
}

function projectedArea(geometry: THREE.BufferGeometry, pose: THREE.Matrix4,
  camera: THREE.PerspectiveCamera): number {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  const bounds = new THREE.Box2();
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i).applyMatrix4(pose).project(camera);
    bounds.expandByPoint(new THREE.Vector2(vertex.x, vertex.y));
  }
  const size = bounds.getSize(new THREE.Vector2());
  return size.x * size.y;
}

it('makes both summit landmarks larger in the approach view while preserving route fixtures', async () => {
  const island = generateIsland();
  const summit = island.pois.find(poi => poi.id === 'mt-gigga')!;
  const props = island.props.filter(prop => prop.poiId === summit.id);
  const originalProps = structuredClone(props);
  const colliderIds = new Set(props.map(prop => prop.id));
  const colliders = island.colliders.filter(collider =>
    'id' in collider && colliderIds.has(collider.id));
  expect(colliders.length).toBeGreaterThan(0);
  const originalColliders = structuredClone(colliders);

  const bookmark = findBookmark('12')!;
  const camera = new THREE.PerspectiveCamera(bookmark.fov, 16 / 9, 0.1, 500);
  camera.position.copy(bookmark.camera);
  camera.lookAt(bookmark.target.x, bookmark.target.y, bookmark.target.z);
  camera.updateMatrixWorld(true);
  const trail = island.roads.find(road => road.from === 'downtown-bleatsville' &&
    road.to === summit.id)!;
  const corner = trail.points.reduce((nearest, point) =>
    Math.hypot(point.x - 45, point.z - 43) < Math.hypot(nearest.x - 45, nearest.z - 43)
      ? point : nearest);
  const climb = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  climb.position.set(corner.x, corner.y + 2.5, corner.z);
  climb.lookAt(summit.center.x, summit.center.y + 8, summit.center.z);
  climb.updateMatrixWorld(true);

  const visuals = buildPropVisuals(props, 96, island);
  try {
    for (const [kind, file] of [
      ['satellite-dish', 'satellite-dish.glb'],
      ['flag', 'pennant-pole.glb'],
    ] as const) {
      const prop = props.find(candidate => candidate.kind === kind)!;
      const geometry = bakeLibraryPropGeometry(kind, await loadMountainAsset(file))!;
      const mesh = visuals.group.getObjectByName('props-' + kind) as THREE.InstancedMesh;
      const posed = new THREE.Matrix4();
      mesh.getMatrixAt(0, posed);
      const original = descriptorMatrix(prop);
      expect(projectedArea(geometry, posed, camera), kind).toBeGreaterThan(
        projectedArea(geometry, original, camera) * 1.3);
      expect(projectedArea(geometry, posed, climb), kind).toBeGreaterThan(
        projectedArea(geometry, original, climb) * 1.2);

      if (kind === 'flag') {
        const base = new THREE.Vector3(-0.4212, -0.49, 0);
        expect(base.clone().applyMatrix4(posed).distanceTo(base.applyMatrix4(original)))
          .toBeLessThan(0.001);
      } else {
        const foot = new THREE.Vector3(0, -0.49, 0).applyMatrix4(posed);
        const terrain = gridSample(island, foot.x, foot.z);
        expect(foot.y - terrain).toBeGreaterThan(-0.1);
        expect(foot.y - terrain).toBeLessThan(0.4);
      }
      geometry.dispose();
    }
    expect(props).toEqual(originalProps);
    expect(colliders).toEqual(originalColliders);
  } finally {
    visuals.dispose();
  }
});
