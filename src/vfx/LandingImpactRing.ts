import * as THREE from 'three';
import {
  LANDING_DEBRIS_COUNT, makeLandingRingBurst, sampleLandingDebris,
  sampleLandingRing, type LandingRingBurst,
} from './landingRingMath';
import type { Vec3Like } from './dustMath';

export interface LandingImpactRingOptions {
  /** Maximum simultaneous impacts; an additional impact recycles the oldest slot. */
  capacity?: number;
}

type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

interface RingSlot {
  readonly root: THREE.Group;
  readonly shockwave: THREE.Group;
  readonly halo: FlatMesh;
  readonly rim: FlatMesh;
  readonly spikes: FlatMesh;
  readonly innerSpikes: FlatMesh;
  readonly debris: FlatMesh[];
  readonly debrisMaterial: THREE.MeshBasicMaterial;
  burst: LandingRingBurst | null;
  age: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** A procedural soft amber/ivory annulus: the center is fully transparent. */
function makeHaloTexture(): THREE.DataTexture {
  const side = 192;
  const bytes = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const u = (x + 0.5) * 2 / side - 1;
      const v = (y + 0.5) * 2 / side - 1;
      const radius = Math.hypot(u, v);
      const core = Math.exp(-(((radius - 0.80) / 0.028) ** 2));
      const gold = Math.exp(-(((radius - 0.81) / 0.072) ** 2));
      const glow = Math.exp(-(((radius - 0.82) / 0.17) ** 2));
      const white = clamp01(core * 0.94);
      const at = (y * side + x) * 4;
      bytes[at] = 255;
      bytes[at + 1] = Math.round(171 + 82 * white);
      bytes[at + 2] = Math.round(22 + 218 * white);
      bytes[at + 3] = Math.round(255 * clamp01(core * 0.90 + gold * 0.43 + glow * 0.19));
    }
  }
  const texture = new THREE.DataTexture(bytes, side, side, THREE.RGBAFormat);
  texture.name = 'landing ring cream and gold glow';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Irregular low poly flame-like wedges jut outward/up from the gold ring. */
