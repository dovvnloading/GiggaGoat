import { describe, expect, it } from 'vitest';
import { generateIsland } from './island';
import { gridSample } from './terrain';
import type { PropDescriptor } from './types';
import {
  DOWNTOWN_BUILDING_SIZES, DOWNTOWN_INFILL, SHOP_FRONTS,
  isInsideDowntownInfillFootprint, makeDowntownPlacements,
} from './visual-downtown';

const CANDIDATES = [
  'cornerShop', 'bakery', 'kayShop', 'cinema', 'kayHouse',
] as const;

function extents(prop: PropDescriptor): { x: number; z: number } {
  const yaw = prop.transform.rotationY;
  return {
    x: (Math.abs(Math.cos(yaw)) * prop.size.x +
      Math.abs(Math.sin(yaw)) * prop.size.z) / 2,
    z: (Math.abs(Math.sin(yaw)) * prop.size.x +
      Math.abs(Math.cos(yaw)) * prop.size.z) / 2,
  };
}

describe('Downtown DT-14 deterministic shop infill', () => {
  it('chooses only fitting gap interiors, maximizes width and keeps both side clearances', () => {
    expect(DOWNTOWN_INFILL.map(({ side, z, model }) =>
      ({ side, z: Number(z.toFixed(2)), model }))).toEqual([
      { side: -1, z: -26.9, model: 'cornerShop' },
      { side: 1, z: -28.34, model: 'bakery' },
      { side: 1, z: -9.66, model: 'cornerShop' },
      { side: 1, z: 9.5, model: 'cornerShop' },
      { side: 1, z: 28.5, model: 'kayShop' },
    ]);

    for (const side of [-1, 1] as const) {
      const shops = SHOP_FRONTS[side < 0 ? 0 : 1]!;
      for (let row = 0; row < shops.length - 1; row++) {
        const left = shops[row]!.model, right = shops[row + 1]!.model;
        const leftEdge = (row - 2) * 19 + DOWNTOWN_BUILDING_SIZES[left].x / 2;
        const rightEdge = (row - 1) * 19 - DOWNTOWN_BUILDING_SIZES[right].x / 2;
        const available = CANDIDATES.filter(model =>
          DOWNTOWN_BUILDING_SIZES[model].x <= rightEdge - leftEdge - 0.8);
        const entries = DOWNTOWN_INFILL.filter(p => p.side === side &&
          p.z >= leftEdge && p.z <= rightEdge);
        expect(entries, side + '/' + row).toHaveLength(available.length ? 1 : 0);
        if (!available.length) continue;
        const entry = entries[0]!;
        const width = DOWNTOWN_BUILDING_SIZES[entry.model].x;
        const notNeighbours = available.filter(model => model !== left && model !== right);
        const preferred = notNeighbours.length ? notNeighbours : available;
        expect(preferred).toContain(entry.model);
        expect(width).toBe(Math.max(...preferred.map(model =>
          DOWNTOWN_BUILDING_SIZES[model].x)));
        expect(entry.z).toBeCloseTo((leftEdge + rightEdge) / 2, 8);
        expect(entry.z - width / 2 - leftEdge).toBeGreaterThanOrEqual(0.4 - 1e-9);
        expect(rightEdge - entry.z - width / 2).toBeGreaterThanOrEqual(0.4 - 1e-9);
        expect(entry.z).toBeGreaterThan(-38);
        expect(entry.z).toBeLessThan(38);
      }
    }
  });

  it('builds real static infill house colliders on the pavement plane with no overlaps', () => {
    for (const seed of ['billy-isle', 'downtown-infill-check']) {
      for (const size of [400, 600, 850]) {
        const island = generateIsland({ seed, size, resolution: 97 });
        const scale = island.size / 600;
        const centre = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
        const downtown = island.props.filter(p => p.poiId === 'downtown-bleatsville');
        const houses = downtown.filter(p => p.kind === 'house');
        const infills = houses.filter(p =>
          Math.abs(p.transform.position.x - centre.x) < 30 * scale);
        const rear = houses.filter(p =>
          Math.abs(p.transform.position.x - centre.x) >= 30 * scale);
        expect(rear).toHaveLength(6);
        expect(infills).toHaveLength(DOWNTOWN_INFILL.length);
        expect(houses).toHaveLength(6 + DOWNTOWN_INFILL.length);

        const plan = makeDowntownPlacements(island);
        for (const entry of DOWNTOWN_INFILL) {
          const matches = infills.filter(prop =>
            (prop.transform.position.x - centre.x) * entry.side > 0 &&
            Math.abs(prop.transform.position.z - centre.z - entry.z * scale) < 0.001);
          expect(matches, seed + '/' + entry.side + '/' + entry.z).toHaveLength(1);
          const house = matches[0]!, size = DOWNTOWN_BUILDING_SIZES[entry.model];
          expect(house.size).toEqual({
            x: size.x * scale, y: size.y * scale, z: size.z * scale,
          });
          expect(house.body).toEqual({ type: 'static' });
          expect(house.shape).toBe('cuboid');
          expect(house.collidable).toBe(true);
          expect(house.climbable).toBe(true);
          expect(island.colliders.some(c => c.shape !== 'heightfield' &&
            c.id === house.id && c.shape === 'cuboid')).toBe(true);
          expect(house.transform.rotationY).toBeCloseTo(
            -entry.side * Math.PI / 2, 6);
          const frontX = house.transform.position.x +
            Math.sin(house.transform.rotationY) * house.size.z / 2;
          expect(frontX - centre.x).toBeCloseTo(entry.side * 14.3 * scale, 5);
          expect(house.transform.position.y - house.size.y / 2)
            .toBeCloseTo(gridSample(island,
              house.transform.position.x, house.transform.position.z), 3);
          expect(plan.find(p => p.source?.id === house.id)?.model).toBe(entry.model);
          for (const gigZ of [-19, 0, 19])
            expect(Math.abs(entry.z - gigZ)).toBeGreaterThan(3);
        }

        const buildings = downtown.filter(p =>
          p.kind === 'shop' || p.kind === 'house' || p.kind === 'tower');
        expect(buildings.filter(p => p.kind === 'shop')).toHaveLength(10);
        for (let i = 0; i < buildings.length; i++) {
          const a = buildings[i]!, aa = extents(a);
          for (const b of buildings.slice(i + 1)) {
            const bb = extents(b);
            const overlap = Math.abs(a.transform.position.x - b.transform.position.x) <
              aa.x + bb.x - 0.001 * scale &&
              Math.abs(a.transform.position.z - b.transform.position.z) <
              aa.z + bb.z - 0.001 * scale;
            expect(overlap, a.id + ' intersects ' + b.id).toBe(false);
          }
        }

        for (const dz of [-19, 0, 19]) {
          const roofs = buildings.filter(p => (p.kind === 'shop' || p.kind === 'house') &&
            Math.abs(p.transform.position.z - centre.z - dz * scale) < 3 * scale);
          expect(roofs, 'Rooftop Express row ' + dz).toHaveLength(4);
          expect(roofs.every(p =>
            Math.abs(Math.abs(p.transform.rotationY) - Math.PI / 2) < 1e-6)).toBe(true);
        }
      }
    }
  });

  it('keeps physical and art-only scenery out of every infill while retaining road furniture', () => {
    const sceneryKinds = new Set([
      'tree-pine', 'tree-oak', 'bush', 'flower', 'grass-tuft',
      'planter', 'bench', 'sign', 'signboard',
    ]);
    const sceneryModels = new Set([
      'oakA', 'oakB', 'oakC', 'bushA', 'bushB',
      'flowerPink', 'flowerPurple', 'flowerSunny', 'planter', 'bench',
    ]);
    for (const seed of ['billy-isle', 'downtown-infill-check']) {
      const island = generateIsland({ seed, resolution: 97 });
      const props = island.props.filter(p => sceneryKinds.has(p.kind));
      expect(props.length).toBeGreaterThan(50);
      for (const prop of props) {
        expect(isInsideDowntownInfillFootprint(island,
          prop.transform.position.x, prop.transform.position.z), prop.id).toBe(false);
      }
      const plan = makeDowntownPlacements(island);
      for (const placement of plan.filter(p => sceneryModels.has(p.model))) {
        expect(isInsideDowntownInfillFootprint(island,
          placement.position.x, placement.position.z), placement.model).toBe(false);
      }
      const downtown = island.props.filter(p => p.poiId === 'downtown-bleatsville');
      expect(downtown.filter(p => p.kind === 'lamp')).toHaveLength(12);
      expect(plan.filter(p => p.model === 'cone')).toHaveLength(4);
      expect(plan.some(p => p.model === 'table')).toBe(true);
      expect(plan.some(p => p.model === 'trash')).toBe(true);
    }
  });
});
