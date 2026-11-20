import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getDamOutflow, isDamHeadwater } from './dam-landscape';
import { kitShape } from './kit-preview';
import { capeSurface, LIGHTHOUSE_FOOTPATH } from './lighthouse-access';
import { paintNatureKit } from './plant-palette';
import { SeededRandom } from './random';
import { makeLocalStreets } from './roads';
import { biomeAt, riverAt, segmentProjection } from './terrain';
import type { Biome, IslandData, Vec2, Vec3 } from './types';

type Model = 'vergeGrass' | 'vergeFlowers' | 'vergeHeather' | 'vergeFern' | 'vergeShrub' |
  'vergeMushrooms' | 'vergeSlate' | 'vergeShingle' | 'vergeDriftwood';

interface Plant {
  model: Model;
  position: Vec3;
  length: number;
  yaw: number;
  shade: number;
}

// Max lengths in metres. A drift uses one palette so the silhouettes and
// colours change between the pasture, dunes, woodland and alpine trails.
type PlantSpec = readonly [model: Model, minLength: number, maxLength: number];
const grass: PlantSpec = ['vergeGrass', .62, 1.25];
const flowers: PlantSpec = ['vergeFlowers', .42, .84];
const heather: PlantSpec = ['vergeHeather', .44, .88];
const fern: PlantSpec = ['vergeFern', .6, 1.28];
const scrub: PlantSpec = ['vergeShrub', .72, 1.42];
const mushrooms: PlantSpec = ['vergeMushrooms', .31, .62];
const chips: PlantSpec = ['vergeSlate', .32, .76];
const shingle: PlantSpec = ['vergeShingle', .43, .94];
const branches: PlantSpec = ['vergeDriftwood', .65, 1.5];
const meadow = [grass, flowers, flowers, heather, scrub];
const coast = [grass, grass, shingle, scrub, branches];
const alpine = [chips, chips, heather, grass, shingle];
const palettes: Record<Biome, PlantSpec[]> = {
  ocean: coast, beach: coast, meadow, farmland: meadow,
  town: [flowers, flowers, heather, scrub, grass],
  industrial: [chips, shingle, grass, chips],
  'pine-forest': [fern, fern, mushrooms, grass, branches, scrub],
  highlands: alpine, cliff: alpine, freshwater: [fern, fern, grass, shingle],
};

type Clearance = (point: Vec2, radius: number, y: number) => boolean;
const MAX_CELL_COUNT = 36;
const CELL_LENGTH = 32;
const SIGHT_RANGE = 55;

/** Ground clutter follows shoulders and known footpaths in groups, with open gaps
 * between beds. Footprints protect travel, existing props, and work aisles. */
