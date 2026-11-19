import models from './district-kit-models.json';
import collision from './district-kit-collision.json';
import { DAM_UPSTREAM_RIVER_END, DAM_FOREST_RIVER_START, isDamHeadwater, getDamOutflow } from './dam-landscape';
import { downtownPublicSpaceAt, downtownPublicSpaces } from './downtown-public-space';
import { HOOFINGTON_FIELD_ENTRANCES, HOOFINGTON_YARD_ENTRANCES } from './hoofington-entrances';
import { LIGHTHOUSE_FOOTPATH } from './lighthouse-access';
import { makeLocalStreets } from './roads';
import { gridSample, riverAt, segmentProjection, zoneAt } from './terrain';
import { isInsideDowntownInfillFootprint } from './visual-downtown';
import type { IslandData, PoiId, PropColliderDescriptor, Vec2, Vec3 } from './types';

export type DistrictModel = keyof typeof models;
export { models as districtModels };
export interface SetPiece { model: DistrictModel; bottom: Vec3; yaw: number; length: number }
export interface DistrictApproach { from: Vec2; to: Vec2; landmark: string }
export interface DistrictSet { name: string; district: PoiId; pieces: SetPiece[]; approach: DistrictApproach }
type Item = [model: DistrictModel, x: number, z: number, length: number, degrees?: number];
interface Layout { name: string; district: PoiId; x: number; z: number; degrees: number; items: Item[] }

