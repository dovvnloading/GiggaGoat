import * as THREE from 'three';
import type { Vec3Like } from './dustMath';
import {
  WATER_DROPLET_COUNT, makeWaterSplashBurst, sampleWaterDroplet, sampleWaterSplash,
  type WaterSplashBurst,
} from './waterSplashMath';

export interface WaterSplashOptions {
  /** Maximum overlapping splashes; the oldest slot is recycled when full. */
  capacity?: number;
}

type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

interface WaterSlot {
  readonly root: THREE.Group;
  readonly ripple: THREE.Group;
  readonly halo: FlatMesh;
  readonly outerRing: FlatMesh;
  readonly innerRing: FlatMesh;
  readonly foam: FlatMesh;
  readonly crown: THREE.Group;
  readonly jets: FlatMesh;
  readonly innerJets: FlatMesh;
  readonly droplets: THREE.Sprite[];
  burst: WaterSplashBurst | null;
  age: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Ground-hugging, anti-aliased cyan concentric-ripple glow. */
function makeRippleTexture(): THREE.DataTexture {
  const side = 192;
  const bytes = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const u = (x + 0.5) * 2 / side - 1;
      const v = (y + 0.5) * 2 / side - 1;
      const r = Math.hypot(u, v);
      const white = Math.exp(-(((r - 0.80) / 0.025) ** 2));
      const blue = Math.exp(-(((r - 0.79) / 0.072) ** 2));
      const wash = Math.exp(-(((r - 0.73) / 0.22) ** 2));
      const at = (y * side + x) * 4;
      bytes[at] = Math.min(255, Math.round(20 + 230 * white + 42 * blue));
      bytes[at + 1] = Math.min(255, Math.round(147 + 106 * white + 37 * blue));
      bytes[at + 2] = 255;
      bytes[at + 3] = Math.round(255 * clamp01(0.90 * white + 0.46 * blue + 0.17 * wash));
    }
  }
  return makeTexture(bytes, side, 'water splash azure ripple glow');
}

/** Upright translucent blue teardrops with an icy-white specular glint. */
function makeDropletTexture(): THREE.DataTexture {
  const side = 96;
  const bytes = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const u = (x + 0.5) * 2 / side - 1;
      const v = 1 - (y + 0.5) * 2 / side;
      const width = v < 0
        ? 0.43 * Math.sqrt(Math.max(0, 1 - ((v + 0.25) / 0.60) ** 2))
        : 0.39 * Math.max(0, 1 - v / 0.85);
      const edge = width - Math.abs(u);
      const alpha = clamp01(edge * 85) * clamp01((v + 0.85) * 85) *
        clamp01((0.85 - v) * 85);
      const rim = 1 - clamp01(edge * 13);
      const shine = Math.exp(-(((u + 0.13) / 0.09) ** 2 + ((v + 0.04) / 0.24) ** 2));
      const at = (y * side + x) * 4;
      bytes[at] = Math.round(40 + 165 * shine + 9 * rim);
      bytes[at + 1] = Math.round(175 + 74 * shine - 29 * rim);
      bytes[at + 2] = 255;
      bytes[at + 3] = Math.round(255 * alpha);
    }
  }
  return makeTexture(bytes, side, 'water splash glossy teardrop');
}

