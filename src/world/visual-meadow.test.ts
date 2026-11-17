import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateIsland } from './index';
import { buildMeadowScatter } from './visual-meadow';

describe('island meadow grass clumps (IS-5)', () => {
  it('merges exactly two flattened octahedra into a low 16-triangle instanced tuft', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const group = buildMeadowScatter(island);
    try {
      const tuft = group.getObjectByName('meadow-grass-sprigs') as THREE.InstancedMesh;
      const flowers = group.getObjectByName('meadow-daisy-flowers') as THREE.InstancedMesh;
      expect(group.children).toHaveLength(2);
      expect(tuft).toBeInstanceOf(THREE.InstancedMesh);
      expect(flowers).toBeInstanceOf(THREE.InstancedMesh);
      expect(tuft.count).toBeGreaterThan(1000);
      expect(tuft.instanceColor).not.toBeNull();
      expect(tuft.geometry).not.toBeInstanceOf(THREE.ConeGeometry);
      const attribute = tuft.geometry.getAttribute('position') as THREE.BufferAttribute;
      const triangleCount = (tuft.geometry.index?.count ?? attribute.count) / 3;
      expect(triangleCount).toBe(16);
      tuft.geometry.computeBoundingBox();
      const bounds = tuft.geometry.boundingBox!;
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.003);
      expect(bounds.max.y).toBeLessThanOrEqual(0.25);

      // Compare every vertex with the requested two octahedra. This also
      // rejects cone leaves even if they happen to meet the triangle budget.
      const expected = [
        new THREE.OctahedronGeometry(0.2, 0),
        new THREE.OctahedronGeometry(0.15, 0),
      ];
      try {
        expected[0]!.scale(1.35, 0.5, 1.35);
        expected[0]!.translate(0, 0.1, 0);
        expected[1]!.scale(1.3, 0.55, 1.3);
        expected[1]!.translate(0.14, 0.08, -0.06);
        let start = 0;
        for (const part of expected) {
          const positions = part.getAttribute('position') as THREE.BufferAttribute;
          for (let i = 0; i < positions.count; i++) {
            expect(attribute.getX(start + i)).toBeCloseTo(positions.getX(i), 6);
            expect(attribute.getY(start + i)).toBeCloseTo(positions.getY(i), 6);
            expect(attribute.getZ(start + i)).toBeCloseTo(positions.getZ(i), 6);
          }
          start += positions.count;
        }
        expect(start).toBe(attribute.count);
      } finally {
        expected.forEach(part => part.dispose());
      }
      // Wildflowers remain a separate instanced mesh with baked part colours.
      expect(flowers.geometry.getAttribute('color')).toBeDefined();
      expect(flowers.count).toBeGreaterThan(100);
    } finally {
      group.traverse(node => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach(material => material.dispose());
        }
      });
    }
  });
});
