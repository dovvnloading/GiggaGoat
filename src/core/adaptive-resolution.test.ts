import { describe, expect, it } from 'vitest';
import { AdaptiveResolution } from './AdaptiveResolution';

describe('adaptive resolution', () => {
  it('drops gradually during sustained slow frames and respects the lower bound', () => {
    const controller = new AdaptiveResolution('high', 1);
    const changes: number[] = [];
    for (let i = 0; i < 450; i++) {
      const next = controller.sample(31, 19, 1 / 30);
      if (next !== null) changes.push(next);
    }
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]).toBeLessThan(1);
    expect(controller.ratio).toBe(controller.minimum);
    expect(controller.ratio).toBeGreaterThan(0);
  });

  it('recovers slowly with headroom but never exceeds the configured cap', () => {
    const controller = new AdaptiveResolution('medium', 2);
    for (let i = 0; i < 300; i++) controller.sample(30, 16, 1 / 30);
    const reduced = controller.ratio;
    expect(reduced).toBeLessThan(1);
    for (let i = 0; i < 1500; i++) controller.sample(12, 7, 1 / 60);
    expect(controller.ratio).toBeGreaterThan(reduced);
    expect(controller.ratio).toBe(1);
  });

  it('ignores pauses, resume spikes and alternating noisy frames', () => {
    const controller = new AdaptiveResolution('high', 1);
    for (let i = 0; i < 180; i++) {
      controller.sample(i % 2 ? 13 : 20, 9, 1 / 60);
    }
    expect(controller.ratio).toBe(1);
    controller.sample(80, 60, 2);
    for (let i = 0; i < 200; i++) controller.sample(33, 21, 1 / 30, false);
    expect(controller.ratio).toBe(1);
  });

  it('resets budgets when the preset changes', () => {
    const controller = new AdaptiveResolution('high', 2);
    for (let i = 0; i < 200; i++) controller.sample(32, 20, 1 / 30);
    expect(controller.configure('low', 2)).toBe(0.8);
    expect(controller.maximum).toBe(0.8);
    expect(controller.minimum).toBe(0.6);
    expect(controller.sample(10, 5, 1 / 60)).toBeNull();
    expect(controller.configure('high', 1)).toBe(1);
  });
});
