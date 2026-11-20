import { gridSample } from './terrain';
import type { IslandData, RoadDescriptor } from './types';

/** The visible and walkable faces of Hoofington's two sidewalks and curbs. */
export function hoofingtonVergeData(island: IslandData, road: RoadDescriptor) {
  const scale = island.size / 600;
  const edge = road.width / 2;
  const profiles = [
    { from: edge + .36 * scale, to: edge + 2.34 * scale,
      surface: 1, y: (x: number, z: number) => gridSample(island, x, z) + .04 * scale },
    { from: edge + .022 * scale, to: edge + .36 * scale,
      surface: 2, skirt: true,
      y: (_x: number, _z: number, roadY: number) => roadY + .20 + .08 * scale },
    { from: edge - .39 * scale, to: edge - .30 * scale,
      surface: 0, y: (_x: number, _z: number, roadY: number) => roadY + .214 },
  ];
  const positions: number[] = [], indices: number[] = [];
  const section: number[] = [], supportIndices: number[] = [];
  for (const profile of profiles) {
    const across = (offset: number): number =>
      (Math.abs(offset) - profile.from) / (profile.to - profile.from);
    for (const side of [-1, 1]) {
      const first = positions.length / 3;
      const left = side < 0 ? -profile.to : profile.from;
      const right = side < 0 ? -profile.from : profile.to;
      for (const point of road.points) {
        for (const offset of [left, right]) {
          const x = point.x + offset;
          positions.push(x, profile.y(x, point.z, point.y), point.z);
          section.push(across(offset), profile.surface);
        }
      }
      for (let i = 1; i < road.points.length; i++) {
        const a = first + (i - 1) * 2, b = a + 2;
        const top = [a, b, a + 1, a + 1, b, b + 1];
        indices.push(...top);
        // Paint and vertical curb skirts have no effect on walking contact.
        if (profile.surface !== 0) supportIndices.push(...top);
      }
      if (profile.skirt) for (const offset of [left, right]) {
        const start = positions.length / 3;
        for (const point of road.points) {
          const x = point.x + offset;
          positions.push(x, profile.y(x, point.z, point.y), point.z,
            x, gridSample(island, x, point.z) - .04 * scale, point.z);
          section.push(across(offset), profile.surface, across(offset), profile.surface);
        }
        for (let i = 1; i < road.points.length; i++) {
          const a = start + (i - 1) * 2, b = a + 2;
          if (offset === left) indices.push(a, a + 1, b, a + 1, b + 1, b);
          else indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
  }
  return { positions, indices, section, supportIndices };
}
