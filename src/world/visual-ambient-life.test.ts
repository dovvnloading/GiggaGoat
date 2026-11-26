import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import type { AmbientResidentState } from './ambient-life';
import { buildAmbientLifeVisuals, createResidentRig, RESIDENT_MODELS, residentClip,
  residentStride } from './visual-ambient-life';

function state(overrides: Partial<AmbientResidentState> = {}): AmbientResidentState {
  return { id: 'test-walker', role: 'walker', model: 'male-a',
    position: { x: 4, y: 7, z: -3 }, yaw: .8, speed: 1.15, distanceTravelled: 0,
    activity: 'walk', phase: .21, reactionUntil: 0, height: 1.8, radius: .38, ...overrides };
}

const assets = new Map<string, Promise<GLTF>>();
function load(model: keyof typeof RESIDENT_MODELS): Promise<GLTF> {
  let promise = assets.get(model);
  if (!promise) {
    // Node does not decode PNGs; use the actual shipped vertices, skins, bones
    // and clips with a one-pixel palette for these geometry/animation tests.
    const loader = new GLTFLoader().register(() => ({ name: 'test-texture',
      loadTexture: () => Promise.resolve(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)),
    }));
    promise = loader.parseAsync(Uint8Array.from(readFileSync('public/' + RESIDENT_MODELS[model])).buffer, '');
    assets.set(model, promise);
  }
  return promise;
}

