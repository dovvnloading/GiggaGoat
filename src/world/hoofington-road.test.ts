import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildRapierColliders, createWorldScene, generateIsland } from './index';
import { makeLocalStreets } from './roads';
import { HOOFINGTON_FRONT_WALKS } from './hoofington-entrances';
import { HOOFINGTON_VERGE_WIDTH } from './hoofington-verge';
import { gridSample } from './terrain';

interface Footprint { minX: number; maxX: number; minZ: number; maxZ: number }

function intersectsRoad(
  box: Footprint, x: number, z: number, halfWidth: number, halfLength: number,
): boolean {
  const tolerance = 0.001;
  return box.maxX > x - halfWidth + tolerance &&
    box.minX < x + halfWidth - tolerance &&
    box.maxZ > z - halfLength + tolerance &&
    box.minZ < z + halfLength - tolerance;
}

describe('Hoofington E1: road surface and painted crossing', () => {
  it('supports goats at the rendered curb and sidewalk on both sides of the street', async () => {
    await RAPIER.init();
    const island = generateIsland();
    const farm = island.pois.find(p => p.id === 'hoofington')!.center;
    const street = makeLocalStreets(island).find(road => road.from === 'hoofington')!;
    const view = createWorldScene(island);
    const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      const { paths } = buildRapierColliders(physics, island);
      const verge = view.group.getObjectByName('hoofington-street-verge')!;
      const down = new THREE.Vector3(0, -1, 0);
      const rendered = new THREE.Raycaster(new THREE.Vector3(), down);
      view.group.updateMatrixWorld(true);
      for (const offset of [-29.7, -12.4, 4, 16.2, 31.8]) {
        for (const side of [-1, 1]) {
          for (const vergeOffset of [.18, .62, 1.65]) {
            const x = farm.x + side * (street.width / 2 + vergeOffset);
            const z = farm.z + offset;
            const y = 20;
            const label = `Hoofington at ${x}, ${z}`;
            rendered.ray.origin.set(x, y, z);
            const renderHit = rendered.intersectObject(verge)[0];
            expect(renderHit, label).toBeDefined();
            const physicsRay = new RAPIER.Ray({ x, y, z }, down);
            const pathHit = Math.min(...paths.map(path => path.castRay(physicsRay, y, false))
              .filter(distance => distance >= 0));
            expect(pathHit, label).toBeCloseTo(renderHit!.distance, 4);
          }
        }
      }
    } finally {
      physics.free();
      view.dispose();
    }
  });

  it('renders one asphalt deck through the village and joins both approach roads', () => {
    const island = generateIsland({ seed: 'billy-isle' });
    const farm = island.pois.find(p => p.id === 'hoofington')!.center;
    const view = createWorldScene(island);
    try {
      const road = view.group.getObjectByName('paths-road') as THREE.Mesh;
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      for (const dz of [-44.3, -42.3, -41.7, -27.3, -16.4, -5.9, 5.2, 16.1, 27.7, 41.7, 42.3, 44.3]) {
        ray.ray.origin.set(farm.x + .23, 50, farm.z + dz);
        expect(ray.intersectObject(road), 'asphalt at street offset ' + dz).toHaveLength(1);
      }
      for (const dz of [-39.6, -31.3, -16.1, 16.1, 28.1, 39.4]) {
        for (const side of [-1, 1]) {
          ray.ray.origin.set(farm.x + side * 4.15, 50, farm.z + dz);
          expect(ray.intersectObject(road), 'verge at street offset ' + dz).toHaveLength(0);
        }
      }
    } finally {
      view.dispose();
    }
  });

  it('keeps dirt trails, paving, curbs and surface props off the carriageway', () => {
    for (const seed of ['billy-isle', 'hoofington-e1']) {
      const island = generateIsland({ seed, resolution: 97 });
      const road = makeLocalStreets(island).find(r => r.from === 'hoofington')!;
      const centre = island.pois.find(p => p.id === 'hoofington')!.center;
      const scale = island.size / 600;
      const overlaps = (box: Footprint) => intersectsRoad(
        box, centre.x, centre.z, road.width / 2, 42 * scale);
      const view = createWorldScene(island);
      try {
        const intrusions: string[] = [];
        const inspectTriangles = (mesh: THREE.Mesh): void => {
          const positions = mesh.geometry.getAttribute('position');
          const triangles = mesh.geometry.getIndex()!;
          for (let i = 0; i < triangles.count; i += 3) {
            const a = triangles.getX(i), b = triangles.getX(i + 1);
            const c = triangles.getX(i + 2);
            const footprint = {
              minX: Math.min(positions.getX(a), positions.getX(b), positions.getX(c)),
              maxX: Math.max(positions.getX(a), positions.getX(b), positions.getX(c)),
              minZ: Math.min(positions.getZ(a), positions.getZ(b), positions.getZ(c)),
              maxZ: Math.max(positions.getZ(a), positions.getZ(b), positions.getZ(c)),
            };
            if (overlaps(footprint)) intrusions.push(mesh.name + '[' + i / 3 + ']');
          }
        };

        for (const name of ['paths-trail', 'paved-village-sidewalks', 'raised-stone-curbs']) {
          const mesh = view.group.getObjectByName(name) as THREE.Mesh;
          expect(mesh, name).toBeInstanceOf(THREE.Mesh);
          expect(mesh, name).not.toBeInstanceOf(THREE.InstancedMesh);
          inspectTriangles(mesh);
        }

        // Surface decals are world-space triangles merged into ground chunks.
        const details = view.group.getObjectByName('merged-ground-details') as THREE.Group;
        expect(details).toBeInstanceOf(THREE.Group);
        for (const item of details.children) {
          if (item instanceof THREE.Mesh) inspectTriangles(item);
        }

        const walks = details.getObjectByName('ground-detail-village-walks')!;
        const sidewalks = view.group.getObjectByName('hoofington-street-verge')!;
        const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
        const heightAt = (mesh: THREE.Object3D, x: number, z: number) => {
          ray.ray.origin.set(x, 50, z);
          const hit = ray.intersectObject(mesh)[0];
          expect(hit, `${mesh.name} at ${x}, ${z} in ${seed}`).toBeDefined();
          return hit!.point.y;
        };
        const verge = road.width / (2 * scale) + HOOFINGTON_VERGE_WIDTH;
        for (const { side, entryZ, points } of HOOFINGTON_FRONT_WALKS) {
          const entry = centre.z + entryZ * scale;
          const outer = centre.x + (verge + .012) * scale * side;
          const inner = centre.x + (verge - .012) * scale * side;
          expect(Math.abs(heightAt(walks, outer, entry) - heightAt(sidewalks, inner, entry)))
            .toBeLessThan(.025 * scale);
          const route = [[verge, entryZ], ...points] as const;
          for (let i = 1; i < route.length; i++) {
            const [aX, aZ] = route[i - 1]!, [bX, bZ] = route[i]!;
            for (const t of [.18, .49, .82, .998]) {
              const x = centre.x + THREE.MathUtils.lerp(aX, bX, t) * scale * side;
              const z = centre.z + THREE.MathUtils.lerp(aZ, bZ, t) * scale;
              expect(heightAt(walks, x, z)).toBeGreaterThan(gridSample(island, x, z) + .01 * scale);
            }
          }
        }

        // The authored flat/large props must stay on the neighbouring lawns.
        const surfaceKinds = new Set(['platform', 'bridge', 'ramp', 'hay-bale', 'ledge']);
        for (const prop of island.props) {
          if (!surfaceKinds.has(prop.kind)) continue;
          const { x, z } = prop.transform.position;
          const yaw = prop.transform.rotationY;
          const hx = (Math.abs(Math.cos(yaw)) * prop.size.x +
            Math.abs(Math.sin(yaw)) * prop.size.z) / 2;
          const hz = (Math.abs(Math.sin(yaw)) * prop.size.x +
            Math.abs(Math.cos(yaw)) * prop.size.z) / 2;
          if (overlaps({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz })) {
            intrusions.push(prop.id);
          }
        }
        expect(intrusions, seed).toEqual([]);
      } finally {
        view.dispose();
      }
    }
  });

  it('merges seven white, full-width 0.5 m stripes with 0.5 m gaps above the asphalt', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const road = makeLocalStreets(island).find(r => r.from === 'hoofington')!;
    const centre = island.pois.find(p => p.id === 'hoofington')!.center;
    const scale = island.size / 600;
    const view = createWorldScene(island);
    try {
      const mesh = view.group.getObjectByName('hoofington-zebra-crossing') as THREE.Mesh;
      expect(mesh).toBeInstanceOf(THREE.Mesh);
      expect(mesh).not.toBeInstanceOf(THREE.InstancedMesh);
      const material = mesh.material as THREE.MeshLambertMaterial;
      expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect(mesh.receiveShadow).toBe(true);
      expect(material.color.getHex()).toBe(0xffffff);
      expect(material.polygonOffset).toBe(true);
      const geometry = mesh.geometry;
      const positions = geometry.getAttribute('position');
      expect(positions.count).toBe(7 * 4);
      expect(geometry.getIndex()!.count).toBe(7 * 6);

      let lastEnd = 0;
      for (let stripe = 0; stripe < 7; stripe++) {
        const offset = stripe * 4;
        const xs = [0, 1, 2, 3].map(i => positions.getX(offset + i));
        const zs = [0, 1, 2, 3].map(i => positions.getZ(offset + i));
        const left = Math.min(...xs), right = Math.max(...xs);
        const near = Math.min(...zs), far = Math.max(...zs);
        expect(left).toBeCloseTo(centre.x - road.width / 2, 3);
        expect(right).toBeCloseTo(centre.x + road.width / 2, 3);
        expect(far - near).toBeCloseTo(0.5 * scale, 3);
        if (stripe > 0) expect(near - lastEnd).toBeCloseTo(0.5 * scale, 3);
        lastEnd = far;
        expect((near + far) / 2).toBeCloseTo(centre.z + (-21 + stripe) * scale, 3);

        for (let i = 0; i < 4; i++) {
          const vertex = offset + i;
          const z = positions.getZ(vertex);
          const next = road.points.findIndex(point => point.z >= z);
          expect(next).toBeGreaterThan(0);
          const a = road.points[next - 1]!, b = road.points[next]!;
          const roadY = THREE.MathUtils.lerp(a.y, b.y, (z - a.z) / (b.z - a.z));
          // +0.20 m for the asphalt slab, +0.02 m to prevent z-fighting.
          expect(positions.getY(vertex)).toBeCloseTo(roadY + 0.22, 2);
        }
      }
    } finally {
      view.dispose();
    }
  });
});

