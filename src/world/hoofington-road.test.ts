import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland } from './index';
import { makeLocalStreets } from './roads';

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

/** Footprint of the actual instanced unit box, including road grade and yaw. */
function instanceFootprint(mesh: THREE.InstancedMesh, index: number): Footprint {
  const matrix = new THREE.Matrix4();
  const corner = new THREE.Vector3();
  mesh.getMatrixAt(index, matrix);
  const xs: number[] = [], zs: number[] = [];
  for (const x of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
    corner.set(x, 0.5, z).applyMatrix4(matrix);
    xs.push(corner.x);
    zs.push(corner.z);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

describe('Hoofington E1: road surface and painted crossing', () => {
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
        for (const name of ['paths-trail', 'paved-village-sidewalks', 'raised-stone-curbs']) {
          const mesh = view.group.getObjectByName(name) as THREE.InstancedMesh;
          expect(mesh, name).toBeInstanceOf(THREE.InstancedMesh);
          for (let i = 0; i < mesh.count; i++) {
            if (overlaps(instanceFootprint(mesh, i))) intrusions.push(name + '[' + i + ']');
          }
        }

        // Surface decals are world-space triangles merged into ground chunks.
        const details = view.group.getObjectByName('merged-ground-details') as THREE.Group;
        expect(details).toBeInstanceOf(THREE.Group);
        for (const item of details.children) {
          if (!(item instanceof THREE.Mesh)) continue;
          const positions = item.geometry.getAttribute('position');
          const triangles = item.geometry.getIndex()!;
          for (let i = 0; i < triangles.count; i += 3) {
            const a = triangles.getX(i), b = triangles.getX(i + 1), c = triangles.getX(i + 2);
            const footprint = {
              minX: Math.min(positions.getX(a), positions.getX(b), positions.getX(c)),
              maxX: Math.max(positions.getX(a), positions.getX(b), positions.getX(c)),
              minZ: Math.min(positions.getZ(a), positions.getZ(b), positions.getZ(c)),
              maxZ: Math.max(positions.getZ(a), positions.getZ(b), positions.getZ(c)),
            };
            if (overlaps(footprint)) intrusions.push(item.name + '[' + i / 3 + ']');
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
      const material = mesh.material as THREE.MeshBasicMaterial;
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
