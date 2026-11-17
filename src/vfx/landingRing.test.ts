import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  LANDING_DEBRIS_COUNT, makeLandingRingBurst, sampleLandingDebris, sampleLandingRing,
} from './landingRingMath';
import { LandingImpactRing, createLandingImpactRing } from './LandingImpactRing';

describe('landing ring motion math (no renderer, scene or physics)', () => {
  it('requires finite ground contact and non-negative strength; zero is a no-op', () => {
    expect(makeLandingRingBurst({ x: 0, y: 0, z: 0 }, 0)).toBeNull();
    expect(() => makeLandingRingBurst({ x: NaN, y: 0, z: 0 }, 1)).toThrow(RangeError);
    expect(() => makeLandingRingBurst({ x: 0, y: Infinity, z: 0 }, 1)).toThrow(RangeError);
    expect(() => makeLandingRingBurst({ x: 0, y: 0, z: 0 }, -1)).toThrow(RangeError);
    expect(() => makeLandingRingBurst({ x: 0, y: 0, z: 0 }, Infinity)).toThrow(RangeError);
  });

  it('builds a thin pale ellipse, then a bright jagged outward shockwave, then fades', () => {
    const burst = makeLandingRingBurst({ x: 3, y: 0.2, z: -4 }, 1)!;
    const initial = sampleLandingRing(burst, 0)!;
    const middle = sampleLandingRing(burst, burst.lifetime * 0.38)!;
    const widest = sampleLandingRing(burst, burst.lifetime * 0.71)!;
    const fading = sampleLandingRing(burst, burst.lifetime * 0.94)!;
    expect(initial.spikeOpacity).toBe(0);
    expect(initial.ringOpacity).toBeGreaterThan(0);
    expect(middle.radius).toBeGreaterThan(initial.radius);
    expect(widest.radius).toBeGreaterThan(middle.radius);
    expect(middle.spikeOpacity).toBeGreaterThan(0.8);
    expect(widest.spikeHeight).toBeGreaterThan(middle.spikeHeight);
    expect(fading.ringOpacity).toBeLessThan(0.15);
    expect(fading.glowOpacity).toBeLessThan(middle.glowOpacity);
    expect(fading.spikeOpacity).toBeLessThan(middle.spikeOpacity);
    expect(sampleLandingRing(burst, -1)).toBeNull();
    expect(sampleLandingRing(burst, burst.lifetime)).toBeNull();
    expect(sampleLandingRing(burst, NaN)).toBeNull();
  });

  it('scales with strength but clamps extreme impacts', () => {
    const pos = { x: 0, y: 0, z: 0 };
    const tiny = makeLandingRingBurst(pos, 0.25)!;
    const normal = makeLandingRingBurst(pos, 1)!;
    const heavy = makeLandingRingBurst(pos, 4)!;
    const capped = makeLandingRingBurst(pos, 100)!;
    expect(tiny.radius).toBeLessThan(normal.radius);
    expect(normal.radius).toBeLessThan(heavy.radius);
    expect(tiny.lifetime).toBeLessThan(heavy.lifetime);
    expect(capped).toEqual(heavy);
    expect(makeLandingRingBurst(pos, 1)!.position).toEqual(pos);
  });

  it('sends eight repeatable chips outward/up and removes them after impact', () => {
    const burst = makeLandingRingBurst({ x: 10, y: 0, z: 4 }, 1)!;
    const a = sampleLandingDebris(burst, 2, burst.lifetime * 0.20)!;
    const b = sampleLandingDebris(burst, 2, burst.lifetime * 0.40)!;
    expect(a).toEqual(sampleLandingDebris(burst, 2, burst.lifetime * 0.20));
    expect(Math.hypot(b.offset.x, b.offset.z)).toBeGreaterThan(
      Math.hypot(a.offset.x, a.offset.z));
    expect(b.offset.y).toBeGreaterThan(0);
    expect(a.scale).toBeGreaterThan(0);
    expect(sampleLandingDebris(burst, 2, burst.lifetime * 0.95)).toBeNull();
    expect(() => sampleLandingDebris(burst, -1, 0.1)).toThrow(RangeError);
    expect(() => sampleLandingDebris(burst, LANDING_DEBRIS_COUNT, 0.1)).toThrow(RangeError);
  });
});

describe('landing impact ring Three.js lifecycle', () => {
  it('emits from a Vector3 + strength with a bounded, reusable mesh pool', () => {
    const scene = new THREE.Scene();
    const rings = createLandingImpactRing({ capacity: 2 });
    scene.add(rings.group);
    try {
      expect(rings.group.children).toHaveLength(2);
      rings.emit(new THREE.Vector3(1, 0, 3), 0);
      expect(rings.activeCount).toBe(0);
      rings.emit(new THREE.Vector3(1, 0, 3), 1);
      expect(rings.activeCount).toBe(1);
      rings.update(0.18);
      expect(rings.activeCount).toBe(1);
      expect(rings.group.children.some(child => child.visible)).toBe(true);
      for (let i = 0; i < 20; i++) {
        rings.emit({ x: i, y: 0, z: 0 }, 0.7 + i * 0.1);
        rings.update(0.01);
      }
      expect(rings.activeCount).toBe(2);
      expect(rings.group.children).toHaveLength(2);
      rings.update(5);
      expect(rings.activeCount).toBe(0);
      rings.emit({ x: 0, y: 0, z: 0 }, 2);
      rings.clear();
      expect(rings.activeCount).toBe(0);
      expect(rings.group.children.every(child => !child.visible)).toBe(true);
      expect(() => rings.update(-0.01)).toThrow(RangeError);
      expect(() => rings.update(NaN)).toThrow(RangeError);
    } finally {
      rings.dispose();
    }
    expect(scene.children).not.toContain(rings.group);
    expect(rings.group.children).toHaveLength(0);
    rings.dispose();
    expect(() => rings.emit({ x: 0, y: 0, z: 0 }, 1)).toThrow(/disposed/);
    expect(() => rings.update(0.1)).toThrow(/disposed/);
    expect(() => new LandingImpactRing({ capacity: 0 })).toThrow(RangeError);
    expect(() => new LandingImpactRing({ capacity: 65 })).toThrow(RangeError);
    expect(() => new LandingImpactRing({ capacity: 2.5 })).toThrow(RangeError);
  });

  it('is frame-rate independent at equal elapsed times', () => {
    const a = new LandingImpactRing({ capacity: 1 });
    const b = new LandingImpactRing({ capacity: 1 });
    try {
      a.emit({ x: 4, y: 0, z: -1 }, 1.5);
      b.emit({ x: 4, y: 0, z: -1 }, 1.5);
      a.update(0.22);
      b.update(0.10);
      b.update(0.12);
      const ra = a.group.children[0] as THREE.Group;
      const rb = b.group.children[0] as THREE.Group;
      expect(ra.position.equals(rb.position)).toBe(true);
      expect(ra.visible).toBe(rb.visible);
      const sa = ra.children[0] as THREE.Group;
      const sb = rb.children[0] as THREE.Group;
      expect(sa.scale.x).toBeCloseTo(sb.scale.x, 8);
      const ha = sa.children[0] as THREE.Mesh;
      const hb = sb.children[0] as THREE.Mesh;
      expect((ha.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(
        (hb.material as THREE.MeshBasicMaterial).opacity, 8);
      const chipA = ra.children[1] as THREE.Mesh;
      const chipB = rb.children[1] as THREE.Mesh;
      expect(chipA.position.distanceTo(chipB.position)).toBeLessThan(1e-8);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