describe('Downtown street verge', () => {
  it('joins the curb and sidewalk over every grade change and follows the actual asphalt and terrain', () => {
    const island = generateIsland();
    const { width, points } = makeLocalStreets(island).find(road => road.from === 'downtown-bleatsville')!;
    const view = createWorldScene(island);
    try {
      view.group.updateMatrixWorld(true);
      const road = view.group.getObjectByName('paths-road')!;
      const curb = view.group.getObjectByName('raised-stone-curbs') as THREE.Mesh;
      const walk = view.group.getObjectByName('paved-village-sidewalks') as THREE.Mesh;
      const paint = view.group.getObjectByName('two-lane-edge-stripes') as THREE.Mesh;
      const street = view.group.getObjectByName('two-lane-streets-and-sidewalks')!;
      const terrain = view.group.children.filter(mesh => mesh.userData['terrainChunk']);
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      const heights = (objects: THREE.Object3D[], x: number, z: number) => {
        ray.ray.origin.set(x, 50, z);
        return ray.intersectObjects(objects, false).map(hit => hit.point.y);
      };
      const edge = width / 2;
      for (let i = 1; i < points.length - 1; i++) {
        const { x, z } = points[i]!;
        for (const side of [-1, 1]) {
          for (const [surface, offset] of [[curb, .19], [walk, 1.35]] as const) {
            const px = x + side * (edge + offset);
            const before = heights([surface], px, z - .008);
            const after = heights([surface], px, z + .008);
            expect(before, surface.name + ' before ' + z).toHaveLength(1);
            expect(after, surface.name + ' after ' + z).toHaveLength(1);
            expect(Math.abs(before[0]! - after[0]!), surface.name + ' step at ' + z).toBeLessThan(.01);
          }
          const px = x + side * (edge - .35);
          expect(heights([paint], px, z)).toEqual([]);
          const marking = heights([paint], px, z + .19)[0]!;
          expect(marking - heights([road], px, z + .19)[0]!).toBeCloseTo(.017, 3);

          const nearSeam = heights([curb], x + side * (edge + .355), z - .008)[0]!;
          const farSeam = heights([walk], x + side * (edge + .37), z - .008)[0]!;
          expect(nearSeam - farSeam).toBeCloseTo(.025, 2);
          const outer = x + side * (edge + 2.325);
          const paving = heights([walk], outer, z - .008)[0]!;
          expect(paving - heights(terrain, outer, z - .008)[0]!).toBeCloseTo(.055, 1);
          expect(heights([walk], x + side * (edge + 2.36), z - .008)).toEqual([]);
          expect(heights([curb], x + side * (edge + .01), z - .008)).toEqual([]);
        }
      }

      expect(street.children).toHaveLength(6);
      let triangles = 0;
      for (const [mesh, color] of [[curb, 0xf2e6ce], [walk, 0xdcd4ba], [paint, 0xf2e9cf]] as const) {
        expect(mesh.geometry.groups).toEqual([]);
        expect((mesh.material as THREE.MeshToonMaterial).color.getHex()).toBe(color);
        expect(mesh.castShadow).toBe(false);
        triangles += mesh.geometry.index!.count / 3;
      }
      expect(triangles).toBeLessThanOrEqual((points.length - 1) * 2 * 3 * 12);
    } finally {
      view.dispose();
    }
  });
});
