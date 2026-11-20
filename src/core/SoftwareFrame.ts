import { groundBlock, mipCache, type SoftwareGroundLayers } from './software-ground';

/** Projected positions remain homogeneous until the triangle has been clipped. */
export interface ClipVertex {
  x: number; y: number; w: number; u: number; v: number;
  opacity?: number; tint?: number; screen?: ScreenVertex;
}
export interface SoftwareTexture {
  pixels: Uint8ClampedArray; width: number; height: number;
  mipmaps?: SoftwareTexture[];
  finish?: SoftwareGroundLayers;
  flipY: boolean; repeatU: boolean; repeatV: boolean;
}

interface ScreenVertex { x: number; y: number; iz: number; uz: number; vz: number; opacity: number; r: number; g: number; b: number }

export function pixel(r: number, g: number, b: number): number {
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

/** Colour and reciprocal-depth buffers shared by terrain, characters, props and water. */
export class SoftwareFrame {
  readonly pixels: Uint32Array;
  readonly depth: Float32Array;
  private readonly screen: ScreenVertex[] = Array.from({ length: 3 },
    () => ({ x: 0, y: 0, iz: 0, uz: 0, vz: 0, opacity: 1, r: 0, g: 0, b: 0 }));
  private readonly clipped: ClipVertex[] = Array.from({ length: 4 },
    () => ({ x: 0, y: 0, w: 1, u: 0, v: 0 }));

  constructor(readonly image: ImageData, depth?: Float32Array) {
    this.pixels = new Uint32Array(image.data.buffer, image.data.byteOffset, image.data.length / 4);
    this.depth = depth ?? new Float32Array(this.pixels.length);
  }

  clear(horizon: number, zenith: number): void {
    this.depth.fill(0);
    const { width, height } = this.image;
    const r = horizon >> 16, g = horizon >> 8 & 255, b = horizon & 255;
    for (let y = 0; y < height; y++) {
      const t = Math.max(0, 1 - y / (height * .65));
      this.pixels.fill(pixel(r + ((zenith >> 16) - r) * t,
        g + ((zenith >> 8 & 255) - g) * t, b + ((zenith & 255) - b) * t),
      y * width, (y + 1) * width);
    }
  }

  triangle(a: ClipVertex, b: ClipVertex, c: ClipVertex, near: number, colour: number,
    texture: SoftwareTexture | undefined, side: number, bias: number): void {
    if ((a.w < near && b.w < near && c.w < near) ||
        (a.x < -a.w && b.x < -b.w && c.x < -c.w) ||
        (a.x > a.w && b.x > b.w && c.x > c.w) ||
        (a.y < -a.w && b.y < -b.w && c.y < -c.w) ||
        (a.y > a.w && b.y > b.w && c.y > c.w)) return;
    if (a.w >= near && b.w >= near && c.w >= near) {
      this.draw(a, b, c, colour, texture, side, bias);
      return;
    }
    let count = 0, previous = c;
    for (const current of [a, b, c]) {
      if ((previous.w < near) !== (current.w < near)) {
        const v = this.clipped[count++]!;
        v.screen = undefined;
        const t = (near - previous.w) / (current.w - previous.w);
        v.x = previous.x + (current.x - previous.x) * t;
        v.y = previous.y + (current.y - previous.y) * t;
        v.w = near;
        v.opacity = previous.opacity === undefined || current.opacity === undefined ? undefined :
          previous.opacity + (current.opacity - previous.opacity) * t;
        v.u = previous.u + (current.u - previous.u) * t;
        v.v = previous.v + (current.v - previous.v) * t;
        if (previous.tint !== undefined && current.tint !== undefined) {
          const from = previous.tint, to = current.tint;
          v.tint = pixel((from & 255) * (1 - t) + (to & 255) * t,
            (from >>> 8 & 255) * (1 - t) + (to >>> 8 & 255) * t,
            (from >>> 16 & 255) * (1 - t) + (to >>> 16 & 255) * t);
        } else v.tint = undefined;
      }
      if (current.w >= near) {
        const vertex = this.clipped[count++]!;
        Object.assign(vertex, current);
        vertex.screen = current.screen;
        vertex.tint = current.tint;
        vertex.opacity = current.opacity;
      }
      previous = current;
    }
    for (let i = 1; i < count - 1; i++) {
      this.draw(this.clipped[0]!, this.clipped[i]!, this.clipped[i + 1]!, colour, texture, side, bias);
    }
  }

  prepare(v: ClipVertex): void {
    const screen = v.screen ?? (v.screen = { x: 0, y: 0, iz: 0, uz: 0, vz: 0, opacity: 1, r: 0, g: 0, b: 0 });
    this.project(v, screen);
  }

  private project(v: ClipVertex, target: ScreenVertex): ScreenVertex {
    const iz = 1 / v.w;
    target.x = (.5 + .5 * v.x * iz) * this.image.width;
    target.y = (.5 - .5 * v.y * iz) * this.image.height;
    target.iz = iz;
    target.opacity = (v.opacity ?? 1) * iz;
    target.uz = v.u * iz;
    target.vz = v.v * iz;
    if (v.tint !== undefined) {
      target.r = v.tint & 255; target.g = v.tint >>> 8 & 255; target.b = v.tint >>> 16 & 255;
    }
    return target;
  }

  private draw(a: ClipVertex, b: ClipVertex, c: ClipVertex, colour: number,
    texture: SoftwareTexture | undefined, side: number, bias: number): void {
    let top = a.screen ?? this.project(a, this.screen[0]!);
    let middle = b.screen ?? this.project(b, this.screen[1]!);
    let bottom = c.screen ?? this.project(c, this.screen[2]!);
    const abx = middle.x - top.x, aby = middle.y - top.y;
    const acx = bottom.x - top.x, acy = bottom.y - top.y;
    const det = abx * acy - aby * acx;
    if (Math.abs(det) < .02 || (side === 0 && det > 0) || (side === 1 && det < 0)) return;
    const dz = ((middle.iz - top.iz) * acy - (bottom.iz - top.iz) * aby) / det;
    const du = ((middle.uz - top.uz) * acy - (bottom.uz - top.uz) * aby) / det;
    const dv = ((middle.vz - top.vz) * acy - (bottom.vz - top.vz) * aby) / det;
    if (texture?.mipmaps?.length) {
      // UVs are perspective-correct. Estimate their footprint at the triangle centre
      // to band-limit high-frequency ground artwork in the distance.
      const iz = (top.iz + middle.iz + bottom.iz) / 3;
      const u = (top.uz + middle.uz + bottom.uz) / (3 * iz);
      const v = (top.vz + middle.vz + bottom.vz) / (3 * iz);
      const dzdy = (abx * (bottom.iz - top.iz) - acx * (middle.iz - top.iz)) / det;
      const dudy = (abx * (bottom.uz - top.uz) - acx * (middle.uz - top.uz)) / det;
      const dvdy = (abx * (bottom.vz - top.vz) - acx * (middle.vz - top.vz)) / det;
      const footprint = Math.max(
        Math.hypot((du - u * dz) * texture.width, (dv - v * dz) * texture.height),
        Math.hypot((dudy - u * dzdy) * texture.width, (dvdy - v * dzdy) * texture.height)) / iz;
      const level = Math.min(texture.mipmaps.length, Math.floor(Math.log2(Math.max(1, footprint))));
      if (level > 0) texture = texture.mipmaps[level - 1]!;
    }
    const finish = texture?.finish;
    const cache = finish && texture ? mipCache(finish, texture.width) : undefined;
    let previousBlock = -1, block: Uint32Array | undefined;
    const coverage = a.opacity !== undefined;
    const da = coverage ? ((middle.opacity - top.opacity) * acy - (bottom.opacity - top.opacity) * aby) / det : 0;
    const smooth = a.tint !== undefined && b.tint !== undefined && c.tint !== undefined;
    const dr = smooth ? ((middle.r - top.r) * acy - (bottom.r - top.r) * aby) / det : 0;
    const dg = smooth ? ((middle.g - top.g) * acy - (bottom.g - top.g) * aby) / det : 0;
    const db = smooth ? ((middle.b - top.b) * acy - (bottom.b - top.b) * aby) / det : 0;
    if (top.y > middle.y) [top, middle] = [middle, top];
    if (middle.y > bottom.y) [middle, bottom] = [bottom, middle];
    if (top.y > middle.y) [top, middle] = [middle, top];
    const fullHeight = bottom.y - top.y;
    if (fullHeight <= 0) return;
    const { width, height } = this.image;
    const endY = Math.min(height, Math.ceil(bottom.y - .5));
    const red = colour & 255, green = colour >>> 8 & 255, blue = colour >>> 16 & 255;
    for (let y = Math.max(0, Math.ceil(top.y - .5)); y < endY; y++) {
      const sy = y + .5;
      const t = (sy - top.y) / fullHeight;
      const x1 = top.x + (bottom.x - top.x) * t;
      const start = sy < middle.y ? top : middle, end = sy < middle.y ? middle : bottom;
      const x2 = start.x + (end.x - start.x) * (sy - start.y) / (end.y - start.y);
      const first = Math.max(0, Math.ceil(Math.min(x1, x2) - .5));
      const last = Math.min(width, Math.ceil(Math.max(x1, x2) - .5));
      const offset = first + .5 - x1;
      let iz = top.iz + (bottom.iz - top.iz) * t + offset * dz;
      let i = y * width + first;
      const endIndex = y * width + last;
      if (!texture) {
        const depths = this.depth, pixels = this.pixels, step = dz * bias;
        if (coverage) {
          let alphaZ = top.opacity + (bottom.opacity - top.opacity) * t + offset * da;
          for (; i < endIndex; i++, iz += dz, alphaZ += da) {
            if (iz * bias <= depths[i]!) continue;
            const alpha = Math.min(1, Math.max(0, alphaZ / iz)), keep = 1 - alpha;
            const bg = pixels[i]!;
            pixels[i] = pixel((bg & 255) * keep + red * alpha,
              (bg >>> 8 & 255) * keep + green * alpha,
              (bg >>> 16 & 255) * keep + blue * alpha);
          }
          continue;
        }
        if (smooth) {
          let r = top.r + (bottom.r - top.r) * t + offset * dr;
          let g = top.g + (bottom.g - top.g) * t + offset * dg;
          let b = top.b + (bottom.b - top.b) * t + offset * db;
          for (let depth = iz * bias; i < endIndex; i++, depth += step, r += dr, g += dg, b += db) {
            if (depth > depths[i]!) { depths[i] = depth; pixels[i] = pixel(r, g, b); }
          }
          continue;
        }
        for (let depth = iz * bias; i < endIndex; i++, depth += step) {
          if (depth > depths[i]!) { depths[i] = depth; pixels[i] = colour; }
        }
        continue;
      }
      let uz = top.uz + (bottom.uz - top.uz) * t + offset * du;
      let vz = top.vz + (bottom.vz - top.vz) * t + offset * dv;
      let alphaZ = top.opacity + (bottom.opacity - top.opacity) * t + offset * da;
      for (; i < endIndex; i++, iz += dz, uz += du, vz += dv, alphaZ += da) {
        const depth = iz * bias;
        if (depth <= this.depth[i]!) continue;
        let u = uz / iz, v = vz / iz;
        const tu = Math.floor(u), tv = Math.floor(v);
        u = texture.repeatU ? u - tu : Math.min(1, Math.max(0, u));
        v = texture.repeatV ? v - tv : Math.min(1, Math.max(0, v));
        const tx = Math.min(texture.width - 1, Math.floor(u * texture.width));
        const ty = Math.min(texture.height - 1, Math.floor((texture.flipY ? 1 - v : v) * texture.height));
        const k = 4 * (ty * texture.width + tx);
        const texels = texture.pixels;
        if (texels[k + 3]! < 96) continue;
        let alpha = coverage ? Math.min(1, Math.max(0, alphaZ / iz)) : 1;
        let r = texels[k]!, g = texels[k + 1]!, b = texels[k + 2]!;
        if (finish && cache) {
          const sx = cache.side === texture.width ? tx : Math.min(cache.side - 1, Math.floor(u * cache.side));
          const sy = cache.side === texture.height ? ty : Math.min(cache.side - 1, Math.floor((texture.flipY ? 1 - v : v) * cache.side));
          const tile = ((tv & 7) << 3) | (tu & 7);
          const key = (tile * cache.blocksAcross + (sy >> 4)) * cache.blocksAcross + (sx >> 4);
          if (key !== previousBlock) {
            block = groundBlock(cache, key, finish, texels, texture.width, texture.flipY, tile, sx, sy);
            previousBlock = key;
          }
          const rgb = block![((sy & 15) << 4) + (sx & 15)]!;
          let ir = rgb & 255, ig = (rgb >>> 8) & 255, ib = (rgb >>> 16) & 255;
          if (coverage && alpha < .84) {
            const edge = alpha + ((rgb >>> 24) / 255 - .5) * .22;
            const x = Math.min(1, Math.max(0, (edge - .22) / .51));
            const interior = x * x * (3 - 2 * x);
            const er = finish.edge[k]!, eg = finish.edge[k+1]!, eb = finish.edge[k+2]!;
            const stone = Math.min(.55, Math.max(-.55, (.35 - eg / Math.max(1, er + eg + eb)) * 10));
            alpha *= 1 + finish.mix.value * (1 - alpha) * (1 - interior) * stone * 1.35;
            ir = er + (ir - er) * interior;
            ig = eg + (ig - eg) * interior;
            ib = eb + (ib - eb) * interior;
          }
          const fade = finish.mix.value;
          if (fade === 1) { r = ir; g = ig; b = ib; }
          else { r += (ir - r) * fade; g += (ig - g) * fade; b += (ib - b) * fade; }
        }
        if (coverage) {
          const bg = this.pixels[i]!, keep = 1 - alpha, gain = alpha / 255;
          this.pixels[i] = pixel((bg & 255) * keep + red * r * gain,
            (bg >>> 8 & 255) * keep + green * g * gain,
            (bg >>> 16 & 255) * keep + blue * b * gain);
          continue;
        }
        this.depth[i] = depth;
        this.pixels[i] = pixel(red * r / 255, green * g / 255, blue * b / 255);
      }
    }
  }
}
