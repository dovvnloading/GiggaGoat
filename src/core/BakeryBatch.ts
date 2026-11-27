import type { Vec3 } from '../world/types';
import type { HappeningSite } from './IslandHappenings';

// The peel tips three honey rolls out of the service window in a staggered batch.
export const BATCH_SECONDS = 11;
// Fan over the pavement beyond the planter and to either side of the lamp.
const LANDINGS = [{ x: -3.1, z: 3.2 }, { x: -1.25, z: 4.15 }, { x: 2.6, z: 3.65 }] as const;

export class BakeryBatch {
  private since = -Infinity;
  private eaten = 0;
  private readonly landingHeights: number[];
  private collected = 0;

  constructor(readonly site: HappeningSite, ground?: (x: number, z: number) => number) {
    const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
    this.landingHeights = LANDINGS.map(p => ground?.(
      site.position.x + (c * p.x + s * p.z) * site.scale,
      site.position.z + (c * p.z - s * p.x) * site.scale) ?? site.position.y);
  }

  launch(time: number): void {
    this.since = time;
    this.eaten = 0;
    this.collected = 0;
  }

  roll(index: number, time: number, out: Vec3): boolean {
    const age = time - this.since - index * .29;
    if (age < 0 || time - this.since >= BATCH_SECONDS || (this.eaten & (1 << index))) return false;
    const progress = Math.min(1, age / 1.35);
    const x = (LANDINGS[index]!.x * progress - .65 * (1 - progress)) * this.site.scale;
    const z = (-.95 + (LANDINGS[index]!.z + .95) * progress) * this.site.scale;
    const c = Math.cos(this.site.yaw), s = Math.sin(this.site.yaw);
    const p = this.site.position;
    out.x = p.x + c * x + s * z;
    out.z = p.z - s * x + c * z;
    const landingY = this.landingHeights[index]! + .17 * this.site.scale;
    const startY = p.y + 1.28 * this.site.scale;
    const hop = age > 1.35 ? .14 * Math.sin(Math.PI * Math.min(1, (age - 1.35) / .34)) : 0;
    out.y = startY + (landingY - startY) * progress + this.site.scale *
      (1.45 * Math.sin(progress * Math.PI) + hop);
    return true;
  }

  private readonly point = { x: 0, y: 0, z: 0 };

  collect(feet: Vec3, time: number): number {
    if (time - this.since >= BATCH_SECONDS) return 0;
    let count = 0;
    for (let i = 0; i < LANDINGS.length; i++) {
      if (time - this.since < i * .29 + .6 || !this.roll(i, time, this.point)) continue;
      const reach = this.site.scale;
      if (Math.hypot(feet.x - this.point.x, feet.z - this.point.z) > .95 * reach ||
        Math.abs(feet.y + .55 * reach - this.point.y) > .95 * reach) continue;
      this.eaten |= 1 << i;
      count++;
      this.collected++;
    }
    return count;
  }

  get count(): number { return this.collected; }
  active(time: number): boolean { return time >= this.since && time - this.since < BATCH_SECONDS; }
}
