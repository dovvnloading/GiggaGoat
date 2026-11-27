import { capeSurface } from './lighthouse-access';
import { SeededRandom } from './random';
import { makeLocalStreets } from './roads';
import { riverAt, segmentProjection } from './terrain';
import type { IslandData, PoiId, PropDescriptor, Vec3 } from './types';

export type InsectSpecies = 'butterfly' | 'bee' | 'dragonfly';

export interface GardenPatch {
  position: Vec3;
  radius: number;
  phase: number;
}

export interface PollinatorFlight {
  district: PoiId;
  species: InsectSpecies;
  center: Vec3;
  radius: number;
  period: number;
  phase: number;
  size: number;
  color: number;
  bloom?: Vec3;
}

function intersectsVolume(
  center: Vec3, radius: number, bottom: number, top: number, props: readonly PropDescriptor[],
): boolean {
  return props.some(prop => {
    if (!prop.collidable && !['tree-oak', 'tree-pine', 'bush'].includes(prop.kind)) return false;
    const p = prop.transform.position, half = prop.size.y / 2;
    if (top <= p.y - half || bottom >= p.y + half) return false;
    const x = center.x - p.x, z = center.z - p.z;
    if (Math.abs(x) > radius + prop.size.x + prop.size.z ||
      Math.abs(z) > radius + prop.size.x + prop.size.z) return false;
    const c = Math.cos(prop.transform.rotationY), s = Math.sin(prop.transform.rotationY);
    // Test the entire flight envelope against a rotated footprint.
    return Math.hypot(Math.max(0, Math.abs(c * x - s * z) - prop.size.x / 2),
      Math.max(0, Math.abs(s * x + c * z) - prop.size.z / 2)) < radius;
  });
}

/** Seed small beds beside the starting street. They occupy unused soil and
 * keep the existing playable sidewalks, yards, spawns and approaches clear. */
export function planPocketGardens(
  island: IslandData, pavedAt: (x: number, z: number) => boolean = () => false,
): GardenPatch[] {
  const farm = island.pois.find(poi => poi.id === 'hoofington');
  if (!farm) return [];
  const scale = island.size / 600, radius = 1.36 * scale, safeRadius = radius + .30 * scale;
  const roads = [...island.roads, ...makeLocalStreets(island)].flatMap(road =>
    road.points.slice(1).map((to, i) => ({ from: road.points[i]!, to, width: road.width / 2 })));
  const nearby = island.props.filter(prop => Math.hypot(prop.transform.position.x - farm.center.x,
    prop.transform.position.z - farm.center.z) < 60 * scale);
  const protectedPoints = [...island.spawns, ...island.relics].map(point => point.position);
  const rng = new SeededRandom(String(island.seed) + ':pocket-gardens');
  const patches: GardenPatch[] = [];
  for (const [dx, dz] of [[-8.8, -2.8], [8.8, -9.5], [-8.8, 10.5], [8.8, 19]] as const) {
    for (const offset of [0, 1.8, -1.8, 3.6, -3.6, 5.4, -5.4]) {
      const x = farm.center.x + dx * scale, z = farm.center.z + (dz + offset) * scale;
      const ground = capeSurface(island, x, z), position = { x, y: ground, z };
      if (ground < island.seaLevel + .5 * scale ||
        protectedPoints.some(p => Math.hypot(x - p.x, z - p.z) < safeRadius + 2.5 * scale) ||
        patches.some(p => Math.hypot(x - p.position.x, z - p.position.z) < 6 * scale) ||
        roads.some(road => segmentProjection(position, road.from, road.to).distance < road.width + safeRadius) ||
        intersectsVolume(position, safeRadius, ground, ground + 1.65 * scale, nearby)) continue;
      const stream = riverAt(position, island.river);
      if (stream.distance < stream.width / 2 + safeRadius && ground < stream.level + .55 * scale) continue;
      if ((island.districtSets ?? []).some(set =>
        segmentProjection(position, set.approach.from, set.approach.to).distance < safeRadius + .85 * scale ||
        set.pieces.some(piece => Math.hypot(x - piece.bottom.x, z - piece.bottom.z) < piece.length * .72 + safeRadius))) continue;
      let clear = !pavedAt(x, z);
      for (let i = 0; i < 8 && clear; i++) {
        const px = x + Math.cos(i * Math.PI / 4) * safeRadius;
        const pz = z + Math.sin(i * Math.PI / 4) * safeRadius;
        clear = !pavedAt(px, pz) && Math.abs(capeSurface(island, px, pz) - ground) < .30 * scale;
      }
      if (!clear) continue;
      patches.push({ position, radius, phase: rng.range(0, Math.PI * 2) });
      break;
    }
  }
  return patches;
}

