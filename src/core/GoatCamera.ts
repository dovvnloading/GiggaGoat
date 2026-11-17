import type { Vec3 } from '../physics';

// At the title/start frame the goat should show its face and both horn curls,
// not only its back. Gameplay camera controls remain freely orbitable after play.
export const SPAWN_CAMERA_YAW_OFFSET = Math.PI * .75;
export const SPAWN_CAMERA_PITCH = 0;
export const CAMERA_TARGET_HEIGHT = .28;

/** A size-aware orbit at street-eye height, with room to see the town. */
export function goatCameraOffset(size: number, yaw: number, pitch: number): Vec3 {
  const distance = Math.max(4.6, 6.4 * Math.pow(size, .78));
  return {
    x: -Math.sin(yaw) * Math.cos(pitch) * distance,
    y: Math.sin(pitch) * distance + 1.85 * size,
    z: Math.cos(yaw) * Math.cos(pitch) * distance,
  };
}

/** Look along the street instead of down at the goat. Fade the lead when a
 * wall pulls the camera toward its collision pivot so the goat stays visible. */
export function goatCameraLookAhead(size: number, yaw: number, clearance = 1): Vec3 {
  const ahead = Math.max(2.7, 4.2 * Math.pow(size, .78));
  const weight = Math.max(0, Math.min(1, clearance));
  return {
    x: Math.sin(yaw) * ahead * weight,
    y: 1.65 * size * weight,
    z: -Math.cos(yaw) * ahead * weight,
  };
}
