import {
  GRAPHICS_PRESETS, qualityPixelRatio, type GraphicsQuality,
} from './GraphicsQuality';

/**
 * Hysteretic, time-based resolution controller. Render/frame times are sampled
 * after the actual WebGL submission; no performance or browser globals here.
 * Returns a new ratio only when a resize is justified (never every frame).
 */
export class AdaptiveResolution {
  private maxRatio: number;
  private minRatio: number;
  private ratioValue: number;
  private slowSeconds = 0;
  private fastSeconds = 0;
  private warmupSeconds = 0;
  private cooldownSeconds = 0;

  constructor(quality: GraphicsQuality, dpr: number) {
    this.maxRatio = qualityPixelRatio(quality, dpr);
    this.minRatio = Math.min(this.maxRatio, GRAPHICS_PRESETS[quality].minPixelRatio);
    this.ratioValue = this.maxRatio;
  }

  get ratio(): number { return this.ratioValue; }
  get maximum(): number { return this.maxRatio; }
  get minimum(): number { return this.minRatio; }

  configure(quality: GraphicsQuality, dpr: number): number {
    this.maxRatio = qualityPixelRatio(quality, dpr);
    this.minRatio = Math.min(this.maxRatio, GRAPHICS_PRESETS[quality].minPixelRatio);
    this.ratioValue = this.maxRatio;
    this.slowSeconds = this.fastSeconds = this.warmupSeconds = this.cooldownSeconds = 0;
    return this.ratioValue;
  }

  /** Paused/hidden frames and huge tab-resume deltas must not drive adaptation. */
  sample(frameMs: number, renderMs: number, dt: number, active = true): number | null {
    if (!active || !Number.isFinite(dt) || dt <= 0 || dt > 0.25 ||
        !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250 ||
        !Number.isFinite(renderMs) || renderMs < 0) return null;
    this.warmupSeconds += dt;
    if (this.warmupSeconds < 0.75) return null;
    this.cooldownSeconds = Math.max(0, this.cooldownSeconds - dt);
    const overloaded = frameMs > 18.5 || renderMs > 15.5;
    // A healthy 60 Hz display produces ~16.7 ms intervals even with GPU headroom.
    const headroom = frameMs < 17.25 && renderMs < 9.5;
    this.slowSeconds = overloaded ? this.slowSeconds + dt : Math.max(0, this.slowSeconds - 2 * dt);
    this.fastSeconds = headroom ? this.fastSeconds + dt : Math.max(0, this.fastSeconds - 2 * dt);
    if (this.cooldownSeconds > 0) return null;
    let next = this.ratioValue;
    if (this.slowSeconds >= 1.25) {
      next = Math.max(this.minRatio, Math.round((next - 0.125) * 1000) / 1000);
      this.cooldownSeconds = 1.5;
    } else if (this.fastSeconds >= 3) {
      next = Math.min(this.maxRatio, Math.round((next + 0.0625) * 1000) / 1000);
      this.cooldownSeconds = 2;
    }
    if (next === this.ratioValue) return null;
    this.ratioValue = next;
    this.slowSeconds = this.fastSeconds = 0;
    return next;
  }
}
