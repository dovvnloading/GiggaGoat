import type * as THREE from 'three';
import { clamp, GradientNoise, hashString, lerp, smoothstep } from './random';
import { gridCoordinate, gridIndex } from './terrain';
import type { IslandData } from './types';

interface CliffPalette {
  data: Uint8Array; size: number; samples: number; stone: THREE.Color; mountainStone: THREE.Color;
}
export const terrainCliffMaps = new WeakMap<THREE.Material, CliffPalette>();

/** The terrain vertices lie on atlas texel centres in both mesh detail levels. */
export function paintCliffVertex(color: THREE.Color, cliffs: CliffPalette, x: number, y: number, z: number): void {
  const { size, samples, data, stone, mountainStone } = cliffs;
  const ix = clamp(Math.round((x / size + .5) * (samples - 1)), 0, samples - 1);
  const iz = clamp(Math.round((z / size + .5) * (samples - 1)), 0, samples - 1);
  const at = 2 * (iz * samples + ix);
  const scale = 600 / size, altitude = y * scale;
  const rock = smoothstep(.14, .51, data[at]! / 255 + .04 * smoothstep(16, 85, altitude));
  const foot = data[at + 1]! / 255;
  color.r *= 1 - .30 * foot * .24;
  color.g *= 1 - .33 * foot * .24;
  color.b *= 1 - .39 * foot * .24;
  if (!rock) return;
  const u = x * scale, v = z * scale;
  const mountain = 1 - smoothstep(99, 113, Math.hypot(u, v));
  const bedding = altitude + 2.8 * Math.sin(.05 * u + .026 * v) + 1.5 * Math.sin(-.033 * u + .105 * v);
  const bands = .74 * Math.sin(.49 * bedding) + .26 * Math.sin(.23 * bedding + .62);
  const layer = smoothstep(-.56, .52, bands), contrast = .6 + .4 * mountain;
  color.r = lerp(color.r, lerp(stone.r, mountainStone.r, mountain) *
    (1 + contrast * (-.34 + .53 * layer)) * (1 - .30 * foot), rock);
  color.g = lerp(color.g, lerp(stone.g, mountainStone.g, mountain) *
    (1 + contrast * (-.30 + .45 * layer)) * (1 - .33 * foot), rock);
  color.b = lerp(color.b, lerp(stone.b, mountainStone.b, mountain) *
    (1 + contrast * (-.27 + .36 * layer)) * (1 - .39 * foot), rock);
}

/** Red is exposed rock and green is soil accumulation at a concave cliff foot. */
export function terrainRockAtlas(island: IslandData): Uint8Array {
  const { heights, resolution, size } = island;
  const cell = size / (resolution - 1);
  const scale = size / 600;
  const radius = Math.max(1, Math.round(5 * scale / cell));
  const index = (x: number, z: number): number => gridIndex(resolution,
    clamp(x, 0, resolution - 1), clamp(z, 0, resolution - 1));
  const heightAt = (x: number, z: number): number => heights[index(x, z)]!;
  const exposure = new Float32Array(heights.length);
  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const dx = (heightAt(x + 1, z) - heightAt(x - 1, z)) /
        ((x === 0 || x === resolution - 1) ? cell : 2 * cell);
      const dz = (heightAt(x, z + 1) - heightAt(x, z - 1)) /
        ((z === 0 || z === resolution - 1) ? cell : 2 * cell);
      exposure[index(x, z)] = 1 - 1 / Math.hypot(dx, 1, dz);
    }
  }
  const noise = new GradientNoise(hashString(String(island.seed) + ':rock-weathering'));
  const atlas = new Uint8Array(heights.length * 2);
  for (let z = 0; z < resolution; z++) {
    const worldZ = gridCoordinate(size, resolution, z);
    for (let x = 0; x < resolution; x++) {
      const at = index(x, z);
      const west = index(x - radius, z), east = index(x + radius, z);
      const north = index(x, z - radius), south = index(x, z + radius);
      const axes = exposure[west]! + exposure[east]! + exposure[north]! + exposure[south]!;
      const corners = exposure[index(x - radius, z - radius)]! +
        exposure[index(x + radius, z - radius)]! + exposure[index(x - radius, z + radius)]! +
        exposure[index(x + radius, z + radius)]!;
      // Wider diagonal coverage reduces the influence of individual ramp triangles.
      const filtered = (8 * exposure[at]! + axes * 2 + corners) / 20;
      const weathering = noise.sample(gridCoordinate(size, resolution, x) / (19 * scale),
        worldZ / (24 * scale)) * 0.045;
      atlas[at * 2] = Math.round(clamp(filtered + weathering, 0, 1) * 255);

      // Positive curvature is the bowl where a wall meets a landing. Restrict
      // the cue to near exposed stone and normalize for world/grid scale.
      const bowl = (heights[west]! + heights[east]! + heights[north]! + heights[south]!) * 0.25 -
        heights[at]!;
      const relief = bowl / (radius * cell);
      const foot = smoothstep(0.09, 0.34, relief) * smoothstep(0.14, 0.36, filtered);
      atlas[at * 2 + 1] = Math.round(foot * 255);
    }
  }
  return atlas;
}
