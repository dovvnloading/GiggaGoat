import { afterEach, expect, it, vi } from 'vitest';
import { createGameRenderer, GameCanvasUnavailableError } from './game-renderer';

const { constructRenderer } = vi.hoisted(() => ({
  constructRenderer: vi.fn(function () {}),
}));
vi.mock('three', async importOriginal => ({
  ...await importOriginal<typeof import('three')>(), WebGLRenderer: constructRenderer,
}));

const usableContext = {
  isContextLost: () => false,
  getContextAttributes: () => ({ alpha: true }),
};

function mockCanvases(...contexts: unknown[]) {
  const canvases = contexts.map(context => ({ dataset: {}, getContext: vi.fn(() => context) }));
  const createElement = vi.fn(() => canvases.shift());
  vi.stubGlobal('document', { createElement });
  return { createElement, first: canvases[0]!, fallback: canvases[1] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  constructRenderer.mockClear();
});

it('constructs Three from the first usable context without a second canvas', async () => {
  const { createElement, first } = mockCanvases(usableContext);
  await createGameRenderer();
  expect(createElement).toHaveBeenCalledExactlyOnceWith('canvas');
  expect(first.getContext).toHaveBeenCalledExactlyOnceWith('webgl2',
    { alpha: true, antialias: true, powerPreference: 'high-performance' });
  expect(constructRenderer).toHaveBeenCalledExactlyOnceWith({ canvas: first, context: usableContext });
});

it('tries a fresh low-power canvas when the first context is already lost', async () => {
  const { createElement, fallback } = mockCanvases({ isContextLost: () => true }, usableContext);
  await createGameRenderer();
  expect(createElement).toHaveBeenCalledTimes(2);
  expect(fallback!.getContext).toHaveBeenCalledExactlyOnceWith('webgl2',
    { alpha: true, antialias: false, powerPreference: 'low-power' });
  expect(constructRenderer).toHaveBeenCalledExactlyOnceWith({ canvas: fallback, context: usableContext });
});

it('starts the software renderer when the browser denies both WebGL contexts', async () => {
  const { createElement } = mockCanvases(null, null, {});
  const renderer = await createGameRenderer();
  expect(renderer).toHaveProperty('isSoftwareRenderer', true);
  expect(createElement).toHaveBeenCalledTimes(3);
  expect(constructRenderer).not.toHaveBeenCalled();
});

it('reports a startup failure when the browser denies every drawing surface', async () => {
  const { createElement } = mockCanvases(null, null, null);
  await expect(createGameRenderer()).rejects.toThrow(GameCanvasUnavailableError);
  expect(createElement).toHaveBeenCalledTimes(3);
  expect(constructRenderer).not.toHaveBeenCalled();
});
