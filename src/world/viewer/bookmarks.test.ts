import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { describe, expect, it } from 'vitest';
import { createWorldScene, generateIsland, heightAt } from '../index';
import { gridSample, riverAt } from '../terrain';
import type { PropDescriptor, Vec3 } from '../types';
import { applyBookmarkCamera, ART_BOOKMARKS, findBookmark } from './bookmarks';
import { updateOrbitCamera } from './orbit-terrain';

const roundHalf = (value: number): number => Math.round(value * 2) / 2;
const rounded = (v: Vec3): Vec3 => ({
  x: roundHalf(v.x), y: roundHalf(v.y), z: roundHalf(v.z),
});

const island = generateIsland({ seed: 'billy-isle', size: 600, resolution: 193 });
function props(poi: string, kind: string): PropDescriptor[] {
  return island.props.filter(prop => prop.poiId === poi && prop.kind === kind);
}

function projectBookmark(id: string, points: Record<string, Vec3>): void {
  const bookmark = findBookmark(id)!;
  const camera = new THREE.PerspectiveCamera(bookmark.fov, 16 / 9, 0.25, 4000);
  camera.position.set(bookmark.camera.x, bookmark.camera.y, bookmark.camera.z);
  camera.lookAt(bookmark.target.x, bookmark.target.y, bookmark.target.z);
  camera.updateMatrixWorld();
  if (id !== '09') {
    expect(bookmark.camera.y -
      heightAt(island, bookmark.camera.x, bookmark.camera.z), id + ' camera ground clearance')
      .toBeGreaterThan(2);
  }
  for (const [name, point] of Object.entries(points)) {
    const ndc = new THREE.Vector3(point.x, point.y, point.z).project(camera);
    expect(Math.abs(ndc.x), id + ': ' + name + ' screen X').toBeLessThan(0.94);
    expect(Math.abs(ndc.y), id + ': ' + name + ' screen Y').toBeLessThan(0.94);
    expect(ndc.z, id + ': ' + name + ' depth').toBeLessThan(1);
  }
}

const BUILDINGS = new Set<PropDescriptor['kind']>([
  'barn', 'house', 'cottage', 'silo', 'windmill', 'shop',
]);
const OBSTACLES = new Set<PropDescriptor['kind']>([
  ...BUILDINGS, 'tree-oak', 'tree-pine',
]);

/** Test the complete segment against each yaw-rotated 3D descriptor box. */
function intersectsBuilding(start: Vec3, end: Vec3, prop: PropDescriptor): boolean {
  const center = prop.transform.position;
  const rotation = new THREE.Matrix4().makeRotationY(-prop.transform.rotationY);
  const local = (point: Vec3): THREE.Vector3 =>
    new THREE.Vector3(point.x - center.x, point.y - center.y, point.z - center.z)
      .applyMatrix4(rotation);
  const a = local(start), b = local(end);
  const delta = b.clone().sub(a);
  const distance = delta.length();
  const half = prop.size;
  const bounds = new THREE.Box3(
    new THREE.Vector3(-half.x / 2, -half.y / 2, -half.z / 2),
    new THREE.Vector3(half.x / 2, half.y / 2, half.z / 2),
  );
  if (bounds.containsPoint(a)) return true;
  if (distance === 0) return false;
  const hit = new THREE.Ray(a, delta.divideScalar(distance))
    .intersectBox(bounds, new THREE.Vector3());
  return hit !== null && a.distanceTo(hit) <= distance;
}

function isClear07(camera: Vec3, target: Vec3): boolean {
  return island.props.every(prop => !OBSTACLES.has(prop.kind) ||
    Math.hypot(camera.x - prop.transform.position.x,
      camera.z - prop.transform.position.z) >= 8) &&
    island.props.every(prop => !BUILDINGS.has(prop.kind) ||
      !intersectsBuilding(camera, target, prop));
}

