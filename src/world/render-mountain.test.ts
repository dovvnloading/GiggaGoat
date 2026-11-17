import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWorldScene, generateIsland } from './index';
import { gridIndex } from './terrain';

describe('Mt. Gigga grassy tier and stone palette (MG-7)', () => {
  it('keeps gentle mountain terrain green and true cliffs warm-grey with height strata', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const scene = createWorldScene(island, { chunkSegments: 32 });
    const scale = island.size / 600;
    const cell = island.size / (island.resolution - 1);
    const grass = new THREE.Color(0x77b754).lerp(new THREE.Color(0x568f59), 0.12);
    const stone = new THREE.Color(0xa39a96);
    const trailPoints = island.roads.filter(road => road.type === 'trail')
      .flatMap(road => road.points.filter(point => Math.hypot(point.x, point.z) < 110 * scale));
    const heights = (ix: number, iz: number): number =>
      island.heights[gridIndex(island.resolution,
        Math.max(0, Math.min(island.resolution - 1, ix)),
        Math.max(0, Math.min(island.resolution - 1, iz)))]!;
    let grassyVertices = 0, cliffVertices = 0;
    try {
      for (const chunk of scene.chunks) {
        const pos = chunk.geometry.getAttribute('position');
        const colour = chunk.geometry.getAttribute('color');
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i) + chunk.position.x;
          const z = pos.getZ(i) + chunk.position.z;
          const r = Math.hypot(x, z) / scale;
          const greenCandidate = r > 27 && r < 37;
          const rockCandidate = r > 21 && r < 24;
          if (!greenCandidate && !rockCandidate) continue;
          if (trailPoints.some(p => Math.hypot(x - p.x, z - p.z) < 9 * scale))
            continue;
          const ix = Math.round((x / island.size + 0.5) * (island.resolution - 1));
          const iz = Math.round((z / island.size + 0.5) * (island.resolution - 1));
          const h = pos.getY(i);
          const slope = Math.hypot(
            (heights(ix + 1, iz) - heights(ix - 1, iz)) / (2 * cell),
            (heights(ix, iz + 1) - heights(ix, iz - 1)) / (2 * cell));
          const isGreen = greenCandidate && slope < 0.55;
          const isStone = rockCandidate && slope > 1.2;
          if (!isGreen && !isStone) continue;
          const depression = Math.max(0, (
            heights(ix + 1, iz) + heights(ix - 1, iz) +
            heights(ix, iz + 1) + heights(ix, iz - 1)) * 0.25 - h);
          const ambient = 1 - Math.min(0.16, depression * 0.07);
          const broad = Math.sin(x * 0.071 + Math.cos(z * 0.039) * 1.4) *
            Math.cos(z * 0.092 - Math.sin(x * 0.047));
          const fine = Math.sin(x * 0.36 + z * 0.17) *
            Math.cos(z * 0.29 - x * 0.21);
          const variation = 0.968 + broad * 0.038 + fine * 0.022;
          const expected = (isGreen ? grass.clone() :
            stone.clone().multiplyScalar(0.93 + 0.07 * Math.sin(h / scale * 0.85)))
            .multiplyScalar(ambient * variation);
          const delta = Math.hypot(
            colour.getX(i) - expected.r,
            colour.getY(i) - expected.g,
            colour.getZ(i) - expected.b);
          expect(delta, (isGreen ? 'grass' : 'stratified stone') +
            ' at (' + x.toFixed(1) + ',' + z.toFixed(1) + ')')
            .toBeLessThan(0.015);
          if (isGreen) grassyVertices++;
          if (isStone) cliffVertices++;
        }
      }
      expect(grassyVertices).toBeGreaterThan(10);
      expect(cliffVertices).toBeGreaterThan(5);
    } finally {
      scene.dispose();
    }
  });
});
