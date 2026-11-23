import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateIsland } from './island';
import { gridSample } from './terrain';
import { LIGHTHOUSE_FOOTPATH, lighthouseAccess } from './lighthouse-access';
import { makeLighthouseFlowers } from './visual-lighthouse';

describe('Old Lighthouse plants', () => {
  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'cape-small', size: 400, resolution: 97 },
    { seed: 'cape-large', size: 900, resolution: 97 },
  ])('keep visible plants outside buildings and access routes at size $size', options => {
    const island = generateIsland(options), scale = options.size / 600;
    const center = island.pois.find(p => p.id === 'old-lighthouse')!.center;
    const group = makeLighthouseFlowers(island, center);
    const repeat = makeLighthouseFlowers(island, center);
    const grass = group.getObjectByName('lighthouse-grass') as THREE.InstancedMesh;
    const flowers = group.getObjectByName('lighthouse-wildflowers') as THREE.InstancedMesh;
    const buildings = island.props.filter(p => p.poiId === 'old-lighthouse' &&
      ['house', 'cottage', 'lighthouse', 'cave-mouth', 'dock', 'platform'].includes(p.kind));
    const tower = buildings.find(p => p.kind === 'lighthouse')!;
    const stairs = lighthouseAccess(tower, (x, z) => gridSample(island, x, z));
    const curve = new THREE.CatmullRomCurve3(LIGHTHOUSE_FOOTPATH.map(([x, z]) =>
      new THREE.Vector3(center.x + x * scale, 0, center.z + z * scale)), false, 'centripetal');
    const path = curve.getPoints(288);
    try {
      expect(grass.count).toBe(32);
      expect(flowers.count).toBe(32);
      for (const mesh of [grass, flowers]) {
        const again = repeat.getObjectByName(mesh.name) as THREE.InstancedMesh;
        expect(Array.from(mesh.instanceMatrix.array)).toEqual(Array.from(again.instanceMatrix.array));
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox!;
        const localRadius = Math.max(...[box.min.x, box.max.x].flatMap(x =>
          [box.min.z, box.max.z].map(z => Math.hypot(x, z))));
        const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
        const rotation = new THREE.Quaternion(), size = new THREE.Vector3();
        const seen: THREE.Vector3[] = [];
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          matrix.decompose(position, rotation, size);
          expect(position.toArray().every(Number.isFinite)).toBe(true);
          expect(size.x).toBeGreaterThan(0);
          expect(position.y).toBeCloseTo(gridSample(island, position.x, position.z), 3);
          expect(position.y).toBeGreaterThan(island.seaLevel + .19 * scale);
          const radius = localRadius * Math.max(size.x, size.z);
          for (const prop of buildings) {
            const dx = position.x - prop.transform.position.x, dz = position.z - prop.transform.position.z;
            const c = Math.cos(prop.transform.rotationY), s = Math.sin(prop.transform.rotationY);
            const outsideX = Math.max(0, Math.abs(c * dx - s * dz) - prop.size.x / 2);
            const outsideZ = Math.max(0, Math.abs(s * dx + c * dz) - prop.size.z / 2);
            expect(Math.hypot(outsideX, outsideZ), `${mesh.name} ${i} / ${prop.id}`)
              .toBeGreaterThan(radius);
            if (prop.kind === 'cave-mouth') {
              expect(Math.hypot(outsideX, outsideZ), `${mesh.name} ${i} / cave approach`)
                .toBeGreaterThan(2.9 * scale);
            }
          }
          const distanceToPath = Math.min(...path.map(p => Math.hypot(p.x - position.x, p.z - position.z)));
          expect(distanceToPath, `${mesh.name} ${i} / footpath`).toBeGreaterThan(2.52 * scale + radius);
          for (const section of stairs) {
            const cx = (section.inner.x + section.outer.x) / 2;
            const cz = (section.inner.z + section.outer.z) / 2;
            const halfWidth = Math.hypot(section.inner.x - section.outer.x, section.inner.z - section.outer.z) / 2;
            expect(Math.hypot(position.x - cx, position.z - cz), `${mesh.name} ${i} / stairs`)
              .toBeGreaterThan(halfWidth + radius);
          }
          expect(seen.every(p => p.distanceTo(position) > .1 * scale)).toBe(true);
          seen.push(position.clone());
        }
      }
    } finally {
      for (const mesh of [...group.children, ...repeat.children] as THREE.InstancedMesh[]) {
        mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
      }
    }
  });
});
