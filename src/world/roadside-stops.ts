import { gridSample, segmentProjection } from './terrain';
import type { IslandData, PropDescriptor, PropKind, Vec2 } from './types';

interface StopProp {
  name: string;
  kind: PropKind;
  along: number;
  across: number;
  width: number;
  height: number;
  depth: number;
  yaw?: number;
  mass?: number;
  breakable?: boolean;
  shape?: PropDescriptor['shape'];
}

interface StopPlan {
  id: string;
  road: string;
  near: Vec2;
  side: -1 | 1;
  props: StopProp[];
}

interface SignedStopPlan extends StopPlan {
  title: string;
  sign: string;
  gravel: number;
}

const SIGN = { name: 'sign', kind: 'sign', along: -4.8, across: 6.5,
  width: 3, height: 2.35, depth: .5 } as const;
const STOPS: SignedStopPlan[] = [
  {
    id: 'meadow-picnic', title: 'MEADOW PICNIC', road: 'hoofington--baa-ardwalk',
    near: { x: -68, z: 209 }, side: -1, sign: '#355b39', gravel: 0xc3a574,
    props: [
      { name: 'low-oak', kind: 'tree-oak', along: -7.8, across: 16.2, width: 6.8, height: 7.6, depth: 6.4, shape: 'cylinder' },
      { name: 'high-oak', kind: 'tree-oak', along: -5.2, across: 24, width: 7.2, height: 9.5, depth: 6.8, shape: 'cylinder', yaw: .65 },
      { name: 'bench', kind: 'bench', along: -4.25, across: 18.7, width: 2.6, height: 1, depth: .85, yaw: Math.PI / 2 },
      { name: 'picnic-log', kind: 'log', along: 4.2, across: 21, width: 3.5, height: .9, depth: .95, yaw: -.28 },
      { name: 'wagon-bale', kind: 'hay-bale', along: 4.2, across: 16.6, width: 1.65, height: 1.55, depth: 1.65, mass: 15, yaw: -.55, shape: 'cylinder' },
      { name: 'supply-crate', kind: 'crate', along: 6.6, across: 17.9, width: 1, height: 1.05, depth: 1, mass: 9, yaw: .35 },
      { name: 'gravel-stone', kind: 'rock', along: 7.2, across: 12.4, width: 1.65, height: .78, depth: 1.9, shape: 'convex', yaw: .4 },
    ],
  },
  {
    id: 'yard-layby', title: 'YARD LAY-BY', road: 'downtown-bleatsville--the-dam',
    near: { x: 211, z: 24 }, side: 1, sign: '#8a4a31', gravel: 0xbcae91,
    props: [
      { name: 'runup-ramp', kind: 'ramp', along: 1.8, across: 18.7, width: 2.7, height: 1, depth: 4, yaw: -Math.PI / 2 },
      { name: 'stack-crate', kind: 'crate', along: 4.9, across: 18.8, width: 1.35, height: 1.3, depth: 1.35, mass: 12, yaw: .12 },
      { name: 'spare-crate', kind: 'crate', along: 7.25, across: 19.4, width: 1.1, height: 1.1, depth: 1.1, mass: 10, yaw: -.18 },
      { name: 'stock-barrel', kind: 'barrel', along: 6.3, across: 16.4, width: 1.15, height: 1.55, depth: 1.15, mass: 13, shape: 'cylinder' },
      { name: 'cable-spool', kind: 'cable-spool', along: -6.1, across: 19.2, width: 2.7, height: 2.15, depth: 2.7, shape: 'cylinder' },
      { name: 'red-barrier', kind: 'site-barrier', along: 6.5, across: 23.6, width: 3.8, height: 1.1, depth: .7, yaw: .22 },
      { name: 'safety-light', kind: 'floodlight', along: -7.4, across: 23.4, width: 1.75, height: 5.7, depth: 1.6 },
      { name: 'back-rock', kind: 'rock', along: -2.7, across: 24, width: 3, height: 1.4, depth: 2.65, shape: 'convex', yaw: .45 },
    ],
  },
  {
    id: 'bay-overlook', title: 'BAY OVERLOOK', road: 'downtown-bleatsville--the-dam',
    near: { x: 124, z: -126 }, side: 1, sign: '#31576b', gravel: 0xbda579,
    props: [
      { name: 'wind-pine', kind: 'tree-pine', along: 6.8, across: 21.5, width: 4.3, height: 9.9, depth: 4.2, shape: 'cylinder' },
      { name: 'back-pine', kind: 'tree-pine', along: 5.8, across: 27.6, width: 4.7, height: 12.4, depth: 4.7, shape: 'cylinder', yaw: .55 },
      { name: 'sitting-bench', kind: 'bench', along: -3.4, across: 18.8, width: 2.7, height: 1, depth: .92, yaw: -Math.PI / 2 },
      { name: 'step-rock', kind: 'rock', along: 3.9, across: 20, width: 2.5, height: 1.15, depth: 2.5, shape: 'convex', yaw: .35 },
      { name: 'view-rock', kind: 'rock', along: 1.2, across: 24.8, width: 4.15, height: 2.9, depth: 3.8, shape: 'convex', yaw: .58 },
      { name: 'bay-marker', kind: 'flag', along: -5.8, across: 24.8, width: 1.35, height: 5.1, depth: 1.1, yaw: -.3 },
      { name: 'weathered-barrel', kind: 'barrel', along: -5.2, across: 16.4, width: 1.15, height: 1.35, depth: 1.15, mass: 12, shape: 'cylinder' },
    ],
  },
];

