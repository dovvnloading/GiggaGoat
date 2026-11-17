import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  HEADBUTT_STAR_COUNT, makeHeadbuttBurst, sampleHeadbuttFlash, sampleHeadbuttStar,
} from './headbuttMath';
import { HeadbuttImpactStars, createHeadbuttImpactStars } from './HeadbuttImpactStars';

const origin = { x: 0, y: 1.3, z: 0 };
const forward = { x: 1, y: 0, z: 0 };

describe('headbutt impact motion math (pure, no renderer or physics)', () => {
  it('validates all coordinates, direction and power; zero power does not emit', () => {
    expect(makeHeadbuttBurst(origin, forward, 0)).toBeNull();
    expect(() => makeHeadbuttBurst({ ...origin, x: NaN }, forward, 1)).toThrow(RangeError);
    expect(() => makeHeadbuttBurst(origin, { ...forward, y: Infinity }, 1)).toThrow(RangeError);
    expect(() => makeHeadbuttBurst(origin, forward, -1)).toThrow(RangeError);
    expect(() => makeHeadbuttBurst(origin, forward, NaN)).toThrow(RangeError);
    expect(() => makeHeadbuttBurst(origin, forward, Infinity)).toThrow(RangeError);
  });

  it('copies inputs, normalizes the XZ heading and caps giant impacts', () => {
    const position = { ...origin };
    const direction = { x: -5, y: 7, z: 0 };
    const hit = makeHeadbuttBurst(position, direction, 1)!;
    position.x = 20;
    direction.x = 10;
    expect(hit.position).toEqual(origin);
    expect(hit.direction).toEqual({ x: -1, y: 0, z: 0 });
    expect(makeHeadbuttBurst(origin, { x: 0, y: 3, z: 0 }, 1)!.direction)
      .toEqual(forward);
    expect(makeHeadbuttBurst(origin, forward, 100)).toEqual(
      makeHeadbuttBurst(origin, forward, 4));
    expect(makeHeadbuttBurst(origin, forward, 0.25)!.size)
      .toBeLessThan(makeHeadbuttBurst(origin, forward, 2)!.size);
  });

  it('reads as small bright spark, larger eight-point flash, then three stars', () => {
    const hit = makeHeadbuttBurst(origin, forward, 1.5)!;
    const small = sampleHeadbuttFlash(hit, 0)!;
    const large = sampleHeadbuttFlash(hit, hit.lifetime * 0.3)!;
    const late = sampleHeadbuttFlash(hit, hit.lifetime * 0.8)!;
    expect(small.opacity).toBe(1);
    expect(large.scale).toBeGreaterThan(small.scale * 3);
    expect(late.opacity).toBeLessThan(large.opacity);
    expect(sampleHeadbuttStar(hit, 0, 0)).toBeNull();
    for (let i = 0; i < HEADBUTT_STAR_COUNT; i++) {
      const star = sampleHeadbuttStar(hit, i, hit.lifetime * 0.55)!;
      expect(star.opacity).toBeGreaterThan(0.8);
      expect(star.scale).toBeGreaterThan(0);
      expect(star.offset.y).toBeGreaterThan(0);
      expect(sampleHeadbuttStar(hit, i, hit.lifetime * 0.97)!.opacity).toBeLessThan(0.05);
    }
    expect(sampleHeadbuttFlash(hit, hit.lifetime)).toBeNull();
    expect(sampleHeadbuttFlash(hit, -1)).toBeNull();
    expect(sampleHeadbuttFlash(hit, NaN)).toBeNull();
    expect(sampleHeadbuttStar(hit, 0, hit.lifetime)).toBeNull();
    expect(() => sampleHeadbuttStar(hit, -1, 0.1)).toThrow(RangeError);
    expect(() => sampleHeadbuttStar(hit, HEADBUTT_STAR_COUNT, 0.1)).toThrow(RangeError);
  });

  it('emits stars in the requested direction, deterministic at absolute age', () => {
    const right = makeHeadbuttBurst(origin, forward, 2)!;
    const left = makeHeadbuttBurst(origin, { x: -1, y: 0, z: 0 }, 2)!;
    const age = right.lifetime * 0.64;
    const a = sampleHeadbuttStar(right, 1, age)!;
    const b = sampleHeadbuttStar(left, 1, age)!;
    expect(a).toEqual(sampleHeadbuttStar(right, 1, age));
    expect(a.offset.x).toBeGreaterThan(0);
    expect(b.offset.x).toBeCloseTo(-a.offset.x, 8);
    expect(a.offset.y).toBeCloseTo(b.offset.y, 8);
    const after = sampleHeadbuttStar(right, 1, right.lifetime * 0.81)!;
    expect(after.offset.y).toBeGreaterThan(a.offset.y);
    expect(after.opacity).toBeLessThan(a.opacity);
  });
});

