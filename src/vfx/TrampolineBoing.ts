import * as THREE from 'three';
import type { Vec3Like } from './dustMath';
import {
  makeTrampolineBoingBurst, makeTrampolineBoingFrame, sampleTrampolineBoing,
  TRAMPOLINE_MAT_Y, type TrampolineBoingBurst, type TrampolineBoingFrame,
} from './trampolineBoingMath';

export interface TrampolineBoingOptions {
  /** Maximum overlapping bounces. A full pool recycles its oldest bounce. */
  capacity?: number;
}

type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

interface TrampolineSlot {
  readonly root: THREE.Group;
  readonly mat: FlatMesh;
  readonly matWeights: Float32Array;
  readonly rays: FlatMesh;
  readonly arcs: FlatMesh;
  readonly arrow: FlatMesh;
  readonly frame: TrampolineBoingFrame;
  burst: TrampolineBoingBurst | null;
  age: number;
  lastDip: number;
}

const TAU = Math.PI * 2;
const MAT_RADIUS = 0.885;
const BANDS = [
  0xffeee0, 0xf05365, 0xfff8e8, 0xe83e60,
  0xfff1e2, 0xee4f63, 0xffebcf, 0xc74165,
] as const;

function makeMatGeometry(): { geometry: THREE.BufferGeometry; weights: Float32Array } {
  // Per-slot vertex positions deform; colors and all OTHER geometry/materials
  // are shared. A 40-sided, eight-band disc reads as a striped bullseye.
  const radii = [0, 0.13, 0.24, 0.38, 0.52, 0.65, 0.78, 0.91, 1];
  const positions: number[] = [];
  const colors: number[] = [];
  const weights: number[] = [];
  const segments = 40;
  for (let band = 0; band < BANDS.length; band++) {
    const tint = new THREE.Color(BANDS[band]!);
    const inner = radii[band]!;
    const outer = radii[band + 1]!;
    for (let step = 0; step < segments; step++) {
      const a = step * TAU / segments;
      const b = (step + 1) * TAU / segments;
      const corners = [
        [inner, a], [outer, a], [outer, b],
        [inner, a], [outer, b], [inner, b],
      ];
      for (const [radius, angle] of corners) {
        const r = radius!;
        positions.push(Math.cos(angle!) * r * MAT_RADIUS, TRAMPOLINE_MAT_Y,
          Math.sin(angle!) * r * MAT_RADIUS);
        colors.push(tint.r, tint.g, tint.b);
        weights.push((1 - r * r) ** 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.Float32BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return { geometry, weights: new Float32Array(weights) };
}

/** Flat, tapered orange-yellow streaks rising from both sides of the rim. */
function makeRaysGeometry(): THREE.BufferGeometry {
  const points: number[] = [];
  const colors: number[] = [];
  const amber = new THREE.Color(0xffa811);
  const bright = new THREE.Color(0xffdb35);
  for (let i = 0; i < 14; i++) {
    const side = i < 7 ? -1 : 1;
    const k = i % 7;
    const x = side * (0.20 + k * 0.13);
    const z = -0.30 + (k % 3) * 0.20;
    const y = TRAMPOLINE_MAT_Y + 0.035;
    const tipX = x + side * (0.09 + k * 0.075);
    const tipY = y + 0.36 + (k % 4) * 0.16 + (k === 3 ? 0.17 : 0);
    const width = 0.065 + (k % 3) * 0.012;
    points.push(x - width, y, z, x + width, y, z, tipX, tipY, z - 0.015);
    const tint = i % 3 === 0 ? bright : amber;
    for (let j = 0; j < 3; j++) colors.push(tint.r, tint.g, tint.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Four gently S-curved purple ribbon trails, behind the rising goat. */
function makeArcsGeometry(): THREE.BufferGeometry {
  const points: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const violet = new THREE.Color(0x9156b9);
  const lilac = new THREE.Color(0xc794e0);
  const segments = 16;
  for (let trail = 0; trail < 4; trail++) {
    const sign = trail < 2 ? -1 : 1;
    const layer = trail % 2;
    const x0 = sign * (0.66 + layer * 0.20);
    const start = points.length / 3;
    const color = layer === 0 ? violet : lilac;
    for (let step = 0; step <= segments; step++) {
      const t = step / segments;
      const x = x0 + sign * (0.25 * Math.sin(Math.PI * t) + 0.13 * t);
      const y = 0.14 + 2.04 * t;
      const z = -0.36 - layer * 0.055;
      const width = 0.007 + 0.045 * Math.sin(Math.PI * t);
      points.push(x - width, y, z, x + width, y, z);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      if (step < segments) {
        const a = start + step * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Solid gold downward cue visible only while the mat is compressing. */
function makeArrowGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.055, 0.32, 0, 0.055, 0.32, 0, 0.055, 0.11, 0,
    -0.055, 0.32, 0, 0.055, 0.11, 0, -0.055, 0.11, 0,
    -0.20, 0.14, 0, 0.20, 0.14, 0, 0, -0.09, 0,
  ], 3));
  return geometry;
}

function trailMaterial(color: number, vertexColors = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, vertexColors, side: THREE.DoubleSide, transparent: true,
    opacity: 0, depthWrite: false, toneMapped: false,
  });
}

/**
 * Panel 06 · TRAMPOLINE BOING: a striped red/cream target mat depresses, snaps
 * back with gold speed rays, then leaves lilac/violet upward motion arcs.
 *
 * This is only the visual cue; the caller owns the actual trampoline collider
 * and vertical velocity. Y is up; emit at the grounded CENTER of the platform.
 * All resources are created in the constructor; paint/update allocate nothing.
 */
export class TrampolineBoing {
  readonly group = new THREE.Group();
  private readonly slots: TrampolineSlot[] = [];
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly cylinderGeometry = new THREE.CylinderGeometry(0.085, 0.122, 0.48, 8);
  private readonly footGeometry = new THREE.CylinderGeometry(0.16, 0.19, 0.075, 9);
  private readonly bodyGeometry = new THREE.CylinderGeometry(0.955, 0.91, 0.13, 48);
  private readonly purpleGeometry = new THREE.TorusGeometry(0.965, 0.103, 8, 64);
  private readonly blueGeometry = new THREE.TorusGeometry(0.97, 0.031, 6, 64);
  private readonly innerRimGeometry = new THREE.TorusGeometry(0.88, 0.032, 6, 64);
  private readonly raysGeometry = makeRaysGeometry();
  private readonly arcsGeometry = makeArcsGeometry();
  private readonly arrowGeometry = makeArrowGeometry();
  private readonly matMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide,
  });
  private readonly purpleMaterial = new THREE.MeshToonMaterial({ color: 0x70449b });
  private readonly blueMaterial = new THREE.MeshToonMaterial({ color: 0x4363b2 });
  private readonly coralMaterial = new THREE.MeshToonMaterial({ color: 0xdb4965 });
  private readonly goldMaterial = new THREE.MeshToonMaterial({ color: 0xffb52c });
  private readonly woodMaterial = new THREE.MeshToonMaterial({ color: 0xa86a35 });
  private readonly woodLightMaterial = new THREE.MeshToonMaterial({ color: 0xd79443 });
  private nextSlot = 0;
  private disposed = false;

  constructor(options: TrampolineBoingOptions = {}) {
    const capacity = options.capacity ?? 6;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 32) {
      throw new RangeError('Trampoline capacity must be an integer in 1..32');
    }
    this.group.name = 'trampoline boing effects';
    const axis = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < capacity; i++) {
      const root = new THREE.Group();
      root.name = 'trampoline boing ' + i;
      root.visible = false;

      const body = new THREE.Mesh(this.bodyGeometry, this.purpleMaterial);
      body.position.y = 0.475;
      body.castShadow = true;
      root.add(body);

      const matData = makeMatGeometry();
      const mat = new THREE.Mesh(matData.geometry, this.matMaterial);
      mat.name = 'deforming red cream bullseye trampoline mat';
      mat.receiveShadow = true;
      root.add(mat);

      const addRim = (geometry: THREE.BufferGeometry,
        material: THREE.MeshToonMaterial, y: number): void => {
        const rim = new THREE.Mesh(geometry, material);
        rim.rotation.x = -Math.PI / 2;
        rim.position.y = y;
        rim.castShadow = true;
        root.add(rim);
      };
      addRim(this.innerRimGeometry, this.coralMaterial, 0.545);
      addRim(this.purpleGeometry, this.purpleMaterial, 0.55);
      addRim(this.blueGeometry, this.blueMaterial, 0.60);

      for (let j = 0; j < 8; j++) {
        const angle = j * TAU / 8;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const clip = new THREE.Mesh(this.boxGeometry, this.goldMaterial);
        clip.name = 'gold rim clamp ' + j;
        clip.position.set(c * 0.97, 0.588, s * 0.97);
        clip.scale.set(0.19, 0.088, 0.20);
        clip.rotation.y = -angle;
        root.add(clip);
      }

      for (let j = 0; j < 4; j++) {
        const angle = Math.PI / 4 + j * TAU / 4;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const top = new THREE.Vector3(c * 0.77, 0.46, s * 0.77);
        const bottom = new THREE.Vector3(c * 0.94, 0.105, s * 0.94);
        const direction = top.clone().sub(bottom).normalize();
        const leg = new THREE.Mesh(this.cylinderGeometry,
          j % 2 ? this.woodLightMaterial : this.woodMaterial);
        leg.name = 'splayed wooden trampoline leg ' + j;
        leg.position.copy(top).add(bottom).multiplyScalar(0.5);
        leg.quaternion.setFromUnitVectors(axis, direction);
        leg.castShadow = true;
        root.add(leg);
        const foot = new THREE.Mesh(this.footGeometry, this.woodMaterial);
        foot.position.set(bottom.x, 0.065, bottom.z);
        foot.castShadow = true;
        root.add(foot);
      }

      const rays = new THREE.Mesh(this.raysGeometry, trailMaterial(0xffffff, true));
      rays.name = 'gold rim rebound speed-line fan';
      rays.renderOrder = 9;
      root.add(rays);
      const arcs = new THREE.Mesh(this.arcsGeometry, trailMaterial(0xffffff, true));
      arcs.name = 'purple motion arcs trailing launched goat';
      arcs.position.y = TRAMPOLINE_MAT_Y;
      arcs.renderOrder = 8;
      root.add(arcs);
      const arrow = new THREE.Mesh(this.arrowGeometry, trailMaterial(0xffc21d));
      arrow.name = 'yellow downward squash cue';
      arrow.position.set(-1.23, 1.34, 0.50);
      arrow.renderOrder = 11;
      root.add(arrow);

      this.group.add(root);
      this.slots.push({
        root, mat, matWeights: matData.weights, rays, arcs, arrow,
        frame: makeTrampolineBoingFrame(), burst: null, age: 0, lastDip: NaN,
      });
    }
  }

  /** Trigger a cosmetic bounce from the platform's ground center. */
  emit(position: Vec3Like, scale: number, strength: number): void {
    if (this.disposed) throw new Error('TrampolineBoing is disposed');
    const burst = makeTrampolineBoingBurst(position, scale, strength);
    if (!burst) return;
    // Prefer a free slot. If none are free, recycle the longest-running bounce.
    let index = -1;
    let oldestAge = -1;
    for (let offset = 0; offset < this.slots.length; offset++) {
      const candidate = (this.nextSlot + offset) % this.slots.length;
      const slot = this.slots[candidate]!;
      if (!slot.burst) { index = candidate; break; }
      if (slot.age > oldestAge) { oldestAge = slot.age; index = candidate; }
    }
    const slot = this.slots[index]!;
    this.nextSlot = (index + 1) % this.slots.length;
    slot.burst = burst;
    slot.age = 0;
    slot.lastDip = NaN;
    slot.root.position.set(burst.position.x, burst.position.y, burst.position.z);
    slot.root.scale.setScalar(burst.scale);
    this.paint(slot);
  }

  /** Seconds since the last render frame, independent of the engine's tick rate. */
  update(dt: number): void {
    if (this.disposed) throw new Error('TrampolineBoing is disposed');
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError('Trampoline dt must be finite and non-negative');
    }
    for (const slot of this.slots) {
      if (!slot.burst) continue;
      slot.age += dt;
      this.paint(slot);
    }
  }

  private paint(slot: TrampolineSlot): void {
    const burst = slot.burst;
    if (!burst) return;
    const frame = sampleTrampolineBoing(burst, slot.age, slot.frame);
    if (!frame) {
      slot.burst = null;
      slot.root.visible = false;
      return;
    }
    slot.root.visible = true;
    if (slot.lastDip !== frame.matDip) {
      const position = slot.mat.geometry.getAttribute('position') as THREE.BufferAttribute;
      const values = position.array as Float32Array;
      for (let j = 0; j < slot.matWeights.length; j++) {
        values[j * 3 + 1] = TRAMPOLINE_MAT_Y - frame.matDip * slot.matWeights[j]!;
      }
      position.needsUpdate = true;
      slot.lastDip = frame.matDip;
    }
    slot.rays.visible = frame.burstOpacity > 0.002;
    slot.rays.material.opacity = frame.burstOpacity;
    // Scale relative to the rim height, not the scene origin.
    slot.rays.scale.y = 0.60 + 0.65 * frame.burstHeight;
    slot.arcs.visible = frame.arcOpacity > 0.002;
    slot.arcs.material.opacity = frame.arcOpacity;
    slot.arcs.scale.y = frame.arcHeight;
    slot.arrow.visible = frame.arrowOpacity > 0.002;
    slot.arrow.material.opacity = frame.arrowOpacity;
  }

  get activeCount(): number {
    let count = 0;
    for (const slot of this.slots) if (slot.burst) count++;
    return count;
  }

  clear(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      slot.burst = null;
      slot.age = 0;
      slot.root.visible = false;
      slot.rays.visible = false;
      slot.arcs.visible = false;
      slot.arrow.visible = false;
      slot.lastDip = NaN;
    }
    this.nextSlot = 0;
  }

  /** Idempotent; never disposes any scene object owned by the caller. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    for (const slot of this.slots) {
      slot.mat.geometry.dispose();
      slot.rays.material.dispose();
      slot.arcs.material.dispose();
      slot.arrow.material.dispose();
      slot.root.removeFromParent();
    }
    this.boxGeometry.dispose();
    this.cylinderGeometry.dispose();
    this.footGeometry.dispose();
    this.bodyGeometry.dispose();
    this.purpleGeometry.dispose();
    this.blueGeometry.dispose();
    this.innerRimGeometry.dispose();
    this.raysGeometry.dispose();
    this.arcsGeometry.dispose();
    this.arrowGeometry.dispose();
    this.matMaterial.dispose();
    this.purpleMaterial.dispose();
    this.blueMaterial.dispose();
    this.coralMaterial.dispose();
    this.goldMaterial.dispose();
    this.woodMaterial.dispose();
    this.woodLightMaterial.dispose();
    this.group.removeFromParent();
    this.disposed = true;
  }
}

export const createTrampolineBoing = (options?: TrampolineBoingOptions): TrampolineBoing =>
  new TrampolineBoing(options);
