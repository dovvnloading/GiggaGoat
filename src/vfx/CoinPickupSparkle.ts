import * as THREE from 'three';
import type { Vec3Like } from './dustMath';
import {
  COIN_SPARKLE_COUNT, makeCoinPickupCue, makeCoinPickupFrame,
  sampleCoinPickup, type CoinPickupCue, type CoinPickupFrame,
} from './coinPickupMath';

export interface CoinPickupSparkleOptions {
  /** Overlapping pickups, oldest active burst recycled when full (1–24). */
  capacity?: number;
}

interface CoinArt {
  readonly edge: THREE.CylinderGeometry;
  readonly face: THREE.CircleGeometry;
  readonly inset: THREE.CircleGeometry;
  readonly inner: THREE.CircleGeometry;
  readonly rim: THREE.TorusGeometry;
  readonly innerRim: THREE.TorusGeometry;
  readonly hornOuter: THREE.TubeGeometry;
  readonly hornHighlight: THREE.TubeGeometry;
  readonly orbit: THREE.TorusGeometry;
  readonly orbitCore: THREE.TorusGeometry;
  readonly star: THREE.DataTexture;
  readonly metal: THREE.MeshToonMaterial;
  readonly faceGold: THREE.MeshToonMaterial;
  readonly orange: THREE.MeshToonMaterial;
  readonly lemon: THREE.MeshToonMaterial;
  readonly outline: THREE.MeshToonMaterial;
  readonly crest: THREE.MeshToonMaterial;
  readonly crestLight: THREE.MeshBasicMaterial;
}

interface CoinSlot {
  readonly root: THREE.Group;
  readonly coin: THREE.Group;
  readonly swoosh: THREE.Group;
  readonly goldOrbitMaterial: THREE.MeshBasicMaterial;
  readonly whiteOrbitMaterial: THREE.MeshBasicMaterial;
  readonly sparkleMaterial: THREE.SpriteMaterial;
  readonly stars: THREE.Sprite[];
  readonly frame: CoinPickupFrame;
  readonly targetWorld: THREE.Vector3;
  cue: CoinPickupCue | null;
  target: THREE.Object3D | null;
  age: number;
}

// An intentionally hand-composed arrangement: a few large four-point stars,
// interleaved with tiny twinkles, rather than an even circle of particles.
// X and Y are the camera-facing image plane, Z provides a little depth.
const STAR_LAYOUT = [
  { x: -1.15, y: 0.81, z: 0.12, size: 0.42 },
  { x: -0.72, y: 1.23, z: 0.17, size: 0.16 },
  { x: 0.08, y: 1.24, z: 0.17, size: 0.72 },
  { x: 1.10, y: 1.14, z: 0.08, size: 0.24 },
  { x: 1.45, y: 0.58, z: 0.06, size: 0.40 },
  { x: 1.18, y: -0.17, z: 0.17, size: 0.91 },
  { x: 0.18, y: -0.75, z: 0.12, size: 0.39 },
  { x: -0.93, y: -0.64, z: 0.19, size: 0.22 },
  { x: -0.46, y: 0.21, z: 0.20, size: 0.14 },
  { x: 0.52, y: 0.48, z: 0.16, size: 0.17 },
  { x: 0.72, y: -0.30, z: 0.20, size: 0.12 },
  { x: -1.38, y: -0.17, z: 0.15, size: 0.17 },
] as const;