export function planVerges(island: IslandData, pavedAt: (x: number, z: number) => boolean): Plant[] {
  const scale = island.size / 600;
  const cellSize = CELL_LENGTH * scale;
  const rng = new SeededRandom(String(island.seed) + ':verge-planting');
  const result: Plant[] = [];
  const counts = new Map<string, number>();
  const blocked = new Map<string, Clearance[]>();
  const cell = (x: number, z: number) => Math.floor(x / cellSize) + ':' + Math.floor(z / cellSize);
  const reserve = (left: number, right: number, near: number, far: number, overlaps: Clearance) => {
    const pad = 1.1 * scale;
    for (let j = Math.floor((near - pad) / cellSize); j <= Math.floor((far + pad) / cellSize); j++) {
      for (let i = Math.floor((left - pad) / cellSize); i <= Math.floor((right + pad) / cellSize); i++) {
        const key = i + ':' + j;
        const entries = blocked.get(key);
        if (entries) entries.push(overlaps);
        else blocked.set(key, [overlaps]);
      }
    }
  };
  const reserveLine = (a: Vec2, b: Vec2, width: number) => {
    reserve(Math.min(a.x, b.x) - width, Math.max(a.x, b.x) + width,
      Math.min(a.z, b.z) - width, Math.max(a.z, b.z) + width,
      (p, r) => segmentProjection(p, a, b).distance < width + r);
  };
  const reserveDisc = (at: Vec2, width: number) => {
    reserve(at.x - width, at.x + width, at.z - width, at.z + width,
      (p, r) => Math.hypot(p.x - at.x, p.z - at.z) < width + r);
  };
  const roads = [...island.roads, ...makeLocalStreets(island)];
  const roadMargin = (type: 'road' | 'trail') => (type === 'road' ? 2.55 : .9) * scale;
  for (const road of roads) {
    for (let i = 1; i < road.points.length; i++) {
      reserveLine(road.points[i - 1]!, road.points[i]!, road.width / 2 + roadMargin(road.type));
    }
  }
  for (const { approach, pieces } of island.districtSets ?? []) {
    reserveLine(approach.from, approach.to, 1.65 * scale);
    for (const piece of pieces) reserveDisc(piece.bottom, piece.length * .73);
  }
  for (const { position } of [...island.spawns, ...island.relics]) reserveDisc(position, 2.4 * scale);
  for (const prop of island.props) {
    if (!prop.collidable && !['tree-pine', 'tree-oak', 'palm-tree', 'bush'].includes(prop.kind)) continue;
    const { position: at, rotationY } = prop.transform;
    const tree = prop.kind.startsWith('tree-') || prop.kind === 'palm-tree';
    const x = (tree ? Math.min(prop.size.x, 1.7 * scale) : prop.size.x) / 2 + .15 * scale;
    const z = (tree ? Math.min(prop.size.z, 1.7 * scale) : prop.size.z) / 2 + .15 * scale;
    const radius = Math.hypot(x, z), c = Math.cos(rotationY), s = Math.sin(rotationY);
    reserve(at.x - radius, at.x + radius, at.z - radius, at.z + radius, (p, r, y) => {
      if (Math.abs(at.y - y) > prop.size.y / 2 + 1.1 * scale) return false;
      const dx = p.x - at.x, dz = p.z - at.z;
      return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - x),
        Math.max(0, Math.abs(dx * s + dz * c) - z)) < r;
    });
  }
  const farm = island.pois.find(poi => poi.id === 'hoofington')!.center;
  const cape = island.pois.find(poi => poi.id === 'old-lighthouse')!.center;
  const footpath = LIGHTHOUSE_FOOTPATH.map(([x, z]) => ({ x: cape.x + x * scale, z: cape.z + z * scale }));
  for (let i = 1; i < footpath.length; i++) reserveLine(footpath[i - 1]!, footpath[i]!, 2.25 * scale);
  const outflow = getDamOutflow(island);

  const plant = (point: Vec2, spec: PlantSpec) => {
    const { x, z } = point;
    const [model, min, max] = spec;
    const length = rng.range(min, max) * scale;
    const radius = length * .71;
    const key = cell(x, z);
    const count = counts.get(key) ?? 0;
    if (count >= MAX_CELL_COUNT || pavedAt(x, z)) return;
    // Keep the Hoofington mowing lawn and its approach visually open.
    if (Math.abs(x - farm.x) < 47 * scale && z - farm.z > 32 * scale && z - farm.z < 76 * scale) return;
    const y = capeSurface(island, x, z);
    if (y < island.seaLevel + .36 * scale ||
        blocked.get(key)?.some(overlaps => overlaps(point, radius, y))) return;
    if (isDamHeadwater(island, x, z) ||
        (outflow.containsXZ(x, z) && y < outflow.surfaceY(z) + .55 * scale)) return;
    const river = riverAt(point, island.river);
    if (river.distance < river.width * .54 + radius && y < river.level + .48 * scale) return;
    const grade = Math.max(
      Math.abs(capeSurface(island, x + radius, z) - y),
      Math.abs(capeSurface(island, x - radius, z) - y),
      Math.abs(capeSurface(island, x, z + radius) - y),
      Math.abs(capeSurface(island, x, z - radius) - y),
    );
    if (grade > radius * .54) return;
    result.push({ model, length, yaw: rng.range(0, Math.PI * 2), shade: rng.range(.83, 1.13),
      position: { x, y: y - grade * .4 - .018 * scale, z } });
    counts.set(key, count + 1);
    reserveDisc(point, length * .31);
  };

  const drift = (x: number, z: number, dx: number, dz: number, length: number) => {
    const biome = biomeAt(island, x, z);
    const palette = palettes[biome];
    const accent = rng.pick(palette);
    const steps = rng.int(5, 10);
    for (let i = 0; i < steps; i++) {
      const along = rng.range(-length / 2, length / 2) * scale;
      const across = rng.range(-1.25, 1.25) * scale;
      plant({ x: x + along * dx - across * dz, z: z + along * dz + across * dx },
        i % 3 === 0 ? rng.pick(palette) : accent);
    }
  };

  for (const road of roads) {
    let remaining = rng.range(1, 9) * scale;
    const width = road.width / 2 + roadMargin(road.type);
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1e-5) continue;
      const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
      while (remaining < length) {
        if (!a.bridge && !b.bridge) {
          const x = a.x + dx * remaining, z = a.z + dz * remaining;
          for (const side of [-1, 1]) {
            if (rng.next() < .21) continue;
            const offset = side * (width + rng.range(1.7, 4.6) * scale);
            drift(x - dz * offset, z + dx * offset, dx, dz, rng.range(4.5, 8));
          }
        }
        remaining += rng.range(8.5, 16) * scale;
      }
      remaining -= length;
    }
  }
  for (const { approach: { from, to } } of island.districtSets ?? []) {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length < 2 * scale) continue;
    const dx = (to.x - from.x) / length, dz = (to.z - from.z) / length;
    for (const side of [-1, 1]) {
      const offset = side * 3.35 * scale;
      drift((from.x + to.x) / 2 - dz * offset, (from.z + to.z) / 2 + dx * offset, dx, dz, 5);
    }
  }
  return result;
}

