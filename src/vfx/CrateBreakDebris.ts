import * as THREE from 'three';
import type { Vec3Like } from './dustMath';
import {
  CRATE_CHIP_COUNT, CRATE_DUST_COUNT, CRATE_PLANK_COUNT,
  makeCrateBreakBurst, sampleCrateBreak, sampleCrateDust, sampleCrateFragment,
  type CrateBreakBurst,
} from './crateDebrisMath';

export interface CrateBreakDebrisOptions {
  /** Maximum overlapping bursts; a full pool recycles its oldest burst. */
  capacity?: number;
}

interface CrateSlot {
  readonly root: THREE.Group;
  readonly intact: THREE.Group;
  readonly cracks: THREE.Group;
  readonly flash: THREE.Sprite;
  readonly planks: THREE.Group[];
  readonly chips: THREE.Mesh[];
  readonly dust: THREE.Sprite[];
  readonly intactMaterials: THREE.MeshLambertMaterial[];
  readonly crackMaterial: THREE.MeshBasicMaterial;
  readonly plankMaterials: THREE.MeshLambertMaterial[];
  readonly chipMaterial: THREE.MeshLambertMaterial;
  burst: CrateBreakBurst | null;
  age: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function makeTexture(bytes: Uint8Array, side: number, name: string): THREE.DataTexture {
  const result = new THREE.DataTexture(bytes, side, side, THREE.RGBAFormat);
  result.name = name;
  result.colorSpace = THREE.SRGBColorSpace;
  result.magFilter = THREE.LinearFilter;
  result.minFilter = THREE.LinearFilter;
  result.generateMipmaps = false;
  result.unpackAlignment = 1;
  result.needsUpdate = true;
  return result;
}

/** An ivory-centered yellow flash with sharp orange-tipped rays. */
function makeStrikeTexture(): THREE.DataTexture {
  const side = 128;
  const bytes = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const u = (x + 0.5) * 2 / side - 1;
      const v = (y + 0.5) * 2 / side - 1;
      const r = Math.hypot(u, v);
      const angle = Math.atan2(v, u);
      const tips = Math.pow(Math.max(0, Math.cos(angle * 10)), 22);
      const edge = 0.30 + 0.56 * tips;
      const alpha = clamp01((edge - r) * 75 + 0.5) +
        Math.exp(-(((r - edge) / 0.055) ** 2)) * 0.18;
      const inner = clamp01((0.34 - r) / 0.23);
      const white = clamp01((0.19 - r) / 0.12);
      const at = (y * side + x) * 4;
      bytes[at] = 255;
      bytes[at + 1] = Math.round(153 + 86 * inner + 16 * white);
      bytes[at + 2] = Math.round(6 + 53 * inner + 192 * white);
      bytes[at + 3] = Math.round(255 * clamp01(alpha));
    }
  }
  return makeTexture(bytes, side, 'crate break ivory gold impact rays');
}

/** Soft clustered apricot dust, with a cream-colored highlight. */
function makeDustTexture(): THREE.DataTexture {
  const side = 96;
  const bytes = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const u = (x + 0.5) * 2 / side - 1;
      const v = 1 - (y + 0.5) * 2 / side;
      const r = Math.hypot(u, v);
      const cover = clamp01((0.92 - r) * 5);
      const highlight = clamp01((v + 0.4) * 0.7);
      const at = (y * side + x) * 4;
      bytes[at] = 255;
      bytes[at + 1] = Math.round(199 + highlight * 44);
      bytes[at + 2] = Math.round(137 + highlight * 90);
      bytes[at + 3] = Math.round(255 * cover * 0.86);
    }
  }
  return makeTexture(bytes, side, 'crate break warm cream dust');
}

function woodMaterial(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color, transparent: true, opacity: 1, depthWrite: false,
  });
}

/** Standalone, cosmetic CRATE BREAK DEBRIS VFX from approved panel five.
 *
 * emit(position, impactDirection, crateSize) uses the crate's bottom-center
 * ground point, a travel direction projected onto XZ, and side length in world
 * units. This effect never deletes a gameplay crate or applies physics forces.
 * Geometry, pooled meshes and both procedural textures are allocated once.
 */
export class CrateBreakDebris {
  readonly group = new THREE.Group();
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly chipGeometry = new THREE.TetrahedronGeometry(1, 0);
  private readonly rivetGeometry = new THREE.SphereGeometry(0.036, 6, 4);
  private readonly strikeTexture = makeStrikeTexture();
  private readonly dustTexture = makeDustTexture();
  private readonly slots: CrateSlot[] = [];
  private nextSlot = 0;
  private disposed = false;

