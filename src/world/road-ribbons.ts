import * as THREE from 'three';
import type { IslandData, PropColliderDescriptor, RoadDescriptor, RoadPoint } from './types';
import { DAM_EAST_ROAD, DAM_MOUNTAIN_TRAIL, DAM_PINES_BRIDGE_PREFIX, DAM_PINES_ROAD,
  damMountainTrailDirt, makeLocalStreets, MOUNTAIN_SPIRAL_TRAIL } from './roads';
import { addSummitJunction } from './summit-junction';
import { exposeRoadBed, gridSample, terrainFaceHeight } from './terrain';

const SURFACE_LIFT = { road: .2, trail: .19 } as const;
const PAVED_DECK_THICKNESS = .7;
const PAVED_DECK_CLEARANCE = .07;

/** Cut only dry sections where a terrain triangle breaks through the finished pavement. */
export function uncoverPavedLanes(island: IslandData): void {
  const scale = island.size / 600;
  island.localStreets = makeLocalStreets(island);
  const vegetation = new Set(['rock', 'bush', 'flower', 'grass-tuft', 'tree-pine', 'tree-oak',
    'palm-tree', 'mushroom', 'fern', 'sign']);
  const grounded = island.props.flatMap(prop => {
    const position = prop.transform.position;
    const ground = gridSample(island, position.x, position.z);
    const seated = prop.body.type === 'static' && Math.abs(position.y - prop.size.y / 2 - ground) < .12 * scale;
    return seated || vegetation.has(prop.kind) || prop.id.startsWith('downtown-square-') ||
      prop.id.startsWith('downtown-market-') ? [{ position, ground }] : [];
  });
  for (const road of roadRibbonRuns(island,'road')) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i-1]!, b = road.points[i]!;
      if (a.bridge || b.bridge) continue;
      const dx = b.x-a.x, dz = b.z-a.z, length = Math.hypot(dx,dz);
      if (length < .01) continue;
      const width = Math.max(road.widths?.[i-1] ?? road.width,road.widths?.[i] ?? road.width);
      const steps = Math.ceil(length / (1.2 * scale));
      let buried = false;
      for (let step = 0; step <= steps && !buried; step++) {
        const t = step/steps, cx = a.x+dx*t, cz = a.z+dz*t;
        const grade = a.y+(b.y-a.y)*t+SURFACE_LIFT.road;
        for (const portion of [-.47,-.25,0,.25,.47]) {
          const offset = portion*width/length;
          if (terrainFaceHeight(island,cx-dz*offset,cz+dx*offset) > grade-.045) {
            buried = true;
            break;
          }
        }
      }
      if (buried) exposeRoadBed(island,[a,b],width);
    }
  }
  for (const { position, ground } of grounded) {
    position.y += gridSample(island,position.x,position.z)-ground;
  }
}
export const SUMMIT_JOIN_SEGMENTS = 8;
export const SUMMIT_ASCENT_TRAIL = 'mt-gigga--hoofington';

/**
 * The POI road network and the authored Downtown high street both terminate
 * at the same city centre. Rendering every inter-POI endpoint over the local
 * street produces fanned, vertically tilted road planks in the shop corridor.
 *
 * Keep only the continuous local street in the plot. The underlying terrain
 * and road graph remain unchanged.
 */
export function isDowntownRoadOverlay(
  island: IslandData, roadId: string,
  a: { x: number; z: number }, b: { x: number; z: number },
): boolean {
  if (!roadId.includes('--')) return false;
  const centre = island.pois.find(p => p.id === 'downtown-bleatsville')?.center;
  if (!centre) return false;
  const scale = island.size / 600;
  const x = (a.x + b.x) / 2 - centre.x;
  const z = (a.z + b.z) / 2 - centre.z;
  return Math.abs(x) < 21 * scale && Math.abs(z) < 42 * scale;
}

/**
 * Trail boxes are drawn after asphalt and can cover Hoofington's through-street.
 * Exclude the overlapping trail ribbons and their support triangles within
 * the carriageway margin.
 */
