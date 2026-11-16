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
const GARDEN = new THREE.Color('#6F8549');
const STONE = new THREE.Color('#D8C7A7');
const TILE = new THREE.Color('#C2B6A2');
const GRAVEL = new THREE.Color('#E1C18B');

/**
 * Static decals are tessellated against the ACTUAL stamped terrain and merged
 * by spatial chunk. One draw per visible chunk, rather than one mesh per
 * flower bed, sidewalk slab or individual fountain-square stone.
 */
export function buildGroundDetails(island: IslandData, chunkSize = 96): THREE.Group {
  const group = new THREE.Group();
  group.name = 'merged-ground-details';
  const buckets = new Map<string, ChunkBuffer>();
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
    color: THREE.Color, shade = 1): number {
    const index = bucket.positions.length / 3;
    bucket.positions.push(x, gridSample(island, x, z) + 0.075 * scale, z);
    bucket.colors.push(...colour(color, shade));
    return index;
  }
  function quad(x: number, z: number, width: number, length: number,
    color: THREE.Color, yaw = 0): void {
    const bucket = verticesAt(x, z);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const corners: [number, number][] = [
      [-width / 2, -length / 2], [width / 2, -length / 2],
      [-width / 2, length / 2], [width / 2, length / 2],
    ];
    const v = corners.map(([dx, dz], i) => addVertex(
      bucket, x + c * dx + s * dz, z - s * dx + c * dz,
      color, 0.965 + (i % 3) * 0.015,
    ));
    bucket.indices.push(v[0]!, v[2]!, v[1]!, v[1]!, v[2]!, v[3]!);
  }
  function disc(x: number, z: number, radius: number,
    color: THREE.Color, sides = 28): void {
    const bucket = verticesAt(x, z);
    const mid = addVertex(bucket, x, z, color, 1.035);
    const rim: number[] = [];
    for (let i = 0; i < sides; i++) {
      const angle = i * Math.PI * 2 / sides;
      rim.push(addVertex(bucket,
        x + Math.cos(angle) * radius, z + Math.sin(angle) * radius,
        color, 0.93 + (i % 4) * 0.015));
    }
    for (let i = 0; i < sides; i++) {
      bucket.indices.push(mid, rim[(i + 1) % sides]!, rim[i]!);
    }
  }
  // Farm path, picket-fenced flower beds and little dirt approaches to doors.
  const farm = site('hoofington');
  for (const side of [-1, 1]) {
    for (let i = 0; i < 13; i++) {
      const z = farm.z + (-34 + i * 5.5) * scale;
      quad(farm.x + side * 15.2 * scale, z,
        4.1 * scale, 4.6 * scale, i % 3 === 0 ? GARDEN : DIRT);
    }
    for (const dz of [-19, -9, 11, 12, 29]) {
      quad(farm.x + side * 12.5 * scale, farm.z + dz * scale,
        5.8 * scale, 2.3 * scale, GRAVEL, Math.PI / 2);
    }
    quad(farm.x + side * 27 * scale, farm.z + 30 * scale,
      11 * scale, 8 * scale, GARDEN);
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
  disc(city.x - 39 * scale, city.z - 3 * scale, 14.8 * scale, TILE, 36);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    const x = city.x + (-39 + Math.cos(a) * 12.4) * scale;
    const z = city.z + (-3 + Math.sin(a) * 12.4) * scale;
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
  for (const [key, bucket] of buckets) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));
    geometry.setIndex(bucket.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ground-detail-chunk-' + key;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  return group;
}
