import { roadRibbonData } from './road-ribbons';
import { roadsideGravelAt, roadsideStops } from './roadside-stops';
import { gridSample, riverAt, segmentProjection } from './terrain';
import type { IslandData, PropDescriptor, PropKind, Vec2 } from './types';
import { buildingFootprints, foliageHitsBuilding } from './footprints';

const SCATTER_KINDS = new Set<PropKind>(['tree-pine', 'tree-oak', 'bush', 'flower', 'grass-tuft']);

interface PavementTriangle {
  a: Vec2;
  b: Vec2;
  c: Vec2;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function side(a: Vec2, b: Vec2, p: Vec2): number {
  return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
}

/** Use the actual support ribbon so width transitions and mitred corners stay clear. */
export function pavedRoadOverlap(island: IslandData): (p: Vec2, radius: number) => boolean {
  const { positions, supportIndices } = roadRibbonData(island, 'road');
  const vertex = (i: number): Vec2 => ({ x: positions[i * 3]!, z: positions[i * 3 + 2]! });
  const triangles: PavementTriangle[] = [];
  for (let i = 0; i < supportIndices.length; i += 3) {
    const a = vertex(supportIndices[i]!), b = vertex(supportIndices[i + 1]!), c = vertex(supportIndices[i + 2]!);
    triangles.push({ a, b, c,
      minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x),
      minZ: Math.min(a.z, b.z, c.z), maxZ: Math.max(a.z, b.z, c.z) });
  }
  return (p, radius) => triangles.some(({ a, b, c, minX, maxX, minZ, maxZ }) => {
    if (p.x + radius < minX || p.x - radius > maxX ||
      p.z + radius < minZ || p.z - radius > maxZ) return false;
    const ab = side(a, b, p), bc = side(b, c, p), ca = side(c, a, p);
    if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) return true;
    return segmentProjection(p, a, b).distance < radius ||
      segmentProjection(p, b, c).distance < radius || segmentProjection(p, c, a).distance < radius;
  });
}

function cylinderRadius(prop: PropDescriptor): number {
  // Match the actual trunk and lamp colliders, while leaving clear canopies in place.
  if (prop.kind === 'tree-pine' || prop.kind === 'tree-oak') return Math.min(1.8, prop.size.x * .4) / 2;
  if (prop.kind === 'lamp') return Math.min(.76, prop.size.x) / 2;
  return Math.max(prop.size.x, prop.size.z) / 2;
}

function propClearance(prop: PropDescriptor, p: Vec2): number {
  const { position, rotationY } = prop.transform;
  const dx = p.x - position.x, dz = p.z - position.z;
  if (prop.shape === 'cylinder') return Math.hypot(dx, dz) - cylinderRadius(prop);
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - prop.size.x / 2),
    Math.max(0, Math.abs(dx * s + dz * c) - prop.size.z / 2));
}

/** Move only accidental generic scatter, after the authored stop layouts are settled. */
export function clearPavedRoadScenery(island: IslandData): void {
  const scale = island.size / 600;
  // Shoulder dressing and district layouts can meet on the same sidewalk.
  // Prefer the district lantern at that elevation and preserve all other prop IDs.
  const districtLamps = island.props.filter(p => p.kind === 'lamp' && p.poiId);
  island.props = island.props.filter(p => {
    if (p.kind !== 'lamp' || p.poiId) return true;
    const position = p.transform.position, foot = position.y - p.size.y / 2;
    return !districtLamps.some(lamp => {
      const q = lamp.transform.position;
      return Math.abs(foot - (q.y - lamp.size.y / 2)) < scale &&
        Math.hypot(position.x - q.x, position.z - q.z) < 2.5 * scale;
    });
  });
  const overlapsRoad = pavedRoadOverlap(island);
  const stops = roadsideStops(island);
  const solid = island.props.filter(prop => prop.collidable);
  const buildings = buildingFootprints(island.props);
  const scatter = solid.filter(prop => (prop.id.startsWith('detail-island-') || prop.id.startsWith('detail-the-dam-')) &&
    prop.body.type === 'static' && prop.shape === 'cylinder' && SCATTER_KINDS.has(prop.kind));
  for (const prop of scatter) {
    const { position } = prop.transform;
    const radius = cylinderRadius(prop);
    if (!overlapsRoad(position, radius)) continue;
    const shoulder = closestShoulder(island, position, (point, ground) => {
      const fromCenter = Math.hypot(point.x, point.z);
      if (ground < 3.4 * scale || ground > 35 * scale ||
        fromCenter < 103 * scale || fromCenter > 273 * scale) return false;
      const water = riverAt(point, island.river);
      if (water.distance < water.width / 2 + 4 * scale ||
        overlapsRoad(point, radius + .3 * scale)) return false;
      const damVerge=prop.id.startsWith('detail-the-dam-');
      if(damVerge && point.z>island.reservoir.center.z-46*scale)return false;
      if (island.pois.some(poi => (!damVerge || poi.id!=='the-dam') &&
        Math.hypot(point.x - poi.center.x, point.z - poi.center.z) < poi.radius * 1.25) ||
        roadsideGravelAt(stops, point.x, point.z)) return false;
      if (['tree-oak', 'tree-pine', 'bush'].includes(prop.kind) && foliageHitsBuilding({
        x: point.x, z: point.z, sx: prop.size.x, sz: prop.size.z, yaw: prop.transform.rotationY,
      }, buildings, .15 * scale)) return false;
      return solid.every(other => other === prop || propClearance(other, point) > radius + .12 * scale);
    });
    if (shoulder) Object.assign(position, shoulder, { y: shoulder.y + prop.size.y / 2 });
  }
}

function closestShoulder(island: IslandData, origin: Vec2,
  clear: (point: Vec2, ground: number) => boolean): (Vec2 & { y: number }) | undefined {
  for (let ring = 1; ring <= 48; ring++) {
    const distance = ring * island.size / 1200;
    for (let direction = 0; direction < 24; direction++) {
      const angle = direction * Math.PI / 12;
      const point = { x: origin.x + Math.cos(angle) * distance, z: origin.z + Math.sin(angle) * distance };
      const y = gridSample(island, point.x, point.z);
      if (clear(point, y)) return { ...point, y };
    }
  }
}
