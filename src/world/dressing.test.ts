import { describe, expect, it } from 'vitest';
import { generateIsland } from './index';

describe('Crane Yard scenery exclusion (IS-5)', () => {
  it.each([
    { seed: 'billy-isle', size: 600 },
    { seed: 'scenery-yard-alt', size: 900 },
  ])('keeps scattered vegetation outside the fenced yard for $seed at $size m', ({ seed, size }) => {
    const island = generateIsland({ seed, size, resolution: 97 });
    const centre = island.pois.find(p => p.id === 'crane-yard')!.center;
    const scale = island.size / 600;
    const kinds = new Set(['tree-pine', 'tree-oak', 'bush', 'flower', 'grass-tuft']);
    // The dressing scatter owns detail-* descriptors. Do not reject authored
    // vegetation elsewhere on the island or change the Crane Yard plan.
    const scenery = island.props.filter(prop =>
      prop.id.startsWith('detail-') && kinds.has(prop.kind));
    expect(scenery.length).toBeGreaterThan(100);
    for (const prop of scenery) {
      const { x, z } = prop.transform.position;
      const inside = Math.abs(x - centre.x) <= 41 * scale &&
        Math.abs(z - centre.z) <= 37 * scale;
      expect(inside, seed + ': ' + prop.id + ' inside Crane Yard fence').toBe(false);
    }
  });
});
