import * as THREE from 'three';
import {
  makeDustBurst, sampleDustParticle, seededRandom,
  type DustParticle, type Vec3Like,
} from './dustMath';

export interface RunningDustOptions {
  /** Hard cap on simultaneously allocated sprites; oldest particles are recycled. */
  capacity?: number;
  /** Fixed seed makes repeated lab runs and screenshots comparable. */
  seed?: number;
}

interface Slot {
  readonly sprite: THREE.Sprite;
  particle: DustParticle | null;
  age: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Tiny hand-shaded, anti-aliased sprite atlases made in memory, not from DOM,
 * canvas, image files, the network, or a third-party particle library.
 * Round, creamy highlights / warm amber undersides match the approved sheet.
 */
function makeTexture(kind: 'puff' | 'fleck'): THREE.DataTexture {
  const side = 96;
  const pixels = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const u = (x + 0.5) * 2 / side - 1;
      const v = (y + 0.5) * 2 / side - 1;
      // Flecks are tilted, irregular little chips; puffs are full round lobes.
      const rx = kind === 'fleck' ? (u + v * 0.36) / 0.80 : u;
      const ry = kind === 'fleck' ? v / 0.49 : v * 0.98;
      const radius = Math.hypot(rx, ry);
      const edge = 1 - smooth(0.83, 1.02, radius);
      const topLight = clamp01(0.55 + v * 0.34 - u * 0.19);
      const centerLight = Math.exp(-((u + 0.28) ** 2 / 0.24 + (v - 0.35) ** 2 / 0.25));
      const brightness = clamp01(topLight * 0.83 + centerLight * 0.31);
      const index = (y * side + x) * 4;
      // Painted apricot shadows along the bottom; pale vanilla highlights at top.
      pixels[index] = Math.round(217 + 38 * brightness);
      pixels[index + 1] = Math.round(158 + 79 * brightness);
      pixels[index + 2] = Math.round(103 + 105 * brightness);
      pixels[index + 3] = Math.round(255 * edge * (kind === 'fleck' ? 0.97 : 0.94));
    }
  }
  const texture = new THREE.DataTexture(pixels, side, side, THREE.RGBAFormat);
  texture.name = kind === 'puff' ? 'cream dust cloud' : 'flying dust flecks';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Reusable Three.js RUNNING DUST PUFFS effect.
 *
 *   const dust = new RunningDustPuffs();
 *   scene.add(dust.group);
 *   dust.emit(hoofWorldPosition, goatForwardDirection); // on ground contacts
 *   dust.update(dt);                                   // each render frame
 *   dust.dispose();                                    // on scene teardown
 *
 * No WebGL renderer, scene, global tick, DOM, or physics instance is owned.
 * +Y is up. Input positions are contact points at ground level.
 */
export class RunningDustPuffs {
  readonly group = new THREE.Group();
  private readonly cloudTexture = makeTexture('puff');
  private readonly fleckTexture = makeTexture('fleck');
  private readonly slots: Slot[] = [];
  private readonly random: () => number;
  private nextSlot = 0;
  private disposed = false;

  constructor(options: RunningDustOptions = {}) {
    const capacity = options.capacity ?? 128;
    if (!Number.isInteger(capacity) || capacity <= 0 || capacity > 1024) {
      throw new RangeError('Dust capacity must be an integer in 1..1024');
    }
    this.random = seededRandom(options.seed);
    this.group.name = 'running dust puffs';

    // Pool all SpriteMaterials so a sprint never allocates GPU resources mid-run.
    // Sprites face the current camera automatically, including in third-person.
    for (let i = 0; i < capacity; i++) {
      const material = new THREE.SpriteMaterial({
        map: this.cloudTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.name = 'dust lobe ' + i;
      sprite.visible = false;
      sprite.renderOrder = 3;
      this.group.add(sprite);
      this.slots.push({ sprite, particle: null, age: 0 });
    }
  }

  /** Spawn one hoof-strike. 'direction' points where the goat is running. */
  emit(position: Vec3Like, direction: Vec3Like): void {
    if (this.disposed) throw new Error('RunningDustPuffs is disposed');
    const burst = makeDustBurst(position, direction, this.random);
    for (const particle of burst) {
      const slot = this.slots[this.nextSlot]!;
      this.nextSlot = (this.nextSlot + 1) % this.slots.length;
      slot.particle = particle;
      slot.age = 0;
      const material = slot.sprite.material;
      const texture = particle.kind === 'puff' ? this.cloudTexture : this.fleckTexture;
      if (material.map !== texture) {
        material.map = texture;
        material.needsUpdate = true;
      }
      // A touch of ivory-to-sand variation instead of identical circular stamps.
      const variation = 0.92 + this.random() * 0.08;
      material.color.setRGB(variation, variation * 0.977, variation * 0.94);
      this.paint(slot);
    }
  }

  /** Advance all live particles. Time sampling is independent of frame splits. */
  update(dt: number): void {
    if (this.disposed) throw new Error('RunningDustPuffs is disposed');
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError('Dust dt must be non-negative and finite');
    }
    for (const slot of this.slots) {
      if (!slot.particle) continue;
      slot.age += dt;
      this.paint(slot);
    }
  }

  private paint(slot: Slot): void {
    const particle = slot.particle;
    if (!particle) return;
    const frame = sampleDustParticle(particle, slot.age);
    if (!frame) {
      slot.sprite.visible = false;
      if (slot.age >= particle.delay + particle.lifetime) slot.particle = null;
      return;
    }
    slot.sprite.position.set(frame.position.x, frame.position.y, frame.position.z);
    slot.sprite.scale.set(frame.diameter, frame.diameter, 1);
    slot.sprite.material.opacity = frame.opacity;
    slot.sprite.material.rotation = frame.rotation;
    slot.sprite.visible = frame.opacity > 0.002;
  }

  /** Current number of visibly animated sprites, never above capacity. */
  get activeCount(): number {
    return this.slots.reduce((count, slot) => count + Number(slot.sprite.visible), 0);
  }

  /** Reuse the pool without disposing GPU objects (e.g. reset a lab preview). */
  clear(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      slot.particle = null;
      slot.age = 0;
      slot.sprite.visible = false;
    }
  }

  /** Idempotent; does not dispose a caller-owned renderer, scene or camera. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    for (const slot of this.slots) {
      slot.sprite.material.dispose();
      slot.sprite.removeFromParent();
    }
    this.cloudTexture.dispose();
    this.fleckTexture.dispose();
    this.group.removeFromParent();
    this.disposed = true;
  }
}

/** Named convenience factory for callers that prefer functions to constructors. */
export const createRunningDustPuffs = (options?: RunningDustOptions): RunningDustPuffs =>
  new RunningDustPuffs(options);
