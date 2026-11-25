import { SeededRandom } from './random';
import { createAmbientNavigation, nearestAmbientNode, type AmbientNavigation } from './ambient-navigation';
import type { IslandData, Vec2, Vec3 } from './types';

export type AmbientResidentModel = 'male-a' | 'male-b' | 'female-a' | 'female-b' | 'worker';
export type AmbientResidentRole = 'vendor' | 'shopper' | 'cafe-guest' | 'delivery' | 'walker';
export type AmbientActivity = 'walk' | 'idle' | 'work' | 'shop' | 'shelter' | 'sit' | 'look' | 'wave' | 'startle' | 'flee';
export type AmbientStationKind = 'market' | 'cafe' | 'fountain' | 'delivery' | 'shop' | 'shelter';
export interface AmbientStation {
  readonly id: string;
  readonly kind: AmbientStationKind;
  readonly node: number;
  readonly yaw: number;
}
export interface AmbientResidentDefinition {
  readonly id: string;
  readonly role: AmbientResidentRole;
  readonly model: AmbientResidentModel;
  readonly height: number;
  readonly radius: number;
  readonly speed: number;
  readonly phase: number;
  readonly initialNode: number;
  readonly home: number;
  readonly itinerary: readonly number[];
  readonly dwell: number;
}
export interface AmbientResidentState {
  id: string;
  role: AmbientResidentRole;
  model: AmbientResidentModel;
  /** Feet, not the mesh centre. Stable objects are shared with the visual adapter. */
  position: Vec3;
  yaw: number;
  speed: number;
  distanceTravelled: number;
  activity: AmbientActivity;
  phase: number;
  reactionUntil: number;
  height: number;
  radius: number;
}
export interface AmbientLifePlan {
  readonly navigation: AmbientNavigation;
  readonly stations: readonly AmbientStation[];
  readonly residents: readonly AmbientResidentDefinition[];
  readonly seed: string;
}

const CAST: readonly { role: AmbientResidentRole; model: AmbientResidentModel }[] = [
  { role: 'vendor', model: 'female-a' }, { role: 'vendor', model: 'male-b' },
  { role: 'delivery', model: 'worker' }, { role: 'delivery', model: 'worker' },
  { role: 'shopper', model: 'female-b' }, { role: 'shopper', model: 'male-a' },
  { role: 'cafe-guest', model: 'male-b' }, { role: 'cafe-guest', model: 'female-a' },
  { role: 'walker', model: 'female-b' }, { role: 'walker', model: 'male-a' },
  { role: 'shopper', model: 'male-b' }, { role: 'walker', model: 'female-a' },
  { role: 'cafe-guest', model: 'female-b' }, { role: 'shopper', model: 'male-a' },
  { role: 'walker', model: 'male-b' }, { role: 'walker', model: 'female-b' },
];
const ROLE_STATIONS: Record<AmbientResidentRole, readonly AmbientStationKind[]> = {
  vendor: ['market', 'delivery', 'shelter'],
  delivery: ['delivery', 'market', 'shop'],
  shopper: ['market', 'shop', 'fountain', 'cafe'],
  'cafe-guest': ['cafe', 'fountain', 'market'],
  walker: ['fountain', 'shop', 'market', 'cafe'],
};

/** The pilot reuses the street, fountain and market's authored composition. No
 * terrain, prop, collider, spawn or island PRNG is mutated to make a route fit. */
