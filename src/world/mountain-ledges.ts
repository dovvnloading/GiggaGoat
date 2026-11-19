import { Box3, Triangle, Vector3 } from 'three';
import { roadRibbonData } from './road-ribbons';
import { gridSample } from './terrain';
import type { IslandData, PropDescriptor, Vec3 } from './types';

interface TrailFace {
  triangle: Triangle;
  bounds: Box3;
}

interface LedgeSite {
  position: Vec3;
  yaw: number;
  score: number;
}

const TIERS = [[27, 35], [46, 55], [64, 74], [82, 92]] as const;
const LEDGE_MARGIN = .55;
const SEARCH_ARC = 42;
const MOUNTAIN_DRESSING = 'detail-mt-gigga-';

function trailFaces(island: IslandData): TrailFace[] {
  const { positions, indices } = roadRibbonData(island, 'trail');
  const vertex = (index: number) => new Vector3(
    positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!,
  );
  const faces: TrailFace[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
    // The first two vertices per ribbon section are the top. This includes
    // the bridge surfaces, which have a separate physics deck.
    if (a % 6 > 1 || b % 6 > 1 || c % 6 > 1) continue;
    const triangle = new Triangle(vertex(a), vertex(b), vertex(c));
    faces.push({ triangle, bounds: new Box3().setFromPoints([triangle.a, triangle.b, triangle.c]) });
  }
  return faces;
}

function crossesTrail(faces: readonly TrailFace[], position: Vec3, yaw: number, size: Vec3, margin: number): boolean {
  const halfX = size.x / 2 + margin;
  const halfZ = size.z / 2 + margin;
  const bottom = -size.y / 2 - 1.45;
  const top = size.y / 2 - .055;
  const footprint = Math.hypot(halfX, halfZ);
  const box = new Box3(new Vector3(-halfX, bottom, -halfZ), new Vector3(halfX, top, halfZ));
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const local = new Triangle();
  const transform = (world: Vector3, result: Vector3) => {
    const dx = world.x - position.x, dz = world.z - position.z;
    result.set(dx * cos - dz * sin, world.y - position.y, dx * sin + dz * cos);
  };
  return faces.some(({ triangle, bounds }) => {
    if (position.x + footprint < bounds.min.x || position.x - footprint > bounds.max.x ||
      position.z + footprint < bounds.min.z || position.z - footprint > bounds.max.z ||
      position.y + top < bounds.min.y || position.y + bottom > bounds.max.y) return false;
    transform(triangle.a, local.a);
    transform(triangle.b, local.b);
    transform(triangle.c, local.c);
    return box.intersectsTriangle(local);
  });
}

function footprint(prop: PropDescriptor): Vec3 {
  if (prop.kind !== 'tree-pine' && prop.kind !== 'tree-oak') return prop.size;
  const trunk = Math.min(1.8, prop.size.x * .4);
  return { x: trunk, y: prop.size.y, z: trunk };
}

function overlapsProp(other: PropDescriptor, position: Vec3, yaw: number, size: Vec3, gap: number): boolean {
  const at = other.transform.position, bounds = footprint(other);
  const dx = at.x - position.x, dz = at.z - position.z;
  if (Math.abs(at.y - position.y) >= (bounds.y + size.y) / 2 ||
    Math.hypot(dx, dz) >= (Math.hypot(bounds.x, bounds.z) + Math.hypot(size.x, size.z)) / 2 + gap) return false;
  const otherYaw = other.transform.rotationY;
  const projected = (angle: number, orientation: number, extents: Vec3) =>
    (Math.abs(Math.cos(angle - orientation)) * extents.x + Math.abs(Math.sin(angle - orientation)) * extents.z) / 2;
  return [yaw, yaw + Math.PI / 2, otherYaw, otherYaw + Math.PI / 2].every(angle =>
    Math.abs(dx * Math.cos(angle) - dz * Math.sin(angle)) <
      projected(angle, yaw, size) + projected(angle, otherYaw, bounds) + gap);
}

function seatingPenalty(island: IslandData, position: Vec3, yaw: number, size: Vec3, scale: number): number {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const base = position.y - size.y / 2;
  let supports = 0;
  let lowest = base;
  for (const u of [-.4, 0, .4]) {
    for (const v of [-.4, 0, .4]) {
      const x = position.x + u * size.x * cos + v * size.z * sin;
      const z = position.z - u * size.x * sin + v * size.z * cos;
      const height = gridSample(island, x, z);
      lowest = Math.min(lowest, height);
      if (height >= base - .85 * scale && height <= base + size.y - .15 * scale) supports++;
    }
  }
  // A lookout can overhang a cliff as long as part of its footprint has a firm seat.
  return supports < 3 ? Infinity : Math.max(0, 5 - supports) * .4 * scale +
    Math.max(0, base - lowest - 3.6 * scale);
}

