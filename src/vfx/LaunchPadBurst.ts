import * as THREE from 'three';
import type { Vec3Like } from './dustMath';
import {
  LAUNCH_PAD_TOP_Y, launchFlightX, launchFlightY, makeLaunchPadBurstCue,
  makeLaunchPadBurstFrame, sampleLaunchPadBurst,
  type LaunchPadBurstCue, type LaunchPadBurstFrame,
} from './launchPadMath';

export interface LaunchPadBurstOptions {
  /** The game already renders the permanent platform. */
  effectsOnly?: boolean;
  /** Maximum overlapping launches; the oldest is recycled when full. */
  capacity?: number;
}

type BasicMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
interface LaunchSlot {
  readonly root: THREE.Group;
  readonly arrows: BasicMesh[];
  readonly arrowMaterial: THREE.MeshBasicMaterial;
  readonly fountain: BasicMesh;
  readonly trails: BasicMesh;
  readonly trailPositions: Float32Array;
  readonly glints: BasicMesh[];
  readonly frame: LaunchPadBurstFrame;
  cue: LaunchPadBurstCue | null;
  age: number;
}

const TAU = Math.PI * 2;
const TRAIL_COUNT = 4;
const TRAIL_SEGMENTS = 24;

/** Sharp, staggered yellow/amber tongues rising from the lit arrow surface. */
function makeFountainGeometry(): THREE.BufferGeometry {
  const points: number[] = [];
  const colors: number[] = [];
  const gold = new THREE.Color(0xffbb11);
  const lemon = new THREE.Color(0xffea2e);
  const pale = new THREE.Color(0xfff4a5);
  for (let i = 0; i < 23; i++) {
    const a = i / 22 * 2 - 1;
    const center = a * 1.18;
    const height = (0.44 + (1 - Math.abs(a)) * 0.79) *
      (0.79 + ((i * 7) % 9) * 0.052);
    const lean = Math.sign(a) * (0.07 + (i % 4) * 0.045);
    const width = 0.078 + (i % 3) * 0.022;
    const z = 0.05 + (i % 4) * 0.05;
    points.push(center - width, 0, z, center + width, 0, z,
      center + lean, height, z - 0.027);
    const color = i % 5 === 0 ? pale : i % 3 === 0 ? lemon : gold;
    for (let k = 0; k < 3; k++) colors.push(color.r, color.g, color.b);
  }
  // Lower orange roots make the spike fan read as a single violent eruption.
  const amber = new THREE.Color(0xf78f06);
  for (let i = 0; i < 10; i++) {
    const x = (i - 4.5) * 0.23;
    const z = -0.07 - (i % 2) * 0.04;
    points.push(x - 0.15, 0, z, x + 0.15, 0, z,
      x + (i - 4.5) * 0.045, 0.38 + (i % 4) * 0.12, z);
    for (let k = 0; k < 3; k++) colors.push(amber.r, amber.g, amber.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Directional chevron inset, repeated across the orange-gold launch face. */
function makeChevronGeometry(): THREE.ShapeGeometry {
  const arrow = new THREE.Shape();
  arrow.moveTo(-0.19, -0.20);
  arrow.lineTo(0.16, 0);
  arrow.lineTo(-0.19, 0.20);
  arrow.lineTo(-0.075, 0.20);
  arrow.lineTo(0.03, 0);
  arrow.lineTo(-0.075, -0.20);
  arrow.closePath();
  return new THREE.ShapeGeometry(arrow);
}

/** A tiny four-point sparkle stamped along the long gold streaks. */
function makeGlintGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.12, 0, 0, 0, 0.23, 0, 0.12, 0, 0,
    -0.12, 0, 0, 0.12, 0, 0, 0, -0.23, 0,
  ], 3));
  return geometry;
}

