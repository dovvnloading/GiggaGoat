import { HOOFINGTON_HAUL_BALE_PREFIX } from '../world/hoofington-entrances';
import type { IslandData, PoiDescriptor, PropDescriptor, PoiId } from '../world';
import { rooftopDecks } from '../world/rooftop-course';
import {
  DIFFICULTIES, GIG_IDS,
} from './types';
import type {
  Difficulty, GigBoard, GigConfig, GigId, GigInfo, GigMarker,
  GigOffer, GigPropSpawn, GigSetup, Point,
} from './types';

export const TICKS_PER_SECOND = 60;
export const BOARD_CYCLE_TICKS = 180 * TICKS_PER_SECOND;

/** Cosmetic ownership is tracked in gigs; gameplay's shop does not expose a grant operation. */
export const GIG_INFO: Readonly<Record<GigId, GigInfo>> = {
  'hay-haul': {
    id: 'hay-haul', title: 'HAY HAUL', poiId: 'hoofington',
    pitch: 'One tongue. Too much hay. Nobody said it had to be tidy.',
    instruction: 'Drag marked bales to the barn drop. Link two quick tows for Gold.',
    verbs: ['tongue'], baseCoins: 64,
    cosmetic: { id: 'hay-hat', name: 'Haywire Hat', slot: 'hat', color: '#F2C14F' },
  },
  'rooftop-express': {
    id: 'rooftop-express', title: 'ROOFTOP EXPRESS', poiId: 'downtown-bleatsville',
    pitch: 'Next-day delivery. Rooftop-only. The recipient is a pigeon.',
    instruction: 'Hold lick to tow the parcel along the roof ramps. Keep it off the street.',
    verbs: ['tongue'], baseCoins: 78,
    cosmetic: { id: 'courier-trail', name: 'Express Streak', slot: 'trail', color: '#7A4CFF' },
  },
  'demolition-contract': {
    id: 'demolition-contract', title: 'DEMOLITION CONTRACT', poiId: 'crane-yard',
    pitch: 'The official building inspector is a goat.',
    instruction: 'Headbutt the marked temporary tower. Move mass, not just dust.',
    verbs: ['headbutt', 'bleat'], baseCoins: 80,
    cosmetic: { id: 'safety-horns', name: 'Safety Third Horns', slot: 'horns', color: '#FF891E' },
  },
  'mow-down': {
    id: 'mow-down', title: 'MOW-DOWN', poiId: 'hoofington',
    pitch: 'A zero-emissions lawnmower with four stomachs.',
    instruction: 'Follow the village road south to the lawn. Eat every glowing patch.',
    verbs: ['eat'], baseCoins: 58,
    cosmetic: { id: 'grass-crown', name: 'Fresh-Cut Crown', slot: 'hat', color: '#77B754' },
  },
  'escort-the-gnome': {
    id: 'escort-the-gnome', title: 'ESCORT THE GNOME', poiId: 'whispering-pines',
    pitch: 'Fragile passenger. Unlicensed goat movers.',
    instruction: 'Nudge the gnome through the flags. Too hard and he cracks.',
    verbs: ['headbutt', 'tongue', 'bleat'], baseCoins: 75,
    cosmetic: { id: 'gnome-cap', name: 'Tiny Guardian Cap', slot: 'hat', color: '#D84F3D' },
  },
  'stack-up': {
    id: 'stack-up', title: 'STACK-UP', poiId: 'crane-yard',
    pitch: 'Structural engineering by the least qualified animal on site.',
    instruction: 'Tongue/ram crates into a vertical tower. Hold steady for five seconds.',
    verbs: ['tongue', 'headbutt', 'flop'], baseCoins: 85,
    cosmetic: { id: 'hard-hat', name: 'Questionably Safe Hard Hat', slot: 'hat', color: '#FFD833' },
  },
  'summit-sprint': {
    id: 'summit-sprint', title: 'SUMMIT SPRINT', poiId: 'mt-gigga',
    pitch: 'A cliff is just a shortcut with consequences.',
    instruction: 'Climb through the ledge flags to Mt. Gigga’s summit.',
    verbs: ['climb', 'tongue'], baseCoins: 82,
    cosmetic: { id: 'summit-badge', name: 'Peak Freak Badge', slot: 'badge', color: '#8C919E' },
  },
  'splash-dive': {
    id: 'splash-dive', title: 'SPLASH DIVE', poiId: 'baa-ardwalk',
    pitch: 'The crowd wants a big splash, not a graceful one.',
    instruction: 'Reach the high board, leap, and make a measured big splash.',
    verbs: ['flop', 'climb', 'bleat'], baseCoins: 63,
    cosmetic: { id: 'bubble-trail', name: 'Bubble Trouble', slot: 'trail', color: '#21A8C6' },
  },
  'dam-bomb': {
    id: 'dam-bomb', title: 'DAM BOMB', poiId: 'the-dam',
    pitch: 'The water inspector recommends a full-body impact.',
    instruction: 'Flop off the dam high walk into the reservoir. Make a huge splash.',
    verbs: ['flop', 'climb'], baseCoins: 75,
    cosmetic: { id: 'dam-flippers', name: 'Dam Good Flippers', slot: 'trail', color: '#21A8C6' },
  },
  'beacon-bleat': {
    id: 'beacon-bleat', title: 'BEACON BLEAT', poiId: 'old-lighthouse',
    pitch: 'The lighthouse foghorn has been replaced by one loud goat.',
    instruction: 'Climb the lighthouse rooftops, then BLEAT at the top.',
    verbs: ['climb', 'tongue', 'bleat'], baseCoins: 79,
    cosmetic: { id: 'beacon-horns', name: 'Fog-horn Horns', slot: 'horns', color: '#FFD833' },
  },
};
const ROSTER: Readonly<Record<PoiId, readonly GigId[]>> = {
  hoofington: ['hay-haul', 'mow-down'],
  'baa-ardwalk': ['splash-dive'],
  'crane-yard': ['demolition-contract', 'stack-up'],
  'downtown-bleatsville': ['rooftop-express'],
  'mt-gigga': ['summit-sprint'],
  'whispering-pines': ['escort-the-gnome'],
  'the-dam': ['dam-bomb'], 'old-lighthouse': ['beacon-bleat'],
};
const LIMIT_SECONDS: Readonly<Record<GigId, readonly [number, number, number]>> = {
  'hay-haul': [110, 95, 84],
  'rooftop-express': [100, 85, 70],
  'demolition-contract': [85, 72, 60],
  'mow-down': [90, 80, 70],
  'escort-the-gnome': [120, 105, 90],
  'stack-up': [110, 100, 90],
  'summit-sprint': [110, 96, 82],
  'splash-dive': [75, 65, 55],
  'dam-bomb': [80, 68, 57],
  'beacon-bleat': [105, 88, 75],
};
const copy = (p: Point): Point => ({ x: p.x, y: p.y, z: p.z });
const plus = (p: Point, x: number, y: number, z: number): Point =>
  ({ x: p.x + x, y: p.y + y, z: p.z + z });
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
class Random {
  private value: number;
  constructor(seed: number) { this.value = seed || 0x6d2b79f5; }
  next(): number {
    let x = this.value;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.value = x >>> 0;
    return this.value / 4294967296;
  }
  int(max: number): number { return Math.floor(this.next() * max); }
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
}
function marker(id: string, label: string, position: Point, radius: number,
  type: GigMarker['type']): GigMarker {
  return { id, label, position: copy(position), radius, type };
}
function requireKind(props: readonly PropDescriptor[], poi: PoiId, kind: PropDescriptor['kind']): PropDescriptor[] {
  const found = props.filter(p => p.poiId === poi && p.kind === kind);
  if (!found.length) throw new Error('Billy Isle is missing ' + kind + ' at ' + poi);
  return found;
}
interface LawnObstacle {
  x: number; z: number; halfX: number; halfZ: number; cos: number; sin: number;
}

