import { describe, expect, it } from 'vitest';
import { getViewportSize } from './viewport';

describe('VFX lab fixed-aspect viewport (no DOM or WebGL)', () => {
  it('derives a bounded 16:9 height from the container width, not the canvas height', () => {
    expect(getViewportSize(960, 1)).toEqual({ width: 960, height: 540, pixelRatio: 1 });
    expect(getViewportSize(320, 1)).toEqual({ width: 320, height: 180, pixelRatio: 1 });
    // A formerly 2700px-tall drawing buffer cannot influence the next measurement.
    expect(getViewportSize(960, 1)?.height).toBe(540);
  });

  it('reacts to layout width changes without introducing fractional-pixel jitter', () => {
    expect(getViewportSize(800.4, 1)).toEqual({ width: 800, height: 450, pixelRatio: 1 });
    expect(getViewportSize(1280, 1)).toEqual({ width: 1280, height: 720, pixelRatio: 1 });
    expect(getViewportSize(1, 1)).toEqual({ width: 1, height: 1, pixelRatio: 1 });
  });

  it('uses the current devicePixelRatio (capped at 2) independently of CSS size', () => {
    expect(getViewportSize(960, 1.25)).toEqual({ width: 960, height: 540, pixelRatio: 1.25 });
    expect(getViewportSize(960, 2)).toEqual({ width: 960, height: 540, pixelRatio: 2 });
    expect(getViewportSize(960, 3)).toEqual({ width: 960, height: 540, pixelRatio: 2 });
    expect(getViewportSize(960, 0)).toEqual({ width: 960, height: 540, pixelRatio: 1 });
    expect(getViewportSize(960, NaN)).toEqual({ width: 960, height: 540, pixelRatio: 1 });
  });

  it('skips hidden and invalid wrapper dimensions', () => {
    for (const width of [0, -1, NaN, Infinity, -Infinity]) {
      expect(getViewportSize(width, 1)).toBeNull();
    }
  });
});
