import * as THREE from 'three';
import {
  assertGrowthTier, makeGrowthAuraFrame, sampleGiggaHold, sampleGrowthBurst,
  type GrowthAuraFrame, type GrowthTier,
} from './growthAuraMath';

export interface GiggaGrowthPurpleAuraOptions {
  /** Number of simultaneous growth pulses; oldest is recycled if full. 1–8. */
  capacity?: number;
  /** Offset of the hoof-level anchor in the target's local +Y axis. */
  hoofOffsetY?: number;
}

interface SharedArt {
  ring: THREE.TorusGeometry;
  halo: THREE.TorusGeometry;
  disc: THREE.PlaneGeometry;
  beam: THREE.CylinderGeometry;
  spiral: THREE.BufferGeometry;
  spiralCore: THREE.BufferGeometry;
  glow: THREE.DataTexture;
  star: THREE.DataTexture;
}

interface AuraRig {
  root: THREE.Group;
  rings: THREE.Group;
  beams: THREE.Group;
  spirals: THREE.Group;
  motes: THREE.Sprite[];
  flare: THREE.Sprite;
  flareBody: THREE.Sprite;
  ringCore: THREE.MeshBasicMaterial;
  ringHalo: THREE.MeshBasicMaterial;
  ringDisc: THREE.MeshBasicMaterial;
  ringGlow: THREE.MeshBasicMaterial;
  beamMaterial: THREE.MeshBasicMaterial;
  beamCoreMaterial: THREE.MeshBasicMaterial;
  spiralMaterials: THREE.MeshBasicMaterial[];
  spiralCoreMaterial: THREE.MeshBasicMaterial;
  hoopMaterial: THREE.MeshBasicMaterial;
  moteMaterials: readonly [THREE.SpriteMaterial, THREE.SpriteMaterial];
  flareMaterial: THREE.SpriteMaterial;
  flareBodyMaterial: THREE.SpriteMaterial;
  materials: THREE.Material[];
}

interface GrowthSlot {
  rig: AuraRig;
  frame: GrowthAuraFrame;
  tier: GrowthTier;
  age: number;
  active: boolean;
}

const MOTE_COUNT = 24;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function radialTexture(star: boolean): THREE.DataTexture {
  const size = 64;
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - size / 2) / (size / 2);
      const dy = (y + 0.5 - size / 2) / (size / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const core = Math.exp(-d * d * 8.5) * Math.max(0, 1 - d);
      const rays = star
        ? Math.exp(-Math.abs(dx * dy) * 90) * Math.pow(Math.max(0, 1 - d), 2.8)
        : 0;
      const a = Math.min(1, core * 1.3 + rays * 0.65);
      const n = (y * size + x) * 4;
      bytes[n] = 255;
      bytes[n + 1] = 255;
      bytes[n + 2] = 255;
      bytes[n + 3] = Math.round(a * 255);
    }
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Flat, double-sided helix strip, shared by all ribbons in all pulse slots. */
function spiralGeometry(widthScale = 1): THREE.BufferGeometry {
  const segments = 56;
  const points = new Float32Array((segments + 1) * 6);
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = t * Math.PI * 3.8;
    const radius = 1 - t * 0.27;
    const width = (0.05 + Math.sin(Math.PI * t) * 0.07) * widthScale;
    const y = t * 0.99 + 0.02;
    const p = i * 6;
    points[p] = Math.cos(angle) * (radius - width);
    points[p + 1] = y;
    points[p + 2] = Math.sin(angle) * (radius - width);
    points[p + 3] = Math.cos(angle) * (radius + width);
    points[p + 4] = y + 0.022;
    points[p + 5] = Math.sin(angle) * (radius + width);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Opaque-looking purple must survive a pale sky/floor. Reserve additive blending
// for the soft bloom; the readable toon silhouettes use normal alpha blending.
function basic(color: number, opacity = 0, additive = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
}

function spriteMaterial(color: number, map: THREE.Texture, additive = false): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    color, map, transparent: true, opacity: 0,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false, depthTest: true, toneMapped: false,
  });
}

