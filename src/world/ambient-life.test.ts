import { describe, expect, it } from 'vitest';
import { generateIsland, hashIsland } from './island';
import { createAmbientLifePlan } from './ambient-life';
import { ambientSegmentIntersectsBlocker, findAmbientPath, isAmbientSegmentSafe } from './ambient-navigation';

describe('Downtown living-world plan', () => {
  it.each([
    { seed: 'living-200', size: 200, resolution: 97 },
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'living-small', size: 400, resolution: 97 },
    { seed: 'living-large', size: 900, resolution: 97 },
    { seed: 'living-2000', size: 2000, resolution: 97 },
  ])('uses connected, swept, supported paths at $size metres', options => {
    const island = generateIsland(options), before = hashIsland(island);
    const city = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    const board = { x: city.x + 8.1 * options.size / 600, z: city.z + 2.2 * options.size / 600 };
    const plan = createAmbientLifePlan(island, [board]);
    expect(hashIsland(island)).toBe(before);
    expect(plan.residents.length).toBeGreaterThanOrEqual(12);
    expect(plan.residents.length).toBeLessThanOrEqual(16);
    expect(new Set(plan.residents.map(r => r.id)).size).toBe(plan.residents.length);
    for (const resident of plan.residents) {
      expect(resident.height).toBeLessThan(plan.navigation.height);
      const home = plan.stations[resident.home]!;
      expect(home.kind).toBe('shelter');
      const component = plan.navigation.nodes[resident.initialNode]!.component;
      for (const station of resident.itinerary) expect(plan.navigation.nodes[plan.stations[station]!.node]!.component).toBe(component);
      const path = findAmbientPath(plan.navigation, resident.initialNode, home.node);
      expect(path.length, resident.id).toBeGreaterThan(0);
      for (let i = 1; i < path.length; i++) {
        expect(isAmbientSegmentSafe(plan.navigation,
          plan.navigation.nodes[path[i - 1]!]!.position, plan.navigation.nodes[path[i]!]!.position), resident.id).toBe(true);
      }
    }
  });

  it('rejects a thin obstruction between clear endpoints', () => {
    const blocker = { id: 'thin-furniture', x: 0, z: 0, halfX: .005, halfZ: 1.1, yaw: .31, bottom: 0, top: 2 };
    expect(ambientSegmentIntersectsBlocker({ x: -4, z: 0 }, { x: 4, z: 0 }, blocker, .4)).toBe(true);
    expect(ambientSegmentIntersectsBlocker({ x: -4, z: 3 }, { x: 4, z: 3 }, blocker, .4)).toBe(false);
  });

  it('omits a blocked neighborhood instead of forcing residents into scenery', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const city = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
    island.props.push({ id: 'ambient-test-total-obstruction', kind: 'container',
      transform: { position: { x: city.x, y: 10, z: city.z }, rotationY: 0 },
      size: { x: 100, y: 80, z: 150 }, body: { type: 'static' },
      shape: 'cuboid', collidable: true, breakable: false, lickable: false, climbable: true });
    const plan = createAmbientLifePlan(island);
    expect(plan.residents).toEqual([]);
    expect(plan.navigation.nodes).toEqual([]);
  });
});
