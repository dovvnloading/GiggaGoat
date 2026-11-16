import * as THREE from 'three';
import type { Biome, IslandData } from './types';
import { BIOMES } from './types';
import { clamp, smoothstep } from './random';
import { gridCoordinate, gridIndex, segmentProjection } from './terrain';
import { buildPropVisuals, TOON_RAMP } from './visual-props';
import { buildWaterVisuals } from './visual-water';
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
  /** Frustum culling, vegetation distance LOD and a half-resolution terrain LOD. */
  updateCulling(camera: THREE.Camera): void;
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
  const xs: number[] = [], zs: number[] = [];
  for (let i = 0; i < countX; i += lodStep) xs.push(startX + i);
  xs.push(startX + countX);
  for (let i = 0; i < countZ; i += lodStep) zs.push(startZ + i);
  zs.push(startZ + countZ);
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();
  const sample = (x: number, z: number): number =>
    island.heights[gridIndex(n, Math.max(0, Math.min(n - 1, x)),
      Math.max(0, Math.min(n - 1, z)))]!;
  for (const iz of zs) for (const ix of xs) {
    const h = sample(ix, iz);
    const x = gridCoordinate(island.size, n, ix), z = gridCoordinate(island.size, n, iz);
    const dx = (sample(ix + 1, iz) - sample(ix - 1, iz)) /
      ((ix > 0 && ix < n - 1) ? 2 * metres : metres);
    const dz = (sample(ix, iz + 1) - sample(ix, iz - 1)) /
      ((iz > 0 && iz < n - 1) ? 2 * metres : metres);
    const slope = Math.hypot(dx, dz);
    const normal = new THREE.Vector3(-dx, 1, -dz).normalize();
    normals.push(normal.x, normal.y, normal.z);
    positions.push(x - cx, h, z - cz);
    const biome: Biome = BIOMES[island.biomeMap[gridIndex(n, ix, iz)]!] ?? 2] ?? 'meadow';
    const base = biome === 'pine-forest' ? COLORS.pine
      : biome === 'farmland' ? COLORS.farmland
      : biome === 'town' ? COLORS.town
      : biome === 'industrial' ? COLORS.industrial : COLORS.grass;
    color.copy(base);
    const sand = 1 - smoothstep(1.8, 7.3, h);
    color.lerp(COLORS.sand, sand);
    const cliff = Math.max(smoothstep(0.56, 1.35, slope),
      smoothstep(82, 112, h) * 0.25);
    color.lerp(COLORS.rock, cliff);
    if (biome === 'freshwater') color.lerp(COLORS.freshwater, 0.7);
    if (h < -0.4) color.lerp(COLORS.submerged, 0.8);
    color.lerp(COLORS.dirt, roadMix(roads, x, z, 22) * (1 - cliff) * 0.93);
    // Baked curvature/contact occlusion, plus a very fine hand-painted variance.
    const depression = Math.max(0,
      (sample(ix + 1, iz) + sample(ix - 1, iz) +
       sample(ix, iz + 1) + sample(ix, iz - 1)) * 0.25 - h);
    const ambient = 1 - clamp(depression * 0.10, 0, 0.23);
    const variation = 0.972 + Math.sin(x * 0.19 + z * 0.11) *
      Math.cos(z * 0.13 - x * 0.07) * 0.022;
    color.multiplyScalar(ambient * variation);
    colors.push(color.r, color.g, color.b);
  }
  const stride = xs.length;
  for (let z = 0; z < zs.length - 1; z++) for (let x = 0; x < xs.length - 1; x++) {
    const a = z * stride + x, b = a + 1, c = a + stride, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  // LOD skirts hide tiny cracks wherever near and far chunk resolutions meet.
  const edges: number[][] = [
    xs.map((_, i) => i),
    xs.map((_, i) => (zs.length - 1) * stride + i),
    zs.map((_, i) => i * stride),
    zs.map((_, i) => i * stride + stride - 1),
  ];
  for (const edge of edges) {
    const bottom: number[] = [];
    for (const top of edge) {
      const idx = positions.length / 3;
      positions.push(positions[top * 3]!, positions[top * 3 + 1]! - 3.5,
        positions[top * 3 + 2]!);
      normals.push(normals[top * 3]!, normals[top * 3 + 1]!, normals[top * 3 + 2]!);
      colors.push(colors[top * 3]! * 0.79, colors[top * 3 + 1]! * 0.79,
        colors[top * 3 + 2]! * 0.79);
      bottom.push(idx);
    }
    for (let i = 1; i < edge.length; i++) {
      const a = edge[i - 1]!, b = edge[i]!, c = bottom[i - 1]!, d = bottom[i]!;
      indices.push(a, b, c, b, d, c, c, b, a, c, d, b);
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
      mesh.castShadow = true;
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
function buildRoads(island: IslandData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'graded-ring-road-and-trails';
  const forward = new THREE.Vector3(0, 0, 1);
  const direction = new THREE.Vector3(), midpoint = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4();
  for (const type of ['road', 'trail'] as const) {
    const segments = island.roads.filter(r => r.type === type)
      .flatMap(r => r.points.slice(1).map((b, i) =>
        ({ a: r.points[i]!, b, width: r.width })));
    const material = new THREE.MeshToonMaterial({
      color: type === 'road' ? 0x727e8a : 0xc3a06c, gradientMap: TOON_RAMP,
    });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      material, segments.length);
    mesh.name = 'paths-' + type;
    mesh.receiveShadow = true;
    for (let i = 0; i < segments.length; i++) {
      const { a, b, width } = segments[i]!;
      direction.set(b.x - a.x, b.y - a.y, b.z - a.z);
      const length = Math.max(0.01, direction.length());
      rotation.setFromUnitVectors(forward, direction.normalize());
      midpoint.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.13, (a.z + b.z) / 2);
      matrix.compose(midpoint, rotation,
        new THREE.Vector3(width, 0.14, length + 0.35));
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    if (type === 'road') {
      const marks = segments.filter((_, i) => i % 5 === 0);
      const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xffe0a5 }), marks.length);
      dashes.name = 'road-centre-dashes';
      for (let i = 0; i < marks.length; i++) {
        const { a, b } = marks[i]!;
        direction.set(b.x - a.x, b.y - a.y, b.z - a.z);
        rotation.setFromUnitVectors(forward, direction.normalize());
        midpoint.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.225, (a.z + b.z) / 2);
        matrix.compose(midpoint, rotation, new THREE.Vector3(0.18, 0.03, 2.6));
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
  const props = buildPropVisuals(island.props, options.propChunkSize ?? 96);
  group.add(props.group);
  const waterVisuals = buildWaterVisuals(island);
  group.add(waterVisuals.inland, waterVisuals.sea);
  const sky = buildSkyVisuals();
  group.add(sky.group);
  const sun = new THREE.DirectionalLight(0xffe9c5, 1.65);
  sun.name = 'warm-soft-key';
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -310;
  sun.shadow.camera.right = 310;
  sun.shadow.camera.top = 310;
  sun.shadow.camera.bottom = -310;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1100;
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3.0;
  group.add(sun, sun.target);
  const fill = new THREE.HemisphereLight(0xc8eaff, 0x667956, 1.1);
  fill.name = 'cool-sky-fill';
  group.add(fill);
  group.add(new THREE.AmbientLight(0xb5d4eb, 0.15));
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4();
  const cullingDistance = options.cullingDistance ?? island.size * 1.4;
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
  }
  function updateCulling(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    const pos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    for (const chunk of chunks) {
      const dist = chunk.sphere.center.distanceTo(pos);
      chunk.mesh.visible = dist < cullingDistance + chunk.sphere.radius &&
        frustum.intersectsSphere(chunk.sphere);
      const lod = dist > island.size * 0.45 ? chunk.low : chunk.high;
      if (chunk.mesh.geometry !== lod) chunk.mesh.geometry = lod;
    }
    for (const batch of props.batches) {
      const distance = batch.sphere.center.distanceTo(pos);
      const visible = distance < (batch.nearOnly ? island.size * 0.32 : cullingDistance) +
        batch.sphere.radius && frustum.intersectsSphere(batch.sphere);
      for (const mesh of batch.meshes) mesh.visible = visible;
    }
  }
  function dispose(): void {
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
