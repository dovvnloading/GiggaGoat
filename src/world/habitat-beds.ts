import * as THREE from 'three';
import { paintNatureKit } from './plant-palette';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadGroundedKitGeometry } from './library-props';
import { SeededRandom } from './random';
import { makeLocalStreets } from './roads';
import { gridSample, riverAt, segmentProjection } from './terrain';
import type { IslandData, PropDescriptor } from './types';

interface Planting { x: number; y: number; z: number; height: number; yaw: number }
type BedModel = 'crops_dirtSingle' | 'crops_cornStageD' | 'crops_wheatStageB' |
  'crop_turnip' | 'mushroom_tanGroup' | 'mushroom_redGroup' | 'grass_leafsLarge' | 'rock_smallFlatC' | 'flower_yellowA';
type Beds = Map<BedModel, Planting[]>;

function outsideProp(x: number, z: number, radius: number, prop: PropDescriptor): boolean {
  const p = prop.transform.position, yaw = prop.transform.rotationY;
  const dx = x - p.x, dz = z - p.z;
  const reach = (prop.size.x + prop.size.z) * .5 + radius;
  if (Math.abs(dx) > reach || Math.abs(dz) > reach) return true;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const tree = prop.kind === 'tree-pine' || prop.kind === 'tree-oak';
  const width = tree ? Math.min(1.8, prop.size.x * .4) : prop.size.x;
  const depth = tree ? width : prop.size.z;
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - width * .5),
    Math.max(0, Math.abs(dx * s + dz * c) - depth * .5)) > radius;
}

export function planHabitatBeds(island: IslandData): Beds {
  const beds: Beds = new Map();
  const scale = island.size / 600;
  const rng = new SeededRandom(String(island.seed) + ':island-plantings');
  const plant = (model: BedModel, x: number, z: number, height: number, yaw: number, lift = 0): void => {
    const batch = beds.get(model) ?? [];
    batch.push({ x, z, height: height * scale, y: gridSample(island, x, z) + lift * scale, yaw });
    beds.set(model, batch);
  };
  const kit = (island.districtSets ?? []).flatMap(set => set.pieces);
  const lines = [...island.roads, ...makeLocalStreets(island)].flatMap(road => {
    const margin = road.width * .5 + (road.type === 'road' ? 2.1 : .7) * scale;
    return road.points.slice(1).map((end, i) => {
      const start = road.points[i]!;
      return { start, end, margin, left: Math.min(start.x, end.x) - margin, right: Math.max(start.x, end.x) + margin,
        back: Math.min(start.z, end.z) - margin, front: Math.max(start.z, end.z) + margin };
    });
  });
  const approaches = (island.districtSets ?? []).map(set => set.approach);
  const solid = island.props.filter(p => p.collidable && !['grass-tuft', 'flower'].includes(p.kind));
  const safe = (x: number, z: number, r: number): boolean => {
    const y = gridSample(island, x, z);
    if (y < island.seaLevel + .32 * scale) return false;
    const river = riverAt({ x, z }, island.river);
    if (river.distance < river.width * .52 + r && y < river.level + .5 * scale) return false;
    return !lines.some(l => x >= l.left - r && x <= l.right + r && z >= l.back - r && z <= l.front + r &&
      segmentProjection({ x, z }, l.start, l.end).distance < l.margin + r) &&
      approaches.every(a => segmentProjection({ x, z }, a.from, a.to).distance > 1.05 * scale + r) &&
      solid.every(p => outsideProp(x, z, r, p)) &&
      kit.every(p => Math.hypot(p.bottom.x - x, p.bottom.z - z) > p.length * .72 + r) &&
      island.spawns.every(p => Math.hypot(x - p.position.x, z - p.position.z) > 2.5 * scale + r);
  };

  // Vegetable plots follow the street and barn yards. Keep each small bed
  // intact and move it as a unit on seeds with a different obstacle layout.
  const farm = island.pois.find(p => p.id === 'hoofington')!.center;
  const used: { x: number; z: number }[] = [];
  const plots: [number, number, BedModel][] = [
    [-13, 13, 'crop_turnip'], [14, 5, 'crops_wheatStageB'], [-25, -12, 'crops_cornStageD'],
    [25, 19, 'crop_turnip'], [-32, 22, 'crops_wheatStageB'], [30, -22, 'crops_cornStageD'],
    [17, 36, 'crops_wheatStageB'], [-22, 37, 'crops_cornStageD'],
  ];
  for (const [dx, dz, crop] of plots) {
    const radius = 3.25 * scale;
    for (let attempt = 0; attempt < 200; attempt++) {
      const ring = attempt === 0 ? 0 : 1 + Math.floor((attempt - 1) / 16);
      const reach = ring * 3.2 * scale;
      const angle = attempt * Math.PI / 8 + ring * .23;
      const x = farm.x + dx * scale + Math.cos(angle) * reach, z = farm.z + dz * scale + Math.sin(angle) * reach;
      if (used.some(p => Math.hypot(x - p.x, z - p.z) < radius * 2) || !safe(x, z, radius)) continue;
      const h = gridSample(island, x, z);
      if ([[-1, -1], [1, -1], [-1, 1], [1, 1]].some(([a, b]) =>
        Math.abs(gridSample(island, x + a! * 2.8 * scale, z + b! * 2.8 * scale) - h) > .34 * scale)) continue;
      used.push({ x, z });
      for (let row = -1; row <= 1; row++) for (let col = -2; col <= 2; col++) {
        const px = x + row * 1.45 * scale, pz = z + col * 1.14 * scale;
        plant('crops_dirtSingle', px, pz, .14, 0, -.055);
        const height = crop === 'crops_cornStageD' ? 1.27 : crop === 'crop_turnip' ? .47 : .84;
        plant(crop, px, pz, height * rng.range(.84, 1.08), rng.range(-.35, .35), .035);
      }
      break;
    }
  }

  // Colonies sit at the damp woodland edge and in the heath behind the cape.
  const pines = island.pois.find(p => p.id === 'whispering-pines')!;
  const cape = island.pois.find(p => p.id === 'old-lighthouse')!;
  for (const poi of [pines, cape]) {
    for (let bed = 0; bed < 36; bed++) {
      const angle = rng.range(0, Math.PI * 2), reach = poi.radius * rng.range(.32, 1.22);
      const x = poi.center.x + Math.cos(angle) * reach, z = poi.center.z + Math.sin(angle) * reach;
      if (!safe(x, z, 1.55 * scale)) continue;
      for (let stem = 0; stem < 4; stem++) {
        const px = x + rng.range(-.9, .9) * scale, pz = z + rng.range(-.9, .9) * scale;
        const coastal = poi === cape;
        plant(coastal ? 'grass_leafsLarge' : bed % 3 ? 'mushroom_tanGroup' : 'mushroom_redGroup',
          px, pz, rng.range(.27, coastal ? .70 : .46), rng.range(0, Math.PI * 2), -.025);
      }
    }
  }
  // Low kit plants and loose stone follow specific shoulders, leaving the travel side open.
  const verges: [string, number, number, number, number, BedModel, number][] = [
    ['hoofington', -17, 40, 14, -.32, 'flower_yellowA', .34],
    ['hoofington', -24, 12, 19, 1.29, 'grass_leafsLarge', .39],
    ['baa-ardwalk', -17, -16, 21, .12, 'grass_leafsLarge', .49],
    ['baa-ardwalk', 6, -20, 24, -.26, 'grass_leafsLarge', .42],
    ['baa-ardwalk', 17, 7, 15, .56, 'rock_smallFlatC', .23],
    ['mt-gigga', 6, 6, 21, -.38, 'rock_smallFlatC', .27],
    ['mt-gigga', -57, 34, 25, -1.15, 'rock_smallFlatC', .33],
    ['whispering-pines', -9, 25, 20, 1.22, 'grass_leafsLarge', .41],
    ['whispering-pines', -14, -3, 24, -.88, 'mushroom_tanGroup', .28],
    ['the-dam', 23, -20, 16, 1.32, 'rock_smallFlatC', .24],
    ['old-lighthouse', -9, 8, 12, -.92, 'grass_leafsLarge', .39],
    ['old-lighthouse', 7, 11, 14, .3, 'rock_smallFlatC', .2],
  ];
  for (const [zone, dx, dz, length, angle, model, height] of verges) {
    const center = island.pois.find(p => p.id === zone)!.center;
    for (let j = -length / 2; j <= length / 2; j += 1.35) {
      const t = j + rng.range(-.5, .5), side = rng.range(-1.65, 1.65);
      const x = center.x + (dx + t * Math.cos(angle) - side * Math.sin(angle)) * scale;
      const z = center.z + (dz + t * Math.sin(angle) + side * Math.cos(angle)) * scale;
      if (safe(x, z, .68 * scale)) {
        plant(model, x, z, height * rng.range(.66, 1.15), rng.range(0, Math.PI * 2), -.035);
      }
    }
  }
  return beds;
}

