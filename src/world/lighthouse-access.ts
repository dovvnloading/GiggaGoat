import type { IslandData, PropDescriptor, Vec3 } from './types';
import { gridSample } from './terrain';
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
