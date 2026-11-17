import * as THREE from 'three';
import type { Biome, IslandData } from './types';
import { BIOMES } from './types';
import { clamp, smoothstep } from './random';
import { gridCoordinate, gridIndex } from './terrain';
import { makeLocalStreets } from './roads';
import { buildPropVisuals, TOON_RAMP } from './visual-props';
import { buildGroundDetails } from './visual-ground';
import { buildStreetDetails } from './visual-streets';
import { buildMeadowScatter } from './visual-meadow';
import { buildWaterVisuals } from './visual-water';
import { buildDamVisuals } from './visual-dam';
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
      const grassy = COLORS.grass.clone().lerp(COLORS.pine, 0.12);
      const stone = COLORS.rock.clone().multiplyScalar(0.96 +
        0.025 * Math.sin(radius * 0.33));
      color.copy(grassy).lerp(stone, rockFace);
      color.lerp(base, 1 - mountain);
    }
    // Cap the beacon's headland in grass, but keep the steep sea-facing
    // walls visibly pale grey rather than the generic low sand/beach palette.
    const capeRadius = Math.hypot(x - lighthouse.x, z - lighthouse.z) / scale;
    if (capeRadius < 36 && h > 0.2 * scale) {
      const face = Math.max(smoothstep(16.5, 27.5, capeRadius),
        smoothstep(0.65, 1.7, slope) * 0.85);
      color.copy(CAPE_GRASS).lerp(CAPE_STONE,
        face * (1 - smoothstep(33, 37, capeRadius)));
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
function buildRoads(island: IslandData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'graded-ring-road-and-trails';
  const forward = new THREE.Vector3(0, 0, 1);
  const direction = new THREE.Vector3(), midpoint = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4();
  for (const type of ['road', 'trail'] as const) {
    const segments = [...island.roads, ...makeLocalStreets(island)].filter(r => r.type === type)
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
  group.add(buildStreetDetails(island));
  group.add(buildGroundDetails(island));
  group.add(buildMeadowScatter(island));
  const props = buildPropVisuals(island.props, options.propChunkSize ?? 96);
  group.add(props.group);
  const waterVisuals = buildWaterVisuals(island);
  group.add(waterVisuals.inland, waterVisuals.sea);
  const dam = buildDamVisuals(island);
  group.add(dam.group);
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
    dam.update(elapsed);
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
    for (const batch of props.batches) {
      const distance = batch.sphere.center.distanceTo(pos);
      const visible = distance < (batch.nearOnly ? island.size * 0.32 : cullingDistance) +
        batch.sphere.radius && frustum.intersectsSphere(batch.sphere);
      for (const mesh of batch.meshes) {
        if (mesh.castShadow && mesh.visible !== visible) shadowCastersChanged = true;
        mesh.visible = visible;
      }
    }
    // The GLB supplies its own reservoir surface. Hide the procedural one
    // on success, but retain it in the graph for disposal; it remains visible
    // if the model fails and the procedural fallback is needed.
    if (dam.consumeShadowChange()) {
      const reservoir = waterVisuals.inland.getObjectByName('dam-reservoir');
      if (reservoir) reservoir.visible = false;
      shadowCastersChanged = true;
    }
    return shadowCastersChanged;
  }
  function dispose(): void {
    dam.dispose();
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
