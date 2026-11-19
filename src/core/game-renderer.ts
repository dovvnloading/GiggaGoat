import { WebGLRenderer } from 'three';

export class WebGLUnavailableError extends Error {}

function requestContext(powerPreference: WebGLPowerPreference, antialias: boolean) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { alpha: true, antialias, powerPreference });
  return context && !context.isContextLost() && context.getContextAttributes()
    ? { canvas, context }
    : null;
}

/** Request the context before loading the island and give Three the same canvas and context. */
export function createGameRenderer(): WebGLRenderer {
  const target = requestContext('high-performance', true) ?? requestContext('low-power', false);
  if (!target) throw new WebGLUnavailableError('Could not create a WebGL 2 context');
  return new WebGLRenderer(target);
}
