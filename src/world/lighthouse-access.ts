import type { IslandData, PropColliderDescriptor, PropDescriptor, Vec3 } from './types';
import { gridIndex, gridSample } from './terrain';
import { clamp } from './random';
import { accessGuard, sectionCenter, type AccessSection } from './access-path';

export const LIGHTHOUSE_ACCESS_ID = 'lighthouse-access-';
export const LIGHTHOUSE_ACCESS_GUARD_ID = LIGHTHOUSE_ACCESS_ID + 'guard-';
const STEPS = 36;

/** The keeper's sloped stair begins on the board side and rises outside the tower shell. */
export function lighthouseAccess(tower: PropDescriptor,
  surface: (x: number, z: number) => number): AccessSection[] {
  const { position } = tower.transform;
  const scale = tower.size.y / 29;
  const startAngle = 0.42;
  const startRadius = 8.15 * scale;
  const startY = surface(position.x + startRadius * Math.cos(startAngle),
    position.z + startRadius * Math.sin(startAngle)) - 0.06 * scale;
  const beaconY = position.y + tower.size.y / 2 - 0.45 * scale;
  return Array.from({ length: STEPS + 1 }, (_, step) => {
    const progress = step / STEPS;
    const angle = startAngle - progress * 2.5 * Math.PI;
    const y = startY + (beaconY - startY) * Math.min(1, progress / 0.94);
    const at = (radius: number): Vec3 => ({
      x: position.x + Math.cos(angle) * radius * scale,
      y,
      z: position.z + Math.sin(angle) * radius * scale,
    });
    return { outer: at(10.7), inner: at(5.6) };
  });
}

/** The low ramp edge crosses the bridge approach and stays open to foot traffic. */
export function lighthouseOuterGuard(path: readonly AccessSection[], scale: number): AccessSection[] {
  return accessGuard(path.slice(3), 'outer', scale);
}

export function lighthouseFlagPositions(sections: readonly AccessSection[],
  count: number, offset: number): Vec3[] {
  return Array.from({ length: count }, (_, i) => {
    const index = i === count - 1
      ? sections.length - 2 : Math.round((i + 1) * (sections.length - 1) / count) + offset;
    return sectionCenter(sections[index]!);
  });
}

/** Keep the tower solid below the surrounding uneven cape so a climb cannot enter underneath. */
export function lighthouseFoundationDepth(island: IslandData, tower: PropDescriptor): number {
  const radius = tower.size.x / 2;
  const { x, y, z } = tower.transform.position;
  const originalBottom = y - tower.size.y / 2;
  const nearby = Array.from({ length: 16 }, (_, i) => {
    const angle = i * Math.PI / 8;
    return gridSample(island, x + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
  });
  return Math.max(0, originalBottom - Math.min(...nearby)) + 1.25 * island.size / 600;
}

/** Match the native terrain triangles where the cliff props meet the slope. */
export function capeSurface(island: IslandData, x: number, z: number): number {
  const { resolution, size, heights } = island;
  const gx = clamp((x / size + 0.5) * (resolution - 1), 0, resolution - 1);
  const gz = clamp((z / size + 0.5) * (resolution - 1), 0, resolution - 1);
  const ix = Math.min(Math.floor(gx), resolution - 2);
  const iz = Math.min(Math.floor(gz), resolution - 2);
  const tx = gx - ix, tz = gz - iz;
  const a = heights[gridIndex(resolution, ix, iz)]!;
  const b = heights[gridIndex(resolution, ix + 1, iz)]!;
  const c = heights[gridIndex(resolution, ix, iz + 1)]!;
  const d = heights[gridIndex(resolution, ix + 1, iz + 1)]!;
  return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz
    : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}

interface KeeperCottagePier {
  id: string;
  corners: Array<{ top: Vec3; foot: Vec3 }>;
}

/** Seat the two downhill sill corners, leaving the opening between them clear. */
export function keeperCottagePiers(island: IslandData, cottage: PropDescriptor): KeeperCottagePier[] {
  const { position, rotationY } = cottage.transform;
  const scale = island.size / 600;
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  const sill = position.y - cottage.size.y / 2;
  const cap = sill + .04 * scale;
  return [-1, 1].flatMap(side => {
    // The rendered sill ends at local x = .46 and z = plus or minus .425 of the descriptor.
    // Set the feet on final terrain, after the channel has been carved.
    const near = side < 0 ? -.425 : .27;
    const far = side < 0 ? -.27 : .425;
    let exposed = false;
    const corners = [[.325, near], [.46, near], [.46, far], [.325, far]]
      .map(([localX, localZ]) => {
        const dx = localX! * cottage.size.x, dz = localZ! * cottage.size.z;
        const x = position.x + c * dx + s * dz;
        const z = position.z - s * dx + c * dz;
        const surface = capeSurface(island, x, z);
        exposed ||= sill - surface > .12 * scale;
        return {
          top: { x, y: cap, z },
          foot: { x, y: Math.min(cap - .18 * scale, surface - .28 * scale), z },
        };
      });
    return exposed ? [{ id: 'lighthouse-keeper-cottage-pier-' + (side < 0 ? 'north' : 'south'),
      corners }] : [];
  });
}

/** Static hulls follow the same exposed masonry, without filling the cottage opening. */
export function keeperCottagePierColliders(island: IslandData,
  cottage: PropDescriptor): PropColliderDescriptor[] {
  return keeperCottagePiers(island, cottage).map(({ id, corners }) => {
    const points = corners.flatMap(({ top, foot }) => [top, foot]);
    const bounds = (axis: keyof Vec3) => points.map(point => point[axis]);
    const size = (axis: keyof Vec3) => {
      const values = bounds(axis);
      return Math.max(...values) - Math.min(...values);
    };
    const position = { ...corners[0]!.top };
    return {
      id, shape: 'convex', body: { type: 'static' },
      transform: { position, rotationY: 0 },
      size: { x: size('x'), y: size('y'), z: size('z') },
      vertices: Float32Array.from(points.flatMap(point => [
        point.x - position.x, point.y - position.y, point.z - position.z,
      ])),
    };
  });
}
