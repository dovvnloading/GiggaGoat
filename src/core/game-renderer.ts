import { WebGLRenderer } from 'three';
import type { SoftwareGameRenderer } from './SoftwareGameRenderer';

export type GameRenderer = WebGLRenderer | SoftwareGameRenderer;
export class GameCanvasUnavailableError extends Error {}

function tryWebGL(powerPreference: WebGLPowerPreference, antialias: boolean): WebGLRenderer | null {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { alpha: true, antialias, powerPreference });
    if (!context || context.isContextLost() || !context.getContextAttributes()) return null;
    return new WebGLRenderer({ canvas, context });
  } catch (error) {
    console.warn('Gigga-Goat could not initialize the requested WebGL context.', error);
    return null;
  }
}

/** Request the context before loading the island and give Three the same canvas and context. */
export async function createGameRenderer(): Promise<GameRenderer> {
  const renderer = tryWebGL('high-performance', true) ?? tryWebGL('low-power', false);
  if (renderer) return renderer;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new GameCanvasUnavailableError('No canvas rendering context is available');
  const [{ SoftwareGameRenderer }, { SoftwareRaster }] = await Promise.all([
    import('./SoftwareGameRenderer'), import('./SoftwareRaster'),
  ]);
  const raster = await SoftwareRaster.create();
  canvas.dataset.renderBackend = raster ? 'software-simd' : 'software';
  return new SoftwareGameRenderer(canvas, context, raster);
}
