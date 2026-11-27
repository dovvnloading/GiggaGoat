import { clamp } from './random';
import { gridIndex, gridSample } from './terrain';
import type { IslandData, Vec3 } from './types';

type Terrain = Pick<IslandData, 'heights' | 'resolution' | 'size'>;

/** Raised or mounted props keep their authored anchors. */
export function isTerrainTreeAnchor(terrain: Terrain, position: Vec3, height: number): boolean {
  return Math.abs(position.y - height * .5 - gridSample(terrain, position.x, position.z))
    <= .25 * terrain.size / 600;
}

function renderedSurfaceAt(terrain: Terrain, x: number, z: number): number {
  const { resolution: n, size, heights } = terrain;
  const gx = clamp((x / size + .5) * (n - 1), 0, n - 1);
  const gz = clamp((z / size + .5) * (n - 1), 0, n - 1);
  const ix = Math.min(Math.floor(gx), n - 2), iz = Math.min(Math.floor(gz), n - 2);
  const u = gx - ix, v = gz - iz;
  const a = heights[gridIndex(n, ix, iz)]!, b = heights[gridIndex(n, ix + 1, iz)]!;
  const c = heights[gridIndex(n, ix, iz + 1)]!, d = heights[gridIndex(n, ix + 1, iz + 1)]!;
  // The rendered cell uses the b-c diagonal. Bilinear placement is kept for
  // the existing collider and may differ on a sloped cell.
  return u + v <= 1 ? a + u * (b - a) + v * (c - a) :
    d + (1 - u) * (c - d) + (1 - v) * (b - d);
}

/** Seat the tree's rendered sole against the full-detail terrain triangles. */
export function treeArtCenterY(terrain: Terrain, position: Vec3, height: number,
  unitBottom: number, footingRadius = 0): number {
  if (!isTerrainTreeAnchor(terrain, position, height)) return position.y;
  const { x, z } = position;
  let surface = renderedSurfaceAt(terrain, x, z);
  if (footingRadius > 0) {
    const offsets = [-footingRadius, 0, footingRadius];
    for (const dx of offsets) for (const dz of offsets) {
      if (dx || dz) surface = Math.min(surface, renderedSurfaceAt(terrain, x + dx, z + dz));
    }
  }
  return surface - unitBottom * height - .10 * terrain.size / 600;
}

export function roundOakArtCenterY(terrain: Terrain, position: Vec3, size: Vec3): number {
  // Include the downhill side so the flared trunk and root tips meet the soil.
  // All three fitted round-oak bases fit within this fraction of the crown box.
  return treeArtCenterY(terrain, position, size.y, -.49, .20 * Math.max(size.x, size.z));
}