export function isHoofingtonTrailOverlay(
  island: IslandData, trailWidth: number,
  a: { x: number; z: number }, b: { x: number; z: number },
): boolean {
  const farm = island.pois.find(p => p.id === 'hoofington')?.center;
  if (!farm) return false;
  const scale = island.size / 600;
  const halfX = 3.4 * scale + trailWidth / 2 + 0.2;
  const halfZ = 42 * scale + trailWidth / 2 + 0.2;
  return Math.max(a.x, b.x) > farm.x - halfX &&
    Math.min(a.x, b.x) < farm.x + halfX &&
    Math.max(a.z, b.z) > farm.z - halfZ &&
    Math.min(a.z, b.z) < farm.z + halfZ;
}

interface RoadRibbonRun {
  id: string;
  points: RoadPoint[];
  carriageway?: { points: RoadPoint[]; widths?: number[] };
  width: number;
  widths?: number[];
  squareNorthStart?: boolean;
  squareSouthEnd?: boolean;
}
interface RibbonSegment {
  a: RoadPoint;
  b: RoadPoint;
  tangent: THREE.Vector3;
}

/** Join Hoofington's two regional roads and village street into one surface. */
function hoofingtonThroughStreet(allRoads: readonly RoadDescriptor[], scale: number):
  { run: RoadRibbonRun; replaced: ReadonlySet<string> } | null {
  const street = allRoads.find(road => road.id === 'hoofington-main-street');
  const north = allRoads.find(road => road.id === 'whispering-pines--hoofington');
  const south = allRoads.find(road => road.id === 'hoofington--baa-ardwalk');
  if (!street || !north || !south) return null;
  const northEnd = street.points[0]!, southEnd = street.points.at(-1)!;
  const fromFarm = [...north.points].reverse().findIndex(point => point.z <= northEnd.z - 3 * scale);
  const northIndex = north.points.length - 1 - fromFarm;
  const southIndex = south.points.findIndex(point => point.z >= southEnd.z + 3 * scale);
  if (fromFarm < 0 || southIndex < 0) return null;

  const points: RoadPoint[] = [];
  const widths: number[] = [];
  const streetWidth = street.width;
  function append(roadPoints: readonly RoadPoint[], width: number): void {
    for (const point of roadPoints) {
      points.push(point);
      widths.push(width);
    }
  }
  function taper(edge: RoadPoint, anchor: RoadPoint, width: number, inward: boolean): void {
    for (const t of inward ? [.75, .50, .25] : [.25, .50, .75]) {
      const eased = t * t * (3 - 2 * t);
      points.push({
        x: THREE.MathUtils.lerp(edge.x, anchor.x, eased),
        y: THREE.MathUtils.lerp(edge.y, anchor.y, t),
        z: THREE.MathUtils.lerp(edge.z, anchor.z, t),
        bridge: false,
      });
      widths.push(THREE.MathUtils.lerp(streetWidth, width, eased));
    }
  }
  append(north.points.slice(0, northIndex + 1), north.width);
  taper(northEnd, north.points[northIndex]!, north.width, true);
  append(street.points, street.width);
  taper(southEnd, south.points[southIndex]!, south.width, false);
  append(south.points.slice(southIndex), south.width);
  return { run: { id: street.id, points, width: street.width, widths }, replaced: new Set([street.id, north.id, south.id]) };
}

/**
 * Seat both northern approaches against the same pavement cap. Preserve their
 * full widths away from the junction and taper only the overlapping ends.
 */
function downtownNorthApproach(road: RoadDescriptor, points: readonly RoadPoint[],
  street: RoadDescriptor | undefined, scale: number): { point: RoadPoint; width: number; rest: number } | null {
  const edge = street?.points[0];
  const inner = street?.points[1];
  if (!street || !edge || !inner || inner.z <= edge.z) return null;
  const rest = points.findIndex(point => point.z < edge.z);
  if (rest <= 0) return null;
  const inside = points[rest - 1]!, outside = points[rest]!;
  if (inside.bridge || outside.bridge) return null;

  const z = edge.z + .04 * scale;
  const factor = (z - outside.z) / (inside.z - outside.z);
  const x = THREE.MathUtils.lerp(outside.x, inside.x, factor);
  const pavementHalfWidth = street.width / 2;
  const left = Math.max(edge.x - pavementHalfWidth, x - road.width / 2);
  const right = Math.min(edge.x + pavementHalfWidth, x + road.width / 2);
  if (right - left < road.width * .35) return null;

  const streetY = THREE.MathUtils.lerp(edge.y, inner.y, (z - edge.z) / (inner.z - edge.z));
  const y = streetY + SURFACE_LIFT.road - SURFACE_LIFT[road.type] - .02 * scale;
  return { point: { x: (left + right) / 2, y, z, bridge: false }, width: right - left, rest };
}

