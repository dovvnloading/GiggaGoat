/** Projected positions remain homogeneous until the triangle has been clipped. */
export interface ClipVertex { x: number; y: number; w: number; u: number; v: number }
export interface SoftwareTexture {
  pixels: Uint8ClampedArray; width: number; height: number;
  flipY: boolean; repeatU: boolean; repeatV: boolean;
}

interface ScreenVertex { x: number; y: number; iz: number; uz: number; vz: number }

export function pixel(r: number, g: number, b: number): number {
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

/** Colour and reciprocal-depth buffers shared by terrain, characters, props and water. */
export class SoftwareFrame {
  readonly pixels: Uint32Array;
  readonly depth: Float32Array;
  private readonly screen: ScreenVertex[] = Array.from({ length: 3 },
    () => ({ x: 0, y: 0, iz: 0, uz: 0, vz: 0 }));
  private readonly clipped: ClipVertex[] = Array.from({ length: 4 },
    () => ({ x: 0, y: 0, w: 1, u: 0, v: 0 }));

  constructor(readonly image: ImageData) {
    this.pixels = new Uint32Array(image.data.buffer, image.data.byteOffset, image.data.length / 4);
    this.depth = new Float32Array(this.pixels.length);
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
        const t = (near - previous.w) / (current.w - previous.w);
        v.x = previous.x + (current.x - previous.x) * t;
        v.y = previous.y + (current.y - previous.y) * t;
        v.w = near;
        v.u = previous.u + (current.u - previous.u) * t;
        v.v = previous.v + (current.v - previous.v) * t;
      }
      if (current.w >= near) Object.assign(this.clipped[count++]!, current);
      previous = current;
    }
    for (let i = 1; i < count - 1; i++) {
      this.draw(this.clipped[0]!, this.clipped[i]!, this.clipped[i + 1]!, colour, texture, side, bias);
    }
  }

  private project(v: ClipVertex, target: ScreenVertex): ScreenVertex {
    const iz = 1 / v.w;
    target.x = (.5 + .5 * v.x * iz) * this.image.width;
    target.y = (.5 - .5 * v.y * iz) * this.image.height;
    target.iz = iz;
    target.uz = v.u * iz;
    target.vz = v.v * iz;
    return target;
  }

  private draw(a: ClipVertex, b: ClipVertex, c: ClipVertex, colour: number,
    texture: SoftwareTexture | undefined, side: number, bias: number): void {
    let top = this.project(a, this.screen[0]!);
    let middle = this.project(b, this.screen[1]!);
    let bottom = this.project(c, this.screen[2]!);
    const abx = middle.x - top.x, aby = middle.y - top.y;
    const acx = bottom.x - top.x, acy = bottom.y - top.y;
    const det = abx * acy - aby * acx;
    if (Math.abs(det) < .02 || (side === 0 && det > 0) || (side === 1 && det < 0)) return;
    const dz = ((middle.iz - top.iz) * acy - (bottom.iz - top.iz) * aby) / det;
    const du = ((middle.uz - top.uz) * acy - (bottom.uz - top.uz) * aby) / det;
    const dv = ((middle.vz - top.vz) * acy - (bottom.vz - top.vz) * aby) / det;
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
      let uz = top.uz + (bottom.uz - top.uz) * t + offset * du;
      let vz = top.vz + (bottom.vz - top.vz) * t + offset * dv;
      let i = y * width + first;
      for (let x = first; x < last; x++, i++, iz += dz, uz += du, vz += dv) {
        const depth = iz * bias;
        if (depth <= this.depth[i]!) continue;
        let value = colour;
        if (texture) {
          let u = uz / iz, v = vz / iz;
          u = texture.repeatU ? u - Math.floor(u) : Math.min(1, Math.max(0, u));
          v = texture.repeatV ? v - Math.floor(v) : Math.min(1, Math.max(0, v));
          const tx = Math.min(texture.width - 1, Math.floor(u * texture.width));
          const ty = Math.min(texture.height - 1, Math.floor((texture.flipY ? 1 - v : v) * texture.height));
          const k = 4 * (ty * texture.width + tx);
          const texels = texture.pixels;
          if (texels[k + 3]! < 96) continue;
          value = pixel(red * texels[k]! / 255, green * texels[k + 1]! / 255,
            blue * texels[k + 2]! / 255);
        }
        this.depth[i] = depth;
        this.pixels[i] = value;
      }
    }
  }
}
