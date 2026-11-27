import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EnvironmentLodOverride } from './environment-lod';
import type { GardenPatch } from './insect-habitats';
import { capeSurface } from './lighthouse-access';
import { SeededRandom } from './random';
import type { IslandData } from './types';
import { applyWindShader, prepareWindGeometry, type WindUniforms } from './visual-wind';

const palettes = [
  { name: 'gold', count: 9, width: .108, base: 0xe8a433, tip: 0xffea98, center: 0xcb7c2d },
  { name: 'coral', count: 5, width: .164, base: 0xb94e68, tip: 0xffb3a4, center: 0xf0bf62 },
  { name: 'violet', count: 6, width: .139, base: 0x7556a7, tip: 0xc7b5ee, center: 0xf0d399 },
];

function solidColor(mesh: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  mesh.deleteAttribute('uv');
  const tint = new THREE.Color(hex);
  const colors = new Float32Array(mesh.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
  mesh.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return mesh;
}

/** Paint a rounded cross-section into each petal and leaf, including its central fold. */
function flowerGeometry(palette: typeof palettes[number], detailed: boolean): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const paint = new THREE.Color();
  const panel = (origin: THREE.Vector3, angle: number, length: number, width: number, rise: number,
    curl: number, rootHex: number, tipHex: number): void => {
    const first = positions.length / 3, c = Math.cos(angle), s = Math.sin(angle);
    const root = new THREE.Color(rootHex), tip = new THREE.Color(tipHex);
    if (!detailed) {
      for (const [t, side] of [[0, 0], [.62, 1], [1, 0], [.62, -1]] as const) {
        const along = length * t, across = width * side;
        positions.push(origin.x + c * along - s * across, origin.y + rise * t + curl * .5 * Math.abs(side),
          origin.z + s * along + c * across);
        paint.copy(root).lerp(tip, .25 + .69 * t);
        colors.push(paint.r, paint.g, paint.b);
      }
      indices.push(first, first + 1, first + 3, first + 1, first + 2, first + 3);
      return;
    }
    for (let row = 0; row <= 5; row++) {
      const t = row / 5, arc = Math.sin(Math.PI * t);
      const span = width * (.12 * (1 - t) + .88 * arc ** .8);
      for (const side of [-1, 0, 1]) {
        const along = t * length, across = span * side;
        positions.push(origin.x + c * along - s * across,
          origin.y + rise * t + curl * arc - Math.abs(across) * .27,
          origin.z + s * along + c * across);
        paint.copy(root).lerp(tip, Math.min(1, .25 + .62 * t + (1 - Math.abs(side)) * .13));
        colors.push(paint.r, paint.g, paint.b);
      }
      if (!row) continue;
      for (let edge = 0; edge < 2; edge++) {
        const a = first + (row - 1) * 3 + edge;
        indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
      }
    }
  };
  panel(new THREE.Vector3(.025, .29, 0), .83, .50, .124, .21, .09, 0x426a42, 0x91a756);
  panel(new THREE.Vector3(.041, .44, 0), 3.72, .41, .101, .18, .15, 0x3d6940, 0x8aa451);
  for (let i = 0; i < palette.count; i++) {
    const angle = i * Math.PI * 2 / palette.count;
    const origin = new THREE.Vector3(.115 + .045 * Math.cos(angle), .875, .045 * Math.sin(angle));
    panel(origin, angle + .12, .33 + .022 * Math.cos(i * 2.4),
      palette.width, .022 + .028 * Math.sin(i * 3.2), .078, palette.base, palette.tip);
  }
  const surfaces = new THREE.BufferGeometry();
  surfaces.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  surfaces.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  surfaces.setIndex(indices);
  surfaces.computeVertexNormals();
  const stalk = new THREE.CylinderGeometry(.023, .034, .917, detailed ? 7 : 4, detailed ? 4 : 1, !detailed)
    .translate(0, .4585, 0);
  const stemPositions = stalk.getAttribute('position');
  for (let i = 0; i < stemPositions.count; i++) {
    stemPositions.setX(i, stemPositions.getX(i) + .144 * stemPositions.getY(i) ** 2);
  }
  stalk.computeVertexNormals();
  const heart = new THREE.SphereGeometry(1, detailed ? 10 : 5, detailed ? 5 : 3)
    .scale(.104, .057, .104).translate(.115, .912, 0);
  const pieces = [surfaces, solidColor(stalk, 0x557744), solidColor(heart, palette.center)];
  const flower = mergeGeometries(pieces)!;
  for (const mesh of pieces) mesh.dispose();
  prepareWindGeometry(flower, 'meadow');
  return flower;
}

