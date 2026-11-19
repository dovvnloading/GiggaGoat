import { describe, expect, it } from 'vitest';
import { environmentLayers, type EnvironmentMix } from './zone-ambience';

const clear: EnvironmentMix = { rain: 0, wet: 0, sheltered: false, atPier: false, mill: 0, turbine: 0 };

describe('island environmental recordings', () => {
  it('follows the rain, the roof overhead and the remaining wet ground', () => {
    const wet = { ...clear, rain: .75, wet: .8 };
    const weather = (env: EnvironmentMix) => environmentLayers('hoofington', false, env).weather;
    expect(weather(clear)).toBeUndefined();
    expect(weather(wet)?.key).toBe('rain-lane');
    expect(weather({ ...wet, sheltered: true })?.key).toBe('rain-shelter');
    expect(weather({ ...wet, rain: .3 })!.level).toBeLessThan(weather(wet)!.level);
    expect(weather({ ...wet, rain: 0 })?.key).toBe('after-rain');
    expect(environmentLayers('mt-gigga', false, { ...wet, rain: 0 }).weather).toBeUndefined();
  });

  it('brings out the forest insects after sunset and quiets them in heavy rain', () => {
    expect(environmentLayers('whispering-pines', false, clear).detail).toBeUndefined();
    expect(environmentLayers('whispering-pines', true, clear).detail?.key).toBe('pine-crickets');
    expect(environmentLayers('whispering-pines', true, { ...clear, rain: 1 }).detail).toBeUndefined();
    expect(environmentLayers('hoofington', true, clear).detail).toBeUndefined();
  });

  it('plays mechanical detail close to the landmark and rigging on the pier deck', () => {
    expect(environmentLayers('hoofington', false, { ...clear, mill: .5 }).detail?.key).toBe('mill-axle');
    expect(environmentLayers('the-dam', false, { ...clear, turbine: .5 }).detail?.level).toBeCloseTo(.3);
    expect(environmentLayers('the-dam', false, clear).detail).toBeUndefined();
    expect(environmentLayers('baa-ardwalk', false, clear).detail).toBeUndefined();
    expect(environmentLayers('baa-ardwalk', false, { ...clear, atPier: true }).detail?.key).toBe('pier-rigging');
  });
});
