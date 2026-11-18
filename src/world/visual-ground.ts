import * as THREE from 'three';
import type { IslandData, PoiId } from './types';
import { gridSample } from './terrain';
import { TOON_RAMP } from './visual-props';

interface ChunkBuffer {
  positions: number[];
  colors: number[];
  indices: number[];
}

const DIRT = new THREE.Color('#B99262');
/** Hoofington front gardens (painting 08): dark soil beds and pale stone paths. */
const SOIL = new THREE.Color(0x7b5a3a);
const CROP_ROW = new THREE.Color(0x6fb34a);
const STONE_PATH = new THREE.Color('#DDD3C2');
const STONE = new THREE.Color('#D8C7A7');
const TILE = new THREE.Color('#C2B6A2');
const GRAVEL = new THREE.Color('#E1C18B');
const YARD_CONCRETE = new THREE.Color('#A7A3A0');
const YARD_PUDDLE = new THREE.Color(0x53686e);
const YARD_WET_EDGE = new THREE.Color(0x656663);
const YARD_MARKING = new THREE.Color('#EDC350');

/**
 * Static decals are tessellated against the ACTUAL stamped terrain and merged
 * by spatial chunk. One draw per visible chunk, rather than one mesh per
 * flower bed, sidewalk slab or individual fountain-square stone.
 */
