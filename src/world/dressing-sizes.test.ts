import { describe, expect, it } from 'vitest';
import { generateIsland } from './island';

describe('island scenery size descriptors', () => {
  it('fits round oaks, slim pines and wide daisies to their height', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const scale = island.size / 600;
    // The seeded scenery is appended after the authored district detail props.
    const details = island.props.filter(p => p.id.startsWith('detail-'));
    const vegetationCount = Math.max(160, Math.round(440 * scale));
    const scenery = details.slice(-vegetationCount);
    expect(scenery).toHaveLength(vegetationCount);
    for (const [kind, ratio] of [
      ['tree-oak', 0.72],
      ['tree-pine', 0.35],
      ['flower', 0.9],
      ['bush', 1.25],
      ['grass-tuft', 0.55],
    ] as const) {
      const matching = scenery.filter(p => p.kind === kind);
      expect(matching.length, kind).toBeGreaterThan(0);
      for (const prop of matching) {
        expect(prop.size.x, prop.id).toBeCloseTo(prop.size.y * ratio, 6);
        expect(prop.size.z, prop.id).toBeCloseTo(prop.size.x, 6);
      }
    }
  });
});
