import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gridIndex, segmentProjection } from './terrain';
import type { IslandData, Vec2, Vec3 } from './types';
import { TOON_RAMP } from './visual-props';

type Part = readonly [kind: 'rock' | 'box' | 'cone', x: number, y: number, z: number,
  width: number, height: number, depth: number, paint: number, yaw?: number];
interface Tier {
  id: string;
  x: number;
  z: number;
  radius: number;
  parts: readonly Part[];
}

const TIERS: readonly Tier[] = [
  {
    id: 'split-stones', x: 79, z: 79, radius: 2.5,
    parts: [
      ['rock', -.84, 1.22, 0, 1.72, 3.12, 1.48, 0x8a806e, .25],
      ['rock', .92, .79, -.32, 1.45, 2.14, 1.66, 0xb8a480, -.45],
      ['rock', -.25, .23, .97, 2.2, .74, 1.35, 0x655841, .3],
      ['box', -.90, 1.93, .63, .76, .22, .12, 0xe3b96a, .25],
    ],
  },
  {
    id: 'pine-shelf', x: 66, z: 49, radius: 2.4,
    parts: [
      ['box', -.72, 1.01, 0, .34, 2.30, .36, 0x775841, .26],
      ['cone', -.72, 2.20, 0, 2.35, 2.59, 2.13, 0x265b3e, .31],
      ['cone', -.72, 3.27, 0, 1.83, 2.60, 1.63, 0x36714a, .82],
      ['box', .95, .60, -.62, .25, 1.54, .28, 0x775841, .11],
      ['cone', .95, 1.54, -.62, 1.62, 1.70, 1.44, 0x2c6046, .52],
      ['cone', .95, 2.26, -.62, 1.26, 1.73, 1.09, 0x47784d, .96],
    ],
  },
  {
    id: 'lantern-bend', x: 64, z: 9, radius: 1.55,
    parts: [
      ['rock', -.53, .30, -.20, 1.53, 1.08, 1.11, 0x928474, .21],
      ['box', -.53, 1.22, -.20, .28, 1.86, .27, 0x55483b, .21],
      ['box', -.53, 2.04, -.20, .52, .56, .52, 0xfbb265, .21],
      ['cone', -.53, 2.42, -.20, .75, .31, .75, 0x6b4b38, .21],
      ['rock', .64, .34, .37, 1.14, 1.09, 1.09, 0xb5a084, .42],
    ],
  },
  {
    id: 'cloud-cairn', x: 39, z: 32, radius: 2,
    parts: [
      ['rock', 0, .31, 0, 3.18, 1.25, 2.43, 0x777e83, .58],
      ['rock', -.17, 1.05, .10, 2.11, .93, 1.65, 0xa7a8a0, .91],
      ['rock', -.02, 1.70, .18, 1.39, .89, 1.15, 0xcbc8b4, 1.17],
      ['rock', .09, 2.32, .14, .84, .77, .73, 0xe4d9bd, 1.55],
    ],
  },
  {
    id: 'survey-shelf', x: 21, z: -13, radius: 1.65,
    parts: [
      ['box', -.78, 1.03, 0, .31, 2.60, .31, 0x53616b, .45],
      ['box', .78, 1.03, 0, .31, 2.60, .31, 0x53616b, .45],
      ['box', 0, 1.88, 0, 2.61, .50, .40, 0xba6e41, .14],
      ['box', 0, 2.28, 0, 2.47, .24, .44, 0xe0ae67, .14],
      ['box', .48, 2.57, 0, .15, .77, .18, 0x53616b, .14],
    ],
  },
];

const CUTS = [
  { id: 'northwest-cut', from: { x: -56.33448, z: -74.69189 },
    to: { x: -44.19078, z: -65.70339 }, jump: true },
  { id: 'summit-cut', from: { x: 25.53048, z: -4.13793 },
    to: { x: 12.11668, z: -2.71978 }, jump: false },
] as const;

interface Footprint extends Vec2 { radius: number }
interface SetPiece {
  id: string;
  markers: Footprint[];
  parts: readonly Part[];
}
export interface MountainCut {
  id: string;
  from: Vec2;
  to: Vec2;
  jump: boolean;
  markers: Footprint[];
}

