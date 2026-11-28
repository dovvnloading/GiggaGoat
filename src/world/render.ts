import * as THREE from 'three';
import { buildDowntownLifeVisuals } from './visual-downtown-life';
import type { Biome, IslandData, PropKind, Vec2, Vec3 } from './types';
import { BIOMES } from './types';
import { clamp, smoothstep } from './random';
import { gridCoordinate, gridIndex, segmentProjection } from './terrain';
import { groundGrain, groundGrainTexture } from './ground-kit-grain';
import { terrainCliffMaps, terrainRockAtlas } from './terrain-paint';
import { paintDowntownGround } from './downtown-public-space';
import { buildRoadsideSigns, paintRoadsideGravel } from './visual-roadside-stops';
import { makeVillageGroundPaint, paintAsphalt } from './surface-paint';
import { roadRibbonData, SUMMIT_ASCENT_TRAIL } from './road-ribbons';
import { buildPropVisuals, TOON_RAMP } from './visual-props';
import { buildBoardwalkRailVisuals } from './visual-boardwalk-rails';
import { createEnvironmentLod } from './environment-lod';
import { buildDistrictGround, groundUV, type ApplyGroundMap } from './district-ground';
import { buildGroundDetails } from './visual-ground';
import { buildPavementDetails } from './pavement-detail';
import { buildGroundStory } from './visual-ground-story';
import { buildPollinators } from './visual-pollinators';
import { planPocketGardens } from './insect-habitats';
import { buildGardenSpinners } from './visual-garden-spinners';
import { buildPocketFlowers } from './visual-pocket-flowers';
import { buildStreetDetails } from './visual-streets';
import { buildHabitatBeds } from './habitat-beds';
import { buildMeadowScatter } from './visual-meadow';
import { buildVergeVisuals } from './visual-verges';
import { buildHarborLife } from './visual-harbor-life';
import { buildWaterVisuals } from './visual-water';
import { buildTideRouteCues, meshSurfaceHeight } from './visual-tide-routes';
import { buildDamVisuals } from './visual-dam';
import { buildLighthouseVisuals, makeCapeLighting } from './visual-lighthouse';
import { buildHoofingtonVisuals } from './visual-hoofington';
import { buildDowntownVisuals } from './visual-downtown';
import { buildMountainWayfinding } from './visual-mountain';
import { paintPinesLogAprons } from './visual-pines-log-access';
import { isPinesDeckStilt } from './visual-pines-deck-stilts';
import { DAM_PINES_BRIDGE_PREFIX, MOUNTAIN_SPIRAL_BRIDGE_PREFIX } from './roads';
import type { IslandWeather } from './island-weather';
import { pinesFireflies } from './pines-fireflies';
import { weatherSurface } from './weather-surfaces';
import { districtSetVisuals } from './visual-district-sets';
import { buildSkyVisuals, skyUniforms, type LightingPreset } from './visual-sky';
import { createWindUniforms } from './visual-wind';

export { isDowntownRoadOverlay, isHoofingtonTrailOverlay } from './road-ribbons';

export interface WorldSceneOptions {
  /** Segments per terrain chunk, default 32. */
  chunkSegments?: number;
  /** Maximum distance for full-sized geometry, defaults to 1.4 island widths. */
  cullingDistance?: number;
  /** Spatial extent of one prop instancing batch, default 96 metres. */
  propChunkSize?: number;
  /** The active game selects nearby shadow casters within its quality budget. */
  gameplaySelectsCasters?: boolean;
  /** Playable views may render these props through their physics-bound roots. */
  externallyRenderedPropKinds?: ReadonlySet<PropKind>;
  /** Destruction also removes source-linked art from the district lamp batches. */
  destroyedProps?: ReadonlySet<string>;
}
export interface WorldScene {
  group: THREE.Group;
  chunks: THREE.Mesh[];
  water: THREE.Mesh;
  sun: THREE.DirectionalLight;
  /** Actual sky-dome horizon colour, kept in sync on each lighting update. */
  fogColor: THREE.Color;
  /** Phase 0..1, midpoint is noon; backward-compatible with the original lane. */
  setDayNight(phase: number, weather?: IslandWeather): void;
  /** Day, painterly golden hour and starry night bookmarks. */
  setLightingPreset(preset: LightingPreset): void;
  setShopLighting(baking: boolean, recordGlow: number): void;
  /** Set the sea level. The Lab shows escape cues above baseline unless the host opts out. */
  setTideLevel(level: number, showRoutes?: boolean): void;
  /** Nearest painted cue still connected to the summit above this tide. */
  tideRouteTarget(position: Vec2): Vec3 | undefined;
  /** Animate scenery with elapsed seconds. A nearby player can disturb insects. */
  update(time: number, player?: Vec3): void;
  /** Cull scenery and select terrain detail. Returns true when shadow casters changed. */
  updateCulling(camera: THREE.Camera, sightseeing?: boolean, terrainDetailDistance?: number): boolean;
  dispose(): void;
}
export type { LightingPreset } from './visual-sky';

