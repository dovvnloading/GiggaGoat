import type { IslandData, PoiId, RoadDescriptor, RoadPoint, Vec2 } from './types';
import { clamp, lerp, SeededRandom } from './random';
import { gridSample, riverAt, stampRoad } from './terrain';

interface Link { from: PoiId; to: PoiId; type: 'road' | 'trail'; via?: Vec2[] }
/** Main asphalt loop traces the coastal settlements; dirt spurs access the summit and islet. */
const LINKS: Link[] = [
  { from: 'hoofington', to: 'baa-ardwalk', type: 'road',
    via: [{ x: -110, z: 185 }, { x: -35, z: 222 }, { x: 20, z: 226 }] },
  { from: 'baa-ardwalk', to: 'downtown-bleatsville', type: 'road',
    via: [{ x: 108, z: 205 }, { x: 165, z: 170 }] },
  { from: 'downtown-bleatsville', to: 'crane-yard', type: 'road',
    via: [{ x: 200, z: 60 }, { x: 212, z: 8 }] },
  { from: 'crane-yard', to: 'the-dam', type: 'road',
    via: [{ x: 171, z: -112 }, { x: 107, z: -175 }, { x: 38, z: -213 }] },
  { from: 'the-dam', to: 'whispering-pines', type: 'road',
    via: [{ x: -73, z: -217 }, { x: -112, z: -188 }] },
  { from: 'whispering-pines', to: 'hoofington', type: 'road',
    via: [{ x: -190, z: -80 }, { x: -209, z: 15 }, { x: -183, z: 88 }] },
  { from: 'whispering-pines', to: 'old-lighthouse', type: 'trail',
    via: [{ x: -185, z: -93 }, { x: -211, z: -18 }, { x: -244, z: -18 }] },
  { from: 'mt-gigga', to: 'hoofington', type: 'trail' },
  { from: 'mt-gigga', to: 'the-dam', type: 'trail',
    via: [{ x: 73, z: -92 }, { x: 58, z: -161 }] },
  { from: 'downtown-bleatsville', to: 'mt-gigga', type: 'trail',
    via: [{ x: 88, z: 91 }, { x: 62, z: 54 }] },
];

function catmullRom(controls: Vec2[], step: number): Vec2[] {
  const result: Vec2[] = [];
  for (let segment = 0; segment < controls.length - 1; segment++) {
    const p0 = controls[Math.max(0, segment - 1)]!;
    const p1 = controls[segment]!, p2 = controls[segment + 1]!;
    const p3 = controls[Math.min(controls.length - 1, segment + 2)]!;
    const count = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / step));
    for (let j = 0; j < count; j++) {
      const t = j / count, t2 = t * t, t3 = t2 * t;
      const coordinate = (axis: 'x' | 'z'): number =>
        0.5 * (2 * p1[axis] + (-p0[axis] + p2[axis]) * t +
          (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2 +
          (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3);
      result.push({ x: coordinate('x'), z: coordinate('z') });
    }
  }
  result.push({ ...controls[controls.length - 1]! });
  return result;
}

/** A two-turn ascending mountain track: grade stays goat-traversable without bulldozing cliffs. */
function mountainSwitchbacks(island: IslandData, destination: PoiId): Vec2[] {
  const summit = island.pois.find(p => p.id === 'mt-gigga')!.center;
  const farm = island.pois.find(p => p.id === destination)!.center;
  const endAngle = Math.atan2(farm.z - summit.z, farm.x - summit.x);
  const points: Vec2[] = [{ x: summit.x, z: summit.z }];
  const steps = 220;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const radius = 5 + 102 * t;
    const angle = endAngle + (1 - t) * 4 * Math.PI;
    points.push({
      x: summit.x + radius * Math.cos(angle),
      z: summit.z + radius * Math.sin(angle),
    });
  }
  const outer = points[points.length - 1]!;
  return points.concat(catmullRom([outer,
    { x: lerp(outer.x, farm.x, 0.58), z: lerp(outer.z, farm.z, 0.58) },
    { x: farm.x, z: farm.z }], 4).slice(1));
}

/** Two-sided Lipschitz projection enforces the max longitudinal grade. */
function gradeRoad(points: RoadPoint[], maxGrade: number): void {
  const n = points.length;
  const sampled = points.map(p => p.y);
  // Low-pass height along arclength (reduces steep noise and narrow terraces).
  for (let i = 1; i < n - 1; i++) {
    let sum = 0, weight = 0;
    for (let k = -4; k <= 4; k++) {
      const j = clamp(i + k, 0, n - 1);
      const w = 5 - Math.abs(k);
      sum += sampled[j]! * w;
      weight += w;
    }
    points[i]!.y = sum / weight;
  }
  // Preserve the endpoints' exact plot/summit heights.
  for (let iter = 0; iter < 16; iter++) {
    points[0]!.y = sampled[0]!;
    for (let i = 1; i < n; i++) {
      const a = points[i - 1]!, b = points[i]!;
      const limit = maxGrade * Math.hypot(b.x - a.x, b.z - a.z);
      b.y = clamp(b.y, a.y - limit, a.y + limit);
    }
    points[n - 1]!.y = sampled[n - 1]!;
    for (let i = n - 2; i >= 0; i--) {
      const a = points[i]!, b = points[i + 1]!;
      const limit = maxGrade * Math.hypot(b.x - a.x, b.z - a.z);
      a.y = clamp(a.y, b.y - limit, b.y + limit);
    }
  }
}