describe('painting bookmark recompositions (default billy-isle)', () => {
  it('07 frames windmill and Mt Gigga summit from clear ground-level farm approach', () => {
    const bookmark = findBookmark('07')!;
    // Walk from the original barn-wall camera toward the island centre in
    // 2 m increments, keeping the eye 3 m above the generated terrain.
    const start = new THREE.Vector2(-190, 110);
    const distance = start.length();
    const direction = start.clone().negate().normalize();
    let firstClear: Vec3 | undefined;
    for (let metres = 0; metres <= distance; metres += 2) {
      const x = start.x + direction.x * metres;
      const z = start.y + direction.y * metres;
      const candidate = { x, y: heightAt(island, x, z) + 3, z };
      if (isClear07(candidate, bookmark.target)) {
        firstClear = candidate;
        break;
      }
    }
    expect(firstClear, 'first clear 2 m sample').toBeDefined();
    expect(bookmark.camera).toEqual(rounded(firstClear!));
    expect(bookmark.camera).toEqual({ x: -167.5, y: 9, z: 97 });
    expect(isClear07(bookmark.camera, bookmark.target),
      'rounded bookmark 07 must stay clear').toBe(true);
    for (const prop of island.props.filter(p => OBSTACLES.has(p.kind))) {
      expect(Math.hypot(bookmark.camera.x - prop.transform.position.x,
        bookmark.camera.z - prop.transform.position.z),
      `07 clearance from ${prop.id}`).toBeGreaterThanOrEqual(8);
    }
    for (const prop of island.props.filter(p => BUILDINGS.has(p.kind))) {
      expect(intersectsBuilding(bookmark.camera, bookmark.target, prop),
        `07 sight line vs ${prop.id}`).toBe(false);
    }
    expect(bookmark.target).toEqual({ x: 0, y: 40, z: 0 });
    expect(bookmark.fov).toBe(55);
    const windmill = props('hoofington', 'windmill')[0]!;
    const summit = island.pois.find(p => p.id === 'mt-gigga')!.center;
    projectBookmark('07', {
      windmill: windmill.transform.position,
      summit: { x: summit.x, y: heightAt(island, summit.x, summit.z), z: summit.z },
    });
  });

  it('09 frames the first kiosk, wheel and pier entrance from the sand', () => {
    const bookmark = findBookmark('09')!;
    const pier = props('baa-ardwalk', 'pier')[0]!;
    const wheel = props('baa-ardwalk', 'ferris-wheel')[0]!;
    const kiosk = props('baa-ardwalk', 'kiosk-icecream')[0]!;
    const landEnd = pier.transform.position.z - pier.size.z / 2;
    const cameraX = pier.transform.position.x - 6;
    let shoreZ = landEnd;
    while (shoreZ > -island.size / 2 &&
      gridSample(island, cameraX, shoreZ) <= island.seaLevel + 0.6) {
      shoreZ -= 1;
    }
    expect(gridSample(island, cameraX, shoreZ), '09 shore reaches dry sand')
      .toBeGreaterThan(island.seaLevel + 0.6);
    const cameraZ = shoreZ - 5;
    expect(bookmark.camera).toEqual(rounded({
      x: cameraX, y: gridSample(island, cameraX, cameraZ) + 2.2, z: cameraZ,
    }));
    expect(bookmark.target).toEqual(rounded({
      x: 0.6 * wheel.transform.position.x + 0.4 * pier.transform.position.x,
      y: wheel.transform.position.y,
      z: 0.6 * wheel.transform.position.z + 0.4 * landEnd,
    }));
    expect(bookmark.camera).toEqual({ x: 50, y: 7, z: 249 });
    expect(bookmark.target).toEqual({ x: 56.5, y: 19, z: 310 });
    expect(bookmark.fov).toBe(68);
    expect(bookmark.day).toBe(0.29);

    const ground = gridSample(island, bookmark.camera.x, bookmark.camera.z);
    expect(ground, '09 camera stands on dry sand')
      .toBeGreaterThan(island.seaLevel + 0.6);
    expect(bookmark.camera.y - ground, '09 goat-eye ground clearance')
      .toBeGreaterThan(0);
    expect(bookmark.camera.y - ground, '09 goat-eye ground clearance')
      .toBeLessThanOrEqual(2.5);

    const landmarks = {
      firstKiosk: kiosk.transform.position,
      wheelCentre: wheel.transform.position,
      pierLandEnd: {
        x: pier.transform.position.x,
        y: pier.transform.position.y + pier.size.y / 2,
        z: landEnd,
      },
    };
    const firstFramingFov = [66, 68, 70, 72, 74].find(fov => {
      const camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.25, 4000);
      camera.position.set(bookmark.camera.x, bookmark.camera.y, bookmark.camera.z);
      camera.lookAt(bookmark.target.x, bookmark.target.y, bookmark.target.z);
      camera.updateMatrixWorld();
      return Object.values(landmarks).every(point => {
        const ndc = new THREE.Vector3(point.x, point.y, point.z).project(camera);
        return Math.abs(ndc.x) < 0.94 && Math.abs(ndc.y) < 0.94 && ndc.z < 1;
      });
    });
    expect(bookmark.fov, '09 first FOV framing all landmarks').toBe(firstFramingFov);
    projectBookmark('09', landmarks);
  });

  it('13 frames the log bridge, at least five bank ferns and the lookout upstream', () => {
    const bookmark = findBookmark('13')!;
    const bridge = props('whispering-pines', 'log-bridge')[0]!;
    const lookout = props('whispering-pines', 'lookout')[0]!;
    expect(bridge).toBeDefined();
    expect(lookout).toBeDefined();
    const at = bridge.transform.position;
    const index = island.river.findIndex(point =>
      Math.hypot(point.x - at.x, point.z - at.z) < 1e-5);
    expect(index).toBeGreaterThan(0);
    const before = island.river[index - 1]!;
    const after = island.river[index + 1]!;
    const upstream = new THREE.Vector2(before.x - after.x, before.z - after.z).normalize();
    // River-left is defined looking downstream: right of the upstream vector.
    const riverLeft = new THREE.Vector2(upstream.y, -upstream.x);
    const waterLevel = riverAt(at, island.river).level;
    expect(bookmark.camera).toEqual(rounded({
      x: at.x - upstream.x * 22 + riverLeft.x * 3,
      y: waterLevel + 3.5,
      z: at.z - upstream.y * 22 + riverLeft.y * 3,
    }));
    expect(bookmark.target).toEqual(rounded({
      x: at.x + upstream.x * 18, y: waterLevel + 6,
      z: at.z + upstream.y * 18,
    }));
    expect(bookmark.camera).toEqual({ x: -130, y: 6.5, z: -175.5 });
    expect(bookmark.target).toEqual({ x: -98, y: 9, z: -151 });
    expect(bookmark.fov).toBe(60);
    expect(bookmark.day).toBe(0.49);
    projectBookmark('13', { logBridge: at, lookout: lookout.transform.position });
    const camera = new THREE.PerspectiveCamera(bookmark.fov, 16 / 9, 0.25, 4000);
    camera.position.set(bookmark.camera.x, bookmark.camera.y, bookmark.camera.z);
    camera.lookAt(bookmark.target.x, bookmark.target.y, bookmark.target.z);
    camera.updateMatrixWorld();
    const visible = props('whispering-pines', 'fern').filter(fern => {
      const p = fern.transform.position;
      const ndc = new THREE.Vector3(p.x, p.y, p.z).project(camera);
      return Math.abs(ndc.x) < 0.94 && Math.abs(ndc.y) < 0.94 &&
        ndc.z > -1 && ndc.z < 1;
    });
    expect(visible.length, 'ferns visible in bookmark 13').toBeGreaterThanOrEqual(5);
    projectBookmark('13', Object.fromEntries(
      visible.slice(0, 5).map((fern, i) => ['fern' + i, fern.transform.position])));
  });

  it('10 frames high column, main crane mast, and front chain-link fence', () => {
    const bookmark = findBookmark('10')!;
    const site = island.pois.find(p => p.id === 'crane-yard')!.center;
    expect(bookmark.camera).toEqual(rounded({
      x: site.x + 12, y: site.y + 4.5, z: site.z + 46,
    }));
    expect(bookmark.target).toEqual(rounded({
      x: site.x - 4, y: site.y + 12, z: site.z - 10,
    }));
    expect(bookmark.camera).toEqual({ x: 195, y: 11.5, z: -3 });
    expect(bookmark.target).toEqual({ x: 179, y: 19, z: -59 });
    expect(bookmark.fov).toBe(60);
    const highest = (p: PropDescriptor) => p.transform.position.y + p.size.y / 2;
    const column = props('crane-yard', 'concrete-column')
      .sort((a, b) => highest(b) - highest(a))[0]!;
    const mast = props('crane-yard', 'crane')
      .sort((a, b) => highest(b) - highest(a))[0]!;
    const fence = props('crane-yard', 'chain-fence')
      .filter(p => p.transform.position.z > site.z + 25)
      .sort((a, b) => Math.abs(a.transform.position.x - site.x) -
        Math.abs(b.transform.position.x - site.x))[0]!;
    expect(fence).toBeDefined();
    projectBookmark('10', {
      columnTop: { ...column.transform.position, y: highest(column) },
      craneMastTop: { ...mast.transform.position, y: highest(mast) },
      frontFencePanel: fence.transform.position,
    });
  });
});

