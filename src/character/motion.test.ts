import { describe, expect, it } from 'vitest';
import {
  ACTIONS, TIERS, TIER_PROFILES, actionFromPhysics, clamp01,
  decayLanding, previewRig, sampleMotion, tierFromPhysicsScale,
} from './motion';
import { LegacyGoatCharacter as GoatCharacter } from './LegacyGoatCharacter';
import { GoatRagdoll, PhysicsWorld, V } from '../physics';

describe('Gigga-Goat art contracts / pure deterministic motion', () => {
  it('round-trips the four exact physical sizes with increasing horn scale', () => {
    expect(TIERS).toEqual(['KID', 'BILLY', 'BIG', 'GIGGA']);
    expect(TIERS.map(t => TIER_PROFILES[t].physicsScale)).toEqual([.6, 1, 1.6, 3]);
    for (const tier of TIERS) {
      expect(tierFromPhysicsScale(TIER_PROFILES[tier].physicsScale)).toBe(tier);
    }
    expect(() => tierFromPhysicsScale(4)).toThrow(RangeError);
    expect(TIER_PROFILES.GIGGA.hornScale).toBeGreaterThan(TIER_PROFILES.BIG.hornScale);
    expect(TIER_PROFILES.GIGGA.glow).toBeGreaterThan(0);
    expect(TIER_PROFILES.BILLY.glow).toBe(0);
  });

  it('omits inactive fallback lights and keeps the GIGGA glow', () => {
    const character = new GoatCharacter();
    try {
      const visibleLightCount = () => {
        let count = 0;
        character.root.traverseVisible(object => {
          if (object.type === 'PointLight') count++;
        });
        return count;
      };
      expect(visibleLightCount()).toBe(0);
      character.setPreview('stand', 'GIGGA');
      expect(visibleLightCount()).toBe(1);
      character.setPreview('stand', 'KID');
      expect(visibleLightCount()).toBe(0);
    } finally { character.dispose(); }
  });

  it('prioritizes ragdoll, tether, climb and airborne over ordinary sprint', () => {
    const base = {
      ragdoll: false, tongueAttached: false, clinging: false,
      pose: 'stand' as const, sprinting: true, grounded: true,
    };
    expect(actionFromPhysics(base)).toBe('sprint');
    expect(actionFromPhysics({ ...base, grounded: false })).toBe('jump-flip');
    expect(actionFromPhysics({ ...base, clinging: true })).toBe('wall-climb');
    expect(actionFromPhysics({ ...base, tongueAttached: true, clinging: true })).toBe('tongue-grab');
    expect(actionFromPhysics({ ...base, ragdoll: true, tongueAttached: true })).toBe('flop');
  });

  it('has a finite, distinctive frame for every approved action pose', () => {
    expect(ACTIONS).toHaveLength(9);
    for (const action of ACTIONS) {
      const a = sampleMotion(action, 1.234, .8);
      expect(a).toEqual(sampleMotion(action, 1.234, .8));
      for (const value of Object.values(a)) expect(Number.isFinite(value)).toBe(true);
      expect(a.blink).toBeGreaterThanOrEqual(0);
      expect(a.blink).toBeLessThanOrEqual(1);
      expect(a.squash).toBeGreaterThan(0);
      expect(a.squash).toBeLessThanOrEqual(.24);
      expect(previewRig(action, 1.5).head.position).toHaveLength(3);
      for (const part of Object.values(previewRig(action, 1.5))) {
        for (const v of [...part.position, ...part.rotation]) expect(Number.isFinite(v)).toBe(true);
      }
    }
    expect(sampleMotion('bleat', 1).jawOpen).toBeGreaterThan(.9);
    expect(sampleMotion('tongue-grab', 1).tongueOut).toBe(1);
    expect(sampleMotion('headbutt', 1).browLift).toBeLessThan(0);
    expect(sampleMotion('flop', 1).blink).toBeGreaterThanOrEqual(.8);
    expect(sampleMotion('sprint', 1).bodyBob).toBeGreaterThanOrEqual(0);
    expect(previewRig('flop', 0).torso.position[1])
      .toBeLessThan(previewRig('stand', 0).torso.position[1]);
    expect(previewRig('jump-flip', .2).torso.position[1])
      .toBeGreaterThan(previewRig('stand', .2).torso.position[1]);
  });

  it('clamps bad inputs and decays a landing independent of frame splitting', () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
    expect(clamp01(-40)).toBe(0);
    expect(clamp01(8)).toBe(1);
    const one = decayLanding(1, .25);
    const two = decayLanding(decayLanding(1, .1), .15);
    expect(one).toBeCloseTo(two, 8);
    expect(one).toBeLessThan(.1);
    expect(decayLanding(1, -1)).toBe(1);
  });
});

describe('Three mesh / real Rapier binding without a canvas', () => {
  it('includes a seven-part articulated sculpt, mouth, horns, and working cosmetic mounts', () => {
    const art = new GoatCharacter();
    try {
      expect(art.root.children).toHaveLength(7);
      const head = art.mountWorldPosition('head');
      const back = art.mountWorldPosition('back');
      expect(head.y).toBeGreaterThan(back.y);
      art.setPreview('glide', 'GIGGA');
      const motion = art.update(1 / 60);
      expect(art.tier).toBe('GIGGA');
      expect(art.action).toBe('glide');
      expect(motion.jawOpen).toBeLessThan(1);
      const glider = art.root.getObjectByName('optional hang-glider cosmetic');
      expect(glider?.visible).toBe(true);
      art.setPreview('bleat', 'BILLY');
      expect(glider?.visible).toBe(false);
      expect(() => art.setPreview('none' as never)).toThrow(RangeError);
      expect(() => art.update(-1)).toThrow(RangeError);
    } finally { art.dispose(); }
  });

  it('uses interpolated current RAGDOLL bodies, and survives physics resize', async () => {
    const physics = await PhysicsWorld.create();
    physics.createGround(V(20, .5, 20));
    const goat = new GoatRagdoll(physics, { size: 1 });
    const art = new GoatCharacter(goat);
    try {
      physics.step(1 / 60);
      const alpha = .4;
      art.update(1 / 60, alpha);
      const torso = art.root.getObjectByName('ragdoll torso');
      const pose = physics.getInterpolatedTransform(goat.torso, alpha);
      expect(torso?.position.y).toBeCloseTo(pose.translation.y, 6);
      expect(torso?.quaternion.w).toBeCloseTo(pose.rotation.w, 6);
      const before = { ...goat.torso.translation() };
      art.play('bleat', .4);
      art.update(.01);
      const after = goat.torso.translation();
      expect(after.x).toBeCloseTo(before.x, 10);
      expect(after.y).toBeCloseTo(before.y, 10);
      expect(after.z).toBeCloseTo(before.z, 10);
      goat.resize(3);
      physics.step(1 / 60);
      art.update(.016);
      expect(art.tier).toBe('GIGGA');
      expect(torso?.scale.x).toBe(3);
      expect(art.root.children).toHaveLength(7);
      art.bind(null);
      art.setPreview('tongue-grab', 'KID');
      art.update(.016);
      expect(art.tier).toBe('KID');
    } finally {
      art.dispose();
      goat.dispose();
      physics.dispose();
    }
  });
});
