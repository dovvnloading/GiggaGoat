import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWorldScene, generateIsland } from './index';
import { gridIndex } from './terrain';

describe('Mt. Gigga grassy tiers and fragment stone (MG-7 / IS-15)', () => {
  it('keeps flat tiers and steep risers grassy in the vertex buffer', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    // Test the mountain palette independently of the unchanged trail paint.
    island.roads = [];
    const scene = createWorldScene(island, { chunkSegments: 32 });
    const scale = island.size / 600;
    const cell = island.size / (island.resolution - 1);
    const grass = new THREE.Color(0x77b754).lerp(new THREE.Color(0x568f59), 0.12);
    const heights = (ix: number, iz: number): number =>
      island.heights[gridIndex(island.resolution,
        Math.max(0, Math.min(island.resolution - 1, ix)),
        Math.max(0, Math.min(island.resolution - 1, iz)))]!;
    let grassyVertices = 0, riserVertices = 0;
    try {
      for (const chunk of scene.chunks) {
        const pos = chunk.geometry.getAttribute('position');
        const colour = chunk.geometry.getAttribute('color');
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i) + chunk.position.x;
          const z = pos.getZ(i) + chunk.position.z;
          const r = Math.hypot(x, z) / scale;
          const greenCandidate = r > 12 && r < 94;
          const rockCandidate = [[19, 26], [38, 45], [56, 63], [74, 81]]
            .some(([inner, outer]) => r > inner! + 2 && r < outer! - 2);
          if (!greenCandidate && !rockCandidate) continue;
          const ix = Math.round((x / island.size + 0.5) * (island.resolution - 1));
          const iz = Math.round((z / island.size + 0.5) * (island.resolution - 1));
          const h = pos.getY(i);
          const slope = Math.hypot(
            (heights(ix + 1, iz) - heights(ix - 1, iz)) / (2 * cell),
            (heights(ix, iz + 1) - heights(ix, iz - 1)) / (2 * cell));
          const isGreen = greenCandidate && slope < 0.55;
          const isRiser = rockCandidate && slope > 1.2;
          if (!isGreen && !isRiser) continue;
          const depression = Math.max(0, (
            heights(ix + 1, iz) + heights(ix - 1, iz) +
            heights(ix, iz + 1) + heights(ix, iz - 1)) * 0.25 - h);
          const ambient = 1 - Math.min(0.16, depression * 0.07);
          const broad = Math.sin(x * 0.071 + Math.cos(z * 0.039) * 1.4) *
            Math.cos(z * 0.092 - Math.sin(x * 0.047));
          const fine = Math.sin(x * 0.36 + z * 0.17) *
            Math.cos(z * 0.29 - x * 0.21);
          const variation = 0.968 + broad * 0.038 + fine * 0.022;
          // Even vertical faces retain grass in vertex colour: fragment
          // normals, not 3.1 m-spaced vertices, now select visible stone.
          const expected = grass.clone().multiplyScalar(ambient * variation);
          const delta = Math.hypot(
            colour.getX(i) - expected.r,
            colour.getY(i) - expected.g,
            colour.getZ(i) - expected.b);
          expect(delta, (isGreen ? 'flat grass' : 'steep grass') +
            ' at (' + x.toFixed(1) + ',' + z.toFixed(1) + ')')
            .toBeLessThan(0.015);
          if (isGreen) grassyVertices++;
          if (isRiser) riserVertices++;
        }
      }
      expect(grassyVertices).toBeGreaterThan(10);
      expect(riserVertices).toBeGreaterThan(5);
    } finally {
      scene.dispose();
    }
  });
});