describe('World Lab bookmark camera constraints', () => {
  function makeOrbit(camera: THREE.PerspectiveCamera): OrbitControls {
    // OrbitControls only needs event registration for construction in Vitest.
    const events = { addEventListener: () => {}, removeEventListener: () => {} };
    const element = {
      ...events,
      ownerDocument: events,
      getRootNode: () => events,
      style: {},
    } as unknown as HTMLElement;
    const orbit = new OrbitControls(camera, element);
    orbit.target.set(0, 28, 0);
    orbit.enableDamping = true;
    orbit.minDistance = 10;
    orbit.maxDistance = 950;
    orbit.maxPolarAngle = Math.PI * 0.49;
    return orbit;
  }

  it.each(ART_BOOKMARKS)('preserves saved position and target for $id', bookmark => {
    const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.25, 4000);
    camera.position.set(310, 220, 390);
    const orbitCamera = camera.clone();
    const orbit = makeOrbit(orbitCamera);
    applyBookmarkCamera(orbitCamera, orbit, bookmark);
    camera.fov = bookmark.fov;
    camera.updateProjectionMatrix();
    updateOrbitCamera(camera, orbit);
    const expectedPosition = new THREE.Vector3(
      bookmark.camera.x, bookmark.camera.y, bookmark.camera.z);
    const expectedTarget = new THREE.Vector3(
      bookmark.target.x, bookmark.target.y, bookmark.target.z);
    const offset = expectedPosition.clone().sub(expectedTarget);
    const distance = offset.length();
    const polar = Math.acos(THREE.MathUtils.clamp(offset.y / distance, -1, 1));

    expect(orbit.maxPolarAngle).toBeCloseTo(Math.max(Math.PI * 0.49, polar + 0.02));
    expect(orbit.minDistance).toBeLessThanOrEqual(distance);
    expect(orbit.maxDistance).toBeGreaterThanOrEqual(distance);
    expect(camera.fov).toBe(bookmark.fov);
    expect(orbit.enableDamping).toBe(true);
    expect(camera.position.distanceTo(expectedPosition)).toBeLessThan(0.01);
    expect(orbit.target.distanceTo(expectedTarget)).toBeLessThan(0.01);
    // The regular animation-loop update must not lift or shift a saved pose.
    updateOrbitCamera(camera, orbit, island);
    expect(camera.position.distanceTo(expectedPosition)).toBeLessThan(0.01);
    expect(orbit.target.distanceTo(expectedTarget)).toBeLessThan(0.01);
    orbit.dispose();
  });

  it.each([
    { id: '08', name: 'Hoofington', blockedStep: 31, lift: 18 },
    { id: '13', name: 'Whispering Pines', blockedStep: 17, lift: 4 },
  ])('keeps the near plane above the $name ridge during a low orbit', fixture => {
    const world = createWorldScene(island, { chunkSegments: 32 });
    world.group.updateMatrixWorld(true);
    const bookmark = findBookmark(fixture.id)!;
    const orbitCamera = new THREE.PerspectiveCamera(bookmark.fov, 1542 / 883, .25, 4000);
    orbitCamera.position.set(310, 220, 390);
    const camera = orbitCamera.clone();
    const orbit = makeOrbit(orbitCamera);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const terrainY = (point: THREE.Vector3): number => {
      ray.set(new THREE.Vector3(point.x, 400, point.z), down);
      return ray.intersectObjects(world.chunks, false)[0]!.point.y;
    };
    try {
      applyBookmarkCamera(orbitCamera, orbit, bookmark);
      orbit.enableDamping = false;
      orbit.rotateUp(orbit.getPolarAngle() - orbit.maxPolarAngle);
      const intendedHeight = orbitCamera.position.y;
      for (let i = 0; i <= 48; i++) {
        updateOrbitCamera(camera, orbit, island);
        if (i === fixture.blockedStep) {
          expect(terrainY(camera.position) - intendedHeight).toBeGreaterThan(fixture.lift);
          expect(camera.position.y - terrainY(camera.position)).toBeGreaterThan(.3);
        }
        if (i === 0 || i === 48) expect(camera.position.y).toBeCloseTo(intendedHeight);
        expect(orbitCamera.position.y).toBeCloseTo(intendedHeight);
        expect(camera.position.x).toBeCloseTo(orbitCamera.position.x);
        expect(camera.position.z).toBeCloseTo(orbitCamera.position.z);
        for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
          const point = new THREE.Vector3(x, y, -1).unproject(camera);
          expect(point.y - terrainY(point)).toBeGreaterThan(.05);
        }
        orbit.rotateLeft(Math.PI / 24);
      }
    } finally {
      orbit.dispose();
      world.dispose();
    }
  });

  it('clears the rendered diagonal ridge even when bilinear height places it lower', () => {
    const terrain = { size: 4, resolution: 2, heights: new Float32Array([0, 10, 10, 0]) };
    const eye = new THREE.PerspectiveCamera(64, 16 / 9, .25, 4000);
    eye.position.set(0, 10.1, 0);
    const camera = eye.clone();
    const orbit = makeOrbit(eye);
    try {
      orbit.target.set(0, 9, -10);
      expect(gridSample(terrain, 0, 0)).toBe(5);
      updateOrbitCamera(camera, orbit, terrain);
      expect(eye.position.y).toBeCloseTo(10.1);
      expect(camera.position.y).toBeGreaterThan(10.4);
      const bottom = new THREE.Vector3(0, -1, -1).unproject(camera);
      expect(bottom.y).toBeGreaterThan(10);
    } finally {
      orbit.dispose();
    }
  });

  it('widens either distance bound without disabling subsequent orbit updates', () => {
    const bookmark = findBookmark('07')!;
    const position = new THREE.Vector3(
      bookmark.camera.x, bookmark.camera.y, bookmark.camera.z);
    const distance = position.distanceTo(new THREE.Vector3(
      bookmark.target.x, bookmark.target.y, bookmark.target.z));
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.25, 4000);
    camera.position.set(310, 220, 390);
    const orbit = makeOrbit(camera);

    orbit.minDistance = distance + 10;
    orbit.maxDistance = distance + 20;
    applyBookmarkCamera(camera, orbit, bookmark);
    expect(orbit.minDistance).toBeLessThanOrEqual(distance);
    expect(camera.position.distanceTo(position)).toBeLessThan(0.01);

    orbit.minDistance = 1;
    orbit.maxDistance = distance - 10;
    applyBookmarkCamera(camera, orbit, bookmark);
    expect(orbit.maxDistance).toBeGreaterThanOrEqual(distance);
    orbit.update();
    expect(camera.position.distanceTo(position)).toBeLessThan(0.01);
    expect(orbit.enabled).toBe(true);
    expect(orbit.enableDamping).toBe(true);
    orbit.dispose();
  });
});
