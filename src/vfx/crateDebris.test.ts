import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CRATE_CHIP_COUNT, CRATE_DUST_COUNT, CRATE_PLANK_COUNT,
  makeCrateBreakBurst, sampleCrateBreak, sampleCrateDust, sampleCrateFragment,
} from './crateDebrisMath';
import { CrateBreakDebris, createCrateBreakDebris } from './CrateBreakDebris';

const ground = { x: 2, y: 0.15, z: -3 };
const incoming = { x: 1, y: 0, z: 0 };

describe('crate break debris motion math (no Three.js or renderer)', () => {
  it('validates all inputs, treats size zero as silent and clamps extreme sizes', () => {
    expect(makeCrateBreakBurst(ground, incoming, 0)).toBeNull();
    expect(() => makeCrateBreakBurst({ x: Infinity, y: 0, z: 0 }, incoming, 1)).toThrow(RangeError);
    expect(() => makeCrateBreakBurst(ground, { x: 0, y: NaN, z: 0 }, 1)).toThrow(RangeError);
    expect(() => makeCrateBreakBurst(ground, incoming, -0.1)).toThrow(RangeError);
    expect(() => makeCrateBreakBurst(ground, incoming, Infinity)).toThrow(RangeError);
    expect(() => makeCrateBreakBurst(ground, incoming, NaN)).toThrow(RangeError);
    expect(makeCrateBreakBurst(ground, incoming, 10)).toEqual(
      makeCrateBreakBurst(ground, incoming, 3));
    const data = makeCrateBreakBurst(ground, { x: 0, y: 9, z: 0 }, 1)!;
    expect(data.direction).toEqual({ x: 1, y: 0, z: 0 });
    expect(data.position).toEqual(ground);
    expect(makeCrateBreakBurst(ground, { x: 3, y: 7, z: 4 }, 1)!.direction)
      .toEqual({ x: 0.6, y: 0, z: 0.8 });
  });

  it('holds an intact crate, cracks it, flashes gold, scatters wood and fades', () => {
    const burst = makeCrateBreakBurst(ground, incoming, 1)!;
    const intact = sampleCrateBreak(burst, 0)!;
    const cracked = sampleCrateBreak(burst, burst.lifetime * 0.10)!;
    const explosion = sampleCrateBreak(burst, burst.lifetime * 0.30)!;
    const fading = sampleCrateBreak(burst, burst.lifetime * 0.95)!;
    expect(intact.crateOpacity).toBe(1);
    expect(intact.crackOpacity).toBe(0);
    expect(intact.debrisOpacity).toBe(0);
    expect(cracked.crackOpacity).toBeGreaterThan(0.9);
    expect(cracked.crateOpacity).toBe(1);
    expect(explosion.crateOpacity).toBe(0);
    expect(explosion.flashOpacity).toBeGreaterThan(0.9);
    expect(explosion.debrisOpacity).toBeGreaterThan(0.9);
    expect(explosion.dustOpacity).toBeGreaterThan(0);
    expect(fading.debrisOpacity).toBeLessThan(0.2);
    expect(fading.flashOpacity).toBe(0);
    expect(sampleCrateBreak(burst, -1)).toBeNull();
    expect(sampleCrateBreak(burst, NaN)).toBeNull();
    expect(sampleCrateBreak(burst, burst.lifetime)).toBeNull();
  });

  it('makes deterministic airborne planks and small chips, biased by the incoming direction', () => {
    const right = makeCrateBreakBurst(ground, incoming, 1)!;
    const left = makeCrateBreakBurst(ground, { x: -1, y: 0, z: 0 }, 1)!;
    const a = sampleCrateFragment(right, 'plank', 1, right.lifetime * 0.32)!;
    const b = sampleCrateFragment(right, 'plank', 1, right.lifetime * 0.55)!;
    const flipped = sampleCrateFragment(left, 'plank', 1, left.lifetime * 0.55)!;
    expect(a).toEqual(sampleCrateFragment(right, 'plank', 1, right.lifetime * 0.32));
    expect(b.offset.x).toBeGreaterThan(a.offset.x);
    expect(b.offset.x).toBeCloseTo(-flipped.offset.x);
    expect(b.offset.z).toBeCloseTo(-flipped.offset.z);
    expect(b.offset.y).toBeGreaterThan(0);
    expect(b.rotation.z).not.toBe(a.rotation.z);
    const chip = sampleCrateFragment(right, 'chip', 4, right.lifetime * 0.42)!;
    expect(chip.scale).toBeLessThan(0.12);
    expect(a.scale).toBe(1);
    expect(sampleCrateFragment(right, 'plank', 0, 0)).toBeNull();
    expect(sampleCrateFragment(right, 'chip', 0, right.lifetime)).toBeNull();
    expect(() => sampleCrateFragment(right, 'plank', -1, 0)).toThrow(RangeError);
    expect(() => sampleCrateFragment(right, 'plank', CRATE_PLANK_COUNT, 0)).toThrow(RangeError);
    expect(() => sampleCrateFragment(right, 'chip', CRATE_CHIP_COUNT, 0)).toThrow(RangeError);
    expect(() => sampleCrateFragment(right, 'chip', 0.5, 0)).toThrow(RangeError);
  });

  it('scales with crate side length, with soft dust drifting opposite the strike', () => {
    const small = makeCrateBreakBurst(ground, incoming, 0.5)!;
    const large = makeCrateBreakBurst(ground, incoming, 2)!;
    const s = sampleCrateFragment(small, 'plank', 3, small.lifetime * 0.47)!;
    const l = sampleCrateFragment(large, 'plank', 3, large.lifetime * 0.47)!;
    expect(l.offset.y).toBeCloseTo(s.offset.y * 4);
    expect(l.offset.x).toBeCloseTo(s.offset.x * 4);
    expect(large.lifetime).toBeGreaterThan(small.lifetime);
    const d = sampleCrateDust(large, 2, large.lifetime * 0.48)!;
    expect(d.offset.x).toBeLessThan(0);
    expect(d.opacity).toBeGreaterThan(0);
    expect(d.diameter).toBeGreaterThan(0.3);
    expect(sampleCrateDust(large, 0, 0)).toBeNull();
    expect(sampleCrateDust(large, 0, large.lifetime)).toBeNull();
    expect(() => sampleCrateDust(large, -1, 0)).toThrow(RangeError);
    expect(() => sampleCrateDust(large, CRATE_DUST_COUNT, 0)).toThrow(RangeError);
  });
});

