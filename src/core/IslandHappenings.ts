import { biomeAt, gridSample, segmentProjection } from '../world/terrain';
import type { IslandData, PoiId, Transform, Vec2, Vec3 } from '../world/types';

import { BAKERY_NAME } from '../world/bakery-sign';
import { downtownShopFront } from '../world/visual-downtown';
import { BakeryBatch } from './BakeryBatch';

export const HAPPENING_DEFINITIONS = [
  { id: 'breakfast-bell', district: 'hoofington', title: 'Breakfast bell',
    hint: 'Someone left the farm bell out. Give it a baa!', response: 'Breakfast call! The whole farm heard that.', color: 0xeaa84b, reward: 15 },
  { id: 'wind-up-parade', district: 'baa-ardwalk', title: 'Wind-up parade',
    hint: 'The souvenir pinwheels are waiting for a gust.', response: 'The pinwheel parade is back in business!', color: 0xf46c97, reward: 15 },
  { id: 'shift-whistle', district: 'crane-yard', title: 'Shift whistle',
    hint: 'An unattended warning siren. Surely nobody minds.', response: 'Break time! The yard is off the clock.', color: 0xf4b84b, reward: 20 },
  { id: 'busker-break', district: 'downtown-bleatsville', title: 'Busker on break',
    hint: 'An empty busking spot needs a guest vocalist.', response: 'Goat solo! An encore for Bleatsville.', color: 0x4bb9dc, reward: 15 },
  { id: 'summit-mail', district: 'mt-gigga', title: 'Summit weather post',
    hint: 'Give the lonely weather vane a mountain baa.', response: 'Forecast: a strong chance of goat.', color: 0x67c9de, reward: 25 },
  { id: 'lantern-circle', district: 'whispering-pines', title: 'Lantern circle',
    hint: 'A forgotten campsite. See what answers your call.', response: 'The little lights have woken up.', color: 0xb8e36a, reward: 20 },
  { id: 'pressure-check', district: 'the-dam', title: 'Pressure check',
    hint: 'The old inspection gauge is suspiciously quiet.', response: 'Inspection complete: approximately baa-rilliant.', color: 0x60cbd0, reward: 20 },
  { id: 'signal-home', district: 'old-lighthouse', title: 'Signal home',
    hint: 'A keeper left a signal lantern on the headland.', response: 'All clear! A light for the boats coming home.', color: 0xffca70, reward: 20 },
  { id: 'honey-rolls', district: 'downtown-bleatsville', title: BAKERY_NAME,
    hint: 'Bleat at the window for a batch of hot honey rolls.', response: 'Fresh from the oven!', color: 0xffb35d, reward: 20 },
] as const satisfies readonly { id: string; district: PoiId; title: string; hint: string; response: string; color: number; reward: number }[];

export type HappeningDefinition = typeof HAPPENING_DEFINITIONS[number];
export type HappeningId = HappeningDefinition['id'];
export interface HappeningSite {
  definition: HappeningDefinition;
  position: Vec3;
  yaw: number;
  scale: number;
}
export interface HappeningMessage { title: string; task: string; detail: string }
export const HAPPENING_REACH = 5;
const RESPONSE_SECONDS = 5;
const REPLAY_SECONDS = 12;

function clearance(point: Vec2, transform: Transform, size: Vec3): number {
  const dx = point.x - transform.position.x, dz = point.z - transform.position.z;
  const c = Math.cos(transform.rotationY), s = Math.sin(transform.rotationY);
  return Math.hypot(Math.max(0, Math.abs(c * dx - s * dz) - size.x / 2),
    Math.max(0, Math.abs(s * dx + c * dz) - size.z / 2));
}

