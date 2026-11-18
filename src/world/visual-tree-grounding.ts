import { clamp } from './random';
import { gridIndex, gridSample } from './terrain';
import type { IslandData, Vec3 } from './types';

type Terrain = Pick<IslandData, 'heights' | 'resolution' | 'size'>;

/** Raised or mounted props keep their authored anchors. */
export function isTerrainTreeAnchor(terrain: Terrain, position: Vec3, height: number): boolean {
  return Math.abs(position.y - height * .5 - gridSample(terrain, position.x, position.z))
    <= .25 * terrain.size / 600;
}

/** Seat the tree's rendered sole against the full-detail terrain triangles. */
export function treeArtCenterY(terrain: Terrain, position: Vec3, height: number,
  unitBottom: number): number {
  const { resolution: n, size, heights } = terrain;
  const scale = size / 600;
  const { x, y, z } = position;
  if (!isTerrainTreeAnchor(terrain, position, height)) return y;
  const gx = clamp((x / size + .5) * (n - 1), 0, n - 1);
  const gz = clamp((z / size + .5) * (n - 1), 0, n - 1);
  const ix = Math.min(Math.floor(gx), n - 2), iz = Math.min(Math.floor(gz), n - 2);
  const u = gx - ix, v = gz - iz;
  const a = heights[gridIndex(n, ix, iz)]!, b = heights[gridIndex(n, ix + 1, iz)]!;
  const c = heights[gridIndex(n, ix, iz + 1)]!, d = heights[gridIndex(n, ix + 1, iz + 1)]!;
  // The rendered cell uses the b-c diagonal. Bilinear placement is kept for
  // the existing collider and may differ on a sloped cell.
  const surface = u + v <= 1 ? a + u * (b - a) + v * (c - a) :
    d + (1 - u) * (c - d) + (1 - v) * (b - d);
  return surface - unitBottom * height - .10 * scale;
}
