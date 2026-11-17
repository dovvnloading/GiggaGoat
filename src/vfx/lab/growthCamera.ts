/** 09-only camera framing; no renderer, DOM, or per-frame allocations. */
import { GROWTH_TIER_SCALES, type GrowthTier } from '../growthAuraMath';

export interface GrowthCameraFrame {
  readonly targetY: number;
  /** Distance from the camera target, before its orbit rotation. */
  readonly distance: number;
}

/**
 * Framing envelope for the reference goat plus every part of the tiered aura.
 * The goat's stand silhouette reaches ~2.1 Billy-scale units; the tall aura
 * pillars and ribbons reach ~2.2, and the GIGGA flare widens the silhouette.
 * Pad those bounds for horns, motes, the spiral orbit and the perspective
 * of the near side of the effect. Use a 16:9 stage for the original design.
 */
export function frameGrowthCamera(
  tier: GrowthTier, aspect = 16 / 9, verticalFovDegrees = 40, elevation = 0.19,
): GrowthCameraFrame {
  if (!Number.isFinite(aspect) || aspect <= 0 ||
      !Number.isFinite(verticalFovDegrees) || verticalFovDegrees <= 0 ||
      verticalFovDegrees >= 180 || !Number.isFinite(elevation)) {
    throw new RangeError('Invalid growth preview camera projection');
  }

  const scale = GROWTH_TIER_SCALES[tier];
  const bottom = -0.23 * scale;
  const top = 2.35 * scale;
  // Covers the world-space ground disc and the extended flare at GIGGA.
  const radialExtent = 1.55 * scale + 0.17;
  const angle = Math.min(Math.PI / 2, Math.abs(elevation));
  const halfVertical = (top - bottom) * 0.5 * Math.cos(angle) +
    radialExtent * Math.sin(angle);
  const tangent = Math.tan(verticalFovDegrees * Math.PI / 360);
  const verticalDistance = halfVertical / tangent;
  const horizontalDistance = radialExtent / (tangent * aspect);
  // Account for the closer faces of the goat/spiral as well as a clear margin.
  const distance = Math.max(4.35, radialExtent * 0.36 +
    1.10 * Math.max(verticalDistance, horizontalDistance));

  return { targetY: (bottom + top) * 0.5, distance };
}