/** GPU-uploaded once: white-gold star face with a crisp amber four-point rim. */
function starTexture(): THREE.DataTexture {
  const size = 96;
  const pixels = new Uint8Array(size * size * 4);
  const clamp = (value: number): number => Math.max(0, Math.min(1, value));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ax = Math.abs((x + 0.5 - size / 2) / (size * 0.45));
      const ay = Math.abs((y + 0.5 - size / 2) / (size * 0.45));
      // Concave quarter-curves between the four long cardinal tips.
      const edge = Math.pow(ax, 0.56) + Math.pow(ay, 0.56);
      const opaque = clamp((1.025 - edge) * 24);
      const glow = Math.exp(-6.2 * (ax * ax + ay * ay)) * 0.16;
      const white = clamp((0.76 - edge) * 7.3);
      const n = (y * size + x) * 4;
      pixels[n] = 255;
      pixels[n + 1] = Math.round(187 + 67 * white);
      pixels[n + 2] = Math.round(13 + 236 * white);
      pixels[n + 3] = Math.round(255 * Math.max(opaque, glow));
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Curled paired horn/hoof mark, extruded slightly above the stamped inset. */
function hornCurve(): THREE.CatmullRomCurve3 {
  const points = [
    [-0.038, -0.265], [-0.105, -0.128], [-0.112, 0.015],
    [-0.156, 0.146], [-0.252, 0.187], [-0.319, 0.128],
    [-0.319, 0.036], [-0.254, -0.018], [-0.194, 0.046],
  ];
  return new THREE.CatmullRomCurve3(
    points.map(([x, y]) => new THREE.Vector3(x!, y!, 0)),
    false, 'centripetal',
  );
}

function makeArt(): CoinArt {
  const horn = hornCurve();
  return {
    edge: new THREE.CylinderGeometry(0.535, 0.535, 0.162, 44),
    face: new THREE.CircleGeometry(0.514, 44),
    inset: new THREE.CircleGeometry(0.446, 44),
    inner: new THREE.CircleGeometry(0.403, 44),
    rim: new THREE.TorusGeometry(0.508, 0.023, 7, 56),
    innerRim: new THREE.TorusGeometry(0.435, 0.025, 7, 56),
    hornOuter: new THREE.TubeGeometry(horn, 36, 0.059, 7, false),
    hornHighlight: new THREE.TubeGeometry(horn, 36, 0.032, 7, false),
    orbit: new THREE.TorusGeometry(0.81, 0.022, 6, 74, Math.PI * 1.77),
    orbitCore: new THREE.TorusGeometry(0.85, 0.011, 5, 74, Math.PI * 1.69),
    star: starTexture(),
    metal: new THREE.MeshToonMaterial({ color: 0xb9680c }),
    faceGold: new THREE.MeshToonMaterial({ color: 0xffd02e }),
    orange: new THREE.MeshToonMaterial({ color: 0xf49c07 }),
    lemon: new THREE.MeshToonMaterial({ color: 0xffe054 }),
    outline: new THREE.MeshToonMaterial({ color: 0xc36b09 }),
    crest: new THREE.MeshToonMaterial({ color: 0xc36a06 }),
    crestLight: new THREE.MeshBasicMaterial({ color: 0xffef8b, toneMapped: false }),
  };
}

function addCoinFace(coin: THREE.Group, art: CoinArt, reverse: boolean): void {
  const side = new THREE.Group();
  side.name = reverse ? 'embossed reverse of Cud Coin' : 'hoof emblem face of Cud Coin';
  if (reverse) side.rotation.y = Math.PI;

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material,
    name: string, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.z = z;
    side.add(mesh);
    return mesh;
  };
  add(art.face, art.faceGold, 'gold coin face', 0.085);
  add(art.inset, art.outline, 'deep amber coin outline', 0.091);
  add(art.inner, art.orange, 'orange coin center', 0.097);
  add(art.rim, art.lemon, 'bright beveled gold edge', 0.098);
  add(art.innerRim, art.lemon, 'warm inner stamped ring', 0.109);

  for (let mirror = 0; mirror < 2; mirror++) {
    const left = new THREE.Group();
    left.name = mirror ? 'right curling hoof horn' : 'left curling hoof horn';
    if (mirror) left.scale.x = -1;
    const stroke = new THREE.Mesh(art.hornOuter, art.crest);
    stroke.name = 'amber hoof emblem stroke';
    stroke.position.z = 0.137;
    const light = new THREE.Mesh(art.hornHighlight, art.crestLight);
    light.name = 'pale gold hoof emblem highlight';
    light.position.z = 0.158;
    left.add(stroke, light);
    side.add(left);
  }
  coin.add(side);
}

