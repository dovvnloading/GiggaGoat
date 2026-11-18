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

describe('Whispering Pines glade waterfall (WP-14)', () => {
  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'pines-alt', size: 900, resolution: 97 },
  ])('uses the native stepped model and at most three clear rock supports ($seed)',
    ({ seed, size, resolution }) => {
      const island = generateIsland({ seed, size, resolution });
      const scale = size / 600;
      const bridge = island.props.find(prop => prop.kind === 'log-bridge' &&
        prop.poiId === 'whispering-pines')!;
      const lookout = island.props.find(prop => prop.kind === 'lookout' &&
        prop.poiId === 'whispering-pines')!;
      const fall = island.props.find(prop => prop.id === 'whispering-pines-glade-cascade');
      const rocks = island.props.filter(prop => prop.id.startsWith('whispering-pines-glade-lip-'));
      if (!fall) {
        expect(rocks).toHaveLength(0);
        return;
      }
      expect(fall.kind).toBe('cascade');
      expect(fall.poiId).toBe('whispering-pines');
      expect(fall.size).toEqual({
        x: 6.6 * scale, y: 10.5 * scale, z: 9.2 * scale,
      });
      expect(fall.collidable).toBe(false);
      expect(fall.lickable).toBe(false);
      expect(fall.climbable).toBe(false);
      expect(island.colliders.some(c => c.shape !== 'heightfield' &&
        c.id === fall.id)).toBe(false);
      const bp = bridge.transform.position, fp = fall.transform.position;
      expect(Math.hypot(fp.x - bp.x, fp.z - bp.z)).toBeGreaterThanOrEqual(8 * scale);
      expect(Math.hypot(fp.x - lookout.transform.position.x,
        fp.z - lookout.transform.position.z)).toBeGreaterThanOrEqual(
        Math.min(fall.size.x, fall.size.z) / 2);
      const yaw = fall.transform.rotationY, sin = Math.sin(yaw), cos = Math.cos(yaw);
      expect(rocks.length).toBeLessThanOrEqual(3);
      const spec = {
        back: { x: 0, z: -fall.size.z / 2 - 1.5 * scale,
          size: { x: 6 * scale, y: 7 * scale, z: 5 * scale } },
        left: { x: -(fall.size.x / 2 + 1.5 * scale), z: -fall.size.z / 4,
          size: { x: 5 * scale, y: 6 * scale, z: 5 * scale } },
        right: { x: fall.size.x / 2 + 1.5 * scale, z: -fall.size.z / 4,
          size: { x: 5 * scale, y: 6 * scale, z: 4 * scale } },
      };
      for (const rock of rocks) {
        const name = rock.id.slice('whispering-pines-glade-lip-'.length);
        expect(['back', 'left', 'right']).toContain(name);
        const target = spec[name as keyof typeof spec];
        expect(rock.size).toEqual(target.size);
        expect(rock.kind).toBe('rock');
        expect(rock.collidable).toBe(true);
        expect(rock.shape).toBe('convex');
        expect(rock.transform.rotationY).toBeCloseTo(yaw, 6);
        expect(rock.transform.position.x).toBeCloseTo(fp.x + cos * target.x +
          sin * target.z, 5);
        expect(rock.transform.position.z).toBeCloseTo(fp.z - sin * target.x +
          cos * target.z, 5);
        expect(rock.transform.position.y - rock.size.y / 2).toBeCloseTo(
          gridSample(island, rock.transform.position.x, rock.transform.position.z), 5);
        expect(island.colliders.some(c => c.shape !== 'heightfield' && c.id === rock.id))
          .toBe(true);
      }
    });

  it('never throws while searching differing seeds and sizes', () => {
    for (const [seed, size] of [['pines-alt', 900], ['wp4-low', 400],
      ['wp4-cliff', 1200]] as const) {
      expect(() => generateIsland({ seed, size, resolution: 65 })).not.toThrow();
    }
  });
});
