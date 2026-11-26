import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { residentStride, type AmbientResidentState } from './ambient-life';
import { publicAssetUrl } from './public-assets';
import { applyAmbientDistanceFade } from './visual-wind';

export { residentStride } from './ambient-life';

/** Existing CC0 Kenney assets; retain their authored palette, proportions and rigs. */
export const RESIDENT_MODELS = {
  'male-a': 'assets/library/kenney/mini-characters/character-male-a.glb',
  'male-b': 'assets/library/kenney/mini-characters/character-male-b.glb',
  'female-a': 'assets/library/kenney/mini-characters/character-female-a.glb',
  'female-b': 'assets/library/kenney/mini-characters/character-female-b.glb',
  worker: 'assets/library/kenney/mini-characters/character-worker.glb',
} as const;
type ResidentModel = keyof typeof RESIDENT_MODELS;
export type ResidentQuality = 'low' | 'medium' | 'high';
const CLIPS = ['idle', 'walk', 'sprint', 'sit', 'pick-up', 'emote-yes', 'emote-no',
  'interact-left', 'interact-right'] as const;
type Clip = typeof CLIPS[number];

interface Template {
  users: number;
  asset?: GLTF;
  promise: Promise<GLTF>;
}
const templates = new Map<ResidentModel, Template>();
const fadedMaterials = new WeakSet<THREE.Material>();

function disposeAsset(asset: GLTF): void {
  const geometry = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  asset.scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    geometry.add(node.geometry);
    if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  for (const item of geometry) item.dispose();
  for (const item of materials) item.dispose();
  for (const item of textures) item.dispose();
  for (const item of skeletons) item.dispose();
}

function acquireTemplate(model: ResidentModel): Template {
  let template = templates.get(model);
  if (!template) {
    const entry: Template = {
      users: 0,
      promise: new GLTFLoader().loadAsync(publicAssetUrl(RESIDENT_MODELS[model])),
    };
    entry.promise = entry.promise.then(asset => {
      entry.asset = asset;
      // Teardown can win a race with a pending network response.
      if (entry.users === 0) {
        disposeAsset(asset);
        if (templates.get(model) === entry) templates.delete(model);
      }
      return asset;
    }, error => {
      if (templates.get(model) === entry) templates.delete(model);
      throw error;
    });
    templates.set(model, entry);
    template = entry;
  }
  template.users++;
  return template;
}

function releaseTemplate(model: ResidentModel, template: Template): void {
  if (--template.users !== 0) return;
  if (template.asset) disposeAsset(template.asset);
  // A pending promise retains ownership until it can dispose its own result.
  if (templates.get(model) === template) templates.delete(model);
}

export function residentClip(activity: AmbientResidentState['activity'], phase: number): Clip {
  switch (activity) {
    case 'walk': return 'walk';
    case 'flee': return 'sprint';
    case 'sit': return 'sit';
    case 'work': return phase < .5 ? 'interact-left' : 'pick-up';
    case 'shop': return 'interact-right';
    case 'wave': return 'emote-yes';
    case 'startle': return 'emote-no';
    default: return 'idle';
  }
}

interface SoleProbe { mesh: THREE.SkinnedMesh; index: number }

/**
 * A separate rig owns bones, actions and a mixer, while meshes share immutable
 * template geometry/materials. +Z is the native character's forward direction.
 * The director's position is a supporting surface point, never the mesh centre.
 */
