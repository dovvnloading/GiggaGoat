import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IslandData } from './types';
import { SeededRandom } from './random';
import { gridSample, segmentProjection } from './terrain';
import { damChannelAt, DAM_CHANNEL, DAM_POOL_EXIT, DAM_WATER_SURFACE_LIFT } from './dam-landscape';
import { getDamPlacement } from './the-dam';
import { cascadePoolCentre, makeForestOutflowClearance } from './visual-water';
import { publicAssetUrl } from './public-assets';
import { fitLibraryModel, isAuthoredLibraryAsset } from './library-fit';

interface Placement {
  x: number; y: number; z: number;
  width: number; height: number; depth: number; yaw: number;
}
/** Dam river markers use the Blender buoy from the shared props kit. */
export const DAM_BUOY_MODEL = 'custom/props/buoy.glb';
export const DAM_BUOY_SIZE = { width: 1.0, height: 1.8, depth: 1.0 } as const;
/** Where the four authored Water_Fall sheets cross the visible pool in model metres. */
export const DAM_SPILLWAY_IMPACTS = {
  x: [-10.2, -1.4, 7.4, 16.2],
  z: 7.88,
  halfWidth: 3.37,
} as const;
interface AssetSet {
  name: string;
  path: string;
  placements: Placement[];
  longAxisX?: boolean;
  orange?: boolean;
  stone?: boolean;
  /** Toon override for CC0 kit pieces whose source material renders too dark. */
  tint?: number;
  onReady?: () => void;
}
export interface DamLandscapeVisuals {
  group: THREE.Group;
  update(seconds: number): void;
  setWaterLevel(tide: number): void;
  dispose(): void;
}

function overlapsPoolExit(x: number, z: number, extent: number): boolean {
  const { left, right, near, far } = DAM_POOL_EXIT;
  return x + extent > left && x - extent < right &&
    z + extent > near - 1 && z - extent < far + 3;
}