// Each arrangement has its own working or public side. Move the ensemble
// together if terrain or existing kit geometry occupies its preferred site.
const layouts: Layout[] = [
  {
    district: 'hoofington', name: 'Roadside pumpkin cart', x: 11.02, z: -14.527, degrees: 74, items: [
      ['harvestCart', 0, 0, 2.6], ['pumpkin', 1.3, .5, .76], ['pumpkin', 1.45, -.3, .58],
      ['pumpkin', 1.9, .21, .53]]
  },
  {
    district: 'hoofington', name: 'Harvest stand', x: 20.617, z: -6.523, degrees: 90, items: [
      ['produceStall', 0, 0, 4.2], ['harvestCart', 3.3, .4, 2.7, 20], ['pumpkin', 2.7, 2.1, .72],
      ['pumpkin', 3.46, 2.24, .56], ['pumpkin', 3.15, 2.87, .48], ['bottles', -2.4, .2, 1]]
  },
  {
    district: 'hoofington', name: 'Tractor yard', x: 40.161, z: -11.694, degrees: 12, items: [
      ['tractor', 0, 0, 4.4, -25], ['chickenCoop', 4.8, -1, 4.1, 110], ['logs', 4.1, 2.8, 2.4, 78]]
  },
  {
    district: 'baa-ardwalk', name: 'Lemonade terrace', x: -15.471, z: 7.76, degrees: 35, items: [
      ['drinks', 0, 0, 5.1], ['iceTable', 3.6, 1.5, 1.7], ['cafeChair', 2.65, 2.5, 1.15, 140],
      ['cafeChair', 4.65, 1.5, 1.15, -80], ['picnicBench', -3.2, 1.2, 2.3, -35]]
  },
  {
    district: 'baa-ardwalk', name: 'Beach snack counter', x: 18.719, z: 2.851, degrees: -45, items: [
      ['snack', 0, 0, 4.8], ['picnicBench', 3.6, 1.3, 2.4, 85], ['picnicBench', 3.6, -1.5, 2.4, 95]]
  },
  {
    district: 'crane-yard', name: 'Loader apron', x: 16.581, z: 17.121, degrees: 15, items: [
      ['loader', 0, 0, 5.6, -20], ['timber', 4, 1.1, 3.9, 8], ['pallet', 3.7, -1.6, 1.9, -5]]
  },
  {
    district: 'crane-yard', name: 'Haulage staging', x: 3.107, z: -20.63, degrees: -45, items: [
      ['truck', 0, 0, 6.4], ['fieldBox', 3, -1.4, 2.1, 10], ['fieldBox', 3, 1.2, 1.8, -10]]
  },
  {
    district: 'downtown-bleatsville', name: 'Street market', x: -12.782, z: 48.372, degrees: 85, items: [
      ['market', 0, 0, 4.2], ['produceStall', 4.4, -.25, 3.8, 10], ['bottles', -2.35, .7, 1.1],
      ['harvestCart', 6.9, 1.3, 2.5, 25], ['pumpkin', 2.1, 1.8, .68]]
  },
  {
    district: 'downtown-bleatsville', name: 'Cafe delivery', x: 16.657, z: -50.114, degrees: -85, items: [
      ['delivery', 0, 0, 5.25], ['iceTable', 3.7, -.7, 1.6], ['cafeChair', 4.8, -.55, 1.15, -95],
      ['cafeChair', 2.7, -1.25, 1.15, 55], ['bottles', .9, 3.3, 1.15, 7]]
  },
  {
    district: 'mt-gigga', name: 'Expedition bivouac', x: -10.974, z: 0.72, degrees: 35, items: [
      ['expedition', 0, 0, 3.3], ['bedroll', 1.9, .32, 1.1, -80], ['pack', 1.95, -.82, .73, 18],
      ['radio', -1.98, .53, .7, 22]]
  },
  {
    district: 'mt-gigga', name: 'Survey cache', x: -56, z: 39, degrees: 16, items: [
      ['fieldBox', 0, 0, 2.1, 10], ['fieldBox', 1.45, .25, 1.35, -15], ['pack', -.65, 1.65, 1.05, 28]]
  },
  {
    district: 'whispering-pines', name: 'Canoe landing', x: 0.683, z: -16.872, degrees: 40, items: [
      ['canoe', 0, 0, 4.8], ['canoe', 1.65, .55, 4.1, 12], ['logs', -2.25, .5, 2.1, 32],
      ['bucket', -1.95, -1.3, .71]]
  },
  {
    district: 'whispering-pines', name: 'Trail camp', x: -23.419, z: 5.121, degrees: -25, items: [
      ['expedition', 0, 0, 3.2], ['fire', 2.2, 1.8, 1.55], ['bedroll', .5, 2.4, 1.55, -30], ['pack', -2, .4, .88]]
  },
  {
    district: 'the-dam', name: 'Pump station', x: 20.132, z: -17.222, degrees: 4, items: [
      ['mill', 0, 0, 5.7], ['pump', 4, .1, 2.8], ['barrel', 3.6, 2.6, 1.3], ['barrel', 5.1, 2.7, 1.3]]
  },
  {
    district: 'the-dam', name: 'Turbine service bay', x: 6.156, z: -11.641, degrees: 80, items: [
      ['grinder', 0, 0, 2.2], ['pump', 2.9, .25, 2.5, 90], ['fieldBox', .3, 1.9, 1.5, 80]]
  },
  {
    district: 'old-lighthouse', name: 'Keeper’s boatyard', x: -12.255, z: 0.618, degrees: 47, items: [
      ['skiff', 0, 0, 4.4, 12], ['barrel', 2.9, .2, 1.4], ['bottles', 3.2, 1.8, 1.05], ['bucket', -2.6, 1.1, .9]]
  },
  {
    district: 'old-lighthouse', name: 'Fish landing', x: 7.42, z: 11.093, degrees: -38, items: [
      ['fishStand', 0, 0, 2.8], ['fishBasket', 2.25, .7, 1.35], ['bucket', 1.7, -.8, .7], ['bottles', -1.8, -.2, .9]]
  },
  {
    district: 'hoofington', name: 'Seed packing bench', x: -23.2817, z: 3.0987, degrees: -30, items: [
      ['pottingBench', 0, 0, 2.45], ['seedSack', 1.7, .42, .86], ['seedSack', 1.85, -.53, .72]]
  },
  {
    district: 'baa-ardwalk', name: 'Promenade parasols', x: 9, z: -17, degrees: 25, items: [
      ['parasol', 0, 0, 3.25], ['cafeChair', -2.05, .22, 1.16, -65], ['cafeChair', 2.1, -.12, 1.16, 75]]
  },
  {
    district: 'crane-yard', name: 'Aggregate loading line', x: 12.3292, z: -3.9085, degrees: 90, items: [
      ['conveyor', 0, 0, 4.8], ['oreBin', 3.9, .35, 2.65], ['pallet', -2.4, 2, 1.5, 10]]
  },
  {
    district: 'downtown-bleatsville', name: 'Delivery alley', x: -23, z: -49, degrees: -90, items: [
      ['serviceBin', 0, 0, 2.25], ['pallet', 1.9, .1, 1.55, -8], ['openChest', 1.92, 1.65, 1.18, 14]]
  },
  {
    district: 'mt-gigga', name: 'Climbers rest', x: -62.6592, z: 22.1191, degrees: -40, items: [
      ['campCot', 0, 0, 1.85], ['pack', 1.1, .1, .65]]
  },
  {
    district: 'whispering-pines', name: 'Woodcutters bench', x: 17.0439, z: 16.5579, degrees: 15, items: [
      ['pottingBench', 0, 0, 2.55], ['logs', 2.85, -.45, 2.45, 10], ['openChest', -2.08, -.05, 1.35]]
  },
  {
    district: 'the-dam', name: 'Valve inspection bay', x: 11.3418, z: -15.1857, degrees: 89, items: [
      ['valve', 0, 0, 3.45], ['controls', 2.94, .16, 1.93, -12], ['fieldBox', 2.7, 2.14, 1.4, 5]]
  },

];