function createSlot(art: CoinArt, i: number): CoinSlot {
  const root = new THREE.Group();
  root.name = 'coin pickup sparkle pooled burst ' + i;
  root.visible = false;

  const coin = new THREE.Group();
  coin.name = 'spinning beveled gold Cud Coin';
  const edge = new THREE.Mesh(art.edge, art.metal);
  edge.name = 'thick gold and copper coin edge';
  edge.rotation.x = Math.PI / 2;
  edge.castShadow = true;
  coin.add(edge);
  addCoinFace(coin, art, false);
  addCoinFace(coin, art, true);
  root.add(coin);

  const goldOrbitMaterial = new THREE.MeshBasicMaterial({
    color: 0xffbf10, transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const whiteOrbitMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff3af, transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const swoosh = new THREE.Group();
  swoosh.name = 'gold and ivory angled pickup orbit';
  const orbit = new THREE.Mesh(art.orbit, goldOrbitMaterial);
  orbit.name = 'wide gold swoosh';
  orbit.scale.y = 0.56;
  orbit.rotation.z = -0.24;
  const core = new THREE.Mesh(art.orbitCore, whiteOrbitMaterial);
  core.name = 'thin white-gold swoosh highlight';
  core.scale.y = 0.51;
  core.rotation.z = -0.40;
  core.rotation.y = -0.18;
  swoosh.add(orbit, core);
  root.add(swoosh);

  const sparkleMaterial = new THREE.SpriteMaterial({
    color: 0xffffff, map: art.star, transparent: true, opacity: 0,
    depthWrite: false, depthTest: true, toneMapped: false,
  });
  const stars: THREE.Sprite[] = [];
  for (let j = 0; j < COIN_SPARKLE_COUNT; j++) {
    const sprite = new THREE.Sprite(sparkleMaterial);
    sprite.name = 'four-point white-gold twinkling star ' + j;
    sprite.visible = false;
    root.add(sprite);
    stars.push(sprite);
  }

  return {
    root, coin, swoosh, goldOrbitMaterial, whiteOrbitMaterial,
    sparkleMaterial, stars, frame: makeCoinPickupFrame(),
    targetWorld: new THREE.Vector3(), cue: null, target: null, age: 0,
  };
}

/**
 * Effect 10 · COIN PICKUP SPARKLE. World-space, cosmetic only.
 *
 * `emit(coinPosition, targetObject?)` pops the coin, flies to a target's
 * world origin (use a goat chest anchor), then scatters twinkling gold stars.
 * `update(dtSeconds)` is absolute-age driven and free of per-frame allocations.
 * `clear()` resets the pool; `dispose()` releases all owned resources.
 * No renderer, scene loop, physics or game character is modified.
 */
export class CoinPickupSparkle {
  readonly group = new THREE.Group();
  private readonly art: CoinArt;
  private readonly slots: CoinSlot[] = [];
  private readonly targetScratch = new THREE.Vector3();
  private nextSlot = 0;
  private disposed = false;

  constructor(options: CoinPickupSparkleOptions = {}) {
    const capacity = options.capacity ?? 6;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 24) {
      throw new RangeError('Coin pickup capacity must be an integer in 1..24');
    }
    this.group.name = '10 COIN PICKUP SPARKLE';
    this.art = makeArt();
    for (let i = 0; i < capacity; i++) {
      const slot = createSlot(this.art, i);
      this.slots.push(slot);
      this.group.add(slot.root);
    }
  }

  /** Pickup point in world space; optional target must be a Three Object3D. */
  emit(position: Vec3Like, target?: THREE.Object3D | null): void {
    if (this.disposed) throw new Error('CoinPickupSparkle is disposed');
    const cue = makeCoinPickupCue(position);
    if (target != null) {
      if (!target.isObject3D) throw new TypeError('Coin pickup target must be an Object3D');
      target.getWorldPosition(this.targetScratch);
      if (!Number.isFinite(this.targetScratch.x) ||
          !Number.isFinite(this.targetScratch.y) ||
          !Number.isFinite(this.targetScratch.z)) {
        throw new RangeError('Coin pickup target world position must be finite');
      }
    }
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
    slot.age = 0;
    slot.target = target ?? null;
    if (slot.target) slot.targetWorld.copy(this.targetScratch);
    slot.root.position.set(cue.position.x, cue.position.y, cue.position.z);
    this.paint(slot);
  }

  /** Elapsed seconds (never frames). Large and split updates land at the same pose. */
  update(dt: number): void {
    if (this.disposed) throw new Error('CoinPickupSparkle is disposed');
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError('Coin pickup dt must be finite and non-negative');
    }
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      if (!slot.cue) continue;
      slot.age += dt;
      this.paint(slot);
    }
  }

  private paint(slot: CoinSlot): void {
    const cue = slot.cue;
    if (!cue) return;
    if (slot.target) {
      slot.target.getWorldPosition(this.targetScratch);
      // Keep the last valid point if the gameplay target is temporarily
      // detached or carries an invalid transform.
      if (Number.isFinite(this.targetScratch.x) &&
          Number.isFinite(this.targetScratch.y) &&
          Number.isFinite(this.targetScratch.z)) {
        slot.targetWorld.copy(this.targetScratch);
      }
    }
    const frame = sampleCoinPickup(cue, slot.age, slot.frame,
      slot.target ? slot.targetWorld : undefined);
    if (!frame) {
      slot.cue = null;
      slot.target = null;
      slot.root.visible = false;
      return;
    }
    slot.root.visible = true;
    slot.coin.visible = frame.coinScale > 0.003;
    if (slot.coin.visible) {
      slot.coin.position.set(frame.coinX - cue.position.x,
        frame.coinY - cue.position.y, frame.coinZ - cue.position.z);
      slot.coin.rotation.set(frame.coinTilt, frame.coinSpin, -0.08);
      slot.coin.scale.setScalar(frame.coinScale);
    }

    slot.swoosh.visible = frame.ringOpacity > 0.004;
    if (slot.swoosh.visible) {
      slot.swoosh.position.copy(slot.coin.position);
      slot.swoosh.rotation.y = 0.40 + 0.28 * Math.sin(frame.ringAngle);
      slot.swoosh.rotation.z = 0.13 * Math.sin(frame.ringAngle * 0.70);
      slot.swoosh.scale.setScalar(frame.ringScale);
      slot.goldOrbitMaterial.opacity = frame.ringOpacity * 0.95;
      slot.whiteOrbitMaterial.opacity = frame.ringOpacity * 0.96;
    }

    slot.sparkleMaterial.opacity = frame.sparkleOpacity;
    for (let i = 0; i < slot.stars.length; i++) {
      const star = slot.stars[i]!;
      const layout = STAR_LAYOUT[i]!;
      const arrival = slot.age - 0.59 - (i % 4) * 0.027;
      star.visible = frame.sparkleOpacity > 0.002 && arrival > 0;
      if (!star.visible) continue;
      star.position.set(
        frame.starX - cue.position.x + layout.x * frame.scatter,
        frame.starY - cue.position.y + layout.y * frame.scatter,
        frame.starZ - cue.position.z + layout.z,
      );
      const twinkle = 0.83 + 0.17 * Math.sin(slot.age * 25 + i * 2.45);
      const appear = Math.min(1, arrival * 11);
      const size = layout.size * (0.52 + frame.scatter * 0.80) *
        appear * twinkle;
      star.scale.set(size, size, 1);
    }
  }

  get activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]!.cue) n++;
    return n;
  }

  /** Retains every piece of geometry, texture and material for reuse. */
  clear(): void {
    if (this.disposed) return;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      slot.cue = null;
      slot.target = null;
      slot.age = 0;
      slot.root.visible = false;
      slot.swoosh.visible = false;
      for (let j = 0; j < slot.stars.length; j++) slot.stars[j]!.visible = false;
    }
    this.nextSlot = 0;
  }

  /** Idempotent; never disposes a user-owned target or external scene. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      slot.goldOrbitMaterial.dispose();
      slot.whiteOrbitMaterial.dispose();
      slot.sparkleMaterial.dispose();
      slot.root.removeFromParent();
    }
    this.art.edge.dispose();
    this.art.face.dispose();
    this.art.inset.dispose();
    this.art.inner.dispose();
    this.art.rim.dispose();
    this.art.innerRim.dispose();
    this.art.hornOuter.dispose();
    this.art.hornHighlight.dispose();
    this.art.orbit.dispose();
    this.art.orbitCore.dispose();
    this.art.star.dispose();
    this.art.metal.dispose();
    this.art.faceGold.dispose();
    this.art.orange.dispose();
    this.art.lemon.dispose();
    this.art.outline.dispose();
    this.art.crest.dispose();
    this.art.crestLight.dispose();
    this.group.removeFromParent();
    this.disposed = true;
  }
}

export const createCoinPickupSparkle = (
  options?: CoinPickupSparkleOptions,
): CoinPickupSparkle => new CoinPickupSparkle(options);
