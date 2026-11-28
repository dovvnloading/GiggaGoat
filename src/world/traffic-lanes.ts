import { BufferGeometry, Float32BufferAttribute } from 'three';
import { roadRibbonData, roadRibbonRuns } from './road-ribbons';
import { DAM_EAST_ROAD } from './roads';
import { meshSurfaceHeight } from './visual-tide-routes';
import { terrainFaceHeight } from './terrain';
import type { IslandData, Vec2, Vec3 } from './types';

type Knot = Vec3 & { width: number };
export interface DrivingPose extends Vec3 {
  yaw: number;
  pitch: number;
  curvature: number;
}
const wrap = (value: number, length: number) => ((value % length) + length) % length;
export const angleDelta = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Equal arc-length samples make speed, braking distance and wheel travel independent of road tessellation. */
function resample(points: readonly Knot[], spacing: number): { points: Knot[]; step: number } {
  const offsets = [0];
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    length += Math.hypot(b.x - a.x, b.z - a.z);
    offsets.push(length);
  }
  const count = Math.max(4, Math.round(length / spacing)),
    step = length / count;
  let segment = 0;
  const result: Knot[] = [];
  for (let i = 0; i < count; i++) {
    const s = i * step;
    while (segment + 1 < points.length && offsets[segment + 1]! <= s) segment++;
    const a = points[segment]!,
      b = points[(segment + 1) % points.length]!;
    const t = (s - offsets[segment]!) / Math.max(1e-8, offsets[segment + 1]! - offsets[segment]!);
    result.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      width: a.width + (b.width - a.width) * t,
    });
  }
  return { points: result, step };
}

export class TrafficLane {
  readonly length: number;
  constructor(
    readonly poses: readonly DrivingPose[],
    readonly step: number
  ) {
    this.length = poses.length * step;
  }
  sample(distance: number, out: DrivingPose): DrivingPose {
    const s = wrap(distance, this.length) / this.step;
    const i = Math.min(this.poses.length - 1, Math.floor(s)),
      t = s - i;
    const a = this.poses[i]!,
      b = this.poses[(i + 1) % this.poses.length]!;
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    out.yaw = a.yaw + angleDelta(b.yaw - a.yaw) * t;
    out.pitch = a.pitch + (b.pitch - a.pitch) * t;
    out.curvature = a.curvature + (b.curvature - a.curvature) * t;
    return out;
  }
  nearest(p: Vec2): number {
    let best = Infinity,
      index = 0;
    for (let i = 0; i < this.poses.length; i++) {
      const q = this.poses[i]!,
        d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < best) {
        best = d;
        index = i;
      }
    }
    return index * this.step;
  }
  ahead(from: number, to: number): number {
    return wrap(to - from, this.length);
  }
}

/** Both signed driving lanes follow the paved circuits shared by renderer and physics.
 * The construction gate, trails and pedestrian pier do not form through roads. */
export function islandTrafficLanes(island: IslandData): TrafficLane[] {
  const scale = island.size / 600;
  const roads = roadRibbonRuns(island, 'road');
  const ring: Knot[] = [];
  const ids = [
    'hoofington-main-street',
    'baa-ardwalk--downtown-bleatsville',
    'downtown-bleatsville-main-street',
    DAM_EAST_ROAD,
  ];
  const north = roads.find((run) => run.id === DAM_EAST_ROAD);
  for (const id of ids) {
    const road = roads.find((run) => run.id === id);
    if (!road) return [];
    const points = road.points.map((p, i) => ({
      x: p.x,
      y: p.y + 0.2,
      z: p.z,
      width: road.widths?.[i] ?? road.width,
    }));
    if (id === 'downtown-bleatsville-main-street') {
      // Follow the overlap of the two north caps, easing back to the centreline along the wide high street.
      const cap = north?.points[0],
        edge = points[0]!;
      if (cap && Math.hypot(cap.x - edge.x, cap.z - edge.z) < 6 * scale) {
        const dx = cap.x - edge.x,
          dz = cap.z - edge.z,
          z0 = edge.z,
          width = north!.widths?.[0] ?? north!.width;
        for (const p of points) {
          const t = Math.max(0, 1 - (p.z - z0) / (17 * scale)),
            weight = t * t * (3 - 2 * t);
          p.x += dx * weight;
          p.z += dz * weight;
          p.width += (width - p.width) * weight;
        }
      }
      points.reverse();
    }
    for (const p of points) {
      const prev = ring.at(-1);
      if (!prev || Math.hypot(prev.x - p.x, prev.z - p.z) > 0.05 * scale) ring.push(p);
    }
  }
  if (Math.hypot(ring[0]!.x - ring.at(-1)!.x, ring[0]!.z - ring.at(-1)!.z) < 0.05 * scale) ring.pop();
  const center = resample(ring, 0.6 * scale).points;
  const top = roadRibbonData(island, 'road'),
    geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(top.positions, 3));
  geometry.setIndex(top.supportIndices);
  const asphalt = meshSurfaceHeight([{ geometry, x: 0, z: 0 }], scale);
  geometry.dispose();
  const height = (x: number, z: number, defaultY: number) => {
    const paved = asphalt(x, z);
    return Math.max(terrainFaceHeight(island, x, z), Number.isFinite(paved) ? paved : defaultY);
  };
  // A three-metre neighbourhood rounds steering inputs at joins without cutting across a verge.
  const knot = (i: number) => center[wrap(i, center.length)]!;
  const smooth = center.map((p, i) => {
    const a = knot(i - 3),
      b = knot(i + 3);
    return { ...p, x: (a.x + 2 * p.x + b.x) / 4, z: (a.z + 2 * p.z + b.z) / 4 };
  });
  return [1, -1].map((sign) => {
    const path = smooth.map((p, i) => {
      const a = smooth[wrap(i - 2, smooth.length)]!,
        b = smooth[wrap(i + 2, smooth.length)]!;
      const dx = b.x - a.x,
        dz = b.z - a.z,
        distance = Math.hypot(dx, dz) || 1;
      const lateral = Math.min(1.65 * scale, p.width * 0.245) * sign;
      const x = p.x - (dz / distance) * lateral,
        z = p.z + (dx / distance) * lateral;
      return { x, y: height(x, z, p.y), z, width: p.width };
    });
    if (sign < 0) path.reverse();
    const { points, step } = resample(path, 0.5 * scale);
    const at = (i: number) => points[wrap(i, points.length)]!;
    const heading = (i: number) => Math.atan2(at(i + 2).x - at(i - 2).x, at(i + 2).z - at(i - 2).z);
    return new TrafficLane(
      points.map((p, i) => {
        const a = at(i - 2),
          b = at(i + 2);
        return {
          x: p.x,
          y: p.y,
          z: p.z,
          yaw: heading(i),
          pitch: -Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)),
          curvature: angleDelta(heading(i + 3) - heading(i - 3)) / (6 * step),
        };
      }),
      step
    );
  });
}