export function createResidentRig(asset: GLTF, initial: AmbientResidentState) {
  // Validate before allocating clone-owned skeletons/mixers; corrupt assets
  // must not leak a half-constructed actor that the adapter cannot dispose.
  for (const name of CLIPS) if (!asset.animations.some(item => item.name === name))
    throw new Error(`Resident ${initial.model} is missing authored ${name} animation`);
  const root = new THREE.Group();
  root.name = 'resident-' + initial.id;
  root.userData['residentId'] = initial.id;
  const model = cloneSkeleton(asset.scene);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {} as Record<Clip, THREE.AnimationAction>;
  for (const name of CLIPS) {
    const clip = asset.animations.find(item => item.name === name)!;
    actions[name] = mixer.clipAction(clip).play();
    actions[name].setEffectiveWeight(name === 'idle' ? 1 : 0);
    actions[name].time = initial.phase * clip.duration;
  }
  mixer.update(0);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model, true);
  const nativeHeight = bounds.max.y - bounds.min.y;
  if (!(nativeHeight > .1)) throw new Error('Resident model has invalid bounds');
  const scale = initial.height / nativeHeight;
  // A camera inside the authored large head can cover the whole follow view.
  // Keep a stable body envelope in resident-local metres, including a little
  // room for the authored bob/lean, instead of testing distance to the feet.
  const cameraBounds = bounds.clone().translate(new THREE.Vector3(0, -bounds.min.y, 0));
  cameraBounds.min.multiplyScalar(scale);
  cameraBounds.max.multiplyScalar(scale);
  cameraBounds.expandByScalar(initial.height * .05);
  model.scale.setScalar(scale);
  const modelGround = -bounds.min.y * scale;
  model.position.y = modelGround;
  const hip = model.getObjectByName('torso');
  root.add(model);
  const skeletons = new Set<THREE.Skeleton>();
  const probes: SoleProbe[] = [];
  const skins: { mesh: THREE.SkinnedMesh; original: THREE.Material | THREE.Material[];
    faded?: THREE.Material | THREE.Material[] }[] = [];
  const fadeMaterials = new Map<THREE.Material, THREE.Material>();
  model.traverse(node => {
    if (!(node instanceof THREE.SkinnedMesh)) return;
    skins.push({ mesh: node, original: node.material });
    skeletons.add(node.skeleton);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!fadedMaterials.has(material)) {
        applyAmbientDistanceFade(material, 170, 205);
        fadedMaterials.add(material);
      }
    }
    node.castShadow = false; // Shared instanced contact shadows; no dynamic sun-map pass per resident.
    node.receiveShadow = true;
    // Animation bounds are conservative and stable, not a bind-pose frustum box.
    node.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, nativeHeight * .48, 0), nativeHeight * .88);
    node.frustumCulled = true;
    const positions = node.geometry.getAttribute('position');
    let lowest = Infinity;
    for (let i = 0; i < positions.count; i++) lowest = Math.min(lowest, positions.getY(i));
    if (lowest > bounds.min.y + nativeHeight * .15) return;
    // The soles are flat authored faces. Their perimeter vertices are enough
    // to ground a pose without walking every vertex of either skinned mesh.
    const unique = new Set<string>();
    for (let i = 0; i < positions.count; i++) {
      if (positions.getY(i) > lowest + nativeHeight * .009) continue;
      const key = positions.getX(i).toFixed(5) + ':' + positions.getZ(i).toFixed(5);
      if (!unique.has(key)) { probes.push({ mesh: node, index: i }); unique.add(key); }
    }
  });
  const point = new THREE.Vector3();
  let previousTime = NaN, shotStart = 0, previousActivity = initial.activity;
  let disposed = false;
  const weights = Object.fromEntries(CLIPS.map(name => [name, name === 'idle' ? 1 : 0])) as Record<Clip, number>;

  function update(state: AmbientResidentState, time: number, animate = true): void {
    if (disposed || !Number.isFinite(time)) return;
    root.position.copy(state.position);
    root.rotation.y = state.yaw;
    if (!animate) return;
    const dt = Number.isFinite(previousTime) ? Math.max(0, time - previousTime) : 1;
    previousTime = time;
    if (previousActivity !== state.activity) {
      previousActivity = state.activity;
      shotStart = time;
    }
    const selected = residentClip(state.activity, state.phase);
    const moving = selected === 'walk' || selected === 'sprint';
    const moveWeight = moving ? Math.min(1, Math.max(0, state.speed) / .22) : 0;
    const blend = 1 - Math.exp(-dt * 9);
    const sit = state.seat ? THREE.MathUtils.smoothstep(state.seat.progress, .15, .93) : 0;
    for (const name of CLIPS) {
      const action = actions[name];
      const desired = name === selected ? (moving ? moveWeight : 1) : name === 'idle' && moving ? 1 - moveWeight : 0;
      if (state.seat) weights[name] = name === 'sit' ? sit : name === 'idle' ? 1 - sit : 0;
      else weights[name] += (desired - weights[name]) * blend;
      action.setEffectiveWeight(weights[name]);
      const duration = action.getClip().duration;
      if (name === 'walk' || name === 'sprint') {
        action.time = ((state.distanceTravelled / residentStride(state.height, name === 'sprint') + state.phase) % 1) * duration;
      } else if (name === 'emote-yes' || name === 'emote-no') {
        action.time = Math.min(Math.max(0, time - shotStart), duration - .001);
      } else {
        const pacing = name === 'idle' ? .72 + state.phase * .23 : .54 + state.phase * .21;
        action.time = ((time * pacing + state.phase * duration) % duration + duration) % duration;
      }
    }
    // Absolute clip phases survive culling, pause, frame-rate changes and quality
    // switches. Advancing a render-time mixer would desynchronise them from gait.
    mixer.update(0);
    model.position.set(0, modelGround, 0);
    root.updateMatrixWorld(true);
    let bottom = Infinity;
    if (sit < 1) {
      for (const probe of probes) {
        probe.mesh.getVertexPosition(probe.index, point).applyMatrix4(probe.mesh.matrixWorld);
        bottom = Math.min(bottom, point.y);
      }
    }
    const groundCorrection = Number.isFinite(bottom) ? state.position.y - bottom : 0;
    let seatCorrection = groundCorrection;
    if (hip && state.seat && sit > 0) {
      hip.getWorldPosition(point);
      // The native folded legs sit 0.118 model units below this joint.
      seatCorrection = state.seat.anchor.position.y + .118 * scale - point.y;
      const dx = state.position.x - point.x, dz = state.position.z - point.z;
      model.position.x = (dx * Math.cos(state.yaw) - dz * Math.sin(state.yaw)) * sit;
      model.position.z = (dx * Math.sin(state.yaw) + dz * Math.cos(state.yaw)) * sit;
    }
    model.position.y += THREE.MathUtils.lerp(groundCorrection, seatCorrection, sit);
    root.updateMatrixWorld(true);
  }
  update(initial, 0);

  const fadedMaterial = (source: THREE.Material): THREE.Material => {
    let material = fadeMaterials.get(source);
    if (!material) {
      material = source.clone();
      // Smooth near transparency avoids filling the screen with alpha-hash
      // noise. The software renderer uses depth-preserving dither for this pass.
      material.alphaHash = false;
      material.transparent = true;
      material.depthWrite = false;
      material.userData['cameraFade'] = true;
      fadeMaterials.set(source, material);
    }
    return material;
  };
  return {
    root,
    update,
    updateCameraOpacity(state: AmbientResidentState, camera: THREE.Vector3): number {
      // Begin the fade before the head fills the foreground. Box distance also
      // accounts for elevated cameras without fading a person far below them.
      const dx = camera.x - state.position.x, dz = camera.z - state.position.z;
      const cos = Math.cos(state.yaw), sin = Math.sin(state.yaw);
      point.set(cos * dx - sin * dz, camera.y - state.position.y, sin * dx + cos * dz);
      const clearance = cameraBounds.distanceToPoint(point) / state.height;
      const opacity = THREE.MathUtils.smoothstep(clearance, .42, 1.7);
      for (const skin of skins) {
        if (opacity === 1 || opacity === 0) {
          skin.mesh.material = skin.original;
        } else {
          skin.faded ??= Array.isArray(skin.original) ? skin.original.map(fadedMaterial) : fadedMaterial(skin.original);
          skin.mesh.material = skin.faded;
        }
      }
      if (opacity > 0 && opacity < 1) {
        for (const [source, fading] of fadeMaterials) fading.opacity = source.opacity * opacity;
      }
      return opacity;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      for (const material of fadeMaterials.values()) material.dispose();
      for (const skeleton of skeletons) skeleton.dispose();
      root.removeFromParent();
    },
  };
}

