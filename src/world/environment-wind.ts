import { clamp, hashString, smoothstep } from './random';

/** A continuous, presentation-only field. Sampling never consumes island RNG. */
export interface EnvironmentWind {
  time: number;
  phase: number;
  directionX: number;
  directionZ: number;
  strength: number;
  gust: number;
  /** Local horizontal wind vector, in metres per second. */
  x: number;
  z: number;
}

/** Large gust fronts cross district boundaries; smaller eddies vary locally. */
export function windGust(time: number, phase: number, x = 0, z = 0): number {
  return .62 + .24 * Math.sin(time * .31 + phase + x * .012 + z * .009) +
    .14 * Math.sin(time * .73 + phase * 1.7 + x * .047 - z * .033);
}

/**
 * Absolute environment time makes rewind, pause/resume and different frame
 * rates agree. The existing rain front is already continuous; it strengthens
 * the same field instead of switching between unrelated weather animations.
 * Supply output in a hot loop to avoid allocating a new sample each frame.
 */
export function sampleEnvironmentWind(time: number, seed: string | number, rain = 0,
  x = 0, z = 0, output?: EnvironmentWind): EnvironmentWind {
  const t = Number.isFinite(time) ? Math.max(0, time) : 0;
  const phase = hashString(String(seed) + ':environment-wind') / 4294967296 * Math.PI * 2;
  const wet = Number.isFinite(rain) ? clamp(rain, 0, 1) : 0;
  const direction = -.42 + .24 * Math.sin(t * .013 + phase) +
    .12 * Math.sin(t * .0037 + phase * .61);
  const directionX = Math.cos(direction), directionZ = Math.sin(direction);
  const strength = .85 + .24 * Math.sin(t * .043 + phase * .7) + 1.1 * wet;
  const gust = windGust(t, phase, Number.isFinite(x) ? x : 0, Number.isFinite(z) ? z : 0);
  const result = output ?? {} as EnvironmentWind;
  result.time = t;
  result.phase = phase;
  result.directionX = directionX;
  result.directionZ = directionZ;
  result.strength = strength;
  result.gust = gust;
  result.x = directionX * strength * gust;
  result.z = directionZ * strength * gust;
  return result;
}

/** Broad activity envelopes remove threshold flicker at dawn and in rain. */
export function ambientFlightActivity(daylight: number, rain: number,
  species: 'pollinator' | 'gull'): number {
  return species === 'pollinator'
    ? smoothstep(.22, .56, daylight) * (1 - smoothstep(.28, .66, rain))
    : smoothstep(.08, .32, daylight) * (1 - smoothstep(.60, .95, rain));
}

/** Hysteresis only affects work culling; the fade reaches zero before exit. */
export function ambientInRange(distance: number, visible: boolean, range: number,
  hysteresis: number): boolean {
  return distance <= range + (visible ? hysteresis : 0);
}
