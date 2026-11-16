import type {
  Biome, IslandData, IslandOptions, PlotDescriptor, PoiDescriptor, PoiId, RiverPoint, Vec2,
} from './types';
import { BIOMES, POI_IDS } from './types';
import { hashString, SeededRandom } from './random';
import {
  assignBiomes, carveWater, gridCoordinate, gridIndex, gridSample, makeTerrain, stampPlot,
} from './terrain';
import { makeRoads, makeBridgeDecks } from './roads';
import { populateProps } from './layouts';
import { makeRelics, makeSpawns } from './collectibles';
import { makeColliderDescriptors } from './colliders';

interface SiteDefinition {
  id: PoiId; name: string; x: number; z: number; radius: number;
  plot: number; biome: Biome; flat: boolean; description: string;
}
const SITES: SiteDefinition[] = [
  { id: 'hoofington', name: 'Hoofington', x: -157, z: 118, radius: 36, plot: 31,
    biome: 'farmland', flat: true, description: 'Barn roofs, hay paddocks and a spinning windmill' },
  { id: 'baa-ardwalk', name: 'Baa-ardwalk', x: 91, z: 215, radius: 33, plot: 26,
    biome: 'beach', flat: true, description: 'A pier over the sea, rides and a giant wheel' },
  { id: 'crane-yard', name: 'Crane Yard', x: 174, z: 81, radius: 35, plot: 32,
    biome: 'industrial', flat: true, description: 'Cranes, half-built towers and stackable cargo' },
  { id: 'downtown-bleatsville', name: 'Downtown Bleatsville', x: 135, z: -80, radius: 42, plot: 38,
    biome: 'town', flat: true, description: 'A tight parkour maze of brightly coloured rooftops' },
  { id: 'mt-gigga', name: 'Mt. Gigga', x: 0, z: 0, radius: 62, plot: 8,
    biome: 'highlands', flat: true, description: 'Terraced cliffs, a summit dish and a spiral climb' },
  { id: 'whispering-pines', name: 'Whispering Pines', x: -133, z: -166, radius: 39, plot: 0,
    biome: 'pine-forest', flat: false, description: 'Dense pine trails, a river and tumbling logs' },
  { id: 'the-dam', name: 'The Dam', x: -105, z: -85, radius: 23, plot: 14,
    biome: 'highlands', flat: true, description: 'A reservoir, spillway and overhead walkway' },
  { id: 'old-lighthouse', name: 'Old Lighthouse', x: -218, z: -92, radius: 25, plot: 18,
    biome: 'cliff', flat: true, description: 'A windswept rocky point and an old beacon' },
];

export function generateIsland(options: IslandOptions = {}): IslandData {
  const seed = options.seed ?? 'billy-isle';
  const size = options.size ?? 600;
  const resolution = options.resolution ?? 193;
  if (!Number.isFinite(size) || size < 200 || size > 2000 ||
      !Number.isInteger(resolution) || resolution < 33 || resolution > 513) {
    throw new RangeError('Island size must be 200–2000 m and resolution an integer 33–513');
  }
  const scale = size / 600;
  const rng = new SeededRandom(seed);
  const heights = makeTerrain(seed, size, resolution);
  const river: RiverPoint[] = [
    { x: -11, z: -32, level: 84, width: 4 },
    { x: -30, z: -56, level: 45, width: 5 },
    { x: -47, z: -78, level: 15, width: 7 },
    { x: -56, z: -94, level: 10, width: 12 },
    { x: -73, z: -124, level: 7, width: 9 },
    { x: -94, z: -154, level: 4.9, width: 10 },
    { x: -121, z: -194, level: 2.6, width: 12 },
    { x: -154, z: -238, level: -0.6, width: 17 },
    { x: -181, z: -262, level: -1, width: 20 },
  ].map(p => ({ x: p.x * scale, z: p.z * scale, level: p.level * scale, width: p.width * scale }));
  const reservoir = {
    center: { x: -54 * scale, z: -91 * scale },
    radiusX: 23 * scale, radiusZ: 20 * scale, level: 10 * scale,
  };
  const island: IslandData = {
    seed, size, resolution, seaLevel: 0,
    heights, biomeMap: new Uint8Array(resolution * resolution),
    zoneMap: new Uint8Array(resolution * resolution),
    pois: [], plots: [], river, reservoir, roads: [], props: [], colliders: [],
    spawns: [], relics: [], tideLevels: [],
  };
  carveWater(island, river, reservoir);
  for (const definition of SITES) {
    const x = (definition.x + (definition.id === 'mt-gigga' ? 0 : rng.range(-2.3, 2.3))) * scale;
    const z = (definition.z + (definition.id === 'mt-gigga' ? 0 : rng.range(-2.3, 2.3))) * scale;
    const y = gridSample(island, x, z);
    const poi: PoiDescriptor = {
      id: definition.id, name: definition.name, radius: definition.radius * scale,
      center: { x, y, z }, biome: definition.biome, description: definition.description,
    };
    island.pois.push(poi);
    const plot: PlotDescriptor = {
      poiId: poi.id, center: { x, z },
      elevation: y, radius: definition.plot * scale, flat: definition.flat,
    };
    island.plots.push(plot);
    stampPlot(island, plot);
    poi.center.y = gridSample(island, x, z);
  }
  island.roads = makeRoads(island, rng);
  island.props = [...populateProps(island, rng), ...makeBridgeDecks(island)];
  assignBiomes(island);
  island.spawns = makeSpawns(island);
  island.relics = makeRelics(island, rng);
  island.colliders = makeColliderDescriptors(island);
  // The last round leaves only the mountain's highest scramble.
  const summit = island.pois.find(p => p.id === 'mt-gigga')!.center.y;
  island.tideLevels = [...[0, 3, 7, 12, 20, 32, 49, 70, 91].map(value => value * scale),
    Math.max(92 * scale, summit - 2 * scale)].sort((a, b) => a - b);
  return island;
}
export class IslandGenerator {
  constructor(private readonly defaults: IslandOptions = {}) {}
  generate(options: IslandOptions = {}): IslandData {
    return generateIsland({ ...this.defaults, ...options });
  }
}

