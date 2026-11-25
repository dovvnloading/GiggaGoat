import { describe, expect, it } from 'vitest';
import { generateIsland } from '../world';
import { BIOMES, type IslandData } from '../world/types';
import {
  HAPPENING_DEFINITIONS, IslandHappenings, happeningGround, placeIslandHappenings,
  type HappeningSite,
} from './IslandHappenings';
import { HappeningVisuals } from './HappeningVisuals';

const site: HappeningSite = {
  definition: HAPPENING_DEFINITIONS[0], position: { x: 10, y: 4, z: 20 }, yaw: 0, scale: 1,
};
const player = { ...site.position };
function flatIsland(): IslandData {
  return {
    seed: 'flat', size: 600, resolution: 3, seaLevel: 0, heights: new Float32Array(9).fill(4),
    biomeMap: new Uint8Array(9).fill(BIOMES.indexOf('meadow')), zoneMap: new Uint8Array(9),
    pois: [{ id: 'hoofington', name: 'Hoofington', center: { x: 0, y: 4, z: 0 },
      radius: 37, biome: 'farmland', description: '' }],
    plots: [], river: [], reservoir: { center: { x: 200, z: 200 }, radiusX: 1, radiusZ: 1, level: 0 },
    roads: [{ id: 'road', from: 'hoofington', to: 'baa-ardwalk', width: 6, type: 'road',
      points: [{ x: -50, y: 4, z: 0, bridge: false }, { x: 50, y: 4, z: 0, bridge: false }] }],
    props: [], colliders: [], spawns: [], relics: [], tideLevels: [],
  };
}

describe('living island encounters', () => {
  it('reacts only in reach, including height, and rewards the first discovery once', () => {
    const life = new IslandHappenings([site]);
    expect(life.bleat({ ...player, x: 16 }, 0)).toBe(0);
    expect(life.bleat({ ...player, y: 10 }, 0)).toBe(0);
    expect(life.message({ ...player, x: 18 }, 0)?.detail).toBe('WANDER A LITTLE CLOSER');
    expect(life.message(player, 0)?.detail).toContain('BLEAT TO DISCOVER');
    expect(life.bleat(player, 0)).toBe(site.definition.reward);
    expect(life.reaction(site, 2)).toBe(2);
    expect(life.message(player, 2)?.detail).toContain('+15 CUD COINS');
    expect(life.bleat(player, 4)).toBe(0);
    expect(life.reaction(site, 5)).toBeUndefined();
    expect(life.bleat(player, 13)).toBe(0);
    expect(life.reaction(site, 13)).toBe(0);
    expect(life.message(player, 13)?.detail).toBe('A LITTLE ISLAND ENCORE');
    expect(life.snapshot()).toEqual([site.definition.id]);
  });

  it('preserves one-time rewards across reload, while ignoring bad save values', () => {
    const life = new IslandHappenings([site], [site.definition.id, site.definition.id, 'unknown', 123]);
    expect(life.snapshot()).toEqual([site.definition.id]);
    expect(life.discovered(site)).toBe(true);
    expect(life.bleat(player, 0)).toBe(0);
    expect(life.reaction(site, 0)).toBe(0);
    expect(new IslandHappenings([site], { bad: true }).snapshot()).toEqual([]);
  });

  it('uses repeatable dry ground and keeps clear of roads, boards and scenery', () => {
    const island = flatIsland();
    expect(happeningGround(island, { x: 0, z: 0 })).toBeUndefined();
    expect(happeningGround(island, { x: 0, z: 10 }, [{ x: 0, z: 15 }])).toBeUndefined();
    expect(happeningGround(island, { x: 0, z: 10 })).toBe(4);
    island.colliders.push({ id: 'block', shape: 'cuboid', size: { x: 2, y: 2, z: 3 },
      transform: { position: { x: 0, y: 5, z: 10 }, rotationY: .4 }, body: { type: 'static' } });
    expect(happeningGround(island, { x: 0, z: 10 })).toBeUndefined();
    const placements = placeIslandHappenings(island);
    expect(placements).toHaveLength(1);
    expect(placeIslandHappenings(island)).toEqual(placements);
    island.heights.fill(-1);
    expect(placeIslandHappenings(island)).toEqual([]);
  });

  it('finds safe, distinct vignettes across the real island without changing props or colliders', () => {
    const island = generateIsland({ seed: 'billy-isle' });
    const before = [island.props.length, island.colliders.length, island.roads.length];
    const sites = placeIslandHappenings(island, island.pois.map(p => p.center));
    // Keep a floor on useful coverage without forcing unsafe locations on steep terrain.
    expect(sites.length).toBeGreaterThanOrEqual(4);
    expect(new Set(sites.map(p => p.definition.id)).size).toBe(sites.length);
    for (const p of sites) {
      expect(happeningGround(island, p.position)).toBe(p.position.y);
    }
    expect([island.props.length, island.colliders.length, island.roads.length]).toEqual(before);
  });

  it('animates nearby vignettes, hides distant or party scenes and disposes resources', () => {
    const island = flatIsland();
    const life = new IslandHappenings([site]);
    const visual = new HappeningVisuals(island, life);
    const group = visual.root.children[0]!;
    visual.update(0, player, true);
    expect(group.visible).toBe(true);
    life.bleat(player, 0);
    visual.update(2, player, true);
    expect(group.children.filter(child => child.visible).length).toBeGreaterThan(3);
    visual.update(6, { ...player, x: 300 }, true);
    expect(group.visible).toBe(false);
    visual.update(6, player, false);
    expect(group.visible).toBe(false);
    visual.dispose();
    expect(visual.root.children).toHaveLength(0);
  });
});
