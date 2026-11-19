import type { IslandData, RoadPoint } from './types';
import { gridCoordinate, gridIndex, gridSample, segmentProjection } from './terrain';
import { lerp, smoothstep } from './random';
import { getDamPlacement, type DamPlacement } from './the-dam';
import { DAM_MOUNTAIN_TRAIL, damMountainTrailDirt, fitDamMountainTrail } from './roads';

/** Metres in the Dam model's +Z (downstream) coordinates, at island size 600. */
export interface DamChannelSection {
  x: number;
  z: number;
  halfWidth: number;
  level: number;
}

/**
 * The masonry's four outlet lips sit between local X -12 and +28. The
 * first two sections make one shared plunge pool, not four dry waterfalls.
 * The water then narrows and comes straight toward bookmark 14's camera.
 */
export const DAM_CHANNEL: readonly DamChannelSection[] = [
  { x: 5, z: 5, halfWidth: 21, level: 6.2 },
  { x: 5, z: 17, halfWidth: 26, level: 6.0 },
  { x: 4, z: 29, halfWidth: 24, level: 5.7 },
  { x: 0, z: 42, halfWidth: 17, level: 5.2 },
  { x: -5, z: 57, halfWidth: 12.5, level: 4.6 },
  { x: -10, z: 75, halfWidth: 10.5, level: 4.0 },
  { x: -12, z: 94, halfWidth: 9.5, level: 3.5 },
  { x: -16, z: 110, halfWidth: 9, level: 3.2 },
];

export const DAM_WATER_SURFACE_LIFT = .20;
export const DAM_UPSTREAM_RIVER_END = 5;
export const DAM_FOREST_RIVER_START = 11;
export const DAM_POOL_EXIT = { left: 21, right: 48, near: 21, far: 27 } as const;

/** The surface drawn by the plunge pool and downstream channel. */
export function damOutflowWaterY({ position, scale }: DamPlacement, z: number): number {
  return position.y + (damChannelAt((z - position.z) / scale).level + DAM_WATER_SURFACE_LIFT) * scale;
}

export function getDamOutflow(island: IslandData) {
  const placement = getDamPlacement(island);
  const { position, scale } = placement;
  const first = DAM_CHANNEL[0]!;
  const last = DAM_CHANNEL[DAM_CHANNEL.length - 1]!;
  const near = position.z + first.z * scale;
  const far = position.z + last.z * scale;
  const left = position.x + Math.min(...DAM_CHANNEL.map(section => section.x - section.halfWidth)) * scale;
  const right = position.x + Math.max(...DAM_CHANNEL.map(section => section.x + section.halfWidth)) * scale;
  const surfaceY = (z: number): number => damOutflowWaterY(placement, z);
  const containsXZ = (x: number, z: number): boolean => {
    if (z < near || z > far) return false;
    const section = damChannelAt((z - position.z) / scale);
    return Math.abs((x - position.x) / scale - section.x) <= section.halfWidth;
  };
  return { left, right, near, far, surfaceY, containsXZ,
    top: surfaceY(near), bottom: surfaceY(far) - 3.5 * scale };
}

/** Piecewise linear centreline/width so render mesh and heightfield agree. */
export function damChannelAt(z: number): DamChannelSection {
  for (let i = 0; i < DAM_CHANNEL.length - 1; i++) {
    const a = DAM_CHANNEL[i]!, b = DAM_CHANNEL[i + 1]!;
    if (z > b.z) continue;
    const t = Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z)));
    return {
      z,
      x: lerp(a.x, b.x, t),
      halfWidth: lerp(a.halfWidth, b.halfWidth, t),
      level: lerp(a.level, b.level, t),
    };
  }
  const last = DAM_CHANNEL[DAM_CHANNEL.length - 1]!;
  return { ...last, z };
}

/**
 * Sculpt the actual heightfield before roads, biomes, Rapier and collectible
 * placement. The wet core stays below the water; the narrow rocky shoulders
 * rise smoothly into the existing grass instead of being flat billboards.
 * This is seed-independent and scales with all supported island sizes.
 */
