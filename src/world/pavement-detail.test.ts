import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateIsland } from './island';
import { buildGroundDetails } from './visual-ground';
import { buildStreetDetails } from './visual-streets';
import { roadRibbonData } from './road-ribbons';
import { buildPavementDetails, projectPavementPatches } from './pavement-detail';

describe('lived-in pavement', () => {
  it('clips decals to a sloping indexed surface and interpolates its height', () => {
    const surface = new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2);
    const pos = surface.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, 3 + .2 * pos.getX(i) - .1 * pos.getZ(i));
    const overlay = projectPavementPatches(surface, [{
      outline: [{ x: -1, z: -1 }, { x: 3, z: -1 }, { x: 3, z: 1 }, { x: -1, z: 1 }],
      color: 0x555555, opacity: .5,
    }], .004);
    const vertices = overlay.getAttribute('position'), index = overlay.index!;
    let area = 0;
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), z = vertices.getZ(i);
      expect(x).toBeGreaterThanOrEqual(-1.00001);
      expect(x).toBeLessThanOrEqual(2.00001);
      expect(vertices.getY(i)).toBeCloseTo(3 + .2 * x - .1 * z + .004, 5);
      expect(overlay.getAttribute('color').getW(i)).toBeCloseTo(.5);
    }
    for (let i = 0; i < index.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(vertices, index.getX(i));
      const b = new THREE.Vector3().fromBufferAttribute(vertices, index.getX(i + 1));
      const c = new THREE.Vector3().fromBufferAttribute(vertices, index.getX(i + 2));
      area += Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
    }
    expect(area).toBeCloseTo(6, 5);
    overlay.dispose(); surface.dispose();
  });

  it('batches deterministic visual-only wear onto real district paving', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const ground = buildGroundDetails(island), streets = buildStreetDetails(island);
    const roads = new THREE.Group();
    const { positions, indices } = roadRibbonData(island, 'road');
    const road = new THREE.BufferGeometry();
    road.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    road.setIndex(indices);
    const mesh = new THREE.Mesh(road);
    mesh.name = 'paths-road'; roads.add(mesh);
    const before = island.colliders.length;
    const a = buildPavementDetails(island, ground, streets, roads);
    const b = buildPavementDetails(island, ground, streets, roads);
    expect(a.children.map(o => o.name)).toEqual([
      'crane-apron-joints-and-wear', 'downtown-road-maintenance',
      'downtown-sidewalk-joints-and-utility-lids', 'hoofington-road-maintenance',
    ]);
    expect(island.colliders.length).toBe(before);
    for (let i = 0; i < a.children.length; i++) {
      const first = a.children[i] as THREE.Mesh, second = b.children[i] as THREE.Mesh;
      expect(first.castShadow).toBe(false);
      expect(first.geometry.index!.count).toBeGreaterThan(0);
      expect(first.geometry.index!.count).toBeLessThan(15000);
      const pos = first.geometry.getAttribute('position');
      expect(Array.from(pos.array).every(Number.isFinite)).toBe(true);
      expect(pos.array).toEqual(second.geometry.getAttribute('position').array);
      const colors = first.geometry.getAttribute('color');
      expect(colors.itemSize).toBe(4);
      for (let j = 0; j < colors.count; j++) {
        expect(colors.getW(j)).toBeGreaterThan(0);
        expect(colors.getW(j)).toBeLessThanOrEqual(1);
      }
    }
    const materials = new Set<THREE.Material>();
    for (const group of [a, b, ground, streets, roads]) group.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
    });
    for (const m of materials) m.dispose();
  });
});