/** Exact height of the high-detail terrain's two triangles around the summit. */
function terrainTop(island: IslandData, x: number, z: number): number {
  const n = island.resolution;
  const gx = (x / island.size + .5) * (n - 1), gz = (z / island.size + .5) * (n - 1);
  const ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz;
  const point = (dx: number, dz: number): number =>
    island.heights[gridIndex(n, ix + dx, iz + dz)]!;
  const b = point(1, 0), c = point(0, 1);
  return u + v <= 1
    ? point(0, 0) * (1 - u - v) + b * u + c * v
    : b * (1 - v) + c * (1 - u) + point(1, 1) * (u + v - 1);
}

function mountainClearance(island: IslandData): (point: Vec2, radius: number, height: number) => boolean {
  const scale = island.size / 600;
  const roads = island.roads.flatMap(road => road.points.slice(1).map((end, i) =>
    ({ start: road.points[i]!, end, half: road.width / 2 })));
  const closeProps = island.props.filter(prop =>
    Math.hypot(prop.transform.position.x, prop.transform.position.z) < 135 * scale);
  return (point, radius, height): boolean => {
    if (roads.some(({ start, end, half }) =>
      segmentProjection(point, start, end).distance < half + radius + .45 * scale)) return false;
    const ground = terrainTop(island, point.x, point.z);
    return !closeProps.some(({ kind, transform, size }) => {
      const p = transform.position;
      const waterfall = kind === 'cascade' || kind === 'cascade-tall';
      const pad = waterfall ? 4 * scale : .25 * scale;
      return p.y + size.y / 2 + pad > ground && p.y - size.y / 2 - pad < ground + height &&
        Math.hypot(p.x - point.x, p.z - point.z) < Math.hypot(size.x, size.z) / 2 + radius + pad;
    });
  };
}

const NEARBY_OFFSETS = Array.from({ length: 29 * 29 }, (_, i) =>
  ({ x: i % 29 - 14, z: Math.floor(i / 29) - 14 }))
  .filter(({ x, z }) => x * x + z * z <= 14 * 14)
  .sort((a, b) => a.x * a.x + a.z * a.z - b.x * b.x - b.z * b.z);

function placeTier(island: IslandData, tier: Tier,
  clear: ReturnType<typeof mountainClearance>): Footprint | undefined {
  const scale = island.size / 600;
  const radius = tier.radius * scale;
  const originalRadius = Math.hypot(tier.x, tier.z);
  for (const offset of NEARBY_OFFSETS) {
    const x = (tier.x + offset.x) * scale, z = (tier.z + offset.z) * scale;
    if (Math.abs(Math.hypot(x, z) / scale - originalRadius) > 7) continue;
    const top = terrainTop(island, x, z);
    if ([[radius, 0], [-radius, 0], [0, radius], [0, -radius]].some(([dx, dz]) =>
      Math.abs(terrainTop(island, x + dx!, z + dz!) - top) > radius * .95)) continue;
    if (clear({ x, z }, radius, 5 * scale)) return { x, z, radius };
  }
}

export function mountainCuts(island: IslandData,
  clear = mountainClearance(island)): MountainCut[] {
  const scale = island.size / 600;
  const trails = island.roads.filter(road => road.type === 'trail' &&
    (road.from === 'mt-gigga' || road.to === 'mt-gigga'));
  const onTrail = (point: Vec2): boolean => trails.some(road =>
    road.points.some((end, i) => i > 0 && !end.bridge && !road.points[i - 1]!.bridge &&
      segmentProjection(point, road.points[i - 1]!, end).distance < road.width / 2));
  const cuts: MountainCut[] = [];
  for (const cut of CUTS) {
    const from = { x: cut.from.x * scale, z: cut.from.z * scale };
    const to = { x: cut.to.x * scale, z: cut.to.z * scale };
    if (!onTrail(from) || !onTrail(to)) continue;
    const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
    let last = terrainTop(island, from.x, from.z), usable = true;
    // Keep the signs off any seed where erosion or road grading exposes a wall.
    for (let i = 1; i <= 20; i++) {
      const x = from.x + dx * i / 20, z = from.z + dz * i / 20;
      const height = terrainTop(island, x, z);
      if (Math.abs(height - last) > length / 20 * 1.45) {
        usable = false;
        break;
      }
      if (island.props.some(prop => {
        if (!prop.collidable || prop.kind === 'grass-tuft' || prop.kind === 'flower') return false;
        const p = prop.transform.position;
        return Math.abs(height - p.y) < prop.size.y / 2 + .6 * scale &&
          Math.hypot(x - p.x, z - p.z) < Math.max(prop.size.x, prop.size.z) / 2 + .35 * scale;
      })) {
        usable = false;
        break;
      }
      last = height;
    }
    if (!usable) continue;
    const markers: Footprint[] = [];
    for (const t of [.13, .36, .62, .86]) {
      const position = { x: from.x + dx * t, z: from.z + dz * t };
      for (const signedOffset of [1.3, -1.3, 1.9, -1.9, 2.5, -2.5]) {
        const side = signedOffset * scale / length;
        const foot = { x: position.x - dz * side, z: position.z + dx * side, radius: .42 * scale };
        if (!clear(foot, foot.radius, 2.4 * scale)) continue;
        markers.push(foot);
        break;
      }
    }
    if (markers.length >= 3) cuts.push({ id: cut.id, from, to, jump: cut.jump, markers });
  }
  return cuts;
}