/** One static draw per nearby cell, using the same geometry in both renderers. */
export function buildVergeVisuals(island: IslandData, pavedAt: (x: number, z: number) => boolean) {
  const group = new THREE.Group();
  group.name = 'island-road-and-trail-verges';
  const scale = island.size / 600, cellSize = CELL_LENGTH * scale;
  const cells = new Map<string, THREE.BufferGeometry[]>();
  const models = new Map<Model, THREE.BufferGeometry>();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  for (const { model, position, length, yaw, shade } of planVerges(island, pavedAt)) {
    const key = Math.floor(position.x / cellSize) + ':' + Math.floor(position.z / cellSize);
    let source = models.get(model);
    if (!source) {
      source = kitShape(model);
      paintNatureKit(source);
      models.set(model, source);
    }
    const part = source.clone().scale(length, length, length).rotateY(yaw)
      .translate(position.x, position.y, position.z);
    const colours = part.getAttribute('color');
    for (let i = 0; i < colours.count; i++) {
      colours.setXYZ(i, colours.getX(i) * shade, colours.getY(i) * shade, colours.getZ(i) * shade);
    }
    const entries = cells.get(key);
    if (entries) entries.push(part);
    else cells.set(key, [part]);
  }
  for (const source of models.values()) source.dispose();
  const batches = [...cells].map(([key, pieces]) => {
    const geometry = mergeGeometries(pieces)!;
    for (const part of pieces) part.dispose();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'island-verge-' + key;
    mesh.receiveShadow = true;
    group.add(mesh);
    return { mesh, bounds: geometry.boundingSphere! };
  });
  return {
    group,
    update(position: THREE.Vector3, frustum: THREE.Frustum) {
      for (const { mesh, bounds } of batches) {
        mesh.visible = position.distanceToSquared(bounds.center) <= (SIGHT_RANGE * scale + bounds.radius) ** 2 &&
          frustum.intersectsSphere(bounds);
      }
    },
  };
}
