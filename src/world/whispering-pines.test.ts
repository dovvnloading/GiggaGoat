import { describe, expect, it } from 'vitest';
import { generateIsland } from './index';
import { gridSample, riverAt, segmentProjection } from './terrain';
import type { IslandData, PropDescriptor } from './types';

function props(island: IslandData, kind: 'fern' | 'lily-pads' | 'mushroom'): PropDescriptor[] {
  return island.props.filter(p => p.poiId === 'whispering-pines' && p.kind === kind);
}

const seeds = [
  { seed: 'billy-isle', size: 600, resolution: 193 },
  { seed: 'pines-alt', size: 900, resolution: 97 },
] as const;

describe('Whispering Pines seeded glade dressing (WP-6)', () => {
  it.each(seeds)('places best-effort, noninteractive, dry ferns and river lily pads for $seed at $size m',
    ({ seed, size, resolution }) => {
      const island = generateIsland({ seed, size, resolution });
      const woods = island.pois.find(p => p.id === 'whispering-pines')!.center;
      const bridge = island.props.find(p =>
        p.poiId === 'whispering-pines' && p.kind === 'log-bridge');
      const anchor = bridge?.transform.position ?? woods;
      const ferns = props(island, 'fern');
      const pads = props(island, 'lily-pads');
      expect(ferns.length).toBeGreaterThanOrEqual(5);
      expect(ferns.length).toBeLessThanOrEqual(40);
      expect(pads.length).toBeGreaterThanOrEqual(1);
      expect(pads.length).toBeLessThanOrEqual(10);

      for (const prop of [...ferns, ...pads]) {
        expect(prop.body).toEqual({ type: 'static' });
        expect(prop.shape).toBe('cuboid');
        expect(prop.collidable, prop.id).toBe(false);
        expect(prop.breakable, prop.id).toBe(false);
        expect(prop.lickable, prop.id).toBe(false);
        expect(prop.climbable, prop.id).toBe(false);
        expect(prop.transform.rotationY, prop.id).toBeGreaterThanOrEqual(0);
        expect(prop.transform.rotationY, prop.id).toBeLessThan(Math.PI * 2);
      }
      for (const fern of ferns) {
        const { x, y, z } = fern.transform.position;
        const river = riverAt({ x, z }, island.river);
        expect(Math.hypot(x - woods.x, z - woods.z), fern.id + ' POI radius')
          .toBeLessThanOrEqual(60 + 1e-6);
        expect(gridSample(island, x, z), fern.id + ' dry ground')
          .toBeGreaterThan(island.seaLevel);
        expect(river.distance, fern.id + ' bank clearance')
          .toBeGreaterThan(river.width / 2 + 1.5);
        expect(fern.size.x, fern.id).toBeGreaterThanOrEqual(1.2);
        expect(fern.size.x, fern.id).toBeLessThanOrEqual(1.9);
        expect(fern.size.z).toBeCloseTo(fern.size.x, 6);
        expect(fern.size.y).toBeCloseTo(fern.size.x * 0.55, 6);
        expect(y - fern.size.y / 2).toBeCloseTo(gridSample(island, x, z), 5);
        expect(island.props.every(other => other === fern ||
          Math.hypot(x - other.transform.position.x, z - other.transform.position.z) >=
            1.5 - 1e-6), fern.id + ' other-prop clearance').toBe(true);
      }
      for (const pad of pads) {
        const { x, y, z } = pad.transform.position;
        const river = riverAt({ x, z }, island.river);
        const lateral = river.distance / (river.width / 2);
        expect(Math.hypot(x - anchor.x, z - anchor.z), pad.id + ' bridge radius')
          .toBeLessThanOrEqual(25 + 1e-6);
        expect(lateral, pad.id + ' river edge fraction').toBeGreaterThanOrEqual(0.25 - 1e-6);
        expect(lateral, pad.id + ' river edge fraction').toBeLessThanOrEqual(0.45 + 1e-6);
        expect(y, pad.id + ' water surface').toBeCloseTo(river.level + 0.02, 6);
        expect(pad.size.x, pad.id).toBeGreaterThanOrEqual(1.2);
        expect(pad.size.x, pad.id).toBeLessThanOrEqual(1.6);
        expect(pad.size.z).toBeCloseTo(pad.size.x, 6);
        expect(pad.size.y).toBeCloseTo(0.08, 6);
      }

      const pavedRoads = island.roads.filter(road => road.type === 'road' &&
        (road.from === 'whispering-pines' || road.to === 'whispering-pines'));
      const lowDetails = island.props.filter(prop => prop.poiId === 'whispering-pines' &&
        ['mushroom', 'stump', 'fern', 'bush', 'flower', 'grass-tuft'].includes(prop.kind));
      for (const prop of lowDetails) {
        const radius = Math.hypot(prop.size.x, prop.size.z) / 2;
        for (const road of pavedRoads) {
          const nearest = Math.min(...road.points.slice(1).map((point, i) =>
            segmentProjection(prop.transform.position, road.points[i]!, point).distance));
          expect(nearest, prop.id + ' clear of ' + road.id).toBeGreaterThan(road.width / 2 + radius);
        }
      }

      const upstreamWater = island.river.slice(0, 5);
      for (const pine of island.props.filter(prop => prop.poiId === 'mt-gigga' && prop.kind === 'tree-pine')) {
        const water = riverAt(pine.transform.position, upstreamWater);
        expect(water.distance, pine.id + ' clear of the upper river')
          .toBeGreaterThanOrEqual(water.width / 2 + Math.min(.9, pine.size.x * .2));
      }

      const mushrooms = props(island, 'mushroom');
      expect(mushrooms.length).toBeGreaterThan(0);
      expect(mushrooms.filter(p => Math.abs(p.size.y - 1.4) < 1e-6),
        seed + ' single hero mushroom').toHaveLength(1);
      for (const mushroom of mushrooms) {
        const h = mushroom.size.y;
        if (Math.abs(h - 1.4) >= 1e-6) {
          expect(h, mushroom.id).toBeGreaterThanOrEqual(0.4);
          expect(h, mushroom.id).toBeLessThanOrEqual(0.9);
        }
        expect(mushroom.size.x, mushroom.id).toBeCloseTo(0.85 * h, 6);
        expect(mushroom.size.z, mushroom.id).toBeCloseTo(h, 6);
      }
    });

  it('replays both glade species and mushroom hero identically, without seed-dependent throws', () => {
    const select = (seed: string) => generateIsland({ seed, resolution: 97 }).props
      .filter(p => p.poiId === 'whispering-pines' &&
        (p.kind === 'fern' || p.kind === 'lily-pads' || p.kind === 'mushroom'))
      .map(p => ({ id: p.id, kind: p.kind, transform: p.transform, size: p.size }));
    expect(select('billy-isle')).toEqual(select('billy-isle'));
    expect(select('billy-isle')).not.toEqual(select('pines-alt'));
    for (const seed of ['forest-low-1', 'forest-low-2', 'forest-low-3']) {
      expect(() => generateIsland({ seed, resolution: 97 }),
        seed + ' dressing should be best effort').not.toThrow();
    }
  });
});