function makeTexture(bytes: Uint8Array, side: number, name: string): THREE.DataTexture {
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

/** Curved, tapered radial ribbons: dark-blue edges, bright cyan centers.
 * The shorter staggered inner layer fills the open crown with ice-blue foam.
 * Built once and shared by every active splash, not rebuilt in update().
 */
function makeCrownGeometry(inner: boolean): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const count = inner ? 9 : 12;
  const segments = 9;
  const edge = new THREE.Color(inner ? 0x1bb8eb : 0x008fd7);
  const center = new THREE.Color(inner ? 0xf0ffff : 0x9befff);
  const right = new THREE.Color(inner ? 0x7be2fc : 0x36c5f6);
  for (let arm = 0; arm < count; arm++) {
    const angle = (arm + (inner ? 0.46 : 0)) * 2 * Math.PI / count +
      Math.sin(arm * 2.31) * 0.10;
    const cx = Math.cos(angle);
    const cz = Math.sin(angle);
    const tx = -cz;
    const tz = cx;
    const reach = (0.80 + (arm % 4) * 0.085) * (inner ? 0.73 : 1);
    const lift = (0.66 + (arm % 5) * 0.10) * (inner ? 0.61 : 1);
    const start = positions.length / 3;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const r = 0.14 + reach * (0.23 * t + 0.72 * t * t);
      const h = lift * (1.38 * t - 0.30 * t * t);
      const w = (inner ? 0.19 : 0.28) * (1 - 0.52 * t) *
        (1 - Math.max(0, (t - 0.86) / 0.14) ** 1.3) + 0.006;
      const bend = Math.sin(arm * 1.8 + t * 2.0) * 0.045 * t;
      for (let k = -1; k <= 1; k++) {
        positions.push(cx * r + tx * (k * w + bend), h,
          cz * r + tz * (k * w + bend));
        const color = k === -1 ? edge : k === 0 ? center : right;
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let s = 0; s < segments; s++) {
      for (let k = 0; k < 2; k++) {
        const a = start + s * 3 + k;
        const b = a + 3;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function flatMaterial(color: number, map?: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, map: map ?? null, side: THREE.DoubleSide, transparent: true, opacity: 0,
    depthWrite: false, toneMapped: false,
  });
}

/** Standalone, cosmetic WATER SPLASH matching approved panel four.
 * `emit(surfacePosition, entrySpeed, relativeMass)` accepts Vector3 or {x,y,z}.
 * No renderer, physics, DOM, canvas, image loads or per-frame GPU allocation.
 */
export class WaterSplash {
  readonly group = new THREE.Group();
  private readonly rippleTexture = makeRippleTexture();
  private readonly dropletTexture = makeDropletTexture();
  private readonly planeGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly outerRingGeometry = new THREE.RingGeometry(0.965, 1.015, 96);
  private readonly innerRingGeometry = new THREE.RingGeometry(0.77, 0.81, 96);
  private readonly foamGeometry = new THREE.RingGeometry(0.31, 0.53, 72);
  private readonly crownGeometry = makeCrownGeometry(false);
  private readonly innerCrownGeometry = makeCrownGeometry(true);
  private readonly slots: WaterSlot[] = [];
  private nextSlot = 0;
  private disposed = false;

  constructor(options: WaterSplashOptions = {}) {
    const capacity = options.capacity ?? 12;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) {
      throw new RangeError('Water splash capacity must be an integer in 1..64');
    }
    this.group.name = 'water splashes';
    for (let i = 0; i < capacity; i++) {
      const root = new THREE.Group();
      root.name = 'water splash ' + i;
      root.visible = false;
      const ripple = new THREE.Group();
      ripple.position.y = 0.026;
      root.add(ripple);
      const halo = new THREE.Mesh(this.planeGeometry, flatMaterial(0xffffff, this.rippleTexture));
      halo.rotation.x = -Math.PI / 2;
      halo.scale.setScalar(1.25);
      halo.renderOrder = 5;
      ripple.add(halo);
      const outerRing = new THREE.Mesh(this.outerRingGeometry, flatMaterial(0x29aafb));
      outerRing.rotation.x = -Math.PI / 2;
      outerRing.position.y = 0.007;
      outerRing.renderOrder = 6;
      ripple.add(outerRing);
      const innerRing = new THREE.Mesh(this.innerRingGeometry, flatMaterial(0xd3fcff));
      innerRing.rotation.x = -Math.PI / 2;
      innerRing.position.y = 0.011;
      innerRing.renderOrder = 7;
      ripple.add(innerRing);
      const foam = new THREE.Mesh(this.foamGeometry, flatMaterial(0xb8f6ff));
      foam.rotation.x = -Math.PI / 2;
      foam.position.y = 0.042;
      foam.renderOrder = 8;
      root.add(foam);
      const crown = new THREE.Group();
      crown.position.y = 0.04;
      root.add(crown);
      const jets = new THREE.Mesh(this.crownGeometry, flatMaterial(0xffffff));
      jets.material.vertexColors = true;
      jets.renderOrder = 9;
      crown.add(jets);
      const innerJets = new THREE.Mesh(this.innerCrownGeometry, flatMaterial(0xffffff));
      innerJets.material.vertexColors = true;
      innerJets.renderOrder = 10;
      crown.add(innerJets);
      const droplets: THREE.Sprite[] = [];
      for (let j = 0; j < WATER_DROPLET_COUNT; j++) {
        const drop = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.dropletTexture, transparent: true, opacity: 0,
          depthWrite: false, toneMapped: false,
        }));
        drop.name = 'flying water droplet ' + j;
        drop.visible = false;
        drop.renderOrder = 11;
        root.add(drop);
        droplets.push(drop);
      }
      this.group.add(root);
      this.slots.push({
        root, ripple, halo, outerRing, innerRing, foam, crown, jets, innerJets,
        droplets, burst: null, age: 0,
      });
    }
  }

  /** One entry at a water surface: speed in world units/s, mass relative to a goat. */
  emit(position: Vec3Like, speed: number, mass: number): void {
    if (this.disposed) throw new Error('WaterSplash is disposed');
    const burst = makeWaterSplashBurst(position, speed, mass);
    if (!burst) return;
    const slot = this.slots[this.nextSlot]!;
    this.nextSlot = (this.nextSlot + 1) % this.slots.length;
    slot.burst = burst;
    slot.age = 0;
    slot.root.position.set(burst.position.x, burst.position.y, burst.position.z);
    this.paint(slot);
  }

  /** Delta-time in seconds, with absolute-age motion independent of frame rate. */
  update(dt: number): void {
    if (this.disposed) throw new Error('WaterSplash is disposed');
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError('Water splash dt must be finite and non-negative');
    }
    for (const slot of this.slots) {
      if (!slot.burst) continue;
      slot.age += dt;
      this.paint(slot);
    }
  }

  private paint(slot: WaterSlot): void {
    const burst = slot.burst;
    if (!burst) return;
    const frame = sampleWaterSplash(burst, slot.age);
    if (!frame) {
      slot.burst = null;
      slot.root.visible = false;
      for (const drop of slot.droplets) drop.visible = false;
      return;
    }
    slot.root.visible = true;
    slot.ripple.scale.setScalar(frame.rippleRadius);
    slot.halo.material.opacity = frame.haloOpacity;
    slot.outerRing.material.opacity = frame.rippleOpacity;
    slot.innerRing.material.opacity = frame.rippleOpacity * 0.82;
    slot.foam.scale.setScalar(frame.crownRadius);
    slot.foam.material.opacity = frame.foamOpacity * 0.85;
    slot.crown.scale.set(frame.crownRadius, frame.crownHeight, frame.crownRadius);
    slot.jets.material.opacity = frame.crownOpacity * 0.90;
    slot.innerJets.material.opacity = frame.crownOpacity * 0.93;
    slot.crown.visible = frame.crownOpacity > 0.002;
    for (let j = 0; j < slot.droplets.length; j++) {
      const drop = slot.droplets[j]!;
      const sample = sampleWaterDroplet(burst, j, slot.age);
      drop.visible = sample !== null;
      if (!sample) continue;
      drop.position.set(sample.offset.x, sample.offset.y, sample.offset.z);
      drop.scale.set(sample.size * 0.70, sample.size * 1.18, 1);
      drop.material.opacity = sample.opacity;
      drop.material.rotation = sample.rotation;
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
      for (const drop of slot.droplets) drop.visible = false;
    }
  }

  /** Idempotently free only effect-owned GPU resources. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    for (const slot of this.slots) {
      slot.halo.material.dispose();
      slot.outerRing.material.dispose();
      slot.innerRing.material.dispose();
      slot.foam.material.dispose();
      slot.jets.material.dispose();
      slot.innerJets.material.dispose();
      for (const drop of slot.droplets) drop.material.dispose();
      slot.root.removeFromParent();
    }
    this.rippleTexture.dispose();
    this.dropletTexture.dispose();
    this.planeGeometry.dispose();
    this.outerRingGeometry.dispose();
    this.innerRingGeometry.dispose();
    this.foamGeometry.dispose();
    this.crownGeometry.dispose();
    this.innerCrownGeometry.dispose();
    this.group.removeFromParent();
    this.disposed = true;
  }
}

export const createWaterSplash = (options?: WaterSplashOptions): WaterSplash =>
  new WaterSplash(options);
