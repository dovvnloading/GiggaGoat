import { clamp, GradientNoise, hashString, smoothstep } from './random';
import { gridCoordinate, gridIndex } from './terrain';
import type { IslandData } from './types';

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
