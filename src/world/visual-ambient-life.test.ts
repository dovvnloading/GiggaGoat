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