function overlapsLawn(obstacle: LawnObstacle, x: number, z: number, halfX: number, halfZ: number): boolean {
  const dx = obstacle.x - x, dz = obstacle.z - z;
  const { cos, sin } = obstacle;
  const c = Math.abs(cos), s = Math.abs(sin);
  return Math.abs(dx) < halfX + obstacle.halfX * c + obstacle.halfZ * s &&
    Math.abs(dz) < halfZ + obstacle.halfX * s + obstacle.halfZ * c &&
    Math.abs(dx * cos - dz * sin) < obstacle.halfX + halfX * c + halfZ * s &&
    Math.abs(dx * sin + dz * cos) < obstacle.halfZ + halfX * s + halfZ * c;
}

const MOW_SPACING = 2.1;
// The displayed boundary extends 1.3 m past the outside row. Leave extra
// room for a goat to turn at the edge rather than grazing against a fence.
const MOW_EDGE = 1.8;
const MOW_LAWN_CANDIDATES: Array<{ x: number; z: number; distance: number }> = [];
for (let z = 39; z <= 68; z++) {
  for (let x = 8; x <= 38; x++) {
    const distance = z + x * .65;
    MOW_LAWN_CANDIDATES.push({ x: -x, z, distance }, { x, z, distance });
  }
}
MOW_LAWN_CANDIDATES.sort((a, b) =>
  a.distance - b.distance || a.z - b.z || Number(a.x > 0) - Number(b.x > 0) ||
  Math.abs(a.x) - Math.abs(b.x));

