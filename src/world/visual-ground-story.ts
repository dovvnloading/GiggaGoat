import * as THREE from 'three';
import type { IslandData, PoiId, PropKind, Vec2, Vec3 } from './types';
import { SeededRandom, hashString } from './random';
import { capeSurface, LIGHTHOUSE_FOOTPATH } from './lighthouse-access';
import { makeLocalStreets } from './roads';
import { isPointInsideProps } from './layouts';
import { riverAt, segmentProjection } from './terrain';
import { getDamOutflow, isDamHeadwater } from './dam-landscape';
import { TOON_RAMP } from './visual-props';

type DetailKind = 'leaf' | 'twig' | 'pinecone' | 'stone' | 'shell' | 'straw';
export interface GroundStoryDetail {
  district: PoiId;
  kind: DetailKind;
  position: Vec3;
  length: number;
  yaw: number;
  color: number;
}

interface Recipe {
  anchors: readonly PropKind[];
  types: readonly DetailKind[];
  maxClusters: number;
}
const recipes: Readonly<Record<PoiId, Recipe>> = {
  hoofington: { anchors: ['tree-oak', 'tree-pine', 'fence'], types: ['leaf', 'leaf', 'twig', 'straw'], maxClusters: 13 },
  'baa-ardwalk': { anchors: ['palm-tree', 'rock', 'tree-oak'], types: ['shell', 'shell', 'twig', 'stone'], maxClusters: 11 },
  'crane-yard': { anchors: ['rock', 'tree-oak', 'tree-pine'], types: ['stone', 'stone', 'twig'], maxClusters: 8 },
  'downtown-bleatsville': { anchors: ['tree-oak', 'tree-pine', 'bush'], types: ['leaf', 'leaf', 'twig'], maxClusters: 11 },
  'mt-gigga': { anchors: ['rock', 'tree-pine'], types: ['stone', 'stone', 'pinecone'], maxClusters: 15 },
  'whispering-pines': { anchors: ['tree-pine', 'stump', 'log', 'tree-oak'], types: ['pinecone', 'twig', 'leaf', 'pinecone'], maxClusters: 18 },
  'the-dam': { anchors: ['rock', 'tree-pine', 'tree-oak'], types: ['stone', 'leaf', 'pinecone'], maxClusters: 11 },
  'old-lighthouse': { anchors: ['rock', 'tree-oak', 'tree-pine'], types: ['stone', 'shell', 'twig', 'leaf'], maxClusters: 13 },
};
const palettes: Record<DetailKind, readonly number[]> = {
  leaf: [0xa89052, 0xbe9357, 0x857847, 0x946d43, 0xc1ab6d],
  twig: [0x7f6246, 0x8d7356, 0x9d805c, 0x6b5037],
  pinecone: [0x805c37, 0x95734d, 0x735031],
  stone: [0x888d88, 0xa1a49a, 0xb5ada0, 0x797f79],
  shell: [0xd7cbb0, 0xc7b5a0, 0xe0d5c0, 0xb49a88],
  straw: [0xd2b16d, 0xbfa064, 0xe3c483],
};
const lengths: Record<DetailKind, readonly [number, number]> = {
  leaf: [.19, .39], twig: [.28, .72], pinecone: [.20, .36],
  stone: [.16, .43], shell: [.17, .31], straw: [.28, .57],
};

/** Micro-dressing comes from existing static scene anchors, never uniform
 * noise over the entire island. Preserve the generator's random stream, IDs,
 * physical prop envelopes, and every gameplay route. */
