import * as THREE from 'three';
import type { Biome, IslandData, RoadPoint } from './types';
import { BIOMES } from './types';
import { clamp, smoothstep } from './random';
import { gridCoordinate, gridIndex, gridSample } from './terrain';
import { makeLocalStreets } from './roads';
import { buildPropVisuals, TOON_RAMP } from './visual-props';
import { createEnvironmentLod } from './environment-lod';
import { buildGroundDetails } from './visual-ground';
import { buildStreetDetails } from './visual-streets';
import { buildMeadowScatter } from './visual-meadow';
import { buildWaterVisuals } from './visual-water';
import { buildDamVisuals } from './visual-dam';
import { buildLighthouseVisuals } from './visual-lighthouse';
import { buildHoofingtonVisuals } from './visual-hoofington';
import { buildDowntownVisuals } from './visual-downtown';
import { buildSkyVisuals, type LightingPreset } from './visual-sky';

export interface WorldSceneOptions {
  /** Segments per terrain chunk, default 32. */
  chunkSegments?: number;
  /** Maximum distance for full-sized geometry, defaults to 1.4 island widths. */
  cullingDistance?: number;
  /** Spatial extent of one prop instancing batch, default 96 metres. */
  propChunkSize?: number;
}
export interface WorldScene {
  group: THREE.Group;
  chunks: THREE.Mesh[];
  water: THREE.Mesh;
  sun: THREE.DirectionalLight;
  /** Phase 0..1, midpoint is noon; backward-compatible with the original lane. */
  setDayNight(phase: number): void;
  /** Day, painterly golden hour and starry night bookmarks. */
  setLightingPreset(preset: LightingPreset): void;
  /** Sea shader and surface position both follow the mutable tide level. */
  setTideLevel(level: number): void;
  /** Call with elapsed seconds to animate sea, waterfalls and foliage. */
  update(time: number): void;
  /** Frustum/terrain LOD; true when camera culling changed shadow-caster visibility. */
  updateCulling(camera: THREE.Camera): boolean;
  dispose(): void;
}
export type { LightingPreset } from './visual-sky';

interface Chunk {
  mesh: THREE.Mesh;
  sphere: THREE.Sphere;
  high: THREE.BufferGeometry;
  low: THREE.BufferGeometry;
}
const COLORS = {
  grass: new THREE.Color('#77B754'),
  pine: new THREE.Color('#568F59'),
  sand: new THREE.Color('#F7DB99'),
  rock: new THREE.Color('#8C919E'),
  farmland: new THREE.Color('#95BA61'),
  town: new THREE.Color('#83B96A'),
  industrial: new THREE.Color('#9EAE90'),
  dirt: new THREE.Color('#C7A372'),
  freshwater: new THREE.Color('#598F99'),
  submerged: new THREE.Color('#4D9C9F'),
} as const;

const CAPE_GRASS = new THREE.Color('#7FBF56');
const CAPE_STONE = new THREE.Color('#A8A9B1');
const MT_GIGGA_STONE = new THREE.Color(0xa39a96);

