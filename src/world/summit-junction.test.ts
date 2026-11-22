import { describe, expect, it } from 'vitest';
import { generateIsland } from './island';
import { roadRibbonData } from './road-ribbons';

describe('Mt. Gigga summit junction', () => {
  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'summit-small', size: 400, resolution: 97 },
    { seed: 'summit-large', size: 900, resolution: 97 },
  ])('has a single physical trail surface through the junction at $size m', options => {
    const island = generateIsland(options);
    const summit = island.pois.find(p => p.id === 'mt-gigga')!.center;
    const surface = roadRibbonData(island, 'trail');
    const triangles: number[][] = [];
    for (let i = 0; i < surface.supportIndices.length; i += 3) {
      const t = surface.supportIndices.slice(i, i + 3).flatMap(index => surface.positions.slice(index * 3, index * 3 + 3));
      if (Math.min(...[t[0]!, t[3]!, t[6]!]) > summit.x + 8 ||
          Math.max(...[t[0]!, t[3]!, t[6]!]) < summit.x - 8 ||
          Math.min(...[t[2]!, t[5]!, t[8]!]) > summit.z + 8 ||
          Math.max(...[t[2]!, t[5]!, t[8]!]) < summit.z - 8) continue;
      triangles.push(t);
    }
    const hits = (x: number, z: number) => triangles.filter(t => {
      const ax = t[0]! - t[6]!, az = t[2]! - t[8]!;
      const bx = t[3]! - t[6]!, bz = t[5]! - t[8]!;
      const dx = x - t[6]!, dz = z - t[8]!;
      const area = ax * bz - bx * az;
      if (Math.abs(area) < 1e-8) return false;
      const u = (dx * bz - bx * dz) / area, v = (ax * dz - dx * az) / area;
      return Math.min(u, v, 1 - u - v) > 1e-6;
    }).length;
    let covered = 0;
    for (let x = -4.97; x < 5; x += .23) for (let z = -4.91; z < 5; z += .23) {
      const count = hits(summit.x + x, summit.z + z);
      expect(count, `overlap at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBeLessThanOrEqual(1);
      if (count) covered++;
    }
    expect(covered).toBeGreaterThan(100);
    for (const road of island.roads.filter(r => r.type === 'trail' &&
      (r.from === 'mt-gigga' || r.to === 'mt-gigga'))) {
      const points = road.from === 'mt-gigga' ? road.points : [...road.points].reverse();
      const a = points[0]!, b = points[1]!;
      expect(hits(a.x * .35 + b.x * .65, a.z * .35 + b.z * .65), road.id).toBe(1);
    }
  });
});
