import models from './district-kit-models.json';
import collision from './district-kit-collision.json';
import { getDamHeadwater, getDamOutflow } from './dam-landscape';
import { downtownPublicSpaceAt, downtownPublicSpaces } from './downtown-public-space';
import { makeLocalStreets } from './roads';
import { gridSample, riverAt, segmentProjection } from './terrain';
import { isInsideDowntownInfillFootprint } from './visual-downtown';
import type { IslandData, PoiId, PropColliderDescriptor, Vec2, Vec3 } from './types';

export type DistrictModel = keyof typeof models;
export { models as districtModels };
export interface SetPiece { model: DistrictModel; bottom: Vec3; yaw: number; length: number }
export interface DistrictSet { name: string; district: PoiId; pieces: SetPiece[] }
type Item = [model: DistrictModel, x: number, z: number, length: number, degrees?: number];
interface Layout { name: string; district: PoiId; x: number; z: number; degrees: number; items: Item[] }

// Each arrangement has its own working or public side. Move the ensemble
// together if terrain or existing kit geometry occupies its preferred site.
const layouts: Layout[] = [
  {
    district: 'hoofington', name: 'Roadside pumpkin cart', x: 9, z: -16, degrees: 74, items: [
      ['harvestCart', 0, 0, 2.6], ['pumpkin', 1.3, .5, .76], ['pumpkin', 1.45, -.3, .58],
      ['pumpkin', 1.9, .21, .53]]
  },
  {
    district: 'hoofington', name: 'Harvest stand', x: -11, z: 1, degrees: 90, items: [
      ['produceStall', 0, 0, 4.2], ['harvestCart', 3.3, .4, 2.7, 20], ['pumpkin', 2.7, 2.1, .72],
      ['pumpkin', 3.46, 2.24, .56], ['pumpkin', 3.15, 2.87, .48], ['bottles', -2.4, .2, 1]]
  },
  {
    district: 'hoofington', name: 'Tractor yard', x: 13, z: -16, degrees: 12, items: [
      ['tractor', 0, 0, 4.4, -25], ['chickenCoop', 4.8, -1, 4.1, 110], ['logs', 4.1, 2.8, 2.4, 78]]
  },
  {
    district: 'baa-ardwalk', name: 'Lemonade terrace', x: -17, z: 3, degrees: 35, items: [
      ['drinks', 0, 0, 5.1], ['iceTable', 3.6, 1.5, 1.7], ['cafeChair', 2.65, 2.5, 1.15, 140],
      ['cafeChair', 4.65, 1.5, 1.15, -80], ['picnicBench', -3.2, 1.2, 2.3, -35]]
  },
  {
    district: 'baa-ardwalk', name: 'Beach snack counter', x: 17, z: -7, degrees: -45, items: [
      ['snack', 0, 0, 4.8], ['picnicBench', 3.6, 1.3, 2.4, 85], ['picnicBench', 3.6, -1.5, 2.4, 95]]
  },
  {
    district: 'crane-yard', name: 'Loader apron', x: 23, z: 21, degrees: 15, items: [
      ['loader', 0, 0, 5.6, -20], ['timber', 4, 1.1, 3.9, 8], ['pallet', 3.7, -1.6, 1.9, -5]]
  },
  {
    district: 'crane-yard', name: 'Haulage staging', x: -24, z: -16, degrees: -45, items: [
      ['truck', 0, 0, 6.4], ['fieldBox', 3, -1.4, 2.1, 10], ['fieldBox', 3, 1.2, 1.8, -10]]
  },
  {
    district: 'downtown-bleatsville', name: 'Street market', x: -11, z: 36, degrees: 85, items: [
      ['market', 0, 0, 4.2], ['produceStall', 4.4, -.25, 3.8, 10], ['bottles', -2.35, .7, 1.1],
      ['harvestCart', 6.9, 1.3, 2.5, 25], ['pumpkin', 2.1, 1.8, .68]]
  },
  {
    district: 'downtown-bleatsville', name: 'Cafe delivery', x: 13, z: -33, degrees: -85, items: [
      ['delivery', 0, 0, 5.25], ['iceTable', 3.7, -.7, 1.6], ['cafeChair', 4.8, -.55, 1.15, -95],
      ['cafeChair', 2.7, -1.25, 1.15, 55], ['bottles', .9, 3.3, 1.15, 7]]
  },
  {
    district: 'mt-gigga', name: 'Expedition bivouac', x: -4, z: 14, degrees: 35, items: [
      ['expedition', 0, 0, 3.3], ['bedroll', 1.9, .32, 1.1, -80], ['pack', 1.95, -.82, .73, 18],
      ['radio', -1.98, .53, .7, 22]]
  },
  {
    district: 'mt-gigga', name: 'Survey cache', x: -26, z: 26, degrees: 16, items: [
      ['fieldBox', 0, 0, 2.1, 10], ['fieldBox', 1.45, .25, 1.35, -15], ['pack', -.65, 1.65, 1.05, 28]]
  },
  {
    district: 'whispering-pines', name: 'Canoe landing', x: 13, z: -19, degrees: 40, items: [
      ['canoe', 0, 0, 4.8], ['canoe', 1.65, .55, 4.1, 12], ['logs', -2.25, .5, 2.1, 32],
      ['bucket', -1.95, -1.3, .71]]
  },
  {
    district: 'whispering-pines', name: 'Trail camp', x: -17, z: 9, degrees: -25, items: [
      ['expedition', 0, 0, 3.2], ['fire', 2.2, 1.8, 1.55], ['bedroll', .5, 2.4, 1.55, -30], ['pack', -2, .4, .88]]
  },
  {
    district: 'the-dam', name: 'Pump station', x: 24, z: -8, degrees: 4, items: [
      ['mill', 0, 0, 5.7], ['pump', 4, .1, 2.8], ['barrel', 3.6, 2.6, 1.3], ['barrel', 5.1, 2.7, 1.3]]
  },
  {
    district: 'the-dam', name: 'Turbine service bay', x: -28, z: -4, degrees: 80, items: [
      ['grinder', 0, 0, 2.2], ['pump', 2.9, .25, 2.5, 90], ['fieldBox', .3, 1.9, 1.5, 80]]
  },
  {
    district: 'old-lighthouse', name: 'Keeper’s boatyard', x: 9, z: 8, degrees: 47, items: [
      ['skiff', 0, 0, 4.4, 12], ['barrel', 2.9, .2, 1.4], ['bottles', 3.2, 1.8, 1.05], ['bucket', -2.6, 1.1, .9]]
  },
  {
    district: 'old-lighthouse', name: 'Fish landing', x: -6, z: -10, degrees: -38, items: [
      ['fishStand', 0, 0, 2.8], ['barrel', 2.25, .7, 1.35], ['bucket', 1.7, -.8, .7], ['bottles', -1.8, -.2, .9]]
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
    ({ start: road.points[i]!, end, buffer: road.width * .5 + (road.type === 'road' ? 2.65 : 1.0) * scale })));
  const fixed = island.colliders.flatMap(c => c.shape === 'heightfield' ? [] : [{
    ...c.transform.position, halfX: c.size.x / 2, halfZ: c.size.z / 2, yaw: c.transform.rotationY,
    bottom: c.transform.position.y - c.size.y / 2, top: c.transform.position.y + c.size.y / 2,
  }]);
  const safe = [...island.spawns.map(s => s.position), ...island.relics.map(r => r.position),
  ...island.pois.map(p => p.center)];
  const paving = downtownPublicSpaces(island), headwater = getDamHeadwater(island), outflow = getDamOutflow(island);
  const result: DistrictSet[] = [];
  for (const site of layouts) {
    const centre = island.pois.find(p => p.id === site.district)!.center;
    const ax = centre.x + site.x * scale, az = centre.z + site.z * scale;
    const localRoads = corridors.filter(r => segmentProjection({ x: ax, z: az }, r.start, r.end).distance < 52 * scale + r.buffer);
    const localBlocks = fixed.filter(b => clearance(b, ax, az) < 52 * scale);
    const angle = site.degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    function trySite(x: number, z: number): SetPiece[] | undefined {
      const pieces: SetPiece[] = [];
      for (const [model, dx, dz, span, yaw = 0] of site.items) {
        const px = x + (dx * c + dz * s) * scale, pz = z + (dz * c - dx * s) * scale;
        const y = gridSample(island, px, pz), bottom = { x: px, y, z: pz };
        const p = { model, bottom, length: span * scale, yaw: angle + yaw * Math.PI / 180 };
        const f = footprint(p), radius = Math.hypot(f.halfX, f.halfZ);
        if (y < island.seaLevel + .38 * scale ||
          localBlocks.some(b => y < b.top + .35 * scale && y + span * scale > b.bottom - .35 * scale && clearance(b, px, pz) < radius + .35 * scale) ||
          safe.some(q => Math.hypot(q.x - px, q.z - pz) < radius + 2.5 * scale) ||
          localRoads.some(r => segmentProjection(bottom, r.start, r.end).distance < r.buffer + radius)) return;
        const bank = riverAt(bottom, island.river);
        if ((bank.distance < bank.width * .52 + radius && y < bank.level + .7 * scale) ||
          (outflow.containsXZ(px, pz) && y < outflow.surfaceY(pz) + .6 * scale) ||
          (px > headwater.left - radius && px < headwater.right + radius && pz > headwater.rear - radius &&
            pz < headwater.front + radius && y < headwater.level + .6 * scale)) return;
        const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
        let min = y, max = y;
        for (const vx of [-f.halfX, f.halfX]) for (const vz of [-f.halfZ, f.halfZ]) {
          const cx = px + vx * cos + vz * sin, cz = pz + vz * cos - vx * sin;
          if (site.district === 'downtown-bleatsville' && (isInsideDowntownInfillFootprint(island, cx, cz) ||
            downtownPublicSpaceAt(paving, cx, cz, .35 * scale))) return;
          const h = gridSample(island, cx, cz);
          min = Math.min(min, h); max = Math.max(max, h);
        }
        if (max - min > Math.min(.46 * scale, .13 * radius + .12 * scale)) return;
        bottom.y = (min + max) / 2 - Math.min(.045 * scale, (max - min) / 3);
        pieces.push(p);
      }
      return pieces;
    }
    // Scan in half-aisle increments around the designed anchor. Only accept
    // a site that can accommodate the entire collection and its work aisle.
    const maxRing = site.district === 'mt-gigga' ? 19 : 13;
    for (let ring = 0; ring <= maxRing; ring++) {
      let placed = false;
      const count = Math.max(1, ring * 7);
      for (let j = 0; j < count; j++) {
        const a = (j / count) * Math.PI * 2 + ring * .63;
        const pieces = trySite(ax + Math.cos(a) * ring * 2.5 * scale, az + Math.sin(a) * ring * 2.5 * scale);
        if (!pieces) continue;
        result.push({ district: site.district, name: site.name, pieces });
        for (const piece of pieces) fixed.push({ ...footprint(piece), y: piece.bottom.y, bottom: piece.bottom.y, top: piece.bottom.y + piece.length });
        placed = true; break;
      }
      if (placed) break;
    }
  }
  return result;
}

export function districtSetColliders(sets: DistrictSet[]): PropColliderDescriptor[] {
  return sets.flatMap(set => set.pieces.map((p, i) => {
    const model = collision[p.model], length = p.length;
    return {
      id: 'kit-' + set.district + '-' + set.name + '-' + i, shape: 'trimesh' as const,
      transform: { position: p.bottom, rotationY: p.yaw }, body: { type: 'static' as const },
      size: { x: model.span[0]! * length, y: model.span[1]! * length, z: model.span[2]! * length },
      vertices: Float32Array.from(model.vertices, n => n * length / 4096), indices: Uint32Array.from(model.indices)
    };
  }));
}