const COAST_TURNOUT: StopPlan = {
  id: 'coast-turnout', road: 'baa-ardwalk--downtown-bleatsville',
  near: { x: 95.565, z: 211.5 }, side: 1,
  props: [
    { name: 'bench', kind: 'bench', along: -2.65, across: 6.15,
      width: 2.05, height: .92, depth: .78, yaw: Math.PI / 2 },
    { name: 'gnome', kind: 'gnome', along: 2.1, across: 6.8,
      width: .65, height: .9, depth: .68, mass: 7, yaw: .2, breakable: false },
  ],
};

export interface RoadsideStop<Plan extends StopPlan = SignedStopPlan> {
  plan: Plan;
  origin: Vec2;
  tangent: Vec2;
  normal: Vec2;
  scale: number;
}

function pointAt(site: RoadsideStop<StopPlan>, along: number, across: number): Vec2 {
  const { origin, tangent, normal, scale } = site;
  return {
    x: origin.x + (tangent.x * along + normal.x * across) * scale,
    z: origin.z + (tangent.z * along + normal.z * across) * scale,
  };
}

function frame<Plan extends StopPlan>(plan: Plan, origin: Vec2, yaw: number, scale: number): RoadsideStop<Plan> {
  const tangent = { x: Math.sin(yaw), z: Math.cos(yaw) };
  return { plan, origin, tangent, normal: { x: -tangent.z * plan.side, z: tangent.x * plan.side }, scale };
}

function propId(plan: StopPlan, name: string): string {
  return 'roadside-' + plan.id + '-' + name;
}

function makeProp(island: IslandData, site: RoadsideStop<StopPlan>, prop: StopProp): PropDescriptor {
  const { scale } = site;
  const point = pointAt(site, prop.along, prop.across);
  const size = { x: prop.width * scale, y: prop.height * scale, z: prop.depth * scale };
  return {
    id: propId(site.plan, prop.name), kind: prop.kind, size,
    transform: { position: { ...point, y: gridSample(island, point.x, point.z) + size.y / 2 },
      rotationY: Math.atan2(site.tangent.x, site.tangent.z) + (prop.yaw ?? 0) },
    shape: prop.shape ?? 'cuboid',
    body: prop.mass === undefined ? { type: 'static' } : { type: 'dynamic', mass: prop.mass },
    collidable: true, breakable: prop.breakable ?? (prop.mass !== undefined),
    lickable: prop.kind !== 'flag' && prop.kind !== 'sign',
    climbable: prop.kind === 'ramp' || prop.kind === 'log' || prop.kind === 'rock',
  };
}

function radius(p: PropDescriptor): number {
  return Math.hypot(p.size.x, p.size.z) / 2;
}

function propClearance(p: PropDescriptor, point: Vec2): number {
  const { position, rotationY } = p.transform;
  const dx = point.x - position.x, dz = point.z - position.z;
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  return Math.hypot(Math.max(0, Math.abs(c * dx - s * dz) - p.size.x / 2),
    Math.max(0, Math.abs(s * dx + c * dz) - p.size.z / 2));
}

function terrainClear(island: IslandData, site: RoadsideStop<StopPlan>, nearby: PropDescriptor[], end: number): boolean {
  const { scale } = site;
  for (let across = 4; across <= end; across++) {
    const prev = pointAt(site, 0, across - 1);
    const current = pointAt(site, 0, across);
    const ground = gridSample(island, current.x, current.z);
    if (ground < scale * 1.6 || Math.abs(ground - gridSample(island, prev.x, prev.z)) > .38 * scale) return false;
    if (nearby.some(p => p.collidable && propClearance(p, current) < 1.05 * scale)) return false;
  }
  return true;
}

