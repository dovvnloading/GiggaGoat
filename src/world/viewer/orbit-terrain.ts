import type { PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gridIndex } from '../terrain';
import type { IslandData } from '../types';

type Terrain = Pick<IslandData, 'heights' | 'resolution' | 'size'>;

/** Highest rendered terrain in a small square around the eye. */
function groundBelow(terrain: Terrain, x: number, z: number, radius: number): number {
  const { size, resolution, heights } = terrain;
  const maxIndex = resolution - 1;
  const cell = size / maxIndex;
  const left = (x - radius + size / 2) / cell, right = (x + radius + size / 2) / cell;
  const top = (z - radius + size / 2) / cell, bottom = (z + radius + size / 2) / cell;
  let high = -Infinity;
  for (let iz = Math.max(0, Math.floor(top)); iz < maxIndex && iz <= bottom; iz++) {
    const v0 = Math.max(0, top - iz), v1 = Math.min(1, bottom - iz);
    for (let ix = Math.max(0, Math.floor(left)); ix < maxIndex && ix <= right; ix++) {
      const u0 = Math.max(0, left - ix), u1 = Math.min(1, right - ix);
      const a = heights[gridIndex(resolution, ix, iz)]!;
      const b = heights[gridIndex(resolution, ix + 1, iz)]!;
      const c = heights[gridIndex(resolution, ix, iz + 1)]!;
      const d = heights[gridIndex(resolution, ix + 1, iz + 1)]!;
      // The renderer splits each nearby full-LOD cell along the b-c diagonal.
      // A maximum occurs at one of the clipped corners or diagonal endpoints.
      const height = (u: number, v: number): number => u + v <= 1
        ? a + u * (b - a) + v * (c - a)
        : d + (1 - u) * (c - d) + (1 - v) * (b - d);
      high = Math.max(high, height(u0, v0), height(u0, v1), height(u1, v0), height(u1, v1));
      const start = Math.max(u0, 1 - v1), end = Math.min(u1, 1 - v0);
      if (start <= end) high = Math.max(high, c + (b - c) * start, c + (b - c) * end);
    }
  }
  return high;
}

/** Keep terrain correction out of the controller's requested orbit pose. */
export function updateOrbitCamera(camera: PerspectiveCamera, orbit: OrbitControls,
  terrain?: Terrain): void {
  orbit.update();
  camera.position.copy(orbit.object.position);
  camera.quaternion.copy(orbit.object.quaternion);
  // Bookmark export uses the authored pose. Free orbit protects the complete
  // near plane as well as the eye, including on steep slopes or wide displays.
  if (terrain) {
    const tangent = Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
    const radius = camera.near * Math.hypot(1, tangent, tangent * camera.aspect);
    const floor = groundBelow(terrain, camera.position.x, camera.position.z, radius) + radius + .1;
    if (camera.position.y < floor) {
      camera.position.y = floor;
      camera.lookAt(orbit.target);
    }
  }
  camera.updateMatrixWorld();
}
