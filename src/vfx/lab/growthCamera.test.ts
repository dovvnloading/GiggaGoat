import { describe, expect, it } from 'vitest';
import { GROWTH_TIER_SCALES } from '../growthAuraMath';
import { frameGrowthCamera } from './growthCamera';

describe('09 growth preview framing (headless)', () => {
  it('fits the full goat, ground ring, tall pillars and GIGGA flare from Kid to GIGGA', () => {
    const halfFov = 40 * Math.PI / 360;
    for (const elevation of [-0.05, 0.19, 0.85]) {
      let previousDistance = 0;
      for (const tier of [0, 1, 2, 3] as const) {
        const scale = GROWTH_TIER_SCALES[tier];
        const frame = frameGrowthCamera(tier, 16 / 9, 40, elevation);
        const halfHeight = (2.35 + 0.23) * scale * 0.5;
        const radius = 1.55 * scale + 0.17;
        const projectedHalfHeight = halfHeight * Math.cos(Math.abs(elevation)) +
          radius * Math.sin(Math.abs(elevation));
        // Reserve near-side depth and verify a margin inside the 40° frustum.
        const nearDistance = frame.distance - radius * 0.36;
        const projectedVertical = Math.atan(projectedHalfHeight / nearDistance);
        const projectedHorizontal = Math.atan(radius / nearDistance);
        expect(projectedVertical).toBeLessThan(halfFov * 0.96);
        expect(projectedHorizontal).toBeLessThan(
          Math.atan(Math.tan(halfFov) * 16 / 9) * 0.96);
        expect(frame.targetY).toBeCloseTo(1.06 * scale);
        expect(frame.distance).toBeGreaterThan(previousDistance);
        previousDistance = frame.distance;
      }
    }
  });

  it('handles narrow screens and rejects invalid projection settings', () => {
    expect(frameGrowthCamera(3, 1).distance)
      .toBeGreaterThan(frameGrowthCamera(3, 16 / 9).distance);
    for (const aspect of [0, -1, NaN, Infinity]) {
      expect(() => frameGrowthCamera(3, aspect)).toThrow(RangeError);
    }
    expect(() => frameGrowthCamera(3, 16 / 9, 180)).toThrow(RangeError);
    expect(() => frameGrowthCamera(3, 16 / 9, 0)).toThrow(RangeError);
    expect(() => frameGrowthCamera(3, 16 / 9, 40, NaN)).toThrow(RangeError);
  });
});
