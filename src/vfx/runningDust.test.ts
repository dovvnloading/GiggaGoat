import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  groundDirection, makeDustBurst, sampleDustParticle, seededRandom,
} from './dustMath';
import { RunningDustPuffs, createRunningDustPuffs } from './RunningDustPuffs';

describe('running dust puff logic (no renderer, DOM or physics)', () => {
  it('is seeded and repeatable, with round cloud lobes and separate flying flecks', () => {
    const at = { x: 3, y: 0, z: -2 };
    const run = { x: -7, y: 9, z: 0 };
    const a = makeDustBurst(at, run, seededRandom(71));
    const b = makeDustBurst(at, run, seededRandom(71));
    expect(a).toEqual(b);
    expect(a.filter(p => p.kind === 'puff')).toHaveLength(8);
    expect(a.filter(p => p.kind === 'fleck')).toHaveLength(6);
    expect(a.every(p => p.origin.x > at.x)).toBe(true); // behind -X
    expect(a.every(p => p.origin.y > at.y)).toBe(true);
    expect(a.every(p => p.radius > 0 && p.lifetime > 0)).toBe(true);
    expect(a.some(p => p.radius > 0.35)).toBe(true); // large cloud
    expect(a.some(p => p.radius < 0.08)).toBe(true); // tiny flecks
  });

  it('rotates into either horizontal heading without reversing the trail', () => {
    expect(groundDirection({ x: 0, y: -200, z: 10 })).toEqual({ x: 0, y: 0, z: 1 });
    expect(groundDirection({ x: 0, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: 0 });
    const z = makeDustBurst({ x: 0, y: 2, z: 5 },
      { x: 0, y: 100, z: 1 }, seededRandom(10));
    expect(z.every(p => p.origin.z < 5)).toBe(true);
    expect(z.every(p => p.origin.y > 2)).toBe(true);
    expect(() => groundDirection({ x: Infinity, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => makeDustBurst({ x: NaN, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => seededRandom(NaN)).toThrow(RangeError);
  });

  it('grows a small puff into an overlapping cloud, lifts and fades it out', () => {
    const puff = makeDustBurst({ x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 }, seededRandom(20))[3]!;
    expect(sampleDustParticle(puff, -0.01)).toBeNull();
    expect(sampleDustParticle(puff, puff.delay - 0.001)).toBeNull();
    const early = sampleDustParticle(puff, puff.delay + puff.lifetime * 0.2)!;
    const full = sampleDustParticle(puff, puff.delay + puff.lifetime * 0.59)!;
    const late = sampleDustParticle(puff, puff.delay + puff.lifetime * 0.94)!;
    expect(full.diameter).toBeGreaterThan(early.diameter);
    expect(full.position.y).toBeGreaterThan(early.position.y);
    expect(full.position.x).toBeLessThan(early.position.x); // behind +X
    expect(early.opacity).toBeGreaterThan(0.5);
    expect(late.opacity).toBeLessThan(full.opacity);
    expect(sampleDustParticle(puff, puff.delay + puff.lifetime)).toBeNull();
    expect(sampleDustParticle(puff, Infinity)).toBeNull();
  });
});

describe('running dust Three.js lifecycle', () => {
  it('is callable with world position/direction and bounded by its sprite pool', () => {
    const scene = new THREE.Scene();
    const dust = createRunningDustPuffs({ capacity: 9, seed: 4 });
    scene.add(dust.group);
    try {
      expect(dust.group.children).toHaveLength(9);
      dust.emit(new THREE.Vector3(1, 0, -3), new THREE.Vector3(-1, 0, 0));
      dust.update(0.14);
      expect(dust.activeCount).toBeGreaterThan(0);
      expect(dust.activeCount).toBeLessThanOrEqual(9);
      expect(dust.group.children.every(o => o instanceof THREE.Sprite)).toBe(true);
      for (let i = 0; i < 30; i++) {
        dust.emit({ x: i, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
        dust.update(1 / 60);
      }
      expect(dust.group.children).toHaveLength(9);
      expect(dust.activeCount).toBeLessThanOrEqual(9);
      dust.update(3);
      expect(dust.activeCount).toBe(0);
      dust.emit({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
      dust.update(0.1);
      expect(dust.activeCount).toBeGreaterThan(0);
      dust.clear();
      expect(dust.activeCount).toBe(0);
      expect(() => dust.update(-0.1)).toThrow(RangeError);
      expect(() => dust.update(Infinity)).toThrow(RangeError);
    } finally {
      dust.dispose();
    }
    expect(scene.children).not.toContain(dust.group);
    expect(dust.group.children).toHaveLength(0);
    dust.dispose(); // idempotent
    expect(() => dust.emit({ x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 })).toThrow(/disposed/);
    expect(() => new RunningDustPuffs({ capacity: 0 })).toThrow(RangeError);
    expect(() => new RunningDustPuffs({ capacity: 1.5 })).toThrow(RangeError);
  });

  it('is frame-rate independent when advancing by the same total time', () => {
    const a = new RunningDustPuffs({ capacity: 32, seed: 90 });
    const b = new RunningDustPuffs({ capacity: 32, seed: 90 });
    try {
      const position = { x: 0, y: 0.2, z: 0 };
      const direction = { x: 1, y: 0, z: -1 };
      a.emit(position, direction);
      b.emit(position, direction);
      a.update(0.32);
      b.update(0.11);
      b.update(0.21);
      for (let i = 0; i < 32; i++) {
        const pa = a.group.children[i] as THREE.Sprite;
        const pb = b.group.children[i] as THREE.Sprite;
        expect(pa.visible).toBe(pb.visible);
        expect(pa.position.distanceTo(pb.position)).toBeLessThan(1e-8);
        expect(pa.scale.x).toBeCloseTo(pb.scale.x, 8);
        expect(pa.material.opacity).toBeCloseTo(pb.material.opacity, 8);
      }
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