export function buildHabitatBeds(island: IslandData) {
  const group = new THREE.Group();
  group.name = 'district-plantings';
  if (typeof document === 'undefined') return { group, dispose() { } };
  const loader = new GLTFLoader(), beds = planHabitatBeds(island);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  let disposed = false;

  async function load(): Promise<void> {
    for (const [model, sites] of beds) {
      if (disposed) return;
      try {
        const geometry = await loadGroundedKitGeometry('assets/library/kenney/nature-kit/' + model + '.glb', loader);
        if (disposed) { geometry.dispose(); return; }
        if (model === 'rock_smallFlatC') {
          const colours = geometry.getAttribute('color');
          const slate = new THREE.Color(0x858780), lichen = new THREE.Color(0xa5a88c);
          for (let i = 0; i < colours.count; i++) {
            const tint = colours.getY(i) > colours.getX(i) ? lichen : slate;
            colours.setXYZ(i, tint.r, tint.g, tint.b);
          }
        } else paintNatureKit(geometry);
        const span = geometry.boundingBox!.getSize(new THREE.Vector3());
        const mesh = new THREE.InstancedMesh(geometry, material, sites.length);
        const transform = new THREE.Object3D();
        for (const [i, p] of sites.entries()) {
          transform.position.set(p.x, p.y, p.z);
          transform.rotation.y = p.yaw;
          transform.scale.setScalar(p.height / Math.max(.001, span.y));
          if (model === 'crops_dirtSingle') transform.scale.set(1.19 * island.size / 600 / span.x,
            p.height / span.y, 1.17 * island.size / 600 / span.z);
          transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
        }
        mesh.name = 'planted-' + model; mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
      } catch (error) { console.warn('Could not load planted kit ' + model, error); }
    }
  }
  void load();
  return {
    group, dispose() {
      disposed = true;
      for (const mesh of group.children) if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
      material.dispose();
    }
  };
}