function colourGeometry(part: Part, scale: number, ground: Vec3): THREE.BufferGeometry {
  const [kind, x, y, z, width, height, depth, paint, yaw = 0] = part;
  let geometry: THREE.BufferGeometry;
  if (kind === 'rock') geometry = new THREE.DodecahedronGeometry(.5, 0);
  else if (kind === 'cone') geometry = new THREE.ConeGeometry(.5, 1, 7);
  else geometry = new THREE.BoxGeometry(1, 1, 1);
  if (geometry.index) {
    const flat = geometry.toNonIndexed();
    geometry.dispose();
    geometry = flat;
  }
  geometry.deleteAttribute('uv');
  geometry.scale(width * scale, height * scale, depth * scale);
  geometry.rotateY(yaw);
  geometry.translate(ground.x + x * scale, ground.y + y * scale, ground.z + z * scale);
  const tint = new THREE.Color(paint);
  const colours = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let i = 0; i < colours.length; i += 3) tint.toArray(colours, i);
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

export function buildMountainWayfinding(island: IslandData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mt-gigga-wayfinding';
  const scale = island.size / 600, clear = mountainClearance(island);
  const pieces: THREE.BufferGeometry[] = [];
  const features: Record<string, { start: number; count: number }> = {};
  let vertices = 0;
  function add({ id, markers, parts }: SetPiece): void {
    const start = vertices;
    for (const { x, z } of markers) for (const part of parts) {
      const place = { x: x + part[1] * scale, z: z + part[3] * scale };
      // Root each object in its local terrain. Tall parts of the same object share XZ.
      const geometry = colourGeometry(part, scale, { x,
        y: terrainTop(island, place.x, place.z) - .18 * scale, z });
      pieces.push(geometry);
      vertices += geometry.getAttribute('position').count;
    }
    features[id] = { start, count: vertices - start };
  }

  for (const tier of TIERS) {
    const foot = placeTier(island, tier, clear);
    if (foot) add({ id: tier.id, markers: [foot], parts: tier.parts });
  }
  for (const cut of mountainCuts(island, clear)) {
    const yaw = Math.atan2(cut.to.x - cut.from.x, cut.to.z - cut.from.z);
    // Repeated amber tips trace the climb from below, with a taller double band
    // at the steeper cut. The path between them remains existing terrain.
    const parts: Part[] = [
      ['box', 0, .58, 0, .21, 1.44, .22, 0x6e4c34, yaw],
      ['box', 0, 1.21, 0, .43, .23, .39, 0xe39740, yaw],
      ['cone', 0, 1.49, 0, .54, .34, .54, 0xffd383, yaw],
    ];
    if (cut.jump) parts.push(['box', 0, .83, 0, .34, .14, .34, 0xe39740, yaw]);
    add({ id: cut.id, markers: cut.markers, parts });
  }
  if (pieces.length === 0) return group;
  const geometry = mergeGeometries(pieces);
  pieces.forEach(piece => piece.dispose());
  if (!geometry) return group;
  // Retain inspection ranges without geometry groups or additional draw calls.
  geometry.userData['features'] = features;
  const mesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({
    color: 0xffffff, vertexColors: true, gradientMap: TOON_RAMP,
  }));
  mesh.name = 'mountain-wayfinding-batched';
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
