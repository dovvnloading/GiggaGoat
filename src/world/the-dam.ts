import type { IslandData, PropColliderDescriptor, Vec3 } from './types';
import { accessGuard, accessSlabs, type AccessSection } from './access-path';
import { gridSample } from './terrain';

/**
 * The GLB is authored in metres, Y-up, wall-base origin, with the
 * spillway facing local +Z and the control house at +X.
 */
export interface DamPlacement {
  position: Vec3;
  scale: number;
}

export const DAM_DECK_HEIGHT = 18.8;

/** Front rail dimensions in the Dam GLB's local space. The gap serves all Dam Bomb launches. */
export const DAM_FRONT_GUARD = {
  prefix: 'the-dam-front-guard-',
  spans: [[-29.85, 12.05], [16.95, 27.65]],
  z: 3.75,
  depth: .30,
  top: 20.21,
} as const;

// Between the four spillway recesses cut into the Dam_Wall front face (local +Z).
const DAM_WALL_FRONT_DIVIDERS = [
  [-30, -13.4], [-7, -4.6], [1.8, 4.2], [10.6, 13], [19.4, 30],
] as const;

// Y/Z profiles at the two widths of the GLB Pier_0 through Pier_4 bevel.
const DAM_PIER_PROFILES = [
  { halfWidth: 1.2, points: [
    [.15, 3.35], [.15, 7.2456], [10.3626, 6.951], [14.8802, 4.6922], [15.3835, 3.35],
  ] },
  { halfWidth: 1.05, points: [
    [0, 3.35], [0, 7.25], [.1499, 7.3957], [.15, 3.2], [10.4, 7.1],
    [14.8658, 4.8671], [15.0527, 4.6596], [15.45, 3.2], [15.5473, 3.3404],
  ] },
] as const;
const DAM_PIER_CENTERS = [-14.6, -5.8, 3, 11.8, 20.6] as const;
const DAM_PIER_HEIGHT = 15.5473;
const DAM_PIER_BACK = 3.2;
const DAM_PIER_FRONT = 7.3957;

const PLATFORM_GUARD = 'front-guard-platform';
export const DAM_PLATFORM_GUARD_ID = 'the-dam-' + PLATFORM_GUARD;

export const DAM_ACCESS_ID = 'the-dam-access-';
export const DAM_ACCESS_GUARD_ID = DAM_ACCESS_ID + 'guard-';
export const DAM_ACCESS_SUPPORT_ID = 'the-dam-access-support-';
export const DAM_BACK_GUARD = {
  prefix: 'the-dam-back-guard-',
  spans: [[-29.85, -14.5], [-6.9, 27.65]],
  z: -3.75,
  depth: .30,
  top: 20.21,
} as const;

export function getDamPlacement(island: Pick<IslandData, 'size' | 'reservoir'>): DamPlacement {
  const scale = island.size / 600;
  const lake = island.reservoir;
  // Keep the original dam wall anchor and original walkable deck elevation.
  // The old platform's top was reservoir.level + 7.1 m at default scale.
  return {
    position: {
      x: lake.center.x - 16 * scale,
      y: lake.level + (7.1 - DAM_DECK_HEIGHT) * scale,
      z: lake.center.z - 22 * scale,
    },
    scale,
  };
}

/** A shore-level approach on the road side of the wall. */
export function damAccess(island: IslandData): [ramp: AccessSection[], transfer: AccessSection[]] {
  const { position, scale } = getDamPlacement(island);
  const at = (x: number, y: number, z: number): Vec3 => ({
    x: position.x + x * scale,
    y: position.y + y * scale,
    z: position.z + z * scale,
  });
  const start = at(11.75, 0, -8.5);
  const grade = gridSample(island, start.x, start.z) - .18 * scale;
  const base = (grade - position.y) / scale;
  const ramp = (x: number, y: number): AccessSection =>
    ({ outer: at(x, y, -11), inner: at(x, y, -6) });
  const turnEnd = -14.35;
  const landing = (z: number, outside: number): AccessSection =>
    ({ outer: at(outside, DAM_DECK_HEIGHT, z), inner: at(-7.2, DAM_DECK_HEIGHT, z) });
  return [
    [ramp(11.75, base), ramp(-7.2, DAM_DECK_HEIGHT), ramp(turnEnd, DAM_DECK_HEIGHT)],
    [landing(-6.04, turnEnd), landing(-3.58, turnEnd)],
  ];
}

export function damAccessGuards([ramp, transfer]: ReturnType<typeof damAccess>,
  scale: number): AccessSection[][] {
  const westEnd = ramp.at(-1)!.outer;
  const westTurn = [{
    outer: westEnd,
    inner: { ...transfer[0]!.inner, z: westEnd.z },
  }, ...transfer];
  return [
    accessGuard(ramp, 'outer', scale),
    accessGuard(ramp.slice(0, 2), 'inner', scale),
    accessGuard(westTurn, 'outer', scale),
    accessGuard(transfer, 'inner', scale),
  ];
}

/**
 * Solid architecture only: the water sheets and foam are NOT colliders.
 * The spillway opening on the +Z edge gives Dam Bomb a clear drop into the falls.
 * Small ladder rungs offer successive footholds for climbing.
 */