export function createAmbientLifePlan(island: IslandData, excludedPositions: readonly Vec2[] = []): AmbientLifePlan {
  const navigation = createAmbientNavigation(island, excludedPositions), { scale } = navigation;
  const center = island.pois.find(p => p.id === 'downtown-bleatsville')!.center;
  const rng = new SeededRandom(String(island.seed) + ':living-downtown:v1');
  const stations: AmbientStation[] = [];
  function station(id: string, kind: AmbientStationKind, x: number, z: number, yaw: number, reach = 2.1): void {
    const node = nearestAmbientNode(navigation, { x: center.x + x * scale, z: center.z + z * scale }, reach * scale);
    if (node === undefined || stations.some(s => s.node === node)) return;
    if (kind === 'shelter' && Math.abs(navigation.nodes[node]!.position.x - center.x) < 11.8 * scale) return;
    stations.push({ id, kind, node, yaw });
  }
  station('produce-vendor', 'market', 25.9, 49.1, -Math.PI / 2);
  station('produce-customer', 'market', 19.4, 54.7, Math.PI / 2);
  station('flower-vendor', 'market', 31.1, 60.9, 0);
  station('flower-customer', 'market', 27.9, 60.6, 0);
  station('market-arrival', 'market', 13.5, 55.1, Math.PI / 2);
  station('cafe-terrace', 'cafe', 18.4, 53.6, -Math.PI / 2, 1.5);
  station('cafe-shopfront', 'cafe', -10.3, -39.7, -Math.PI / 2, 1.5);
  station('fountain-north', 'fountain', -19, -58.5, 0);
  station('fountain-east', 'fountain', -12.9, -53.6, -Math.PI / 2);
  station('fountain-south', 'fountain', -21.2, -45.9, Math.PI);
  station('market-service', 'delivery', 27.5, 55, Math.PI);
  station('north-delivery', 'delivery', -11.8, -44.5, -Math.PI / 2);
  for (const side of [-1, 1]) for (const [index, z] of [-38, -19, 0, 19, 38].entries()) {
    station(`shop-${side}-${index}`, 'shop', side * 10, z - 3, side * Math.PI / 2);
    for (const offset of [-2.7, 0, 2.7]) {
      station(`shelter-${side}-${index}-${offset}`, 'shelter', side * 13, z + offset,
        -side * Math.PI / 2, 1.4);
    }
  }
  const homes = stations.map((station, i) => ({ station, i })).filter(s => s.station.kind === 'shelter');
  const residents: AmbientResidentDefinition[] = [];
  const occupied: Vec3[] = [];
  const reservedHomes = new Set<number>();
  for (const [index, cast] of CAST.entries()) {
    if (reservedHomes.size >= homes.length) break;
    const preferred = stations.map((station, i) => ({ station, i })).filter(s =>
      ROLE_STATIONS[cast.role].includes(s.station.kind) && s.station.kind !== 'shelter' &&
      homes.some(h => !reservedHomes.has(h.i) && navigation.nodes[h.station.node]!.component === navigation.nodes[s.station.node]!.component));
    if (preferred.length < 2) continue;
    const rotation = rng.int(0, preferred.length);
    const ordered = [...preferred.slice(rotation), ...preferred.slice(0, rotation)].map(s => s.i);
    const firstStation = stations[ordered[index % ordered.length]!]!;
    const component = navigation.nodes[firstStation.node]!.component;
    const itinerary = ordered.filter(i => navigation.nodes[stations[i]!.node]!.component === component);
    if (itinerary.length < 2) continue;
    const first = navigation.nodes[firstStation.node]!.position;
    // Initial distribution is authored around places of activity, with real spacing.
    const candidates = navigation.nodes.filter(node => node.component === component && occupied.every(p =>
      Math.hypot(p.x - node.position.x, p.z - node.position.z) >= 2.4 * scale));
    candidates.sort((a, b) => Math.hypot(a.position.x - first.x, a.position.z - first.z) -
      Math.hypot(b.position.x - first.x, b.position.z - first.z));
    const initial = candidates[0]; if (!initial) continue;
    // Rain sends each resident to the nearest available canopy, avoiding a
    // contrived whole-town migration across the same crossing at once.
    const home = homes.filter(h => !reservedHomes.has(h.i) && navigation.nodes[h.station.node]!.component === component).sort((a, b) => {
      const at = navigation.nodes[a.station.node]!.position, bt = navigation.nodes[b.station.node]!.position;
      return Math.hypot(at.x - initial.position.x, at.z - initial.position.z) -
        Math.hypot(bt.x - initial.position.x, bt.z - initial.position.z);
    })[0];
    if (!home) continue;
    reservedHomes.add(home.i);
    occupied.push(initial.position);
    residents.push({ id: 'downtown-resident-' + String(index + 1).padStart(2, '0'), ...cast,
      height: rng.range(1.70, 1.88) * scale, radius: .35 * scale,
      speed: rng.range(.87, 1.16) * scale, phase: rng.next(), initialNode: initial.id,
      home: home.i, itinerary, dwell: cast.role === 'vendor' ? rng.range(13, 21) : rng.range(4, 11) });
  }
  return { navigation, stations, residents, seed: String(island.seed) + ':living-downtown:v1' };
}
