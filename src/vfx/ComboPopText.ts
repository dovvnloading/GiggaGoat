import * as THREE from 'three';
import type { Vec3Like } from './dustMath';
import {
  makeComboPopCue, makeComboPopFrame, sampleComboPop,
  type ComboPopCue, type ComboPopFrame, type ComboPopTier,
} from './comboPopMath';
import { makeComboPopTexture } from './comboPopArt';

export interface ComboPopTextOptions {
  /** Maximum simultaneous popups; oldest live popup is replaced when full. */
  capacity?: number;
}

interface ComboSlot {
  readonly sprite: THREE.Sprite<THREE.SpriteMaterial>;
  readonly frame: ComboPopFrame;
  cue: ComboPopCue | null;
  age: number;
}

const CACHED_COUNT_LIMIT = 16;

/**
 * Camera-facing COMBO xN feedback. One preallocated sprite/material per slot;
 * textures are shared between sprites and cached by actual displayed count.
 * All Three objects and canvas paints are created outside the render loop.
 */
export class ComboPopText {
  readonly group = new THREE.Group();
  private readonly slots: ComboSlot[] = [];
  private readonly textures = new Map<number, THREE.Texture>();
  private nextSlot = 0;
  private disposed = false;

  constructor(options: ComboPopTextOptions = {}) {
    const capacity = options.capacity ?? 10;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) {
      throw new RangeError('Combo pop capacity must be an integer in 1..64');
    }
    this.group.name = '08 combo pop text';
    // Hot tiers are built once and kept for the lifetime of the effect.
    this.textures.set(2, makeComboPopTexture(2, 2));
    this.textures.set(3, makeComboPopTexture(3, 3));
    this.textures.set(4, makeComboPopTexture(4, 4));
    for (let i = 0; i < capacity; i++) {
      const material = new THREE.SpriteMaterial({
        map: this.textures.get(2)!,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.name = 'combo pop billboard ' + i;
      sprite.renderOrder = 30;
      sprite.visible = false;
      this.group.add(sprite);
      this.slots.push({ sprite, frame: makeComboPopFrame(), cue: null, age: 0 });
    }
  }

  /** World anchor (+Y up), actual combo count (0/1 are intentional no-ops). */
  emit(position: Vec3Like, comboCount: number): void {
    if (this.disposed) throw new Error('ComboPopText is disposed');
    const cue = makeComboPopCue(position, comboCount);
    if (!cue) return;
    let index = -1;
    let oldest = -1;
    for (let offset = 0; offset < this.slots.length; offset++) {
      const candidate = (this.nextSlot + offset) % this.slots.length;
      const slot = this.slots[candidate]!;
      if (!slot.cue) { index = candidate; break; }
      if (slot.age > oldest) { index = candidate; oldest = slot.age; }
    }
    const slot = this.slots[index]!;
    const texture = this.textureFor(cue.tier, cue.count);
    slot.cue = cue;
    slot.age = 0;
    slot.sprite.material.map = texture;
    slot.sprite.material.opacity = 0;
    this.nextSlot = (index + 1) % this.slots.length;
    this.paint(slot);
    // Only event-time cache housekeeping, never in update().
    this.pruneCache();
  }

  /** Render-clock seconds, not frame counts. A large step equals small steps. */
  update(dt: number): void {
    if (this.disposed) throw new Error('ComboPopText is disposed');
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError('Combo pop dt must be finite and non-negative');
    }
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      if (!slot.cue) continue;
      slot.age += dt;
      this.paint(slot);
    }
  }

  private paint(slot: ComboSlot): void {
    const cue = slot.cue;
    if (!cue) return;
    if (!sampleComboPop(cue, slot.age, slot.frame)) {
      slot.cue = null;
      slot.sprite.visible = false;
      return;
    }
    const size = cue.tier === 2 ? 3.15 : cue.tier === 3 ? 3.42 : 3.72;
    slot.sprite.visible = slot.frame.opacity > 0.001;
    slot.sprite.material.opacity = slot.frame.opacity;
    slot.sprite.position.set(
      cue.position.x, cue.position.y + slot.frame.lift, cue.position.z,
    );
    slot.sprite.scale.set(
      size * slot.frame.scaleX, size * slot.frame.scaleY, 1,
    );
  }

  private textureFor(tier: ComboPopTier, count: number): THREE.Texture {
    let texture = this.textures.get(count);
    if (!texture) {
      texture = makeComboPopTexture(tier, count);
      this.textures.set(count, texture);
    } else if (count > 4) {
      // Reinsert to keep active/recent dynamic counts in LRU order.
      this.textures.delete(count);
      this.textures.set(count, texture);
    }
    return texture;
  }

  private pruneCache(): void {
    if (this.textures.size <= CACHED_COUNT_LIMIT) return;
    for (const [count, texture] of this.textures) {
      if (this.textures.size <= CACHED_COUNT_LIMIT) break;
      if (count <= 4) continue; // Never evict the three reference tiers.
      let inUse = false;
      for (let i = 0; i < this.slots.length; i++) {
        if (this.slots[i]!.cue?.count === count) { inUse = true; break; }
      }
      if (inUse) continue;
      this.textures.delete(count);
      texture.dispose();
    }
  }

  get activeCount(): number {
    let result = 0;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]!.cue) result++;
    }
    return result;
  }

  clear(): void {
    if (this.disposed) return;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      slot.cue = null;
      slot.age = 0;
      slot.sprite.visible = false;
      slot.sprite.material.opacity = 0;
    }
    this.nextSlot = 0;
  }

  /** Idempotent; never disposes an external renderer or scene. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i]!.sprite.material.dispose();
    }
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.group.clear();
    this.group.removeFromParent();
    this.disposed = true;
  }
}

export const createComboPopText = (options?: ComboPopTextOptions): ComboPopText =>
  new ComboPopText(options);
