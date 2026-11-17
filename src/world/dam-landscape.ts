import type { IslandData } from './types';
import { gridCoordinate, gridIndex } from './terrain';
import { lerp, smoothstep } from './random';
import { getDamPlacement } from './the-dam';

/** Metres in the Dam model's +Z (downstream) coordinates, at island size 600. */
export interface DamChannelSection {
  x: number;
  z: number;
  halfWidth: number;
  level: number;
}

/**
 * The masonry's four outlet lips sit between local X -12 and +28. The
 * first two sections make one shared plunge pool, not four dry waterfalls.
 * The water then narrows and comes straight toward bookmark 14's camera.
 */
export const DAM_CHANNEL: readonly DamChannelSection[] = [
  { x: 5, z: 5, halfWidth: 21, level: 6.2 },
  { x: 5, z: 17, halfWidth: 26, level: 6.0 },
  { x: 4, z: 29, halfWidth: 24, level: 5.7 },
  { x: 0, z: 42, halfWidth: 17, level: 5.2 },
  { x: -5, z: 57, halfWidth: 12.5, level: 4.6 },
  { x: -10, z: 75, halfWidth: 10.5, level: 4.0 },
  { x: -12, z: 94, halfWidth: 9.5, level: 3.5 },
  { x: -16, z: 110, halfWidth: 9, level: 3.2 },
];

/** Piecewise linear centreline/width so render mesh and heightfield agree. */
export function damChannelAt(z: number): DamChannelSection {
  for (let i = 0; i < DAM_CHANNEL.length - 1; i++) {
    const a = DAM_CHANNEL[i]!, b = DAM_CHANNEL[i + 1]!;
    if (z > b.z) continue;
    const t = Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z)));
    return {
      z,
      x: lerp(a.x, b.x, t),
      halfWidth: lerp(a.halfWidth, b.halfWidth, t),
      level: lerp(a.level, b.level, t),
    };
  }
  const last = DAM_CHANNEL[DAM_CHANNEL.length - 1]!;
  return { ...last, z };
}

/**
 * Sculpt the actual heightfield before roads, biomes, Rapier and collectible
 * placement. The wet core stays below the water; the narrow rocky shoulders
 * rise smoothly into the existing grass instead of being flat billboards.
 * This is seed-independent and scales with all supported island sizes.
 */
export function sculptDamOutflow(island: IslandData): void {
  const { position, scale } = getDamPlacement(island);
  const { heights, resolution: n, size } = island;
  const minZ = position.z + 4 * scale;
  const maxZ = position.z + 111 * scale;
  for (let iz = 0; iz < n; iz++) {
    const worldZ = gridCoordinate(size, n, iz);
    if (worldZ < minZ || worldZ > maxZ) continue;
    const z = (worldZ - position.z) / scale;
    const channel = damChannelAt(z);
    const fade = smoothstep(4, 12, z) * (1 - smoothstep(97, 111, z));
    for (let ix = 0; ix < n; ix++) {
      const worldX = gridCoordinate(size, n, ix);
      const x = (worldX - position.x) / scale;
      const distance = Math.abs(x - channel.x);
      const half = channel.halfWidth;
      if (distance > half + 19) continue;
      const index = gridIndex(n, ix, iz);
      const original = heights[index]!;
      const surface = position.y + channel.level * scale;
      const bed = surface - (2.7 - 0.3 * distance / Math.max(half, 1)) * scale;
      const wet = 1 - smoothstep(half - 1, half + 5, distance);
      let height = lerp(original, Math.min(original, bed), wet * fade);
      const shoulder = smoothstep(half - 1, half + 5, distance) *
        (1 - smoothstep(half + 7, half + 19, distance)) * fade;
      const rugged = 0.75 * Math.sin(x * 0.43 + z * 0.21);
      const bluffTop = surface + (5.6 + rugged) * scale;
      height = lerp(height, Math.max(height, bluffTop), shoulder * 0.72);
      heights[index] = height;
    }
  }
}
