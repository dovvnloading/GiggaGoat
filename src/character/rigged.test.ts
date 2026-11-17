import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { forward } from '../physics/math';
import { GoatCharacter } from './GoatCharacter';
import { LegacyGoatCharacter } from './LegacyGoatCharacter';
import {
  GOAT_CLIPS, GOAT_GLB_FILES, GOAT_VARIANTS, alignRiggedSceneForward, clipForAction,
  locomotionBlend, selectGoatVariant, type GoatVariant,
} from './rigged';

describe('GLB variant selection', () => {
  it('reserves the hero for the player, with an explicit override when requested', () => {
    expect(selectGoatVariant()).toBe('hero');
    expect(selectGoatVariant({ id: 'player' })).toBe('hero');
    expect(selectGoatVariant('player', { seed: 'level-12' })).toBe('hero');
    expect(selectGoatVariant('player', { variant: 'bell' })).toBe('bell');
    expect(selectGoatVariant(undefined, { variant: 'bandana' })).toBe('bandana');
    expect(() => selectGoatVariant(null, { variant: 'bad' as never })).toThrow(RangeError);
    expect(GOAT_VARIANTS).toEqual(['hero', 'bandana', 'bell']);
    expect(Object.values(GOAT_GLB_FILES)).toEqual([
      'goat_hero.glb', 'goat_alt_bandana.glb', 'goat_alt_bell.glb',
    ]);
  });

  it('uses a deterministic, varied hash for bots or a supplied seed', () => {
    for (const id of ['bot-1', 'bot-9', 'any-bot']) {
      const selected = selectGoatVariant(id);
      expect(GOAT_VARIANTS).toContain(selected);
      expect(selectGoatVariant({ id })).toBe(selected);
      expect(selectGoatVariant(id)).toBe(selected);
    }
    const options = { seed: 'seeded-island' };
    expect(selectGoatVariant('bot-42', options))
      .toBe(selectGoatVariant('bot-12', options));
    const variants = new Set(Array.from({ length: 90 }, (_, n) =>
      selectGoatVariant('bot-' + n)));
    expect(variants.size).toBe(3);
  });
});

