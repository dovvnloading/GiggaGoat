import RAPIER, { type ColliderDesc } from '@dimforge/rapier3d-compat';
import type { GoatPart, GoatSize } from './GoatRagdoll';
import { add, mul, multiplyRotation, V, worldPoint, yawQuaternion, type Vec3 } from './math';

export const HIPS = [
  { name: 'frontLeft', x: -.24, z: -.40 }, { name: 'frontRight', x: .24, z: -.40 },
  { name: 'backLeft', x: -.24, z: .40 }, { name: 'backRight', x: .24, z: .40 },
] as const;

const HEAD_FORWARD = .84;
const HEAD_RADIUS = .23;
/** Furthest horizontal point from a standing goat's torso at Billy size. */
export const STANDING_GOAT_RADIUS = HEAD_FORWARD + HEAD_RADIUS;

interface BodyGeometry {
  part: GoatPart;
  offset: Vec3;
  colliders: ColliderDesc[];
}

/** Body offsets are in the standing rig's local frame, facing -Z. */
export function goatBodyGeometry(size: GoatSize): BodyGeometry[] {
  const massScale = size ** 3;
  // The three skinned rigs span 0.97–1.05 m across the ears at Y 1.3, Z −0.1.
  // That skin follows the torso even in a flop. The trunk already owns its mass.
  const ears = RAPIER.ColliderDesc.capsule(.34 * size, .16 * size)
    .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 })
    .setTranslation(0, .40 * size, -.09 * size).setMass(0);
  return [
    { part: 'torso', offset: V(0, .92 * size, 0), colliders: [
      RAPIER.ColliderDesc.cuboid(.29 * size, .27 * size, .52 * size).setMass(14 * massScale), ears,
    ] },
    { part: 'neck', offset: mul(V(0, 1.24, -.62), size),
      colliders: [RAPIER.ColliderDesc.cuboid(.15 * size, .22 * size, .19 * size).setMass(2 * massScale)] },
    { part: 'head', offset: mul(V(0, 1.48, -HEAD_FORWARD), size),
      colliders: [RAPIER.ColliderDesc.ball(HEAD_RADIUS * size).setMass(3 * massScale)] },
    ...HIPS.map(({ name, x, z }) => ({
      part: name, offset: mul(V(x, .44, z), size),
      colliders: [RAPIER.ColliderDesc.cuboid(.10 * size, .38 * size, .115 * size).setMass(2 * massScale)],
    })),
  ];
}

/** World-space fixtures of a prospective upright spawn, before Rapier has a body. */
export function standingGoatShapes(size: GoatSize, position: Vec3, yaw: number) {
  const rotation = yawQuaternion(yaw);
  return goatBodyGeometry(size).flatMap(({ offset, colliders }) => colliders.map(collider => ({
    shape: collider.shape, position: worldPoint(position, rotation, add(offset, collider.translation)),
    rotation: multiplyRotation(rotation, collider.rotation),
  })));
}
