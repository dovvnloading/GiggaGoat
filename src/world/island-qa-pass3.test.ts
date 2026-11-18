import { describe, expect, it } from 'vitest';
import { generateIsland } from './island';
import { gridSample, riverAt } from './terrain';
import type { IslandData, PropDescriptor } from './types';

const cases = [
  { seed: 'billy-isle', size: 600, resolution: 193 },
  { seed: 'pines-alt', size: 900, resolution: 97 },
] as const;

const groundKinds = new Set([
  'rock', 'bush', 'flower', 'grass-tuft', 'tree-pine', 'tree-oak',
  'palm-tree', 'mushroom',
]);

function base(prop: PropDescriptor): number {
  return prop.transform.position.y - prop.size.y / 2;
}

function nearestRoadClearance(island: IslandData, prop: PropDescriptor): number {
  const { x, z } = prop.transform.position;
  let clearance = Infinity;
  for (const road of island.roads) {
    for (const p of road.points) {
      clearance = Math.min(clearance,
        Math.hypot(x - p.x, z - p.z) - road.width / 2);
    }
  }
  return clearance;
}

function pinesProps(island: IslandData): PropDescriptor[] {
  return island.props.filter(prop =>
    prop.id.startsWith('whispering-pines-'));
}

describe('island QA pass 3: lighthouse, boardwalk and Pines', () => {
  it.each(cases)('drops all unsupported ground props after the channel for $seed / $size',
    ({ seed, size, resolution }) => {
      const island = generateIsland({ seed, size, resolution });
      const surfaceProps = island.props.filter(prop => groundKinds.has(prop.kind));
      expect(surfaceProps.length).toBeGreaterThan(100);
      for (const prop of surfaceProps) {
        const { x, z } = prop.transform.position;
        const floatingHeight = base(prop) - gridSample(island, x, z);
        expect(floatingHeight, prop.id + ' floats ' + floatingHeight.toFixed(2) + 'm')
          .toBeLessThanOrEqual(0.5 + 1e-6);
      }
    });

  it.each(cases)('keeps forecourt benches and balls on dry land for $seed / $size',
    ({ seed, size, resolution }) => {
      const island = generateIsland({ seed, size, resolution });
      const scale = size / 600;
      const centre = island.pois.find(p => p.id === 'baa-ardwalk')!.center;
      const props = island.props.filter(p => p.poiId === 'baa-ardwalk');
      const pier = props.find(p => p.kind === 'pier')!;
      const entrance = pier.transform.position.z - pier.size.z / 2;
      const shoreShift = (entrance - centre.z) / scale + 38;
      const balls = props.filter(p => p.kind === 'bumper');
      const benches = props.filter(p => p.kind === 'bench' &&
        p.transform.position.z < entrance - scale);
      expect(balls.length, seed + ' balls').toBeGreaterThan(0);
      expect(benches.length, seed + ' forecourt benches').toBeGreaterThan(0);
      expect(balls.length).toBeLessThanOrEqual(2);
      expect(benches.length).toBeLessThanOrEqual(2);
      for (const prop of [...balls, ...benches]) {
        const { x, z } = prop.transform.position;
        const ground = gridSample(island, x, z);
        expect(ground, prop.id + ' below sea').toBeGreaterThanOrEqual(1.0);
        expect(base(prop), prop.id + ' base').toBeCloseTo(ground, 5);
        expect(Math.abs((x - centre.x) / scale)).toBeLessThanOrEqual(16);
        const dz = (z - centre.z) / scale - shoreShift;
        expect(dz, prop.id + ' forecourt Z').toBeGreaterThanOrEqual(-46 - 1e-6);
        expect(dz, prop.id + ' forecourt Z').toBeLessThanOrEqual(-40 + 1e-6);
      }
    });

  it.each(cases)('keeps just six smaller rocks/logs beside river/trail and off roads for $seed / $size',
    ({ seed, size, resolution }) => {
      const island = generateIsland({ seed, size, resolution });
      const scale = size / 600;
      // The two named glade-cascade lip rocks are separate authored terrain
      // supports; count only the six loose pieces from populateProps.
      const loose = pinesProps(island).filter(p =>
        /^whispering-pines-(rock|log)-\d+$/.test(p.id));
      expect(loose).toHaveLength(6);
      expect(loose.filter(p => p.kind === 'log')).toHaveLength(2);
      expect(loose.filter(p => p.kind === 'rock')).toHaveLength(4);
      for (const prop of loose) {
        const dims = prop.kind === 'log' ? [1.0, 0.9, 4.5] : [2.2, 1.6, 2.5];
        expect(prop.size, prop.id + ' bounds').toEqual({
          x: dims[0]! * scale, y: dims[1]! * scale, z: dims[2]! * scale,
        });
        // A bounding circle conservatively covers the rotated footprint.
        const footprintRadius = Math.hypot(prop.size.x, prop.size.z) / 2;
        expect(nearestRoadClearance(island, prop), prop.id + ' road footprint')
          .toBeGreaterThan(3.5 + footprintRadius - 1e-6);
        const { x, z } = prop.transform.position;
        expect(base(prop)).toBeCloseTo(gridSample(island, x, z), 5);
      }
      for (const log of loose.filter(p => p.kind === 'log')) {
        const { x, z } = log.transform.position;
        const river = riverAt({ x, z }, island.river);
        expect(river.distance - river.width / 2, log.id + ' bank setback')
          .toBeGreaterThanOrEqual(2 - 1e-6);
        expect(river.distance - river.width / 2, log.id + ' bank setback')
          .toBeLessThanOrEqual(6 + 1e-6);
        // The log's long local-Z axis runs approximately along the river.
        const segment = island.river.slice(0, -1).reduce((best, a, i) => {
          const b = island.river[i + 1]!;
          const dx = b.x - a.x, dz = b.z - a.z;
          const t = Math.max(0, Math.min(1,
            ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
          const distance = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
          return distance < best.distance
            ? { distance, yaw: Math.atan2(dx, dz) } : best;
        }, { distance: Infinity, yaw: 0 });
        expect(Math.abs(Math.sin(log.transform.rotationY - segment.yaw)), log.id)
          .toBeLessThan(0.25);
      }
    });

  it.each(cases)('keeps Pines tree trunks outside road shoulders for $seed / $size',
    ({ seed, size, resolution }) => {
      const island = generateIsland({ seed, size, resolution });
      const trees = pinesProps(island).filter(p =>
        p.kind === 'tree-pine' || p.kind === 'tree-oak');
      expect(trees.length).toBeGreaterThan(40);
      for (const tree of trees) {
        const trunkRadius = Math.min(0.9, tree.size.x * 0.2);
        expect(nearestRoadClearance(island, tree), tree.id + ' road margin')
          .toBeGreaterThan(2 + trunkRadius - 1e-6);
      }
    });

  it.each(cases)('keeps main-branch Downtown and Crane Yard landmark ids and positions for $seed / $size',
    ({ seed, size, resolution }) => {
      const island = generateIsland({ seed, size, resolution });
      // These fixed relative offsets and serial ids are from main before
      // the Pines RNG/placement changes. Check both districts explicitly.
      const anchors = [
        { id: 'downtown-bleatsville-tower-65', poiId: 'downtown-bleatsville', dx: 39, dz: -38 },
        { id: 'downtown-bleatsville-lamp-66', poiId: 'downtown-bleatsville', dx: -10.8, dz: -37 },
        { id: 'crane-yard-tower-0', poiId: 'crane-yard', dx: -12, dz: 13 },
        { id: 'crane-yard-concrete-column-1', poiId: 'crane-yard', dx: -32, dz: -18 },
      ] as const;
      for (const { id, poiId, dx, dz } of anchors) {
        const centre = island.pois.find(p => p.id === poiId)!.center;
        const prop = island.props.find(p => p.id === id);
        expect(prop, id + ' missing from main').toBeDefined();
        expect(prop!.transform.position.x, id + ' X')
          .toBeCloseTo(centre.x + dx * size / 600, 6);
        expect(prop!.transform.position.z, id + ' Z')
          .toBeCloseTo(centre.z + dz * size / 600, 6);
      }
    });

  it('remains deterministic and does not throw on extra seeds', () => {
    for (const seed of ['forest-low-1', 'forest-low-2', 'forest-low-3']) {
      const first = generateIsland({ seed, resolution: 65 });
      const second = generateIsland({ seed, resolution: 65 });
      expect(first.props).toEqual(second.props);
    }
  });
});