export function sculptDamOutflow(island: IslandData): void {
  const { position, scale } = getDamPlacement(island);
  const { heights, resolution: n, size } = island;
  const { left, right, near, far } = DAM_POOL_EXIT;
  const minZ = position.z + 4 * scale;
  const maxZ = position.z + 111 * scale;
  for (let iz = 0; iz < n; iz++) {
    const worldZ = gridCoordinate(size, n, iz);
    if (worldZ < minZ || worldZ > maxZ) continue;
    const z = (worldZ - position.z) / scale;
    const channel = damChannelAt(z);
    const fade = smoothstep(4, 12, z) * (1 - smoothstep(97, 111, z));
    for (let ix = 0; ix < n; ix++) {
      const worldX = gridCoordinate(size, n, ix);
      const x = (worldX - position.x) / scale;
      const distance = Math.abs(x - channel.x);
      const half = channel.halfWidth;
      if (distance > half + 19) continue;
      const index = gridIndex(n, ix, iz);
      const original = heights[index]!;
      const surface = position.y + channel.level * scale;
      const bed = surface - (2.7 - 0.3 * distance / Math.max(half, 1)) * scale;
      const wet = 1 - smoothstep(half - 1, half + 5, distance);
      let height = lerp(original, Math.min(original, bed), wet * fade);
      const shoulder = smoothstep(half - 1, half + 5, distance) *
        (1 - smoothstep(half + 7, half + 19, distance)) * fade;
      const rugged = 0.75 * Math.sin(x * 0.43 + z * 0.21);
      const bluffTop = surface + (5.6 + rugged) * scale;
      height = lerp(height, Math.max(height, bluffTop), shoulder * 0.72);
      // A shallow east-bank exit from the plunge pool meets the meadow beyond
      // the steep shoulder. Keep the launch lane and the submerged pool floor.
      const exit = smoothstep(near - 7, near, z) * (1 - smoothstep(far, far + 9, z)) *
        smoothstep(left, left + 4, x) * (1 - smoothstep(right - 6, right, x));
      const fromBank = x - channel.x - half;
      const beachHeight = Math.min(1.1, (fromBank + .8) * (fromBank < 0 ? .29 : .105));
      const exitGrade = surface + (DAM_WATER_SURFACE_LIFT + beachHeight) * scale;
      height = lerp(height, exitGrade, exit * fade);
      heights[index] = height;
    }
  }
}

/** Upstream of the solid rear face, separate from the downstream splash lane. */
export function getDamHeadwater(island: IslandData) {
  const { position, scale } = getDamPlacement(island);
  return {
    position, scale,
    level: position.y + 7.1 * scale,
    left: position.x - 43 * scale,
    right: position.x + 39 * scale,
    rear: position.z - 77 * scale,
    front: position.z - 3.42 * scale,
  };
}

/** Positive distances climb onto the irregular dry bank. */
function headwaterBankDistance(x: number, z: number): number {
  const centerX = -9.4 + 3.5 * Math.sin((z + 15) * .072);
  const halfWidth = lerp(26, 12, smoothstep(-32, -13, z));
  const ellipticalBank = (Math.hypot((x - centerX) / halfWidth, (z + 28) / 36) - 1) * 27;
  const westRise = lerp(-37, -28, smoothstep(-36, -20, z));
  return Math.max(ellipticalBank, westRise - x);
}

