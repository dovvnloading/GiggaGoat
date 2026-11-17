/**
 * Three's default shadowMap.autoUpdate redraws every shadow caster every frame.
 * The standalone world viewer has no moving shadow-casting bodies: the wind
 * animation is a colour-material deformation, not a depth-material animation.
 * Cache the directional depth map until the sun, world, or visible casters change.
 *
 * This deliberately does not affect the main game's renderer, which has
 * dynamic actors and can keep autoUpdate enabled.
 */
export interface ShadowMapState {
  autoUpdate: boolean;
  needsUpdate: boolean;
}

export interface StaticShadowCache {
  invalidate(): void;
  beforeRender(): void;
}

export function createStaticShadowCache(map: ShadowMapState): StaticShadowCache {
  map.autoUpdate = false;
  let dirty = true; // First frame must paint a complete shadow map.
  return {
    invalidate(): void { dirty = true; },
    beforeRender(): void {
      if (!dirty) return;
      map.needsUpdate = true;
      dirty = false;
    },
  };
}