/** One dynamic ribbon buffer per pooled slot. Indices/colors never change. */
function makeTrailGeometry(): { geometry: THREE.BufferGeometry; positions: Float32Array } {
  const vertexCount = TRAIL_COUNT * (TRAIL_SEGMENTS + 1) * 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices: number[] = [];
  const tints = [0xffe237, 0xffae0c, 0xffd123, 0xfff39c] as const;
  for (let ribbon = 0; ribbon < TRAIL_COUNT; ribbon++) {
    const tint = new THREE.Color(tints[ribbon]!);
    const base = ribbon * (TRAIL_SEGMENTS + 1) * 2;
    for (let step = 0; step <= TRAIL_SEGMENTS; step++) {
      const v = base + step * 2;
      const c = v * 3;
      colors[c] = colors[c + 3] = tint.r;
      colors[c + 1] = colors[c + 4] = tint.g;
      colors[c + 2] = colors[c + 5] = tint.b;
      if (step < TRAIL_SEGMENTS) {
        indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return { geometry, positions };
}

function transparentMaterial(color: number, vertexColors = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, vertexColors, transparent: true, opacity: 0,
    side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  });
}

/**
 * Panel 07 · LAUNCH PAD BURST. Purely cosmetic: a low steel and amber pad
 * lights up its directional chevrons, erupts in tall gold points, then
 * paints long tapered gold flight ribbons behind an implied rising goat.
 *
 * The game owns the pad's collider and goat physics. Trigger at the pad's
 * ground center; horizontal direction steers the +X visual flight path.
 * All buffers, meshes, shared geometries and materials are made here,
 * not in update(); no renderer, canvas, listener or simulation is owned.
 */
export class LaunchPadBurst {
  readonly group = new THREE.Group();
  private readonly slots: LaunchSlot[] = [];

  private readonly baseGeometry = new THREE.CylinderGeometry(1, 1.06, 0.20, 8);
  private readonly underGeometry = new THREE.CylinderGeometry(1.045, 1.075, 0.095, 8);
  private readonly goldGeometry = new THREE.CylinderGeometry(0.93, 0.98, 0.064, 8);
  private readonly faceGeometry = new THREE.CylinderGeometry(0.84, 0.86, 0.030, 8);
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly rivetGeometry = new THREE.SphereGeometry(0.047, 7, 5);
  private readonly chevronGeometry = makeChevronGeometry();
  private readonly fountainGeometry = makeFountainGeometry();
  private readonly glintGeometry = makeGlintGeometry();

  private readonly steel = new THREE.MeshToonMaterial({ color: 0x8d90a3 });
  private readonly steelDark = new THREE.MeshToonMaterial({ color: 0x535669 });
  private readonly steelLight = new THREE.MeshToonMaterial({ color: 0xaeb0bd });
  private readonly copper = new THREE.MeshToonMaterial({ color: 0xc76d0b });
  private readonly gold = new THREE.MeshToonMaterial({ color: 0xffbd25 });
  private readonly inset = new THREE.MeshToonMaterial({ color: 0xf39a09 });
  private readonly glintMaterial = new THREE.MeshBasicMaterial({
    color: 0xffdc37, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  });

  private nextSlot = 0;
  private disposed = false;

  constructor(private readonly options: LaunchPadBurstOptions = {}) {
    const capacity = options.capacity ?? 6;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 32) {
      throw new RangeError('Launch pad capacity must be an integer in 1..32');
    }
    this.group.name = 'launch pad burst effects';
    for (let i = 0; i < capacity; i++) {
      const root = new THREE.Group();
      root.name = 'launch pad burst ' + i;
      root.visible = false;

      const add = (geometry: THREE.BufferGeometry, material: THREE.Material,
        name: string, x: number, y: number, z: number,
        sx: number, sy: number, sz: number): THREE.Mesh => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.position.set(x, y, z);
        mesh.scale.set(sx, sy, sz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        root.add(mesh);
        return mesh;
      };
      add(this.underGeometry, this.steelDark, 'dark steel undercarriage',
        0, 0.072, 0, 1.55, 1, 0.83);
      add(this.baseGeometry, this.steel, 'steel launch pad shell',
        0, 0.145, 0, 1.51, 1, 0.80);
      add(this.goldGeometry, this.gold, 'gold illuminated platform rim',
        0, 0.262, 0, 1.48, 1, 0.77);
      add(this.faceGeometry, this.inset, 'amber arrow deck',
        0, 0.293, 0, 1.46, 1, 0.75);

      // A steel front wall, orange central slot, and bolted grey corner plates
      // capture the rectangular beveled plinth in the approved illustration.
      add(this.boxGeometry, this.steelDark, 'dark front lip',
        0, 0.147, 0.617, 1.97, 0.14, 0.074);
      add(this.boxGeometry, this.copper, 'gold front lip',
        0, 0.183, 0.663, 1.40, 0.080, 0.060);
      for (let j = 0; j < 4; j++) {
        const x = j % 2 ? 1.14 : -1.14;
        const z = j < 2 ? 0.52 : -0.52;
        add(this.boxGeometry, j % 2 ? this.steelLight : this.steel,
          'riveted bevel corner plate', x, 0.242, z, 0.38, 0.17, 0.32);
        add(this.rivetGeometry, this.steelDark, 'metal corner rivet',
          x, 0.342, z, 1, 1, 1);
      }

      const arrowMaterial = transparentMaterial(0xfff49d);
      const arrows: BasicMesh[] = [];
      for (let j = 0; j < 3; j++) {
        const arrow = new THREE.Mesh(this.chevronGeometry, arrowMaterial);
        arrow.name = 'illuminated gold arrow face';
        arrow.rotation.x = Math.PI / 2;
        arrow.position.set((j - 1) * 0.51, LAUNCH_PAD_TOP_Y + 0.014, 0);
        arrow.renderOrder = 6;
        root.add(arrow);
        arrows.push(arrow);
      }

      if (options.effectsOnly) root.clear();
      const fountain = new THREE.Mesh(this.fountainGeometry,
        transparentMaterial(0xffffff, true));
      fountain.name = 'gold spiky launch fountain';
      fountain.position.y = LAUNCH_PAD_TOP_Y + 0.035;
      fountain.renderOrder = 8;
      root.add(fountain);

      const trail = makeTrailGeometry();
      const trails = new THREE.Mesh(trail.geometry, transparentMaterial(0xffffff, true));
      trails.name = 'long golden flight ribbon trails';
      trails.renderOrder = 7;
      trails.frustumCulled = false; // dynamic vertex bounds depend on the launch power
      root.add(trails);

      const glints: BasicMesh[] = [];
      for (let j = 0; j < 5; j++) {
        const glint = new THREE.Mesh(this.glintGeometry, this.glintMaterial);
        glint.name = 'gold flying glint';
        glint.rotation.z = j * 0.4;
        glint.renderOrder = 9;
        glint.visible = false;
        root.add(glint);
        glints.push(glint);
      }

      this.group.add(root);
      this.slots.push({
        root, arrows, arrowMaterial, fountain, trails, trailPositions: trail.positions,
        glints, frame: makeLaunchPadBurstFrame(), cue: null, age: 0,
      });
    }
  }

  /** One launch: ground center, direction of travel, and positive visual power. */
  emit(position: Vec3Like, direction: Vec3Like, strength: number): void {
    if (this.disposed) throw new Error('LaunchPadBurst is disposed');
    const cue = makeLaunchPadBurstCue(position, direction, strength);
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
    this.nextSlot = (index + 1) % this.slots.length;
    slot.cue = cue;
    slot.age = this.options.effectsOnly ? .19 * cue.lifetime : 0;
    slot.root.position.set(cue.position.x, cue.position.y, cue.position.z);
    slot.root.rotation.y = -Math.atan2(cue.direction.z, cue.direction.x);
    this.paint(slot);
  }

  /** Real elapsed seconds; a single large step equals many smaller steps. */
  update(dt: number): void {
    if (this.disposed) throw new Error('LaunchPadBurst is disposed');
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError('Launch pad dt must be finite and non-negative');
    }
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      if (!slot.cue) continue;
      slot.age += dt;
      this.paint(slot);
    }
  }

  private paint(slot: LaunchSlot): void {
    const cue = slot.cue;
    if (!cue) return;
    const frame = sampleLaunchPadBurst(cue, slot.age, slot.frame);
    if (!frame) {
      slot.root.visible = false;
      slot.cue = null;
      return;
    }
    slot.root.visible = true;
    slot.arrowMaterial.opacity = frame.arrowGlow;
    slot.fountain.visible = frame.fountainOpacity > 0.003;
    slot.fountain.material.opacity = frame.fountainOpacity;
    slot.fountain.scale.y = frame.fountainHeight;
    slot.trails.visible = frame.trailOpacity > 0.003 && frame.flightProgress > 0.015;
    slot.trails.material.opacity = frame.trailOpacity;
    if (slot.trails.visible) {
      this.paintTrails(slot, cue, frame.flightProgress);
    }
    for (let i = 0; i < slot.glints.length; i++) {
      const glint = slot.glints[i]!;
      const u = frame.flightProgress - 0.115 * (i + 1);
      glint.visible = frame.trailOpacity > 0.43 && u > 0.08;
      if (!glint.visible) continue;
      glint.position.set(launchFlightX(cue.strength, u) - 0.12,
        launchFlightY(cue.strength, u) + ((i % 2) ? -0.29 : 0.23),
        0.24 + i * 0.012);
      glint.scale.setScalar(0.45 + (i % 3) * 0.15);
    }
  }

  /** Rewrites existing typed arrays in place. All trails reach back along flight. */
  private paintTrails(slot: LaunchSlot, cue: LaunchPadBurstCue, head: number): void {
    const from = Math.max(0, head - 0.71);
    const data = slot.trailPositions;
    for (let ribbon = 0; ribbon < TRAIL_COUNT; ribbon++) {
      const base = ribbon * (TRAIL_SEGMENTS + 1) * 2 * 3;
      for (let step = 0; step <= TRAIL_SEGMENTS; step++) {
        const s = step / TRAIL_SEGMENTS;
        const u = from + (head - from) * s;
        const taper = Math.sin(Math.PI * s);
        const x = launchFlightX(cue.strength, u) -
          (ribbon % 2 ? 0.10 : 0.20) * taper;
        const y = launchFlightY(cue.strength, u) -
          0.12 + (ribbon - 1.5) * 0.135 * taper;
        const z = 0.12 + ribbon * 0.066;
        const half = 0.004 + (0.026 + (ribbon % 2) * 0.024) * taper;
        const at = base + step * 6;
        data[at] = x;
        data[at + 1] = y - half;
        data[at + 2] = z;
        data[at + 3] = x;
        data[at + 4] = y + half;
        data[at + 5] = z;
      }
    }
    slot.trails.geometry.getAttribute('position').needsUpdate = true;
  }

  get activeCount(): number {
    let count = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]!.cue) count++;
    return count;
  }

  clear(): void {
    if (this.disposed) return;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      slot.cue = null;
      slot.age = 0;
      slot.root.visible = false;
      slot.fountain.visible = false;
      slot.trails.visible = false;
      for (let j = 0; j < slot.glints.length; j++) slot.glints[j]!.visible = false;
    }
    this.nextSlot = 0;
  }

  /** Idempotent and never disposes an external renderer or scene. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      slot.arrowMaterial.dispose();
      slot.fountain.material.dispose();
      slot.trails.material.dispose();
      slot.trails.geometry.dispose();
      slot.root.removeFromParent();
    }
    this.baseGeometry.dispose();
    this.underGeometry.dispose();
    this.goldGeometry.dispose();
    this.faceGeometry.dispose();
    this.boxGeometry.dispose();
    this.rivetGeometry.dispose();
    this.chevronGeometry.dispose();
    this.fountainGeometry.dispose();
    this.glintGeometry.dispose();
    this.steel.dispose();
    this.steelDark.dispose();
    this.steelLight.dispose();
    this.copper.dispose();
    this.gold.dispose();
    this.inset.dispose();
    this.glintMaterial.dispose();
    this.group.removeFromParent();
    this.disposed = true;
  }
}

export const createLaunchPadBurst = (options?: LaunchPadBurstOptions): LaunchPadBurst =>
  new LaunchPadBurst(options);
