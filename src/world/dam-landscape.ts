import type { IslandData, RoadPoint } from './types';
import { gridCoordinate, gridIndex, gridSample, segmentProjection } from './terrain';
import { lerp, smoothstep } from './random';
import { getDamPlacement } from './the-dam';

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
  const routes = island.roads.filter(road => road.from === 'the-dam' || road.to === 'the-dam');
  const grade = (road: typeof routes[number]) => {
    const limit = road.type === 'road' ? .17 : .24;
    const lift = (a: RoadPoint, b: RoadPoint) => {
      const { x, z } = local(b);
      if (Math.abs(x) > 70 || z > 7 || z < -81) return;
      b.y = Math.max(b.y, a.y - limit * Math.hypot(b.x - a.x, b.z - a.z));
    };
    for (let i = 1; i < road.points.length; i++) lift(road.points[i - 1]!, road.points[i]!);
    for (let i = road.points.length - 2; i >= 0; i--) lift(road.points[i + 1]!, road.points[i]!);
  };
  for (const road of routes) {
    junctions.push(road.from === 'the-dam' ? road.points[0]! : road.points[road.points.length - 1]!);
    if (road.type === 'road') {
      for (const p of road.points) {
        const { x, z } = local(p);
        const besideBasin = 1 - smoothstep(5, 15, headwaterBankDistance(x, z));
        const rearApproach = 1 - smoothstep(-7, -1, z);
        const weight = besideBasin * rearApproach;
        p.y = Math.max(p.y, p.y + (crest - p.y) * weight);
      }
      grade(road);
    }
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!;
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

  // The rest of island generation has already run its seeded dressing.
  // Re-seat the back-bank scenery and cull detached plants in the new water.
  island.props = island.props.filter(prop => {
    const { x, z } = prop.transform.position;
    if (z < basin.rear || z > position.z + 3 * scale ||
        x < position.x - 64 * scale || x > position.x + 60 * scale) return true;
    if (!['rock', 'bush', 'tree-pine', 'tree-oak', 'grass-tuft', 'flower', 'lamp'].includes(prop.kind)) return true;
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
