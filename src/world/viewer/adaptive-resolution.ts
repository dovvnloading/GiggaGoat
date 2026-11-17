/**
 * The viewer spends most of its pixels in full-screen sky/water/terrain.
 * A fixed devicePixelRatio of 1.5 renders 2.25x as many fragments as 1.
 * Favor a real 60 Hz presentation over supersampling on slower GPUs.
 *
 * Integrations own their renderer and are not affected by this viewer policy.
 * Feed actual displayed frame intervals (seconds), not 1 / Three.js draw calls.
 */
export const MAX_VIEWER_PIXEL_RATIO = 1;
export const MIN_VIEWER_PIXEL_RATIO = 0.5;
const TARGET_MS = 1000 / 60;
const SAMPLE_SECONDS = 0.75;
const RECOVERY_SECONDS = 4;

export interface AdaptiveViewerResolution {
  readonly ratio: number;
  /** Returns the new ratio only when a resize is required. */
  frame(deltaSeconds: number): number | null;
  reset(): void;
}

export function createAdaptiveViewerResolution(devicePixelRatio: number): AdaptiveViewerResolution {
  const cap = Number.isFinite(devicePixelRatio)
    ? Math.max(MIN_VIEWER_PIXEL_RATIO, Math.min(MAX_VIEWER_PIXEL_RATIO, devicePixelRatio))
    : MAX_VIEWER_PIXEL_RATIO;
  let ratio = cap;
  let seconds = 0;
  let frames = 0;
  let recovery = 0;

  function reset(): void {
    seconds = 0;
    frames = 0;
    recovery = 0;
  }

  return {
    get ratio(): number { return ratio; },
    reset,
    frame(deltaSeconds: number): number | null {
      // A background tab, page suspension, or debugger pause is not GPU load.
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || deltaSeconds > 0.12) {
        reset();
        return null;
      }
      seconds += deltaSeconds;
      frames++;
      if (seconds < SAMPLE_SECONDS) return null;
      const averageMs = seconds * 1000 / frames;
      const windowSeconds = seconds;
      seconds = 0;
      frames = 0;
      // 19 ms gives a little tolerance for 60 Hz scheduling jitter. Drop
      // pixel work aggressively until the compositor makes its deadlines.
      if (averageMs > TARGET_MS + 2.3 && ratio > MIN_VIEWER_PIXEL_RATIO) {
        ratio = Math.max(MIN_VIEWER_PIXEL_RATIO, Math.round(ratio * 0.82 * 100) / 100);
        recovery = 0;
        return ratio;
      }
      // Only probe higher detail after sustained 60 Hz frames. Slow recovery
      // and smaller increments avoid a visible high/low resolution oscillation.
      if (averageMs <= TARGET_MS + 0.8 && ratio < cap) {
        recovery += windowSeconds;
        if (recovery >= RECOVERY_SECONDS) {
          ratio = Math.min(cap, Math.round((ratio + 0.06) * 100) / 100);
          recovery = 0;
          return ratio;
        }
      } else {
        recovery = 0;
      }
      return null;
    },
  };
}
