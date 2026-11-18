import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { forward } from '../physics/math';
import { GOAT_SIZES } from '../physics/GoatRagdoll';
import { Game } from '../core/Game';
import { heightAt } from '../world';
import { GoatCharacter } from './GoatCharacter';
import { LegacyGoatCharacter } from './LegacyGoatCharacter';
import {
  GOAT_CLIPS, GOAT_GLB_FILES, GOAT_VARIANTS, clipForAction,
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

const FACING_BONES: Record<GoatVariant, { muzzle: string; tail: string }> = {
  hero: { muzzle: 'joint_39', tail: 'joint_03' },
  bandana: { muzzle: 'jaw', tail: 'tail4' },
  bell: { muzzle: 'head_13', tail: 'tail4' },
};

describe('rigged GLB heading matches physical forward', () => {
  it.each(GOAT_VARIANTS)('%s faces forward with its actual animated muzzle and tail',
    async variant => {
      const art = new GoatCharacter(undefined, { variant });
      try {
        // Parse the real skin and clips in Node. Only embedded texture decoding is stubbed.
        vi.stubGlobal('self', globalThis);
        vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
        const bytes = readFileSync(resolve(process.cwd(), 'public/assets/characters/goat',
          GOAT_GLB_FILES[variant]));
        const gltf = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
        (art as unknown as { attachRig(gltf: GLTF): void }).attachRig(gltf);
        expect(art.isReady).toBe(true);

        const muzzle = art.root.getObjectByName(FACING_BONES[variant].muzzle);
        const tail = art.root.getObjectByName(FACING_BONES[variant].tail);
        expect(muzzle).toBeInstanceOf(THREE.Bone);
        expect(tail).toBeInstanceOf(THREE.Bone);
        const nose = new THREE.Vector3(), back = new THREE.Vector3();
        const expected = new THREE.Vector3();
        for (const clip of ['Idle', 'Walk', 'Run'] as const) {
          art.setPreviewClip(clip);
          art.seek(.2);
          for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            // Rapier's torso quaternion for a travel heading uses the opposite Y sign.
            art.root.rotation.y = -yaw;
            const wanted = forward(yaw);
            expected.set(wanted.x, 0, wanted.z);
            muzzle!.getWorldPosition(nose).sub(tail!.getWorldPosition(back));
            nose.y = 0;
            expect(nose.normalize().dot(expected), variant + ' ' + clip + ' yaw=' + yaw)
              .toBeGreaterThan(.98);
          }
        }
      } finally {
        vi.unstubAllGlobals();
        art.dispose();
      }
    });
});


it('seats all four rendered idle soles and their marks on the live asphalt at every size', async () => {
  const game = await Game.create();
  const art = GOAT_VARIANTS.map(variant => new GoatCharacter(game.goat, { variant }));
  try {
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
    const rigs = await Promise.all(art.map(async character => {
      const bytes = readFileSync(resolve(process.cwd(), 'public/assets/characters/goat',
        GOAT_GLB_FILES[character.variant]));
      const gltf = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
      (character as unknown as { attachRig(gltf: GLTF): void }).attachRig(gltf);
      let skin: THREE.SkinnedMesh | undefined;
      character.root.traverse(object => {
        if (object instanceof THREE.SkinnedMesh) skin = object;
      });
      expect(skin).toBeDefined();
      return { character, skin: skin! };
    }));

    const x = -148.79, z = 127.10;
    const point = new THREE.Vector3(), mark = new THREE.Vector3();
    for (const size of GOAT_SIZES) {
      const goat = game.goat;
      if (goat.size !== size) {
        game.water.untrack(goat.torso);
        goat.resize(size);
        game.water.track(goat.torso, { buoyancyScale: .7, paddleSpeed: 2.6 });
      }
      game.teleport({ x, y: heightAt(game.island, x, z), z }, 0);
      for (let tick = 0; tick < 140; tick++) game.step();
      expect(goat.locomotion.grounded).toBe(true);
      const { point: base, normal } = goat.locomotion.groundHit!;
      const elevation = (x: number, z: number): number =>
        base.y - ((x - base.x) * normal.x + (z - base.z) * normal.z) / normal.y;
      for (const { character, skin } of rigs) {
        const vertices = skin.geometry.getAttribute('position');
        for (const frame of [0, .25, .5, 1]) {
          character.seek(frame);
          character.root.updateMatrixWorld(true);
          const soles = Array.from({ length: 4 }, () => ({ y: Infinity, x: 0, z: 0, count: 0 }));
          for (let i = 0; i < vertices.count; i++) {
            const x = vertices.getX(i), z = vertices.getZ(i);
            if (vertices.getY(i) > .022 || Math.abs(x) < .08 || Math.abs(z) < .12) continue;
            skin.getVertexPosition(i, point).applyMatrix4(skin.matrixWorld);
            const foot = soles[Number(x > 0) + 2 * Number(z > 0)]!;
            foot.y = Math.min(foot.y, point.y - elevation(point.x, point.z));
            foot.x += point.x;
            foot.z += point.z;
            foot.count++;
          }
          for (const [index, sole] of soles.entries()) {
            const context = character.variant + ' / size ' + size + ' / foot ' + index;
            expect(sole.count, context).toBeGreaterThan(10);
            expect(sole.y, context).toBeGreaterThan(-.003 * size);
            expect(sole.y, context).toBeLessThan(.018 * size);
            expect(character.idleSolePosition(index, mark), context).toBe(true);
            expect(Math.hypot(mark.x - sole.x / sole.count, mark.z - sole.z / sole.count), context)
              .toBeLessThan(.034 * size);
          }
        }
      }
    }

    game.step({ jump: true });
    for (let tick = 0; tick < 8; tick++) game.step();
    expect(game.goat.locomotion.grounded).toBe(false);
    const pose = game.physics.getInterpolatedTransform(game.goat.torso, game.physics.alpha);
    const rotation = new THREE.Quaternion(pose.rotation.x, pose.rotation.y,
      pose.rotation.z, pose.rotation.w);
    const expected = new THREE.Vector3(0, -.92 * game.goat.size, 0).applyQuaternion(rotation)
      .add(new THREE.Vector3(pose.translation.x, pose.translation.y, pose.translation.z));
    for (const character of art) {
      character.update(1 / 60, game.physics.alpha);
      expect(character.idleSolePosition(0, mark)).toBe(false);
      const model = character.root.getObjectByName('rigged goat | ' + character.variant)!;
      expect(model.position.distanceTo(expected)).toBeLessThan(1e-6);
      expect(model.quaternion.angleTo(rotation)).toBeLessThan(.001);
    }
  } finally {
    for (const character of art) character.dispose();
    game.dispose();
    vi.unstubAllGlobals();
  }
});