/** Data is captured at construction so another team can mutate world visuals without changing a run. */
export class GigCatalog {
  readonly seed: number;
  private readonly pois: Map<PoiId, PoiDescriptor>;
  private readonly props: PropDescriptor[];
  private readonly seaLevel: number;
  private readonly reservoirLevel: number;
  private readonly terrain: Float32Array;
  private readonly resolution: number;
  private readonly islandSize: number;
  private readonly mowProps: LawnObstacle[];
  private readonly mowRoads: LawnObstacle[];
  constructor(island: Pick<IslandData, 'seed' | 'pois' | 'props' | 'seaLevel' | 'reservoir' | 'heights' |
    'resolution' | 'size'> & Partial<Pick<IslandData, 'roads'>>, seed: number | string = 1) {
    this.seed = hash(String(island.seed) + ':' + String(seed));
    this.seaLevel = island.seaLevel;
    this.reservoirLevel = island.reservoir.level;
    this.terrain = island.heights.slice();
    this.resolution = island.resolution;
    this.islandSize = island.size;
    this.pois = new Map(island.pois.map(p => [p.id, {
      ...p, center: copy(p.center),
    }]));
    this.props = island.props.map(p => ({
      ...p, size: copy(p.size), transform: {
        position: copy(p.transform.position), rotationY: p.transform.rotationY,
      }, body: { ...p.body },
    }));
    const farm = this.poi('hoofington').center;
    const scale = this.islandSize / 600;
    const nearFarm = (x: number, z: number): boolean => Math.hypot(x - farm.x, z - farm.z) < 95 * scale + 10;
    this.mowProps = this.props.filter(prop => prop.collidable && prop.kind !== 'grass-tuft' &&
      nearFarm(prop.transform.position.x, prop.transform.position.z)).map(prop => {
      const { position, rotationY } = prop.transform;
      return { x: position.x, z: position.z, halfX: prop.size.x / 2, halfZ: prop.size.z / 2,
        cos: Math.cos(rotationY), sin: Math.sin(rotationY) };
    });
    this.mowRoads = (island.roads ?? []).flatMap(road => road.points.slice(1).flatMap((b, i) => {
      const a = road.points[i]!, dx = b.x - a.x, dz = b.z - a.z;
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, length = Math.hypot(dx, dz);
      if (length <= 1e-6 || !nearFarm(x, z)) return [];
      return [{ x, z, halfX: road.width / 2 + 1.7 * scale, halfZ: length / 2 + scale,
        cos: dz / length, sin: dx / length }];
    }));
  }
  /** Billy Isle row-major bilinear terrain lookup, duplicated as plain data to avoid engine imports. */
  private terrainY(x: number, z: number): number {
    const n = this.resolution;
    const clamp = (v: number): number => Math.max(0, Math.min(n - 1, v));
    const gx = clamp((x / this.islandSize + 0.5) * (n - 1));
    const gz = clamp((z / this.islandSize + 0.5) * (n - 1));
    const ix = Math.min(n - 2, Math.floor(gx)), iz = Math.min(n - 2, Math.floor(gz));
    const u = gx - ix, v = gz - iz;
    const a = this.terrain[iz * n + ix]!, b = this.terrain[iz * n + ix + 1]!;
    const c = this.terrain[(iz + 1) * n + ix]!, d = this.terrain[(iz + 1) * n + ix + 1]!;
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  private mowPatches(poi: PoiDescriptor, cols: number, rows: number, rng: Random): Point[] {
    const scale = this.islandSize / 600;
    const layout: Point[][] = [];
    let bestDistance = Infinity;
    const halfCols = (cols - 1) * MOW_SPACING / 2;
    const halfRows = (rows - 1) * MOW_SPACING / 2;
    for (const offset of MOW_LAWN_CANDIDATES) {
      if (offset.distance > bestDistance + 4) break;
      const x = poi.center.x + offset.x * scale, z = poi.center.z + offset.z * scale;
      // Start on the village road, walk past the final pickets, then turn
      // directly onto the lawn. The approach can cross pavement.
      const entranceX = (x + poi.center.x) / 2;
      const entranceHalfX = Math.abs(x - poi.center.x) / 2 + .75;
      if (this.mowProps.some(prop => overlapsLawn(prop, entranceX, z, entranceHalfX, .75))) continue;

      for (const sideways of [false, true]) {
        const halfX = (sideways ? halfRows : halfCols) + MOW_EDGE;
        const halfZ = (sideways ? halfCols : halfRows) + MOW_EDGE;
        if (this.mowProps.some(prop => overlapsLawn(prop, x, z, halfX, halfZ)) ||
            this.mowRoads.some(road => overlapsLawn(road, x, z, halfX, halfZ))) continue;
        const patches = this.mowGrid({ x, y: 0, z }, cols, rows, sideways);
        if (!patches.every(patch => this.mowPatchOnLawn(patch))) continue;
        bestDistance = Math.min(bestDistance, offset.distance);
        layout.push(patches);
      }
    }
    if (!layout.length) throw new Error('Hoofington has no clear lawn south of the village');
    return layout[rng.int(layout.length)]!;
  }

  private mowGrid(center: Point, cols: number, rows: number, sideways = false): Point[] {
    const patches: Point[] = [];
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const along = (col - (cols - 1) / 2) * MOW_SPACING;
      const across = (row - (rows - 1) / 2) * MOW_SPACING;
      const p = plus(center, sideways ? across : along, 0, sideways ? along : across);
      p.y = this.terrainY(p.x, p.z) + .15;
      patches.push(p);
    }
    return patches;
  }

