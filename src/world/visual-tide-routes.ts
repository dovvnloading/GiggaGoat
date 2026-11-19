import * as THREE from 'three';
import { gridIndex } from './terrain';
import type { IslandData, Vec2, Vec3 } from './types';

const STRIDE = 19;
const CLEARANCE = .68;
// Local X is cross-trail and Z points along the ascent.
const ARROW = [
  [-.22, -.86], [.22, -.86], [.22, .05], [.68, .05], [0, .93], [-.68, .05], [-.22, .05],
] as const;
const TRIANGLES = [0, 6, 1, 1, 6, 2, 3, 5, 4] as const;
const DARK = new THREE.Color(0x483c29);
const GOLD = new THREE.Color(0xffd26d);
const INSET = .73;

interface TrailMarker {
  floor: Vec3;
  direction: { x: number; z: number };
  safeBelow: number;
}

function terrainFloor(island: IslandData, x: number, z: number): number {
  const { size, resolution: n, heights } = island;
  const gx = THREE.MathUtils.clamp((x / size + .5) * (n - 1), 0, n - 1);
  const gz = THREE.MathUtils.clamp((z / size + .5) * (n - 1), 0, n - 1);
  const ix = Math.min(Math.floor(gx), n - 2), iz = Math.min(Math.floor(gz), n - 2);
  const u = gx - ix, v = gz - iz;
  // The full-resolution terrain mesh splits each cell along corners B and C.
  const a = heights[gridIndex(n, ix, iz)]!, b = heights[gridIndex(n, ix + 1, iz)]!;
  const c = heights[gridIndex(n, ix, iz + 1)]!, d = heights[gridIndex(n, ix + 1, iz + 1)]!;
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v
    : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

function trailMarkers(island: IslandData, floorAt: (x: number, z: number) => number): TrailMarker[] {
  const scale = island.size / 600;
  const markers: TrailMarker[] = [];
  for (const trail of island.roads) {
    if (trail.type !== 'trail' || (trail.from !== 'mt-gigga' && trail.to !== 'mt-gigga')) continue;
    // Walk back from the summit to know how low the route goes downstream
    // of each marker. A dry island of trail cannot point into a flooded dip.
    const route = trail.from === 'mt-gigga' ? trail.points : [...trail.points].reverse();
    let distance = STRIDE * scale / 2, low = route[0]!.y;
    for (let i = 1; i < route.length; i++) {
      const upper = route[i - 1]!, lower = route[i]!;
      const length = Math.hypot(lower.x - upper.x, lower.z - upper.z);
      if (length < 1e-5) continue;
      const steps = Math.ceil(length / (1.5 * scale));
      for (let step = 1; step <= steps; step++) {
        const x = THREE.MathUtils.lerp(upper.x, lower.x, step / steps);
        const z = THREE.MathUtils.lerp(upper.z, lower.z, step / steps);
        const floor = { x, y: floorAt(x, z), z };
        low = Math.min(low, floor.y);
        distance += length / steps;
        if (distance < STRIDE * scale) continue;
        distance = 0;
        // Short stretches directly on the summit don't need three arrows
        // from three routes that start at the same place.
        if (markers.some(marker => Math.hypot(marker.floor.x - floor.x,
          marker.floor.z - floor.z) < 5.5 * scale)) continue;
        markers.push({
          floor,
          direction: { x: (upper.x - lower.x) / length, z: (upper.z - lower.z) / length },
          safeBelow: low - CLEARANCE * scale,
        });
      }
    }
  }
  return markers;
}

interface GroundTriangle {
  x: number; y: number; z: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
  inverseArea: number;
}

interface Surface {
  geometry: THREE.BufferGeometry;
  x: number;
  z: number;
}

/** Look up the same top triangles the renderer draws, without raycasting the whole island. */
export function meshSurfaceHeight(surfaces: readonly Surface[], scale: number): (x: number, z: number) => number {
  const cell = 8 * scale;
  const bins = new Map<string, GroundTriangle[]>();
  for (const surface of surfaces) {
    const points = surface.geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = surface.geometry.getIndex();
    if (!index) continue;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      const ax = points.getX(a), y = points.getY(a), az = points.getZ(a);
      const x = ax + surface.x, z = az + surface.z;
      const bx = points.getX(b) - ax, bz = points.getZ(b) - az;
      const cx = points.getX(c) - ax, cz = points.getZ(c) - az;
      const area = bx * cz - bz * cx;
      if (Math.abs(area) < 1e-7) continue; // The vertical road skirts have no top area.
      const tri = { x, y, z, bx, bz, cx, cz,
        by: points.getY(b) - y, cy: points.getY(c) - y, inverseArea: 1 / area };
      const x0 = Math.floor((x + Math.min(0, bx, cx)) / cell);
      const x1 = Math.floor((x + Math.max(0, bx, cx)) / cell);
      const z0 = Math.floor((z + Math.min(0, bz, cz)) / cell);
      const z1 = Math.floor((z + Math.max(0, bz, cz)) / cell);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const key = ix + ',' + iz;
        const bin = bins.get(key) ?? [];
        bin.push(tri);
        bins.set(key, bin);
      }
    }
  }
  return (x, z) => {
    const candidates = bins.get(Math.floor(x / cell) + ',' + Math.floor(z / cell));
    let floor = -Infinity;
    for (const t of candidates ?? []) {
      const dx = x - t.x, dz = z - t.z;
      const u = (dx * t.cz - dz * t.cx) * t.inverseArea;
      const v = (dz * t.bx - dx * t.bz) * t.inverseArea;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) floor = Math.max(floor, t.y + u * t.by + v * t.cy);
    }
    return floor;
  };
}