export function buildGroundDetails(island: IslandData, chunkSize = 96): THREE.Group {
  const group = new THREE.Group();
  group.name = 'merged-ground-details';
  const buckets = new Map<string, ChunkBuffer>();
  const apron: ChunkBuffer = { positions: [], colors: [], indices: [] };
  const water: ChunkBuffer = { positions: [], colors: [], indices: [] };
  const scale = island.size / 600;
  const site = (id: PoiId): { x: number; z: number } =>
    island.pois.find(p => p.id === id)!.center;
  const colour = (color: THREE.Color, factor: number): [number, number, number] =>
    [color.r * factor, color.g * factor, color.b * factor];

  function verticesAt(x: number, z: number): ChunkBuffer {
    const key = Math.floor(x / (chunkSize * scale)) + ':' +
      Math.floor(z / (chunkSize * scale));
    let result = buckets.get(key);
    if (!result) {
      result = { positions: [], colors: [], indices: [] };
      buckets.set(key, result);
    }
    return result;
  }
  function addVertex(bucket: ChunkBuffer, x: number, z: number,
    color: THREE.Color, shade = 1, lift = 0): number {
    const index = bucket.positions.length / 3;
    bucket.positions.push(x, gridSample(island, x, z) + (0.075 + lift) * scale, z);
    bucket.colors.push(...colour(color, shade));
    return index;
  }
  function quad(x: number, z: number, width: number, length: number,
    color: THREE.Color, yaw = 0, shade?: number, lift = 0,
    bucket = verticesAt(x, z)): void {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const corners: [number, number][] = [
      [-width / 2, -length / 2], [width / 2, -length / 2],
      [-width / 2, length / 2], [width / 2, length / 2],
    ];
    const v = corners.map(([dx, dz], i) => addVertex(
      bucket, x + c * dx + s * dz, z - s * dx + c * dz,
      color, shade ?? (0.965 + (i % 3) * 0.015), lift,
    ));
    bucket.indices.push(v[0]!, v[2]!, v[1]!, v[1]!, v[2]!, v[3]!);
  }
  function disc(x: number, z: number, radius: number,
    color: THREE.Color, sides = 28, lift = 0): void {
    const bucket = verticesAt(x, z);
    const mid = addVertex(bucket, x, z, color, 1.035, lift);
    const rim: number[] = [];
    for (let i = 0; i < sides; i++) {
      const angle = i * Math.PI * 2 / sides;
      rim.push(addVertex(bucket,
        x + Math.cos(angle) * radius, z + Math.sin(angle) * radius,
        color, 0.93 + (i % 4) * 0.015, lift));
    }
    for (let i = 0; i < sides; i++) {
      bucket.indices.push(mid, rim[(i + 1) % sides]!, rim[i]!);
    }
  }
  function puddle(x: number, z: number, radius: number, aspect: number, phase: number): void {
    const sides = 32;
    const center = addVertex(water, x, z, YARD_PUDDLE, 1.02, .019);
    const waterline: number[] = [], wetEdge: number[] = [];
    for (let i = 0; i < sides; i++) {
      const angle = i * Math.PI * 2 / sides;
      const reach = radius * (1 + .13 * Math.sin(3 * angle + phase) + .07 * Math.cos(5 * angle - phase));
      const dx = Math.cos(angle) * reach;
      const dz = Math.sin(angle) * reach * aspect;
      waterline.push(addVertex(water, x + .87 * dx, z + .87 * dz,
        YARD_PUDDLE, .87 + .11 * Math.max(0, Math.cos(angle - phase)), .018));
      wetEdge.push(addVertex(water, x + dx, z + dz, YARD_WET_EDGE, 1, .012));
    }
    for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides;
      water.indices.push(center, waterline[next]!, waterline[i]!,
        waterline[i]!, waterline[next]!, wetEdge[i]!,
        waterline[next]!, wetEdge[next]!, wetEdge[i]!);
    }
  }
  // Concrete panels meet on identical terrain samples without dirt gaps.
  const yard = site('crane-yard');
  const yardQuad = (x: number, z: number, width: number, length: number,
    color: THREE.Color, yaw = 0, shade?: number, lift = .009): void => quad(
    yard.x + x * scale, yard.z + z * scale, width * scale, length * scale,
    color, yaw, shade, lift, apron);
  for (let ix = -40; ix < 40; ix += 8) {
    for (let iz = -36; iz < 36; iz += 8) {
      const slabX = (ix + 40) / 8;
      const slabZ = (iz + 36) / 8;
      const shade = .988 + .012 * ((slabX * 7 + slabZ * 3) % 3) / 2;
      yardQuad(ix + 4, iz + 4, 8, 8, YARD_CONCRETE, 0, shade, 0);
    }
  }
  for (const [dx, dz, radius, aspect, phase] of [
    [-8, 14, 1.6, .64, .2], [15, -4, 1.1, .81, 1.7], [-24, -2, 2.0, .69, 2.8],
  ] as const) {
    puddle(yard.x + dx * scale, yard.z + dz * scale, radius * scale, aspect, phase);
  }
  // Loading-bay striping, crane clearance and worn yellow pedestrian marks.
  for (let i = 0; i < 13; i++) {
    yardQuad(-28 + i * 4.3, 18.5, 2.2, .23, YARD_MARKING);
  }
  for (const x of [-36, 36]) {
    for (let i = 0; i < 8; i++) {
      yardQuad(x, -28 + i * 7.5, .23, 3.1, YARD_MARKING);
    }
  }
  for (const z of [-2.5, 2.5]) {
    yardQuad(21, -12 + z, 8.4, .34, YARD_MARKING);
  }
  // Diagonal caution stripes near the fenced south entrance and crate pile.
  for (let i = 0; i < 6; i++) {
    yardQuad(12 + i * 2.2, 29, 1.2, .28, YARD_MARKING, -.62);
  }

  // Front gardens follow the painting (QA pass 2, G1): open lawn, a few
  // dark-soil flower beds along the fence and pale stone paths to the doors.
  // The old alternating dirt strips read as brown stripes from the street.
  const farm = site('hoofington');
  for (const side of [-1, 1]) {
    for (let i = 0; i < 13; i += 3) {
      const z = farm.z + (-34 + i * 5.5) * scale;
      quad(farm.x + side * 15.2 * scale, z,
        3.2 * scale, 2.0 * scale, SOIL);
    }
    for (const dz of [-19, -9, 11, 12, 29]) {
      quad(farm.x + side * 12.5 * scale, farm.z + dz * scale,
        5.8 * scale, 1.6 * scale, STONE_PATH, Math.PI / 2);
    }
    const patchX = farm.x + side * 27 * scale;
    const patchZ = farm.z + 30 * scale;
    quad(patchX, patchZ, 11 * scale, 8 * scale, SOIL);
    // Five rows along the 11 m axis, lifted 2 cm above the soil decal.
    for (const dz of [-3, -1.5, 0, 1.5, 3]) {
      quad(patchX, patchZ + dz * scale,
        10 * scale, 0.75 * scale, CROP_ROW, 0, undefined, 0.02);
    }
  }
  // The actual central street is already rendered by buildRoads, while
  // these compact sidewalk tiles make both rows accessible and inviting.
  const city = site('downtown-bleatsville');
  for (const side of [-1, 1]) {
    for (let z = -40; z < 42; z += 5.8) {
      quad(city.x + side * 8.4 * scale,
        city.z + (z + 2.8) * scale,
        4.1 * scale, 5.55 * scale, z % 2 ? STONE : TILE);
    }
    for (const z of [-29, -1, 27]) {
      quad(city.x + side * 12.7 * scale, city.z + z * scale,
        2.4 * scale, 8 * scale, GRAVEL);
    }
  }
  // Off the traffic lane: a stone plaza around the existing collidable
  // fountain, surrounded by benches and planted beds.
  disc(city.x - 40 * scale, city.z - 35 * scale, 14.8 * scale, TILE, 36);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    const x = city.x + (-40 + Math.cos(a) * 12.4) * scale;
    const z = city.z + (-35 + Math.sin(a) * 12.4) * scale;
    quad(x, z, 2.3 * scale, 1.1 * scale, STONE, a);
  }
  // Bare-earth patches behind the shops and at the village farmyard keep
  // distant lawns from reading as empty single-colour carpet.
  for (const z of [-32, -18, 4, 22, 34]) {
    quad(farm.x - 37 * scale, farm.z + z * scale,
      7 * scale, 6 * scale, DIRT, 0.15);
    quad(city.x + 37 * scale, city.z + z * scale,
      6 * scale, 5 * scale, GRAVEL, -0.09);
  }

  const material = new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap: TOON_RAMP,
    depthWrite: true, polygonOffset: true, polygonOffsetFactor: -1,
    polygonOffsetUnits: -1, side: THREE.DoubleSide,
  });
  function draw(bucket: ChunkBuffer, name: string, coat: THREE.Material): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));
    geometry.setIndex(bucket.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, coat);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  for (const [key, bucket] of buckets) draw(bucket, 'ground-detail-chunk-' + key, material);
  draw(apron, 'ground-detail-crane-apron', material);
  draw(water, 'ground-detail-crane-puddles', new THREE.MeshPhongMaterial({
    vertexColors: true, side: THREE.DoubleSide, shininess: 48, specular: 0x666860,
    transparent: true, opacity: .89, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  return group;
}