/** Bilinear height, including the exact cut-and-fill alterations. */
export function heightAt(island: IslandData, x: number, z: number): number {
  return gridSample(island, x, z);
}
function gridLookup(island: IslandData, x: number, z: number): number {
  const ix = Math.max(0, Math.min(island.resolution - 1,
    Math.round((x / island.size + 0.5) * (island.resolution - 1))));
  const iz = Math.max(0, Math.min(island.resolution - 1,
    Math.round((z / island.size + 0.5) * (island.resolution - 1))));
  return gridIndex(island.resolution, ix, iz);
}
export function biomeAt(island: IslandData, x: number, z: number): Biome {
  return BIOMES[island.biomeMap[gridLookup(island, x, z)]!]!;
}
export function zoneAt(island: IslandData, x: number, z: number): PoiId | null {
  const code = island.zoneMap[gridLookup(island, x, z)]!;
  return code ? POI_IDS[code - 1] ?? null : null;
}

/** Area in m² sampled at cell centres. Monotonically nonincreasing for all tide heights. */
export function landAreaAtTideLevel(island: IslandData, level: number): number {
  if (!Number.isFinite(level)) throw new RangeError('Tide must be finite');
  let dryCells = 0;
  const n = island.resolution;
  for (let z = 0; z < n - 1; z++) for (let x = 0; x < n - 1; x++) {
    const base = gridIndex(n, x, z);
    const h = (island.heights[base]! + island.heights[base + 1]! +
      island.heights[base + n]! + island.heights[base + n + 1]!) * 0.25;
    if (h > level) dryCells++;
  }
  const cellSize = island.size / (n - 1);
  return dryCells * cellSize * cellSize;
}

/** Non-cryptographic, byte-for-byte deterministic fingerprint, including authored content. */
export function hashIsland(island: IslandData): string {
  let state = hashString(String(island.seed));
  const update = (n: number): void => {
    if (!Number.isFinite(n)) throw new Error('Nonfinite value in island');
    const value = Math.round(n * 1000);
    state = Math.imul(state ^ (value | 0), 16777619) >>> 0;
  };
  const updateText = (s: string): void => {
    for (let i = 0; i < s.length; i++) update(s.charCodeAt(i));
  };
  update(island.size); update(island.resolution);
  for (const h of island.heights) update(h);
  for (const b of island.biomeMap) update(b);
  for (const z of island.zoneMap) update(z);
  for (const poi of island.pois) {
    updateText(poi.id); update(poi.center.x); update(poi.center.y); update(poi.center.z);
  }
  for (const road of island.roads) {
    updateText(road.id);
    for (const p of road.points) {
      update(p.x); update(p.y); update(p.z); update(Number(p.bridge));
    }
  }
  for (const prop of island.props) {
    updateText(prop.id); updateText(prop.kind);
    update(prop.transform.position.x); update(prop.transform.position.y);
    update(prop.transform.position.z); update(prop.transform.rotationY);
    update(prop.size.x); update(prop.size.y); update(prop.size.z);
    update(prop.body.type === 'dynamic' ? prop.body.mass : 0);
  }
  for (const p of island.spawns) {
    update(p.position.x); update(p.position.y); update(p.position.z);
  }
  for (const p of island.relics) {
    update(p.position.x); update(p.position.y); update(p.position.z);
    updateText(p.category);
  }
  return state.toString(16).padStart(8, '0');
}

export function worldGridPositions(island: IslandData): Vec2[] {
  const result: Vec2[] = [];
  for (let z = 0; z < island.resolution; z++) for (let x = 0; x < island.resolution; x++) {
    result.push({ x: gridCoordinate(island.size, island.resolution, x),
      z: gridCoordinate(island.size, island.resolution, z) });
  }
  return result;
}