export function roadRibbonRuns(island: IslandData, type: RoadDescriptor['type']): RoadRibbonRun[] {
  const regional = island.roads.map(road => island.damCarriageways?.find(lane => lane.id === road.id) ?? road);
  const allRoads = [...regional, ...makeLocalStreets(island)];
  const runs: RoadRibbonRun[] = [];
  const scale = island.size / 600;
  const downtown = allRoads.find(road => road.id === 'downtown-bleatsville-main-street');
  const throughStreet = type === 'road' ? hoofingtonThroughStreet(allRoads, scale) : null;
  if (throughStreet) runs.push(throughStreet.run);
  // The two raised causeway approaches meet at the same Dam junction.
  // A shared mitre covers the little wedge left by their separate end caps.
  const damEast = type === 'road' ? allRoads.find(road => road.id === DAM_EAST_ROAD) : undefined;
  const damWest = type === 'road' ? allRoads.find(road => road.id === DAM_PINES_ROAD) : undefined;
  const damEntry = damEast?.points.at(-1), damExit = damWest?.points[0];
  const joinedDamRoad = damEast && damWest && damEast.width === damWest.width && damEntry && damExit &&
    damEntry.x === damExit.x && damEntry.y === damExit.y && damEntry.z === damExit.z &&
    !damEntry.bridge && !damExit.bridge
    ? [...damEast.points, ...damWest.points.slice(1)] : null;
  for (const road of allRoads) {
    if (road.type !== type || throughStreet?.replaced.has(road.id)) continue;
    if (joinedDamRoad && road === damWest) continue;
    const original = road.id === DAM_MOUNTAIN_TRAIL ? damMountainTrailDirt(island, road) :
      joinedDamRoad && road === damEast ? joinedDamRoad : road.points;
    const approach = road.id === MOUNTAIN_SPIRAL_TRAIL || road.id === DAM_EAST_ROAD ?
      downtownNorthApproach(road, original, downtown, scale) : null;
    let points = approach ? [approach.point, ...original.slice(approach.rest)] : original;
    if (road.type === 'road' && approach && downtown) {
      const x = downtown.points[0]!.x, z = approach.point.z;
      approach.point.x = x;
      approach.width = Math.min(road.width, downtown.width);
      points = points.map(p => {
        if (p === approach.point || z-p.z >= 14*scale || p.bridge) return p;
        const t = Math.min(1, Math.max(0,(z-p.z)/(14*scale)));
        return {...p, x:x+(p.x-x)*t*t*(3-2*t)};
      });
    }
    // The pier approach used to end half a lane east of the southern street
    // cap, leaving turf between the two decks. Give both lanes a flush seam.
    const southCap = road.id === 'baa-ardwalk--downtown-bleatsville' ? downtown?.points.at(-1) : undefined;
    if (southCap) {
      const back = [...points].reverse().findIndex(p => p.z > southCap.z + 6 * scale);
      if (back > 0) points = [...points.slice(0, points.length - back), southCap];
    }
    let kept: RoadPoint[] = [];
    const finish = () => {
      if (kept.length < 2) return;
      if (approach && kept[0] === approach.point) {
        runs.push({ id: road.id, points: kept, width: road.width, squareNorthStart: true,
          widths: kept.map((_, i) => i === 0 ? approach.width : road.width) });
      } else runs.push({ id: road.id, points: kept, width: road.width,
        squareSouthEnd: !!southCap && kept.at(-1) === southCap });
    };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      const hidden = isDowntownRoadOverlay(island, road.id, a, b) ||
        (type === 'trail' && isHoofingtonTrailOverlay(island, road.width, a, b));
      if (hidden) {
        finish();
        kept = [];
      } else {
        if (kept.length === 0) kept.push(a);
        kept.push(b);
      }
    }
    finish();
  }
  for (const run of runs) {
    if (!run.points.some(p => p.stairApron)) continue;
    // Share an uninterrupted asphalt surface with the marked pedestrian fork.
    // The through lanes occupy the landward strip and stop short of the stair rails.
    run.carriageway = { points: run.points, widths: run.widths };
    run.widths = run.points.map((p, i) => (run.widths?.[i] ?? run.width) + (p.stairApron ?? 0));
    run.points = run.points.map(p => p.stairApron ? { ...p, z: p.z + p.stairApron / 2 } : p);
  }
  return runs;
}