describe('physics speed to rig locomotion', () => {
  it('keeps the blend normalized and honors the Walk / Run authored speeds', () => {
    expect(locomotionBlend(0)).toEqual({ Idle: 1, Walk: 0, Run: 0 });
    expect(locomotionBlend(1.2)).toEqual({ Idle: 0, Walk: 1, Run: 0 });
    expect(locomotionBlend(3.5)).toEqual({ Idle: 0, Walk: 0, Run: 1 });
    expect(locomotionBlend(9)).toEqual({ Idle: 0, Walk: 0, Run: 1 });
    const between = locomotionBlend(2.35);
    expect(between.Idle).toBe(0);
    expect(between.Walk).toBeCloseTo(.5, 8);
    expect(between.Run).toBeCloseTo(.5, 8);
    expect(locomotionBlend(.6)).toEqual({ Idle: .5, Walk: .5, Run: 0 });
    for (const speed of [0, .2, 1, 1.2, 1.8, 3.1, 3.5, 12, -3, NaN]) {
      const weights = Object.values(locomotionBlend(speed));
      expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 8);
      for (const weight of weights) expect(weight).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('animation clip routing and compatible fallback', () => {
  it('routes public action aliases to all six clip names', () => {
    expect(GOAT_CLIPS).toEqual(['Idle', 'Walk', 'Run', 'Jump', 'Headbutt', 'Bleat']);
    expect(clipForAction('stand')).toBe('Idle');
    expect(clipForAction('sprint')).toBe('Run');
    expect(clipForAction('jump')).toBe('Jump');
    expect(clipForAction('jump-flip')).toBe('Jump');
    expect(clipForAction('headbutt')).toBe('Headbutt');
    expect(clipForAction('bleat')).toBe('Bleat');
    expect(clipForAction('flop')).toBe('Idle');
    expect(clipForAction('tongue-grab')).toBe('Idle');
  });

  it('preserves a live seven-part legacy goat and its mount API without a browser', () => {
    const art = new GoatCharacter(undefined, { variant: 'bell' });
    try {
      expect(art.variant).toBe('bell');
      expect(art.isReady).toBe(false);
      expect(art.root.children).toHaveLength(7);
      expect(art.root.getObjectByName('ragdoll torso')).toBeDefined();
      expect(art.mounts.head.parent).toBeDefined();
      expect(art.mountWorldPosition('head').y)
        .toBeGreaterThan(art.mountWorldPosition('back').y);
      art.setPreviewClip('Walk', 'KID');
      expect(art.tier).toBe('KID');
      expect(art.update(1 / 30).bodyBob).toBeGreaterThanOrEqual(0);
      art.play('jump', .4);
      art.update(.01);
      expect(art.action).toBe('jump-flip');
      expect(() => art.play('not-an-action' as never)).toThrow(RangeError);
      expect(() => art.setPreviewClip('Bad' as never)).toThrow(RangeError);
      expect(() => art.update(-1)).toThrow(RangeError);
      art.bind(null);
      expect(art.physics).toBeNull();
    } finally {
      art.dispose();
    }
    expect(art.root.parent).toBeNull();
    expect(() => art.update(.02)).toThrow('disposed');
    expect(LegacyGoatCharacter).toBeDefined();
  });
});

describe('checked-in GLB animation contract', () => {
  it.each(GOAT_VARIANTS)('%s contains a skin and all six named baked clips', variant => {
    // GLB 2.0 stores JSON in the first chunk. This checks the actual public
    // assets without WebGL, a browser, or duplicating the binary in this lane.
    const file = resolve(process.cwd(), 'public/assets/characters/goat',
      GOAT_GLB_FILES[variant]);
    const bytes = readFileSync(file);
    expect(bytes.toString('ascii', 0, 4)).toBe('glTF');
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.byteLength);
    expect(bytes.toString('ascii', 16, 20)).toBe('JSON');
    const length = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + length)) as {
      nodes?: unknown[];
      skins?: { joints?: number[] }[];
      animations?: { name?: string }[];
    };
    expect(gltf.nodes?.length).toBeGreaterThan(0);
    expect(gltf.skins?.some(skin => (skin.joints?.length ?? 0) > 0)).toBe(true);
    expect(new Set(gltf.animations?.map(animation => animation.name)))
      .toEqual(new Set(GOAT_CLIPS));
  });
});

/** Read the actual exported scene root, not an assumed mock GLB orientation. */
function exportedArmatureRotation(variant: GoatVariant): THREE.Quaternion {
  const bytes = readFileSync(resolve(process.cwd(), 'public/assets/characters/goat',
    GOAT_GLB_FILES[variant]));
  const length = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + length)) as {
    scene?: number;
    scenes?: { nodes?: number[] }[];
    nodes?: { name?: string; rotation?: number[] }[];
  };
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? [];
  const armature = roots.map(index => gltf.nodes?.[index])
    .find(node => node?.name === 'purebind_armature');
  if (!armature?.rotation) throw new Error(variant + ' GLB has no exported armature rotation');
  return new THREE.Quaternion().fromArray(armature.rotation);
}

describe('rigged GLB heading matches physical forward', () => {
  it.each(GOAT_VARIANTS)('%s renders its local -Z nose in the travel direction at cardinal yaws',
    variant => {
      const bakedRotation = exportedArmatureRotation(variant);
      // Without the correction this exported 180° root rotation faces backward.
      expect(new THREE.Vector3(0, 0, -1).applyQuaternion(bakedRotation).z)
        .toBeGreaterThan(.999);

      const rigModel = new THREE.Group();
      const clonedScene = new THREE.Group();
      const armature = new THREE.Group();
      armature.quaternion.copy(bakedRotation);
      clonedScene.add(armature);
      rigModel.add(clonedScene);
      alignRiggedSceneForward(clonedScene);

      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        // Physics forward(yaw) goes toward +X for +PI/2, whereas a positive
        // Three.js Y rotation turns local -Z toward -X. The balanced torso
        // therefore has rotation -yaw for the corresponding travel heading.
        rigModel.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
        rigModel.updateMatrixWorld(true);
        const nose = new THREE.Vector3(0, 0, -1)
          .transformDirection(armature.matrixWorld);
        const wanted = forward(yaw);
        expect(nose.distanceTo(new THREE.Vector3(wanted.x, wanted.y, wanted.z)),
          variant + ' yaw=' + yaw).toBeLessThan(1e-5);
      }
    });
});
