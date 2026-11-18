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

describe('Whispering Pines glade waterfall (WP-4)', () => {
  it('has a downstream-facing model and both collidable side rocks upstream of the log bridge', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const scale = island.size / 600;
    const bridge = island.props.find(prop => prop.kind === 'log-bridge' &&
      prop.poiId === 'whispering-pines')!;
    const cascade = island.props.find(prop => prop.id === 'whispering-pines-glade-cascade');
    expect(cascade).toBeDefined();
    expect(cascade!.kind).toBe('cascade');
    expect(cascade!.poiId).toBe('whispering-pines');
    expect(cascade!.size.y).toBeGreaterThanOrEqual(3.2 * scale);
    expect(cascade!.size.z).toBeCloseTo(4.5 * scale, 5);
    expect(cascade!.collidable).toBe(false);
    expect(cascade!.lickable).toBe(false);
    expect(cascade!.climbable).toBe(false);
    expect(island.colliders.some(c => c.shape !== 'heightfield' &&
      c.id === cascade!.id)).toBe(false);
    const bp = bridge.transform.position, fp = cascade!.transform.position;
    expect(Math.hypot(fp.x - bp.x, fp.z - bp.z)).toBeGreaterThanOrEqual(8);
    const riverIndex = island.river.findIndex(p =>
      Math.hypot(p.x - bp.x, p.z - bp.z) < 0.001);
    expect(riverIndex).toBeGreaterThan(0);
    const upstream = island.river[riverIndex - 1]!;
    const riverBridge = island.river[riverIndex]!;
    const ux = upstream.x - riverBridge.x, uz = upstream.z - riverBridge.z;
    expect((fp.x - bp.x) * ux + (fp.z - bp.z) * uz).toBeGreaterThan(0);
    const yaw = cascade!.transform.rotationY;
    const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw);
    const top = { x: fp.x - 3 * forwardX, z: fp.z - 3 * forwardZ };
    const bottom = { x: fp.x + 3 * forwardX, z: fp.z + 3 * forwardZ };
    const drop = gridSample(island, top.x, top.z) -
      gridSample(island, bottom.x, bottom.z);
    expect(cascade!.size.y).toBeGreaterThanOrEqual(Math.max(0, drop) - 0.3);
    const lipRocks = island.props.filter(p => p.id.startsWith('whispering-pines-glade-lip-'));
    expect(lipRocks.map(p => p.id).sort()).toEqual([
      'whispering-pines-glade-lip-left', 'whispering-pines-glade-lip-right',
    ]);
    for (const rock of lipRocks) {
      expect(rock.kind).toBe('rock');
      expect(rock.collidable).toBe(true);
      expect(rock.shape).toBe('convex');
      expect(rock.size).toEqual({ x: 3.5 * scale, y: 2.4 * scale, z: 3 * scale });
      expect(rock.transform.rotationY).toBeCloseTo(yaw, 6);
      expect(island.colliders.some(c => c.shape !== 'heightfield' &&
        c.id === rock.id)).toBe(true);
      const dx = rock.transform.position.x - fp.x;
      const dz = rock.transform.position.z - fp.z;
      expect(Math.abs(dx * forwardZ - dz * forwardX))
        .toBeCloseTo((cascade!.size.x + rock.size.x) / 2 - 0.08 * scale, 4);
    }
  });

  it('never throws while searching differing seeds and sizes', () => {
    for (const [seed, size] of [['pines-alt', 900], ['wp4-low', 400],
      ['wp4-cliff', 1200]] as const) {
      expect(() => generateIsland({ seed, size, resolution: 65 })).not.toThrow();
    }
  });
});