function createArt(): SharedArt {
  return {
    ring: new THREE.TorusGeometry(1, 0.022, 6, 64),
    halo: new THREE.TorusGeometry(1, 0.085, 6, 64),
    disc: new THREE.PlaneGeometry(2.8, 2.8),
    beam: new THREE.CylinderGeometry(0.003, 0.090, 1, 4, 1),
    spiral: spiralGeometry(),
    spiralCore: spiralGeometry(0.22),
    glow: radialTexture(false),
    star: radialTexture(true),
  };
}


function createRig(art: SharedArt, name: string): AuraRig {
  const root = new THREE.Group();
  root.name = name;
  root.visible = false;
  const materials: THREE.Material[] = [];

  // The broad low disc is normal-blended violet, not an additive white haze.
  // An independently animated additive disc contributes just the soft outer glow.
  const ringCore = basic(0xf6d5ff);
  const ringHalo = basic(0x7920d9);
  const ringDisc = basic(0x9632e6);
  const ringGlow = basic(0xb45aff, 0, true);
  ringDisc.map = art.glow;
  ringGlow.map = art.glow;
  materials.push(ringCore, ringHalo, ringDisc, ringGlow);
  const rings = new THREE.Group();
  rings.name = 'violet hoof glow rings';
  root.add(rings);

  const glow = new THREE.Mesh(art.disc, ringGlow);
  glow.name = 'soft additive violet ground glow';
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.012;
  const disc = new THREE.Mesh(art.disc, ringDisc);
  disc.name = 'saturated violet ground bloom';
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.018;
  const halo = new THREE.Mesh(art.halo, ringHalo);
  halo.name = 'soft magenta hoof halo';
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.033;
  const core = new THREE.Mesh(art.ring, ringCore);
  core.name = 'bright lilac hoof outline';
  core.rotation.x = -Math.PI / 2;
  core.position.y = 0.047;
  const inner = new THREE.Mesh(art.ring, ringCore);
  inner.rotation.x = -Math.PI / 2;
  inner.scale.set(0.81, 0.81, 0.81);
  inner.position.y = 0.055;
  rings.add(glow, disc, halo, core, inner);

  const beams = new THREE.Group();
  beams.name = 'rising violet light pillars';
  root.add(beams);
  const beamMaterial = basic(0x7220d6);
  const beamCoreMaterial = basic(0xffe0ff);
  materials.push(beamMaterial, beamCoreMaterial);
  for (let i = 0; i < 14; i++) {
    const angle = i / 14 * Math.PI * 2;
    const h = 0.52 + ((i * 7) % 13) / 13 * 0.62;
    const r = 0.74 + ((i * 5) % 9) / 9 * 0.26;
    const ray = new THREE.Mesh(art.beam, beamMaterial);
    ray.name = 'violet light pillar ' + i;
    ray.scale.y = h;
    ray.position.set(Math.cos(angle) * r, h * 0.5, Math.sin(angle) * r);
    // Reuse the same tapered geometry with a narrow white-lilac shaft.
    const shaft = new THREE.Mesh(art.beam, beamCoreMaterial);
    shaft.name = 'white-hot pillar core ' + i;
    shaft.scale.set(0.24, h * 0.94, 0.24);
    shaft.position.copy(ray.position);
    shaft.renderOrder = 1;
    beams.add(ray, shaft);
  }

  const spirals = new THREE.Group();
  spirals.name = 'upward swirling purple spiral ribbons';
  root.add(spirals);
  const spiralMaterials: THREE.MeshBasicMaterial[] = [
    basic(0xc055f6), basic(0x8c28dd), basic(0xd574fb),
  ];
  const spiralCoreMaterial = basic(0xffe4ff);
  const hoopMaterial = basic(0xa52fe7);
  materials.push(...spiralMaterials, spiralCoreMaterial, hoopMaterial);
  for (let i = 0; i < spiralMaterials.length; i++) {
    const rotation = i * 2 * Math.PI / 3;
    const ribbon = new THREE.Mesh(art.spiral, spiralMaterials[i]!);
    ribbon.name = 'helical violet ribbon ' + i;
    ribbon.rotation.y = rotation;
    ribbon.frustumCulled = false;
    const ribbonCore = new THREE.Mesh(art.spiralCore, spiralCoreMaterial);
    ribbonCore.name = 'white-hot spiral core ' + i;
    ribbonCore.rotation.y = rotation;
    ribbonCore.frustumCulled = false;
    ribbonCore.renderOrder = 1;
    spirals.add(ribbon, ribbonCore);
  }
  for (let i = 0; i < 2; i++) {
    const hoop = new THREE.Mesh(art.ring, hoopMaterial);
    hoop.name = 'floating spiral orbit ' + i;
    hoop.rotation.x = -Math.PI / 2;
    hoop.scale.setScalar(i ? 0.80 : 0.97);
    hoop.position.y = i ? 0.73 : 0.46;
    spirals.add(hoop);
  }

  const moteMaterials: readonly [THREE.SpriteMaterial, THREE.SpriteMaterial] = [
    spriteMaterial(0x9222df, art.glow),
    spriteMaterial(0xd45af9, art.star),
  ];
  materials.push(...moteMaterials);
  const motes: THREE.Sprite[] = [];
  for (let i = 0; i < MOTE_COUNT; i++) {
    const mote = new THREE.Sprite(moteMaterials[i % 2]!);
    mote.name = 'rising purple sparkle mote ' + i;
    mote.visible = false;
    root.add(mote);
    motes.push(mote);
  }

  // The normal-blended flare body keeps a strong violet center on light
  // backgrounds; the smaller additive star supplies the white-hot highlight.
  const flareBodyMaterial = spriteMaterial(0x9819e5, art.glow);
  const flareMaterial = spriteMaterial(0xec7bff, art.star, true);
  materials.push(flareBodyMaterial, flareMaterial);
  const flareBody = new THREE.Sprite(flareBodyMaterial);
  flareBody.name = 'GIGGA saturated purple flare body';
  flareBody.renderOrder = 1;
  const flare = new THREE.Sprite(flareMaterial);
  flare.name = 'GIGGA bright purple flare';
  flare.renderOrder = 2;
  root.add(flareBody, flare);

  return {
    root, rings, beams, spirals, motes, flare, flareBody,
    ringCore, ringHalo, ringDisc, ringGlow, beamMaterial, beamCoreMaterial,
    spiralMaterials, spiralCoreMaterial, hoopMaterial,
    moteMaterials, flareMaterial, flareBodyMaterial, materials,
  };
}

