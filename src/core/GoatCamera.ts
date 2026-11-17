import type { Vec3 } from '../physics';
import type { ScreenRect } from './HudOcclusion';

// At the title/start frame the goat should show its face and both horn curls,
// not only its back. Gameplay camera controls remain freely orbitable after play.
export const SPAWN_CAMERA_YAW_OFFSET = Math.PI * .75;
export const SPAWN_CAMERA_PITCH = 0;
export const CAMERA_TARGET_HEIGHT = .28;

/** A size-aware orbit at street-eye height, with room to see the town. */
export function goatCameraOffset(size: number, yaw: number, pitch: number): Vec3 {
  const distance = Math.max(3.25, 4.55 * Math.pow(size, .8));
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
    y: .76 * size * weight,
    z: -Math.cos(yaw) * ahead * weight,
  };
}

/** Keep the entire projected goat above the compact build tray, at roughly
 * 78% of the viewport height like the HUD reference. The camera's view offset
 * changes framing only; it never changes the physics/orbit collision ray. */
export function goatCameraVerticalOffset(goat: ScreenRect, viewport: ScreenRect): number {
  const height = viewport.bottom - viewport.top;
  if (height <= 0 || !Number.isFinite(height)) return 0;
  // 150px leaves space for the tray, raised title badge, and a gap at 720p.
  const safeBottom = Math.min(viewport.top + height * .775, viewport.bottom - 150);
  return goat.bottom - safeBottom;
}
