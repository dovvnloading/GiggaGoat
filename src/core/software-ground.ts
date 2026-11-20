import { blendFieldIndex, groundBlendField } from '../world/ground-blend';

export interface SoftwareGroundLayers {
  a: Uint8ClampedArray; b: Uint8ClampedArray; c: Uint8ClampedArray; edge: Uint8ClampedArray;
  mix: { value: number }; cache?: GroundMipCache;
}

export interface GroundMipCache {
  side: number; blocksAcross: number; keys: Uint32Array; blocks: (Uint32Array | undefined)[];
}

export function mipCache(layers: SoftwareGroundLayers, width: number) {
  if (!layers.cache) {
    const side = Math.max(32, width);
    layers.cache = { side, blocksAcross: Math.ceil(side / 16), keys: new Uint32Array(512), blocks: [] };
  }
  return layers.cache;
}

/** Resolve coherent 16 × 16 blocks on demand. The fourth byte carries the verge
 * mask. At most 512 KiB of colour blocks stay resident per visible material mip. */
export function groundBlock(cache: GroundMipCache, key: number, layers: SoftwareGroundLayers,
  base: Uint8ClampedArray, width: number, flipY: boolean, tile: number, x: number, y: number): Uint32Array {
  const slot = (key ^ Math.imul(key >>> 9, 59)) & 511;
  const block = cache.blocks[slot] ??= new Uint32Array(256);
  if (cache.keys[slot] === key + 1) return block;
  const side = cache.side, scale = width / side, tileX = tile & 7, tileY = tile >>> 3;
  const left = x & ~15, top = y & ~15;
  const field = groundBlendField;
  for (let row = 0; row < 16; row++) {
    const py = top + row, v = (py + .5) / side;
    const fy = tileY + (flipY ? 1 - v : v);
    const scan = Math.min(width - 1, Math.floor((py + .5) * scale)) * width;
    for (let col = 0; col < 16; col++) {
      const px = left + col, f = blendFieldIndex(tileX + (px + .5) / side, fy);
      const s = field[f]!, t = field[f+1]!, i = 4 * (scan + Math.min(width - 1, Math.floor((px + .5) * scale)));
      let r: number, g: number, b: number;
      if ((s === 0 || s === 255) && (t === 0 || t === 255)) {
        const source = t === 0 ? (s === 0 ? base : layers.a) : (s === 0 ? layers.b : layers.c);
        r = source[i]!; g = source[i+1]!; b = source[i+2]!;
      } else {
        const wa = s * (255 - t), wb = (255 - s) * t, wc = s * t, w0 = (255 - s) * (255 - t);
        r = (base[i]! * w0 + layers.a[i]! * wa + layers.b[i]! * wb + layers.c[i]! * wc) / 65025;
        g = (base[i+1]! * w0 + layers.a[i+1]! * wa + layers.b[i+1]! * wb + layers.c[i+1]! * wc) / 65025;
        b = (base[i+2]! * w0 + layers.a[i+2]! * wa + layers.b[i+2]! * wb + layers.c[i+2]! * wc) / 65025;
      }
      block[16 * row + col] = ((r + .5) | 0) | (((g + .5) | 0) << 8) | (((b + .5) | 0) << 16) | (field[f+2]! << 24);
    }
  }
  cache.keys[slot] = key + 1;
  return block;
}