export function planGroundStory(island: IslandData, pavedAt: (x: number, z: number) => boolean = () => false): GroundStoryDetail[] {
  const scale = island.size / 600;
  const result: GroundStoryDetail[] = [];
  const routes = [...island.roads, ...makeLocalStreets(island)].flatMap(road =>
    road.points.slice(1).map((b, i) => {
      const a = road.points[i]!;
      const width = road.width / 2 + (road.type === 'road' ? 2.55 : .95) * scale;
      return { a, b, width, left: Math.min(a.x, b.x) - width, right: Math.max(a.x, b.x) + width,
        near: Math.min(a.z, b.z) - width, far: Math.max(a.z, b.z) + width };
    }));
  const farm = island.pois.find(p => p.id === 'hoofington')?.center;
  const yard = island.pois.find(p => p.id === 'crane-yard')?.center;
  const cape = island.pois.find(p => p.id === 'old-lighthouse')?.center;
  const footpath = cape ? LIGHTHOUSE_FOOTPATH.map(([x, z]) => ({ x: cape.x + x * scale, z: cape.z + z * scale })) : [];
  const outflow = getDamOutflow(island);
  const noTouch = [...island.spawns, ...island.relics].map(item => item.position);
  for (const poi of island.pois) {
    const recipe = recipes[poi.id];
    const rng = new SeededRandom(String(island.seed) + ':ground-story:' + poi.id);
    const nearby = island.props.filter(prop =>
      Math.hypot(prop.transform.position.x - poi.center.x, prop.transform.position.z - poi.center.z) <
      poi.radius * 1.8 + Math.hypot(prop.size.x, prop.size.z) / 2 + 8 * scale);
    const anchors = nearby.filter(prop => prop.poiId === poi.id && prop.body.type === 'static' &&
      recipe.anchors.includes(prop.kind)).sort((a, b) =>
      hashString(String(island.seed) + a.id) - hashString(String(island.seed) + b.id));
    const clusters: Vec2[] = [];
    for (const anchor of anchors) {
      if (clusters.length >= recipe.maxClusters) break;
      const p = anchor.transform.position, sy = anchor.size.y;
      if (clusters.some(c => Math.hypot(c.x - p.x, c.z - p.z) < 7.2 * scale)) continue;
      if (Math.abs(p.y - sy / 2 - capeSurface(island, p.x, p.z)) > 2.4 * scale) continue;
      const start = result.length;
      const tree = anchor.kind.startsWith('tree-') || anchor.kind === 'palm-tree';
      const inner = tree ? Math.min(anchor.size.x * .28, 1.4 * scale) :
        Math.min(Math.hypot(anchor.size.x, anchor.size.z) * .52, 4 * scale);
      // One cluster lies near each selected anchor, with a sparse outer falloff.
      const angle = rng.range(0, Math.PI * 2);
      const cx = p.x + Math.cos(angle) * (inner + 1.2 * scale);
      const cz = p.z + Math.sin(angle) * (inner + 1.2 * scale);
      for (let k = 0; k < 22 && result.length - start < 12; k++) {
        const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 2.15 * scale;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (Math.abs(x) > island.size / 2 - scale || Math.abs(z) > island.size / 2 - scale ||
            pavedAt(x, z)) continue;
        if (yard && Math.abs(x - yard.x) < 40.8 * scale && Math.abs(z - yard.z) < 36.8 * scale) continue;
        if (farm && Math.abs(x - farm.x) < 47 * scale && z - farm.z > 32 * scale && z - farm.z < 76 * scale) continue;
        const y = capeSurface(island, x, z);
        const at = { x, y, z };
        if (y < island.seaLevel + .37 * scale || isDamHeadwater(island, x, z) ||
            (outflow.containsXZ(x, z) && y < outflow.surfaceY(z) + .45 * scale)) continue;
        const river = riverAt(at, island.river);
        if (river.distance < river.width * .56 + .5 * scale && y < river.level + .38 * scale) continue;
        if (routes.some(route => x >= route.left && x <= route.right && z >= route.near && z <= route.far &&
            segmentProjection(at, route.a, route.b).distance < route.width + .4 * scale)) continue;
        if (noTouch.some(s => Math.hypot(s.x - x, s.z - z) < 2 * scale)) continue;
        if (footpath.some((b, i) => i > 0 && segmentProjection(at, footpath[i - 1]!, b).distance < 2.4 * scale)) continue;
        if ((island.districtSets ?? []).some(set =>
          segmentProjection(at, set.approach.from, set.approach.to).distance < 1.8 * scale ||
          set.pieces.some(piece => Math.hypot(piece.bottom.x - x, piece.bottom.z - z) < piece.length * .78))) continue;
        if (isPointInsideProps({ x, y: y + .09 * scale, z }, nearby, .24 * scale)) continue;
        if (Math.max(Math.abs(capeSurface(island, x + .3 * scale, z) - y),
          Math.abs(capeSurface(island, x, z + .3 * scale) - y)) > .22 * scale) continue;
        let kind = rng.pick(recipe.types);
        // Shells belong on the shore, not high on the lighthouse cliff.
        if (kind === 'shell' && y > island.seaLevel + 5 * scale) kind = 'stone';
        const [min, max] = lengths[kind], length = rng.range(min, max) * scale;
        if (result.slice(start).some(d => Math.hypot(d.position.x - x, d.position.z - z) < .7 * length)) continue;
        result.push({ district: poi.id, kind, position: at, length,
          yaw: rng.range(0, 2 * Math.PI), color: rng.pick(palettes[kind]) });
      }
      if (result.length > start) clusters.push(p);
    }
  }
  return result;
}

