import * as THREE from 'three';
import type { IslandData, RoadDescriptor, RoadPoint } from './types';
import { makeLocalStreets } from './roads';

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
  points: RoadPoint[];
  width: number;
  widths?: number[];
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
  return { run: { points, width: street.width, widths }, replaced: new Set([street.id, north.id, south.id]) };
}

export function roadRibbonRuns(island: IslandData, type: RoadDescriptor['type']): RoadRibbonRun[] {
  const allRoads = [...island.roads, ...makeLocalStreets(island)];
  const runs: RoadRibbonRun[] = [];
  const throughStreet = type === 'road' ? hoofingtonThroughStreet(allRoads, island.size / 600) : null;
  if (throughStreet) runs.push(throughStreet.run);
  // The two raised causeway approaches meet at the same Dam junction.
  // A shared mitre covers the little wedge left by their separate end caps.
  const damEast = type === 'road' ? allRoads.find(road => road.id === 'downtown-bleatsville--the-dam') : undefined;
  const damWest = type === 'road' ? allRoads.find(road => road.id === 'the-dam--whispering-pines') : undefined;
  const damEntry = damEast?.points.at(-1), damExit = damWest?.points[0];
  const joinedDamRoad = damEast && damWest && damEast.width === damWest.width && damEntry && damExit &&
    damEntry.x === damExit.x && damEntry.y === damExit.y && damEntry.z === damExit.z &&
    !damEntry.bridge && !damExit.bridge
    ? [...damEast.points, ...damWest.points.slice(1)] : null;
  for (const road of allRoads) {
    if (road.type !== type || throughStreet?.replaced.has(road.id)) continue;
    if (joinedDamRoad && road === damWest) continue;
    const points = joinedDamRoad && road === damEast ? joinedDamRoad : road.points;
    let kept: RoadPoint[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      const hidden = isDowntownRoadOverlay(island, road.id, a, b) ||
        (type === 'trail' && isHoofingtonTrailOverlay(island, road.width, a, b));
      if (hidden) {
        if (kept.length > 1) runs.push({ points: kept, width: road.width });
        kept = [];
      } else {
        if (kept.length === 0) kept.push(a);
        kept.push(b);
      }
    }
    if (kept.length > 1) runs.push({ points: kept, width: road.width });
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

/**
 * Every kept polyline run gets one joined strip, but all runs of a surface
 * type share a single indexed geometry. A point has two top vertices and
 * separate skirt vertices so side normals cannot tilt the asphalt normals.
 */
export function roadRibbonData(island: IslandData, type: RoadDescriptor['type']): {
  positions: number[]; indices: number[]; supportIndices: number[]; segments: RibbonSegment[];
  crossSections: number[];
} {
  const runs = roadRibbonRuns(island, type);
  const topOffset = type === 'road' ? 0.2 : 0.19;
  const positions: number[] = [];
  const indices: number[] = [];
  const supportIndices: number[] = [];
  const segments: RibbonSegment[] = [];
  const crossSections: number[] = [];
  const damTrailEnd = type === 'trail'
    ? island.roads.find(road => road.id === 'mt-gigga--the-dam')?.points.at(-1) : undefined;
  const pavement = damTrailEnd ? roadRibbonData(island, 'road') : undefined;

  for (const { points, width, widths } of runs) {
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
      tangents.push(tangent);

      const perp = new THREE.Vector2(-tangent.y, tangent.x);
      const perpIn = new THREE.Vector2(-incoming.y, incoming.x);
      const mitre = Math.min(2, 1 / Math.max(0.5, perpIn.dot(perp)));
      const halfWidth = (widths?.[i] ?? width) / 2;
      const x = perp.x * halfWidth * mitre;
      const z = perp.y * halfWidth * mitre;
      const top = point.y + topOffset, bottom = point.y - 0.15;
      let leftTop = top, rightTop = top;
      // The flat trail cross section overlaps a sloping road here. Match the
      // terminal corners that land on asphalt and keep the outer trail grade.
      if (pavement && points.at(-1) === damTrailEnd && i >= points.length - 2) {
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
      // Signed width coordinates are shared by the asphalt top and its skirts.
      if (type === 'road') crossSections.push(-1, halfWidth, 1, halfWidth,
        -1, halfWidth, 1, halfWidth, -1, halfWidth, 1, halfWidth);
    }

    for (let i = 0; i < points.length - 1; i++) {
      const a = firstVertex + i * 6, b = a + 6;
      // Two top triangles and one quad (two triangles) for each outside skirt.
      // Shared indexed vertices at b are reused as a in the next segment.
      const top = [a, b, a + 1, a + 1, b, b + 1];
      indices.push(
        ...top,
        a + 2, a + 4, b + 2, b + 2, a + 4, b + 4,
        a + 3, b + 3, a + 5, b + 3, b + 5, a + 5,
      );
      const p = points[i]!, q = points[i + 1]!;
      // Existing bridge decks have their own support. The visual skirts do
      // not block lateral entry from the underlying graded terrain.
      if (!p.bridge && !q.bridge) supportIndices.push(...top);
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
  return { positions, indices, supportIndices, segments, crossSections };
}
