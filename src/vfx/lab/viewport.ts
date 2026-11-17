/** Stable logical WebGL size for the fixed 16:9 VFX lab viewport.
 *
 * The only layout input is the wrapper's CSS width: never read canvas
 * dimensions or a grid row's height (both can change after setSize()).
 * Three.js applies pixelRatio to the drawing buffer, not the CSS box.
 */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

const ASPECT_RATIO = 16 / 9;
const MAX_PIXEL_RATIO = 2;

export function getViewportSize(containerWidth: number, devicePixelRatio: number): ViewportSize | null {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return null;

  const width = Math.max(1, Math.round(containerWidth));
  const height = Math.max(1, Math.round(width / ASPECT_RATIO));
  const pixelRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? Math.min(devicePixelRatio, MAX_PIXEL_RATIO)
    : 1;
  return { width, height, pixelRatio };
}