function seatCoastBench(island: IslandData, site: RoadsideStop<StopPlan>, bench: PropDescriptor): void {
  const { along, across, width, depth } = COAST_TURNOUT.props[0]!;
  const corners = [-.5, .5].flatMap(u => [-.5, .5].map(v => {
    const p = pointAt(site, along + u * width, across + v * depth);
    return gridSample(island, p.x, p.z);
  }));
  bench.transform.position.y = Math.min(...corners) + bench.size.y / 2 - .02 * site.scale;
}

function propsClear(island: IslandData, props: PropDescriptor[], nearby: PropDescriptor[], scale: number): boolean {
  const margin = .55 * scale;
  return props.every(prop => {
    const p = prop.transform.position;
    const reach = radius(prop);
    if (p.y - prop.size.y / 2 < 1.6 * scale || island.pois.some(site =>
      Math.hypot(site.center.x - p.x, site.center.z - p.z) < site.radius + reach + margin)) return false;
    if (island.roads.some(road => road.points.slice(1).some((b, i) =>
      segmentProjection(p, road.points[i]!, b).distance < road.width / 2 + reach + margin))) return false;
    return nearby.every(other => propClearance(other, p) > reach + margin);
  });
}

/** Append authored scenery after all seeded generation so existing object IDs, heights and roads stay exact. */
export function makeRoadsideProps(island: IslandData): PropDescriptor[] {
  const scale = island.size / 600;
  const result: PropDescriptor[] = [];
  for (const plan of [...STOPS, COAST_TURNOUT]) {
    const road = island.roads.find(r => r.id === plan.road);
    if (!road) continue;
    const signed = 'sign' in plan;
    const target = { x: plan.near.x * scale, z: plan.near.z * scale };
    const candidates = road.points.flatMap((origin, i) => {
      const distance = Math.hypot(origin.x - target.x, origin.z - target.z);
      if (i === 0 || i === road.points.length - 1 || distance > (signed ? 47 : 12) * scale || origin.bridge) return [];
      const a = road.points[i - 1]!, b = road.points[i + 1]!;
      return [{ distance, site: frame(plan, origin, Math.atan2(b.x - a.x, b.z - a.z), scale) }];
    }).sort((a, b) => a.distance - b.distance);

    for (const { site } of candidates) {
      const props = (signed ? [SIGN, ...plan.props] : plan.props).map(prop => makeProp(island, site, prop));
      if (!signed) seatCoastBench(island, site, props[0]!);
      const nearby = island.props.filter(prop => Math.hypot(site.origin.x - prop.transform.position.x,
        site.origin.z - prop.transform.position.z) < 34 * scale + radius(prop));
      if (!terrainClear(island, site, nearby, signed ? 23 : 7) || !propsClear(island, props, nearby, scale)) continue;
      result.push(...props);
      break;
    }
  }
  return result;
}

/** Recover the selected footprints from the same sign props that players see. */
export function roadsideStops(island: IslandData): RoadsideStop[] {
  const scale = island.size / 600;
  return STOPS.flatMap(plan => {
    const sign = island.props.find(p => p.id === propId(plan, SIGN.name));
    if (!sign) return [];
    const site = frame(plan, sign.transform.position, sign.transform.rotationY, scale);
    site.origin = pointAt(site, -SIGN.along, -SIGN.across);
    return [site];
  });
}

export const ROADSIDE_GRAVEL = {
  laneHalfWidth: 1.9, laneStart: 3.6, laneEnd: 15,
  padAlongRadius: 8.6, padAcrossCentre: 16.5, padAcrossRadius: 7.9,
} as const;

export function roadsideGravelAt(sites: RoadsideStop[], x: number, z: number): boolean {
  return sites.some(site => {
    const dx = (x - site.origin.x) / site.scale, dz = (z - site.origin.z) / site.scale;
    const s = dx * site.tangent.x + dz * site.tangent.z;
    const d = dx * site.normal.x + dz * site.normal.z;
    const { laneHalfWidth, laneStart, laneEnd, padAlongRadius, padAcrossCentre, padAcrossRadius } = ROADSIDE_GRAVEL;
    return (Math.abs(s) <= laneHalfWidth && d >= laneStart && d <= laneEnd) ||
      Math.hypot(s / padAlongRadius, (d - padAcrossCentre) / padAcrossRadius) <= 1;
  });
}
