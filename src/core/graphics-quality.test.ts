import { describe, expect, it } from 'vitest';
import { GRAPHICS_PRESETS, qualityPixelRatio } from './GraphicsQuality';

describe('graphics presets', () => {
  it('orders resolution, shadow cost and draw distance by quality', () => {
    const { low, medium, high } = GRAPHICS_PRESETS;
    expect(low.maxPixelRatio).toBeLessThan(medium.maxPixelRatio);
    expect(medium.maxPixelRatio).toBeLessThan(high.maxPixelRatio);
    expect(low.shadowMapSize).toBe(0);
    expect(low.maxShadowCasters).toBe(0);
    expect(medium.shadowMapSize).toBeLessThan(high.shadowMapSize);
    expect(medium.maxShadowCasters).toBeLessThan(high.maxShadowCasters);
    expect(low.drawDistance).toBeLessThan(medium.drawDistance);
    expect(medium.drawDistance).toBeLessThan(high.drawDistance);
    for (const preset of Object.values(GRAPHICS_PRESETS)) {
      expect(preset.minPixelRatio).toBeGreaterThan(0);
      expect(preset.minPixelRatio).toBeLessThanOrEqual(preset.maxPixelRatio);
    }
  });
  it('caps HiDPI but keeps full resolution at DPR 1 on high', () => {
    expect(qualityPixelRatio('high', 1)).toBe(1);
    expect(qualityPixelRatio('high', 2)).toBe(1.25);
    expect(qualityPixelRatio('medium', 2)).toBe(1);
    expect(qualityPixelRatio('low', 2)).toBe(0.8);
    expect(qualityPixelRatio('high', Number.NaN)).toBe(1);
  });
});
