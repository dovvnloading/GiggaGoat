import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateIsland } from './island';
import { createWorldScene } from './render';
import { segmentProjection } from './terrain';
import { findBookmark } from './viewer/bookmarks';

function activePoints(mesh: THREE.Mesh): THREE.Vector3[] {
  const attribute = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = mesh.geometry.getIndex()!;
  return Array.from({ length: mesh.geometry.drawRange.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(attribute, index.getX(i)));
}

describe('Rising Tide escape-route cues', () => {
  it('shows only dry uphill trail sections as the ocean rises, then hides on dry free roam', () => {
    const island = generateIsland();
    const view = createWorldScene(island);
    try {
      const mesh = view.group.getObjectByName('rising-tide-escape-route-cues') as THREE.Mesh;
      expect(mesh.visible).toBe(false);
      view.setTideLevel(0, true); // Start of a Rising Tide round at ordinary sea level.
      const initial = activePoints(mesh);
      const village = island.pois.find(p => p.id === 'hoofington')!.center;
      expect(initial.some(p => Math.hypot(p.x - village.x, p.z - village.z) < 9)).toBe(true);
      view.setTideLevel(7);
      expect(activePoints(mesh).length).toBeLessThan(initial.length);
      view.setTideLevel(49);
      const midFlood = activePoints(mesh);
      expect(midFlood.length).toBeGreaterThan(500);
      expect(midFlood.every(p => p.y > 49.62)).toBe(true);
      const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const index = mesh.geometry.getIndex()!;
      const routes = island.roads.filter(r => r.type === 'trail' &&
        (r.from === 'mt-gigga' || r.to === 'mt-gigga'));
      for (let i = 0; i < midFlood.length; i += 18) {
        const base = index.getX(i);
        const tail = new THREE.Vector3().fromBufferAttribute(positions, base)
          .lerp(new THREE.Vector3().fromBufferAttribute(positions, base + 1), .5);
        const tip = new THREE.Vector3().fromBufferAttribute(positions, base + 4);
        const centre = tail.clone().lerp(tip, .48);
        const heading = new THREE.Vector2(tip.x - tail.x, tip.z - tail.z).normalize();
        const climbs = routes.some(road => road.points.slice(1).some((b, j) => {
          const a = road.points[j]!;
          if (segmentProjection(centre, a, b).distance > .16) return false;
          const towardSummit = road.to === 'mt-gigga' ? 1 : -1;
          const uphill = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize().multiplyScalar(towardSummit);
          return heading.dot(uphill) > .98;
        }));
        expect(climbs, String(centre.x) + ', ' + centre.z).toBe(true);
      }
      view.setTideLevel(70);
      expect(activePoints(mesh).length).toBeLessThan(midFlood.length);
      view.setTideLevel(130);
      expect(mesh.visible).toBe(false);
      view.setTideLevel(49, false); // Results and other modes do not own route cues.
      expect(mesh.visible).toBe(false);
      view.setTideLevel(0);
      expect(mesh.visible).toBe(false);
    } finally {
      view.dispose();
    }
  });

  it('tracks the next dry cue from the Hoofington flood across rises and scene settings', () => {
    const island = generateIsland();
    const view = createWorldScene(island, { chunkSegments: 24, cullingDistance: 340 });
    const position = { x: -132.93, z: 123.14 };
    const distance = (point: { x: number; z: number }): number =>
      Math.hypot(point.x - position.x, point.z - position.z);
    try {
      expect(view.tideRouteTarget(position)).toBeUndefined();
      view.setTideLevel(island.seaLevel, true);
      const start = view.tideRouteTarget(position)!;
      expect(distance(start)).toBeLessThan(17);

      view.setTideLevel(7, true);
      const firstRise = view.tideRouteTarget(position)!;
      expect(firstRise).not.toEqual(start);
      expect(distance(firstRise)).toBeGreaterThan(47);
      expect(distance(firstRise)).toBeLessThan(49);
      expect(firstRise.x).toBeCloseTo(-112.5, 0);
      expect(firstRise.z).toBeCloseTo(79.8, 0);
      expect(firstRise.y).toBeGreaterThan(7.68);

      const camera = new THREE.PerspectiveCamera(67, 1.6, .07, 2200);
      camera.position.set(position.x, 9, position.z);
      camera.lookAt(-76, 7, 80);
      for (const lighting of ['night', 'golden-hour', 'day'] as const) {
        view.setLightingPreset(lighting);
        view.updateCulling(camera);
        expect(view.tideRouteTarget(position)).toEqual(firstRise);
      }

      view.setTideLevel(12, true);
      const secondRise = view.tideRouteTarget(position)!;
      expect(secondRise).not.toEqual(firstRise);
      expect(secondRise.y).toBeGreaterThan(12.68);
      expect(distance(secondRise)).toBeGreaterThan(distance(firstRise));
      view.setTideLevel(130, true);
      expect(view.tideRouteTarget(position)).toBeUndefined();

      view.setTideLevel(7, false);
      expect(view.tideRouteTarget(position)).toBeUndefined();
      view.setTideLevel(island.seaLevel, true);
      expect(view.tideRouteTarget(position)).toEqual(start);
    } finally {
      view.dispose();
    }
  });

  it('keeps painted markers above the real terrain and road surfaces at both LODs', () => {
    const view = createWorldScene(generateIsland());
    try {
      const mesh = view.group.getObjectByName('rising-tide-escape-route-cues') as THREE.Mesh;
      const bookmark = findBookmark('16')!;
      view.setTideLevel(bookmark.tide);
      view.group.updateMatrixWorld(true);
      const camera = new THREE.PerspectiveCamera(bookmark.fov, 1.6, .1, 2000);
      camera.position.copy(bookmark.camera);
      camera.lookAt(bookmark.target.x, bookmark.target.y, bookmark.target.z);
      const surfaces = [view.group.getObjectByName('paths-road')!,
        view.group.getObjectByName('paths-trail')!, ...view.chunks];
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      const high = view.chunks.map(chunk => chunk.geometry);
      const points = activePoints(mesh);
      expect(points.length).toBeGreaterThan(500);
      const vertices = new Map(points.map(p => [p.toArray().join(','), p]));
      for (const detail of ['high', 'low']) {
        if (detail === 'low') {
          view.updateCulling(camera);
          expect(view.chunks.some((chunk, i) => chunk.geometry !== high[i])).toBe(true);
        }
        for (const point of vertices.values()) {
          ray.ray.origin.set(point.x, 130, point.z);
          const surface = ray.intersectObjects(surfaces, false)[0]!.point.y;
          expect(point.y - surface, detail + ' LOD').toBeGreaterThanOrEqual(.003);
        }
      }
    } finally {
      view.dispose();
    }
  });
});
