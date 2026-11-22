import { describe, expect, it } from 'vitest';
import { generateIsland } from './island';
import { makeDowntownPlacements, type DowntownPlacement } from './visual-downtown';
import type { PropDescriptor, Vec3 } from './types';

type Footprint = { position: Vec3; size: Vec3; yaw: number };

function corners(item: Footprint): Array<{ x: number; z: number }> {
  const c = Math.cos(item.yaw), s = Math.sin(item.yaw);
  return [-1, 1].flatMap(x => [-1, 1].map(z => ({
    x: item.position.x + c * x * item.size.x / 2 + s * z * item.size.z / 2,
    z: item.position.z - s * x * item.size.x / 2 + c * z * item.size.z / 2,
  })));
}

function overlapsWithClearance(a: Footprint, b: Footprint, gap: number): boolean {
  const aa = corners(a), bb = corners(b);
  for (const angle of [a.yaw, b.yaw]) {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const axis of [{ x: c, z: -s }, { x: s, z: c }]) {
      const project = (p: { x: number; z: number }) => p.x * axis.x + p.z * axis.z;
      const ap = aa.map(project), bp = bb.map(project);
      if (Math.max(...ap) + gap <= Math.min(...bp) + 1e-6 ||
          Math.max(...bp) + gap <= Math.min(...ap) + 1e-6) return false;
    }
  }
  return true;
}

function footprint(p: PropDescriptor): Footprint {
  return { position: p.transform.position, yaw: p.transform.rotationY, size: p.size };
}

describe('Downtown sidewalk art', () => {
  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'sidewalk-small', size: 400, resolution: 97 },
    { seed: 'sidewalk-large', size: 900, resolution: 97 },
  ])('keeps bushes and bins clear of furniture at size $size', options => {
    const island = generateIsland(options);
    const plan = makeDowntownPlacements(island);
    const decor: DowntownPlacement[] = plan.filter(p => !p.source &&
      (p.model === 'bushA' || p.model === 'bushB' || p.model === 'trash'));
    const furniture = island.props.filter(p => p.poiId === 'downtown-bleatsville' &&
      ['bench', 'planter', 'lamp'].includes(p.kind));
    expect(decor.length).toBeGreaterThanOrEqual(10);
    const collisions: string[] = [];
    for (const art of decor) for (const item of furniture) {
      if (overlapsWithClearance(art, footprint(item), .2 * options.size / 600)) {
        collisions.push(`${art.model} (${art.position.x.toFixed(1)}, ${art.position.z.toFixed(1)}) / ${item.id}`);
      }
    }
    const extraFurniture = plan.filter(p => !p.source && (p.model === 'table' || p.model === 'chair'));
    const storefronts = plan.filter(p => p.source?.kind === 'shop' || p.source?.kind === 'house');
    for (const [index, art] of decor.entries()) {
      for (const other of [...decor.slice(index + 1), ...extraFurniture, ...storefronts]) {
        if (overlapsWithClearance(art, other, .2 * options.size / 600)) {
          collisions.push(`${art.model} (${art.position.x.toFixed(1)}, ${art.position.z.toFixed(1)}) / ${other.model}`);
        }
      }
    }
    expect(collisions).toEqual([]);
    expect(makeDowntownPlacements(island)).toEqual(plan);
  });
});