interface Chunk {
  mesh: THREE.Mesh;
  sphere: THREE.Sphere;
  high: THREE.BufferGeometry;
  low: THREE.BufferGeometry;
  horizon: THREE.BufferGeometry;
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

// Wear under working yards, market aisles and camps shares the terrain surface.
const DISTRICT_GROUND = {
  'hoofington': new THREE.Color('#b08c5c'),
  'baa-ardwalk': new THREE.Color('#d5bb89'),
  'crane-yard': new THREE.Color('#938b7e'),
  'downtown-bleatsville': new THREE.Color('#ac9c85'),
  'mt-gigga': new THREE.Color('#9a8b77'),
  'whispering-pines': new THREE.Color('#866e50'),
  'the-dam': new THREE.Color('#97948a'),
  'old-lighthouse': new THREE.Color('#b4a38a'),
} as const;

const CAPE_GRASS = new THREE.Color('#7FBF56');
const CAPE_STONE = new THREE.Color('#A8A9B1');
const MT_GIGGA_STONE = new THREE.Color(0xa39a96);
// Terrain stretches each light band across metres of hillside. Blend the same
// painterly palette between bands so a single terrain triangle cannot pop.
const TERRAIN_RAMP = TOON_RAMP.clone();
TERRAIN_RAMP.magFilter = THREE.LinearFilter;
TERRAIN_RAMP.minFilter = THREE.LinearFilter;
TERRAIN_RAMP.needsUpdate = true;

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
  roads: Map<string, RoadSample[]>,
): THREE.BufferGeometry {
  const n = island.resolution, metres = island.size / (n - 1);
  const cx = gridCoordinate(island.size, n, startX + countX / 2);
  const cz = gridCoordinate(island.size, n, startZ + countZ / 2);
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const groundWeights: number[] = [];
  const color = new THREE.Color();
  const lighthouse = island.pois.find(p => p.id === 'old-lighthouse')!.center;
  const scale = island.size / 600;
  const workingGround = (island.districtSets ?? []).flatMap(set => set.pieces.map(piece => ({
    centre: piece.bottom, radius: piece.length * .67 + 2.8 * scale, paint: DISTRICT_GROUND[set.district],
    paved: ['downtown-bleatsville', 'crane-yard', 'the-dam'].includes(set.district),
  }))).filter(p => Math.abs(p.centre.x - cx) <= countX * metres / 2 + p.radius &&
    Math.abs(p.centre.z - cz) <= countZ * metres / 2 + p.radius);
  const approachWidth = 3.4 * scale;
  const approaches = (island.districtSets ?? []).filter(({ approach: { from, to } }) =>
    Math.min(from.x, to.x) <= cx + countX * metres / 2 + approachWidth &&
    Math.max(from.x, to.x) >= cx - countX * metres / 2 - approachWidth &&
    Math.min(from.z, to.z) <= cz + countZ * metres / 2 + approachWidth &&
    Math.max(from.z, to.z) >= cz - countZ * metres / 2 - approachWidth);
  const sample = (x: number, z: number): number =>
    island.heights[gridIndex(n, Math.max(0, Math.min(n - 1, x)),
      Math.max(0, Math.min(n - 1, z)))]!;
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
    color.lerp(COLORS.sand, 1 - smoothstep(1.2, 2.9, h + 0.5 * Math.sin(x * 0.13) * Math.cos(z * 0.11)));
    const cliff = Math.max(smoothstep(0.56, 1.35, slope),
      smoothstep(82, 112, h) * 0.25);
    if (biome === 'freshwater') color.lerp(COLORS.freshwater, 0.7);
    if (h < -0.4) color.lerp(COLORS.submerged, 0.8);

    // Keep Mt Gigga's grassy palette in the vertex colours. Its steep
    // risers and stratified stone are blended per fragment in the shader.
    const radius = Math.hypot(x, z) / scale;
    const mountain = 1 - smoothstep(99, 113, radius);
    if (mountain > 0) {
      const grassy = COLORS.grass.clone().lerp(COLORS.pine, 0.12);
      color.copy(grassy).lerp(base, 1 - mountain);
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
    const baseChannel = biome === 'industrial' ? 3 : cliff > .5 ? 2 : biome === 'beach' || trail > .5 ? 1 : 0;
    const broad = groundGrain(x / (4 * scale), z / (4 * scale), baseChannel);
    const fine = groundGrain(-z / scale, x / scale, baseChannel);
    const meadow = biome === 'meadow' || biome === 'farmland' || biome === 'town';
    if (meadow && cliff < 0.4 && mountain < 0.1) {
      color.lerp(COLORS.dirt, Math.max(0, -broad - 0.3) * 0.12);
      color.lerp(COLORS.pine, Math.max(0, broad - 0.1) * 0.09);
    }
    let wear = 0, paved = false;
    let soil: THREE.Color | undefined;
    for (const patch of workingGround) {
      const px = x - patch.centre.x, pz = z - patch.centre.z;
      const ratio = (px * px + pz * pz) / (patch.radius * patch.radius);
      if (ratio >= 1) continue;
      const weight = 1 - smoothstep(.09, 1, ratio);
      if (weight > wear) { wear = weight; soil = patch.paint; paved = patch.paved; }
    }
    // Paint the surveyed route from the public path to the pad, including the verge.
    for (const site of approaches) {
      const distance = segmentProjection({ x, z }, site.approach.from, site.approach.to).distance;
      const weight = .87 * (1 - smoothstep(.75 * scale, approachWidth, distance));
      if (weight <= wear) continue;
      wear = weight;
      soil = DISTRICT_GROUND[site.district];
      paved = site.district === 'the-dam' || site.district === 'downtown-bleatsville' || site.district === 'crane-yard';
    }
    if (soil) color.lerp(soil, wear * (.80 + fine * .09));
    const concrete = (1 - cliff) * Math.max(paved ? wear : 0, biome === 'industrial' ? .82 : 0);
    const softGround = Math.max(0, 1 - cliff - concrete);
    const dirt = softGround * Math.max(trail, wear, biome === 'beach' ? 1 : biome === 'pine-forest' ? .38 : 0);
    groundWeights.push(softGround - dirt, dirt, cliff, concrete);
    const variation = .98 + broad * .15 + fine * .065;
    color.multiplyScalar(ambient * variation);
    colors.push(color.r, color.g, color.b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('kitGroundWeights', new THREE.Float32BufferAttribute(groundWeights, 4));
  geometry.computeBoundingSphere();
  return geometry;
}

/** All levels share the native vertices and keep the same perimeter along neighbouring chunks. */
function terrainLod(source: THREE.BufferGeometry, countX: number, countZ: number, lodStep: number): THREE.BufferGeometry {
  const geometry = lodStep === 1 ? source : new THREE.BufferGeometry();
  if (geometry !== source) {
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    geometry.boundingSphere = source.boundingSphere;
  }
  const indices: number[] = [];
  const stride = countX + 1;
  const vertex = (x: number, z: number): number => z * stride + x;
  // A one-cell strip has no interior vertex for a seam fan. Keep narrow chunks
  // native and absorb a single leftover cell into its neighbour elsewhere.
  const step = Math.min(countX, countZ) === 1 ? 1 : lodStep;
  const divisions = (length: number) => {
    const edges = [0];
    for (let i = step; i < length; i += step) {
      if (step === 1 || length - i > 1) edges.push(i);
    }
    return [...edges, length];
  };
  const xs = divisions(countX), zs = divisions(countZ);
  for (let j = 1; j < zs.length; j++) for (let i = 1; i < xs.length; i++) {
    const x = xs[i - 1]!, x1 = xs[i]!, z = zs[j - 1]!, z1 = zs[j]!;
    const a = vertex(x, z), b = vertex(x1, z);
    const c = vertex(x, z1), d = vertex(x1, z1);
    const touchesSeam = x === 0 || z === 0 || x1 === countX || z1 === countZ;
    if (step === 1 || !touchesSeam) {
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
  geometry.setIndex(indices);
  return geometry;
}
function buildTerrain(island: IslandData, segments: number,
  capeLighting: ReturnType<typeof makeCapeLighting>, atmosphere: ReturnType<typeof skyUniforms>): Chunk[] {
  const n = island.resolution;
  const material = new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap: TERRAIN_RAMP, side: THREE.FrontSide,
  });
  // One filtered sample carries the continuous grass/stone edge and foot shadow at both LODs.
  const cliffData = terrainRockAtlas(island);
  terrainCliffMaps.set(material, { data: cliffData, size: island.size, samples: n,
    stone: COLORS.rock, mountainStone: MT_GIGGA_STONE });
  const rockMask = new THREE.DataTexture(cliffData, n, n, THREE.RGFormat);
  rockMask.magFilter = THREE.LinearFilter;
  rockMask.minFilter = THREE.LinearMipmapLinearFilter;
  rockMask.generateMipmaps = true;
  rockMask.needsUpdate = true;
  const groundTile = groundGrainTexture();
  material.addEventListener('dispose', () => { rockMask.dispose(); groundTile.dispose(); });
  const villagePaint = makeVillageGroundPaint(island, material);
  material.addEventListener('dispose', () => villagePaint.map.dispose());
  material.onBeforeCompile = shader => {
    shader.uniforms['uRockStone'] = { value: COLORS.rock };
    shader.uniforms['uMountainStone'] = { value: MT_GIGGA_STONE };
    shader.uniforms['uTerrainScale'] = { value: island.size / 600 };
    shader.uniforms['uKitGround'] = { value: groundTile };
    shader.uniforms['uTerrainRockMask'] = { value: rockMask };
    // Map terrain grid endpoints to the first and last texel centres.
    shader.uniforms['uRockUvScale'] = { value: (n - 1) / (n * island.size) };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
attribute vec4 kitGroundWeights;
varying vec4 vGroundWeights;
varying vec3 vWorld;`,
    ).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vGroundWeights = kitGroundWeights;
vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform vec3 uRockStone;
uniform vec3 uMountainStone;
uniform float uTerrainScale;
uniform sampler2D uTerrainRockMask;
uniform sampler2D uKitGround;
uniform float uRockUvScale;
varying vec4 vGroundWeights;
varying vec3 vWorld;`,
    ).replace(
      '#include <color_fragment>',
      `#include <color_fragment>
vec2 cliffPaint = texture2D(uTerrainRockMask, vWorld.xz * uRockUvScale + 0.5).rg;
float elevation = vWorld.y / uTerrainScale;
float rock = smoothstep(0.14, 0.51, cliffPaint.r + 0.04 * smoothstep(16.0, 85.0, elevation));
vec3 footTint = vec3(0.70, 0.67, 0.61);
diffuseColor.rgb *= mix(vec3(1.0), footTint, cliffPaint.g * 0.24);
if (rock > 0.0) {
  vec2 terrainXZ = vWorld.xz / uTerrainScale;
  float mountain = 1.0 - smoothstep(99.0, 113.0, length(terrainXZ));
  vec3 uStone = mix(uRockStone, uMountainStone, mountain);
  // World-height strata cross triangles and continue round the cliff.
  // Two phases and lateral warp avoid uniform stripes on successive terraces.
  float bedding = elevation + 2.8 * sin(dot(terrainXZ, vec2(0.05, 0.026)))
    + 1.5 * sin(dot(terrainXZ, vec2(-0.033, 0.105)));
  float bands = 0.74 * sin(bedding * 0.49) + 0.26 * sin(bedding * 0.23 + 0.62);
  float layer = smoothstep(-0.56, 0.52, bands);
  vec3 strata = mix(vec3(0.66, 0.70, 0.73), vec3(1.19, 1.15, 1.09), layer);
  uStone *= mix(vec3(1.0), strata, 0.6 + 0.4 * mountain);
  uStone *= mix(vec3(1.0), footTint, cliffPaint.g);
  diffuseColor.rgb = mix(diffuseColor.rgb, uStone, rock);
}
vec2 grainUV = vWorld.xz / (5.6 * uTerrainScale);
vec4 grain = .72 * texture2D(uKitGround, grainUV) + .28 * texture2D(uKitGround, vec2(-grainUV.y, grainUV.x) * .43);
diffuseColor.rgb *= 1.0 + .65 * (dot(grain, vGroundWeights) - .5);`,
    );
    villagePaint.apply(shader);
    paintDowntownGround(shader, island);
    paintRoadsideGravel(shader, island);
    paintPinesLogAprons(shader, island);
    capeLighting.paint(shader);
    weatherSurface(shader, atmosphere, false);
  };
  const lookup = roadGrid(island, 22);
  const chunks: Chunk[] = [];
  for (let startZ = 0; startZ < n - 1; startZ += segments) {
    for (let startX = 0; startX < n - 1; startX += segments) {
      const countX = Math.min(segments, n - 1 - startX);
      const countZ = Math.min(segments, n - 1 - startZ);
      const cx = gridCoordinate(island.size, n, startX + countX / 2);
      const cz = gridCoordinate(island.size, n, startZ + countZ / 2);
      const vertices = terrainGeometry(island, startX, startZ, countX, countZ, lookup);
      const high = terrainLod(vertices, countX, countZ, 1);
      const low = terrainLod(vertices, countX, countZ, 2);
      // Preserve the graded summit switchbacks and their cut banks at every distance.
      const cellSize = island.size / (n - 1);
      const mountainDistance = Math.hypot(Math.max(0, Math.abs(cx) - countX * cellSize / 2),
        Math.max(0, Math.abs(cz) - countZ * cellSize / 2));
      const horizon = mountainDistance <= 100 * island.size / 600 ? low : terrainLod(vertices, countX, countZ, 6);
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
      chunks.push({ mesh, sphere, high, low, horizon });
    }
  }
  return chunks;
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

function buildRoads(island: IslandData, terrain: readonly Chunk[], atmosphere: ReturnType<typeof skyUniforms>,
  applyMap: ApplyGroundMap): THREE.Group {
  const group = new THREE.Group();
  group.name = 'graded-ring-road-and-trails';
  const forward = new THREE.Vector3(0, 0, 1);
  const midpoint = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const route = island.roads.find(road => road.id === SUMMIT_ASCENT_TRAIL);
  const nearby = route ? terrain.filter(({ sphere }) => route.points.some(point =>
    Math.hypot(point.x - sphere.center.x, point.z - sphere.center.z) <= sphere.radius + route.width)) : [];
  const surface = (lod: 'high' | 'low') => meshSurfaceHeight(nearby.map(chunk => ({
    geometry: chunk[lod], x: chunk.mesh.position.x, z: chunk.mesh.position.z,
  })), island.size / 600);
  const near = surface('high'), far = surface('low');
  const summitGround = (x: number, z: number) => Math.min(near(x, z), far(x, z));

  for (const type of ['road', 'trail'] as const) {
    const { positions, indices, segments, crossSections, skirtVertices } = roadRibbonData(island, type, summitGround);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshToonMaterial({
      color: type === 'road' ? 0x727e8a : 0xc3a06c, gradientMap: TOON_RAMP,
    });
    if (type === 'road') {
      geometry.setAttribute('roadCrossSection', new THREE.Float32BufferAttribute(crossSections, 2));
      paintAsphalt(material, island);
      const paint = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        paint.call(material, shader, renderer);
        weatherSurface(shader, atmosphere, true);
      };
    } else {
      const tile = 5.4 * island.size / 600;
      groundUV(geometry, tile);
      // The two skirt edges have identical XZ at top and bottom. Unwrap their
      // height separately so sloping trail embankments retain stone detail.
      const uv = geometry.getAttribute('uv');
      for (const i of skirtVertices) {
        uv.setXY(i, (positions[i * 3]! + positions[i * 3 + 2]!) / tile, positions[i * 3 + 1]! / tile);
      }
      applyMap(material, 'mt-gigga', 0xf5f1e8);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'paths-' + type;
    mesh.receiveShadow = true;
    group.add(mesh);

    if (type === 'road') {
      // Index across every *kept* road segment, exactly as the old slabs did.
      const marks = segments.filter((segment, i) => i % 5 === 0 &&
        !isHoofingtonCrossingDash(island, segment.a, segment.b));
      const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshLambertMaterial({ color: 0xffe0a5 }), marks.length);
      dashes.receiveShadow = true;
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
  const capeLighting = makeCapeLighting(island);
  const sky = buildSkyVisuals();
  const wind = createWindUniforms(island.seed);
  const chunks = buildTerrain(island, segments, capeLighting, sky.atmosphere);
  for (const chunk of chunks) group.add(chunk.mesh);
  const finish = buildDistrictGround(island);
  group.add(finish.group);
  const roads = buildRoads(island, chunks, sky.atmosphere, finish.applyMap);
  group.add(roads);
  const kitSets = districtSetVisuals(island.districtSets ?? [], options.gameplaySelectsCasters, island);
  group.add(kitSets.group);
  const roadsideSigns = buildRoadsideSigns(island);
  if (roadsideSigns) group.add(roadsideSigns);
  const tideRoutes = buildTideRouteCues(island, roads, chunks.map(chunk => ({
    geometry: chunk.low, x: chunk.mesh.position.x, z: chunk.mesh.position.z,
  })));
  group.add(tideRoutes.mesh);
  const streets = buildStreetDetails(island, finish.applyMap);
  group.add(streets);
  // Coalesce unchanged ground decals to keep the extra zebra mesh within the draw budget.
  const ground = buildGroundDetails(island, 192, finish.applyMap);
  group.add(ground, buildPavementDetails(island, ground, streets, roads));
  group.add(buildMeadowScatter(island, sky.atmosphere, finish.pavedAt, wind));
  const verges = buildVergeVisuals(island, finish.pavedAt);
  group.add(verges.group);
  const groundStory = buildGroundStory(island, finish.pavedAt);
  const gardens = planPocketGardens(island, finish.pavedAt);
  const pollinators = buildPollinators(island, gardens);
  const spinners = buildGardenSpinners(island, gardens);
  const flowers = buildPocketFlowers(island, gardens, wind);
  const beds = buildHabitatBeds(island);
  group.add(groundStory.group, pollinators.group, beds.group, flowers.group, spinners.group);
  const fireflies = pinesFireflies(island);
  group.add(fireflies.swarm);
  const external = options.externallyRenderedPropKinds;
  const scenery = external?.size
    ? { ...island, props: island.props.filter(prop => !external.has(prop.kind)) }
    : island;
  const waterVisuals = buildWaterVisuals(island, sky.atmosphere);
  const boardwalkRails = buildBoardwalkRailVisuals(scenery);
  if (boardwalkRails) group.add(boardwalkRails.mesh);
  const replacedProps = new Set(waterVisuals.replacedCascadeIds);
  // The lookout model (and its packed fallback) already contains a deck.
  // Keep the co-located platform descriptor for physics, but do not draw it.
  const lookouts = scenery.props.filter(p => p.poiId === 'whispering-pines' && p.kind === 'lookout');
  for (const deck of scenery.props) {
    if (deck.poiId !== 'whispering-pines' || deck.kind !== 'platform') continue;
    if (lookouts.some(tower => Math.hypot(deck.transform.position.x - tower.transform.position.x,
      deck.transform.position.z - tower.transform.position.z) < .001 * island.size / 600)) {
      replacedProps.add(deck.id);
    }
  }
  for (const deck of island.colliders) {
    if (deck.shape === 'convex' &&
      (deck.id.startsWith(MOUNTAIN_SPIRAL_BRIDGE_PREFIX) || deck.id.startsWith(DAM_PINES_BRIDGE_PREFIX))) {
      replacedProps.add(deck.id);
    }
  }
  const instancedProps = scenery.props.filter(prop => {
    if (boardwalkRails?.replacedIds.has(prop.id)) return false;
    const { x, z } = prop.transform.position;
    return prop.collidable || (prop.kind !== 'flower' && prop.kind !== 'grass-tuft') || !finish.pavedAt(x, z);
  });
  const pinesStilts = instancedProps.filter(isPinesDeckStilt);
  const pinesGround = chunks.filter(chunk => pinesStilts.some(stilt => {
    const at = stilt.transform.position;
    const radius = Math.hypot(stilt.size.x, stilt.size.z) * .5;
    return Math.hypot(at.x - chunk.mesh.position.x, at.z - chunk.mesh.position.z) <= chunk.sphere.radius + radius;
  })).map(chunk => ({ geometry: chunk.low, x: chunk.mesh.position.x, z: chunk.mesh.position.z }));
  const distantPinesGround = pinesGround.length ? meshSurfaceHeight(pinesGround, island.size / 600) : undefined;
  const props = buildPropVisuals(instancedProps, options.propChunkSize ?? 96, scenery, replacedProps, distantPinesGround, wind);
  group.add(props.group);
  const hoofington = buildHoofingtonVisuals(scenery, props.group, options.destroyedProps);
  group.add(hoofington.group);
  const downtown = buildDowntownVisuals(scenery, props.group, options.destroyedProps);
  group.add(downtown.group);
  const downtownLife = buildDowntownLifeVisuals(island);
  group.add(downtownLife.group);
  group.add(waterVisuals.inland, waterVisuals.sea, waterVisuals.mountain);
  const harborLife = buildHarborLife(island);
  group.add(harborLife.group);
  const dam = buildDamVisuals(island, waterVisuals.light);
  group.add(dam.group);
  const lighthouse = buildLighthouseVisuals(scenery, props.group, capeLighting, finish.applyMap);
  group.add(lighthouse.group);
  group.add(buildMountainWayfinding(island));
  const fogColor = new THREE.Color();
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
  sun.shadow.camera.updateProjectionMatrix();
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
  const environmentLod = createEnvironmentLod(group, flowers.lod);
  let tide = island.seaLevel;
  let elapsed = 0;
  let playerPosition: Vec3 | undefined;
  let daylight = 1, rain = 0;

  const sunsetKey = new THREE.Color(0xffbc80), moonKey = new THREE.Color(0xaabdf9);
  function setDayNight(phase: number, weather?: IslandWeather): void {
    const state = sky.update(((phase % 1) + 1) % 1, weather);
    daylight = state.daylight;
    rain = weather?.rain ?? 0;
    const storm = weather ? THREE.MathUtils.smoothstep(weather.cloud, .46, .96) : 0;
    waterVisuals.setLighting(state.daylight * (1 - .33 * storm), state.golden * (1 - storm));
    fireflies.update(weather?.time ?? elapsed, state.daylight, weather?.rain ?? 0);
    dam.refreshWaterLight();
    capeLighting.setSun(state.golden, state.direction);
    lighthouse.setLighting(state.daylight, state.golden);
    fogColor.copy(state.horizon);
    sun.position.copy(state.direction).multiplyScalar(560);
    sun.intensity = 0.07 + state.daylight * 1.55;
    fill.intensity = 0.19 + state.daylight * 0.98;
    sun.color.setHex(state.altitude < 0.38 ? 0xffb87f : 0xffebcb);
    if (weather) {
      const moon = THREE.MathUtils.smoothstep(-state.altitude, .02, .30);
      if (state.altitude < 0) sun.position.negate();
      sun.position.y = Math.max(95, sun.position.y);
      sun.intensity = (.25 + 1.75 * state.daylight + .40 * moon) * (1 - .77 * storm);
      fill.intensity = .50 + .45 * state.daylight + .30 * storm;
      fill.color.setRGB(.46 + .15 * state.daylight, .61 + .16 * state.daylight, .92);
      sun.color.setHex(0xffeac9).lerp(sunsetKey, state.golden).lerp(moonKey, moon);
    }
  }
  function setLightingPreset(preset: LightingPreset): void {
    const phases: Record<LightingPreset, number> = {
      day: 0.5, 'golden-hour': 0.285, night: 0.025,
    };
    setDayNight(phases[preset]);
  }
  function setTideLevel(level: number, showRoutes = level > island.seaLevel): void {
    if (!Number.isFinite(level)) throw new RangeError('Tide height must be finite');
    tide = level;
    waterVisuals.update(elapsed, tide);
    dam.setWaterLevel(tide);
    tideRoutes.update(tide, showRoutes);
  }
  function update(time: number, player?: Vec3): void {
    elapsed = Number.isFinite(time) ? Math.max(0, time) : elapsed;
    playerPosition = player;
    waterVisuals.update(elapsed, tide);
    props.update(elapsed, rain);
    dam.update(elapsed);
  }
  function updateCulling(camera: THREE.Camera, sightseeing = false, terrainDetailDistance = cullingDistance): boolean {
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    const pos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    let shadowCastersChanged = false;
    for (const chunk of chunks) {
      const dist = chunk.sphere.center.distanceTo(pos);
      chunk.mesh.visible = frustum.intersectsSphere(chunk.sphere);
      const lod = dist > terrainDetailDistance ? chunk.horizon :
        dist > island.size * (sightseeing ? .22 : .45) ? chunk.low : chunk.high;
      if (chunk.mesh.geometry !== lod) chunk.mesh.geometry = lod;
    }
    const railBounds = boardwalkRails?.mesh.boundingSphere;
    if (boardwalkRails && railBounds) {
      boardwalkRails.mesh.visible = railBounds.center.distanceTo(pos) <= cullingDistance + railBounds.radius &&
        frustum.intersectsSphere(railBounds);
    }
    finish.update(pos);
    verges.update(pos, frustum);
    groundStory.update(pos, frustum);
    pollinators.update(elapsed, tide, daylight, rain, pos, frustum, playerPosition);
    spinners.update(elapsed, tide, rain, pos, frustum);
    harborLife.update(elapsed, tide, daylight, rain, pos, frustum);
    downtownLife.update(elapsed, daylight, rain, pos);
    dam.updateCulling(pos);
    lighthouse.updateCulling(pos);
    if (kitSets.update(pos)) shadowCastersChanged = true;
    if (props.updateCulling(pos, frustum, cullingDistance,
      mesh => hoofington.isFallbackHidden(mesh) || downtown.isFallbackHidden(mesh) ||
        lighthouse.isFallbackHidden(mesh)))
      shadowCastersChanged = true;
    if (hoofington.updateCulling(pos, frustum, sightseeing)) shadowCastersChanged = true;
    if (downtown.updateCulling(pos, frustum, daylight, sightseeing)) shadowCastersChanged = true;
    if (environmentLod.updateCulling(camera, pos, frustum)) shadowCastersChanged = true;
    if (props.consumeShadowChange()) shadowCastersChanged = true;
    if (hoofington.consumeShadowChange()) shadowCastersChanged = true;
    if (downtown.consumeShadowChange()) shadowCastersChanged = true;
    if (dam.consumeShadowChange()) shadowCastersChanged = true;
    return shadowCastersChanged;
  }
  function dispose(): void {
    finish.dispose();
    kitSets.dispose();
    beds.dispose();
    flowers.dispose();
    harborLife.dispose();
    pollinators.dispose();
    spinners.dispose();
    environmentLod.dispose();
    props.dispose();
    boardwalkRails?.mesh.dispose();
    hoofington.dispose();
    downtown.dispose();
    downtownLife.dispose();
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
    for (const chunk of chunks) {
      geometries.add(chunk.high);
      geometries.add(chunk.low);
      geometries.add(chunk.horizon);
    }
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    group.removeFromParent();
  }
  setDayNight(0.5);
  waterVisuals.update(elapsed, tide);
  return {
    group, chunks: chunks.map(c => c.mesh), water: waterVisuals.sea,
    sun, fogColor, setDayNight, setLightingPreset, setTideLevel, setShopLighting: downtown.setShopLighting,
    tideRouteTarget: tideRoutes.nearestDryCue, update, updateCulling, dispose,
  };
}