const wingColors = [0xf8b752, 0xf98767, 0xb5a5f4, 0xf8ebc2] as const;

/** Plan above the flowers and river plants that already exist on this seed.
 * Bounds include wings, wind loading and the full startle arc. */
export function planPollinators(
  island: IslandData, gardens: readonly GardenPatch[] = planPocketGardens(island),
): PollinatorFlight[] {
  const scale = island.size / 600;
  const flights: PollinatorFlight[] = [];
  const centerOf = (id: PoiId): Vec3 | undefined => island.pois.find(poi => poi.id === id)?.center;
  const rules = [
    { district: 'hoofington', limit: 5, water: 0 },
    { district: 'downtown-bleatsville', limit: 5, water: 0 },
    { district: 'whispering-pines', limit: 5, water: 2 },
    { district: 'baa-ardwalk', limit: 3, water: 0 },
    { district: 'old-lighthouse', limit: 2, water: 0 },
  ] as const;
  for (const { district, limit, water } of rules) {
    const center = centerOf(district);
    if (!center) continue;
    const rng = new SeededRandom(String(island.seed) + ':insect-habitats:' + district);
    const placed: PollinatorFlight[] = [];
    const place = (anchor: Vec3, species: InsectSpecies, bloom?: Vec3): boolean => {
      if (placed.some(f => Math.hypot(f.center.x - anchor.x, f.center.z - anchor.z) < 6.4 * scale)) return false;
      const radius = rng.range(species === 'dragonfly' ? 1.18 : .66,
        species === 'dragonfly' ? 1.66 : 1.10) * scale;
      const clearance = radius + .85 * scale;
      let ground = capeSurface(island, anchor.x, anchor.z);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        ground = Math.max(ground, capeSurface(island, anchor.x + Math.cos(angle) * clearance,
          anchor.z + Math.sin(angle) * clearance));
      }
      const y = Math.max(anchor.y, ground + .53 * scale);
      if (y < island.seaLevel + .45 * scale || y - anchor.y > .75 * scale) return false;
      const point = { x: anchor.x, y, z: anchor.z };
      if (intersectsVolume(point, clearance, y - .24 * scale, y + 1.04 * scale, island.props)) return false;
      placed.push({ district, species, center: point, radius, bloom,
        period: rng.range(species === 'bee' ? 3.6 : 4.6, species === 'bee' ? 5.4 : 7.8),
        phase: rng.range(0, Math.PI * 2),
        size: rng.range(species === 'bee' ? .18 : .25, species === 'bee' ? .22 : .32) * scale,
        color: rng.pick(wingColors) });
      return true;
    };
    if (district === 'hoofington') {
      for (const [index, garden] of gardens.entries()) {
        const bloom = { ...garden.position, y: garden.position.y + .46 * scale };
        place({ ...bloom, y: bloom.y + .67 * scale }, index % 2 ? 'bee' : 'butterfly', bloom);
      }
    }
    const reference = district === 'hoofington' ? island.spawns[0]?.position ?? center
      : district === 'downtown-bleatsville' ? { ...center, z: center.z - 30 * scale } : center;
    const distance = (prop: PropDescriptor) => Math.hypot(
      prop.transform.position.x - reference.x, prop.transform.position.z - reference.z);
    const anchors = island.props.filter(prop => prop.poiId === district && prop.body.type === 'static')
      .sort((a, b) => distance(a) - distance(b));
    if (water) {
      for (const anchor of anchors) {
        if (placed.length >= water) break;
        if (anchor.kind !== 'lily-pads') continue;
        const p = anchor.transform.position;
        place({ ...p, y: p.y + .68 * scale }, 'dragonfly');
      }
    }
    for (const plant of anchors) {
      if (placed.length >= limit) break;
      if (plant.kind !== 'flower' && plant.kind !== 'planter') continue;
      const p = plant.transform.position;
      const bloom = { x: p.x, y: p.y + plant.size.y / 2, z: p.z };
      place({ ...bloom, y: bloom.y + .47 * scale }, placed.length % 2 ? 'bee' : 'butterfly', bloom);
    }
    flights.push(...placed);
  }
  return flights;
}
