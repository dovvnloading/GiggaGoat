import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  WATER_DROPLET_COUNT, makeWaterSplashBurst, sampleWaterDroplet, sampleWaterSplash,
} from './waterSplashMath';
import { WaterSplash, createWaterSplash } from './WaterSplash';

describe('water splash motion math (independent of Three.js and WebGL)', () => {
  const surface = { x: 2, y: 0.3, z: -3 };

  it('validates surface, speed and mass and treats either zero as a no-op', () => {
    expect(makeWaterSplashBurst(surface, 0, 1.5)).toBeNull();
    expect(makeWaterSplashBurst(surface, 6, 0)).toBeNull();
    expect(() => makeWaterSplashBurst({ x: NaN, y: 0, z: 0 }, 6, 1)).toThrow(RangeError);
    expect(() => makeWaterSplashBurst({ x: 0, y: Infinity, z: 0 }, 6, 1)).toThrow(RangeError);
    expect(() => makeWaterSplashBurst(surface, -1, 1)).toThrow(RangeError);
    expect(() => makeWaterSplashBurst(surface, 1, -1)).toThrow(RangeError);
    expect(() => makeWaterSplashBurst(surface, Infinity, 1)).toThrow(RangeError);
    expect(() => makeWaterSplashBurst(surface, 1, NaN)).toThrow(RangeError);
    expect(makeWaterSplashBurst(surface, 6, 1.5)!.position).toEqual(surface);
  });

  it('expands a first thin ripple into a low splash, high crown, then fades', () => {
    const splash = makeWaterSplashBurst(surface, 6, 1.5)!;
    const first = sampleWaterSplash(splash, 0)!;
    const middle = sampleWaterSplash(splash, splash.lifetime * 0.30)!;
    const crown = sampleWaterSplash(splash, splash.lifetime * 0.57)!;
    const last = sampleWaterSplash(splash, splash.lifetime * 0.95)!;
    expect(first.rippleOpacity).toBeGreaterThan(0.7);
    expect(first.crownOpacity).toBe(0);
    expect(first.foamOpacity).toBe(0);
    expect(middle.crownOpacity).toBeGreaterThan(0.8);
    expect(middle.crownHeight).toBeGreaterThan(0);
    expect(crown.crownHeight).toBeGreaterThan(middle.crownHeight);
    expect(crown.crownRadius).toBeGreaterThan(middle.crownRadius);
    expect(first.rippleRadius).toBeLessThan(middle.rippleRadius);
    expect(middle.rippleRadius).toBeLessThan(crown.rippleRadius);
    expect(last.rippleOpacity).toBeLessThan(0.08);
    expect(last.crownOpacity).toBeLessThan(0.09);
    expect(sampleWaterSplash(splash, -0.1)).toBeNull();
    expect(sampleWaterSplash(splash, splash.lifetime)).toBeNull();
    expect(sampleWaterSplash(splash, NaN)).toBeNull();
  });

  it('makes higher speed taller and greater mass wider without unbounded values', () => {
    const slow = makeWaterSplashBurst(surface, 2, 1.5)!;
    const fast = makeWaterSplashBurst(surface, 12, 1.5)!;
    const light = makeWaterSplashBurst(surface, 6, 0.5)!;
    const heavy = makeWaterSplashBurst(surface, 6, 4)!;
    expect(fast.height).toBeGreaterThan(slow.height);
    expect(heavy.radius).toBeGreaterThan(light.radius);
    expect(fast.lifetime).toBeGreaterThan(slow.lifetime);
    expect(makeWaterSplashBurst(surface, 999, 999)).toEqual(
      makeWaterSplashBurst(surface, 16, 8));
  });

  it('ejects deterministic teardrops on upward/outward arcs during crown stage', () => {
    const splash = makeWaterSplashBurst(surface, 6, 1.5)!;
    expect(sampleWaterDroplet(splash, 0, 0)).toBeNull();
    const early = sampleWaterDroplet(splash, 0, splash.lifetime * 0.23)!;
    const apex = sampleWaterDroplet(splash, 0, splash.lifetime * 0.50)!;
    const late = sampleWaterDroplet(splash, 0, splash.lifetime * 0.76)!;
    expect(early).not.toBeNull();
    expect(apex).toEqual(sampleWaterDroplet(splash, 0, splash.lifetime * 0.50));
    expect(apex.offset.y).toBeGreaterThan(early.offset.y);
    expect(apex.offset.y).toBeGreaterThan(late.offset.y);
    expect(Math.hypot(late.offset.x, late.offset.z)).toBeGreaterThan(
      Math.hypot(early.offset.x, early.offset.z));
    expect(apex.size).toBeGreaterThan(0);
    expect(apex.opacity).toBeGreaterThan(0);
    expect(sampleWaterDroplet(splash, 0, splash.lifetime * 0.95)).toBeNull();
    expect(() => sampleWaterDroplet(splash, -1, 0.3)).toThrow(RangeError);
    expect(() => sampleWaterDroplet(splash, WATER_DROPLET_COUNT, 0.3)).toThrow(RangeError);
    expect(() => sampleWaterDroplet(splash, 1.5, 0.3)).toThrow(RangeError);
  });
});

