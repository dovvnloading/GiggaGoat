import * as THREE from 'three';
import type { Vec3Like } from './dustMath';
import {
  HEADBUTT_STAR_COUNT, makeHeadbuttBurst, sampleHeadbuttFlash, sampleHeadbuttStar,
  type HeadbuttBurst,
} from './headbuttMath';

export interface HeadbuttImpactStarsOptions {
  /** Maximum simultaneous impacts. Full pools replace their oldest burst. */
  capacity?: number;
}

interface ImpactSlot {
  readonly root: THREE.Group;
  readonly flash: THREE.Sprite;
  readonly stars: THREE.Sprite[];
  readonly glints: THREE.Sprite[];
  burst: HeadbuttBurst | null;
  age: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const smoothstep = (a: number, b: number, n: number): number => {
  const t = clamp01((n - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Camera-facing, cream-centered eight-point orange/yellow strike with soft edges. */
function makeFlashTexture(): THREE.DataTexture {
  const side = 192;
  const bytes = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const u = (x + 0.5) * 2 / side - 1;
      const v = (y + 0.5) * 2 / side - 1;
      const radius = Math.hypot(u, v);
      const angle = Math.atan2(v, u);
      const rays = Math.pow(Math.max(0, Math.cos(8 * angle)), 18);
      const outline = 0.31 + 0.55 * rays;
      const inside = smoothstep(-0.014, 0.014, outline - radius);
      const glow = Math.exp(-(((radius - outline) / 0.057) ** 2)) * 0.17;
      const gold = 1 - smoothstep(0.23, 0.50, radius);
      const white = 1 - smoothstep(0.10, 0.29, radius);
      const offset = (y * side + x) * 4;
      bytes[offset] = 255;
      bytes[offset + 1] = Math.round(119 + 112 * gold + 24 * white);
      bytes[offset + 2] = Math.round(5 + 57 * gold + 184 * white);
      bytes[offset + 3] = Math.round(255 * clamp01(inside + glow));
    }
  }
  return dataTexture(bytes, side, 'headbutt ivory-gold impact burst');
}

/** Five-point gold stars with an orange-red painted-looking rim. */
function makeStarTexture(): THREE.DataTexture {
  const side = 128;
  const bytes = new Uint8Array(side * side * 4);
  const vertices = Array.from({ length: 10 }, (_, i) => {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 === 0 ? 0.84 : 0.37;
    return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
  });
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const u = (x + 0.5) * 2 / side - 1;
      const v = 1 - (y + 0.5) * 2 / side;
      let inside = false;
      let edgeDistance2 = Infinity;
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i]!;
        const b = vertices[(i + 1) % vertices.length]!;
        if ((a.y > v) !== (b.y > v) &&
            u < (b.x - a.x) * (v - a.y) / (b.y - a.y) + a.x) {
          inside = !inside;
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = clamp01(((u - a.x) * dx + (v - a.y) * dy) / (dx * dx + dy * dy));
        edgeDistance2 = Math.min(edgeDistance2,
          (u - a.x - t * dx) ** 2 + (v - a.y - t * dy) ** 2);
      }
      const distance = Math.sqrt(edgeDistance2);
      const rim = smoothstep(0.025, 0.09, distance);
      const highlight = smoothstep(-0.35, 0.6, v);
      const offset = (y * side + x) * 4;
      bytes[offset] = 255;
      bytes[offset + 1] = Math.round(111 + rim * (92 + 22 * highlight));
      bytes[offset + 2] = Math.round(0 + rim * (13 + 34 * highlight));
      bytes[offset + 3] = Math.round(255 * clamp01(0.5 + (inside ? 1 : -1) * distance * 60));
    }
  }
  return dataTexture(bytes, side, 'headbutt orange-outlined gold star');
}

function dataTexture(bytes: Uint8Array, side: number, name: string): THREE.DataTexture {
  const texture = new THREE.DataTexture(bytes, side, side, THREE.RGBAFormat);
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function sprite(texture: THREE.Texture, name: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture, transparent: true, opacity: 0, depthWrite: false,
    toneMapped: false,
  });
  const result = new THREE.Sprite(material);
  result.name = name;
  result.visible = false;
  result.renderOrder = 8;
  return result;
}

/** Cosmetic, reusable headbutt collision feedback from approved panel three.
 * No game physics, renderer, DOM, assets, per-frame GPU allocations or global listeners.
 */
export class HeadbuttImpactStars {
  readonly group = new THREE.Group();
  private readonly flashTexture: THREE.DataTexture;
  private readonly starTexture: THREE.DataTexture;
  private readonly slots: ImpactSlot[] = [];
  private nextSlot = 0;
  private disposed = false;