/** Ground-painted arrows share one visible draw and have no collision or game state. */
export function buildTideRouteCues(island: IslandData, roads: THREE.Group,
  lowTerrain: readonly Surface[]): {
  mesh: THREE.Mesh;
  update(level: number, enabled: boolean): void;
  nearestDryCue(position: Vec2): Vec3 | undefined;
} {
  const scale = island.size / 600;
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'rising-tide-escape-route-cues';
  mesh.visible = false;
  const indicesPerMarker = TRIANGLES.length * 2;
  const markers: Array<{ floor: Vec3; safeBelow: number; vertex: number }> = [];
  const dryCues: Vec3[] = [];
  let index: THREE.BufferAttribute | undefined;

  function prepare(): void {
    const positions: number[] = [], colors: number[] = [];
    const roadSurfaces = ['paths-road', 'paths-trail'].flatMap(name => {
      const path = roads.getObjectByName(name);
      return path instanceof THREE.Mesh ? [{ geometry: path.geometry, x: 0, z: 0 }] : [];
    });
    const roadsAt = meshSurfaceHeight(roadSurfaces, scale);
    const coarseTerrainAt = meshSurfaceHeight(lowTerrain, scale);
    const floorAt = (x: number, z: number): number =>
      Math.max(terrainFloor(island, x, z), roadsAt(x, z));
    for (const marker of trailMarkers(island, floorAt)) {
      const { floor, direction } = marker;
      const points: number[] = [], colorsPerArrow: number[] = [];
      let safeBelow = marker.safeBelow;
      let coveredAtDistance = false;
      for (const layer of [0, 1]) {
        const color = layer === 0 ? DARK : GOLD, inset = layer === 0 ? 1 : INSET;
        // A 1.8 m arrow reads from the chase camera without looking like a platform.
        for (const [u, v] of ARROW) {
          const x = floor.x + (direction.z * u + direction.x * v) * inset * scale;
          const z = floor.z + (-direction.x * u + direction.z * v) * inset * scale;
          const ground = floorAt(x, z);
          safeBelow = Math.min(safeBelow, ground - CLEARANCE * scale);
          coveredAtDistance ||= coarseTerrainAt(x, z) > ground + .04 * scale;
          points.push(x, ground + (.047 + layer * .021) * scale, z);
          colorsPerArrow.push(color.r, color.g, color.b);
        }
      }
      // Keep painted shapes intact in the World Lab's high, distant view.
      if (coveredAtDistance) continue;
      markers.push({ floor, safeBelow, vertex: positions.length / 3 });
      positions.push(...points);
      colors.push(...colorsPerArrow);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    index = new THREE.BufferAttribute(new Uint16Array(markers.length * indicesPerMarker), 1);
    index.setUsage(THREE.DynamicDrawUsage);
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
  }

  return {
    mesh,
    update(level, enabled): void {
      dryCues.length = 0;
      if (!enabled) { mesh.visible = false; return; }
      if (!index) prepare();
      const active = index!;
      let write = 0;
      for (const marker of markers) {
        if (level > marker.safeBelow) continue;
        dryCues.push(marker.floor);
        for (const layer of [0, 1]) for (const vertex of TRIANGLES) {
          active.setX(write++, marker.vertex + ARROW.length * layer + vertex);
        }
      }
      active.needsUpdate = true;
      geometry.setDrawRange(0, write);
      mesh.visible = write > 0;
    },
    nearestDryCue(position): Vec3 | undefined {
      let nearest: Vec3 | undefined;
      let nearestDistance = Infinity;
      for (const cue of dryCues) {
        const distance = (cue.x - position.x) ** 2 + (cue.z - position.z) ** 2;
        if (distance >= nearestDistance) continue;
        nearest = cue;
        nearestDistance = distance;
      }
      return nearest && { ...nearest };
    },
  };
}