function paintRig(rig: AuraRig, frame: GrowthAuraFrame, age: number): void {
  const ring = frame.ring;
  rig.root.visible = ring + frame.pillars + frame.ribbons + frame.motes + frame.flare > 0.0001;
  rig.rings.visible = ring > 0.001;
  rig.rings.scale.set(frame.radius, 1, frame.radius);
  rig.ringCore.opacity = Math.min(1, ring * 0.98 + frame.flare * 0.15);
  rig.ringHalo.opacity = Math.min(1, ring * 0.91 + frame.flare * 0.07);
  rig.ringDisc.opacity = Math.min(1, ring * 0.74 + frame.flare * 0.16);
  rig.ringGlow.opacity = Math.min(0.56, ring * 0.30 + frame.flare * 0.23);

  rig.beams.visible = frame.pillars > 0.001;
  rig.beams.scale.set(frame.radius, frame.height, frame.radius);
  rig.beams.rotation.y = frame.twist * 0.21;
  rig.beamMaterial.opacity = Math.min(1, frame.pillars * 0.91 + frame.flare * 0.08);
  rig.beamCoreMaterial.opacity = Math.min(1, frame.pillars * 0.88 + frame.flare * 0.10);

  rig.spirals.visible = frame.ribbons > 0.001;
  rig.spirals.scale.set(frame.radius, frame.height, frame.radius);
  rig.spirals.rotation.y = frame.twist;
  rig.spiralMaterials[0]!.opacity = Math.min(1, frame.ribbons * 0.93);
  rig.spiralMaterials[1]!.opacity = Math.min(1, frame.ribbons * 0.90);
  rig.spiralMaterials[2]!.opacity = Math.min(1, frame.ribbons * 0.91);
  rig.spiralCoreMaterial.opacity = Math.min(1, frame.ribbons * 0.91);
  rig.hoopMaterial.opacity = Math.min(1, frame.ribbons * 0.77 + frame.flare * 0.15);

  rig.moteMaterials[0].opacity = Math.min(1, frame.motes * 0.94);
  rig.moteMaterials[1].opacity = Math.min(1, frame.motes * 0.92);
  for (let i = 0; i < rig.motes.length; i++) {
    const mote = rig.motes[i]!;
    mote.visible = frame.motes > 0.003;
    if (!mote.visible) continue;
    const speed = 0.18 + (i % 5) * 0.045;
    const cycle = ((i / MOTE_COUNT + age * speed) % 1 + 1) % 1;
    const angle = i * GOLDEN_ANGLE + frame.twist * (0.58 + (i % 4) * 0.11);
    const radius = frame.radius * (0.63 + 0.36 * Math.sin(i * 2.37) ** 2);
    mote.position.set(
      Math.cos(angle) * radius, 0.10 + cycle * frame.height,
      Math.sin(angle) * radius,
    );
    const scale = (0.12 + (i % 4) * 0.033) * (0.7 + frame.radius * 0.23) *
      (0.80 + 0.20 * Math.sin(age * 7 + i));
    mote.scale.set(scale, scale, 1);
  }

  rig.flare.visible = frame.flare > 0.002;
  rig.flareBody.visible = rig.flare.visible;
  rig.flareBodyMaterial.opacity = Math.min(1, frame.flare * 0.92);
  rig.flareMaterial.opacity = Math.min(1, frame.flare * 0.78);
  if (rig.flare.visible) {
    rig.flare.position.set(0, frame.height * 0.48, 0);
    rig.flareBody.position.copy(rig.flare.position);
    const scale = frame.radius * (1.55 + 0.48 * frame.flare);
    rig.flare.scale.set(scale, scale * 1.2, 1);
    rig.flareBody.scale.set(scale * 1.46, scale * 1.64, 1);
  }
}

