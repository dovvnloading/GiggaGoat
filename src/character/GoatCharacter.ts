import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { GoatRagdoll } from '../physics';
import {
  ACTIONS, actionFromPhysics, clamp01, sampleMotion, tierFromPhysicsScale,
  TIER_PROFILES, type CharacterAction, type GoatTier, type MotionFrame,
} from './motion';
import { LegacyGoatCharacter } from './LegacyGoatCharacter';
import {
  GOAT_CLIPS, GOAT_GLB_FILES, clipForAction, goatPublicAssetUrl,
  locomotionBlend, selectGoatVariant, type GoatCharacterOptions,
  type GoatClip, type GoatOneShot, type GoatVariant,
} from './rigged';

type MountName = 'head' | 'neck' | 'back';
const MOUNT_NAMES: readonly MountName[] = ['head', 'neck', 'back'];
const LOCOMOTION = ['Idle', 'Walk', 'Run'] as const;
const ANCHOR_POINTS: Readonly<Record<MountName, readonly [number, number, number]>> = {
  head: [0, 1.72, -.84],
  neck: [0, 1.31, -.63],
  back: [0, 1.22, .06],
};

// Centers of the sole patches in each normalized GLB, fore pair then hind pair.
const IDLE_SOLES: Readonly<Record<GoatVariant, readonly (readonly [number, number])[]>> = {
  hero: [[-.231, -.241], [.234, -.241], [-.216, .519], [.211, .524]],
  bandana: [[-.218, -.286], [.222, -.268], [-.217, .438], [.218, .427]],
  bell: [[-.218, -.251], [.217, -.237], [-.217, .457], [.222, .458]],
};

type AnchorHome = {
  parent: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
};
type Shot = { clip: GoatOneShot; duration: number; elapsed: number };
type Rig = {
  model: THREE.Group;
  skeleton: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<GoatClip, THREE.AnimationAction>;
  weights: { Idle: number; Walk: number; Run: number };
  shot: Shot | null;
  previewing: boolean;
};

const glbTemplates = new Map<GoatVariant, Promise<GLTF>>();
function loadTemplate(variant: GoatVariant): Promise<GLTF> {
  let promise = glbTemplates.get(variant);
  if (!promise) {
    promise = new GLTFLoader().loadAsync(goatPublicAssetUrl(GOAT_GLB_FILES[variant]));
    glbTemplates.set(variant, promise);
    // A failed request must be retryable (and the legacy model stays displayed).
    void promise.catch(() => { if (glbTemplates.get(variant) === promise) glbTemplates.delete(variant); });
  }
  return promise;
}

/** Pick a skinned bone by semantic name, with a position fallback for unnamed auto-rigs. */
function findMountBone(
  skeleton: THREE.Object3D, name: MountName, model: THREE.Group,
): THREE.Bone | null {
  const bones = new Set<THREE.Bone>();
  skeleton.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) {
      for (const bone of object.skeleton.bones) bones.add(bone);
    } else if (object instanceof THREE.Bone) bones.add(object);
  });
  if (!bones.size) return null;
  const point = ANCHOR_POINTS[name];
  const target = new THREE.Vector3(point[0], point[1], point[2]);
  const world = new THREE.Vector3();
  const local = new THREE.Vector3();
  const scoreName = (value: string): number => {
    const n = value.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (name === 'head') return /head|skull|cranium/.test(n) ? 0 : /face|muzzle|snout/.test(n) ? 1 : 3;
    if (name === 'neck') return /neck/.test(n) ? 0 : /chest|spine/.test(n) ? 1 : 3;
    return /back|spine|chest|torso/.test(n) ? 0 : /body|hip|pelvis/.test(n) ? 1 : 3;
  };
  let chosen: THREE.Bone | null = null;
  let best = Infinity;
  model.updateWorldMatrix(true, true);
  for (const bone of bones) {
    local.copy(model.worldToLocal(bone.getWorldPosition(world)));
    const score = scoreName(bone.name) * 5 + local.distanceTo(target);
    if (score < best) { best = score; chosen = bone; }
  }
  return chosen;
}

/**
 * GLB renderer with the same public surface as the original procedural goat.
 * Until a template resolves, root IS the old seven-part sculpt (including its
 * mounts), so existing GameCharacters integration and headless tests still work.
 * Both renderers only consume Rapier state; neither advances or mutates physics.
 */
