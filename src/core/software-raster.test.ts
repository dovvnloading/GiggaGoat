import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { SoftwareFrame, pixel } from './SoftwareFrame';
import { SoftwareRaster } from './SoftwareRaster';

it('shares depth between accelerated and clipped passes and retains painted gradients', async () => {
  const bytes = await readFile(new URL('./software-raster.wasm', import.meta.url));
  const memory = new WebAssembly.Memory({ initial: 1 });
  const { instance } = await WebAssembly.instantiate(new Uint8Array(bytes), { env: { memory } });
  const backend = new SoftwareRaster(memory, instance.exports.drawBatch as ConstructorParameters<typeof SoftwareRaster>[1],
    instance.exports.projectBatch as ConstructorParameters<typeof SoftwareRaster>[2]);
  const { colour, depth } = backend.resize(64, 64);
  const image = { width: 64, height: 64, data: colour } as ImageData;
  const frame = new SoftwareFrame(image, depth);
  frame.clear(0, 0);
  const points = [[8, 55], [56, 55], [32, 8], [32, 8]] as const;
  const colours = [pixel(0, 255, 0), pixel(255, 0, 0), pixel(0, 0, 255), 0];
  points.forEach(([x, y], i) => {
    backend.vertices.set([x, y, .5], i * 5);
    backend.vertexBits[i * 5 + 3] = i === 3 ? 16 : 0;
    backend.vertexBits[i * 5 + 4] = colours[i]!;
  });
  expect([...backend.draw(Uint32Array.of(0, 1, 2, 0, 1, 3), undefined, 0, 1)]).toEqual([1]);
  expect(frame.depth[32 * 64 + 32]).toBeCloseTo(.5);
  expect(new Set(frame.pixels.subarray(45 * 64 + 17, 45 * 64 + 47)).size).toBeGreaterThan(22);
  const original = frame.pixels.slice();
  const p = (x: number, y: number) => ({ x, y, w: 4, u: 0, v: 0 });
  frame.triangle(p(-1, -1), p(1, -1), p(0, 1), .1, pixel(255, 255, 255), undefined, 2, 1);
  expect(frame.pixels).toEqual(original);
  backend.vertices[2] = backend.vertices[7] = backend.vertices[12] = 1;
  backend.draw(Uint32Array.of(0, 1, 2), Uint32Array.of(pixel(250, 180, 10)), 0, 1);
  expect(frame.pixels[32 * 64 + 32]).toBe(pixel(250, 180, 10) >>> 0);

  frame.clear(0, 0);
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0];
  backend.project(Float32Array.of(-.75, -.5, 2, .75, -.5, 2, 0, .75, 2, 0, 0, .05),
    matrix, .1, Uint32Array.from(colours));
  expect([...backend.vertices.slice(0, 3)]).toEqual([20, 40, .5]);
  expect(backend.vertexBits[18]).toBe(16);
  expect(backend.clipCoordinates[11]).toBeCloseTo(.05);
  expect([...backend.draw(Uint32Array.of(0, 1, 2, 0, 1, 3), undefined, 0, 1)]).toEqual([1]);
  expect(frame.depth[32 * 64 + 32]).toBeCloseTo(.5);
  expect(new Set(frame.pixels.subarray(37 * 64 + 26, 37 * 64 + 39)).size).toBe(13);
});
