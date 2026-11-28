import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { LANTERN_HEIGHT } from '../world/lantern';
import { PROP_LIBRARY_MODELS } from '../world/library-props';
import { cutLanternSection } from './lantern-section';

function measure(root: THREE.Object3D) {
  const materials = new Map<string, number>();
  let bottom = Infinity, top = -Infinity;
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const geo = object.geometry, pos = geo.getAttribute('position'), ind = geo.index;
    const material = (object.material as THREE.Material).name;
    for (let i = 0; i < (ind?.count ?? pos.count); i += 3) {
      const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, ind?.getX(i + k) ?? i + k));
      const area = new THREE.Triangle(a!, b!, c!).getArea();
      if (area < 1e-9) continue;
      materials.set(material, (materials.get(material) ?? 0) + area);
      bottom = Math.min(bottom, a!.y, b!.y, c!.y);
      top = Math.max(top, a!.y, b!.y, c!.y);
    }
  });
  return { materials, bottom, top };
}

it('reassembles the six painted lamp materials at their original height under full and reduced debris budgets', async () => {
  const bytes = readFileSync('public/' + PROP_LIBRARY_MODELS.lamp);
  const { scene } = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
  const original = measure(scene);
  expect(original.materials.size).toBe(6);
  expect(original.bottom).toBeCloseTo(0, 5);
  expect(original.top).toBeCloseTo(LANTERN_HEIGHT, 5);
  for (const count of [1, 3, 6]) {
    const totals = new Map<string, number>();
    const half = LANTERN_HEIGHT / (2 * count);
    for (let index = 0; index < count; index++) {
      const section = cutLanternSection(scene, index, count);
      const { materials, bottom, top } = measure(section);
      expect(materials.size).toBeGreaterThan(0);
      expect(bottom).toBeGreaterThanOrEqual(-half - .00001);
      expect(top).toBeLessThanOrEqual(half + .00001);
      for (const [name, area] of materials) totals.set(name, (totals.get(name) ?? 0) + area);
      section.traverse(part => { if (part instanceof THREE.Mesh) part.geometry.dispose(); });
    }
    for (const [name, area] of original.materials) expect(totals.get(name), name).toBeCloseTo(area, 5);
  }
});
