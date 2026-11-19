import { describe, expect, it } from 'vitest';
import { islandWeather, weatherCaption } from './island-weather';

describe('Billy Isle environment clock', () => {
  it('visits morning, noon, dusk and midnight within a play session', () => {
    const hours = new Set(Array.from({length:480}, (_,s) => Math.floor(islandWeather(s).phase * 24)));
    expect(hours.size).toBe(24);
    expect(islandWeather(480).phase).toBeCloseTo(islandWeather(0).phase);
    expect(weatherCaption(islandWeather(0))).toContain('7:30 AM');
  });
  it('builds cloud ahead of rain, leaves wet roads after rain and clears smoothly', () => {
    expect(islandWeather(36).cloud).toBeGreaterThan(.7);
    expect(islandWeather(36).rain).toBe(0);
    expect(islandWeather(72).rain).toBe(1);
    expect(islandWeather(107).rain).toBe(0);
    expect(islandWeather(107).wet).toBeGreaterThan(.8);
    expect(islandWeather(179).wet).toBe(0);
    for (let s=1;s<=500;s++) {
      expect(Math.abs(islandWeather(s).rain-islandWeather(s-1).rain)).toBeLessThan(.08);
    }
  });
});