interface RoadSample { x: number; z: number; width: number; type: 'road' | 'trail' }
function roadGrid(island: IslandData, cell: number): Map<string, RoadSample[]> {
  const cells = new Map<string, RoadSample[]>();
  const insert = (x: number, z: number, sample: RoadSample): void => {
    const key = x + ':' + z;
    const list = cells.get(key) ?? [];
    list.push(sample);
    cells.set(key, list);
  };
  for (const road of island.roads) {
    for (let i = 0; i < road.points.length; i += 2) {
      const p = road.points[i]!;
      const sample: RoadSample = { x: p.x, z: p.z, width: road.width, type: road.type };
      insert(Math.floor(p.x / cell), Math.floor(p.z / cell), sample);
    }
  }
  return cells;
}
function roadMix(lookup: Map<string, RoadSample[]>, x: number, z: number,
  cell: number): number {
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  let blend = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const samples = lookup.get((cx + dx) + ':' + (cz + dz));
    if (!samples) continue;
    for (const p of samples) {
      if (p.type !== 'trail') continue;
      const distance = Math.hypot(x - p.x, z - p.z);
      blend = Math.max(blend, 1 - smoothstep(p.width * 0.28, p.width * 0.70 + 2.3, distance));
    }
  }
  return blend;
}
function terrainGeometry(
  island: IslandData, startX: number, startZ: number, countX: number, countZ: number,
  lodStep: number, roads: Map<string, RoadSample[]>,
): THREE.BufferGeometry {
  const n = island.resolution, metres = island.size / (n - 1);
  const cx = gridCoordinate(island.size, n, startX + countX / 2);
  const cz = gridCoordinate(island.size, n, startZ + countZ / 2);
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();
  const lighthouse = island.pois.find(p => p.id === 'old-lighthouse')!.center;
  const scale = island.size / 600;
  const sample = (x: number, z: number): number =>
    island.heights[gridIndex(n, Math.max(0, Math.min(n - 1, x)),
      Math.max(0, Math.min(n - 1, z)))]!;
  const rockBands: readonly (readonly [number, number])[] = [
    [19, 26], [38, 45], [56, 63], [74, 81], [91, 104],
  ];
  // Keep every vertex on the seam at native resolution in BOTH LODs. The old
  // four overlapping, double-sided chunk skirts were visible as dark straight
  // lines and produced shadow-map streaks across the landscape.
  for (let iz = 0; iz <= countZ; iz++) for (let ix = 0; ix <= countX; ix++) {
    const gx = startX + ix, gz = startZ + iz;
    const h = sample(gx, gz);
    const x = gridCoordinate(island.size, n, gx);
    const z = gridCoordinate(island.size, n, gz);
    const dx = (sample(gx + 1, gz) - sample(gx - 1, gz)) /
      ((gx > 0 && gx < n - 1) ? 2 * metres : metres);
    const dz = (sample(gx, gz + 1) - sample(gx, gz - 1)) /
      ((gz > 0 && gz < n - 1) ? 2 * metres : metres);
    const slope = Math.hypot(dx, dz);
    const normal = new THREE.Vector3(-dx, 1, -dz).normalize();
    normals.push(normal.x, normal.y, normal.z);
    positions.push(x - cx, h, z - cz);
    const biome: Biome = BIOMES[island.biomeMap[gridIndex(n, gx, gz)] ?? 2] ?? 'meadow';
    const base = biome === 'pine-forest' ? COLORS.pine
      : biome === 'farmland' ? COLORS.farmland
      : biome === 'town' ? COLORS.town
      : biome === 'industrial' ? COLORS.industrial : COLORS.grass;
    color.copy(base);
    color.lerp(COLORS.sand, 1 - smoothstep(1.8, 7.3, h));
    const cliff = Math.max(smoothstep(0.56, 1.35, slope),
      smoothstep(82, 112, h) * 0.25);
    color.lerp(COLORS.rock, cliff);
    if (biome === 'freshwater') color.lerp(COLORS.freshwater, 0.7);
    if (h < -0.4) color.lerp(COLORS.submerged, 0.8);

    // Explicit mountain palette, tied to the *sculpted* terrace radii rather
    // than discontinuous slope/biome classifications after trail stamp cuts.
    // This preserves broad grey climbing faces and green, usable benches.
    const radius = Math.hypot(x, z) / (island.size / 600);
    const mountain = 1 - smoothstep(99, 113, radius);
    if (mountain > 0) {
      let rockFace = 0;
      for (const [inner, outer] of rockBands) {
        const band = smoothstep(inner - 1.9, inner + 1.6, radius) *
          (1 - smoothstep(outer - 1.4, outer + 2.1, radius));
        rockFace = Math.max(rockFace, band);
      }
      rockFace = Math.max(rockFace, smoothstep(1.05, 2.5, slope) * 0.76);
      // The flat tops of the tiers are grass, even inside a radial stone band.
      rockFace *= smoothstep(0.55, 1.15, slope);
      // Cap each steep riser with a grassy lip where the ground falls away
      // at least 2 m across 3 m in the outward radial direction.
      const outward = Math.hypot(x, z);
      if (outward > 0.001 && slope < 0.7) {
        const drop = h - gridSample(island,
          x + x / outward * 3 * scale, z + z / outward * 3 * scale);
        if (drop >= 2 * scale) rockFace = 0;
      }
      const grassy = COLORS.grass.clone().lerp(COLORS.pine, 0.12);
      // Height-indexed warm grey strata, with metres normalized for island size.
      const stone = MT_GIGGA_STONE.clone().multiplyScalar(
        0.93 + 0.07 * Math.sin(h / scale * 0.85));
      color.copy(grassy).lerp(stone, rockFace);
      color.lerp(base, 1 - mountain);
    }
    // Cap the beacon's headland in grass, but keep the steep sea-facing
    // walls visibly pale grey rather than the generic low sand/beach palette.
    const capeRadius = Math.hypot(x - lighthouse.x, z - lighthouse.z) / scale;
    if (capeRadius < 38 && h >= 0) {
      // Even low coastal faces are stone: the old h>0.2-only rule exposed
      // sand-coloured vertical walls below the grassy beacon plateau.
      const face = Math.max(smoothstep(14.5, 25.5, capeRadius),
        smoothstep(0.43, 1.25, slope) * 0.94,
        1 - smoothstep(4, 10, h / scale));
      color.copy(CAPE_GRASS).lerp(CAPE_STONE,
        Math.max(0, Math.min(1, face)));
    }
    const trail = roadMix(roads, x, z, 22);
    color.lerp(COLORS.dirt, trail * (1 - cliff) * (1 - mountain * 0.42) * 0.86);
    // Gentle contact darkening, never noisy high-frequency mountain dithering.
    const depression = Math.max(0, (
      sample(gx + 1, gz) + sample(gx - 1, gz) +
      sample(gx, gz + 1) + sample(gx, gz - 1)) * 0.25 - h);
    const ambient = 1 - clamp(depression * 0.07, 0, 0.16);
    const broad = Math.sin(x * 0.071 + Math.cos(z * 0.039) * 1.4) *
      Math.cos(z * 0.092 - Math.sin(x * 0.047));
    const fine = Math.sin(x * 0.36 + z * 0.17) *
      Math.cos(z * 0.29 - x * 0.21);
    const meadow = biome === 'meadow' || biome === 'farmland' || biome === 'town';
    if (meadow && cliff < 0.4 && mountain < 0.1) {
      color.lerp(COLORS.dirt, Math.max(0, -broad - 0.3) * 0.12);
      color.lerp(COLORS.pine, Math.max(0, broad - 0.1) * 0.09);
    }
    const variation = 0.968 + broad * 0.038 + fine * 0.022;
    color.multiplyScalar(ambient * variation);
    colors.push(color.r, color.g, color.b);
  }

  const stride = countX + 1;
  const vertex = (x: number, z: number): number => z * stride + x;
  for (let z = 0; z < countZ; z += lodStep) for (let x = 0; x < countX; x += lodStep) {
    const x1 = Math.min(countX, x + lodStep);
    const z1 = Math.min(countZ, z + lodStep);
    const a = vertex(x, z), b = vertex(x1, z);
    const c = vertex(x, z1), d = vertex(x1, z1);
    const touchesSeam = x === 0 || z === 0 || x1 === countX || z1 === countZ;
    if (lodStep === 1 || !touchesSeam || x1 - x < 2 || z1 - z < 2) {
      indices.push(a, c, b, b, c, d);
      continue;
    }
    // Stitch coarse interiors to high-resolution seam edge vertices by
    // triangle fans. Adjacent high-LOD chunks share EXACT same edge triangles.
    const perimeter: number[] = [a];
    if (x === 0) for (let k = z + 1; k < z1; k++) perimeter.push(vertex(x, k));
    perimeter.push(c);
    if (z1 === countZ) for (let k = x + 1; k < x1; k++) perimeter.push(vertex(k, z1));
    perimeter.push(d);
    if (x1 === countX) for (let k = z1 - 1; k > z; k--) perimeter.push(vertex(x1, k));
    perimeter.push(b);
    if (z === 0) for (let k = x1 - 1; k > x; k--) perimeter.push(vertex(k, z));
    const centre = vertex(x + Math.floor((x1 - x) / 2),
      z + Math.floor((z1 - z) / 2));
    for (let i = 0; i < perimeter.length; i++) {
      indices.push(centre, perimeter[i]!, perimeter[(i + 1) % perimeter.length]!);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
function buildTerrain(island: IslandData, segments: number): Chunk[] {
  const n = island.resolution;
  const material = new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap: TOON_RAMP, side: THREE.FrontSide,
  });
  const lookup = roadGrid(island, 22);
  const chunks: Chunk[] = [];
  for (let startZ = 0; startZ < n - 1; startZ += segments) {
    for (let startX = 0; startX < n - 1; startX += segments) {
      const countX = Math.min(segments, n - 1 - startX);
      const countZ = Math.min(segments, n - 1 - startZ);
      const cx = gridCoordinate(island.size, n, startX + countX / 2);
      const cz = gridCoordinate(island.size, n, startZ + countZ / 2);
      const high = terrainGeometry(island, startX, startZ, countX, countZ, 1, lookup);
      const low = terrainGeometry(island, startX, startZ, countX, countZ, 2, lookup);
      const mesh = new THREE.Mesh(high, material);
      mesh.position.set(cx, 0, cz);
      mesh.receiveShadow = true;
      // Terrain only receives shadows; its duplicated cliff/skirt casting created
      // kilometer-long shadow acne at grazing angles.
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      mesh.name = 'terrain-chunk-' + startX + '-' + startZ;
      mesh.userData['terrainChunk'] = true;
      const local = high.boundingSphere ?? new THREE.Sphere();
      const sphere = local.clone();
      sphere.center.add(new THREE.Vector3(cx, 0, cz));
      chunks.push({ mesh, sphere, high, low });
    }
  }
  return chunks;
}
/**
 * The POI road network and the authored Downtown high street both terminate
 * at the same city centre. Rendering every inter-POI endpoint over the local
 * street produces fanned, vertically tilted road planks in the shop corridor.
 *
 * Suppress only those redundant VISUAL pieces inside the main-street plot.
 * The actual island roads, graded terrain, collision and connected graph are
 * deliberately unchanged; the continuous local street remains visible.
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
 * Cull only the visual trail pieces whose footprint meets that carriageway;
 * never change the actual road graph, terrain stamps or physics descriptors.
 * Keep the existing overlap margin at the edge of the through-street.
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

/** Avoid painting yellow centre dashes through the white zebra. */
function isHoofingtonCrossingDash(
  island: IslandData,
  a: { x: number; z: number }, b: { x: number; z: number },
): boolean {
  const farm = island.pois.find(p => p.id === 'hoofington')?.center;
  if (!farm) return false;
  const scale = island.size / 600;
  const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
  // A dash extends 1.3 m beyond its midpoint in either horizontal axis.
  return Math.abs(x - farm.x) < 3.4 * scale + 1.3 &&
    Math.abs(z - (farm.z - 18 * scale)) < 3.25 * scale + 1.3;
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
function roadRibbonGeometry(runs: RoadRibbonRun[], topOffset: number): {
  geometry: THREE.BufferGeometry; segments: RibbonSegment[];
} {
  const positions: number[] = [];
  const indices: number[] = [];
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
      indices.push(
        a, b, a + 1, a + 1, b, b + 1,
        a + 2, a + 4, b + 2, b + 2, a + 4, b + 4,
        a + 3, b + 3, a + 5, b + 3, b + 5, a + 5,
      );
      const p = points[i]!, q = points[i + 1]!;
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
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, segments };
}

function buildRoads(island: IslandData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'graded-ring-road-and-trails';
  const allRoads = [...island.roads, ...makeLocalStreets(island)];
  const forward = new THREE.Vector3(0, 0, 1);
  const midpoint = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();

  for (const type of ['road', 'trail'] as const) {
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

    const { geometry, segments } = roadRibbonGeometry(
      runs, type === 'road' ? 0.2 : 0.19);
    const material = new THREE.MeshToonMaterial({
      color: type === 'road' ? 0x727e8a : 0xc3a06c, gradientMap: TOON_RAMP,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'paths-' + type;
    mesh.receiveShadow = true;
    group.add(mesh);

    if (type === 'road') {
      // Index across every *kept* road segment, exactly as the old slabs did.
      const marks = segments.filter((segment, i) => i % 5 === 0 &&
        !isHoofingtonCrossingDash(island, segment.a, segment.b));
      const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xffe0a5 }), marks.length);
      dashes.name = 'road-centre-dashes';
      for (let i = 0; i < marks.length; i++) {
        const { a, b, tangent } = marks[i]!;
        rotation.setFromUnitVectors(forward, tangent);
        midpoint.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.21, (a.z + b.z) / 2);
        matrix.compose(midpoint, rotation, new THREE.Vector3(0.18, 0.01, 2.6));
        dashes.setMatrixAt(i, matrix);
      }
      dashes.instanceMatrix.needsUpdate = true;
      group.add(dashes);
    }
  }
  return group;
}