/** Regrade the rear service road above the new lake on its existing centerline. */
export function sculptDamHeadwater(island: IslandData): void {
  fitDamMountainTrail(island);
  const basin = getDamHeadwater(island);
  const { position, scale, level } = basin;
  const { heights, size, resolution: n } = island;
  const crest = level + .95 * scale;
  const bermPad = size / (n - 1) * .7;
  const segments: Array<{ a: RoadPoint; b: RoadPoint; width: number }> = [];
  const junctions: RoadPoint[] = [];
  const local = (p: Pick<RoadPoint, 'x' | 'z'>) => ({
    x: (p.x - position.x) / scale, z: (p.z - position.z) / scale,
  });
  const routes = island.roads.filter(road => road.from === 'the-dam' || road.to === 'the-dam').map(road => ({
    road, points: road.id === DAM_MOUNTAIN_TRAIL ? damMountainTrailDirt(island, road) : road.points,
  }));
  const grade = ({ road, points }: typeof routes[number]) => {
    const limit = road.type === 'road' ? .17 : .24;
    const pavedJunction = points.length < road.points.length ? points.at(-1) : undefined;
    const lift = (a: RoadPoint, b: RoadPoint) => {
      if (b === pavedJunction) return;
      const { x, z } = local(b);
      if (Math.abs(x) > 70 || z > 7 || z < -81) return;
      b.y = Math.max(b.y, a.y - limit * Math.hypot(b.x - a.x, b.z - a.z));
    };
    for (let i = 1; i < points.length; i++) lift(points[i - 1]!, points[i]!);
    for (let i = points.length - 2; i >= 0; i--) lift(points[i + 1]!, points[i]!);
  };
  for (const route of routes) {
    const { road, points } = route;
    junctions.push(road.from === 'the-dam' ? road.points[0]! : road.points.at(-1)!);
    if (road.type === 'road') {
      for (const p of points) {
        const { x, z } = local(p);
        const besideBasin = 1 - smoothstep(5, 15, headwaterBankDistance(x, z));
        const rearApproach = 1 - smoothstep(-7, -1, z);
        const weight = besideBasin * rearApproach;
        p.y = Math.max(p.y, p.y + (crest - p.y) * weight);
      }
      grade(route);
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      const m = local({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      if (Math.abs(m.x) <= 68 && m.z >= -79 && m.z <= 8) segments.push({ a, b, width: road.width });
    }
  }

  const junctionY = Math.max(...junctions.map(p => p.y));
  for (const p of junctions) p.y = junctionY;
  for (const road of routes) grade(road);

  // Cut the wet floor and raise the weathered shoulder into the existing
  // terrain. Grade a berm under the existing service road through the lake.
  for (let iz = 0; iz < n; iz++) {
    const z = gridCoordinate(size, n, iz);
    if (z < basin.rear || z > position.z + 3 * scale) continue;
    for (let ix = 0; ix < n; ix++) {
      const x = gridCoordinate(size, n, ix);
      if (x < position.x - 64 * scale || x > position.x + 60 * scale) continue;
      const i = gridIndex(n, ix, iz);
      const src = heights[i]!;
      const p = { x, z };
      const localPoint = local(p);
      const bankDistance = headwaterBankDistance(localPoint.x, localPoint.z);
      let h = src;
      if (z <= basin.front + 1.8 * scale) {
        const floor = level + Math.max(-3.4, Math.min(2.6, bankDistance * .56)) * scale;
        h = lerp(src, floor, 1 - smoothstep(4, 14, bankDistance));
      }
      // The road berm separates this wall footing from the upstream lake.
      // Grade the shallow inner pocket dry while letting the road set its own shoulder.
      const apron = smoothstep(-12, -8, localPoint.z) *
        (1 - smoothstep(-.5, 3, localPoint.z)) *
        (1 - smoothstep(12, 17, Math.abs(localPoint.x + 8)));
      h = lerp(h, Math.max(h, level + .55 * scale), apron);
      let bestDistance = Infinity;
      let roadHeight = h;
      for (const { a, b, width } of segments) {
        const { t, distance } = segmentProjection(p, a, b);
        const bermEdge = width / 2 + bermPad;
        if (distance >= bestDistance || distance > bermEdge + 3.5 * scale) continue;
        bestDistance = distance;
        const dryRoad = lerp(a.y, b.y, t);
        const shoulder = 1 - smoothstep(bermEdge, bermEdge + 3.5 * scale, distance);
        roadHeight = lerp(h, dryRoad, shoulder);
      }
      heights[i] = roadHeight;
    }
  }

  const board = island.pois.find(poi => poi.id === 'the-dam')!.center;
  board.y = gridSample(island, board.x, board.z);

  const mountain = routes.find(route => route.road.id === DAM_MOUNTAIN_TRAIL);
  const lowerDirt = mountain?.points.slice(1).flatMap((b, i) => {
    const a = mountain.points[i]!;
    return Math.max(a.z, b.z) <= position.z + 80 * scale && !a.bridge && !b.bridge
      ? [{ a, b }] : [];
  }) ?? [];

  // The seeded dressing is already in place. Keep the lower trail open and
  // re-seat the back-bank scenery while culling plants in the upper reservoir.
  island.props = island.props.filter(prop => {
    const { x, z } = prop.transform.position;
    // The authored wall spans X −30..30 and Z −3.5..3.5 locally.
    // Trees rooted inside it otherwise put their crowns through the rear face.
    if ((prop.kind === 'tree-oak' || prop.kind === 'tree-pine') &&
        Math.abs(x - position.x) < 30 * scale && Math.abs(z - position.z) < 3.5 * scale) return false;
    if (!['rock', 'bush', 'tree-pine', 'tree-oak', 'grass-tuft', 'flower', 'lamp'].includes(prop.kind)) return true;
    if (mountain && prop.kind !== 'lamp' && prop.collidable && prop.body.type === 'static' &&
        (prop.id.startsWith('detail-the-dam-') || prop.id.startsWith('detail-island-'))) {
      const { x: width, z: depth } = prop.size;
      const radius = (prop.kind === 'tree-oak' || prop.kind === 'tree-pine'
        ? Math.min(1.8, width * .4)
        : prop.shape === 'cylinder' ? Math.max(width, depth) : Math.hypot(width, depth)) / 2;
      if (lowerDirt.some(({ a, b }) => {
        const { t, distance } = segmentProjection({ x, z }, a, b);
        const y = lerp(a.y, b.y, t);
        return distance < mountain.road.width / 2 + radius &&
          prop.transform.position.y + prop.size.y / 2 > y &&
          prop.transform.position.y - prop.size.y / 2 < y + 2 * scale;
      })) return false;
    }
    if (z < basin.rear || z > position.z + 3 * scale ||
        x < position.x - 64 * scale || x > position.x + 60 * scale) return true;
    const ground = gridSample(island, x, z);
    if (isDamHeadwater(island, x, z)) return false;
    prop.transform.position.y = ground + prop.size.y / 2;
    return true;
  });
}

/** Height of the actual terrain triangles under the upper reservoir. */
export function isDamHeadwater(island: IslandData, x: number, z: number): boolean {
  const { left, right, rear, front, level, position, scale } = getDamHeadwater(island);
  if (x < left || x > right || z < rear || z > front) return false;
  const { size, resolution: n, heights } = island;
  const gx = (x / size + .5) * (n - 1), gz = (z / size + .5) * (n - 1);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const u = gx - ix, v = gz - iz;
  const triangleSample = (at: (x: number, z: number) => number) => {
    if (u + v <= 1) {
      const a = at(ix, iz);
      return a + (at(ix + 1, iz) - a) * u + (at(ix, iz + 1) - a) * v;
    }
    const d = at(ix + 1, iz + 1);
    return d + (at(ix, iz + 1) - d) * (1 - u) + (at(ix + 1, iz) - d) * (1 - v);
  };
  if (triangleSample((ix, iz) => heights[gridIndex(n, ix, iz)]!) >= level) return false;
  return triangleSample((ix, iz) => headwaterBankDistance(
    (gridCoordinate(size, n, ix) - position.x) / scale,
    (gridCoordinate(size, n, iz) - position.z) / scale,
  )) <= 4;
}

/** Flat water polygons clipped by the same terrain planes used for immersion. */
export function damHeadwaterSurface(island: IslandData): { positions: number[]; depths: number[] } {
  const { left, right, rear, front, level, position, scale } = getDamHeadwater(island);
  const { size, resolution: n, heights } = island;
  const positions: number[] = [];
  const depths: number[] = [];
  const grid = (world: number) => (world / size + .5) * (n - 1);
  const vertex = (ix: number, iz: number) => {
    const x = gridCoordinate(size, n, ix), z = gridCoordinate(size, n, iz);
    return { x, z, y: heights[gridIndex(n, ix, iz)]!,
      bank: headwaterBankDistance((x - position.x) / scale, (z - position.z) / scale) };
  };
  type Vertex = ReturnType<typeof vertex>;
  function clip(points: Vertex[], inside: (point: Vertex) => number): Vertex[] {
    const result: Vertex[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!;
      const start = inside(a), end = inside(b);
      if (start >= 0) result.push(a);
      if ((start < 0) === (end < 0)) continue;
      const t = start / (start - end);
      result.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t),
        bank: lerp(a.bank, b.bank, t) });
    }
    return result;
  }
  for (let iz = Math.floor(grid(rear)); iz < Math.ceil(grid(front)); iz++) {
    for (let ix = Math.floor(grid(left)); ix < Math.ceil(grid(right)); ix++) {
      const a = vertex(ix, iz), b = vertex(ix + 1, iz), c = vertex(ix, iz + 1), d = vertex(ix + 1, iz + 1);
      for (const triangle of [[a, c, b], [b, c, d]]) {
        let wet = clip(triangle, q => level - q.y);
        wet = clip(wet, q => 4 - q.bank);
        wet = clip(wet, q => q.x - left);
        wet = clip(wet, q => right - q.x);
        wet = clip(wet, q => q.z - rear);
        wet = clip(wet, q => front - q.z);
        for (let j = 1; j + 1 < wet.length; j++) {
          for (const p of [wet[0]!, wet[j]!, wet[j + 1]!]) {
            positions.push(p.x, level, p.z);
            depths.push(Math.max(0, level - p.y));
          }
        }
      }
    }
  }
  return { positions, depths };
}