export class GoatCharacter {
  readonly root: THREE.Group;
  readonly mounts: LegacyGoatCharacter['mounts'];
  private readonly legacy: LegacyGoatCharacter;
  private readonly legacyParts: THREE.Object3D[];
  private readonly homes: Record<MountName, AnchorHome>;
  private readonly options: GoatCharacterOptions;
  private bound: GoatRagdoll | null = null;
  private rig: Rig | null = null;
  private variantValue: GoatVariant;
  private tierValue: GoatTier = 'BILLY';
  private actionValue: CharacterAction = 'stand';
  private previewAction: CharacterAction = 'stand';
  private previewClip: GoatClip = 'Idle';
  private override: { action: CharacterAction; remaining: number } | null = null;
  private lastGrounded = false;
  private clock = 0;
  private generation = 0;
  private disposed = false;
  private readonly offset = new THREE.Vector3();
  private idleSolesGrounded = false;
  private readonly supportNormal = new THREE.Vector3();
  private readonly supportBack = new THREE.Vector3();
  private readonly supportRight = new THREE.Vector3();
  private readonly supportBasis = new THREE.Matrix4();
  private readonly supportRotation = new THREE.Quaternion();

  constructor(goat?: GoatRagdoll, options: GoatCharacterOptions = {}) {
    this.options = { ...options };
    this.variantValue = selectGoatVariant(goat, options);
    this.legacy = new LegacyGoatCharacter();
    this.root = this.legacy.root;
    this.mounts = this.legacy.mounts;
    this.legacyParts = [...this.root.children];
    const home = (name: MountName): AnchorHome => {
      const mount = this.mounts[name];
      if (!mount.parent) throw new Error('Legacy mount missing parent: ' + name);
      return {
        parent: mount.parent,
        position: mount.position.clone(),
        quaternion: mount.quaternion.clone(),
        scale: mount.scale.clone(),
      };
    };
    this.homes = { head: home('head'), neck: home('neck'), back: home('back') };
    if (goat) this.bind(goat);
    else this.update(0);
    this.requestLoad();
  }

  get tier(): GoatTier { return this.tierValue; }
  get action(): CharacterAction { return this.actionValue; }
  get physics(): GoatRagdoll | null { return this.bound; }
  get variant(): GoatVariant { return this.variantValue; }
  get isReady(): boolean { return this.rig !== null; }

  /** Switch binding without changing simulation state or owning the ragdoll. */
  bind(goat: GoatRagdoll | null): void {
    if (this.disposed) throw new Error('GoatCharacter is disposed');
    this.bound = goat;
    this.legacy.bind(goat);
    this.override = null;
    this.lastGrounded = goat?.locomotion.grounded ?? false;
    if (goat) {
      this.tierValue = tierFromPhysicsScale(goat.size);
      const variant = selectGoatVariant(goat, this.options);
      if (variant !== this.variantValue) {
        this.generation++;
        this.clearRig();
        this.variantValue = variant;
        this.requestLoad();
      }
    }
    if (this.rig) this.configureActions(this.rig);
    this.update(0, goat?.world.alpha);
  }

  /** Same approved pose vocabulary as LegacyGoatCharacter. */
  setPreview(action: CharacterAction, tier: GoatTier = this.tierValue): void {
    if (this.bound) throw new Error('Unbind physics before setting a preview pose');
    this.legacy.setPreview(action, tier);
    this.previewAction = action;
    this.previewClip = clipForAction(action);
    this.tierValue = tier;
    if (this.rig) this.configureActions(this.rig);
    this.update(0);
  }

  /** Extra lab-only control: audition all six baked clips, including Walk. */
  setPreviewClip(clip: GoatClip, tier: GoatTier = this.tierValue): void {
    if (!(GOAT_CLIPS as readonly string[]).includes(clip)) {
      throw new RangeError('Unknown GLB clip: ' + clip);
    }
    if (this.bound) throw new Error('Unbind physics before setting a preview clip');
    const action: CharacterAction =
      clip === 'Run' ? 'sprint' :
      clip === 'Jump' ? 'jump-flip' :
      clip === 'Headbutt' ? 'headbutt' :
      clip === 'Bleat' ? 'bleat' : 'stand';
    this.legacy.setPreview(action, tier);
    this.previewAction = action;
    this.previewClip = clip;
    this.tierValue = tier;
    if (this.rig) this.configureActions(this.rig);
    this.update(0);
  }