export interface AmbientLifeVisualOptions {
  /** Injectable loader for lifecycle/asset tests. Injected assets are caller-owned. */
  loadAsset?: (url: string) => Promise<GLTF>;
}

/**
 * Logical residents are never destroyed or re-seeded by visibility/quality.
 * All quality levels keep nearby people; distant skeleton evaluation runs at
 * 12/8/5 Hz while transforms continue following the fixed simulation clock.
 */
export function buildAmbientLifeVisuals(
  initialStates: readonly AmbientResidentState[], options: AmbientLifeVisualOptions = {},
) {
  const root = new THREE.Group();
  root.name = 'living-downtown-residents';
  root.userData['ready'] = false;
  const rigs = new Map<string, ReturnType<typeof createResidentRig>>();
  const acquired = new Map<ResidentModel, Template>();
  const nextPose = new Map<string, number>();
  const inRange = new Set<string>();
  const failedModels: ResidentModel[] = [];
  let disposed = false, visibleCount = 0, animatedCount = 0;
  const shadowGeometry = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x344b47, transparent: true,
    opacity: .17, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, Math.max(1, initialStates.length));
  shadows.name = 'resident-contact-shadows';
  shadows.count = 0;
  shadows.frustumCulled = false;
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(shadows);
  const shadow = new THREE.Object3D();

  const required = [...new Set(initialStates.map(state => state.model))];
  const canLoad = options.loadAsset || typeof document !== 'undefined';
  const ready = Promise.allSettled(canLoad ? required.map(async model => {
    let asset: GLTF;
    try {
      if (options.loadAsset) asset = await options.loadAsset(publicAssetUrl(RESIDENT_MODELS[model]));
      else {
        const template = acquireTemplate(model);
        acquired.set(model, template);
        asset = await template.promise;
      }
      if (disposed) return;
      for (const state of initialStates) {
        if (state.model !== model) continue;
        const rig = createResidentRig(asset, state);
        rigs.set(state.id, rig);
        inRange.add(state.id);
        root.add(rig.root);
      }
    } catch (error) {
      if (!disposed) {
        failedModels.push(model);
        console.warn('Resident art unavailable; keeping its logical routine:', model, error);
      }
    }
  }) : []).then(() => { root.userData['ready'] = true; });

  return {
    root,
    ready,
    update(states: readonly AmbientResidentState[], time: number, camera: THREE.Vector3,
      quality: ResidentQuality = 'high'): void {
      if (disposed || !Number.isFinite(time)) return;
      visibleCount = 0;
      animatedCount = 0;
      let shadowCount = 0;
      const farRate = quality === 'high' ? 12 : quality === 'medium' ? 8 : 5;
      for (const state of states) {
        const rig = rigs.get(state.id);
        if (!rig) continue;
        const dx = camera.x - state.position.x, dy = camera.y - state.position.y, dz = camera.z - state.position.z;
        const distance2 = dx * dx + dy * dy + dz * dz;
        // Residents are <12 pixels tall here on the game's normal camera.
        // Hysteresis prevents rapid toggle at a boundary. No quality population pop.
        const limit = inRange.has(state.id) ? 225 : 205;
        const withinRange = distance2 < limit * limit;
        if (withinRange) inRange.add(state.id); else inRange.delete(state.id);
        // Object visibility is honored by both production renderers. Keep
        // this per-actor rule independent of pooled materials and far LOD.
        const cameraOpacity = withinRange ? rig.updateCameraOpacity(state, camera) : 0;
        rig.root.visible = cameraOpacity > 0;
        const near = distance2 < 38 * 38;
        // A nearby hidden actor still observes reaction transitions and gait;
        // restoring its mesh must not restart a gesture or reveal a stale pose.
        const animate = withinRange && (near || time >= (nextPose.get(state.id) ?? 0));
        rig.update(state, time, animate);
        if (animate) {
          animatedCount++;
          nextPose.set(state.id, time + (near ? 0 : 1 / farRate));
        }
        if (!rig.root.visible) continue;
        visibleCount++;
        if (distance2 > 100 * 100 || cameraOpacity < .2) continue;
        shadow.position.set(state.position.x, state.position.y + .018, state.position.z);
        shadow.rotation.y = state.yaw;
        shadow.scale.set(state.radius * 1.25, 1, state.radius * .92);
        shadow.updateMatrix();
        shadows.setMatrixAt(shadowCount++, shadow.matrix);
      }
      shadows.count = shadowCount;
      shadows.instanceMatrix.needsUpdate = true;
    },
    stats() {
      return { logical: initialStates.length, loaded: rigs.size, visible: visibleCount,
        animated: animatedCount, failedModels: [...failedModels] };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const rig of rigs.values()) rig.dispose();
      rigs.clear();
      nextPose.clear();
      inRange.clear();
      for (const [model, template] of acquired) releaseTemplate(model, template);
      acquired.clear();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      shadows.dispose();
      root.removeFromParent();
      root.clear();
    },
  };
}