/** All scenes occupy a small off-road patch, never modify terrain or physics. */
export function happeningGround(island: IslandData, point: Vec2, excluded: readonly Vec2[] = []): number | undefined {
  const scale = island.size / 600;
  const { x, z } = point;
  if (Math.max(Math.abs(x), Math.abs(z)) > island.size / 2 - 3 * scale ||
    excluded.some(p => Math.hypot(p.x - x, p.z - z) < 16 * scale)) return;
  const y = gridSample(island, x, z);
  for (const [u, v] of [[0, 0], [1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8],
    [1.3, 1.3], [-1.3, 1.3], [1.3, -1.3], [-1.3, -1.3]] as const) {
    const px = x + u * scale, pz = z + v * scale;
    const h = gridSample(island, px, pz);
    if (h < island.seaLevel + 1.25 * scale || Math.abs(h - y) > .45 * scale ||
      ['ocean', 'freshwater', 'cliff'].includes(biomeAt(island, px, pz))) return;
  }
  if (island.roads.some(road => road.points.slice(1).some((b, i) =>
    segmentProjection(point, road.points[i]!, b).distance < road.width / 2 + 2.25 * scale))) return;
  const blocked = (transform: Transform, size: Vec3): boolean => {
    const p = transform.position;
    return Math.abs(p.x - x) < Math.hypot(size.x, size.z) / 2 + 2.3 * scale &&
      Math.abs(p.z - z) < Math.hypot(size.x, size.z) / 2 + 2.3 * scale &&
      clearance(point, transform, size) < 2.3 * scale;
  };
  if (island.props.some(p => !['grass-tuft', 'flower', 'mushroom'].includes(p.kind) &&
    blocked(p.transform, p.size))) return;
  if (island.colliders.some(p => p.shape !== 'heightfield' && blocked(p.transform, p.size))) return;
  if (island.relics.some(p => Math.hypot(p.position.x - x, p.position.z - z) < 3 * scale)) return;
  return y;
}

/** Prefer road shoulders visible on arrival, then a small search around each district.
 * A seed with no clear patch simply omits that scene. Stable IDs do not depend on placement. */
export function placeIslandHappenings(island: IslandData, boards: readonly Vec2[] = []): HappeningSite[] {
  const scale = island.size / 600, result: HappeningSite[] = [];
  const excluded = [...boards, ...island.spawns.map(p => p.position)];
  for (const definition of HAPPENING_DEFINITIONS) {
    const poi = island.pois.find(p => p.id === definition.district);
    if (!poi) continue;
    if (definition.id === 'honey-rolls') {
      const shop = island.props.find(p => p.kind === 'shop' && p.poiId === poi.id &&
        downtownShopFront(p, poi.center, scale).title === BAKERY_NAME);
      if (shop) {
        const { position, rotationY: yaw } = shop.transform;
        const offset = shop.size.z / 2 + 1.05 * scale;
        const x = position.x + Math.sin(yaw) * offset, z = position.z + Math.cos(yaw) * offset;
        result.push({ definition, yaw, scale, position: { x, y: gridSample(island, x, z), z } });
      }
      continue;
    }
    const candidates: Array<Vec2 & { yaw: number; score: number }> = [];
    for (const road of island.roads) {
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1]!, b = road.points[i]!;
        if (a.bridge || b.bridge) continue;
        const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
        if (length < .1 * scale) continue;
        const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
        if (Math.hypot(cx - poi.center.x, cz - poi.center.z) > poi.radius + 25 * scale) continue;
        for (const side of [-1, 1]) for (const verge of [4.5, 7, 10]) {
          const nx = -dz / length * side, nz = dx / length * side;
          const offset = road.width / 2 + verge * scale;
          const x = cx + nx * offset, z = cz + nz * offset;
          const d = Math.hypot(x - poi.center.x, z - poi.center.z) / scale;
          if (d < 13 || d > poi.radius / scale + 25) continue;
          candidates.push({ x, z, yaw: Math.atan2(-nx, -nz), score: Math.abs(d - 25) + verge * .8 });
        }
      }
    }
    for (let r = 14; r <= poi.radius / scale + 18; r += 3) {
      for (let i = 0; i < 32; i++) {
        const angle = i * Math.PI / 16 + r * .17;
        candidates.push({ x: poi.center.x + Math.cos(angle) * r * scale,
          z: poi.center.z + Math.sin(angle) * r * scale, yaw: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
          score: 80 + Math.abs(r - 24) });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const point of candidates) {
      const y = happeningGround(island, point, [...excluded, ...result.map(p => p.position)]);
      if (y === undefined) continue;
      result.push({ definition, position: { x: point.x, y, z: point.z }, yaw: point.yaw, scale });
      break;
    }
  }
  return result;
}

