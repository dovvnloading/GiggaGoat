import type { IslandData, PoiId, PropColliderDescriptor, RoadDescriptor, RoadPoint, Vec2 } from './types';
import { clamp, lerp, SeededRandom, smoothstep } from './random';
import { exposeRoadBed, gridSample, riverAt, stampRoad } from './terrain';
import { CRANE_YARD_PLAN } from './crane-yard';
import { getDamPlacement } from './the-dam';

interface Link { from: PoiId; to: PoiId; type: 'road' | 'trail'; via?: Vec2[] }
/** Main asphalt loop traces the coastal settlements; dirt spurs access the summit and islet. */
const LINKS: Link[] = [
  { from: 'hoofington', to: 'baa-ardwalk', type: 'road',
    via: [{ x: -147, z: 177 }, { x: -110, z: 185 }, { x: -35, z: 222 }, { x: 20, z: 226 }] },
  { from: 'baa-ardwalk', to: 'downtown-bleatsville', type: 'road',
    via: [{ x: 108, z: 205 }, { x: 145, z: 170 }] },
  // The continuous ring bypasses the Crane Yard; its gated access is a separate spur.
  { from: 'downtown-bleatsville', to: 'the-dam', type: 'road' },
  { from: 'the-dam', to: 'whispering-pines', type: 'road',
    via: [{ x: -73, z: -217 }, { x: -112, z: -188 }] },
  { from: 'whispering-pines', to: 'hoofington', type: 'road',
    via: [{ x: -190, z: -80 }, { x: -209, z: 15 }, { x: -183, z: 88 }, { x: -147, z: 89 }] },
  { from: 'whispering-pines', to: 'old-lighthouse', type: 'trail',
    via: [{ x: -185, z: -93 }, { x: -211, z: -18 }, { x: -244, z: -18 }] },
  { from: 'mt-gigga', to: 'hoofington', type: 'trail' },
  { from: 'mt-gigga', to: 'the-dam', type: 'trail',
    via: [{ x: 73, z: -92 }, { x: 58, z: -161 }] },
  { from: 'downtown-bleatsville', to: 'mt-gigga', type: 'trail',
    via: [{ x: 145, z: 40 }, { x: 88, z: 28 }, { x: 62, z: 54 }] },
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
function mountainSwitchbacks(island: IslandData, destination: PoiId,
  damJunction?: RoadPoint): Vec2[] {
  const summit = island.pois.find(p => p.id === 'mt-gigga')!.center;
  const farm = island.pois.find(p => p.id === destination)!.center;
  const endAngle = Math.atan2(farm.z - summit.z, farm.x - summit.x);
  const points: Vec2[] = [{ x: summit.x, z: summit.z }];
  const steps = 220;
  // On the smallest islands even the inner turns can reach the reservoir.
  const radiusScale = damJunction && island.size < 400 ? island.size / 530 : 1;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const radius = 5 + 102 * t * radiusScale;
    const angle = endAngle + (1 - t) * 4 * Math.PI;
    points.push({
      x: summit.x + radius * Math.cos(angle),
      z: summit.z + radius * Math.sin(angle),
    });
  }
  const outer = points[points.length - 1]!;
  const scale = island.size / 600;
  if (damJunction) {
    const { position } = getDamPlacement(island);
    const at = (x: number, z: number): Vec2 => ({
      x: position.x + x * scale, z: position.z + z * scale,
    });
    const reservoir = island.reservoir;
    const eastEdge = reservoir.center.x + reservoir.radiusX + 6 * scale;
    const southEdge = reservoir.center.z + reservoir.radiusZ + 6 * scale;
    const eastExit = outer.z < southEdge ? [...points].reverse().find(point =>
      point.x > eastEdge && point.z < at(48, 49).z && point.z > at(48, -5).z) : undefined;
    const bank = [at(20, 61), at(44, 59), at(49, 49), at(48, 2), at(48, -5)];
    if (eastExit) points.length = points.indexOf(eastExit) + 1;
    const approach = eastExit ? bank.filter(point => point.z < eastExit.z - 2 * scale) : bank;
    // The last point hands off to the existing paved service road past the reservoir.
    return points.concat(catmullRom([eastExit ?? outer, ...approach, damJunction], 3.25 * scale).slice(1));
  }
  if (destination === 'downtown-bleatsville') {
    // The original spiral's final straight diagonal crossed the west side
    // of Downtown, making several main-street shops face AWAY from their
    // nearest road. Approach the district from the south and join the
    // centreline before reaching the storefront rows.
    const approach = { x: farm.x, z: farm.z - 66 * scale };
    return points.concat(catmullRom([
      outer,
      { x: lerp(outer.x, approach.x, 0.55),
        z: lerp(outer.z, approach.z, 0.55) - 9 * scale },
      approach,
      { x: farm.x, z: farm.z },
    ], 4 * scale).slice(1));
  }
  // Enter the farm along the same axial street as the ring-road approaches,
  // instead of feeding three diagonal slabs into the village crossroads.
  const approach = destination === 'hoofington'
    ? { x: farm.x, z: farm.z - 45 * scale }
    : { x: lerp(outer.x, farm.x, 0.58), z: lerp(outer.z, farm.z, 0.58) };
  return points.concat(catmullRom([outer,
    { x: lerp(outer.x, approach.x, 0.58), z: lerp(outer.z, approach.z, 0.58) },
    approach,
    { x: farm.x, z: farm.z }], 4 * scale).slice(1));
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

/** Keep the through road inland of the Lighthouse bridge's low mainland spans. */
export function separateLighthouseFork(island: IslandData): void {
  const road = island.roads.find(road => road.id === 'whispering-pines--hoofington');
  if (!road) return;
  const scale = island.size / 600;
  let first = road.points.length;
  let last = -1;
  for (const [index, point] of road.points.entries()) {
    const enter = smoothstep(-70 * scale, -44 * scale, point.z);
    const leave = 1 - smoothstep(-21 * scale, -4 * scale, point.z);
    if (enter === 0 || leave === 0) continue;
    point.x += 9.75 * scale * enter * leave;
    point.y = Math.max(point.y, gridSample(island, point.x, point.z));
    first = Math.min(first, index);
    last = index;
  }
  if (first > last) return;

  // Grade the existing shoulders into the bend so walking downhill does not
  // lose contact at either handoff to the original pavement.
  const approach = road.points.slice(Math.max(0, first - 4), last + 5);
  gradeRoad(approach, .04);

  // Retain the seeded plants and the way they sit on the verge after grading.
  const planted = island.props.filter(prop => prop.id.startsWith('detail-island-'))
    .map(({ transform: { position } }) => ({ position, ground: gridSample(island, position.x, position.z) }));
  for (let i = 1; i < approach.length; i++) {
    stampRoad(island, approach[i - 1]!, approach[i]!, road.width, island.river);
  }
  for (const { position, ground } of planted) {
    position.y += gridSample(island, position.x, position.z) - ground;
  }
}

/** Generates a connected, readable road graph, stamps graded beds and marks real bridge spans. */
export function makeRoads(island: IslandData, rng: SeededRandom): RoadDescriptor[] {
  const byId = new Map(island.pois.map(p => [p.id, p]));
  const roads: RoadDescriptor[] = [];
  const scale = island.size / 600;

  // The fence is centred on the seed-jittered POI, not the old unjittered map
  // anchor. Keep the full asphalt ribbon and its curved corners outside the
  // fence plus 4 real metres; 12 scaled metres leave room for the road width.
  const yard = byId.get('crane-yard')!.center;
  const gate: Vec2 = {
    x: yard.x + (CRANE_YARD_PLAN.frontGate.min + CRANE_YARD_PLAN.frontGate.max) * 0.5 * scale,
    z: yard.z + CRANE_YARD_PLAN.halfDepth * scale,
  };
  const clearance = 4 + 12 * scale;
  const junction: Vec2 = { x: gate.x, z: gate.z + clearance };
  const westX = yard.x - CRANE_YARD_PLAN.halfWidth * scale - clearance;
  const southZ = yard.z - CRANE_YARD_PLAN.halfDepth * scale - clearance;

  // Keep all paths (including the short gate spur) in the same grading,
  // bridge-lift and terrain-stamping pipeline.
  const addRoad = (
    link: Link, waypoints: Vec2[], startY: number, endY: number,
    id = link.from + '--' + link.to,
  ): RoadDescriptor => {
    const points: RoadPoint[] = waypoints.map(p => ({
      x: p.x, z: p.z, y: gridSample(island, p.x, p.z), bridge: false,
    }));
    points[0]!.y = startY;
    points[points.length - 1]!.y = endY;
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
    const road: RoadDescriptor = {
      id, from: link.from, to: link.to, type: link.type, width, points,
    };
    roads.push(road);
    return road;
  };

  for (const link of LINKS) {
    const from = byId.get(link.from)!, to = byId.get(link.to)!;
    let waypoints: Vec2[];
    if (link.from === 'downtown-bleatsville' && link.to === 'the-dam') {
      // The old two road links used six jittered controls. Consume the same
      // twelve random draws so downstream roads and seeded props do not move.
      for (let i = 0; i < 6; i++) {
        rng.range(-2, 2);
        rng.range(-2, 2);
      }
      // Pass north of the front fence, then WEST of the whole compound before
      // turning toward the Dam. This inland side remains dry for island seeds.
      // The explicit junction control also gives the spur an exact road join.
      waypoints = catmullRom([
        { x: from.center.x, z: from.center.z },
        { x: from.center.x, z: from.center.z - 65 * scale },
        { x: junction.x, z: yard.z + 90 * scale },
        junction,
        { x: westX, z: junction.z },
        { x: westX, z: southZ },
        { x: 107 * scale, z: -175 * scale },
        { x: 38 * scale, z: -213 * scale },
        { x: to.center.x, z: to.center.z },
      ], 4.5 * scale);
    } else {
      waypoints = link.from === 'mt-gigga'
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
    }
    addRoad(link, waypoints, from.center.y, to.center.y);
  }

  // A single short asphalt spur joins the bypass to the front gate gap.
  // It intentionally terminates at the fence (the only exception to the
  // ring's four-metre exclusion zone), not in the middle of the yard.
  const ring = roads.find(road => road.id === 'downtown-bleatsville--the-dam')!;
  const joined = ring.points.reduce((best, p) =>
    Math.hypot(p.x - junction.x, p.z - junction.z) <
      Math.hypot(best.x - junction.x, best.z - junction.z) ? p : best, ring.points[0]!);
  addRoad(
    { from: 'downtown-bleatsville', to: 'crane-yard', type: 'road' },
    catmullRom([junction, gate], 4.5 * scale),
    joined.y, gridSample(island, gate.x, gate.z),
    'crane-yard-gate-spur',
  );

  // Stamp village and city main roads separately from the public POI graph.
  // Its regular links end at POI centres; the gated spur joins the ring.
  for (const street of makeLocalStreets(island)) {
    for (let j = 0; j < street.points.length - 1; j++) {
      stampRoad(island, street.points[j]!, street.points[j + 1]!,
        street.width, island.river);
    }
  }
  return roads;
}

/**
 * Visual/physical through-streets within city plots, separate from the POI
 * connectivity graph. Rendering uses these same graded centreline segments.
 */
export function makeLocalStreets(island: Pick<IslandData, 'size' | 'pois' | 'heights' | 'resolution' | 'localStreets'>): RoadDescriptor[] {
  if (island.localStreets) return island.localStreets;
  const scale = island.size / 600;
  return (['hoofington', 'downtown-bleatsville'] as const).map(id => {
    const centre = island.pois.find(p => p.id === id)!.center;
    const halfLength = id === 'hoofington' ? 42 : 43;
    const width = (id === 'hoofington' ? 6.8 : 9.1) * scale;
    const points: RoadPoint[] = [];
    for (let j = 0; j <= 22; j++) {
      const z = centre.z + (-halfLength + j * 2 * halfLength / 22) * scale;
      points.push({
        x: centre.x, z, y: gridSample(island, centre.x, z), bridge: false,
      });
    }
    gradeRoad(points, 0.11);
    return {
      id: id + '-main-street', from: id, to: id,
      type: 'road' as const, width, points,
    };
  });
}

/** Horizontal lateral offset at a road point, shared by the rope posts and deck. */
export function roadSideOffset(road: RoadDescriptor, index: number, halfWidth: number): Vec2 {
  const a = road.points[Math.max(0, index - 1)]!;
  const b = road.points[Math.min(road.points.length - 1, index + 1)]!;
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: -dz / length * halfWidth, z: dx / length * halfWidth };
}

