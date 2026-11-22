import { HOOFINGTON_HAUL_BALE_PREFIX } from '../world/hoofington-entrances';
import { SPLASH_DIVE_BOARD_ID } from '../world/boardwalk';
import type { IslandData, PoiDescriptor, PropDescriptor, PoiId } from '../world';
import { rooftopDecks } from '../world/rooftop-course';
import { formerLighthouseAccess, lighthouseAccess, lighthouseFlagPositions } from '../world/lighthouse-access';
import { sectionCenter } from '../world/access-path';
import { damOutflowWaterY } from '../world/dam-landscape';
import { getDamPlacement, type DamPlacement } from '../world/the-dam';
import { HOOFINGTON_VERGE_WIDTH } from '../world/hoofington-verge';
import { makeLocalStreets } from '../world/roads';
import {
  DIFFICULTIES, GIG_IDS,
} from './types';
import type {
  Difficulty, GigBoard, GigConfig, GigId, GigInfo, GigMarker,
  GigOffer, GigPropSpawn, GigSetup, Point,
} from './types';

export const TICKS_PER_SECOND = 60;
export const BOARD_CYCLE_TICKS = 180 * TICKS_PER_SECOND;

const PREVIOUS_DEMOLITION_INSTRUCTION =
  'Hold and release headbutt against the marked tower’s bottom row to topple it.';

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
    instruction: 'From the board side, charge and release a headbutt at each bottom crate.',
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
    instruction: 'Get ahead of the gnome, face it and hold lick. Tow it through the flags. Release to reposition. Avoid headbutts.',
    verbs: ['headbutt', 'tongue', 'bleat'], baseCoins: 75,
    cosmetic: { id: 'gnome-cap', name: 'Tiny Guardian Cap', slot: 'hat', color: '#D84F3D' },
  },
  'stack-up': {
    id: 'stack-up', title: 'STACK-UP', poiId: 'crane-yard',
    pitch: 'Structural engineering by the least qualified animal on site.',
    instruction: 'Tow a crate to the pad. While holding it, reel to lift it onto the stack. Hold the stack steady for five seconds.',
    verbs: ['tongue', 'headbutt', 'flop'], baseCoins: 85,
    cosmetic: { id: 'hard-hat', name: 'Questionably Safe Hard Hat', slot: 'hat', color: '#FFD833' },
  },
  'summit-sprint': {
    id: 'summit-sprint', title: 'SUMMIT SPRINT', poiId: 'mt-gigga',
    pitch: 'A cliff is just a shortcut with consequences.',
    instruction: 'Start at the first flag and follow the marked trail uphill to the summit.',
    verbs: ['climb', 'tongue'], baseCoins: 82,
    cosmetic: { id: 'summit-badge', name: 'Peak Freak Badge', slot: 'badge', color: '#8C919E' },
  },
  'splash-dive': {
    id: 'splash-dive', title: 'SPLASH DIVE', poiId: 'baa-ardwalk',
    pitch: 'The crowd wants a big splash, not a graceful one.',
    instruction: 'Find the side diving board. Leap straight toward the ring in open water.',
    verbs: ['flop', 'climb', 'bleat'], baseCoins: 63,
    cosmetic: { id: 'bubble-trail', name: 'Bubble Trouble', slot: 'trail', color: '#21A8C6' },
  },
  'dam-bomb': {
    id: 'dam-bomb', title: 'DAM BOMB', poiId: 'the-dam',
    pitch: 'The water inspector recommends a full-body impact.',
    instruction: 'Take the yellow ramp beside the board to the upper deck. Run through the spillway gap and flop toward the splash ring.',
    verbs: ['flop', 'climb'], baseCoins: 75,
    cosmetic: { id: 'dam-flippers', name: 'Dam Good Flippers', slot: 'trail', color: '#21A8C6' },
  },
  'beacon-bleat': {
    id: 'beacon-bleat', title: 'BEACON BLEAT', poiId: 'old-lighthouse',
    pitch: 'The lighthouse foghorn has been replaced by one loud goat.',
    instruction: 'Follow the outside stair through the flags, then press BLEAT at the lantern.',
    verbs: ['bleat'], baseCoins: 79,
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

/** Demolition can refresh its approach cue while keeping the saved course and bodies. */
export function gigSetupRelocated(saved: GigSetup, current: GigSetup): boolean {
  if (saved === current) return false;
  const comparable = current.config.kind === 'demolition-contract'
    ? { ...saved, info: current.info, markers: current.markers } : saved;
  return JSON.stringify(comparable) !== JSON.stringify(current);
}

/** Data is captured at construction so another team can mutate world visuals without changing a run. */
export class GigCatalog {
  readonly seed: number;
  private readonly pois: Map<PoiId, PoiDescriptor>;
  private readonly props: PropDescriptor[];
  private readonly seaLevel: number;
  private readonly reservoirLevel: number;
  private readonly damPlacement: DamPlacement;
  private readonly terrain: Float32Array;
  private readonly resolution: number;
  private readonly islandSize: number;
  private readonly mowProps: LawnObstacle[];
  private readonly mowRoads: LawnObstacle[];
  private readonly villagePaving: LawnObstacle;
  private readonly summitTrail: Point[];
  private readonly legacySummitLedgePositions: Readonly<Record<string, Point>>;
  constructor(island: Pick<IslandData, 'seed' | 'pois' | 'props' | 'seaLevel' | 'reservoir' | 'heights' |
    'resolution' | 'size'> & Partial<Pick<IslandData, 'roads' | 'legacySummitLedgePositions'>>, seed: number | string = 1) {
    this.seed = hash(String(island.seed) + ':' + String(seed));
    this.seaLevel = island.seaLevel;
    this.reservoirLevel = island.reservoir.level;
    this.damPlacement = getDamPlacement(island);
    this.terrain = island.heights.slice();
    this.resolution = island.resolution;
    this.islandSize = island.size;
    this.legacySummitLedgePositions = structuredClone(island.legacySummitLedgePositions ?? {});
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
    const street = makeLocalStreets(island).find(road => road.from === 'hoofington')!;
    const first = street.points[0]!, last = street.points.at(-1)!;
    this.villagePaving = { x: first.x, z: (first.z + last.z) / 2,
      halfX: street.width / 2 + HOOFINGTON_VERGE_WIDTH * scale, halfZ: (last.z - first.z) / 2,
      cos: 1, sin: 0 };
    this.summitTrail = ((island.roads ?? []).find(road => road.id === 'mt-gigga--hoofington')?.points ?? [])
      .map(copy).reverse();
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
  private mowPatches(poi: PoiDescriptor, cols: number, rows: number, rng: Random,
    avoidVillagePaving: boolean): Point[] {
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
            this.mowRoads.some(road => overlapsLawn(road, x, z, halfX, halfZ)) ||
            (avoidVillagePaving && overlapsLawn(this.villagePaving, x, z, halfX, halfZ))) continue;
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

  private escortRoute(poi: PoiDescriptor, count: number, variant: number): Point[] | undefined {
    const scale = this.islandSize / 600;
    const near = this.props.filter(prop => prop.collidable && prop.kind !== 'grass-tuft' &&
      Math.hypot(prop.transform.position.x - poi.center.x, prop.transform.position.z - poi.center.z) <= 55 * scale);
    const spacing = 5 * scale;
    const open = (x: number, z: number): boolean => {
      const y = this.terrainY(x, z);
      if (y <= this.seaLevel + scale) return false;
      for (const [dx, dz] of [[scale, 0], [-scale, 0], [0, scale], [0, -scale]]) {
        if (Math.abs(this.terrainY(x + dx!, z + dz!) - y) > 0.38 * scale) return false;
      }
      return !near.some(prop => {
        const p = prop.transform.position;
        if (p.y - prop.size.y / 2 > y + 2.2 * scale || p.y + prop.size.y / 2 < y) return false;
        const c = Math.cos(prop.transform.rotationY), s = Math.sin(prop.transform.rotationY);
        const dx = x - p.x, dz = z - p.z;
        return Math.abs(dx * c - dz * s) < prop.size.x / 2 + 1.15 * scale &&
          Math.abs(dx * s + dz * c) < prop.size.z / 2 + 1.15 * scale;
      });
    };
    for (const angle of [0, 0.23, -0.23, 0.46, -0.46]) {
      for (const zOffset of [10, 8, 12, 6, 14, 16, 18, 20]) {
        for (const xOffset of [variant, variant - 2, variant + 2, variant - 4]) {
          const x = poi.center.x + xOffset * scale, z = poi.center.z + zOffset * scale;
          const at = (offset: number): Point => {
            const px = x + offset * Math.cos(angle), pz = z + offset * Math.sin(angle);
            return { x: px, y: this.terrainY(px, pz) + .8, z: pz };
          };
          const last = (count - 1) * spacing;
          const steps = Math.ceil((last + 4 * scale) / (.55 * scale));
          if (!Array.from({ length: steps + 1 }, (_, i) => at(-2.5 * scale + (last + 4 * scale) * i / steps))
            .every(p => open(p.x, p.z))) continue;
          return Array.from({ length: count }, (_, i) => at(i * spacing));
        }
      }
    }
  }

  private summitCheckpoints(tier: number, variant: number): Point[] {
    const scale = this.islandSize / 600;
    const reversed = this.summitTrail.slice().reverse();
    const distances = reversed.map((p, i) => i === 0 ? 0 :
      Math.hypot(p.x - reversed[i - 1]!.x, p.z - reversed[i - 1]!.z));
    for (let i = 1; i < distances.length; i++) distances[i] = distances[i]! + distances[i - 1]!;
    const run = Math.min((50 + 6 * tier + variant * 1.5) * scale, distances.at(-1)!);
    return Array.from({ length: 3 + tier }, (_, i) => {
      const remaining = run * (1 - i / (2 + tier));
      const point = reversed[distances.findIndex(distance => distance >= remaining)]!;
      return { ...point, y: Math.max(point.y + .19, this.terrainY(point.x, point.z)) + .12 };
    });
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
    if (current.config.kind === 'stack-up' && saved.info?.instruction ===
        'Tow the loose crates to the marked pad. Stack them and keep still for five seconds.' &&
        JSON.stringify({ ...current, info: { ...current.info, instruction: saved.info.instruction } }) === serialized) {
      return saved;
    }
    if (current.config.kind === 'escort-the-gnome' && saved.info?.instruction ===
        'Walk behind the gnome to nudge it through the flags, or hold lick and back away. Avoid headbutts.' &&
        JSON.stringify({ ...current, info: { ...current.info, instruction: saved.info.instruction } }) === serialized) {
      return saved;
    }
    if (current.config.kind === 'demolition-contract' &&
        saved.info?.instruction === PREVIOUS_DEMOLITION_INSTRUCTION &&
        !gigSetupRelocated(saved, current)) {
      return current;
    }
    if (current.config.kind === 'hay-haul') {
      const fieldSupply = this.buildVariant(saved.offer, false, true);
      if (JSON.stringify(fieldSupply) === serialized) return saved;
      if (JSON.stringify(this.buildVariant(saved.offer, true, true)) === serialized) return fieldSupply;
    }
    if ((current.config.kind === 'mow-down' || current.config.kind === 'rooftop-express' ||
        saved.offer.gigId === 'beacon-bleat') &&
        JSON.stringify(this.buildVariant(saved.offer, true)) === serialized) return current;
    if (current.config.kind === 'mow-down' &&
        JSON.stringify(this.buildVariant(saved.offer, false, false, false, lighthouseAccess, false)) === serialized) {
      return current;
    }
    if (saved.offer.gigId === 'beacon-bleat' &&
        JSON.stringify(this.buildVariant(saved.offer, false, false, false, formerLighthouseAccess)) === serialized) {
      return current;
    }
    if (saved.offer.gigId === 'dam-bomb' &&
        [false, true].some(legacyInstruction =>
          JSON.stringify(this.buildVariant(saved.offer, legacyInstruction, false, true)) === serialized)) {
      return current;
    }
    if (['splash-dive', 'summit-sprint', 'escort-the-gnome'].includes(saved.offer.gigId) &&
        JSON.stringify(this.buildVariant(saved.offer, true)) === serialized) return current;
    if ((current.config.kind === 'demolition-contract' || current.config.kind === 'stack-up') &&
        JSON.stringify(this.buildVariant(saved.offer, true)) === serialized) return current;
    return null;
  }

  private buildVariant(offer: GigOffer, legacyLayout: boolean, fieldSupply = false,
    legacyDamWater = false, beaconAccess = lighthouseAccess, avoidVillagePaving = true): GigSetup {
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
        const scale = this.islandSize / 600;
        const tower = requireKind(this.props, 'crane-yard', 'tower')[0]!;
        // A standalone practice tower belongs on the open front apron.
        const anchor = legacyLayout
          ? plus(tower.transform.position, tower.size.x / 2 + 7 + rng.int(3) - 1,
            -tower.size.y / 2, rng.int(5) - 2)
          : plus(poi.center, 11 * scale, 0, 12 * scale);
        const size = legacyLayout ? { x: 2.15, y: 2.3, z: 2.15 } :
          { x: 1.65 * Math.min(1, scale), y: 1.50 * Math.min(1, scale), z: 1.45 * Math.min(1, scale) };
        if (!legacyLayout) {
          anchor.y = Math.max(this.terrainY(anchor.x - size.x / 2, anchor.z),
            this.terrainY(anchor.x + size.x / 2, anchor.z));
        }
        const pieces: { id: string; start: Point; mass: number }[] = [];
        const rows = 3 + tier;
        for (let y = 0; y < rows; y++) for (let x = 0; x < 2; x++) {
          const position = plus(anchor, (x - 0.5) * size.x,
            legacyLayout ? 1.15 + y * 2.3 : (y + .5) * size.y,
            legacyLayout ? 0 : -y * .24 * Math.min(1, scale));
          const id = 'gig-tower-' + s + '-' + y + '-' + x;
          const mass = legacyLayout ? 18 + y * 3 : 4.5 + y * .5;
          pieces.push({ id, start: position, mass });
          spawns.push({ id, role: 'tower', position: copy(position),
            size, mass, fragile: false, color: '#FF891E' });
        }
        config = { kind: 'demolition-contract', pieces, requiredFraction: [0.56, 0.64, 0.72][tier]! };
        start = plus(anchor, 0, 1, legacyLayout ? 9 : 7 * scale);
        if (legacyLayout) {
          markers = [marker('tower', 'Topple me', plus(anchor, 0, 3, 0), 5, 'destination')];
        } else {
          // Stage on the board side of the staggered stack, with room to line up either base.
          const approach = plus(anchor, 0, 0, -3.2 * scale);
          approach.y = this.terrainY(approach.x, approach.z);
          markers = [marker('tower', 'BOARD-SIDE APPROACH', approach, 1.8 * scale, 'start')];
        }
        break;
      }
      case 'mow-down': {
        const cols = 4 + tier, rows = 3 + (tier === 2 ? 1 : 0);
        const patches = legacyLayout
          ? this.mowGrid(plus(poi.center, 13 + rng.int(3), .2, 8 + rng.int(3)), cols, rows)
          : this.mowPatches(poi, cols, rows, rng, avoidVillagePaving);
        config = { kind: 'mow-down', patches, biteRadius: 2.4 };
        start = copy(patches[0]!);
        markers = patches.map((p, i) => marker('grass-' + i, 'Munch ' + (i + 1), p, 1, 'patch'));
        break;
      }
      case 'escort-the-gnome': {
        const sign = requireKind(this.props, 'whispering-pines', 'sign')[0]!;
        const gnomeId = 'gig-gnome-' + s;
        const oldRoute: Point[] = [];
        const initial = plus(sign.transform.position, 3 + rng.int(3),
          0, 1 + rng.int(3));
        for (let i = 0; i < 4 + tier; i++) {
          const p = plus(initial, i * 5.5, 0, Math.sin(i * 1.3) * 3 + i * 2);
          p.y = this.terrainY(p.x, p.z) + 0.8;
          oldRoute.push(p);
        }
        const route = legacyLayout ? oldRoute : this.escortRoute(poi, 4 + tier, rng.int(3)) ?? oldRoute;
        config = { kind: 'escort-the-gnome', gnomeId, route,
          breakImpulse: [48, 36, 27][tier]! };
        spawns = [{ id: gnomeId, role: 'gnome', position: plus(route[0]!, 0, legacyLayout ? 0 : .12, 0),
          size: { x: 0.8, y: 1.6, z: 0.8 }, mass: 3.5, fragile: true, color: '#D84F3D' }];
        start = plus(route[0]!, 2, 0, 1);
        markers = route.map((p, i) => marker('gnome-' + i,
          !legacyLayout && i === 0 ? 'Nudge or lick the gnome' : 'Flag ' + (i + 1), p, 2.3, 'checkpoint'));
        break;
      }
      case 'stack-up': {
        const scale = this.islandSize / 600;
        // Reserve the west end of the north apron for the stack, with a
        // compact crate rack to its east. This stays clear of the pipe bay,
        // shipping container and through road.
        const center = legacyLayout ? plus(poi.center, 25 + rng.int(3), 0, -25 + rng.int(3)) :
          plus(poi.center, 11 * scale, 0, -24 * scale);
        center.y = this.terrainY(center.x, center.z);
        const layers = 2 + tier;
        const crateHeight = legacyLayout ? 2.2 : 1.45 * Math.min(1, scale);
        const crateIds: string[] = [];
        for (let i = 0; i < layers + 2; i++) {
          const id = 'gig-crate-' + s + '-' + i;
          const position = legacyLayout ? plus(center, 4 + i * 2.8, 1.1, 2) :
            plus(center, (4.8 + (i % 2) * 3.2) * scale, 0, [0, -3.2, 3.2][Math.floor(i / 2)]! * scale);
          if (!legacyLayout) position.y = this.terrainY(position.x, position.z) + crateHeight / 2;
          crateIds.push(id);
          spawns.push({ id, role: 'stack-crate', position,
            size: { x: crateHeight, y: crateHeight, z: crateHeight },
            mass: legacyLayout ? 20 : 5.5, fragile: false, color: '#F2C14F' });
        }
        config = { kind: 'stack-up', crateIds, center: copy(center),
          groundY: center.y, crateHeight, requiredLayers: layers, holdTicks: 300 };
        start = legacyLayout ? plus(center, 5, 1, 5) : plus(center, 0, .6, 4.5 * scale);
        markers = [marker('stack-zone', 'Build here', plus(center, 0, crateHeight / 2, 0), 2, 'destination')];
        break;
      }
      case 'summit-sprint': {
        if (!legacyLayout && this.summitTrail.length) {
          const checkpoints = this.summitCheckpoints(tier, rng.int(3));
          config = { kind: 'summit-sprint', checkpoints,
            minimumClimb: [4, 6, 8][tier]!, goldClimb: [6, 7.5, 9][tier]! };
          start = copy(checkpoints[0]!);
          markers = checkpoints.map((p, i) => marker('summit-' + i,
            i === 0 ? 'Start here' : i === checkpoints.length - 1 ? 'Summit' : 'Trail flag ' + (i + 1), p, 6,
            i === 0 ? 'start' : i === checkpoints.length - 1 ? 'destination' : 'checkpoint'));
          break;
        }
        const ledges = requireKind(this.props, 'mt-gigga', 'ledge')
          .map(p => ({
            position: (legacyLayout ? this.legacySummitLedgePositions[p.id] : undefined) ?? p.transform.position,
            height: p.size.y,
          }))
          .filter(p => p.position.y < poi.center.y - 3)
          .sort((a, b) => a.position.y - b.position.y);
        const steps = 2 + tier;
        const checkpoints: Point[] = [];
        for (let i = 0; i < steps; i++) {
          const index = Math.max(0, Math.min(ledges.length - 1,
            Math.floor((i + 1) * ledges.length / (steps + 1)) + rng.int(3) - 1));
          const p = ledges[index]!;
          checkpoints.push(plus(p.position, 0, p.height / 2 + 0.6, 0));
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
        const waterY = legacyDamWater ? this.reservoirLevel :
          damOutflowWaterY(this.damPlacement, jumpPoint.z + 6);
        const landing = legacyDamWater ? plus(jumpPoint, 0, waterY - jumpPoint.y, 6) :
          { ...jumpPoint, y: waterY, z: jumpPoint.z + 6 };
        config = { kind: 'splash-dive', jumpPoint, landing, waterY,
          minDrop: [3.5, 5.5, 7.5][tier]!, requiresFlop: true };
        start = copy(jumpPoint);
        markers = [marker('dam-board', 'Flop from here', jumpPoint, 3.5, 'start'),
          marker('dam-splash', 'Reservoir landing', landing, 3.6, 'destination')];
        break;
      }
      case 'beacon-bleat': {
        const tower = requireKind(this.props, 'old-lighthouse', 'lighthouse')[0]!;
        if (!legacyLayout) {
          const path = beaconAccess(tower, (x, z) => this.terrainY(x, z));
          const checkpoints = lighthouseFlagPositions(path, 2 + tier, rng.int(5) - 2)
            .map(point => plus(point, 0, .6, 0));
          config = { kind: 'summit-sprint', checkpoints, minimumClimb: 0, requiresBleat: true };
          start = sectionCenter(path[0]!);
          markers = checkpoints.map((point, i) => marker('beacon-' + i,
            i === checkpoints.length - 1 ? 'BLEAT HERE' : 'Stair flag ' + (i + 1),
            point, 3.0, 'checkpoint'));
          break;
        }
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
        const board = legacyLayout ? undefined : this.props.find(prop => prop.id === SPLASH_DIVE_BOARD_ID);
        const scale = this.islandSize / 600;
        const jumpPoint = board ? plus(board.transform.position,
          board.size.x / 2 - .9 * scale, board.size.y / 2 + .55 * scale, (rng.int(5) - 2) * .36 * scale)
          : plus(pier.transform.position, rng.int(5) - 2, pier.size.y / 2 + 0.7, pier.size.z / 2 - 5);
        const landing = plus(jumpPoint, board ? .9 * scale + 4 : 0,
          this.seaLevel - jumpPoint.y, board ? 0 : 7);
        config = { kind: 'splash-dive', jumpPoint, landing, waterY: this.seaLevel,
          minDrop: [2.5, 3.5, 4.5][tier]! };
        start = copy(jumpPoint);
        markers = [marker('high-board', board ? 'Leap seaward' : 'Jump from here', jumpPoint, 3.5, 'start'),
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
    if (legacyLayout && offer.gigId === 'demolition-contract') {
      info.instruction = 'Headbutt the marked temporary tower. Move mass, not just dust.';
    }
    if (legacyLayout && offer.gigId === 'stack-up') {
      info.instruction = 'Tongue/ram crates into a vertical tower. Hold steady for five seconds.';
    }
    if (legacyLayout && offer.gigId === 'mow-down') {
      info.instruction = 'Eat every glowing grass patch. Plan an efficient bite path.';
    }
    if (legacyLayout && offer.gigId === 'rooftop-express') {
      info.instruction = 'Tongue-carry the parcel across the roof markers. Never touch the street.';
      info.verbs = ['tongue', 'climb', 'flop'];
    }
    if (legacyLayout && offer.gigId === 'dam-bomb') {
      info.instruction = 'Flop off the dam high walk into the reservoir. Make a huge splash.';
    }
    if (legacyLayout && offer.gigId === 'beacon-bleat') {
      info.instruction = 'Climb the lighthouse rooftops, then BLEAT at the top.';
      info.verbs = ['climb', 'tongue', 'bleat'];
    }
    if (legacyLayout && offer.gigId === 'splash-dive') {
      info.instruction = 'Reach the high board, leap, and make a measured big splash.';
    }
    if (legacyLayout && offer.gigId === 'summit-sprint') {
      info.instruction = 'Climb through the ledge flags to Mt. Gigga’s summit.';
    }
    if (legacyLayout && offer.gigId === 'escort-the-gnome') {
      info.instruction = 'Nudge the gnome through the flags. Too hard and he cracks.';
    }
    return {
      offer: structuredClone(offer), info, start, config,
      spawns, markers, maxTicks, goldTicks: Math.round(maxTicks * 0.55),
      silverTicks: Math.round(maxTicks * 0.82),
    };
  }
}