describe('crate break debris Three.js lifecycle (no WebGL needed)', () => {
  it('preallocates and recycles bursts, shows each stage and releases its resources', () => {
    const scene = new THREE.Scene();
    const crates = createCrateBreakDebris({ capacity: 2 });
    scene.add(crates.group);
    try {
      expect(crates.group.children).toHaveLength(2);
      crates.emit(new THREE.Vector3(1, 0, 2), incoming, 0);
      expect(crates.activeCount).toBe(0);
      crates.emit(new THREE.Vector3(1, 0, 2), incoming, 1);
      expect(crates.activeCount).toBe(1);
      const root = crates.group.children[0] as THREE.Group;
      expect(root.position.toArray()).toEqual([1, 0, 2]);
      expect(root.getObjectByName('intact wooden crate')!.visible).toBe(true);
      crates.update(0.10);
      expect(root.getObjectByName('branching black crate cracks')!.visible).toBe(true);
      crates.update(0.21);
      expect(root.getObjectByName('intact wooden crate')!.visible).toBe(false);
      expect(root.getObjectByName('flying wooden plank 0')!.visible).toBe(true);
      expect(root.getObjectByName('small flying wood chip 0')!.visible).toBe(true);
      expect(root.getObjectByName('ivory yellow crate impact flash')!.visible).toBe(true);
      expect(root.getObjectByName('peach crate dust puff 0')!.visible).toBe(true);
      const plankA = root.getObjectByName('flying wooden plank 0') as THREE.Group;
      const plankB = (crates.group.children[1] as THREE.Group)
        .getObjectByName('flying wooden plank 0') as THREE.Group;
      expect((plankA.children[0] as THREE.Mesh).geometry)
        .toBe((plankB.children[0] as THREE.Mesh).geometry);
      for (let j = 0; j < 15; j++) {
        crates.emit({ x: j, y: 0, z: 0 }, incoming, 1.5);
        crates.update(0.01);
      }
      expect(crates.group.children).toHaveLength(2);
      expect(crates.activeCount).toBe(2);
      crates.update(2);
      expect(crates.activeCount).toBe(0);
      crates.emit(ground, incoming, 2);
      crates.clear();
      expect(crates.activeCount).toBe(0);
      expect(crates.group.children.every(child => !child.visible)).toBe(true);
      expect(() => crates.update(-0.1)).toThrow(RangeError);
      expect(() => crates.update(NaN)).toThrow(RangeError);
    } finally {
      crates.dispose();
    }
    expect(scene.children).not.toContain(crates.group);
    expect(crates.group.children).toHaveLength(0);
    crates.dispose();
    expect(() => crates.emit(ground, incoming, 1)).toThrow(/disposed/);
    expect(() => crates.update(0.2)).toThrow(/disposed/);
    expect(() => new CrateBreakDebris({ capacity: 0 })).toThrow(RangeError);
    expect(() => new CrateBreakDebris({ capacity: 65 })).toThrow(RangeError);
    expect(() => new CrateBreakDebris({ capacity: 1.5 })).toThrow(RangeError);
  });

  it('samples the same pose after one big delta or several small deltas', () => {
    const a = new CrateBreakDebris({ capacity: 1 });
    const b = new CrateBreakDebris({ capacity: 1 });
    try {
      a.emit(ground, incoming, 1.25);
      b.emit(ground, incoming, 1.25);
      a.update(0.42);
      b.update(0.17);
      b.update(0.25);
      const ar = a.group.children[0] as THREE.Group;
      const br = b.group.children[0] as THREE.Group;
      const ap = ar.getObjectByName('flying wooden plank 2') as THREE.Group;
      const bp = br.getObjectByName('flying wooden plank 2') as THREE.Group;
      expect(ap.visible).toBe(bp.visible);
      expect(ap.position.distanceTo(bp.position)).toBeLessThan(1e-8);
      expect(ap.rotation.z).toBeCloseTo(bp.rotation.z, 8);
      const af = ar.getObjectByName('ivory yellow crate impact flash') as THREE.Sprite;
      const bf = br.getObjectByName('ivory yellow crate impact flash') as THREE.Sprite;
      expect(af.material.opacity).toBeCloseTo(bf.material.opacity, 8);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