describe('shipped resident art and grounded animation', () => {
  it.each(Object.keys(RESIDENT_MODELS) as (keyof typeof RESIDENT_MODELS)[])(
    '%s has the required authored clips and independent clone skeletons', async model => {
      const asset = await load(model), a = createResidentRig(asset, state({ model })), b = createResidentRig(asset, state({ model }));
      try {
        const skinA = a.root.getObjectByName('body-mesh') as THREE.SkinnedMesh;
        const skinB = b.root.getObjectByName('body-mesh') as THREE.SkinnedMesh;
        expect(skinA.isSkinnedMesh).toBe(true);
        expect(skinA.geometry).toBe(skinB.geometry);
        expect(skinA.material).toBe(skinB.material);
        expect(skinA.skeleton.bones[0]).not.toBe(skinB.skeleton.bones[0]);
        const bounds = new THREE.Box3().setFromObject(a.root, true);
        expect(Math.abs(bounds.min.y - 7)).toBeLessThan(.012);
        expect(bounds.max.y - bounds.min.y).toBeGreaterThan(1.6);
        expect(bounds.max.y - bounds.min.y).toBeLessThan(2);
        expect(a.root.rotation.y).toBe(.8);
      } finally { a.dispose(); b.dispose(); }
    });

  it('keeps the soles on their supporting surface through two walk cycles', async () => {
    const asset = await load('male-a'), resident = state(), rig = createResidentRig(asset, resident);
    try {
      for (let frame = 0; frame <= 120; frame++) {
        const time = frame / 30;
        resident.distanceTravelled = time * resident.speed;
        resident.position.x = 4 + time * resident.speed;
        resident.position.y = 7 + time * .12;
        rig.update(resident, time);
        const bounds = new THREE.Box3().setFromObject(rig.root, true);
        expect(Math.abs(bounds.min.y - resident.position.y)).toBeLessThan(.025);
        expect(rig.root.position.x).toBe(resident.position.x);
      }
    } finally { rig.dispose(); }
  });

  it('uses travelled distance for gait and preserves pose across far culling', async () => {
    const asset = await load('female-a'), resident = state({ model: 'female-a' });
    const first = createResidentRig(asset, resident), second = createResidentRig(asset, resident);
    try {
      for (let frame = 1; frame <= 90; frame++) {
        resident.distanceTravelled = frame / 30 * 1.1;
        first.update(resident, frame / 30);
      }
      second.update(resident, 3);
      const leftA = first.root.getObjectByName('leg-left')!;
      const leftB = second.root.getObjectByName('leg-left')!;
      expect(leftA.quaternion.angleTo(leftB.quaternion)).toBeLessThan(.001);
      expect(residentStride(1.8)).toBeGreaterThan(1.4);
      expect(residentStride(1.8)).toBeLessThan(1.9);
      const before = leftA.quaternion.clone();
      first.update(resident, 3.5);
      expect(before.angleTo(leftA.quaternion)).toBeLessThan(.001);
    } finally { first.dispose(); second.dispose(); }
  });

  it.each(['male-b', 'female-a', 'female-b'] as const)(
    'anchors the native %s seated pelvis to the furniture support', async model => {
      const resident = state({ model, activity: 'sit', speed: 0 });
      resident.seat = { anchor: { position: { ...resident.position, y: resident.position.y + .5 },
        floor: resident.position, chair: 'test-chair' }, progress: 1 };
      const rig = createResidentRig(await load(model), resident);
      try {
        const hip = rig.root.getObjectByName('torso')!.getWorldPosition(new THREE.Vector3());
        expect(hip.x).toBeCloseTo(resident.position.x, 6);
        expect(hip.z).toBeCloseTo(resident.position.z, 6);
        expect(hip.y - resident.seat.anchor.position.y).toBeGreaterThan(.24);
        expect(hip.y - resident.seat.anchor.position.y).toBeLessThan(.38);
        resident.seat.progress = 0;
        rig.update(resident, 1);
        expect(new THREE.Box3().setFromObject(rig.root, true).min.y).toBeCloseTo(resident.position.y, 2);
      } finally { rig.dispose(); }
    });

  it('does not dispose shared model resources when a single resident is released', async () => {
    const asset = await load('worker'), rig = createResidentRig(asset, state({ model: 'worker' }));
    const skin = rig.root.getObjectByName('body-mesh') as THREE.SkinnedMesh;
    const geometry = vi.spyOn(skin.geometry, 'dispose');
    const material = vi.spyOn(skin.material as THREE.Material, 'dispose');
    const skeleton = vi.spyOn(skin.skeleton, 'dispose');
    rig.dispose(); rig.dispose();
    expect(skeleton).toHaveBeenCalledOnce();
    expect(geometry).not.toHaveBeenCalled();
    expect(material).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('maps reactions and occupations only to verified animation names', () => {
    expect(residentClip('wave', 0)).toBe('emote-yes');
    expect(residentClip('startle', 0)).toBe('emote-no');
    expect(residentClip('flee', 0)).toBe('sprint');
    expect(residentClip('work', .7)).toBe('pick-up');
    expect(residentClip('shelter', 0)).toBe('idle');
  });
});

describe('resident presentation lifecycle and quality', () => {
  it.each(Object.keys(RESIDENT_MODELS) as (keyof typeof RESIDENT_MODELS)[])(
    'keeps a camera inside the native %s head clear at every quality', async model => {
      const asset = await load(model), resident = state({ model });
      const visuals = buildAmbientLifeVisuals([resident], { loadAsset: async () => asset });
      await visuals.ready;
      try {
        const actor = visuals.root.getObjectByName('resident-' + resident.id)!;
        const shadows = visuals.root.getObjectByName('resident-contact-shadows') as THREE.InstancedMesh;
        let time = 0;
        for (const [index, quality] of (['low', 'medium', 'high'] as const).entries()) {
          resident.yaw = index * Math.PI / 2 + .3;
          const clearCamera = new THREE.Vector3(resident.position.x, resident.position.y + 1, resident.position.z - 4);
          visuals.update([resident], ++time, clearCamera, quality);
          expect(actor.visible).toBe(true);
          // Probe the actual posed, authored head, not a guessed foot radius.
          const head = actor.getObjectByName('head-mesh')!;
          const insideHead = new THREE.Box3().setFromObject(head, true).getCenter(new THREE.Vector3());
          visuals.update([resident], ++time, insideHead, quality);
          expect(actor.visible).toBe(false);
          expect(shadows.count).toBe(0);
          expect(visuals.stats()).toMatchObject({ logical: 1, loaded: 1, visible: 0, animated: 1 });
          visuals.update([resident], ++time, clearCamera, quality);
          expect(actor.visible).toBe(true);
          expect(shadows.count).toBe(1);
        }
      } finally { visuals.dispose(); }
    });

  it('fades screen-filling foreground before hiding, independently from far range', async () => {
    const asset = await load('male-a'), resident = state({ yaw: 0, height: 2.2 });
    const visuals = buildAmbientLifeVisuals([resident], { loadAsset: async () => asset });
    await visuals.ready;
    try {
      const actor = visuals.root.getObjectByName('resident-' + resident.id)!;
      const bounds = new THREE.Box3().setFromObject(actor, true);
      const camera = bounds.getCenter(new THREE.Vector3());
      const skin = actor.getObjectByName('body-mesh') as THREE.SkinnedMesh;
      const original = skin.material as THREE.Material;
      let time = 0;
      const sample = (heights: number) => {
        camera.x = bounds.max.x + resident.height * heights;
        visuals.update([resident], ++time, camera);
        return actor.visible ? (skin.material as THREE.Material).opacity : 0;
      };
      expect(sample(2)).toBe(1);
      expect(skin.material).toBe(original);
      const foreground = sample(1.25);
      const close = sample(.72);
      expect(foreground).toBeLessThan(1);
      expect(close).toBeGreaterThan(0);
      expect(close).toBeLessThan(foreground);
      expect(skin.material).not.toBe(original);
      expect(original.opacity).toBe(1);
      expect(sample(.2)).toBe(0);
      expect(sample(2)).toBe(1);
      expect(skin.material).toBe(original);
      // Looking from well above a tall actor should not hide it merely
      // because the camera and feet share the same horizontal position.
      camera.set(resident.position.x, resident.position.y + resident.height * 2, resident.position.z);
      visuals.update([resident], ++time, camera);
      expect(actor.visible).toBe(true);
      camera.copy(bounds.getCenter(new THREE.Vector3()));
      visuals.update([resident], ++time, camera);
      expect(actor.visible).toBe(false);
      // Camera occlusion must not reset the independently active far band.
      for (const [distance, visible] of [[210, true], [226, false], [210, false], [204, true]] as const) {
        camera.set(resident.position.x + distance, resident.position.y, resident.position.z);
        visuals.update([resident], ++time, camera);
        expect(actor.visible).toBe(visible);
      }
    } finally { visuals.dispose(); }
  });

  it('restores current authored gait and reactions after repeated camera passes without changing residents', async () => {
    const asset = await load('female-a'), resident = state({ model: 'female-a' });
    const reference = createResidentRig(asset, resident);
    const visuals = buildAmbientLifeVisuals([resident], { loadAsset: async () => asset });
    await visuals.ready;
    try {
      const actor = visuals.root.getObjectByName('resident-' + resident.id)!;
      for (let frame = 1; frame <= 90; frame++) {
        const hidden = (frame >= 10 && frame < 30) || (frame >= 40 && frame < 60) || (frame >= 70 && frame < 90);
        resident.position.x += .025;
        resident.distanceTravelled = frame * .04;
        resident.activity = frame >= 70 && frame < 90 ? 'flee' : frame >= 40 && frame < 50 ? 'startle' :
          frame >= 50 && frame < 60 ? 'work' : frame >= 10 && frame < 20 ? 'wave' : 'walk';
        resident.speed = resident.activity === 'flee' ? 2.4 : resident.activity === 'walk' ? 1.2 : 0;
        const before = structuredClone(resident);
        const camera = new THREE.Vector3(resident.position.x, resident.position.y + resident.height * .75,
          resident.position.z + (hidden ? 0 : 4));
        const time = frame / 30;
        reference.update(resident, time);
        visuals.update([resident], time, camera, (['low', 'medium', 'high'] as const)[frame % 3]!);
        expect(resident).toEqual(before);
        expect(actor.visible).toBe(!hidden);
        if (hidden) continue;
        // Compare with an uninterrupted native rig, including transitions
        // that began and ended while this actor's presentation was hidden.
        reference.root.traverse(node => {
          if (!(node instanceof THREE.Bone)) return;
          const restored = actor.getObjectByName(node.name)!;
          expect(restored.position.distanceTo(node.position)).toBeLessThan(1e-8);
          expect(restored.quaternion.toArray()).toEqual(node.quaternion.toArray());
        });
      }
    } finally { visuals.dispose(); reference.dispose(); }
  });

  it('loads one template per model and keeps nearby population at every quality', async () => {
    const asset = await load('male-a');
    const loader = vi.fn(async () => asset);
    const residents = [state(), state({ id: 'second', phase: .69 })];
    const visuals = buildAmbientLifeVisuals(residents, { loadAsset: loader });
    await visuals.ready;
    try {
      expect(loader).toHaveBeenCalledOnce();
      for (const quality of ['low', 'medium', 'high'] as const) {
        visuals.update(residents, 1, new THREE.Vector3(4, 8, -5), quality);
        expect(visuals.stats()).toMatchObject({ logical: 2, loaded: 2, visible: 2, failedModels: [] });
      }
      visuals.update(residents, 2, new THREE.Vector3(1000, 0, 1000));
      expect(visuals.stats().visible).toBe(0);
      visuals.update(residents, 100, new THREE.Vector3(4, 8, -5));
      expect(visuals.stats().visible).toBe(2);
    } finally { visuals.dispose(); }
  });

  it('ignores late loader completion after dispose without reattaching actors', async () => {
    const asset = await load('male-a');
    let resolve!: (asset: GLTF) => void;
    const pending = new Promise<GLTF>(done => { resolve = done; });
    const visuals = buildAmbientLifeVisuals([state()], { loadAsset: () => pending });
    visuals.dispose();
    resolve(asset);
    await visuals.ready;
    expect(visuals.root.children).toHaveLength(0);
    expect(visuals.stats().loaded).toBe(0);
    visuals.dispose();
  });

  it('keeps failed art absent and reports the failure without placeholder actors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const visuals = buildAmbientLifeVisuals([state()], { loadAsset: async () => { throw new Error('blocked'); } });
    await visuals.ready;
    expect(visuals.stats()).toMatchObject({ logical: 1, loaded: 0, failedModels: ['male-a'] });
    expect(visuals.root.children.every(child => child.name === 'resident-contact-shadows')).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    visuals.dispose();
    warn.mockRestore();
  });

  it('supports headless construction and idempotent disposal without fetching', async () => {
    const visuals = buildAmbientLifeVisuals([state()]);
    await visuals.ready;
    expect(visuals.stats().loaded).toBe(0);
    visuals.dispose(); visuals.dispose();
    expect(visuals.root.children).toHaveLength(0);
  });
});
