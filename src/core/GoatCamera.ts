import type { Vec3 } from '../physics';

// At the title/start frame the goat should show its face and both horn curls,
// not only its back. Gameplay camera controls remain freely orbitable after play.
export const SPAWN_CAMERA_YAW_OFFSET = Math.PI * .75;
export const SPAWN_CAMERA_PITCH = 0;
export const CAMERA_TARGET_HEIGHT = .28;

/** A size-aware orbit at street-eye height, with room to see the town. */
export function goatCameraOffset(size: number, yaw: number, pitch: number): Vec3 {
  const distance = Math.max(3.25, 4.55 * Math.pow(size, 1.16));
  return {
    x: -Math.sin(yaw) * Math.cos(pitch) * distance,
    y: Math.sin(pitch) * distance + 1.6 * size,
    z: Math.cos(yaw) * Math.cos(pitch) * distance,
  };
}

/** Look along the street instead of down at the goat. Fade the lead when a
 * wall pulls the camera toward its collision pivot so the goat stays visible. */
export function goatCameraLookAhead(size: number, yaw: number, clearance = 1): Vec3 {
  const ahead = Math.max(1.45, 2.2 * Math.pow(size, .78));
  const weight = Math.max(0, Math.min(1, clearance));
  return {
    x: Math.sin(yaw) * ahead * weight,
    y: 1.28 * size * weight,
    z: -Math.cos(yaw) * ahead * weight,
  };
}

/** Frame a nominal heel in the unobstructed chase pose. The lens only responds
 * to the chosen orbit, size and viewport, so the animated ragdoll cannot move it. */
export function goatCameraVerticalOffset(size: number, pitch: number, fov: number,
  height: number): number {
  if (!(height > 0)) return 0;
  const eye = goatCameraOffset(size, 0, pitch);
  const aim = goatCameraLookAhead(size, 0);
  const forwardY = aim.y - eye.y, forwardZ = aim.z - eye.z;
  const heelY = -.38 * size - eye.y, heelZ = .5 * size - eye.z;
  // Camera-space up and depth share the same normalisation, which cancels in
  // the perspective divide.
  const up = -forwardZ * heelY + forwardY * heelZ;
  const depth = forwardY * heelY + forwardZ * heelZ;
  if (depth <= 0) return 0;
  const bottom = .5 * (1 - up / (depth * Math.tan(fov * Math.PI / 360)));
  const safeBottom = Math.min(.775, 1 - 150 / height);
  const lift = (bottom - safeBottom) * height;
  return Number.isFinite(lift) ? Math.max(0, Math.min(height * .1, lift)) : 0;
}