function nearbySites(island: IslandData, summit: Vec3, ledge: PropDescriptor): LedgeSite[] {
  const scale = island.size / 600;
  const { position, rotationY } = ledge.transform;
  const radius = Math.hypot(position.x - summit.x, position.z - summit.z);
  const bearing = Math.atan2(position.z - summit.z, position.x - summit.x);
  const grade = gridSample(island, position.x, position.z);
  const lift = Math.max(0, Math.min(.25 * scale, position.y - grade - ledge.size.y / 2));
  const [inner, outer] = TIERS.find(([, edge], index) => radius <= (edge + (index === 3 ? 0 : 4)) * scale)
    ?? TIERS[3];
  const sites: LedgeSite[] = [];
  for (let arc = -SEARCH_ARC; arc <= SEARCH_ARC; arc += .5) {
    const turn = arc * scale / radius;
    const angle = bearing + turn;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (let band = inner; band <= outer; band += .5) {
      const tier = Math.max(inner + .001, Math.min(outer - .001, band)) * scale;
      const x = summit.x + tier * cos, z = summit.z + tier * sin;
      const y = gridSample(island, x, z) + ledge.size.y / 2 + lift;
      if (Math.abs(y - position.y) > 4.5 * scale) continue;
      const candidate = { x, y, z }, yaw = rotationY + turn;
      const penalty = seatingPenalty(island, candidate, yaw, ledge.size, scale);
      if (Number.isFinite(penalty)) {
        sites.push({ position: candidate, yaw, score: Math.hypot(x - position.x, z - position.z) + penalty });
      }
    }
  }
  return sites.sort((a, b) => a.score - b.score);
}

/** Fit the existing lookout shelves beside the trail and keep their authored IDs. */
export function clearMountainLedges(island: IslandData): Record<string, Vec3> {
  const originalPositions: Record<string, Vec3> = {};
  const summit = island.pois.find(poi => poi.id === 'mt-gigga')!.center;
  const faces = trailFaces(island);
  const scale = island.size / 600;
  const solids = island.props.filter(prop => prop.collidable &&
    Math.hypot(prop.transform.position.x - summit.x, prop.transform.position.z - summit.z) < 115 * scale + 20);
  const blocked = solids.filter(ledge => ledge.poiId === 'mt-gigga' && ledge.kind === 'ledge' &&
    crossesTrail(faces, ledge.transform.position, ledge.transform.rotationY, ledge.size, LEDGE_MARGIN));
  const planted = solids.filter(prop => prop.id.startsWith(MOUNTAIN_DRESSING + 'tree-pine-') ||
    prop.id.startsWith(MOUNTAIN_DRESSING + 'bush-'));
  const fitsOtherProps = (ledge: PropDescriptor, site: LedgeSite) => planted.every(({ transform: { position } }) =>
    Math.hypot(site.position.x - position.x, site.position.z - position.z) >= 5 * scale) &&
    solids.every(other => other === ledge || !overlapsProp(other, site.position, site.yaw, ledge.size, .20));
  const range = (SEARCH_ARC + 14) * scale;
  const plans = blocked.map(ledge => {
    const { x, z } = ledge.transform.position;
    const nearby = faces.filter(({ bounds }) => bounds.min.x <= x + range && bounds.max.x >= x - range &&
      bounds.min.z <= z + range && bounds.max.z >= z - range);
    return {
      ledge,
      sites: nearbySites(island, summit, ledge).filter(site =>
        !crossesTrail(nearby, site.position, site.yaw, ledge.size, LEDGE_MARGIN) && fitsOtherProps(ledge, site)),
    };
  }).sort((a, b) => a.sites.length - b.sites.length);
  for (const { ledge, sites } of plans) {
    const site = sites.find(candidate => fitsOtherProps(ledge, candidate));
    if (!site) continue;
    originalPositions[ledge.id] = { ...ledge.transform.position };
    ledge.transform.position = site.position;
    ledge.transform.rotationY = site.yaw;
  }
  return originalPositions;
}
