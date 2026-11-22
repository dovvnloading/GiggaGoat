import { describe, expect, it } from 'vitest';
import { boardwalkPierDecks, SPLASH_DIVE_BOARD_ID } from './boardwalk';
import { generateIsland } from './island';
import { gridSample } from './terrain';
import type { PropDescriptor } from './types';

function distanceToFootprint(x: number, z: number, prop: PropDescriptor): number {
  const dx = x - prop.transform.position.x, dz = z - prop.transform.position.z;
  const c = Math.cos(prop.transform.rotationY), s = Math.sin(prop.transform.rotationY);
  return Math.hypot(Math.max(0, Math.abs(c * dx - s * dz) - prop.size.x / 2),
    Math.max(0, Math.abs(s * dx + c * dz) - prop.size.z / 2));
}

describe('Baa-ardwalk surf markers', () => {
  it.each([
    { seed: 'billy-isle', size: 600, resolution: 193 },
    { seed: 'shore-check', size: 400, resolution: 97 },
    { seed: 'buoy-shore-alt', size: 900, resolution: 97 },
  ])('keeps buoys in clear water around the placed pier at size $size', options => {
    const island = generateIsland(options);
    const scale = island.size / 600;
    const buoys = island.props.filter(p => p.poiId === 'baa-ardwalk' && p.kind === 'buoy');
    const pier = boardwalkPierDecks(island);
    const piles = island.props.filter(p => p.poiId === 'baa-ardwalk' && p.kind === 'scaffold');
    expect(buoys).toHaveLength(16);
    expect(pier.length).toBeGreaterThanOrEqual(3);
    const centre = island.pois.find(p => p.id === 'baa-ardwalk')!.center;
    const main = pier.find(p => p.kind === 'pier')!;
    const shift = main.transform.position.z - main.size.z / 2 - (centre.z - 38 * scale);
    expect(buoys[0]!.transform.position.z).toBeCloseTo(centre.z + shift + 88 * scale, 4);
    const board = pier.find(p => p.id === SPLASH_DIVE_BOARD_ID)!;
    const landingX = board.transform.position.x + board.size.x / 2 + 4;
    const problems: string[] = [];
    for (const [i, buoy] of buoys.entries()) {
      const { x, y, z } = buoy.transform.position;
      const radius = Math.max(buoy.size.x, buoy.size.z) / 2;
      const landingZ = Math.max(0, Math.abs(z - board.transform.position.z) - .72 * scale);
      if (Math.hypot(x - landingX, landingZ) < 3.6 + radius) problems.push(`${i} in dive landing`);
      for (const surface of [...pier, ...piles]) {
        if (distanceToFootprint(x, z, surface) < radius + .5 * scale - 1e-5) {
          problems.push(`${i} overlaps ${surface.id}`);
        }
      }
      const ground = gridSample(island, x, z);
      if (ground > island.seaLevel - .4 * scale) problems.push(`${i} on land: ${ground.toFixed(2)}`);
      if (Math.abs(y - (.55 * scale + island.seaLevel)) > 1e-5) problems.push(`${i} wrong water height`);
      for (const other of buoys.slice(i + 1)) {
        const p = other.transform.position;
        if (Math.hypot(x - p.x, z - p.z) < 5 * scale - 1e-5) problems.push(`${i} too close to ${other.id}`);
      }
    }
    expect(problems).toEqual([]);
    const again = generateIsland(options).props.filter(p => p.poiId === 'baa-ardwalk' && p.kind === 'buoy');
    expect(buoys.map(p => p.transform)).toEqual(again.map(p => p.transform));
  });
});