/** No renderer or DOM required: consumers own the renderer, physics and camera. */
export function createWorldScene(island: IslandData, options: WorldSceneOptions = {}): WorldScene {
  const group = new THREE.Group();
  group.name = 'Billy Isle';
  const segments = Math.max(4, Math.floor(options.chunkSegments ?? 32));
  const chunks = buildTerrain(island, segments);
  for (const chunk of chunks) group.add(chunk.mesh);
  group.add(buildRoads(island));
  group.add(buildStreetDetails(island));
  // Coalesce unchanged ground decals to keep the extra zebra mesh within the draw budget.
  group.add(buildGroundDetails(island, 192));
  group.add(buildMeadowScatter(island));
  const props = buildPropVisuals(island.props, options.propChunkSize ?? 96, island);
  group.add(props.group);
  const hoofington = buildHoofingtonVisuals(island, props.group);
  group.add(hoofington.group);
  const downtown = buildDowntownVisuals(island, props.group);
  group.add(downtown.group);
  const waterVisuals = buildWaterVisuals(island);
  group.add(waterVisuals.inland, waterVisuals.sea);
  const dam = buildDamVisuals(island);
  group.add(dam.group);
  const lighthouse = buildLighthouseVisuals(island, props.group);
  group.add(lighthouse.group);
  const sky = buildSkyVisuals();
  group.add(sky.group);
  const sun = new THREE.DirectionalLight(0xffe9c5, 1.65);
  sun.name = 'warm-soft-key';
  sun.castShadow = true;
  // Shared shadow pass now includes landmarks rather than every fence/flower/cliff.
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = -310;
  sun.shadow.camera.right = 310;
  sun.shadow.camera.top = 310;
  sun.shadow.camera.bottom = -310;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1100;
  // 1536 texels over 620 m = 0.40 m per texel. A normal offset of ~1.5
  // texels and a single-texel filter remove the diagonal acne on large flat
  // walls; radius 3 spread three's rotated PCF taps into a cross-hatch.
  // The game overrides these per graphics preset (GameView.applySettings).
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 1.0;
  group.add(sun, sun.target);
  // Warm sandy bounce instead of dark olive: shaded walls stay clean painted
  // pastels (painting style) rather than greenish grey.
  const fill = new THREE.HemisphereLight(0xc8eaff, 0xd6c4a2, 1.1);
  fill.name = 'cool-sky-fill';
  group.add(fill);
  group.add(new THREE.AmbientLight(0xb5d4eb, 0.15));
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4();
  const cullingDistance = options.cullingDistance ?? island.size * 1.4;
  const environmentLod = createEnvironmentLod(group);
  let tide = island.seaLevel;
  let elapsed = 0;

  function setDayNight(phase: number): void {
    const state = sky.update(((phase % 1) + 1) % 1);
    sun.position.copy(state.direction).multiplyScalar(560);
    sun.intensity = 0.07 + state.daylight * 1.55;
    fill.intensity = 0.19 + state.daylight * 0.98;
    sun.color.setHex(state.altitude < 0.38 ? 0xffb87f : 0xffebcb);
  }
  function setLightingPreset(preset: LightingPreset): void {
    const phases: Record<LightingPreset, number> = {
      day: 0.5, 'golden-hour': 0.285, night: 0.025,
    };
    setDayNight(phases[preset]);
  }
  function setTideLevel(level: number): void {
    if (!Number.isFinite(level)) throw new RangeError('Tide height must be finite');
    tide = level;
    waterVisuals.update(elapsed, tide);
  }
  function update(time: number): void {
    elapsed = Number.isFinite(time) ? Math.max(0, time) : elapsed;
    waterVisuals.update(elapsed, tide);
    props.update(elapsed);
    dam.update(elapsed);
    lighthouse.update(elapsed);
  }
  function updateCulling(camera: THREE.Camera): boolean {
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    const pos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    let shadowCastersChanged = false;
    for (const chunk of chunks) {
      const dist = chunk.sphere.center.distanceTo(pos);
      chunk.mesh.visible = dist < cullingDistance + chunk.sphere.radius &&
        frustum.intersectsSphere(chunk.sphere);
      const lod = dist > island.size * 0.45 ? chunk.low : chunk.high;
      if (chunk.mesh.geometry !== lod) chunk.mesh.geometry = lod;
    }
    if (props.updateCulling(pos, frustum, cullingDistance,
      mesh => hoofington.isFallbackHidden(mesh) || downtown.isFallbackHidden(mesh) ||
        lighthouse.isFallbackHidden(mesh)))
      shadowCastersChanged = true;
    if (hoofington.updateCulling(pos, frustum)) shadowCastersChanged = true;
    if (downtown.updateCulling(pos, frustum)) shadowCastersChanged = true;
    if (environmentLod.updateCulling(camera, pos, frustum)) shadowCastersChanged = true;
    // The GLB supplies its own reservoir surface. Hide the procedural one
    // on success, but retain it in the graph for disposal; it remains visible
    // if the model fails and the procedural fallback is needed.
    if (props.consumeShadowChange()) shadowCastersChanged = true;
    if (hoofington.consumeShadowChange()) shadowCastersChanged = true;
    if (downtown.consumeShadowChange()) shadowCastersChanged = true;
    if (dam.consumeShadowChange()) {
      const reservoir = waterVisuals.inland.getObjectByName('dam-reservoir');
      if (reservoir) reservoir.visible = false;
      shadowCastersChanged = true;
    }
    return shadowCastersChanged;
  }
  function dispose(): void {
    environmentLod.dispose();
    props.dispose();
    hoofington.dispose();
    downtown.dispose();
    dam.dispose();
    lighthouse.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    group.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        for (const mat of mats) materials.add(mat);
      }
    });
    for (const chunk of chunks) { geometries.add(chunk.high); geometries.add(chunk.low); }
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    group.removeFromParent();
  }
  setDayNight(0.5);
  waterVisuals.update(elapsed, tide);
  return {
    group, chunks: chunks.map(c => c.mesh), water: waterVisuals.sea,
    sun, setDayNight, setLightingPreset, setTideLevel, update, updateCulling, dispose,
  };
}
