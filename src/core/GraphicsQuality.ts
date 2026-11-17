/** GPU budgets controlled by core. Draw distance is in island metres. */
export type GraphicsQuality = 'low' | 'medium' | 'high';
export interface QualityPreset {
  readonly maxPixelRatio: number;
  readonly minPixelRatio: number;
  readonly shadowMapSize: number;
  readonly shadowDistance: number;
  readonly maxShadowCasters: number;
  readonly drawDistance: number;
}

export const GRAPHICS_PRESETS: Readonly<Record<GraphicsQuality, Readonly<QualityPreset>>> =
  Object.freeze({
    low: Object.freeze({
      maxPixelRatio: 0.8, minPixelRatio: 0.6,
      shadowMapSize: 0, shadowDistance: 0, maxShadowCasters: 0, drawDistance: 160,
    }),
    medium: Object.freeze({
      maxPixelRatio: 1, minPixelRatio: 0.7,
      shadowMapSize: 512, shadowDistance: 29, maxShadowCasters: 6, drawDistance: 235,
    }),
    high: Object.freeze({
      maxPixelRatio: 1.25, minPixelRatio: 0.78,
      shadowMapSize: 1024, shadowDistance: 40, maxShadowCasters: 12, drawDistance: 340,
    }),
  });

/** A DPR=1 display stays at full native CSS resolution on High. */
export function qualityPixelRatio(quality: GraphicsQuality, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio : 1;
  return Math.min(dpr, GRAPHICS_PRESETS[quality].maxPixelRatio);
}
