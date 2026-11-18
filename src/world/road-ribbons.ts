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
}
interface RibbonSegment {
  a: RoadPoint;
  b: RoadPoint;
  tangent: THREE.Vector3;
}

/**
 * Every kept polyline run gets one joined strip, but all runs of a surface
 * type share a single indexed geometry. A point has two top vertices and
 * separate skirt vertices so side normals cannot tilt the asphalt normals.
 */
export function roadRibbonData(island: IslandData, type: RoadDescriptor['type']): {
  positions: number[]; indices: number[]; supportIndices: number[]; segments: RibbonSegment[];
} {
  const allRoads = [...island.roads, ...makeLocalStreets(island)];
  const runs: RoadRibbonRun[] = [];
  for (const road of allRoads) {
    if (road.type !== type) continue;
    let kept: RoadPoint[] = [];
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!;
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

  const topOffset = type === 'road' ? 0.2 : 0.19;
  const positions: number[] = [];
  const indices: number[] = [];
  const supportIndices: number[] = [];
  const segments: RibbonSegment[] = [];

  for (const { points, width } of runs) {
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
      const x = perp.x * width / 2 * mitre;
      const z = perp.y * width / 2 * mitre;
      const top = point.y + topOffset, bottom = point.y - 0.15;
      positions.push(
        point.x + x, top, point.z + z,   // top left
        point.x - x, top, point.z - z,   // top right
        point.x + x, top, point.z + z,   // independent left skirt normal
        point.x - x, top, point.z - z,   // independent right skirt normal
        point.x + x, bottom, point.z + z,
        point.x - x, bottom, point.z - z,
      );
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
  return { positions, indices, supportIndices, segments };
}
