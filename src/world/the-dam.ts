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

export const DAM_ACCESS_ID = 'the-dam-access-';
export const DAM_ACCESS_GUARD_ID = DAM_ACCESS_ID + 'guard-';
export const DAM_ACCESS_SUPPORT_ID = 'the-dam-access-support-';
export const DAM_BACK_GUARD = {
  prefix: 'the-dam-back-guard-',
  spans: [[-29.85, -13.1], [-6.9, 27.65]],
  z: -3.75,
  depth: .30,
  top: 20.21,
} as const;

export function getDamPlacement(island: IslandData): DamPlacement {
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
    [landing(-6.04, turnEnd), landing(-3.58, -13.0)],
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
    // Recess the wall below the deck so the spillway drop stays clear.
    makeBox('wall', 0, 9, -1.6, 58, 18, 2.4),
    makeBox('deck', 0, 18.35, 0, 60, 0.9, 7.4),
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
    // Four openings and five masonry piers as visible in the hero art.
    ...[-12, -2, 8, 18, 28].map((x, i) =>
      makeBox('pier-' + i, x, 8.7, 1.8, 2.6, 17.4, 4.8)),
    // House sits on the right-hand end of the deck; its roof is solid.
    makeBox('control-house', 23.5, 23.4, -0.7, 12.5, 9.2, 9),
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