/**
 * Effect 09: reusable normal-blended purple toon aura with additive glow.
 *
 * attach(goat.root); setTier(0..3); triggerGrow(); update(dt seconds).
 * triggerGrow(nextTier) is an optional convenience to set and animate together.
 * The bounded pulse pool recycles its oldest active slot, never Three resources.
 * GIGGA's quiet holding rig continues until the tier drops or clear() is called.
 */
export class GiggaGrowthPurpleAura {
  readonly group = new THREE.Group();
  private readonly art: SharedArt;
  private readonly hold: AuraRig;
  private readonly holdFrame = makeGrowthAuraFrame();
  private readonly slots: GrowthSlot[] = [];
  private tierValue: GrowthTier = 0;
  private holdAge = 0;
  private nextSlot = 0;
  private disposed = false;

  constructor(options: GiggaGrowthPurpleAuraOptions = {}) {
    const capacity = options.capacity ?? 3;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 8) {
      throw new RangeError('Growth aura capacity must be an integer in 1..8');
    }
    const offset = options.hoofOffsetY ?? 0;
    if (!Number.isFinite(offset)) throw new RangeError('Invalid hoof offset');
    this.group.name = '09 GIGGA growth purple aura';
    this.group.position.y = offset;
    this.art = createArt();
    this.hold = createRig(this.art, 'GIGGA soft looping hold aura');
    this.group.add(this.hold.root);
    for (let i = 0; i < capacity; i++) {
      const rig = createRig(this.art, 'growth aura pooled pulse ' + i);
      this.group.add(rig.root);
      this.slots.push({ rig, frame: makeGrowthAuraFrame(), tier: 0,
        age: 0, active: false });
    }
  }

  /** Parent under an unscaled goat root whose local origin is at hoof height. */
  attach(target: THREE.Object3D): this {
    if (this.disposed) throw new Error('Growth aura is disposed');
    if (!(target instanceof THREE.Object3D)) throw new TypeError('Expected Object3D');
    target.add(this.group);
    return this;
  }

  detach(): void {
    if (this.disposed) return;
    this.group.removeFromParent();
  }

  get tier(): GrowthTier { return this.tierValue; }

  /** Change tier without a growth flash; tier 3 maintains a subtle looping aura. */
  setTier(tier: number): void {
    if (this.disposed) throw new Error('Growth aura is disposed');
    assertGrowthTier(tier);
    if (tier < this.tierValue) this.clearPulses();
    if (tier === 3 && this.tierValue !== 3) this.holdAge = 0;
    this.tierValue = tier;
    this.hold.root.visible = tier === 3;
    if (tier === 3) paintRig(this.hold, sampleGiggaHold(this.holdAge, this.holdFrame), this.holdAge);
  }

  /** Trigger the current tier's growth (or optionally set and trigger nextTier). */
  triggerGrow(nextTier: number = this.tierValue): void {
    if (this.disposed) throw new Error('Growth aura is disposed');
    assertGrowthTier(nextTier);
    this.setTier(nextTier);
    if (nextTier === 0) return;
    let index = -1;
    let oldestAge = -1;
    for (let offset = 0; offset < this.slots.length; offset++) {
      const candidate = (this.nextSlot + offset) % this.slots.length;
      const slot = this.slots[candidate]!;
      if (!slot.active) { index = candidate; break; }
      if (slot.age > oldestAge) { index = candidate; oldestAge = slot.age; }
    }
    const slot = this.slots[index]!;
    slot.active = true;
    slot.age = 0;
    slot.tier = nextTier;
    this.nextSlot = (index + 1) % this.slots.length;
    sampleGrowthBurst(nextTier, 0, slot.frame);
    paintRig(slot.rig, slot.frame, 0);
  }

  /** Absolute-age sampling; one large dt is equivalent to many short steps. */
  update(dt: number): void {
    if (this.disposed) throw new Error('Growth aura is disposed');
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError('Growth aura dt must be finite and non-negative');
    }
    if (this.tierValue === 3) {
      this.holdAge += dt;
      paintRig(this.hold, sampleGiggaHold(this.holdAge, this.holdFrame), this.holdAge);
    }
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      if (!slot.active) continue;
      slot.age += dt;
      if (!sampleGrowthBurst(slot.tier, slot.age, slot.frame)) {
        slot.active = false;
        slot.rig.root.visible = false;
      } else {
        paintRig(slot.rig, slot.frame, slot.age);
      }
    }
  }

  get activeCount(): number {
    let count = 0;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]!.active) count++;
    }
    return count;
  }

  private clearPulses(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.age = 0;
      slot.rig.root.visible = false;
    }
    this.nextSlot = 0;
  }

  /** Release active pulses and the persistent aura; retain all pooled resources. */
  clear(): void {
    if (this.disposed) return;
    this.clearPulses();
    this.tierValue = 0;
    this.holdAge = 0;
    this.hold.root.visible = false;
  }

  /** Idempotent; never disposes a goat, scene, renderer or shared external asset. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    for (const slot of this.slots) {
      for (const material of slot.rig.materials) material.dispose();
    }
    for (const material of this.hold.materials) material.dispose();
    this.art.ring.dispose();
    this.art.halo.dispose();
    this.art.disc.dispose();
    this.art.beam.dispose();
    this.art.spiral.dispose();
    this.art.spiralCore.dispose();
    this.art.glow.dispose();
    this.art.star.dispose();
    this.group.clear();
    this.group.removeFromParent();
    this.disposed = true;
  }
}

export const createGiggaGrowthPurpleAura = (
  options?: GiggaGrowthPurpleAuraOptions,
): GiggaGrowthPurpleAura => new GiggaGrowthPurpleAura(options);