type Corner = readonly [number, number, number];
interface Batch { positions: number[]; colors: number[]; }
function addDetail(island: IslandData, detail: GroundStoryDetail, batch: Batch): void {
  const { position, length: l, yaw, kind, color } = detail;
  const c = Math.cos(yaw), s = Math.sin(yaw), tint = new THREE.Color(color);
  const lift = island.size / 600 * .018;
  const triangle = (a: Corner, b: Corner, d: Corner, tone = 1) => {
    for (const [u, h, v] of [a, b, d]) {
      const x = position.x + l * (u * c + v * s), z = position.z + l * (v * c - u * s);
      batch.positions.push(x, capeSurface(island, x, z) + lift + h * l, z);
      batch.colors.push(tint.r * tone, tint.g * tone, tint.b * tone);
    }
  };
  if (kind === 'leaf') {
    const tip = [0, .01, -.52] as const, root = [0, .01, .42] as const;
    const ridge = [0, .12, -.02] as const, a = [-.24, .025, -.04] as const, b = [.23, .015, .05] as const;
    triangle(tip, a, ridge, .89); triangle(a, root, ridge, .94);
    triangle(tip, ridge, b, 1.04); triangle(b, ridge, root, 1.02);
  } else if (kind === 'twig' || kind === 'straw') {
    const w = kind === 'straw' ? .027 : .065, h = kind === 'straw' ? .024 : .075;
    const a = [-w, 0, -.5] as const, b = [w, 0, -.48] as const;
    const d = [-w * .6, 0, .48] as const, e = [w * .7, 0, .5] as const;
    const ridgeA = [0, h, -.46] as const, ridgeB = [0, h * .7, .46] as const;
    triangle(a, d, ridgeA, .83); triangle(d, ridgeB, ridgeA, .90);
    triangle(b, ridgeA, e, 1.04); triangle(e, ridgeA, ridgeB, 1.07);
    triangle(a, ridgeA, b, .95); triangle(d, e, ridgeB, .75);
  } else if (kind === 'shell') {
    const hinge = [0, .08, .32] as const, peak = [0, .16, -.12] as const;
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI * .8 + i * Math.PI * 1.6 / 6;
      const b = a + Math.PI * 1.6 / 6;
      const x: Corner = [Math.sin(a) * .38, .02, .2 - Math.cos(a) * .58];
      const z: Corner = [Math.sin(b) * .38, .02, .2 - Math.cos(b) * .58];
      triangle(peak, x, z, i % 2 ? .88 : 1.04);
      triangle(hinge, z, x, .82);
    }
  } else {
    // Angular low scree and pinecone scales have actual volume at goat-eye
    // height, unlike flat green/brown dots on the terrain.
    const cone = kind === 'pinecone';
    const radius = cone ? .27 : .38, height = cone ? .41 : .24;
    const crown = [cone ? .02 : -.07, height, -.10] as const;
    const ring = Array.from({ length: 6 }, (_, i): Corner => {
      const a = i * Math.PI / 3;
      return [radius * Math.cos(a) * (i % 2 ? .86 : 1), .015, (cone ? .47 : .38) * Math.sin(a)];
    });
    for (let i = 0; i < 6; i++) {
      const a = ring[i]!, b = ring[(i + 1) % 6]!;
      if (!cone) { triangle(a, crown, b, .78 + .07 * i); continue; }
      const mid: Corner = [(a[0] + b[0]) * .41, height * .53, (a[2] + b[2]) * .46];
      triangle(a, mid, b, i % 2 ? .84 : 1.04);
      triangle(a, crown, mid, .82); triangle(mid, crown, b, 1.04);
    }
  }
}

/** One merged batch per district, not one mesh/draw per leaf or rock. */
export function buildGroundStory(island: IslandData, pavedAt: (x: number, z: number) => boolean) {
  const group = new THREE.Group();
  group.name = 'lived-in-ground-story';
  const batches = new Map<PoiId, Batch>();
  for (const detail of planGroundStory(island, pavedAt)) {
    let batch = batches.get(detail.district);
    if (!batch) { batch = { positions: [], colors: [] }; batches.set(detail.district, batch); }
    addDetail(island, detail, batch);
  }
  const material = new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap: TOON_RAMP, side: THREE.DoubleSide,
  });
  const meshes: THREE.Mesh[] = [];
  for (const [district, batch] of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.colors, 3));
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ground-story-' + district;
    mesh.receiveShadow = true;
    group.add(mesh); meshes.push(mesh);
  }
  if (!meshes.length) material.dispose();
  const range = 68 * island.size / 600;
  return {
    group,
    update(position: THREE.Vector3, frustum: THREE.Frustum) {
      for (const mesh of meshes) {
        const sphere = mesh.geometry.boundingSphere!;
        mesh.visible = sphere.center.distanceTo(position) - sphere.radius < range &&
          frustum.intersectsSphere(sphere);
      }
    },
  };
}
