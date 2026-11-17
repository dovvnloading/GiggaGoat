import type { Vec3 } from '../physics';

// At the title/start frame the goat should show its face and both horn curls,
// not only its back. Gameplay camera controls remain freely orbitable after play.
export const SPAWN_CAMERA_YAW_OFFSET = Math.PI * .75;
export const SPAWN_CAMERA_PITCH = .12;
export const CAMERA_TARGET_HEIGHT = .28;

/** Size-aware, modestly elevated over-the-shoulder orbit (metres). */
export function goatCameraOffset(size: number, yaw: number, pitch: number): Vec3 {
  // At KID size the old 4.3m minimum and steep pitch reduced the approved
  // sculpt to a pale patch; bring it forward while retaining clearance.
  const distance = Math.max(3.2, 5.1 * Math.pow(size, .78));
  return {
    x: -Math.sin(yaw) * Math.cos(pitch) * distance,
    y: Math.sin(pitch) * distance + .72 * size,
    z: Math.cos(yaw) * Math.cos(pitch) * distance,
  };
}