/** Read the top of the shared road mesh without using a renderer or road skirts. */
function pavementAt(positions: readonly number[], faces: readonly number[], x: number, z: number): number {
  let height = -Infinity;
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i]! * 3, b = faces[i + 1]! * 3, c = faces[i + 2]! * 3;
    const x0 = positions[a]! - positions[c]!, z0 = positions[a + 2]! - positions[c + 2]!;
    const x1 = positions[b]! - positions[c]!, z1 = positions[b + 2]! - positions[c + 2]!;
    const dx = x - positions[c]!, dz = z - positions[c + 2]!;
    const area = x0 * z1 - x1 * z0;
    if (Math.abs(area) < 1e-8) continue;
    const u = (dx * z1 - x1 * dz) / area, v = (x0 * dz - dx * z0) / area;
    const w = 1 - u - v;
    if (Math.min(u, v, w) < -1e-7) continue;
    height = Math.max(height, positions[a + 1]! * u + positions[b + 1]! * v + positions[c + 1]! * w);
  }
  return height;
}

/** Extend only existing side panels; their top edge and road support stay put. */
function fitSummitEarth(
  points: readonly RoadPoint[], positions: number[], first: number, scale: number,
  ground: (x: number, z: number) => number,
): void {
  for (let i = 1; i < points.length; i++) {
    // Leave the whole bridge opening and its adjoining abutment panels alone.
    if (points[i - 2]?.bridge || points[i - 1]!.bridge || points[i]!.bridge || points[i + 1]?.bridge) continue;
    for (const side of [4, 5]) {
      const a = (first + (i - 1) * 6 + side) * 3, b = a + 18;
      const x = positions[a]!, z = positions[a + 2]!;
      const dx = positions[b]! - x, dz = positions[b + 2]! - z;
      const steps = Math.max(2, Math.ceil(Math.hypot(dx, dz) / (.30 * scale)));
      let toe = Infinity;
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const floor = ground(x + dx * t, z + dz * t);
        if (Number.isFinite(floor)) toe = Math.min(toe, floor - .12 * scale);
      }
      positions[a + 1] = Math.min(positions[a + 1]!, toe);
      positions[b + 1] = Math.min(positions[b + 1]!, toe);
    }
  }
}

/** Solid deck under the exact asphalt surface, including its two shoulders. */
function pavedBridgeDeck(id: string, p: RoadPoint, q: RoadPoint, width: number,
  positions: readonly number[], corners: readonly number[], scale: number): PropColliderDescriptor {
  const position = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: (p.z + q.z) / 2 };
  const dx = q.x - p.x, dz = q.z - p.z;
  const rise = (q.y - p.y) / (dx * dx + dz * dz);
  const ring = corners.map(vertex => {
    const at = vertex * 3;
    const x = positions[at]! - position.x;
    const z = positions[at + 2]! - position.z;
    return { x, z, grade: (x * dx + z * dz) * rise, asphalt: positions[at + 1]! - position.y };
  });
  // Both rendered triangles stay above this plane, even through a skewed
  // miter. The physical road uses the exact visible triangles over this slab.
  const ceiling = Math.min(...ring.map(corner => corner.asphalt - corner.grade)) - PAVED_DECK_CLEARANCE * scale;
  const thickness = PAVED_DECK_THICKNESS * scale;
  const vertices = new Float32Array(ring.flatMap(({ x, grade, z }) =>
    [x, grade + ceiling, z, x, grade + ceiling - thickness, z]));
  return {
    id, shape: 'convex', body: { type: 'static' }, transform: { position, rotationY: 0 },
    size: { x: width, y: thickness + Math.abs(q.y - p.y), z: Math.hypot(dx, dz) },
    vertices,
  };
}

/**
 * Every kept polyline run gets one joined strip, but all runs of a surface
 * type share a single indexed geometry. A point has two top vertices and
 * separate skirt vertices so side normals cannot tilt the asphalt normals.
 */