  constructor(options: HeadbuttImpactStarsOptions = {}) {
    const capacity = options.capacity ?? 12;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) {
      throw new RangeError('Headbutt impact capacity must be an integer in 1..64');
    }
    this.group.name = 'headbutt impact stars';
    this.flashTexture = makeFlashTexture();
    this.starTexture = makeStarTexture();
    for (let i = 0; i < capacity; i++) {
      const root = new THREE.Group();
      root.name = 'headbutt impact ' + i;
      root.visible = false;
      const flash = sprite(this.flashTexture, 'white-hot eight-point headbutt flash');
      root.add(flash);
      const stars: THREE.Sprite[] = [];
      const glints: THREE.Sprite[] = [];
      for (let j = 0; j < HEADBUTT_STAR_COUNT; j++) {
        const star = sprite(this.starTexture, 'ejected gold star ' + j);
        const glint = sprite(this.flashTexture, 'tiny trailing glint ' + j);
        root.add(star, glint);
        stars.push(star);
        glints.push(glint);
      }
      this.group.add(root);
      this.slots.push({ root, flash, stars, glints, burst: null, age: 0 });
    }
  }

  /** Position is the head/obstacle contact, direction is the goat's travel on XZ. */
  emit(position: Vec3Like, direction: Vec3Like, power: number): void {
    if (this.disposed) throw new Error('HeadbuttImpactStars is disposed');
    const burst = makeHeadbuttBurst(position, direction, power);
    if (!burst) return;
    const slot = this.slots[this.nextSlot]!;
    this.nextSlot = (this.nextSlot + 1) % this.slots.length;
    slot.burst = burst;
    slot.age = 0;
    slot.root.position.set(burst.position.x, burst.position.y, burst.position.z);
    this.paint(slot);
  }

  update(dt: number): void {
    if (this.disposed) throw new Error('HeadbuttImpactStars is disposed');
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError('Headbutt dt must be finite and non-negative');
    }
    for (const slot of this.slots) {
      if (slot.burst) {
        slot.age += dt;
        this.paint(slot);
      }
    }
  }

  private paint(slot: ImpactSlot): void {
    const burst = slot.burst;
    if (!burst) return;
    const flash = sampleHeadbuttFlash(burst, slot.age);
    if (!flash) {
      slot.burst = null;
      slot.root.visible = false;
      return;
    }
    slot.root.visible = true;
    slot.flash.visible = flash.opacity > 0.002;
    slot.flash.scale.set(flash.scale, flash.scale, 1);
    slot.flash.material.opacity = flash.opacity;
    slot.flash.material.rotation = 0;
    for (let i = 0; i < HEADBUTT_STAR_COUNT; i++) {
      const star = slot.stars[i]!;
      const glint = slot.glints[i]!;
      const sample = sampleHeadbuttStar(burst, i, slot.age);
      star.visible = sample !== null;
      glint.visible = sample !== null;
      if (!sample) continue;
      star.position.set(sample.offset.x, sample.offset.y, sample.offset.z);
      star.scale.set(sample.scale, sample.scale, 1);
      star.material.opacity = sample.opacity;
      star.material.rotation = sample.rotation;
      glint.position.set(sample.offset.x - burst.direction.x * 0.16,
        sample.offset.y + 0.10, sample.offset.z - burst.direction.z * 0.16);
      glint.scale.setScalar(sample.scale * 0.32);
      glint.material.opacity = sample.opacity * 0.58;
      glint.material.rotation = sample.rotation * -0.6;
    }
  }

  get activeCount(): number {
    return this.slots.reduce((count, slot) => count + Number(slot.burst !== null), 0);
  }

  clear(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      slot.burst = null;
      slot.age = 0;
      slot.root.visible = false;
      slot.flash.visible = false;
      for (const star of slot.stars) star.visible = false;
      for (const glint of slot.glints) glint.visible = false;
    }
  }

  /** Idempotent; releases only the effect's own materials/textures. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    for (const slot of this.slots) {
      slot.flash.material.dispose();
      for (const star of slot.stars) star.material.dispose();
      for (const glint of slot.glints) glint.material.dispose();
      slot.root.removeFromParent();
    }
    this.flashTexture.dispose();
    this.starTexture.dispose();
    this.group.removeFromParent();
    this.disposed = true;
  }
}

export const createHeadbuttImpactStars = (
  options?: HeadbuttImpactStarsOptions,
): HeadbuttImpactStars => new HeadbuttImpactStars(options);
