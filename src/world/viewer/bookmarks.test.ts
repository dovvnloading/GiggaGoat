import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateIsland, heightAt } from '../index';
import { gridSample, riverAt } from '../terrain';
import type { PropDescriptor, Vec3 } from '../types';
import { findBookmark } from './bookmarks';

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

function containsXZ(prop: PropDescriptor, x: number, z: number): boolean {
  const dx = x - prop.transform.position.x, dz = z - prop.transform.position.z;
  const c = Math.cos(prop.transform.rotationY), s = Math.sin(prop.transform.rotationY);
  return Math.abs(c * dx - s * dz) <= prop.size.x / 2 &&
    Math.abs(s * dx + c * dz) <= prop.size.z / 2;
}

describe('painting bookmark recompositions (default billy-isle)', () => {
  it('07 frames windmill and Mt Gigga summit from clear ground-level farm approach', () => {
    const bookmark = findBookmark('07')!;
    const blockedBy = island.props.filter(p => [
      'house', 'barn', 'shop', 'cottage', 'control-house', 'silo',
      'windmill', 'tower', 'tree-oak', 'tree-pine',
    ].includes(p.kind));
    const direction = new THREE.Vector2(190, -110).normalize().multiplyScalar(2);
    let x = -190, z = 110;
    for (let i = 0; i < 30 &&
      blockedBy.some(prop => containsXZ(prop, x, z)); i++) {
      x += direction.x; z += direction.y;
    }
    expect(blockedBy.some(p => containsXZ(p, x, z))).toBe(false);
    expect(bookmark.camera).toEqual(rounded({
      x, y: heightAt(island, x, z) + 3, z,
    }));
    expect(bookmark.camera).toEqual({ x: -190, y: 9, z: 110 });
    expect(bookmark.target).toEqual({ x: 0, y: 40, z: 0 });
    expect(bookmark.fov).toBe(55);
    const windmill = props('hoofington', 'windmill')[0]!;
    const summit = island.pois.find(p => p.id === 'mt-gigga')!.center;
    projectBookmark('07', {
      windmill: windmill.transform.position,
      summit: { x: summit.x, y: heightAt(island, summit.x, summit.z), z: summit.z },
    });
  });

  it('09 frames the first kiosk, wheel, pier entrance and beach palms from the sand', () => {
    const bookmark = findBookmark('09')!;
    const pier = props('baa-ardwalk', 'pier')[0]!;
    const wheel = props('baa-ardwalk', 'ferris-wheel')[0]!;
    const kiosk = props('baa-ardwalk', 'booth')[0]!;
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
      x: wheel.transform.position.x,
      y: wheel.transform.position.y + 1,
      z: wheel.transform.position.z,
    }));
    expect(bookmark.camera).toEqual({ x: 50, y: 7, z: 249 });
    expect(bookmark.target).toEqual({ x: 56.5, y: 20.5, z: 347 });
    expect(bookmark.fov).toBe(62);
    expect(bookmark.day).toBe(0.29);

    const ground = gridSample(island, bookmark.camera.x, bookmark.camera.z);
    expect(ground, '09 camera stands on dry sand')
      .toBeGreaterThan(island.seaLevel + 0.6);
    expect(bookmark.camera.y - ground, '09 goat-eye ground clearance')
      .toBeGreaterThan(0);
    expect(bookmark.camera.y - ground, '09 goat-eye ground clearance')
      .toBeLessThanOrEqual(2.5);

    const camera = new THREE.PerspectiveCamera(bookmark.fov, 16 / 9, 0.25, 4000);
    camera.position.set(bookmark.camera.x, bookmark.camera.y, bookmark.camera.z);
    camera.lookAt(bookmark.target.x, bookmark.target.y, bookmark.target.z);
    camera.updateMatrixWorld();
    const visiblePalms = props('baa-ardwalk', 'palm-tree').filter(palm => {
      const point = palm.transform.position;
      const ndc = new THREE.Vector3(point.x, point.y, point.z).project(camera);
      return Math.abs(ndc.x) < 0.94 && Math.abs(ndc.y) < 0.94 && ndc.z < 1;
    });
    expect(visiblePalms.length, '09 beach palms visible on screen')
      .toBeGreaterThanOrEqual(2);
    projectBookmark('09', {
      firstKiosk: kiosk.transform.position,
      wheelCentre: wheel.transform.position,
      pierLandEnd: {
        x: pier.transform.position.x,
        y: pier.transform.position.y + pier.size.y / 2,
        z: landEnd,
      },
      ...Object.fromEntries(visiblePalms.slice(0, 2).map((palm, i) =>
        ['beachPalm' + (i + 1), palm.transform.position])),
    });
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
