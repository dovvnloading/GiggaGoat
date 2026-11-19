import { afterEach, expect, it, vi } from 'vitest';
import { createGameRenderer, WebGLUnavailableError } from './game-renderer';

const { constructRenderer } = vi.hoisted(() => ({
  constructRenderer: vi.fn(function () {}),
}));
vi.mock('three', () => ({ WebGLRenderer: constructRenderer }));

const usableContext = {
  isContextLost: () => false,
  getContextAttributes: () => ({ alpha: true }),
};

function mockCanvases(...contexts: unknown[]) {
  const canvases = contexts.map(context => ({ getContext: vi.fn(() => context) }));
  const createElement = vi.fn(() => canvases.shift());
  vi.stubGlobal('document', { createElement });
  return { createElement, first: canvases[0]!, fallback: canvases[1] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  constructRenderer.mockClear();
});

it('constructs Three from the first usable context without a second canvas', () => {
  const { createElement, first } = mockCanvases(usableContext);
  createGameRenderer();
  expect(createElement).toHaveBeenCalledExactlyOnceWith('canvas');
  expect(first.getContext).toHaveBeenCalledExactlyOnceWith('webgl2',
    { alpha: true, antialias: true, powerPreference: 'high-performance' });
  expect(constructRenderer).toHaveBeenCalledExactlyOnceWith({ canvas: first, context: usableContext });
});

it('tries a fresh low-power canvas when the first context is already lost', () => {
  const { createElement, fallback } = mockCanvases({ isContextLost: () => true }, usableContext);
  createGameRenderer();
  expect(createElement).toHaveBeenCalledTimes(2);
  expect(fallback!.getContext).toHaveBeenCalledExactlyOnceWith('webgl2',
    { alpha: true, antialias: false, powerPreference: 'low-power' });
  expect(constructRenderer).toHaveBeenCalledExactlyOnceWith({ canvas: fallback, context: usableContext });
});

it('reports unavailable WebGL 2 after two failed requests and never constructs Three', () => {
  const { createElement } = mockCanvases(null, null);
  expect(() => createGameRenderer()).toThrow(WebGLUnavailableError);
  expect(createElement).toHaveBeenCalledTimes(2);
  expect(constructRenderer).not.toHaveBeenCalled();
});