  /** Existing action API; "jump" is also accepted as an alias for jump-flip. */
  play(action: CharacterAction | 'jump', seconds = .65): void {
    if (action !== 'jump' && !ACTIONS.includes(action)) {
      throw new RangeError('Unknown character action');
    }
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid duration');
    const selected = action === 'jump' ? 'jump-flip' : action;
    this.legacy.play(selected, seconds);
    this.override = { action: selected, remaining: seconds };
    const clip = clipForAction(action);
    if (this.rig && seconds > 0 && (clip === 'Jump' ||
      clip === 'Headbutt' || clip === 'Bleat')) {
      this.startShot(this.rig, clip, seconds);
    }
  }

  /** For deterministic preview screenshots (also supported by the legacy sculpt). */
  seek(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid time');
    this.clock = seconds;
    this.legacy.seek(seconds);
    this.rig?.mixer.setTime(seconds);
    this.update(0);
  }

  mountWorldPosition(name: MountName, out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateWorldMatrix(true, true);
    return this.mounts[name].getWorldPosition(out);
  }

  /** World position for the rig's idle contact marks. The fallback uses Rapier legs. */
  idleSolePosition(index: number, out: THREE.Vector3): boolean {
    const sole = IDLE_SOLES[this.variantValue][index];
    if (!this.idleSolesGrounded || !this.rig || !sole) return false;
    out.set(sole[0], 0, sole[1]).applyMatrix4(this.rig.model.matrixWorld);
    return true;
  }