/** Plank descriptors also supply the visual envelopes for the rope bridge. */
export function makeBridgeDecks(island: IslandData, roads = island.roads): import('./types').PropDescriptor[] {
  const decks: import('./types').PropDescriptor[] = [];
  for (const road of roads) {
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

export const DAM_EAST_ROAD = 'downtown-bleatsville--the-dam';
export const DAM_MOUNTAIN_TRAIL = 'mt-gigga--the-dam';
export const DAM_PINES_ROAD = 'the-dam--whispering-pines';
export const DAM_PINES_BRIDGE_PREFIX = 'bridge-' + DAM_PINES_ROAD + '-';

/** Route the through road round the landward foot of the dam stairs. Both
 * regional roads retain a common junction and the pedestrian approach stays at the board. */
export function clearDamTrafficApproach(island:IslandData):void {
  const {position,scale}=getDamPlacement(island);
  const floor=position.z-18.8*scale;
  const planting=island.props.filter(p=>p.id.startsWith('detail-') &&
    Math.abs(p.transform.position.x-position.x)<49*scale && Math.abs(p.transform.position.z-floor)<18*scale)
    .map(p=>({p:p.transform.position,old:gridSample(island,p.transform.position.x,p.transform.position.z)}));
  const points=new Set<RoadPoint>();
  for(const road of island.roads) {
    if(road.id!==DAM_PINES_ROAD && road.id!==DAM_EAST_ROAD)continue;
    const changed:RoadPoint[]=[];
    for(const p of road.points){
      if(p.bridge || Math.abs(p.z-position.z)>33*scale)continue;
      const x=(p.x-position.x)/scale;
      if(x < -34 || x > 41)continue;
      // Ease the verge between the untouched eastern trail fork and the forest causeway.
      const amount=smoothstep(-34,-9,x)*(1-smoothstep(20,41,x));
      if (!points.has(p)) {
        const shift = (p.z - Math.min(floor,p.z)) * amount;
        if (shift > 0) {
          p.stairApron = shift;
          p.z -= shift;
        }
      }
      points.add(p);changed.push(p);
    }
    exposeRoadBed(island,changed,road.width);
  }
  for(const {p,old} of planting)p.y+=gridSample(island,p.x,p.z)-old;
}

/** Keep the asphalt visible across the earth handoff on the forest bank. */
export function fitPinesBridgeApproach(island: IslandData): void {
  const road = island.roads.find(item => item.id === DAM_PINES_ROAD);
  if (!road) return;
  const bank = road.points.lastIndexOf(road.points.filter(point => point.bridge).at(-1)!);
  if (bank < 0) return;
  const forest = road.points.at(-1)!;
  const planted = island.props.flatMap(prop => {
    // Lily pads follow the river surface when the underlying channel changes.
    if (prop.kind === 'lily-pads') return [];
    const position = prop.transform.position;
    return Math.hypot(position.x - forest.x, position.z - forest.z) < 45 * island.size / 600
      ? [{ position, ground: gridSample(island, position.x, position.z) }] : [];
  });
  exposeRoadBed(island, road.points.slice(bank), road.width);
  for (const { position, ground } of planted) {
    position.y += gridSample(island, position.x, position.z) - ground;
  }
}


/** Fit the dry fork after seeded dressing has used the original terrain and roads. */
export function fitDamMountainTrail(island: IslandData): void {
  const trail = island.roads.find(road => road.id === DAM_MOUNTAIN_TRAIL);
  const paved = island.roads.find(road => road.id === DAM_EAST_ROAD);
  if (!trail || !paved) return;
  const { position, scale } = getDamPlacement(island);
  const branchX = position.x + 48 * scale;
  const junction = paved.points.reduce((best, point) =>
    point.z < position.z - 7 * scale && Math.abs(point.x - branchX) < Math.abs(best.x - branchX)
      ? point : best);

  const waypoints = mountainSwitchbacks(island, 'the-dam', junction);
  const fork = waypoints.findIndex((point, index) =>
    point.x !== trail.points[index]?.x || point.z !== trail.points[index]?.z) - 1;
  const original = trail.points[fork];
  if (!original) return;
  const points = waypoints.slice(fork).map((p): RoadPoint => ({
    ...p, y: gridSample(island, p.x, p.z), bridge: false,
  }));
  points[0]!.y = original.y;
  points.at(-1)!.y = junction.y;
  gradeRoad(points, .24);
  for (const p of points.slice(1, -1)) {
    const water = riverAt(p, island.river);
    p.bridge = water.distance < (water.width + trail.width) / 2 + 2 * scale &&
      p.y > water.level - .5 * scale;
    if (p.bridge) p.y = Math.max(p.y, water.level + 2.3 * scale);
  }
  gradeRoad(points, .24);

  // Keep the dirt below the asphalt across their overlap, even on steep banks.
  let distance = 0;
  for (let i = points.length - 2; i > 0; i--) {
    const a = points[i]!, b = points[i + 1]!;
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    distance += run;
    const height = distance <= 10 * scale ? junction.y - .06 * scale : a.y;
    a.y = clamp(height, b.y - .24 * run, b.y + .24 * run);
  }

  const planted = island.props.flatMap(prop => {
    const plant = prop.transform.position;
    if (!(prop.id.startsWith('detail-the-dam-') || prop.id.startsWith('detail-island-')) ||
        !['rock', 'bush', 'flower', 'grass-tuft', 'tree-oak', 'tree-pine'].includes(prop.kind) ||
        Math.abs(plant.x - position.x) > 70 * scale ||
        plant.z < position.z - 25 * scale || plant.z > position.z + 90 * scale) return [];
    return [{ plant, ground: gridSample(island, plant.x, plant.z) }];
  });
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    // A shortened spiral can cross old district terrain on tiny islands.
    // Only the Dam bank needs a new earth bed there.
    if (island.size < 400 && (Math.max(a.z, b.z) > position.z + 80 * scale ||
        Math.min(a.x, b.x) < position.x + 8 * scale)) continue;
    stampRoad(island, a, b, trail.width, island.river);
  }
  for (const { plant, ground } of planted) {
    plant.y += gridSample(island, plant.x, plant.z) - ground;
  }
  // Keep the original upper switchbacks and reuse the board-side pavement.
  trail.points = [...trail.points.slice(0, fork + 1), ...points.slice(1, -1),
    ...paved.points.slice(paved.points.indexOf(junction))];

  const bridgePrefix = 'bridge-' + trail.id + '-';
  island.props = island.props.filter(prop => !prop.id.startsWith(bridgePrefix));
  island.props.push(...makeBridgeDecks(island, [trail]));
}

/** The new dirt and its shared junction, before the existing asphalt to the board. */
export function damMountainTrailDirt(island: IslandData, trail: RoadDescriptor): readonly RoadPoint[] {
  const pavement = island.roads.find(road => road.id === DAM_EAST_ROAD);
  const junction = trail.points.findIndex(point => pavement?.points.includes(point));
  return junction < 0 ? trail.points : trail.points.slice(0, junction + 1);
}

export const MOUNTAIN_SPIRAL_TRAIL = 'downtown-bleatsville--mt-gigga';
export const MOUNTAIN_SPIRAL_BRIDGE_PREFIX = 'bridge-' + MOUNTAIN_SPIRAL_TRAIL + '-';

/** Sloped decks on the coastal and mountain grades share a cross section at each seam. */
export function makeGradedBridgeColliders(island: IslandData): Map<string, PropColliderDescriptor> {
  const roads = island.roads.filter(road => road.id === MOUNTAIN_SPIRAL_TRAIL ||
    road.to === 'old-lighthouse' || road.from === 'old-lighthouse');
  const colliders = new Map<string, PropColliderDescriptor>();
  const thickness = 0.7 * island.size / 600;
  for (const road of roads) {
    const width = road.width + 1;
    const sides = road.points.map((_, i) => roadSideOffset(road, i, width / 2));
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i]!, b = road.points[i + 1]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if ((!a.bridge && !b.bridge) || length < 0.05) continue;
      const position = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
      const vertices: number[] = [];
      for (const end of [i, i + 1]) {
        const point = road.points[end]!, side = sides[end]!;
        const top = point.y + 0.19 - position.y; // Match the graded trail surface.
        for (const sign of [-1, 1]) {
          const x = point.x + sign * side.x - position.x;
          const z = point.z + sign * side.z - position.z;
          vertices.push(x, top, z, x, top - thickness, z);
        }
      }
      const id = 'bridge-' + road.id + '-' + i;
      colliders.set(id, {
        id, shape: 'convex', body: { type: 'static' }, transform: { position, rotationY: 0 },
        size: { x: width, y: thickness + Math.abs(b.y - a.y), z: length },
        vertices: new Float32Array(vertices),
      });
    }
  }
  return colliders;
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
