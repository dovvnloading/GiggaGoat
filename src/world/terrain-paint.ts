import { clamp, GradientNoise, hashString } from './random';
import { gridCoordinate, gridIndex } from './terrain';
import type { IslandData } from './types';

/** Filter slope coverage in world space, separately from the lighting normals. */
export function terrainRockMask(island: IslandData): Uint8Array {
  const { heights, resolution, size } = island;
  const cell = size / (resolution - 1);
  const scale = size / 600;
  const sampleRadius = Math.max(1, Math.round(3 * scale / cell));
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
  const mask = new Uint8Array(heights.length);
  for (let z = 0; z < resolution; z++) {
    const worldZ = gridCoordinate(size, resolution, z);
    for (let x = 0; x < resolution; x++) {
      const at = index(x, z);
      const filtered = (4 * exposure[at]! +
        exposure[index(x - sampleRadius, z)]! + exposure[index(x + sampleRadius, z)]! +
        exposure[index(x, z - sampleRadius)]! + exposure[index(x, z + sampleRadius)]!) / 8;
      const weathering = noise.sample(gridCoordinate(size, resolution, x) / (19 * scale),
        worldZ / (24 * scale)) * 0.07;
      mask[at] = Math.round(clamp(filtered + weathering, 0, 1) * 255);
    }
  }
  return mask;
}