export function makeDamColliderDescriptors(island: IslandData): PropColliderDescriptor[] {
  const { position, scale } = getDamPlacement(island);
  const makeBox = (id: string, x: number, y: number, z: number,
    width: number, height: number, depth: number): PropColliderDescriptor => ({
    id: 'the-dam-' + id,
    shape: 'cuboid',
    body: { type: 'static' },
    transform: {
      position: {
        x: position.x + x * scale,
        y: position.y + y * scale,
        z: position.z + z * scale,
      },
      rotationY: 0,
    },
    size: { x: width * scale, y: height * scale, z: depth * scale },
  });

  const pierMidY = DAM_PIER_HEIGHT / 2;
  const pierMidZ = (DAM_PIER_BACK + DAM_PIER_FRONT) / 2;
  const pierVertices = new Float32Array(DAM_PIER_PROFILES.flatMap(({ halfWidth, points }) =>
    [-halfWidth, halfWidth].flatMap(x => points.flatMap(([y, z]) =>
      [x * scale, (y - pierMidY) * scale, (z - pierMidZ) * scale]))));
  const piers = DAM_PIER_CENTERS.map((x, i): PropColliderDescriptor => ({
    ...makeBox('pier-' + i, x, pierMidY, pierMidZ,
      2 * DAM_PIER_PROFILES[0].halfWidth, DAM_PIER_HEIGHT, DAM_PIER_FRONT - DAM_PIER_BACK),
    shape: 'convex',
    vertices: pierVertices,
  }));

  const access = damAccess(island);
  const start = access[0]![0]!.outer;
  const crest = access[0]![1]!.outer;
  const supports = [.39, .75, 1.15].flatMap((progress, row) => {
    const x = start.x + (crest.x - start.x) * progress;
    const floorY = start.y + (crest.y - start.y) * Math.min(progress, 1) - .34 * scale;
    return [-10.35, -6.65].flatMap((z, side) => {
      const grade = gridSample(island, x, position.z + z * scale) - .14 * scale;
      const height = (floorY - grade) / scale;
      if (height <= .1) return [];
      return [makeBox('access-support-' + row + '-' + side, (x - position.x) / scale,
        (grade - position.y) / scale + height / 2, z, .46, height, .46)];
    });
  });
  const colliders: PropColliderDescriptor[] = [
    // Dam_Wall is recessed from local Z 3.5 to 2 inside each opening at Y 12–15.4.
    makeBox('wall', 0, 9, -.75, 60, 18, 5.5),
    makeBox('wall-front-lower', 0, 6, 2.75, 60, 12, 1.5),
    makeBox('wall-front-upper', 0, 16.7, 2.75, 60, 2.6, 1.5),
    ...DAM_WALL_FRONT_DIVIDERS.map(([left, right], i) =>
      makeBox('wall-front-divider-' + i, (left + right) / 2, 13.7, 2.75, right - left, 3.4, 1.5)),
    // Dam_Deck includes the rear lip and the last tread at the spillway edge.
    makeBox('deck', 0, 18.4, -.2, 61, .8, 8.2),
    ...DAM_FRONT_GUARD.spans.map(([left, right], index) =>
      makeBox('front-guard-' + index, (left + right) / 2,
        (DAM_DECK_HEIGHT + DAM_FRONT_GUARD.top) / 2, DAM_FRONT_GUARD.z,
        right - left, DAM_FRONT_GUARD.top - DAM_DECK_HEIGHT, DAM_FRONT_GUARD.depth)),
    ...DAM_BACK_GUARD.spans.map(([left, right], index) =>
      makeBox('back-guard-' + index, (left + right) / 2,
        (DAM_DECK_HEIGHT + DAM_BACK_GUARD.top) / 2, DAM_BACK_GUARD.z,
        right - left, DAM_BACK_GUARD.top - DAM_DECK_HEIGHT, DAM_BACK_GUARD.depth)),
    ...access.flatMap((path, i) => accessSlabs(DAM_ACCESS_ID + i + '-', path, .38 * scale)),
    ...damAccessGuards(access, scale).flatMap((path, i) =>
      accessSlabs(DAM_ACCESS_GUARD_ID + i + '-', path, 1.22 * scale)),
    ...supports,
    ...piers,
    // Match the baked ControlHouse_* model nodes. The house sits on a
    // separate platform beyond the east end of Dam_Deck.
    makeBox('control-house-pillar', 36, 8.9, -1.5, 11, 17.8, 8),
    makeBox('control-house-platform', 36, 18.3, -1, 14, 1, 11.5),
    makeBox('control-house', 36.5, 23, -1.1, 12, 8.4, 9.3),
    makeBox('control-house-roof', 36.5, 27.575, -1.1, 13.2, .75, 10.5),
    makeBox(PLATFORM_GUARD, 36, 19.505, 4.5, 13.7, 1.41, .30),
    // Narrow vertical ladder rails and separate footholds, rather than
    // an impassable full-height ladder collision box.
    makeBox('ladder-left', -17.3, 9.4, 3.15, 0.18, 17.8, 0.25),
    makeBox('ladder-right', -15.6, 9.4, 3.15, 0.18, 17.8, 0.25),
  ];
  for (let i = 0; i < 14; i++) {
    colliders.push(makeBox('ladder-rung-' + i,
      -16.45, 1.15 + i * 1.25, 3.28, 1.8, 0.19, 0.4));
  }
  return colliders;
}