function channelWater(light: THREE.Vector3, tide: { value: number }, scale: number) {
  const vertices: number[] = [];
  const uv: number[] = [];
  const triangles: number[] = [];
  const rows = 54, columns = 10;
  const first = DAM_CHANNEL[0]!.z;
  const last = DAM_CHANNEL[DAM_CHANNEL.length - 1]!.z;
  for (let i = 0; i <= rows; i++) {
    const z = first + (last - first) * i / rows;
    const section = damChannelAt(z);
    for (let j = 0; j <= columns; j++) {
      const cross = j / columns * 2 - 1;
      const offset = (1 - Math.abs(cross)) * Math.sin(z * 0.28) * 0.35;
      vertices.push(section.x + cross * section.halfWidth + offset,
        section.level + DAM_WATER_SURFACE_LIFT, z);
      uv.push(j / columns, (z - first) / 8);
      if (i && j) {
        const k = i * (columns + 1) + j;
        triangles.push(k - columns - 2, k - columns - 1, k - 1,
          k - columns - 1, k, k - 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const time = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: time, uLight: { value: light }, uTide: tide, uScale: { value: scale },
      uOutlets: { value: new THREE.Vector4(...DAM_SPILLWAY_IMPACTS.x) },
      uImpact: { value: new THREE.Vector2(DAM_SPILLWAY_IMPACTS.z, DAM_SPILLWAY_IMPACTS.halfWidth) },
    },
    transparent: true, depthWrite: true, side: THREE.DoubleSide,
    vertexShader: [
      'varying vec2 vUv;',
      'varying vec2 vChannel;',
      'varying float vHeight;',
      'void main() {',
      ' vUv = uv;',
      ' vChannel = position.xz;',
      ' vHeight = (modelMatrix * vec4(position, 1.0)).y;',
      ' gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime, uTide, uScale;',
      'uniform vec3 uLight;',
      'uniform vec4 uOutlets;',
      'uniform vec2 uImpact;',
      'varying vec2 vUv;',
      'varying vec2 vChannel;',
      'varying float vHeight;',
      'float foamHash(vec2 cell) {',
      ' vec3 hash = fract(vec3(cell.xyx) * 0.1031);',
      ' hash += dot(hash, hash.yzx + 33.33);',
      ' return fract((hash.x + hash.y) * hash.z);',
      '}',
      'float foamNoise(vec2 point) {',
      ' vec2 cell = floor(point), blend = fract(point);',
      ' blend = blend * blend * (3.0 - 2.0 * blend);',
      ' float south = mix(foamHash(cell), foamHash(cell + vec2(1.0, 0.0)), blend.x);',
      ' float north = mix(foamHash(cell + vec2(0.0, 1.0)), foamHash(cell + 1.0), blend.x);',
      ' return mix(south, north, blend.y);',
      '}',
      'void main() {',
      ' float exposed = 1.0 - smoothstep(-0.18, 0.45, (uTide - vHeight) / uScale);',
      ' if (exposed <= 0.001) discard;',
      ' float flow = sin(vUv.y * 6.4 - uTime * 3.0 + sin(vUv.x * 16.0 + vUv.y * 1.3) * 1.7);',
      ' float wash = sin(vUv.y * 16.0 - uTime * 4.1 - vUv.x * 8.0);',
      ' float edge = smoothstep(0.70, 0.99, abs(vUv.x * 2.0 - 1.0));',
      ' // Bright, broken impact patches lead into thinner, converging trails.',
      ' float run = vChannel.y - uImpact.x;',
      ' vec4 bend = vec4(1.5, 0.5, -0.5, -1.5) * smoothstep(3.0, 25.0, run);',
      ' float curl = 0.55 * flow * smoothstep(2.0, 12.0, run);',
      ' vec4 lanes = abs(vec4(vChannel.x + curl) - uOutlets - bend);',
      ' float centre = min(min(lanes.x, lanes.y), min(lanes.z, lanes.w));',
      ' float laneMask = 1.0 - smoothstep(0.78, 1.17, centre / uImpact.y);',
      ' float entry = smoothstep(-1.35, 0.5, run) * laneMask;',
      ' float impact = entry * (1.0 - smoothstep(1.8, 9.5, run));',
      ' float trail = entry * (1.0 - smoothstep(7.0, 34.0, run));',
      ' vec2 moving = vec2(vChannel.x, vChannel.y - 3.1 * uTime);',
      ' float broad = foamNoise(moving * vec2(0.92, 0.31));',
      ' float fine = foamNoise(moving * vec2(2.4, 1.25) + 17.0);',
      ' float pixel = max(fwidth(vChannel.x), fwidth(vChannel.y));',
      ' float mottle = mix(broad, fine, 0.35 * (1.0 - smoothstep(0.3, 1.3, pixel)));',
      ' float clumps = smoothstep(0.23, 0.73, mottle);',
      ' float threads = smoothstep(0.49, 0.80, mottle + 0.12 * wash);',
      ' float foam = clamp(impact * (0.17 + 0.74 * clumps) + trail * 0.26 * threads',
      '   + edge * 0.10 * threads, 0.0, 0.96);',
      ' foam *= mix(0.42, 1.0, smoothstep(0.16, 1.0, uLight.x));',
      ' vec3 turquoise = mix(vec3(0.01, 0.50, 0.61), vec3(0.13, 0.79, 0.86),',
      '   0.52 + 0.085 * flow + 0.035 * wash);',
      ' vec3 color = mix(turquoise, vec3(0.91, 0.99, 0.98), foam);',
      ' gl_FragColor = sRGBTransferEOTF(vec4(color * uLight, 0.98 * exposed));',
      ' #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'dam-plunge-pool-and-downstream-river';
  mesh.renderOrder = 3;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return { mesh, time };
}

const PATH: readonly [number, number][] = [
  [-31, 111], [-29, 98], [-27, 83], [-24, 68],
  [-23, 53], [-24, 40], [-25, 30],
];

function pathAndFence(
  island: IslandData, group: THREE.Group, origin: THREE.Vector3, scale: number,
): Placement[] {
  const localHeight = (x: number, z: number): number =>
    (gridSample(island, origin.x + x * scale, origin.z + z * scale) - origin.y) / scale;
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const tint = [
    new THREE.Color('#B98C5A'), new THREE.Color('#C99B62'),
    new THREE.Color('#D1AB70'), new THREE.Color('#B78650'),
  ];
  let row = 0;
  for (let j = 0; j < PATH.length - 1; j++) {
    const a = PATH[j]!, b = PATH[j + 1]!;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    const nx = -dz / length, nz = dx / length;
    const steps = Math.max(2, Math.ceil(length / 2));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const centreX = a[0] + dx * t, centreZ = a[1] + dz * t;
      for (const side of [-1, 1]) {
        const x = centreX + nx * side * 3.2;
        const z = centreZ + nz * side * 3.2;
        positions.push(x, localHeight(x, z) + 0.18, z);
        const c = tint[(row + (side > 0 ? 1 : 0)) % tint.length]!;
        colors.push(c.r, c.g, c.b);
      }
      if (row) {
        const i = row * 2;
        indices.push(i - 2, i, i - 1, i - 1, i, i + 1);
      }
      row++;
    }
  }
  const end = PATH[PATH.length - 1]!;
  for (const x of [end[0] - 3.2, end[0] + 3.2]) {
    positions.push(x, localHeight(x, end[1]) + 0.18, end[1]);
    const c = tint[0]!;
    colors.push(c.r, c.g, c.b);
  }
  const i = row * 2;
  indices.push(i - 2, i, i - 1, i - 1, i, i + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const path = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({
    vertexColors: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  path.name = 'dam-foreground-winding-dirt-path';
  path.receiveShadow = true;
  group.add(path);

  const fence: Placement[] = [];
  for (let j = 0; j < PATH.length - 1; j++) {
    const a = PATH[j]!, b = PATH[j + 1]!;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    const pieces = Math.ceil(length / 5.6);
    for (let k = 0; k < pieces; k++) {
      const t = (k + 0.5) / pieces;
      const x = a[0] + dx * t + 4;
      const z = a[1] + dz * t;
      fence.push({
        x, z, y: localHeight(x, z) - 0.13,
        width: length / pieces, height: 1.85, depth: 0.72,
        yaw: -Math.atan2(dz, dx),
      });
    }
  }
  return fence;
}

function reeds(group: THREE.Group): void {
  const reeds: Placement[] = [];
  for (let i = 0; i < 38; i++) {
    const z = 28 + i * 1.95;
    const channel = damChannelAt(z);
    const side = i % 2 === 0 ? -1 : 1;
    const x = channel.x + side * (channel.halfWidth - 0.9);
    reeds.push({
      x, z, y: channel.level - 0.05,
      width: 1, height: 1.5 + (i % 5) * 0.20, depth: 1,
      yaw: i * 2.39,
    });
  }
  const stem = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.065, 0.105, 1, 5),
    new THREE.MeshToonMaterial({ color: 0x70984b }), reeds.length);
  const head = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(0.15, 0.38, 2, 6),
    new THREE.MeshToonMaterial({ color: 0xa07839 }), reeds.length);
  stem.name = 'dam-riverside-reeds';
  head.name = 'dam-cattail-heads';
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  rotation.identity();
  reeds.forEach((p, i) => {
    matrix.compose(new THREE.Vector3(p.x, p.y + p.height * 0.5, p.z),
      rotation, new THREE.Vector3(1, p.height, 1));
    stem.setMatrixAt(i, matrix);
    matrix.compose(new THREE.Vector3(p.x, p.y + p.height + 0.18, p.z),
      rotation, new THREE.Vector3(1, 1, 1));
    head.setMatrixAt(i, matrix);
  });
  for (const mesh of [stem, head]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
}

/** Small deterministic fallback rocks add bank mass before the GLB scenery arrives. */
function cliffUnderpainting(
  island: IslandData, group: THREE.Group, origin: THREE.Vector3, scale: number,
): void {
  // The right bank is rugged; the left near bank has an open footpath and
  // direction sign, so do not bury that walkable foreground under large rocks.
  const rng = new SeededRandom(String(island.seed) + ':dam-cliff-base');
  const pieces: Array<{ x: number; y: number; z: number;
    width: number; height: number; depth: number; yaw: number; tint: number }> = [];
  for (let i = 0; i < 38; i++) {
    const side = i % 2 ? -1 : 1;
    const z = 8 + (i / 38) * 84;
    const p = damChannelAt(z);
    const x = p.x + side * (p.halfWidth + rng.range(1, 6));
    const ground = (gridSample(island, origin.x + x * scale,
      origin.z + z * scale) - origin.y) / scale;
    const y = Math.max(ground - 1.9, p.level - 0.8);
    const yaw = rng.range(0, 6.28);
    const width = rng.range(3.8, 7.5);
    const height = rng.range(3.0, 6.8);
    const depth = rng.range(2.7, 5.5);
    if (side < 0 && z > 22 && z < 94) continue;
    if (overlapsPoolExit(x, z, Math.max(width, depth))) continue;
    pieces.push({ x, y, z, width, height, depth, yaw,
      tint: [0x9da5a6, 0xa8aba1, 0x818c8d, 0xb6b2a2][i % 4]! });
  }
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshToonMaterial({ color: 0xffffff }), pieces.length);
  mesh.name = 'dam-rocky-bank-underpainting';
  const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  pieces.forEach((p, i) => {
    quat.setFromAxisAngle(up, p.yaw);
    matrix.compose(new THREE.Vector3(p.x, p.y, p.z), quat,
      new THREE.Vector3(p.width, p.height, p.depth));
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, new THREE.Color(p.tint));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);
}

/**
 * Merge the parts of each library GLB by material, then instance each mesh
 * over every occurrence. Source nodes are baked into model coordinates and
 * normalized to an upright unit box; placement sizes are in Dam metres.
 */
export function instanceDamAsset(
  root: THREE.Object3D, set: AssetSet,
): THREE.Group {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const dimensions = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const assetPath = 'assets/library/' + set.path;
  const authored = isAuthoredLibraryAsset(assetPath);
  // Only authored assets retain the old normalized per-axis envelope.
  const swap = authored && Boolean(set.longAxisX && dimensions.z > dimensions.x);
  const geometryScale = authored ? new THREE.Vector3(
    1 / Math.max(swap ? dimensions.z : dimensions.x, 0.001),
    1 / Math.max(dimensions.y, 0.001),
    1 / Math.max(swap ? dimensions.x : dimensions.z, 0.001),
  ) : new THREE.Vector3(1, 1, 1);
  const parts = new Map<string, {
    material: THREE.Material; geometries: THREE.BufferGeometry[];
  }>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const mesh = object;
    const raw = mesh.geometry.clone();
    raw.applyMatrix4(mesh.matrixWorld);
    raw.translate(-centre.x, -bounds.min.y, -centre.z);
    if (swap) raw.rotateY(Math.PI / 2);
    raw.scale(geometryScale.x, geometryScale.y, geometryScale.z);
    const geometry = raw.index ? raw.toNonIndexed() : raw;
    if (geometry !== raw) raw.dispose();
    const material = Array.isArray(mesh.material) ?
      mesh.material[0]! : mesh.material;
    const sig = Object.keys(geometry.attributes).sort().map(key => {
      const a = geometry.getAttribute(key);
      return key + ':' + a.itemSize + ':' + a.normalized;
    }).join(',');
    const key = material.uuid + ':' + sig;
    const found = parts.get(key);
    if (found) found.geometries.push(geometry);
    else parts.set(key, { material, geometries: [geometry] });
  });
  const group = new THREE.Group();
  group.name = set.name;
  const transform = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [index, bucket] of [...parts.values()].entries()) {
    const merged = bucket.geometries.length > 1 ?
      mergeGeometries(bucket.geometries, false) : bucket.geometries[0]!;
    const geometries = merged ? [merged] : bucket.geometries;
    if (merged && bucket.geometries.length > 1) {
      bucket.geometries.forEach(geometry => geometry.dispose());
    }
    for (const [part, geo] of geometries.entries()) {
      const material = set.orange
        ? new THREE.MeshToonMaterial({ color: 0xff861f }) :
        set.stone ? new THREE.MeshToonMaterial({ color: 0xa9b1b3 }) :
          set.tint !== undefined ? new THREE.MeshToonMaterial({
            color: set.tint, side: THREE.DoubleSide,
          }) : bucket.material;
      const mesh = new THREE.InstancedMesh(geo, material, set.placements.length);
      mesh.name = set.name + '-batch-' + index + '-' + part;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      set.placements.forEach((p, i) => {
        const fit = fitLibraryModel(dimensions,
          new THREE.Vector3(p.width, p.height, p.depth), assetPath);
        quaternion.setFromAxisAngle(up, p.yaw + (authored ? 0 : fit.yaw));
        transform.compose(new THREE.Vector3(p.x, p.y, p.z), quaternion,
          authored ? new THREE.Vector3(p.width, p.height, p.depth) : fit.scale);
        mesh.setMatrixAt(i, transform);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return group;
}

const DAM_SIGN_SIZE = { width: 3.3, height: 2.2, depth: 0.37 } as const;

function signLabel(group: THREE.Group, x: number, y: number, z: number, yaw: number): void {
  if (typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 224;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#805027';
  ctx.strokeStyle = '#c18b4e';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.roundRect(10, 16, 486, 190, 19);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff8e5';
  ctx.font = 'bold 71px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('THE DAM', 234, 104);
  ctx.lineWidth = 15;
  ctx.strokeStyle = '#fff8e5';
  ctx.beginPath();
  ctx.moveTo(315, 153); ctx.lineTo(454, 153);
  ctx.moveTo(420, 124); ctx.lineTo(454, 153); ctx.lineTo(420, 182);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Fit the separate lettering within the Blender signboard's 3.3 m frame.
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.35),
    new THREE.MeshBasicMaterial({
      map: texture, transparent: true, side: THREE.DoubleSide,
      depthWrite: false,
    }));
  board.name = 'dam-wooden-arrow-sign-label';
  board.rotation.y = yaw;
  const frontOffset = DAM_SIGN_SIZE.depth / 2 + 0.04;
  board.position.set(x + Math.sin(yaw) * frontOffset,
    y + DAM_SIGN_SIZE.height * 0.68,
    z + Math.cos(yaw) * frontOffset);
  group.add(board);
}

function movePinesToDryBanks(island: IslandData, pines: Placement[], origin: THREE.Vector3, scale: number,
  height: (x: number, z: number) => number): ReadonlySet<Placement> {
  const clearsOutflow = makeForestOutflowClearance(island);
  const cascade = island.props.find(prop => prop.id === 'whispering-pines-glade-cascade');
  const pool = cascade && cascadePoolCentre(cascade, scale);
  const occupied = island.props.filter(prop => prop.collidable &&
    Math.hypot(prop.transform.position.x - origin.x, prop.transform.position.z - origin.z) < 135 * scale);
  const roadSegments = island.roads.flatMap(road => road.points.slice(1)
    .map((b, i) => ({ a: road.points[i]!, b, radius: road.width / 2 })));
  const discarded = new Set<Placement>();

  for (const pine of pines) {
    const trunkRadius = Math.min(.9, pine.width * .2);
    const radius = (trunkRadius + .5) * scale;
    const clearsExit = (x: number, z: number): boolean => !overlapsPoolExit(x, z, trunkRadius);
    const clearWater = (x: number, z: number): boolean =>
      clearsOutflow(x, z, radius) &&
      (!cascade || !pool || Math.hypot(x - pool.x, z - pool.z) >= cascade.size.x / 2 + radius);
    const worldX = origin.x + pine.x * scale, worldZ = origin.z + pine.z * scale;
    if (clearWater(worldX, worldZ) && clearsExit(pine.x, pine.z)) continue;
    const drySpot = (x: number, z: number): boolean => {
      const point = { x: origin.x + x * scale, z: origin.z + z * scale };
      if (!clearWater(point.x, point.z) || !clearsExit(x, z)) return false;
      const channel = damChannelAt(z);
      if (Math.abs(x - channel.x) < channel.halfWidth + radius / scale) return false;
      if (gridSample(island, point.x, point.z) <= island.seaLevel + .5 * scale) return false;
      if (roadSegments.some(({ a, b, radius: shoulder }) =>
        segmentProjection(point, a, b).distance < shoulder + radius)) return false;
      if (occupied.some(({ size, transform }) => Math.hypot(
        point.x - transform.position.x, point.z - transform.position.z,
      ) < Math.min(Math.hypot(size.x, size.z) / 2, 6 * scale) + radius)) return false;
      return !pines.some(other => other !== pine && !discarded.has(other) &&
        Math.hypot(x - other.x, z - other.z) < 2);
    };
    let planted = false;
    for (let distance = .75; distance <= 16 && !planted; distance += .75) {
      for (let direction = 0; direction < 16; direction++) {
        const angle = direction * Math.PI / 8;
        const x = pine.x + Math.cos(angle) * distance, z = pine.z + Math.sin(angle) * distance;
        if (!drySpot(x, z)) continue;
        pine.y += height(x, z) - height(pine.x, pine.z);
        pine.x = x;
        pine.z = z;
        planted = true;
        break;
      }
    }
    if (!planted) discarded.add(pine);
  }
  return discarded;
}

/** Scenic assets are optional at runtime; headless tests retain all geometry. */
export function buildDamLandscape(
  island: IslandData, changed: () => void, light = new THREE.Vector3(1, 1, 1),
): DamLandscapeVisuals {
  const group = new THREE.Group();
  group.name = 'dam-plunge-pool-rocky-banks-and-foreground';
  const { position, scale } = getDamPlacement(island);
  const origin = new THREE.Vector3(position.x, position.y, position.z);
  const height = (x: number, z: number): number =>
    (gridSample(island, origin.x + x * scale, origin.z + z * scale) - origin.y) / scale;
  const rng = new SeededRandom(String(island.seed) + ':dam-stylized-assets');
  const tide = { value: island.seaLevel };
  const water = channelWater(light, tide, scale);
  group.add(water.mesh);
  cliffUnderpainting(island, group, origin, scale);
  reeds(group);
  const fence = pathAndFence(island, group, origin, scale);
  const sign = { x: -28, z: 36, yaw: 1.1 };
  const signY = Math.max(height(sign.x, sign.z), damChannelAt(sign.z).level + 1.1);
  signLabel(group, sign.x, signY, sign.z, sign.yaw);

  const cliffs: Placement[] = [];
  const pines: Placement[] = [];
  const fullPines: Placement[] = [];
  const shrubs: Placement[] = [];
  const riverRocks: Placement[] = [];
  const flowers: Placement[] = [];
  const yellowFlowers: Placement[] = [];
  for (let i = 0; i < 28; i++) {
    const side = i % 2 ? -1 : 1;
    const z = 10 + Math.floor(i / 2) * 6.0 + rng.range(-1, 1);
    const section = damChannelAt(z);
    const x = section.x + side * (section.halfWidth + rng.range(3.4, 8.8));
    // Preserve the winding left-bank path instead of walling it in.
    if (side < 0 && z > 22 && z < 94) continue;
    cliffs.push({
      x, z, y: height(x, z) - rng.range(1.5, 2.8),
      width: rng.range(4.5, 7.6), height: rng.range(3.4, 6.8),
      depth: rng.range(4.2, 6.6), yaw: rng.range(0, Math.PI * 2),
    });
    const tx = section.x + side * (section.halfWidth + rng.range(11, 20));
    const tz = z + rng.range(-2.5, 2.5);
    pines.push({
      x: tx, z: tz, y: height(tx, tz) - 0.3,
      width: rng.range(3.9, 6.2), height: rng.range(9, 17),
      depth: rng.range(3.9, 6.2), yaw: rng.range(0, 6.28),
    });
  }
  // Additional pines form a thicker tree line along the cliff-top ridges.
  for (let i = 0; i < 22; i++) {
    const side = i % 2 ? -1 : 1;
    const z = 5 + Math.floor(i / 2) * 6.5 + rng.range(-2, 2);
    const section = damChannelAt(z);
    const x = section.x + side * (section.halfWidth + rng.range(14, 24));
    pines.push({
      x, z, y: height(x, z) - 0.3,
      width: rng.range(3.5, 5.3), height: rng.range(10, 16),
      depth: rng.range(3.5, 5.3), yaw: rng.range(0, 6.28),
    });
  }
  // More of the same full-canopy pines and low green shrubs frame the river
  // without a row of bare trunks or expensive one-draw-per-tree calls.
  for (let i = 0; i < 44; i++) {
    const side = i % 2 ? -1 : 1;
    const z = 6 + Math.floor(i / 2) * 4.1 + rng.range(-1.6, 1.6);
    const section = damChannelAt(z);
    const x = section.x + side * (section.halfWidth + rng.range(13, 27));
    fullPines.push({
      x, z, y: height(x, z) - 0.2,
      width: rng.range(4.1, 6.6), height: rng.range(9, 16),
      depth: rng.range(4.1, 6.6), yaw: rng.range(0, 6.28),
    });
    const bx = section.x + side * (section.halfWidth + rng.range(7, 14));
    const bz = z + rng.range(-2.5, 2.5);
    shrubs.push({
      x: bx, z: bz, y: height(bx, bz) - 0.1,
      width: rng.range(2.2, 4.2), height: rng.range(1.7, 3.7),
      depth: rng.range(2.2, 4.2), yaw: rng.range(0, 6.28),
    });
  }
  // Retain all seeded RNG draws (including the former size samples) so the
  // pine placements and yaws do not change when fitting their new model.
  for (const pine of [...pines, ...fullPines]) {
    pine.width = pine.height * 0.35;
    pine.depth = pine.width;
  }
  // These scenic Dam models also reach the separate Pines outflow mesh.
  const wetPines = movePinesToDryBanks(island, [...pines, ...fullPines], origin, scale, height);
  for (let i = 0; i < 25; i++) {
    const z = rng.range(13, 102);
    const section = damChannelAt(z);
    const inWater = i % 3 === 0;
    const x = section.x + (i % 2 ? -1 : 1) *
      section.halfWidth * rng.range(inWater ? 0.35 : 0.83,
        inWater ? 0.8 : 1.2);
    riverRocks.push({
      x, z, y: inWater ? section.level - 1.3 : height(x, z) - 0.45,
      width: rng.range(2.2, 5.4), height: rng.range(1.8, 4.7),
      depth: rng.range(2.2, 5.3), yaw: rng.range(0, 6.28),
    });
  }
  for (let i = 0; i < 80; i++) {
    const z = rng.range(10, 104);
    const section = damChannelAt(z);
    const side = i % 2 ? -1 : 1;
    const x = section.x + side * (section.halfWidth + rng.range(7.5, 19));
    const sample = {
      x, z, y: height(x, z),
      width: rng.range(0.75, 1.2), height: rng.range(1.2, 2.25),
      depth: rng.range(0.75, 1.2), yaw: rng.range(0, 6.28),
    };
    (i % 2 ? flowers : yellowFlowers).push(sample);
  }
  const buoys: Placement[] = [
    { x: 8, z: 35, y: damChannelAt(35).level - 0.5,
      ...DAM_BUOY_SIZE, yaw: 0.25 },
    { x: 5, z: 48, y: damChannelAt(48).level - 0.5,
      ...DAM_BUOY_SIZE, yaw: 0.9 },
  ];
  const fallbackBuoys = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.5, 0.5, DAM_BUOY_SIZE.height, 9),
    new THREE.MeshToonMaterial({ color: 0xff7d20 }), 2);
  fallbackBuoys.name = 'dam-two-orange-buoys-fallback';
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  for (let i = 0; i < buoys.length; i++) {
    const b = buoys[i]!;
    matrix.compose(new THREE.Vector3(b.x, b.y + b.height / 2, b.z), quaternion,
      new THREE.Vector3(1, 1, 1));
    fallbackBuoys.setMatrixAt(i, matrix);
  }
  fallbackBuoys.instanceMatrix.needsUpdate = true;
  fallbackBuoys.computeBoundingSphere();
  group.add(fallbackBuoys);

  // Keep the graded route open through both the placeholder and loaded scenery.
  const clearBank = ({ x, z, width, depth }: Placement): boolean =>
    !overlapsPoolExit(x, z, Math.hypot(width, depth) / 2);
  const sets: AssetSet[] = [
    { name: 'dam-kenney-cliff-faces',
      path: 'kenney/nature-kit/rock_largeA.glb', placements: cliffs.filter(clearBank), stone: true },
    { name: 'dam-quaternius-rock-boulders',
      path: 'quaternius/stylized-nature-megakit/rock-medium_JQxF95498B.glb',
      placements: riverRocks.filter(clearBank), stone: true },
    { name: 'dam-quaternius-pines',
      path: 'custom/pines/pine.glb',
      placements: pines.filter(pine => !wetPines.has(pine)) },
    { name: 'dam-full-canopy-kenney-pines',
      path: 'custom/pines/pine.glb',
      placements: fullPines.filter(pine => !wetPines.has(pine)) },
    { name: 'dam-grassy-bank-shrubs',
      path: 'kenney/nature-kit/plant_bushDetailed.glb',
      placements: shrubs.filter(clearBank), tint: 0x72ad55 },
    { name: 'dam-kenney-purple-wildflowers',
      path: 'kenney/nature-kit/flower_purpleA.glb',
      placements: flowers, tint: 0xc59ae8 },
    { name: 'dam-kenney-yellow-wildflowers',
      path: 'kenney/nature-kit/flower_yellowB.glb',
      placements: yellowFlowers, tint: 0xf5cb66 },
    { name: 'dam-kenney-post-and-rail-fence',
      path: 'kenney/nature-kit/fence_simple.glb', placements: fence,
      longAxisX: true, tint: 0xb27c4e },
    { name: 'dam-wooden-direction-sign',
      path: 'custom/props/signpost.glb',
      placements: [{
        x: sign.x, z: sign.z, y: signY,
        ...DAM_SIGN_SIZE, yaw: sign.yaw,
      }] },
    { name: 'dam-two-orange-buoys',
      path: DAM_BUOY_MODEL, placements: buoys,
      onReady: () => {
        group.remove(fallbackBuoys);
        fallbackBuoys.geometry.dispose();
        (fallbackBuoys.material as THREE.Material).dispose();
      } },
  ];
  let disposed = false;
  if (typeof document !== 'undefined') {
    const loader = new GLTFLoader();
    for (const set of sets) {
      const url = publicAssetUrl('assets/library/' + set.path);
      loader.load(url, gltf => {
        if (disposed) {
          gltf.scene.traverse(o => {
            if (o instanceof THREE.Mesh) o.geometry.dispose();
          });
          return;
        }
        try {
          const batched = instanceDamAsset(gltf.scene, set);
          if (batched.children.length === 0) return;
          group.add(batched);
          set.onReady?.();
          changed();
        } catch (error) {
          console.warn('Could not instance Dam scenic asset ' + url, error);
        }
      }, undefined, error => {
        if (!disposed) console.warn('Could not load Dam scenic asset ' + url, error);
      });
    }
  }

  return {
    group,
    update(seconds: number): void { water.time.value = Math.max(0, seconds); },
    setWaterLevel(level: number): void {
      tide.value = level;
      const highest = origin.y + water.mesh.geometry.boundingBox!.max.y * scale;
      water.mesh.visible = level < highest + 0.45 * scale;
    },
    dispose(): void { disposed = true; },
  };
}
