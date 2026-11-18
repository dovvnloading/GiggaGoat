import type { IslandData, PropColliderDescriptor, Vec3 } from './types';

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

  const colliders: PropColliderDescriptor[] = [
    // Recess the wall below the deck so the spillway drop stays clear.
    makeBox('wall', 0, 9, -1.6, 58, 18, 2.4),
    makeBox('deck', 0, 18.35, 0, 60, 0.9, 7.4),
    ...DAM_FRONT_GUARD.spans.map(([left, right], index) =>
      makeBox('front-guard-' + index, (left + right) / 2,
        (DAM_DECK_HEIGHT + DAM_FRONT_GUARD.top) / 2, DAM_FRONT_GUARD.z,
        right - left, DAM_FRONT_GUARD.top - DAM_DECK_HEIGHT, DAM_FRONT_GUARD.depth)),
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