describe('headbutt impact stars Three.js lifecycle', () => {
  it('reuses bounded sprites, supports clear/dispose and rejects invalid delta', () => {
    const scene = new THREE.Scene();
    const stars = createHeadbuttImpactStars({ capacity: 2 });
    scene.add(stars.group);
    try {
      expect(stars.group.children).toHaveLength(2);
      stars.emit(new THREE.Vector3(2, 1, 3), new THREE.Vector3(-1, 0, 0), 0);
      expect(stars.activeCount).toBe(0);
      stars.emit(new THREE.Vector3(2, 1, 3), new THREE.Vector3(-1, 0, 0), 1);
      expect(stars.activeCount).toBe(1);
      stars.update(0.32);
      const root = stars.group.children[0] as THREE.Group;
      expect(root.visible).toBe(true);
      expect(root.children.filter(c => c.visible).length).toBeGreaterThan(0);
      for (let i = 0; i < 16; i++) {
        stars.emit({ x: i, y: 1, z: 0 }, forward, 2);
        stars.update(0.01);
      }
      expect(stars.activeCount).toBe(2);
      expect(stars.group.children).toHaveLength(2);
      stars.update(3);
      expect(stars.activeCount).toBe(0);
      stars.emit(origin, forward, 2);
      stars.clear();
      expect(stars.activeCount).toBe(0);
      expect(stars.group.children.every(child => !child.visible)).toBe(true);
      expect(() => stars.update(-0.1)).toThrow(RangeError);
      expect(() => stars.update(Infinity)).toThrow(RangeError);
    } finally {
      stars.dispose();
    }
    expect(scene.children).not.toContain(stars.group);
    expect(stars.group.children).toHaveLength(0);
    stars.dispose();
    expect(() => stars.emit(origin, forward, 1)).toThrow(/disposed/);
    expect(() => stars.update(0.1)).toThrow(/disposed/);
    expect(() => new HeadbuttImpactStars({ capacity: 0 })).toThrow(RangeError);
    expect(() => new HeadbuttImpactStars({ capacity: 65 })).toThrow(RangeError);
    expect(() => new HeadbuttImpactStars({ capacity: 2.5 })).toThrow(RangeError);
  });

  it('samples the same visible state regardless of frame divisions', () => {
    const a = new HeadbuttImpactStars({ capacity: 1 });
    const b = new HeadbuttImpactStars({ capacity: 1 });
    try {
      a.emit(origin, forward, 2);
      b.emit(origin, forward, 2);
      a.update(0.31);
      b.update(0.11);
      b.update(0.20);
      const ra = a.group.children[0] as THREE.Group;
      const rb = b.group.children[0] as THREE.Group;
      expect(ra.position.equals(rb.position)).toBe(true);
      expect(ra.visible).toBe(rb.visible);
      const fa = ra.children[0] as THREE.Sprite;
      const fb = rb.children[0] as THREE.Sprite;
      expect(fa.scale.x).toBeCloseTo(fb.scale.x, 8);
      expect(fa.material.opacity).toBeCloseTo(fb.material.opacity, 8);
      const sa = ra.children[1] as THREE.Sprite;
      const sb = rb.children[1] as THREE.Sprite;
      expect(sa.position.distanceTo(sb.position)).toBeCloseTo(0, 8);
      expect(sa.material.rotation).toBeCloseTo(sb.material.rotation, 8);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