/** Generates a connected, readable road graph, stamps graded beds and marks real bridge spans. */
export function makeRoads(island: IslandData, rng: SeededRandom): RoadDescriptor[] {
  const byId = new Map(island.pois.map(p => [p.id, p]));
  const roads: RoadDescriptor[] = [];
  const scale = island.size / 600;
  for (const link of LINKS) {
    const from = byId.get(link.from)!, to = byId.get(link.to)!;
    const waypoints: Vec2[] = link.from === 'mt-gigga'
      ? mountainSwitchbacks(island, link.to)
      : link.to === 'mt-gigga'
        ? mountainSwitchbacks(island, link.from).reverse()
        : catmullRom([
        { x: from.center.x, z: from.center.z },
        ...(link.via ?? []).map(p => ({
          x: (p.x + rng.range(-2, 2)) * scale,
          z: (p.z + rng.range(-2, 2)) * scale,
        })),
        { x: to.center.x, z: to.center.z },
      ], 4.5 * scale);
    const points: RoadPoint[] = waypoints.map(p => ({
      x: p.x, z: p.z, y: gridSample(island, p.x, p.z), bridge: false,
    }));
    points[0]!.y = from.center.y;
    points[points.length - 1]!.y = to.center.y;
    gradeRoad(points, link.type === 'trail' ? 0.24 : 0.17);
    const width = (link.type === 'road' ? 7.5 : 3.8) * scale;
    for (const p of points) {
      const water = riverAt(p, island.river);
      const isletCrossing = (link.to === 'old-lighthouse' || link.from === 'old-lighthouse') &&
        p.x > -246 * scale && p.x < -203 * scale &&
        Math.abs(p.z + 18 * scale) < 35 * scale;
      p.bridge = isletCrossing || (water.distance < (water.width + width) / 2 + 2 * scale
        && p.y > water.level - 0.5 * scale);
      if (p.bridge) p.y = Math.max(p.y, water.level + 2.3 * scale);
    }
    // Re-project after bridge lifts (both gradients and pads remain constrained).
    gradeRoad(points, link.type === 'trail' ? 0.24 : 0.17);
    for (let i = 0; i < points.length - 1; i++) {
      // Decks span the sea channel without filling it with a terrain causeway.
      if (!((link.from === 'old-lighthouse' || link.to === 'old-lighthouse') &&
        (points[i]!.bridge || points[i + 1]!.bridge))) {
        stampRoad(island, points[i]!, points[i + 1]!, width, island.river);
      }
    }
    roads.push({
      id: link.from + '--' + link.to, from: link.from, to: link.to,
      type: link.type, width, points,
    });
  }
  return roads;
}

/** Separate collidable planks, rather than a solid barrier across the river. */
export function makeBridgeDecks(island: IslandData): import('./types').PropDescriptor[] {
  const decks: import('./types').PropDescriptor[] = [];
  for (const road of island.roads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i]!, b = road.points[i + 1]!;
      if (!a.bridge && !b.bridge) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.05) continue;
      const height = 0.7 * island.size / 600;
      decks.push({
        id: 'bridge-' + road.id + '-' + i,
        kind: 'bridge',
        transform: {
          position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - height / 2, z: (a.z + b.z) / 2 },
          rotationY: Math.atan2(dx, dz),
        },
        size: { x: road.width + 1, y: height, z: distance + 1.25 },
        body: { type: 'static' }, shape: 'cuboid', collidable: true,
        breakable: false, lickable: true, climbable: true,
      });
    }
  }
  return decks;
}

/** The topology, independent of mesh generation or world coordinates. */
export function arePoisConnected(roads: readonly RoadDescriptor[], ids: readonly PoiId[]): boolean {
  if (ids.length === 0) return true;
  const visited = new Set<PoiId>([ids[0]!]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const road of roads) {
      if (visited.has(road.from) && !visited.has(road.to)) {
        visited.add(road.to); changed = true;
      }
      if (visited.has(road.to) && !visited.has(road.from)) {
        visited.add(road.from); changed = true;
      }
    }
  }
  return ids.every(id => visited.has(id));
}