export function roadRibbonData(island: IslandData, type: RoadDescriptor['type'],
  summitGround?: (x: number, z: number) => number): {
  positions: number[]; indices: number[]; supportIndices: number[]; segments: RibbonSegment[];
  crossSections: number[]; pavedBridgeDecks: PropColliderDescriptor[]; skirtVertices: number[];
} {
  const runs = roadRibbonRuns(island, type);
  // A pair of flat caps at an angled district boundary leaves an unpaved wedge in the outside lane.
  const seamTangents = new Map<RoadPoint, THREE.Vector2>();
  if (type === 'road') for (const [before, after] of [
    ['hoofington-main-street','baa-ardwalk--downtown-bleatsville'],
    [DAM_EAST_ROAD,'hoofington-main-street'],
  ]) {
    const a = runs.find(r=>r.id===before)?.points, b = runs.find(r=>r.id===after)?.points;
    if (!a || !b) continue;
    const end=a.at(-1)!, start=b[0]!;
    if (Math.hypot(end.x-start.x,end.z-start.z)>1e-4) continue;
    const prev=a.at(-2)!, next=b[1]!;
    const tangent=new THREE.Vector2(end.x-prev.x,end.z-prev.z).normalize()
      .add(new THREE.Vector2(next.x-start.x,next.z-start.z).normalize()).normalize();
    seamTangents.set(end,tangent);seamTangents.set(start,tangent);
  }
  const topOffset = SURFACE_LIFT[type];
  const positions: number[] = [];
  const indices: number[] = [];
  const supportIndices: number[] = [];
  const segments: RibbonSegment[] = [];
  const crossSections: number[] = [];
  const skirtVertices: number[] = [];
  const scale = island.size / 600;
  const pavedBridgeDecks: PropColliderDescriptor[] = [];
  const bridgePoints = new Set<RoadPoint>();
  const bridgeSpans = new Map<RoadPoint, { end: RoadPoint; index: number }>();
  const bridgeRoad = type === 'road' ? island.roads.find(road => road.id === DAM_PINES_ROAD) : undefined;
  if (bridgeRoad) for (let index = 0; index < bridgeRoad.points.length - 1; index++) {
    const p = bridgeRoad.points[index]!, q = bridgeRoad.points[index + 1]!;
    if (!(p.bridge || q.bridge) || Math.hypot(q.x - p.x, q.z - p.z) < .05) continue;
    bridgePoints.add(p);
    bridgePoints.add(q);
    bridgeSpans.set(p, { end: q, index });
  }
  const damTrail = type === 'trail' ? island.roads.find(road => road.id === DAM_MOUNTAIN_TRAIL) : undefined;
  const damTrailEnd = damTrail ? damMountainTrailDirt(island, damTrail).at(-1) : undefined;
  const pavement = damTrailEnd ? roadRibbonData(island, 'road') : undefined;
  const summitStart = summitGround && type === 'trail'
    ? island.roads.find(road => road.id === SUMMIT_ASCENT_TRAIL)?.points[0] : undefined;
  const summit = type === 'trail' ? island.pois.find(p => p.id === 'mt-gigga')?.center : undefined;
  const joinSegments = SUMMIT_JOIN_SEGMENTS;
  const summitSide = new Map<RoadRibbonRun, 'start' | 'end'>();
  if (summit) for (const run of runs) {
    const near = (p: RoadPoint) => Math.hypot(p.x - summit.x, p.z - summit.z) < 1e-5;
    if (run.points.length > joinSegments + 1 && near(run.points[0]!)) summitSide.set(run, 'start');
    else if (run.points.length > joinSegments + 1 && near(run.points.at(-1)!)) summitSide.set(run, 'end');
  }
  // Oversized worlds can have grade-separated switchback crossings here.
  // Preserve those independent surfaces rather than flattening them together.
  if (summitSide.size !== 3 || island.size > 1200) summitSide.clear();
  const junctionFaces: number[] = [];
  const junctionCuts: [number, number][] = [];
  const junctionAnchors: { x: number; z: number }[] = [];

  for (const run of runs) {
    const { points, width, widths, squareNorthStart, squareSouthEnd } = run;
    const side = summitSide.get(run);
    const firstVertex = positions.length / 3;
    const directions = points.slice(1).map((b, i) => {
      const a = points[i]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      return length > 1e-6 ? new THREE.Vector2(dx / length, dz / length) :
        new THREE.Vector2(0, 0);
    });
    const tangents: THREE.Vector2[] = [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      const prev = directions[Math.max(0, i - 1)]!;
      const next = directions[Math.min(i, directions.length - 1)]!;
      // Coincident horizontal points and 180-degree turns must stay finite.
      const incoming = prev.lengthSq() > 1e-12 ? prev :
        next.lengthSq() > 1e-12 ? next : new THREE.Vector2(0, 1);
      const outgoing = next.lengthSq() > 1e-12 ? next : incoming;
      const tangent = incoming.clone().add(outgoing);
      if (tangent.lengthSq() < 1e-12) tangent.copy(outgoing);
      tangent.normalize();
      const seam = seamTangents.get(point);
      if (seam) tangent.copy(seam);
      const squareCap = (!!squareNorthStart && i === 0) || (!!squareSouthEnd && i === points.length - 1);
      if (squareCap) tangent.set(0, -1);
      tangents.push(tangent);

      const perp = new THREE.Vector2(-tangent.y, tangent.x);
      const perpIn = new THREE.Vector2(-incoming.y, incoming.x);
      const mitre = squareCap ? 1 : Math.min(2, 1 / Math.max(0.5, perpIn.dot(perp)));
      // Use the existing deck's half-metre shoulders along the bridge.
      const bridge = bridgePoints.has(point);
      const halfWidth = (widths?.[i] ?? width) / 2 + (bridge ? .5 : 0);
      const x = perp.x * halfWidth * mitre;
      const z = perp.y * halfWidth * mitre;
      const top = point.y + topOffset;
      const bottom = bridge ? top - (PAVED_DECK_THICKNESS + PAVED_DECK_CLEARANCE) * scale : point.y - .15;
      let leftTop = top, rightTop = top;
      // The flat trail cross section overlaps a sloping road here. Match the
      // terminal corners that land on asphalt and keep the outer trail grade.
      if (pavement && damTrailEnd && points.at(-1) === damTrailEnd &&
          Math.hypot(point.x - damTrailEnd.x, point.z - damTrailEnd.z) < 9 * scale) {
        leftTop = Math.min(top, pavementAt(pavement.positions, pavement.supportIndices,
          point.x + x, point.z + z) - .02);
        rightTop = Math.min(top, pavementAt(pavement.positions, pavement.supportIndices,
          point.x - x, point.z - z) - .02);
        if (!Number.isFinite(leftTop)) leftTop = top;
        if (!Number.isFinite(rightTop)) rightTop = top;
      }
      positions.push(
        point.x + x, leftTop, point.z + z,   // top left
        point.x - x, rightTop, point.z - z,  // top right
        point.x + x, leftTop, point.z + z,   // independent left skirt normal
        point.x - x, rightTop, point.z - z,  // independent right skirt normal
        point.x + x, bottom + (leftTop - top), point.z + z,
        point.x - x, bottom + (rightTop - top), point.z - z,
      );
      const base = positions.length / 3 - 6;
      skirtVertices.push(base + 2, base + 3, base + 4, base + 5);
      // Signed width coordinates are shared by the asphalt top and its skirts.
      if (type === 'road') crossSections.push(-1, halfWidth, 1, halfWidth,
        -1, halfWidth, 1, halfWidth, -1, halfWidth, 1, halfWidth);
    }
    if (summitGround && points[0] === summitStart) {
      fitSummitEarth(points, positions, firstVertex, island.size / 600, summitGround);
    }
    if (side) {
      // Keep the joined and unjoined edges identical while removing tiny
      // floating-point differences before the polygon sweep.
      const step = 1e-5 * scale;
      const start = side === 'start' ? 0 : points.length - 1 - joinSegments;
      for (let point = start; point <= start + joinSegments; point++) {
        for (let part = 0; part < 6; part++) {
          const vertex = (firstVertex + point * 6 + part) * 3;
          positions[vertex] = Math.round(positions[vertex]! / step) * step;
          positions[vertex + 2] = Math.round(positions[vertex + 2]! / step) * step;
        }
      }
    }

    for (let i = 0; i < points.length - 1; i++) {
      const a = firstVertex + i * 6, b = a + 6;
      // Two top triangles and one quad (two triangles) for each outside skirt.
      // Shared indexed vertices at b are reused as a in the next segment.
      const top = [a, b, a + 1, a + 1, b, b + 1];
      const joinsSummit = side === 'start' ? i < joinSegments :
        side === 'end' ? i >= points.length - 1 - joinSegments : false;
      if (joinsSummit) {
        junctionFaces.push(...top);
        const center = (first: number) => ({
          x: (positions[first * 3]! + positions[(first + 1) * 3]!) / 2,
          z: (positions[first * 3 + 2]! + positions[(first + 1) * 3 + 2]!) / 2,
        });
        const pa = center(a), pb = center(b);
        junctionAnchors.push(pa, { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 });
        if (side === 'start' && i === joinSegments - 1) junctionCuts.push([b, b + 1]);
        if (side === 'end' && i === points.length - 1 - joinSegments) junctionCuts.push([a, a + 1]);
      } else indices.push(
        ...top,
        a + 2, a + 4, b + 2, b + 2, a + 4, b + 4,
        a + 3, b + 3, a + 5, b + 3, b + 5, a + 5,
      );
      const p = points[i]!, q = points[i + 1]!;
      const pavedBridge = bridgeSpans.get(p);
      if (joinsSummit) {
        // The union below supplies both the visual top and walkable collider.
      } else if (pavedBridge?.end === q) {
        // Close the visible underside between the two side skirts.
        indices.push(a + 4, a + 5, b + 4, a + 5, b + 5, b + 4);
        supportIndices.push(...top);
        pavedBridgeDecks.push(pavedBridgeDeck(DAM_PINES_BRIDGE_PREFIX + pavedBridge.index,
          p, q, width + 1, positions, [a, b, a + 1, b + 1], scale));
      } else if (!p.bridge && !q.bridge) {
        // Trail bridges retain their original deck supports. Other road
        // skirts stay visual so they cannot block lateral entry from terrain.
        supportIndices.push(...top);
      }
      const tangent = tangents[i]!.clone().add(tangents[i + 1]!);
      if (tangent.lengthSq() < 1e-12) tangent.copy(directions[i]!);
      if (tangent.lengthSq() < 1e-12) tangent.set(0, 1);
      tangent.normalize();
      const horizontal = Math.hypot(q.x - p.x, q.z - p.z);
      segments.push({
        a: p, b: q,
        tangent: new THREE.Vector3(tangent.x,
          horizontal > 1e-6 ? (q.y - p.y) / horizontal : 0, tangent.y).normalize(),
      });
    }
  }
  if (junctionFaces.length) {
    const junctionHeight = (x: number, z: number): number => {
      const y = pavementAt(positions, junctionFaces, x, z);
      if (Number.isFinite(y)) return y;
      // Union vertices on a shared edge can differ by floating-point rounding.
      // Interpolate the nearest original edge if the triangle test misses it.
      let nearest = Infinity, result = summit!.y + topOffset;
      for (let i = 0; i < junctionFaces.length; i += 3) for (let edge = 0; edge < 3; edge++) {
        const a = junctionFaces[i + edge]! * 3, b = junctionFaces[i + (edge + 1) % 3]! * 3;
        const dx = positions[b]! - positions[a]!, dz = positions[b + 2]! - positions[a + 2]!;
        const length2 = dx * dx + dz * dz;
        const t = length2 ? THREE.MathUtils.clamp(((x - positions[a]!) * dx + (z - positions[a + 2]!) * dz) / length2, 0, 1) : 0;
        const distance2 = (x - positions[a]! - t * dx) ** 2 + (z - positions[a + 2]! - t * dz) ** 2;
        if (distance2 < nearest) { nearest = distance2; result = THREE.MathUtils.lerp(positions[a + 1]!, positions[b + 1]!, t); }
      }
      return result;
    };
    addSummitJunction(positions, indices, supportIndices, skirtVertices, junctionFaces, junctionCuts, junctionAnchors,
      junctionHeight, summitGround, scale);
  }
  return { positions, indices, supportIndices, segments, crossSections, pavedBridgeDecks, skirtVertices };
}
