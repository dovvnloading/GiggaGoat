import { describe, expect, it } from 'vitest';
import { generateIsland } from './index';
import { gridSample } from './terrain';

describe('Crane Yard scenery exclusion (IS-5)', () => {
  it.each([
    { seed: 'billy-isle', size: 600 },
    { seed: 'scenery-yard-alt', size: 900 },
  ])('keeps scattered vegetation outside the fenced yard for $seed at $size m', ({ seed, size }) => {
    const island = generateIsland({ seed, size, resolution: 97 });
    const centre = island.pois.find(p => p.id === 'crane-yard')!.center;
    const scale = island.size / 600;
    const kinds = new Set(['tree-pine', 'tree-oak', 'bush', 'flower', 'grass-tuft']);
    // The dressing scatter owns detail-* descriptors. Do not reject authored
    // vegetation elsewhere on the island or change the Crane Yard plan.
    const scenery = island.props.filter(prop =>
      prop.id.startsWith('detail-') && kinds.has(prop.kind));
    expect(scenery.length).toBeGreaterThan(100);
    for (const prop of scenery) {
      const { x, z } = prop.transform.position;
      const inside = Math.abs(x - centre.x) <= 41 * scale &&
        Math.abs(z - centre.z) <= 37 * scale;
      expect(inside, seed + ': ' + prop.id + ' inside Crane Yard fence').toBe(false);
    }
  });
});

describe('Mt. Gigga deterministic tier foliage (MG-7)', () => {
  it('plants 70 pines and 30 bushes on gentle tier tops away from roads and other props', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const summit = island.pois.find(poi => poi.id === 'mt-gigga')!.center;
    const scale = island.size / 600;
    const prefix = 'detail-mt-gigga-';
    const trees = island.props.filter(p => p.id.startsWith(prefix + 'tree-pine-'));
    const bushes = island.props.filter(p => p.id.startsWith(prefix + 'bush-'));
    expect(trees).toHaveLength(70);
    expect(bushes).toHaveLength(30);
    const planted = [...trees, ...bushes];
    const oldProps = island.props.filter(p => p.poiId === 'mt-gigga' &&
      !planted.includes(p));
    const roads = island.roads.flatMap(road => road.points);
    const step = 1.5 * scale;
    for (const prop of planted) {
      const { x, z } = prop.transform.position;
      const r = Math.hypot(x - summit.x, z - summit.z) / scale;
      expect(r, prop.id).toBeGreaterThanOrEqual(22 - 1e-5);
      expect(r, prop.id).toBeLessThanOrEqual(100 + 1e-5);
      const dx = (gridSample(island, x + step, z) -
        gridSample(island, x - step, z)) / (2 * step);
      const dz = (gridSample(island, x, z + step) -
        gridSample(island, x, z - step)) / (2 * step);
      expect(Math.hypot(dx, dz), prop.id + ' slope').toBeLessThan(0.5);
      expect(roads.every(p => Math.hypot(x - p.x, z - p.z) >= 5 * scale),
        prop.id + ' road/trail clearance').toBe(true);
      expect(oldProps.every(p => Math.hypot(x - p.transform.position.x,
        z - p.transform.position.z) >= 5 * scale),
        prop.id + ' old prop clearance').toBe(true);
      expect(prop.shape, prop.id).toBe('cylinder');
      expect(prop.size.z, prop.id).toBeCloseTo(prop.size.x, 6);
      const h = prop.size.y / scale;
      if (prop.kind === 'tree-pine') {
        expect(h).toBeGreaterThanOrEqual(6);
        expect(h).toBeLessThanOrEqual(10);
        expect(prop.size.x, prop.id).toBeCloseTo(prop.size.y * 0.35, 6);
      } else {
        expect(prop.kind).toBe('bush');
        expect(h).toBeGreaterThanOrEqual(1.6);
        expect(h).toBeLessThanOrEqual(2.4);
        expect(prop.size.x, prop.id).toBeCloseTo(prop.size.y * 1.25, 6);
      }
    }
    for (const [lo, hi] of [[22, 38], [45, 56], [63, 74], [81, 100]] as const) {
      expect(trees.some(p => {
        const d = Math.hypot(p.transform.position.x - summit.x,
          p.transform.position.z - summit.z) / scale;
        return d >= lo && d <= hi;
      }), 'mountain tier ' + lo + '-' + hi).toBe(true);
    }
  });

  it('replays the new tier foliage identically for the same seed', () => {
    const select = (seed: string) => generateIsland({ seed, resolution: 97 })
      .props.filter(p => p.id.startsWith('detail-mt-gigga-tree-pine-') ||
        p.id.startsWith('detail-mt-gigga-bush-'))
      .map(p => ({ kind: p.kind, transform: p.transform, size: p.size }));
    expect(select('billy-isle')).toEqual(select('billy-isle'));
    expect(select('billy-isle')).not.toEqual(select('gigga-alt'));
  });
});