  update(dt: number, alpha?: number): MotionFrame {
    if (this.disposed) throw new Error('GoatCharacter is disposed');
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be non-negative and finite');
    const frameDt = Math.min(dt, .1);
    this.clock += frameDt;
    const goat = this.bound;
    this.idleSolesGrounded = false;
    if (goat) this.tierValue = tierFromPhysicsScale(goat.size);

    if (!this.rig) {
      const motion = this.legacy.update(dt, alpha);
      this.actionValue = this.legacy.action;
      this.tickOverride(frameDt);
      return motion;
    }

    const rig = this.rig;
    let selected = goat ? actionFromPhysics({
      ragdoll: goat.isRagdoll,
      tongueAttached: goat.interactions.isTongueAttached,
      clinging: goat.locomotion.isClinging,
      pose: goat.pose,
      sprinting: goat.pose === 'gallop',
      grounded: goat.locomotion.grounded,
    }) : this.previewAction;

    if (goat) {
      // Carry locomotion, jumps and flops with the interpolated torso. For
      // idle, the support plane below supplies the render rig's foot frame.
      const interpolation = alpha === undefined ? goat.world.alpha : clamp01(alpha);
      const transform = goat.world.getInterpolatedTransform(goat.torso, interpolation);
      rig.model.quaternion.set(transform.rotation.x, transform.rotation.y,
        transform.rotation.z, transform.rotation.w);
      rig.model.position.set(transform.translation.x, transform.translation.y,
        transform.translation.z).add(this.offset.set(0, -.92 * goat.size, 0)
          .applyQuaternion(rig.model.quaternion));
      rig.model.scale.setScalar(goat.size);
      if (!goat.locomotion.grounded && this.lastGrounded && goat.pose === 'jumpTuck' &&
          !rig.shot) this.startShot(rig, 'Jump', 1);
      this.lastGrounded = goat.locomotion.grounded;
    } else {
      rig.model.position.set(0, 0, 0);
      rig.model.quaternion.identity();
      rig.model.scale.setScalar(TIER_PROFILES[this.tierValue].physicsScale);
    }

    if (this.override) selected = this.override.action;
    this.actionValue = selected;
    this.tickOverride(frameDt);
    // The legacy cosmetic glider lives on the stable back mount, so the
    // existing glide cue still has a visible result with a rigged goat.
    const glider = this.mounts.back.getObjectByName('optional hang-glider cosmetic');
    if (glider) glider.visible = selected === 'glide';

    let shotWeight = 0;
    if (rig.shot) {
      const shot = rig.shot;
      shot.elapsed += frameDt;
      const remaining = Math.max(0, shot.duration - shot.elapsed);
      shotWeight = Math.min(1, shot.elapsed / .10, remaining / .15);
      rig.actions[shot.clip].setEffectiveWeight(shotWeight);
      if (remaining <= 0) {
        rig.actions[shot.clip].stop();
        rig.shot = null;
        shotWeight = 0;
        if (!goat) this.configureActions(rig);
      }
    }

    if (goat) {
      // Physics controller speeds grow only with size^.16. Keep animation
      // cadence size-independent while still responding to actual ground speed.
      const velocity = goat.torso.linvel();
      const speed = Math.hypot(velocity.x, velocity.z) / goat.size ** .16;
      const groundedStride = goat.locomotion.grounded && !goat.isRagdoll;
      const desired = locomotionBlend(groundedStride ? speed : 0, goat.pose === 'gallop');
      const smoothing = frameDt ? 1 - Math.exp(-12 * frameDt) : 1;
      for (const clip of LOCOMOTION) {
        rig.weights[clip] += (desired[clip] - rig.weights[clip]) * smoothing;
        rig.actions[clip].setEffectiveWeight(rig.weights[clip] * (1 - shotWeight));
      }
      rig.actions.Walk.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 1.2, .5, 2.5));
      rig.actions.Run.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 3.5, .5, 2.5));
    } else if (!rig.shot) {
      // In nonphysical lab preview one selected clip loops at authored 30 fps.
      rig.actions[this.previewClip].setEffectiveWeight(1);
    }

    rig.mixer.update(frameDt);
    if (goat && selected === 'stand') this.settleIdleRig(rig, goat);
    return sampleMotion(selected, this.clock);
  }

  private settleIdleRig(rig: Rig, goat: GoatRagdoll): void {
    const { grounded, groundHit } = goat.locomotion;
    if (!grounded || !groundHit || groundHit.normal.y < .65 || goat.isRagdoll ||
        (goat.pose !== 'stand' && goat.pose !== 'walk')) return;
    // Blend out with the idle clip as walking starts. The physics suspension
    // deliberately rides above the support: directly following its torso
    // leaves all four skinned hooves hovering, even on level ground.
    const idle = THREE.MathUtils.smoothstep(rig.weights.Idle, .76, 1);
    if (idle === 0) return;
    const { point, normal } = groundHit;
    const { position, quaternion } = rig.model;
    this.supportNormal.set(normal.x, normal.y, normal.z).normalize();
    this.supportBack.set(0, 0, 1).applyQuaternion(quaternion);
    this.supportBack.addScaledVector(this.supportNormal,
      -this.supportBack.dot(this.supportNormal));
    if (this.supportBack.lengthSq() < .05) return;
    this.supportBack.normalize();
    this.supportRight.crossVectors(this.supportNormal, this.supportBack);
    this.supportBasis.makeBasis(this.supportRight, this.supportNormal, this.supportBack);
    quaternion.slerp(this.supportRotation.setFromRotationMatrix(this.supportBasis), idle);

    const floor = point.y - ((position.x - point.x) * normal.x +
      (position.z - point.z) * normal.z) / normal.y;
    // An offset of 6 mm at Billy scale clears the lowest frame of the baked idle.
    position.y = THREE.MathUtils.lerp(position.y, floor + .006 * goat.size, idle);
    this.idleSolesGrounded = true;
    rig.model.updateWorldMatrix(true, false);
  }

  private tickOverride(dt: number): void {
    if (!this.override) return;
    this.override.remaining -= dt;
    if (this.override.remaining <= 0) this.override = null;
  }

  private requestLoad(): void {
    // Headless tests and SSR retain the fully working legacy renderer. The
    // browser initiates loading only once per variant, shared across goats.
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const generation = ++this.generation;
    const variant = this.variantValue;
    void loadTemplate(variant).then(gltf => {
      if (this.disposed || generation !== this.generation || variant !== this.variantValue) return;
      this.attachRig(gltf);
    }).catch(error => {
      if (this.disposed || generation !== this.generation) return;
      console.warn('Could not load animated goat ' + variant + '; using legacy sculpt.', error);
    });
  }

  private attachRig(gltf: GLTF): void {
    // Every goat gets its own skeleton and its own AnimationMixer; neither is
    // allowed to animate another goat or mutate a cached template.
    const skeleton = cloneSkeleton(gltf.scene);
    // The authored scene already places the muzzle on the model's forward axis.
    const model = new THREE.Group();
    model.name = 'rigged goat | ' + this.variantValue;
    model.add(skeleton);
    const mixer = new THREE.AnimationMixer(skeleton);
    const actions = {} as Record<GoatClip, THREE.AnimationAction>;
    for (const name of GOAT_CLIPS) {
      const clip = gltf.animations.find(entry => entry.name.toLowerCase() === name.toLowerCase());
      if (!clip) throw new Error(this.variantValue + ' GLB is missing clip ' + name);
      actions[name] = mixer.clipAction(clip);
    }
    skeleton.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.root.add(model);
    try {
      model.updateWorldMatrix(true, true);
      const modelRotation = model.getWorldQuaternion(new THREE.Quaternion());
      const boneRotation = new THREE.Quaternion();
      for (const name of MOUNT_NAMES) {
        const bone = findMountBone(skeleton, name, model);
        if (!bone) throw new Error('No bones available for ' + name + ' mount');
        const p = ANCHOR_POINTS[name];
        const at = model.localToWorld(new THREE.Vector3(p[0], p[1], p[2]));
        bone.add(this.mounts[name]);
        bone.updateWorldMatrix(true, false);
        this.mounts[name].position.copy(bone.worldToLocal(at));
        // Keep accessories model-aligned at attachment, then follow bone animation.
        bone.getWorldQuaternion(boneRotation).invert().multiply(modelRotation);
        this.mounts[name].quaternion.copy(boneRotation);
        this.mounts[name].scale.setScalar(1);
      }
      this.rig = {
        model, skeleton, mixer, actions, shot: null, previewing: !this.bound,
        weights: { Idle: 1, Walk: 0, Run: 0 },
      };
      this.configureActions(this.rig);
      for (const part of this.legacyParts) part.removeFromParent();
      this.root.name = 'Gigga-Goat | rigged ' + this.variantValue;
      if (this.override?.remaining && this.bound) {
        const clip = clipForAction(this.override.action);
        if (clip === 'Jump' || clip === 'Headbutt' || clip === 'Bleat') {
          this.startShot(this.rig, clip, this.override.remaining);
        }
      }
      this.update(0, this.bound?.world.alpha);
    } catch (error) {
      this.restoreMounts();
      model.removeFromParent();
      throw error;
    }
  }

  private configureActions(rig: Rig): void {
    rig.mixer.stopAllAction();
    rig.shot = null;
    rig.previewing = !this.bound;
    for (const clip of GOAT_CLIPS) {
      const action = rig.actions[clip];
      action.reset();
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      action.setEffectiveTimeScale(1);
      action.setEffectiveWeight(0);
      if (!this.bound ? clip === this.previewClip :
        (LOCOMOTION as readonly string[]).includes(clip)) action.play();
    }
    if (this.bound) {
      rig.weights = { Idle: 1, Walk: 0, Run: 0 };
      rig.actions.Idle.setEffectiveWeight(1);
    } else {
      rig.actions[this.previewClip].setEffectiveWeight(1);
    }
  }

  private startShot(rig: Rig, clip: GoatOneShot, duration: number): void {
    if (duration <= 0) return;
    if (rig.shot) rig.actions[rig.shot.clip].stop();
    const action = rig.actions[clip];
    action.stop();
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveWeight(0);
    action.setEffectiveTimeScale(action.getClip().duration / duration);
    action.play();
    rig.shot = { clip, duration, elapsed: 0 };
  }

  private restoreMounts(): void {
    for (const name of MOUNT_NAMES) {
      const mount = this.mounts[name];
      const home = this.homes[name];
      home.parent.add(mount);
      mount.position.copy(home.position);
      mount.quaternion.copy(home.quaternion);
      mount.scale.copy(home.scale);
    }
  }

  private clearRig(): void {
    if (!this.rig) return;
    const rig = this.rig;
    this.restoreMounts();
    rig.mixer.stopAllAction();
    rig.mixer.uncacheRoot(rig.skeleton);
    rig.model.removeFromParent();
    this.rig = null;
    for (const part of this.legacyParts) {
      this.root.add(part);
      part.visible = true;
    }
    this.root.name = 'Gigga-Goat | seven-body sculpt';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.clearRig();
    // The GLB template owns shared textures/materials/geometries. Do not
    // dispose them per instance; other SkeletonUtils clones may use them.
    this.legacy.dispose();
    this.bound = null;
  }
}

export function createGoatCharacter(
  goat?: GoatRagdoll, options: GoatCharacterOptions = {},
): GoatCharacter {
  return new GoatCharacter(goat, options);
}

export { type GoatTier, type CharacterAction, type MotionFrame };
export type { GoatCharacterOptions, GoatVariant, GoatClip } from './rigged';
