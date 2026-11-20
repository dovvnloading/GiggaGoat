import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { districtMaterials, groundLayers } from './district-materials';
import { blendFieldIndex, blendPeriod, blendSize, groundBlendField } from './ground-blend';
import { SoftwareFrame, pixel, type SoftwareTexture } from '../core/SoftwareFrame';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('ships a distinct base, three alternatives and a shoulder for each district', () => {
  const hashes = new Set<string>();
  for (const name of ['hoofington', 'baa-ardwalk', 'crane-yard', 'downtown-bleatsville',
    'mt-gigga', 'whispering-pines', 'the-dam', 'old-lighthouse']) {
    for (const suffix of ['', '-a', '-b', '-c', '-edge']) {
      const file = readFileSync('public/assets/terrain/' + name + suffix + '.webp');
      expect(file.toString('ascii', 8, 12)).toBe('WEBP');
      hashes.add(createHash('sha256').update(file).digest('hex'));
    }
  }
  expect(hashes.size).toBe(40);
});

it('publishes a complete set together, fades it in, and releases it outside the district', async () => {
  vi.stubGlobal('document', { createElementNS: () => ({}) });
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture({ width: 1 } as HTMLImageElement));
  const loader = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new THREE.Texture());
  const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
  const library = districtMaterials(), material = new THREE.MeshBasicMaterial();
  try {
    library.applyMap(material, 'the-dam');
    const layers = groundLayers.get(material.map!)!;
    expect(loader).not.toHaveBeenCalled();
    library.distance('the-dam', 42); library.update();
    expect(layers.maps).toBeUndefined();
    await vi.waitFor(() => expect(layers.maps).toHaveLength(4));
    expect(layers.mix.value).toBe(0);
    expect(loader.mock.calls.map(([url]) => url.split('/').pop())).toEqual(
      ['the-dam-a.webp', 'the-dam-b.webp', 'the-dam-c.webp', 'the-dam-edge.webp']);
    now.mockReturnValue(1620);
    library.distance('the-dam', 42);
    expect(layers.mix.value).toBe(1);
    const disposals = layers.maps!.map(t => vi.spyOn(t, 'dispose'));
    library.distance('the-dam', 180);
    expect(layers.maps).toBeUndefined();
    expect(disposals.every(spy => spy.mock.calls.length === 1)).toBe(true);
  } finally { library.dispose(); }
});

it('selects all four interiors and tapers into the fifth material at the shoulder', () => {
  const rgba = (n: number) => Uint8ClampedArray.of(n, n, n, 255);
  const surface: SoftwareTexture = { width: 1, height: 1, flipY: false, repeatU: true, repeatV: true,
    pixels: rgba(20), finish: { a: rgba(68), b: rgba(121), c: rgba(165), edge: rgba(225), mix: { value: 1 } } };
  const frame = new SoftwareFrame({ data: new Uint8ClampedArray(36), width: 3, height: 3 } as ImageData);
  function draw(i: number, opacity: number) {
    const u = ((i / 4) % blendSize + .5) * blendPeriod / blendSize;
    const v = (Math.floor(i / (4 * blendSize)) + .5) * blendPeriod / blendSize;
    expect(blendFieldIndex(u - blendPeriod, v + blendPeriod)).toBe(i);
    const point = (x: number, y: number) => ({ x, y, w: 1, u, v, opacity });
    frame.clear(0, 0);
    frame.triangle(point(-1, -1), point(1, -1), point(-1, 1), .1, pixel(255, 255, 255), surface, 2, 1);
    return frame.pixels[6]! & 255;
  }
  for (const [s, t, intensity] of [[0, 0, 20], [255, 0, 68], [0, 255, 121], [255, 255, 165]]) {
    const i = groundBlendField.findIndex((value, k) => k % 4 === 0 && value === s && groundBlendField[k + 1] === t);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(draw(i, 1)).toBe(intensity);
    expect(draw(i, .1)).toBe(27);
  }
});