type Footprint = { x: number; z: number; halfX: number; halfZ: number; yaw: number };
function footprint(piece: SetPiece): Footprint {
  const [sx, , sz] = collision[piece.model].span;
  return { ...piece.bottom, halfX: sx! * piece.length / 2, halfZ: sz! * piece.length / 2, yaw: piece.yaw };
}
function clearance(block: Footprint, x: number, z: number): number {
  const dx = x - block.x, dz = z - block.z, c = Math.cos(block.yaw), s = Math.sin(block.yaw);
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - block.halfX),
    Math.max(0, Math.abs(dx * s + dz * c) - block.halfZ));
}

export function districtSets(island: IslandData): DistrictSet[] {
  const scale = island.size / 600;
  const roads = [...island.roads, ...makeLocalStreets(island)];
  const corridors = roads.flatMap(road => road.points.slice(1).map((end, i) =>
    ({ road: road.id, start: road.points[i]!, end, buffer: road.width * .5 + (road.type === 'road' ? 2.65 : 1.0) * scale })));
  const fixed = island.colliders.flatMap(c => c.shape === 'heightfield' ? [] : [{
    ...c.transform.position, halfX: c.size.x / 2, halfZ: c.size.z / 2, yaw: c.transform.rotationY,
    bottom: c.transform.position.y - c.size.y / 2, top: c.transform.position.y + c.size.y / 2,
  }]);
  const safe = [...island.spawns.map(s => s.position), ...island.relics.map(r => r.position),
  ...island.pois.map(p => p.center)];
  const paving = downtownPublicSpaces(island), outflow = getDamOutflow(island);
  // The dam replaced the original river reaches with a clipped reservoir and an outflow.
  const reaches = [island.river.slice(0, DAM_UPSTREAM_RIVER_END), island.river.slice(DAM_FOREST_RIVER_START)];
  const wet = (x: number, z: number, y: number, radius: number) =>
    isDamHeadwater(island, x, z) || (outflow.containsXZ(x, z) && y < outflow.surfaceY(z) + .5 * scale) ||
    reaches.some(reach => {
      const bank = riverAt({ x, z }, reach);
      return bank.distance < bank.width * .52 + radius && y < bank.level + .6 * scale;
    });
  const result: DistrictSet[] = [];
  for (const site of layouts) {
    const centre = island.pois.find(p => p.id === site.district)!.center;
    const ax = centre.x + site.x * scale, az = centre.z + site.z * scale;
    const localRoads = corridors.filter(r => segmentProjection(centre, r.start, r.end).distance < 110 * scale + r.buffer);
    if (site.district === 'crane-yard') {
      // Reserve full-depth access at both open vehicle gates, including the
      // turning space just inside the perimeter. Both lanes run north/south.
      for (const [x, near, far] of [[-4, -44, -22], [20, 23, 44]] as const) {
        const start = { x: centre.x + x * scale, y: centre.y, z: centre.z + near * scale, bridge: false };
        const end = { ...start, z: centre.z + far * scale };
        localRoads.push({ road: 'Crane Yard gate', start, end, buffer: 3.3 * scale });
      }
    }
    const localBlocks = fixed.filter(b => clearance(b, centre.x, centre.z) < 110 * scale);
    const landmarks: { x: number; z: number; name: string }[] = [];
    if (site.district === 'hoofington') {
      for (const gate of [...HOOFINGTON_FIELD_ENTRANCES, ...HOOFINGTON_YARD_ENTRANCES])
        landmarks.push({ x: centre.x + gate.x * scale, z: centre.z + gate.z * scale, name: 'Hoofington pasture gate' });
    }
    if (site.district === 'old-lighthouse') {
      for (const [dx, dz] of LIGHTHOUSE_FOOTPATH)
        landmarks.push({ x: centre.x + dx * scale, z: centre.z + dz * scale, name: 'Lighthouse winding footpath' });
    }
    const angle = site.degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    // Start at an actual ground-level road, trail or respawn landmark. Sample
    // the full width of the walk and its viewing apron against rock, trees,
    // grade and water. Ground directly under a bridge is not its approach.
    function approachTo(pieces: SetPiece[]): DistrictApproach | undefined {
      const anchor = pieces[0]!.bottom, candidates: { start: Vec2; distance: number; landmark: string }[] = [];
      for (const road of localRoads) {
        if (road.start.bridge || road.end.bridge) continue;
        const { t, distance } = segmentProjection(anchor, road.start, road.end);
        if (distance > 25 * scale) continue;
        const start = { x: road.start.x + (road.end.x - road.start.x) * t, z: road.start.z + (road.end.z - road.start.z) * t };
        const roadY = road.start.y + (road.end.y - road.start.y) * t;
        if (Math.abs(roadY - gridSample(island, start.x, start.z)) > .8 * scale) continue;
        candidates.push({ start, distance, landmark: road.road });
      }
      for (const landmark of landmarks) {
        const distance = Math.hypot(anchor.x - landmark.x, anchor.z - landmark.z);
        if (distance < 25 * scale) candidates.push({ start: landmark, distance, landmark: landmark.name });
      }
      for (const spawn of island.spawns) {
        if (spawn.poiId !== site.district) continue;
        const distance = Math.hypot(anchor.x - spawn.position.x, anchor.z - spawn.position.z);
        if (distance < 25 * scale) candidates.push({ start: spawn.position, distance, landmark: spawn.id });
      }
      const blocks = [...localBlocks, ...pieces.map(p => ({
        ...footprint(p), y: p.bottom.y, bottom: p.bottom.y, top: p.bottom.y + p.length }))];
      for (const { start, distance, landmark } of candidates.sort((a, b) => a.distance - b.distance)) {
        const stop = pieces[0]!.length * .5 + 2.2 * scale;
        if (distance < stop + 1.5 * scale || zoneAt(island, start.x, start.z) !== site.district) continue;
        const dx = (anchor.x - start.x) / distance, dz = (anchor.z - start.z) / distance;
        const length = distance - stop, steps = Math.ceil(length / scale);
        let clear = true;
        for (let i = 0; clear && i <= steps; i++) {
          const x = start.x + dx * length * i / steps, z = start.z + dz * length * i / steps;
          const y = gridSample(island, x, z);
          if (site.district === 'downtown-bleatsville' && isInsideDowntownInfillFootprint(island, x, z)) {
            clear = false; break;
          }
          if (y < island.seaLevel + .5 * scale || wet(x, z, y, 0) ||
            zoneAt(island, x, z) !== site.district ||
            blocks.some(b => b.top > y + .2 * scale && b.bottom < y + 2 * scale && clearance(b, x, z) < .95 * scale)) {
            clear = false; break;
          }
          // Check both sides of the corridor as well as forward grade. A level
          // centre sample beside a sheer drop is unsuitable for a third-person view.
          for (const [vx, vz] of [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]] as const) {
            if (Math.abs(gridSample(island, x + vx * scale, z + vz * scale) - y) > .7 * scale) { clear = false; break; }
          }
        }
        if (clear) return { from: { x: start.x, z: start.z },
          to: { x: start.x + dx * length, z: start.z + dz * length }, landmark };
      }
    }
    function trySite(x: number, z: number): SetPiece[] | undefined {
      if (site.district === 'mt-gigga' && result.some(set => set.district === site.district &&
        Math.hypot(set.pieces[0]!.bottom.x - x, set.pieces[0]!.bottom.z - z) < 18 * scale)) return;
      const pieces: SetPiece[] = [];
      for (const [model, dx, dz, span, yaw = 0] of site.items) {
        const px = x + (dx * c + dz * s) * scale, pz = z + (dz * c - dx * s) * scale;
        const y = gridSample(island, px, pz), bottom = { x: px, y, z: pz };
        const p = { model, bottom, length: span * scale, yaw: angle + yaw * Math.PI / 180 };
        const f = footprint(p), radius = Math.hypot(f.halfX, f.halfZ);
        if (zoneAt(island, px, pz) !== site.district || y < island.seaLevel + .38 * scale ||
          localBlocks.some(b => y < b.top + .35 * scale && y + span * scale > b.bottom - .35 * scale && clearance(b, px, pz) < radius + .35 * scale) ||
          safe.some(q => Math.hypot(q.x - px, q.z - pz) < radius + 2.5 * scale) ||
          localRoads.some(r => segmentProjection(bottom, r.start, r.end).distance < r.buffer + radius) ||
          result.some(set => segmentProjection(bottom, set.approach.from, set.approach.to).distance < radius + 1.3 * scale)) return;
        if (wet(px, pz, y, radius) || landmarks.some(l => clearance(f, l.x, l.z) < 1.8 * scale)) return;
        const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
        let min = y, max = y;
        for (const vx of [-f.halfX, f.halfX]) for (const vz of [-f.halfZ, f.halfZ]) {
          const cx = px + vx * cos + vz * sin, cz = pz + vz * cos - vx * sin;
          if (site.district === 'downtown-bleatsville' && (isInsideDowntownInfillFootprint(island, cx, cz) ||
            downtownPublicSpaceAt(paving, cx, cz, .35 * scale))) return;
          const h = gridSample(island, cx, cz);
          if (zoneAt(island, cx, cz) !== site.district || wet(cx, cz, h, 0)) return;
          min = Math.min(min, h); max = Math.max(max, h);
        }
        if (max - min > Math.min(.46 * scale, .13 * radius + .12 * scale)) return;
        bottom.y = (min + max) / 2 - Math.min(.045 * scale, (max - min) / 3);
        // Keep the working side of the scenery well back from scarps. Check
        // beyond the footprint too, where the goat and chase camera can stand.
        for (const [vx, vz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const pad = radius + 2 * scale;
          if (Math.abs(gridSample(island, px + vx * pad, pz + vz * pad) - y) > .65 * pad) return;
        }
        if (pieces.length === 0 && (site.district === 'mt-gigga' || site.district === 'old-lighthouse')) {
          for (let i = 0; i < 12; i++) {
            const angle = i * Math.PI / 6;
            const rise = gridSample(island, px + Math.cos(angle) * 6 * scale, pz + Math.sin(angle) * 6 * scale) - y;
            if (rise < -2.6 * scale || (site.district === 'old-lighthouse' && rise > 4 * scale)) return;
          }
        }
        pieces.push(p);
      }
      return pieces;
    }
    // Scan in half-aisle increments around the designed anchor. Only accept
    // a site that can accommodate the entire collection and its work aisle.
    const maxRing = 29;
    for (let ring = 0; ring <= maxRing; ring++) {
      let placed = false;
      const count = Math.max(1, ring * 7);
      for (let j = 0; j < count; j++) {
        const a = (j / count) * Math.PI * 2 + ring * .63;
        const pieces = trySite(ax + Math.cos(a) * ring * 2.5 * scale, az + Math.sin(a) * ring * 2.5 * scale);
        if (!pieces) continue;
        const approach = approachTo(pieces);
        if (!approach) continue;
        result.push({ district: site.district, name: site.name, pieces, approach });
        for (const piece of pieces) fixed.push({ ...footprint(piece), y: piece.bottom.y, bottom: piece.bottom.y, top: piece.bottom.y + piece.length });
        placed = true; break;
      }
      if (placed) break;
    }
  }
  return result;
}

