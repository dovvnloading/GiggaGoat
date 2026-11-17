import type {
  Biome, IslandData, IslandOptions, PlotDescriptor, PoiDescriptor, PoiId, PropDescriptor, RiverPoint, Vec2,
} from './types';
import { BIOMES, POI_IDS } from './types';
import { hashString, SeededRandom } from './random';
import {
  assignBiomes, carveWater, gridCoordinate, gridIndex, gridSample, makeTerrain,
  sculptLighthouseSeaCave, stampPlot,
} from './terrain';
import { makeRoads, makeBridgeDecks } from './roads';
import { populateProps } from './layouts';
import { dressIsland } from './dressing';
import { makeRelics, makeSpawns } from './collectibles';
import { makeColliderDescriptors } from './colliders';
import { sculptDamOutflow } from './dam-landscape';

interface SiteDefinition {
  id: PoiId; name: string; x: number; z: number; radius: number;
  plot: number; biome: Biome; flat: boolean; description: string;
}
/** Map-space: north = negative Z, east = positive X. Anchors remain seed-stable. */
const SITES: SiteDefinition[] = [
  { id: 'hoofington', name: 'Hoofington', x: -147, z: 133, radius: 37, plot: 31,
    biome: 'farmland', flat: true, description: 'Barn, silo, windmill and a village green' },
  { id: 'baa-ardwalk', name: 'Baa-ardwalk', x: 58, z: 228, radius: 33, plot: 24,
    biome: 'beach', flat: true, description: 'Sunset pier, rides, stalls and sandy launch pads' },
  { id: 'crane-yard', name: 'Crane Yard', x: 185, z: -47, radius: 36, plot: 31,
    biome: 'industrial', flat: true, description: 'Paved and fenced construction yard with open concrete floors and two tower cranes' },
  { id: 'downtown-bleatsville', name: 'Downtown Bleatsville', x: 145, z: 119, radius: 43, plot: 38,
    biome: 'town', flat: true, description: 'Colourful shopping streets and rooftop parkour' },
  { id: 'mt-gigga', name: 'Mt. Gigga', x: 0, z: 0, radius: 63, plot: 8,
    biome: 'highlands', flat: false, description: 'Four grassy climbing terraces, caves and summit dish' },
  { id: 'whispering-pines', name: 'Whispering Pines', x: -147, z: -143, radius: 41, plot: 0,
    biome: 'pine-forest', flat: false, description: 'Deep woodland, stepping-stone river and lookout' },
  { id: 'the-dam', name: 'The Dam', x: -17, z: -202, radius: 25, plot: 11,
    biome: 'highlands', flat: false, description: 'Northern reservoir and foaming spillways' },
  { id: 'old-lighthouse', name: 'Old Lighthouse', x: -259, z: -18, radius: 26, plot: 12,
    biome: 'cliff', flat: false, description: 'Detached rocky islet, rope bridge and sea cave' },
];

/**
 * A town plot is not a building foundation. The farmhouse and barn sit outside
 * the original 31-m village pad, so terrain used to bury their lower facades.
 * Flatten the *actual rotated footprint*, feather its surround, and keep the
 * top of each prop's existing collider at its authored height. No physics
 * primitives or external lanes need to be changed.
 */
function gradeBuildingFootprints(island: IslandData, props: readonly PropDescriptor[]): void {
  const buildings = new Set(['barn', 'house', 'shop', 'booth', 'cottage', 'control-house']);
  const scale = island.size / 600;
  for (const prop of props) {
    if (!buildings.has(prop.kind) || prop.body.type !== 'static') continue;
    // Stalls above the pier must not stamp sand into the deck or drop to ground Y.
    if (prop.poiId === 'baa-ardwalk' && prop.kind === 'booth') continue;
    // A bounding circle covers every corner even when the facade is rotated.
    const radius = Math.hypot(prop.size.x, prop.size.z) * 0.5 + 5 * scale;
    stampPlot(island, {
      poiId: prop.poiId ?? 'hoofington',
      center: { x: prop.transform.position.x, z: prop.transform.position.z },
      elevation: prop.transform.position.y - prop.size.y * 0.5,
      radius, flat: true,
    });
  }
  for (const prop of props) {
    if (!buildings.has(prop.kind) || prop.body.type !== 'static') continue;
    // Stalls above the pier must not stamp sand into the deck or drop to ground Y.
    if (prop.poiId === 'baa-ardwalk' && prop.kind === 'booth') continue;
    const pos = prop.transform.position;
    pos.y = gridSample(island, pos.x, pos.z) + prop.size.y * 0.5;
  }
}

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
  // The highland stream feeds the northern dam, then arcs through the NW pines to the sea.
  const river: RiverPoint[] = [
    { x: -30, z: -65, level: 35, width: 4 },
    { x: -40, z: -103, level: 23, width: 5 },
    { x: -27, z: -141, level: 14, width: 7 },
    { x: -18, z: -174, level: 12, width: 9 },
    { x: -31, z: -198, level: 9, width: 11 },
    // The spillway now opens into a broad pool and flows toward the camera;
    // the old westward diagonal from the wall crossed dry grass.
    { x: -27, z: -188, level: 6.2, width: 39 },
    { x: -28, z: -174, level: 5.8, width: 46 },
    { x: -32, z: -161, level: 5.2, width: 34 },
    { x: -37, z: -145, level: 4.6, width: 25 },
    { x: -42, z: -127, level: 4.0, width: 21 },
    { x: -44, z: -107, level: 3.5, width: 19 },
    // It rejoins the forest river beyond the bookmark's foreground.
    { x: -70, z: -126, level: 3.1, width: 16 },
    { x: -113, z: -161, level: 2.9, width: 11 },
    { x: -157, z: -183, level: 2.1, width: 13 },
    { x: -196, z: -214, level: 0.6, width: 16 },
    { x: -227, z: -243, level: -1, width: 20 },
  ].map(p => ({ x: p.x * scale, z: p.z * scale, level: p.level * scale, width: p.width * scale }));
  const reservoir = {
    center: { x: -16 * scale, z: -175 * scale },
    radiusX: 26 * scale, radiusZ: 22 * scale, level: 12 * scale,
  };
  const island: IslandData = {
    seed, size, resolution, seaLevel: 0,
    heights, biomeMap: new Uint8Array(resolution * resolution),
    zoneMap: new Uint8Array(resolution * resolution),
    pois: [], plots: [], river, reservoir, roads: [], props: [], colliders: [],
    spawns: [], relics: [], tideLevels: [],
  };
  carveWater(island, river, reservoir);
  // Cut the wide four-fall plunge pool and raise its rocky lips in Rapier terrain.
  sculptDamOutflow(island);
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
  const lighthouse = island.pois.find(p => p.id === 'old-lighthouse')!;
  sculptLighthouseSeaCave(island, {
    x: lighthouse.center.x + 2 * scale,
    z: lighthouse.center.z + 23 * scale,
  });
  island.roads = makeRoads(island, rng);
  island.props = populateProps(island, rng);
  // Grade authored foundations first so nearby street furniture is placed
  // on the final terrain, not hovering at pre-grade elevations.
  gradeBuildingFootprints(island, island.props);
  const dressed = dressIsland(island, rng);
  gradeBuildingFootprints(island, dressed);
  island.props.push(...dressed, ...makeBridgeDecks(island));
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