  private mowPatchOnLawn({ x, y, z }: Point): boolean {
    if (y - .15 <= this.seaLevel + .65) return false;
    // Flat patch rings have a .93 m outer radius and are .15 m above the centre.
    // Keep both the painted rim and the graze radius on gentle terrain.
    for (let side = 0; side < 8; side++) {
      const angle = side * Math.PI / 4;
      const height = this.terrainY(x + Math.cos(angle), z + Math.sin(angle));
      if (Math.abs(height - (y - .15)) >= .14) return false;
    }
    return true;
  }

  get ids(): readonly GigId[] { return GIG_IDS; }
  info(id: GigId): GigInfo { return structuredClone(GIG_INFO[id]); }
  private poi(id: PoiId): PoiDescriptor {
    const found = this.pois.get(id);
    if (!found) throw new Error('Missing POI ' + id);
    return found;
  }
  /** Cycle/slot/seed are in the ID; the offer is stable independent of call order. */
  makeOffer(gigId: GigId, difficulty: Difficulty, cycle = 0, slot = 0): GigOffer {
    if (!GIG_INFO[gigId] || !DIFFICULTIES.includes(difficulty) ||
      !Number.isSafeInteger(cycle) || cycle < 0) throw new RangeError('Invalid gig offer');
    const poiId = GIG_INFO[gigId].poiId;
    const variantSeed = hash(this.seed + '/' + gigId + '/' + difficulty + '/' + cycle + '/' + slot);
    return {
      id: poiId + ':' + cycle + ':' + slot + ':' + gigId + ':' + difficulty + ':' + variantSeed,
      gigId, poiId, difficulty, cycle, variantSeed,
      startTick: cycle * BOARD_CYCLE_TICKS,
      expiresTick: (cycle + 1) * BOARD_CYCLE_TICKS,
    };
  }
  board(poiId: PoiId, tick: number): GigBoard {
    this.poi(poiId);
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('Invalid tick');
    const cycle = Math.floor(tick / BOARD_CYCLE_TICKS);
    const roster = ROSTER[poiId];
    const offset = roster.length ? hash(poiId + '/' + this.seed + '/' + cycle) % roster.length : 0;
    const offers = roster.map((_, slot) => {
      const id = roster[(offset + slot) % roster.length]!;
      const diff = DIFFICULTIES[(cycle + slot + (hash(poiId) % 3)) % 3]!;
      return this.makeOffer(id, diff, cycle, slot);
    });
    return { poiId, cycle, offers, refreshInTicks: (cycle + 1) * BOARD_CYCLE_TICKS - tick };
  }
  /** A setup is a request to the host for temporary physics objects, not a physics simulation. */
  build(offer: GigOffer): GigSetup {
    return this.buildVariant(offer, false);
  }