const surfaces = {
  tractor: 'metal', harvestCart: 'wood', produceStall: 'wood', pumpkin: 'soft', chickenCoop: 'wood',
  drinks: 'wood', iceTable: 'wood', cafeChair: 'wood', picnicBench: 'wood', snack: 'wood',
  loader: 'metal', truck: 'metal', timber: 'wood', pallet: 'wood', delivery: 'metal', market: 'wood',
  bottles: 'wood', expedition: 'soft', bedroll: 'soft', radio: 'metal', fieldBox: 'wood', canoe: 'wood',
  logs: 'wood', fire: 'stone', pack: 'soft', mill: 'metal', pump: 'metal', grinder: 'stone',
  skiff: 'wood', fishStand: 'wood', barrel: 'wood', bucket: 'metal', seedSack: 'soft',
  pottingBench: 'wood', parasol: 'soft', conveyor: 'metal', oreBin: 'metal', serviceBin: 'metal',
  campCot: 'soft', openChest: 'wood', valve: 'metal', controls: 'metal',
  fishBasket: 'wood',
} as const satisfies Record<DistrictModel, NonNullable<PropColliderDescriptor['surface']>>;

export function districtSetColliders(sets: DistrictSet[]): PropColliderDescriptor[] {
  return sets.flatMap(set => set.pieces.map((p, i) => {
    const model = collision[p.model], length = p.length;
    return {
      id: 'kit-' + set.district + '-' + set.name + '-' + i, shape: 'trimesh' as const, surface: surfaces[p.model],
      transform: { position: p.bottom, rotationY: p.yaw }, body: { type: 'static' as const },
      size: { x: model.span[0]! * length, y: model.span[1]! * length, z: model.span[2]! * length },
      vertices: Float32Array.from(model.vertices, n => n * length / 4096), indices: Uint32Array.from(model.indices)
    };
  }));
}