  constructor(options: CrateBreakDebrisOptions = {}) {
    const capacity = options.capacity ?? 10;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) {
      throw new RangeError('Crate break capacity must be an integer in 1..64');
    }
    this.group.name = 'crate break debris';
    for (let i = 0; i < capacity; i++) {
      const root = new THREE.Group();
      root.name = 'crate break burst ' + i;
      root.visible = false;

      const face = woodMaterial(0xe2a04c);
      const edge = woodMaterial(0x955020);
      const highlight = woodMaterial(0xffc26b);
      const metal = woodMaterial(0x788196);
      const rivet = woodMaterial(0x494e64);
      const intactMaterials = [face, edge, highlight, metal, rivet];
      const intact = new THREE.Group();
      intact.name = 'intact wooden crate';
      root.add(intact);
      const block = (
        parent: THREE.Group, material: THREE.MeshLambertMaterial,
        x: number, y: number, z: number,
        sx: number, sy: number, sz: number,
      ): THREE.Mesh => {
        const piece = new THREE.Mesh(this.boxGeometry, material);
        piece.position.set(x, y, z);
        piece.scale.set(sx, sy, sz);
        piece.castShadow = true;
        parent.add(piece);
        return piece;
      };
      block(intact, edge, 0, 0.49, 0, 0.97, 0.98, 0.97);
      // Distinct vertical wooden boards on the front, both sides and lid.
      for (let j = 0; j < 4; j++) {
        const s = -0.36 + j * 0.24;
        block(intact, j % 2 ? face : highlight, s, 0.50, 0.505, 0.213, 0.83, 0.055);
        block(intact, face, 0.505, 0.50, s, 0.055, 0.83, 0.213);
        block(intact, face, s, 1.00, 0, 0.213, 0.055, 0.93);
        block(intact, edge, s + 0.07, 0.49, 0.54, 0.015, 0.54, 0.016);
      }
      for (const x of [-0.46, 0.46]) {
        block(intact, edge, x, 0.49, 0.543, 0.09, 0.96, 0.083);
      }
      for (const y of [0.055, 0.94]) {
        block(intact, edge, 0, y, 0.553, 0.99, 0.085, 0.075);
      }
      // Four grey riveted corner plates echo the approved illustration.
      for (const x of [-0.40, 0.40]) {
        for (const y of [0.10, 0.88]) {
          block(intact, metal, x, y, 0.603, 0.21, 0.18, 0.045);
          const pin = new THREE.Mesh(this.rivetGeometry, rivet);
          pin.position.set(x, y, 0.637);
          intact.add(pin);
        }
      }

      const crackMaterial = new THREE.MeshBasicMaterial({
        color: 0x452310, transparent: true, depthWrite: false,
      });
      const cracks = new THREE.Group();
      cracks.name = 'branching black crate cracks';
      cracks.position.z = 0.654;
      cracks.visible = false;
      intact.add(cracks);
      const crackLine = (x1: number, y1: number, x2: number, y2: number): void => {
        const line = new THREE.Mesh(this.boxGeometry, crackMaterial);
        line.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
        line.rotation.z = -Math.atan2(x2 - x1, y2 - y1);
        line.scale.set(0.032, Math.hypot(x2 - x1, y2 - y1), 0.008);
        cracks.add(line);
      };
      crackLine(0.04, 0.39, -0.08, 0.54);
      crackLine(-0.08, 0.54, -0.13, 0.75);
      crackLine(-0.08, 0.54, 0.18, 0.72);
      crackLine(0.04, 0.39, 0.17, 0.26);
      crackLine(0.17, 0.26, 0.18, 0.09);

      const plankFace = woodMaterial(0xe5a04a);
      const plankEdge = woodMaterial(0x9e4f20);
      const plankHighlight = woodMaterial(0xffc16d);
      const plankMaterials = [plankFace, plankEdge, plankHighlight];
      const planks: THREE.Group[] = [];
      for (let j = 0; j < CRATE_PLANK_COUNT; j++) {
        const piece = new THREE.Group();
        piece.name = 'flying wooden plank ' + j;
        piece.visible = false;
        const width = 0.15 + (j % 3) * 0.07;
        const length = 0.48 + (j % 4) * 0.11;
        block(piece, plankEdge, 0, 0, 0, width + 0.025, length, 0.13);
        block(piece, plankFace, 0, 0.007, 0.071, width, length * 0.93, 0.029);
        block(piece, plankHighlight, -width * 0.25, 0.01, 0.091, 0.026, length * 0.78, 0.008);
        root.add(piece);
        planks.push(piece);
      }
      const chipMaterial = woodMaterial(0xc67c32);
      const chips: THREE.Mesh[] = [];
      for (let j = 0; j < CRATE_CHIP_COUNT; j++) {
        const chip = new THREE.Mesh(this.chipGeometry, chipMaterial);
        chip.name = 'small flying wood chip ' + j;
        chip.visible = false;
        chip.castShadow = true;
        root.add(chip);
        chips.push(chip);
      }
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.strikeTexture, transparent: true, opacity: 0,
        depthWrite: false, toneMapped: false,
      }));
      flash.name = 'ivory yellow crate impact flash';
      flash.visible = false;
      flash.renderOrder = 10;
      root.add(flash);
      const dust: THREE.Sprite[] = [];
      for (let j = 0; j < CRATE_DUST_COUNT; j++) {
        const puff = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.dustTexture, transparent: true, opacity: 0,
          depthWrite: false, toneMapped: false,
        }));
        puff.name = 'peach crate dust puff ' + j;
        puff.visible = false;
        puff.renderOrder = 7;
        root.add(puff);
        dust.push(puff);
      }
      this.group.add(root);
      this.slots.push({
        root, intact, cracks, flash, planks, chips, dust, intactMaterials,
        crackMaterial, plankMaterials, chipMaterial, burst: null, age: 0,
      });
    }
  }

  /** World-space bottom center, incoming travel direction, crate side length. */
  emit(position: Vec3Like, impactDirection: Vec3Like, crateSize: number): void {
    if (this.disposed) throw new Error('CrateBreakDebris is disposed');
    const burst = makeCrateBreakBurst(position, impactDirection, crateSize);
    if (!burst) return;
    const slot = this.slots[this.nextSlot]!;
    this.nextSlot = (this.nextSlot + 1) % this.slots.length;
    slot.burst = burst;
    slot.age = 0;
    slot.root.position.set(burst.position.x, burst.position.y, burst.position.z);
    slot.intact.scale.setScalar(burst.size);
    for (const plank of slot.planks) plank.scale.setScalar(burst.size);
    slot.flash.position.set(-burst.direction.x * burst.size * 0.48,
      burst.size * 0.53, -burst.direction.z * burst.size * 0.48);
    this.paint(slot);
  }

  /** Seconds since last frame; deterministic, independent of frame rate. */
  update(dt: number): void {
    if (this.disposed) throw new Error('CrateBreakDebris is disposed');
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError('Crate break dt must be finite and non-negative');
    }
    for (const slot of this.slots) {
      if (!slot.burst) continue;
      slot.age += dt;
      this.paint(slot);
    }
  }

  private paint(slot: CrateSlot): void {
    const burst = slot.burst;
    if (!burst) return;
    const frame = sampleCrateBreak(burst, slot.age);
    if (!frame) {
      slot.burst = null;
      slot.root.visible = false;
      return;
    }
    slot.root.visible = true;
    slot.intact.visible = frame.crateOpacity > 0.002;
    for (const material of slot.intactMaterials) material.opacity = frame.crateOpacity;
    slot.cracks.visible = frame.crackOpacity > 0.002;
    slot.crackMaterial.opacity = frame.crackOpacity;
    slot.flash.visible = frame.flashOpacity > 0.002;
    slot.flash.scale.set(frame.flashSize, frame.flashSize, 1);
    slot.flash.material.opacity = frame.flashOpacity;
    for (const material of slot.plankMaterials) material.opacity = frame.debrisOpacity;
    slot.chipMaterial.opacity = frame.debrisOpacity;
    for (let j = 0; j < slot.planks.length; j++) {
      const piece = slot.planks[j]!;
      const sample = sampleCrateFragment(burst, 'plank', j, slot.age);
      piece.visible = sample !== null;
      if (!sample) continue;
      piece.position.set(sample.offset.x, sample.offset.y, sample.offset.z);
      piece.rotation.set(sample.rotation.x, sample.rotation.y, sample.rotation.z);
    }
    for (let j = 0; j < slot.chips.length; j++) {
      const chip = slot.chips[j]!;
      const sample = sampleCrateFragment(burst, 'chip', j, slot.age);
      chip.visible = sample !== null;
      if (!sample) continue;
      chip.position.set(sample.offset.x, sample.offset.y, sample.offset.z);
      chip.rotation.set(sample.rotation.x, sample.rotation.y, sample.rotation.z);
      chip.scale.setScalar(burst.size * sample.scale);
    }
    for (let j = 0; j < slot.dust.length; j++) {
      const puff = slot.dust[j]!;
      const sample = sampleCrateDust(burst, j, slot.age);
      puff.visible = sample !== null;
      if (!sample) continue;
      puff.position.set(sample.offset.x, sample.offset.y, sample.offset.z);
      puff.scale.set(sample.diameter, sample.diameter, 1);
      puff.material.opacity = sample.opacity;
    }
  }

  get activeCount(): number {
    return this.slots.reduce((n, slot) => n + Number(slot.burst !== null), 0);
  }

  clear(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      slot.burst = null;
      slot.age = 0;
      slot.root.visible = false;
      for (const piece of slot.planks) piece.visible = false;
      for (const chip of slot.chips) chip.visible = false;
      for (const puff of slot.dust) puff.visible = false;
      slot.flash.visible = false;
    }
  }

  /** Idempotent; never disposes geometry or materials owned by a caller. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    for (const slot of this.slots) {
      for (const material of slot.intactMaterials) material.dispose();
      for (const material of slot.plankMaterials) material.dispose();
      slot.crackMaterial.dispose();
      slot.chipMaterial.dispose();
      slot.flash.material.dispose();
      for (const puff of slot.dust) puff.material.dispose();
      slot.root.removeFromParent();
    }
    this.boxGeometry.dispose();
    this.chipGeometry.dispose();
    this.rivetGeometry.dispose();
    this.strikeTexture.dispose();
    this.dustTexture.dispose();
    this.group.removeFromParent();
    this.disposed = true;
  }
}

export const createCrateBreakDebris = (options?: CrateBreakDebrisOptions): CrateBreakDebris =>
  new CrateBreakDebris(options);