describe('water splash Three.js lifecycle', () => {
  it('uses a bounded and reusable scene-graph pool and disposes its own resources', () => {
    const scene = new THREE.Scene();
    const splash = createWaterSplash({ capacity: 2 });
    scene.add(splash.group);
    try {
      expect(splash.group.children).toHaveLength(2);
      splash.emit(new THREE.Vector3(1, 0, 2), 0, 1);
      expect(splash.activeCount).toBe(0);
      splash.emit(new THREE.Vector3(1, 0, 2), 6, 1.5);
      expect(splash.activeCount).toBe(1);
      const root = splash.group.children[0] as THREE.Group;
      const ripple = root.children[0] as THREE.Group;
      expect(root.position.toArray()).toEqual([1, 0, 2]);
      expect(root.visible).toBe(true);
      expect((ripple.children[1] as THREE.Mesh).visible).toBe(true);
      splash.update(0.35);
      expect((root.children[2] as THREE.Group).visible).toBe(true);
      expect(root.children.some(child => child instanceof THREE.Sprite && child.visible)).toBe(true);
      const firstJets = (root.children[2] as THREE.Group).children[0] as THREE.Mesh;
      const secondJets = ((splash.group.children[1] as THREE.Group).children[2] as THREE.Group)
        .children[0] as THREE.Mesh;
      expect(firstJets.geometry).toBe(secondJets.geometry);
      for (let i = 0; i < 12; i++) {
        splash.emit({ x: i, y: 0, z: 0 }, 3 + i, 1);
        splash.update(0.01);
      }
      expect(splash.activeCount).toBe(2);
      expect(splash.group.children).toHaveLength(2);
      splash.update(3);
      expect(splash.activeCount).toBe(0);
      splash.emit({ x: 0, y: 0, z: 0 }, 6, 1.5);
      splash.clear();
      expect(splash.activeCount).toBe(0);
      expect(splash.group.children.every(child => !child.visible)).toBe(true);
      expect(() => splash.update(-0.01)).toThrow(RangeError);
      expect(() => splash.update(Infinity)).toThrow(RangeError);
    } finally {
      splash.dispose();
    }
    expect(scene.children).not.toContain(splash.group);
    expect(splash.group.children).toHaveLength(0);
    splash.dispose();
    expect(() => splash.emit({ x: 0, y: 0, z: 0 }, 5, 1)).toThrow(/disposed/);
    expect(() => splash.update(0.1)).toThrow(/disposed/);
    expect(() => new WaterSplash({ capacity: 0 })).toThrow(RangeError);
    expect(() => new WaterSplash({ capacity: 65 })).toThrow(RangeError);
    expect(() => new WaterSplash({ capacity: 2.5 })).toThrow(RangeError);
  });

  it('has identical poses for one update or multiple updates at the same age', () => {
    const a = new WaterSplash({ capacity: 1 });
    const b = new WaterSplash({ capacity: 1 });
    try {
      a.emit(new THREE.Vector3(2, 0, 3), 8, 1.5);
      b.emit({ x: 2, y: 0, z: 3 }, 8, 1.5);
      a.update(0.35);
      b.update(0.12);
      b.update(0.23);
      const ar = a.group.children[0] as THREE.Group;
      const br = b.group.children[0] as THREE.Group;
      expect(ar.visible).toBe(br.visible);
      const ac = ar.children[2] as THREE.Group;
      const bc = br.children[2] as THREE.Group;
      expect(ac.scale.distanceTo(bc.scale)).toBeLessThan(1e-8);
      const aj = ac.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      const bj = bc.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      expect(aj.material.opacity).toBeCloseTo(bj.material.opacity, 8);
      const ad = ar.children[3] as THREE.Sprite;
      const bd = br.children[3] as THREE.Sprite;
      expect(ad.position.distanceTo(bd.position)).toBeLessThan(1e-8);
      expect(ad.material.opacity).toBeCloseTo(bd.material.opacity, 8);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