function makeSpikeGeometry(inner: boolean): THREE.BufferGeometry {
  const points: number[] = [];
  const count = 20;
  for (let i = 0; i < count; i++) {
    const angle = i * Math.PI * 2 / count + 0.036 * Math.sin(i * 4.1);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const width = (0.065 + (i % 3) * 0.010) * (inner ? 0.44 : 1);
    const rootRadius = inner ? 0.96 : 0.89;
    const tipRadius = inner ? 1.08 + (i % 3) * 0.038 : 1.15 + (i % 5) * 0.052;
    const tipHeight = inner ? 0.10 + (i % 3) * 0.034 : 0.18 + (i % 5) * 0.050;
    const baseY = inner ? 0.014 : 0;
    points.push(
      c * rootRadius - s * width, baseY, s * rootRadius + c * width,
      c * rootRadius + s * width, baseY, s * rootRadius - c * width,
      c * tipRadius, tipHeight, s * tipRadius,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function flatMaterial(color: number, map?: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    map: map ?? null,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * Bounded, reusable LANDING IMPACT RING VFX from the approved second panel.
 *
 *   const ring = createLandingImpactRing();
 *   scene.add(ring.group);
 *   ring.emit(contactWorldPosition, impactStrength); // strength 0 = no effect
 *   ring.update(dt);                                 // elapsed seconds
 *   ring.dispose();                                  // on scene teardown
 *
 * The impact is purely cosmetic. No canvas, DOM, renderer, global clock or
 * gameplay physics is owned by this class. Position is the ground contact;
 * +Y is up. All meshes/materials and the glow texture are allocated once.
 */
export class LandingImpactRing {
  readonly group = new THREE.Group();
  private readonly haloTexture = makeHaloTexture();
  private readonly planeGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly rimGeometry = new THREE.RingGeometry(0.955, 1.012, 96);
  private readonly spikeGeometry = makeSpikeGeometry(false);
  private readonly innerSpikeGeometry = makeSpikeGeometry(true);
  private readonly debrisGeometry = new THREE.TetrahedronGeometry(0.095, 0);
  private readonly slots: RingSlot[] = [];
  private nextSlot = 0;
  private disposed = false;

  constructor(options: LandingImpactRingOptions = {}) {
    const capacity = options.capacity ?? 12;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) {
      throw new RangeError('Landing ring capacity must be an integer in 1..64');
    }
    this.group.name = 'landing impact rings';

    for (let i = 0; i < capacity; i++) {
      const root = new THREE.Group();
      root.name = 'landing burst ' + i;
      root.visible = false;
      const shockwave = new THREE.Group();
      shockwave.position.y = 0.035; // float above the ground, avoiding z-fighting
      root.add(shockwave);

      const halo = new THREE.Mesh(this.planeGeometry, flatMaterial(0xffffff, this.haloTexture));
      halo.rotation.x = -Math.PI / 2;
      // Texture's ring lies at UV radius 0.8; align it to the unit-radius rim.
      halo.scale.setScalar(1.25);
      halo.renderOrder = 4;
      shockwave.add(halo);

      const rim = new THREE.Mesh(this.rimGeometry, flatMaterial(0xfff5cb));
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.007;
      rim.renderOrder = 5;
      shockwave.add(rim);

      const spikes = new THREE.Mesh(this.spikeGeometry, flatMaterial(0xffb91e));
      spikes.renderOrder = 4;
      shockwave.add(spikes);
      const innerSpikes = new THREE.Mesh(this.innerSpikeGeometry, flatMaterial(0xfff6b8));
      innerSpikes.renderOrder = 5;
      shockwave.add(innerSpikes);

      const debrisMaterial = flatMaterial(0xd2a078);
      const debris: FlatMesh[] = [];
      for (let j = 0; j < LANDING_DEBRIS_COUNT; j++) {
        const chip = new THREE.Mesh(this.debrisGeometry, debrisMaterial);
        chip.name = 'flying impact pebble ' + j;
        chip.visible = false;
        chip.renderOrder = 6;
        chip.rotation.set(j * 0.63, j * 1.07, j * 0.43);
        root.add(chip);
        debris.push(chip);
      }
      this.group.add(root);
      this.slots.push({
        root, shockwave, halo, rim, spikes, innerSpikes, debris,
        debrisMaterial, burst: null, age: 0,
      });
    }
  }

  /** Emit a single impact at ground-level world coordinates. */
  emit(position: Vec3Like, strength: number): void {
    if (this.disposed) throw new Error('LandingImpactRing is disposed');
    const burst = makeLandingRingBurst(position, strength);
    if (!burst) return;
    const slot = this.slots[this.nextSlot]!;
    this.nextSlot = (this.nextSlot + 1) % this.slots.length;
    slot.burst = burst;
    slot.age = 0;
    slot.root.position.set(burst.position.x, burst.position.y, burst.position.z);
    this.paint(slot);
  }

  /** Update by seconds; negative or non-finite deltas are rejected. */
  update(dt: number): void {
    if (this.disposed) throw new Error('LandingImpactRing is disposed');
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError('Landing ring dt must be finite and non-negative');
    }
    for (const slot of this.slots) {
      if (slot.burst) {
        slot.age += dt;
        this.paint(slot);
      }
    }
  }

  private paint(slot: RingSlot): void {
    const burst = slot.burst;
    if (!burst) return;
    const frame = sampleLandingRing(burst, slot.age);
    if (!frame) {
      slot.burst = null;
      slot.root.visible = false;
      return;
    }
    slot.root.visible = true;
    slot.shockwave.scale.setScalar(frame.radius);
    slot.halo.material.opacity = frame.glowOpacity;
    slot.rim.material.opacity = frame.ringOpacity;
    slot.spikes.material.opacity = frame.spikeOpacity;
    slot.innerSpikes.material.opacity = frame.spikeOpacity * 0.90;
    slot.spikes.scale.y = frame.spikeHeight;
    slot.innerSpikes.scale.y = frame.spikeHeight;
    slot.debrisMaterial.opacity = frame.debrisOpacity;
    for (let i = 0; i < slot.debris.length; i++) {
      const chip = slot.debris[i]!;
      const state = sampleLandingDebris(burst, i, slot.age);
      chip.visible = state !== null;
      if (state) {
        chip.position.set(state.offset.x, state.offset.y, state.offset.z);
        chip.scale.setScalar(state.scale);
        chip.rotation.y = i * 1.07 + slot.age * (2 + i * 0.22);
      }
    }
  }

  /** Number of actively animating impacts, not number of child meshes. */
  get activeCount(): number {
    return this.slots.reduce((sum, slot) => sum + Number(slot.burst !== null), 0);
  }

  /** Reuse existing meshes; does not disturb the caller's scene. */
  clear(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      slot.burst = null;
      slot.age = 0;
      slot.root.visible = false;
      for (const chip of slot.debris) chip.visible = false;
    }
  }

  /** Idempotent; frees only resources allocated by this effect. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    for (const slot of this.slots) {
      slot.halo.material.dispose();
      slot.rim.material.dispose();
      slot.spikes.material.dispose();
      slot.innerSpikes.material.dispose();
      slot.debrisMaterial.dispose();
      slot.root.removeFromParent();
    }
    this.planeGeometry.dispose();
    this.rimGeometry.dispose();
    this.spikeGeometry.dispose();
    this.innerSpikeGeometry.dispose();
    this.debrisGeometry.dispose();
    this.haloTexture.dispose();
    this.group.removeFromParent();
    this.disposed = true;
  }
}

export const createLandingImpactRing = (options?: LandingImpactRingOptions): LandingImpactRing =>
  new LandingImpactRing(options);
