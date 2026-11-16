import type { IslandData, PoiDescriptor, PropDescriptor, PoiId } from '../world';
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
    instruction: 'Lick the marked bales into the barn. Chain-tow two for a combo.',
    verbs: ['tongue'], baseCoins: 64,
    cosmetic: { id: 'hay-hat', name: 'Haywire Hat', slot: 'hat', color: '#F2C14F' },
  },
  'rooftop-express': {
    id: 'rooftop-express', title: 'ROOFTOP EXPRESS', poiId: 'downtown-bleatsville',
    pitch: 'Next-day delivery. Rooftop-only. The recipient is a pigeon.',
    instruction: 'Tongue-carry the parcel across the roof markers. Never touch the street.',
    verbs: ['tongue', 'climb', 'flop'], baseCoins: 78,
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
    instruction: 'Eat every glowing grass patch. Plan an efficient bite path.',
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
/** Data is captured at construction so another team can mutate world visuals without changing a run. */
export class GigCatalog {
  readonly seed: number;
  private readonly pois: Map<PoiId, PoiDescriptor>;
  private readonly props: PropDescriptor[];
  private readonly seaLevel: number;
  private readonly reservoirLevel: number;
  constructor(island: Pick<IslandData, 'seed' | 'pois' | 'props' | 'seaLevel' | 'reservoir'>, seed: number | string = 1) {
    this.seed = hash(String(island.seed) + ':' + String(seed));
    this.seaLevel = island.seaLevel;
    this.reservoirLevel = island.reservoir.level;
    this.pois = new Map(island.pois.map(p => [p.id, {
      ...p, center: copy(p.center),
    }]));
    this.props = island.props.map(p => ({
      ...p, size: copy(p.size), transform: {
        position: copy(p.transform.position), rotationY: p.transform.rotationY,
      }, body: { ...p.body },
    }));
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
        const bales = rng.shuffle(requireKind(this.props, 'hoofington', 'hay-bale')
          .filter(p => p.body.type === 'dynamic')).slice(0, [3, 4, 5][tier]!);
        const target = plus(barn.transform.position, 0, -barn.size.y / 2 + 1, 0);
        config = { kind: 'hay-haul', barn: target, radius: 6.5,
          bales: bales.map(b => ({ id: b.id, start: copy(b.transform.position) })),
          required: bales.length };
        start = copy(bales[0]!.transform.position);
        markers = [marker('barn', 'Barn drop', target, 6.5, 'destination'),
          ...bales.map((b, i) => marker(b.id, 'Bale ' + (i + 1), b.transform.position, 1.3, 'start'))];
        break;
      }
      case 'rooftop-express': {
        const roofs = this.props.filter(p => p.poiId === 'downtown-bleatsville' &&
          (p.kind === 'shop' || p.kind === 'house'));
        const row = rng.int(3);
        const rowZ = poi.center.z + (row - 1) * 19;
        const rowRoofs = roofs.filter(p => Math.abs(p.transform.position.z - rowZ) < 3)
          .sort((a, b) => a.transform.position.x - b.transform.position.x);
        if (rowRoofs.length < 4) throw new Error('Downtown requires four roof buildings per street');
        const count = tier === 0 ? 3 : 4;
        const selected = rowRoofs.slice(tier === 0 ? rng.int(2) : 0,
          tier === 0 ? undefined : 4).slice(0, count);
        const checkpoints = selected.map(p => plus(p.transform.position, 0, p.size.y / 2 + 0.65, 0));
        const parcelId = 'gig-parcel-' + s;
        start = plus(checkpoints[0]!, 1.2, 0, 0);
        spawns = [{ id: parcelId, role: 'parcel', position: copy(checkpoints[0]!),
          size: { x: 0.8, y: 0.7, z: 0.8 }, mass: 2.5, fragile: true, color: '#FFD833' }];
        config = { kind: 'rooftop-express', parcelId, checkpoints, streetY: poi.center.y };
        markers = checkpoints.map((p, i) => marker('roof-' + i, 'Roof ' + (i + 1), p, 3.8, 'checkpoint'));
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
        const center = plus(poi.center, 13 + rng.int(3), 0.2, 8 + rng.int(3));
        const patches: Point[] = [];
        for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) {
          patches.push(plus(center, (x - (cols - 1) / 2) * 2.1, 0, (z - (rows - 1) / 2) * 2.1));
        }
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
          -sign.size.y / 2 + 0.8, 1 + rng.int(3));
        for (let i = 0; i < 4 + tier; i++) {
          route.push(plus(initial, i * 5.5, 0, Math.sin(i * 1.3) * 3 + i * 2));
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
        const checkpoints = tier === 0 ?
          [roof(platform), roof(tower)] : [roof(platform), roof(house), roof(tower)];
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
    return {
      offer: structuredClone(offer), info: this.info(offer.gigId), start, config,
      spawns, markers, maxTicks, goldTicks: Math.round(maxTicks * 0.55),
      silverTicks: Math.round(maxTicks * 0.82),
    };
  }
}
