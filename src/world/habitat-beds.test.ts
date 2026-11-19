import { describe, expect, it } from 'vitest';
import { generateIsland } from './island';
import { planHabitatBeds } from './habitat-beds';
import { plantKitBatches } from './plant-palette';
import { gridSample } from './terrain';

describe('planted island habitats', () => {
  it('plants continuous rows with grounded roots, and leaves ensemble footprints clear', () => {
    const island = generateIsland({ seed: 'billy-isle' });
    const beds = planHabitatBeds(island);
    const crops = ['crop_turnip', 'crops_wheatStageB', 'crops_cornStageD'] as const;
    const dirt = beds.get('crops_dirtSingle')!;
    expect(dirt.length).toBeGreaterThanOrEqual(60);
    expect(dirt.length % 15).toBe(0);
    expect(crops.reduce((n, crop) => n + beds.get(crop)!.length, 0)).toBe(dirt.length);
    expect(beds.get('mushroom_tanGroup')!.length).toBeGreaterThan(0);
    expect(beds.get('grass_leafsLarge')!.length).toBeGreaterThan(0);
    for (const batch of beds.values()) for (const p of batch) {
      expect(Math.abs(p.y - gridSample(island, p.x, p.z))).toBeLessThan(.06);
      for (const set of island.districtSets ?? []) for (const m of set.pieces) {
        expect(Math.hypot(p.x - m.bottom.x, p.z - m.bottom.z)).toBeGreaterThan(.5 * m.length);
      }
    }
    for (const kind of ['tree-pine', 'tree-oak'] as const) {
      const trees = island.props.filter(p => p.kind === kind);
      const variants = plantKitBatches(trees);
      const slots = [...variants.values()].flat();
      expect(variants.size).toBeGreaterThanOrEqual(3);
      expect(new Set(slots).size).toBe(slots.length);
      expect(slots.length).toBeGreaterThan(trees.length / 2);
      expect(slots.length).toBeLessThan(trees.length);
    }
  });
});
