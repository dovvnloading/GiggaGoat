import { RAPIER, V, type Quat, type Vec3 } from '../physics';
import type { ColliderBuild, IslandData, PropDescriptor } from '../world';
import {
  HOOFINGTON_FIELD_ENTRANCES, HOOFINGTON_HAUL_BALE_PREFIX, HOOFINGTON_HAUL_LANE,
  HOOFINGTON_YARD_ENTRANCES,
} from '../world/hoofington-entrances';

export function isLegacyStockBale(prop: PropDescriptor): boolean {
  return prop.poiId === 'hoofington' && prop.kind === 'hay-bale' &&
    !prop.id.startsWith(HOOFINGTON_HAUL_BALE_PREFIX);
}

/** Find a nearby dry seat for an intersecting stock cylinder. Keep the
 * authored start coordinates for authenticating historical gig saves. */
export function findStockBaleSeat(island: IslandData, colliders: ColliderBuild,
  prop: PropDescriptor, origin: Vec3, rotation: Quat): Vec3 | undefined {
  const scale = island.size / 600;
  const radius = Math.max(prop.size.x, prop.size.z) / 2, halfHeight = prop.size.y / 2;
  const nearby = [...colliders.props].flatMap(([id, collider]) => {
    if (id === prop.id || !collider.isEnabled()) return [];
    const p = collider.translation();
    return Math.hypot(p.x - origin.x, p.z - origin.z) < 24 * scale ? [collider] : [];
  });
  const originalShape = new RAPIER.Cylinder(halfHeight, radius);
  const clear = (seat: Vec3, shape: RAPIER.Shape): boolean =>
    !nearby.some(collider => collider.intersectsShape(shape, seat, rotation));
  const soilContact = (seat: Vec3) => colliders.terrain.contactShape(originalShape, seat, rotation, 0);
  const seatOnSoil = (origin: Vec3): Vec3 | undefined => {
    let seat = origin;
    // A sloped tile can pass through the downhill cylinder even when its
    // center samples the ground. Resolve against the actual terrain shape.
    for (let attempt = 0; attempt < 4; attempt++) {
      const contact = soilContact(seat);
      if (!contact || contact.distance >= 0) return seat;
      seat = V(seat.x, seat.y + .02 * scale -
        contact.distance / Math.max(.30, contact.normal1.y), seat.z);
      if (seat.y - origin.y > .8 * scale) return undefined;
    }
    return undefined;
  };
  const planted = soilContact(origin);
  if (!planted || planted.distance >= -.005 * scale) {
    if (clear(origin, originalShape)) return undefined;
  } else {
    const seat = seatOnSoil(origin);
    if (seat && clear(seat, originalShape)) return seat;
  }

  const center = island.pois.find(poi => poi.id === 'hoofington')!.center;
  const routes = [...HOOFINGTON_FIELD_ENTRANCES, ...HOOFINGTON_YARD_ENTRANCES, HOOFINGTON_HAUL_LANE];
  const clearance = radius + .22 * scale;
  const shape = new RAPIER.Cylinder(halfHeight, clearance);
  const ground = (x: number, z: number): number => {
    const top = origin.y + 8 * scale;
    const hit = colliders.terrain.castRay(new RAPIER.Ray(V(x, top, z), V(0, -1, 0)), 16 * scale, false);
    return hit >= 0 ? top - hit : -Infinity;
  };
  for (let ring = 1; ring <= 16; ring++) {
    const distance = ring * .5 * scale;
    for (let direction = 0; direction < 16; direction++) {
      const bearing = direction * Math.PI / 8;
      const x = origin.x + Math.cos(bearing) * distance;
      const z = origin.z + Math.sin(bearing) * distance;
      if (routes.some(route => Math.abs(x - center.x - route.x * scale) < route.length / 2 * scale + clearance &&
          Math.abs(z - center.z - route.z * scale) < route.width / 2 * scale + clearance)) continue;
      const y = ground(x, z);
      if (y < island.seaLevel + .5 * scale || Math.abs(y + halfHeight - origin.y) > 1.65 * scale) continue;
      const r = radius * .72;
      const bed = [y, ground(x - r, z), ground(x + r, z), ground(x, z - r), ground(x, z + r)];
      if (Math.max(...bed) - Math.min(...bed) > .53 * scale) continue;
      const seat = seatOnSoil(V(x, y + halfHeight + .02 * scale, z));
      if (seat && clear(seat, shape)) return seat;
    }
  }
  return undefined;
}