/** Let the cultivated soil follow the real terrain, with an irregular feathered edge. */
function soilGeometry(island: IslandData, garden: GardenPatch): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const { position, radius, phase } = garden;
  const segments = 16, rings = [.01, .48, .81, 1];
  const earth = new THREE.Color(0x816046), dry = new THREE.Color(0x97754f), tint = new THREE.Color();
  for (const [ring, distance] of rings.entries()) {
    for (let i = 0; i < segments; i++) {
      const angle = i * 2 * Math.PI / segments, lobe = .94 + .065 * Math.sin(3 * angle + phase) +
        .035 * Math.cos(5 * angle - phase);
      const x = position.x + Math.cos(angle) * radius * distance * lobe;
      const z = position.z + Math.sin(angle) * radius * distance * lobe;
      positions.push(x, capeSurface(island, x, z) + .022 * island.size / 600, z);
      tint.copy(earth).lerp(dry, .30 + .12 * Math.sin(i * 2.3 + phase) + .26 * distance);
      colors.push(tint.r, tint.g, tint.b, ring === rings.length - 1 ? 0 : (ring === 2 ? .59 : .89));
      if (!ring) continue;
      const inner = (ring - 1) * segments, next = (i + 1) % segments;
      const a = inner + i, b = inner + next, c = a + segments, d = b + segments;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildPocketFlowers(island: IslandData, gardens: readonly GardenPatch[], wind: WindUniforms) {
  const group = new THREE.Group();
  group.name = 'garden-flowers';
  const lod = new Map<THREE.InstancedMesh, EnvironmentLodOverride>();
  if (!gardens.length) return { group, lod, dispose() {} };
  const scale = island.size / 600;
  const blooms = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  blooms.onBeforeCompile = shader => applyWindShader(shader, wind);
  blooms.customProgramCacheKey = () => 'pocket-flower-wind';
  const soil = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const batches = palettes.map(palette => {
    const mesh = new THREE.InstancedMesh(flowerGeometry(palette, true), blooms, gardens.length * 6);
    mesh.name = 'planted-pocket-' + palette.name;
    mesh.count = 0;
    mesh.receiveShadow = true;
    lod.set(mesh, { geometry: flowerGeometry(palette, false), detailDistance: 16 * scale, maxDistance: 54 * scale });
    group.add(mesh);
    return mesh;
  });
  const pose = new THREE.Object3D();
  for (const [index, garden] of gardens.entries()) {
    const plot = new THREE.Mesh(soilGeometry(island, garden), soil);
    plot.receiveShadow = true;
    group.add(plot);
    const rng = new SeededRandom(String(island.seed) + ':pocket-flowers:' + index);
    for (let stem = 0; stem < 18; stem++) {
      const angle = garden.phase + stem * 2.39996;
      const radius = (.18 + .71 * Math.sqrt(stem / 17)) * garden.radius;
      const x = garden.position.x + radius * Math.cos(angle), z = garden.position.z + radius * Math.sin(angle);
      const mesh = batches[(stem + index) % batches.length]!;
      const height = rng.range(.32, .59) * scale;
      pose.position.set(x, capeSurface(island, x, z) - .038 * scale, z);
      pose.rotation.y = angle;
      pose.scale.set(height * rng.range(.82, 1.16), height, height);
      pose.updateMatrix();
      mesh.setMatrixAt(mesh.count++, pose.matrix);
    }
  }
  for (const mesh of batches) mesh.computeBoundingSphere();
  return { group, lod, dispose() {
    for (const [mesh, far] of lod) {
      mesh.dispose();
      far.geometry.dispose();
    }
  } };
}