export class IslandHappenings {
  private readonly completed = new Set<HappeningId>();
  private readonly activated = new Map<HappeningId, number>();
  private last: { site: HappeningSite; time: number; reward: number } | undefined;

  readonly bakery?: BakeryBatch;

  constructor(readonly sites: readonly HappeningSite[], saved?: unknown, ground?: (x: number, z: number) => number) {
    const bakery = sites.find(site => site.definition.id === 'honey-rolls');
    if (bakery) this.bakery = new BakeryBatch(bakery, ground);
    if (Array.isArray(saved)) for (const definition of HAPPENING_DEFINITIONS) {
      if (saved.includes(definition.id)) this.completed.add(definition.id);
    }
  }

  snapshot(): HappeningId[] {
    return HAPPENING_DEFINITIONS.filter(d => this.completed.has(d.id)).map(d => d.id);
  }

  discovered(site: HappeningSite): boolean { return this.completed.has(site.definition.id); }

  private nearest(position: Vec3, radius: number): HappeningSite | undefined {
    let nearest: HappeningSite | undefined, best = Infinity;
    for (const site of this.sites) {
      const distance = Math.hypot(site.position.x - position.x, site.position.z - position.z);
      if (distance <= radius * site.scale && Math.abs(site.position.y - position.y) <= 2.5 * site.scale &&
        distance < best) { best = distance; nearest = site; }
    }
    return nearest;
  }

  /** A valid, accepted bleat calls this once, not once per render frame. */
  bleat(position: Vec3, time: number): number {
    const site = this.nearest(position, HAPPENING_REACH);
    if (!site || time - (this.activated.get(site.definition.id) ?? -Infinity) < REPLAY_SECONDS) return 0;
    const reward = this.discovered(site) ? 0 : site.definition.reward;
    if (site.definition.id === 'honey-rolls') this.bakery?.launch(time);
    this.completed.add(site.definition.id);
    this.activated.set(site.definition.id, time);
    this.last = { site, time, reward };
    return reward;
  }

  /** Seconds since activation, or undefined when the brief response has finished. */
  reaction(site: HappeningSite, time: number): number | undefined {
    const start = this.activated.get(site.definition.id);
    if (start === undefined || time < start || time - start >= RESPONSE_SECONDS) return;
    return time - start;
  }

  message(position: Vec3, time: number): HappeningMessage | undefined {
    const batch = this.bakery;
    if (batch?.active(time) && this.nearest(position, 14) === batch.site) {
      return { title: BAKERY_NAME, task: batch.count === 3 ? 'Every bun accounted for!' : 'Catch the honey rolls!',
        detail: batch.count + '/3 ROLLS · +25 STAMINA EACH' +
          (this.last?.site === batch.site && this.last.reward ? ' · +20 CUD COINS' : '') };
    }
    if (this.last && time - this.last.time < RESPONSE_SECONDS && time >= this.last.time) {
      const { site, reward } = this.last;
      return { title: site.definition.title, task: site.definition.response,
        detail: reward ? '+' + reward + ' CUD COINS · DISCOVERED' : 'A LITTLE ISLAND ENCORE' };
    }
    const site = this.nearest(position, 11);
    if (!site) return;
    const close = this.nearest(position, HAPPENING_REACH) === site;
    const cooling = time - (this.activated.get(site.definition.id) ?? -Infinity) < REPLAY_SECONDS;
    return { title: site.definition.title, task: site.definition.hint,
      detail: cooling ? 'LET IT SETTLE A MOMENT' : !close ? 'WANDER A LITTLE CLOSER' :
        this.discovered(site) ? 'E / X · BLEAT FOR AN ENCORE' : 'E / X · BLEAT TO DISCOVER' };
  }
}