  restoreSetup(saved: GigSetup): GigSetup | null {
    const current = this.build(saved.offer);
    const serialized = JSON.stringify(saved);
    if (JSON.stringify(current) === serialized) return saved;
    if (current.config.kind === 'hay-haul') {
      const fieldSupply = this.buildVariant(saved.offer, false, true);
      if (JSON.stringify(fieldSupply) === serialized) return saved;
      if (JSON.stringify(this.buildVariant(saved.offer, true, true)) === serialized) return fieldSupply;
    }
    if ((current.config.kind === 'mow-down' || current.config.kind === 'rooftop-express') &&
        JSON.stringify(this.buildVariant(saved.offer, true)) === serialized) return current;
    return null;
  }

  private buildVariant(offer: GigOffer, legacyLayout: boolean, fieldSupply = false): GigSetup {
    if (offer.poiId !== GIG_INFO[offer.gigId]?.poiId ||
      offer.variantSeed !== this.makeOffer(offer.gigId, offer.difficulty, offer.cycle,
        Number(offer.id.split(':')[2])).variantSeed) throw new RangeError('Offer does not match catalog');
    const rng = new Random(offer.variantSeed);
    const tier = DIFFICULTIES.indexOf(offer.difficulty);
    const poi = this.poi(offer.poiId);
    const s = offer.id.replaceAll(':', '-');
    let start: Point = copy(poi.center);
    let config: GigConfig;
    let spawns: GigPropSpawn[] = [];
    let markers: GigMarker[] = [];
    switch (offer.gigId) {
      case 'hay-haul': {
        const barn = requireKind(this.props, 'hoofington', 'barn')[0]!;
        const supply = requireKind(this.props, 'hoofington', 'hay-bale').filter(p => p.body.type === 'dynamic');
        const loadLine = supply.filter(p => p.id.startsWith(HOOFINGTON_HAUL_BALE_PREFIX));
        const useField = fieldSupply || loadLine.length < 5;
        const eligible = useField ? supply.filter(p => !p.id.startsWith(HOOFINGTON_HAUL_BALE_PREFIX))
          : loadLine.slice(0, [4, 6, 7][tier]);
        const bales = rng.shuffle(eligible).slice(0, [3, 4, 5][tier]!);
        const { position, rotationY } = barn.transform;
        const scale = this.islandSize / 600;
        // In the open apron south-east of the barn, between the silo and the house.
        const side = -(barn.size.x / 2 + 2.95 * scale);
        const front = 2.75 * scale;
        const x = position.x + Math.cos(rotationY) * side + Math.sin(rotationY) * front;
        const z = position.z - Math.sin(rotationY) * side + Math.cos(rotationY) * front;
        const target = legacyLayout ? plus(position, 0, -barn.size.y / 2 + 1, 0) :
          { x, y: this.terrainY(x, z) + .9 * scale, z };
        const radius = legacyLayout ? 6.5 : 2.6 * scale;
        config = { kind: 'hay-haul', barn: target, radius,
          bales: bales.map(b => ({ id: b.id, start: copy(b.transform.position) })),
          required: bales.length };
        start = copy(bales[0]!.transform.position);
        markers = [marker('barn', 'Barn drop', target, radius, 'destination'),
          ...bales.map((b, i) => marker(b.id, 'Bale ' + (i + 1), b.transform.position, 1.3, 'start'))];
        break;
      }
      case 'rooftop-express': {
        const parcelId = 'gig-parcel-' + s;
        let checkpoints: Point[];
        let parcel: Point;
        let size: Point;
        if (legacyLayout) {
          // Rebuild the former route verbatim to authenticate saved attempts.
          const rowZ = poi.center.z + (rng.int(3) - 1) * 19;
          const row = this.props.filter(p => p.poiId === 'downtown-bleatsville' &&
            (p.kind === 'shop' || p.kind === 'house') &&
            Math.abs(p.transform.position.z - rowZ) < 3)
            .sort((a, b) => a.transform.position.x - b.transform.position.x);
          if (row.length < 4) throw new Error('Downtown requires four roof buildings per street');
          const selected = row.slice(tier === 0 ? rng.int(2) : 0,
            tier === 0 ? undefined : 4).slice(0, tier === 0 ? 3 : 4);
          checkpoints = selected.map(p => plus(p.transform.position, 0, p.size.y / 2 + .65, 0));
          parcel = copy(checkpoints[0]!);
          start = plus(parcel, 1.2, 0, 0);
          size = { x: .8, y: .7, z: .8 };
          markers = checkpoints.map((p, i) => marker('roof-' + i, 'Roof ' + (i + 1), p, 3.8, 'checkpoint'));
        } else {
          const decks = rooftopDecks(this.props);
          if (decks.length !== 5) throw new Error('Downtown requires five linked courier roofs');
          const count = 3 + tier;
          const first = rng.int(decks.length - count + 1);
          const route = decks.slice(first, first + count);
          if (rng.int(2)) route.reverse();
          const launch = route[0]!;
          const direction = Math.sign(route[1]!.transform.position.z - launch.transform.position.z);
          const deckTop = launch.transform.position.y + launch.size.y / 2;
          const startOffset = 1.8 * this.islandSize / 600;
          size = { x: .9, y: 1.22, z: .9 };
          parcel = { ...launch.transform.position, y: deckTop + size.y / 2 + .035 };
          start = { x: parcel.x, y: deckTop + .025, z: parcel.z - direction * startOffset };
          checkpoints = route.map(deck => plus(deck.transform.position, 0, deck.size.y / 2 + .5, 0));
          markers = checkpoints.map((p, i) => marker('roof-' + i,
            i === 0 ? 'Pick up parcel' : i === count - 1 ? 'Deliver parcel' : 'Roof ' + (i + 1),
            p, 3.8, i === 0 ? 'start' : i === count - 1 ? 'destination' : 'checkpoint'));
        }
        spawns = [{ id: parcelId, role: 'parcel', position: parcel,
          size, mass: 2.5, fragile: true, color: '#FFD833' }];
        config = { kind: 'rooftop-express', parcelId, checkpoints, streetY: poi.center.y };
        break;
      }
      case 'demolition-contract': {
        const tower = requireKind(this.props, 'crane-yard', 'tower')[0]!;
        const anchor = plus(tower.transform.position, tower.size.x / 2 + 7 + rng.int(3) - 1,
          -tower.size.y / 2, rng.int(5) - 2);
        const pieces: { id: string; start: Point; mass: number }[] = [];
        const rows = 3 + tier;
        for (let y = 0; y < rows; y++) for (let x = 0; x < 2; x++) {
          const position = plus(anchor, (x - 0.5) * 2.15, 1.15 + y * 2.3, 0);
          const id = 'gig-tower-' + s + '-' + y + '-' + x;
          const mass = 18 + y * 3;
          pieces.push({ id, start: position, mass });
          spawns.push({ id, role: 'tower', position: copy(position),
            size: { x: 2.15, y: 2.3, z: 2.15 }, mass, fragile: false, color: '#FF891E' });
        }
        config = { kind: 'demolition-contract', pieces, requiredFraction: [0.56, 0.64, 0.72][tier]! };
        start = plus(anchor, 0, 1, 9);
        markers = [marker('tower', 'Topple me', plus(anchor, 0, 3, 0), 5, 'destination')];
        break;
      }
      case 'mow-down': {
        const cols = 4 + tier, rows = 3 + (tier === 2 ? 1 : 0);
        const patches = legacyLayout
          ? this.mowGrid(plus(poi.center, 13 + rng.int(3), .2, 8 + rng.int(3)), cols, rows)
          : this.mowPatches(poi, cols, rows, rng);
        config = { kind: 'mow-down', patches, biteRadius: 2.4 };
        start = copy(patches[0]!);
        markers = patches.map((p, i) => marker('grass-' + i, 'Munch ' + (i + 1), p, 1, 'patch'));
        break;
      }
      case 'escort-the-gnome': {
        const sign = requireKind(this.props, 'whispering-pines', 'sign')[0]!;
        const gnomeId = 'gig-gnome-' + s;
        const route: Point[] = [];
        const initial = plus(sign.transform.position, 3 + rng.int(3),
          0, 1 + rng.int(3));
        for (let i = 0; i < 4 + tier; i++) {
          const p = plus(initial, i * 5.5, 0, Math.sin(i * 1.3) * 3 + i * 2);
          p.y = this.terrainY(p.x, p.z) + 0.8;
          route.push(p);
        }
        config = { kind: 'escort-the-gnome', gnomeId, route,
          breakImpulse: [48, 36, 27][tier]! };
        spawns = [{ id: gnomeId, role: 'gnome', position: copy(route[0]!),
          size: { x: 0.8, y: 1.6, z: 0.8 }, mass: 3.5, fragile: true, color: '#D84F3D' }];
        start = plus(route[0]!, 2, 0, 1);
        markers = route.map((p, i) => marker('gnome-' + i, 'Flag ' + (i + 1), p, 2.3, 'checkpoint'));
        break;
      }
      case 'stack-up': {
        const center = plus(poi.center, 25 + rng.int(3), 0, -25 + rng.int(3));
        center.y = this.terrainY(center.x, center.z);
        const layers = 2 + tier;
        const crateIds: string[] = [];
        for (let i = 0; i < layers + 2; i++) {
          const id = 'gig-crate-' + s + '-' + i;
          const position = plus(center, 4 + i * 2.8, 1.1, 2);
          crateIds.push(id);
          spawns.push({ id, role: 'stack-crate', position, size: { x: 2.2, y: 2.2, z: 2.2 },
            mass: 20, fragile: false, color: '#F2C14F' });
        }
        config = { kind: 'stack-up', crateIds, center: copy(center),
          groundY: center.y, crateHeight: 2.2, requiredLayers: layers, holdTicks: 300 };
        start = plus(center, 5, 1, 5);
        markers = [marker('stack-zone', 'Build here', plus(center, 0, 1.1, 0), 2, 'destination')];
        break;
      }
      case 'summit-sprint': {
        const ledges = requireKind(this.props, 'mt-gigga', 'ledge')
          .filter(p => p.transform.position.y < poi.center.y - 3)
          .sort((a, b) => a.transform.position.y - b.transform.position.y);
        const steps = 2 + tier;
        const checkpoints: Point[] = [];
        for (let i = 0; i < steps; i++) {
          const index = Math.max(0, Math.min(ledges.length - 1,
            Math.floor((i + 1) * ledges.length / (steps + 1)) + rng.int(3) - 1));
          const p = ledges[index]!;
          checkpoints.push(plus(p.transform.position, 0, p.size.y / 2 + 0.6, 0));
        }
        checkpoints.push(plus(poi.center, 0, 1, 0));
        config = { kind: 'summit-sprint', checkpoints, minimumClimb: [4, 7, 10][tier]! };
        start = plus(checkpoints[0]!, 0, 0, 3);
        markers = checkpoints.map((p, i) => marker('summit-' + i, 'Cliff ' + (i + 1), p, 6, 'checkpoint'));
        break;
      }
      case 'dam-bomb': {
        const walkway = requireKind(this.props, 'the-dam', 'platform')[0]!;
        const jumpPoint = plus(walkway.transform.position,
          walkway.size.x / 2 - 3 + rng.int(3), walkway.size.y / 2 + 0.6,
          walkway.size.z / 2 - 1);
        const landing = plus(jumpPoint, 0, this.reservoirLevel - jumpPoint.y, 6);
        config = { kind: 'splash-dive', jumpPoint, landing, waterY: this.reservoirLevel,
          minDrop: [3.5, 5.5, 7.5][tier]!, requiresFlop: true };
        start = copy(jumpPoint);
        markers = [marker('dam-board', 'Flop from here', jumpPoint, 3.5, 'start'),
          marker('dam-splash', 'Reservoir landing', landing, 3.6, 'destination')];
        break;
      }
      case 'beacon-bleat': {
        const tower = requireKind(this.props, 'old-lighthouse', 'lighthouse')[0]!;
        const house = requireKind(this.props, 'old-lighthouse', 'house')[0]!;
        const platform = requireKind(this.props, 'old-lighthouse', 'platform')[0]!;
        const roof = (prop: PropDescriptor): Point =>
          plus(prop.transform.position, 0, prop.size.y / 2 + 0.65, 0);
        const fromPlatform = rng.int(2) === 0;
        const checkpoints = tier === 0 ?
          [roof(fromPlatform ? platform : house), roof(tower)] :
          fromPlatform ? [roof(platform), roof(house), roof(tower)] :
            [roof(house), roof(platform), roof(tower)];
        config = { kind: 'summit-sprint', checkpoints,
          minimumClimb: [5, 8, 12][tier]!, requiresBleat: true };
        start = plus(checkpoints[0]!, rng.int(3), 0, 2);
        markers = checkpoints.map((p, i) => marker('beacon-' + i,
          i === checkpoints.length - 1 ? 'BLEAT HERE' : 'Roof ' + (i + 1),
          p, 5.5, 'checkpoint'));
        break;
      }
      case 'splash-dive': {
        const pier = requireKind(this.props, 'baa-ardwalk', 'pier')[0]!;
        const jumpPoint = plus(pier.transform.position, rng.int(5) - 2,
          pier.size.y / 2 + 0.7, pier.size.z / 2 - 5);
        const landing = plus(jumpPoint, 0, this.seaLevel - jumpPoint.y, 7);
        config = { kind: 'splash-dive', jumpPoint, landing, waterY: this.seaLevel,
          minDrop: [2.5, 3.5, 4.5][tier]! };
        start = copy(jumpPoint);
        markers = [marker('high-board', 'Jump from here', jumpPoint, 3.5, 'start'),
          marker('splash-zone', 'Make waves', landing, 3.6, 'destination')];
        break;
      }
    }
    const maxTicks = LIMIT_SECONDS[offer.gigId][tier]! * TICKS_PER_SECOND;
    const info = this.info(offer.gigId);
    if (offer.gigId === 'hay-haul') {
      if (legacyLayout) info.instruction = 'Lick the marked bales into the barn. Chain-tow two for a combo.';
      else if (fieldSupply) info.instruction = 'Drag the marked bales to the drop beside the barn. Chain-tow two for a combo.';
    }
    if (legacyLayout && offer.gigId === 'mow-down') {
      info.instruction = 'Eat every glowing grass patch. Plan an efficient bite path.';
    }
    if (legacyLayout && offer.gigId === 'rooftop-express') {
      info.instruction = 'Tongue-carry the parcel across the roof markers. Never touch the street.';
      info.verbs = ['tongue', 'climb', 'flop'];
    }
    return {
      offer: structuredClone(offer), info, start, config,
      spawns, markers, maxTicks, goldTicks: Math.round(maxTicks * 0.55),
      silverTicks: Math.round(maxTicks * 0.82),
    };
  }
}
