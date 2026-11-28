import { noniStorefront } from '../world/visual-downtown';
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
    expect(sites.some(p => p.definition.id === 'honey-rolls')).toBe(true);
    for (const p of sites) {
      if (p.definition.id === 'needle-drop') {
        const shop = noniStorefront(island)!;
        expect(shop).toBeDefined();
        expect(shop.transform.position.x - p.position.x).toBeCloseTo(shop.size.z / 2 + 1.05 * p.scale);
        expect(p.position.z).toBeCloseTo(shop.transform.position.z);
      } else if (p.definition.id === 'honey-rolls') {
        // This event uses the actual service window rather than a freestanding verge.
        const shop = island.props.find(prop => prop.kind === 'shop' && prop.poiId === p.definition.district &&
          Math.abs(prop.transform.position.z - p.position.z) < .01 && prop.transform.position.x < p.position.x &&
          Math.abs(p.position.x - prop.transform.position.x - prop.size.z / 2 - 1.05 * p.scale) < .01);
        expect(shop).toBeDefined();
      } else expect(happeningGround(island, p.position)).toBe(p.position.y);
    }
    expect([island.props.length, island.colliders.length, island.roads.length]).toEqual(before);
  });

  it('launches three edible rolls, tracks individual pickups and persists the discovery', () => {
    const bakery = { ...site, definition: HAPPENING_DEFINITIONS.find(d => d.id === 'honey-rolls')! };
    const life = new IslandHappenings([bakery]);
    const batch = life.bakery!;
    const point = { ...player };
    expect(batch.roll(0, 0, point)).toBe(false);
    expect(life.bleat(player, 3)).toBe(20);
    expect(batch.roll(2, 3.2, point)).toBe(false);
    for (const i of [0, 1, 2]) {
      expect(batch.roll(i, 6, point)).toBe(true);
      expect(batch.collect({ ...point, y: point.y + 8 }, 6)).toBe(0);
      expect(batch.collect(point, 6)).toBe(1);
      expect(batch.roll(i, 6, point)).toBe(false);
    }
    expect(life.message(player, 6)?.detail).toContain('3/3 ROLLS');
    expect(batch.active(14)).toBe(false);
    expect(life.bleat(player, 16)).toBe(0);
    expect(batch.count).toBe(0);
    expect(new IslandHappenings([bakery], life.snapshot()).bleat(player, 0)).toBe(0);
  });

  it('flips the pressing on three distinct downbeats and credits the first encore once', () => {
    const venue = {...site, definition: HAPPENING_DEFINITIONS.find(d => d.id === 'needle-drop')!};
    const life = new IslandHappenings([venue]);
    expect(life.bleat(player, 10)).toBe(0);
    expect(life.records?.side).toBe(0);
    expect(life.bleat(player, 10.9)).toBe(0);
    expect(life.records?.hits).toBe(0);
    life.bleat(player, 11.8);
    life.bleat(player, 12.1);
    expect(life.records?.hits).toBe(1);
    life.bleat({...player, y: 40}, 14);
    expect(life.records?.hits).toBe(1);
    life.bleat(player, 14);
    expect(life.bleat(player, 16)).toBe(35);
    expect(life.records?.side).toBe(1);
    expect(life.message(player, 17)?.task).toContain('Midnight Molt');
    const replay = new IslandHappenings([venue], life.snapshot());
    for (const time of [0,2,4,6]) expect(replay.bleat(player,time)).toBe(0);
    expect(replay.records?.side).toBe(1);
    expect(replay.records?.age(23)).toBeUndefined();
  });

  it('lets the sidewalk counter and nearby gig board keep separate interaction zones', async () => {
    const { Game } = await import('./Game');
    const game = await Game.create();
    try {
      const window = game.happenings.records!.site.position;
      game.teleport({ ...window, x: window.x - 2.25, z: window.z - .65 });
      expect(game.gigs.nearBoard()).toBe('downtown-bleatsville');
      expect(game.atRecordCounter).toBe(true);
      const board = game.gigs.boards.find(b => b.poiId === 'downtown-bleatsville')!;
      game.teleport(board.position);
      expect(game.gigs.nearBoard()).toBe(board.poiId);
      expect(game.atRecordCounter).toBe(false);
    } finally { game.dispose(); }
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
