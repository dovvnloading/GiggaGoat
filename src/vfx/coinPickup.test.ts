import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  COIN_PICKUP_SECONDS, COIN_SPARKLE_COUNT, makeCoinPickupCue,
  makeCoinPickupFrame, sampleCoinPickup,
} from './coinPickupMath';
import { CoinPickupSparkle, createCoinPickupSparkle } from './CoinPickupSparkle';

const source = { x: -2, y: 1.4, z: 0.25 };
const goatChest = { x: 1.1, y: 1.85, z: 0.25 };

describe('effect 10: pure COIN PICKUP SPARKLE timeline', () => {
  it('validates input, snapshots the world position, and rejects invalid sample times', () => {
    expect(() => makeCoinPickupCue({ x: Infinity, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => makeCoinPickupCue({ x: 0, y: NaN, z: 0 })).toThrow(RangeError);
    expect(() => makeCoinPickupCue({ x: 0, y: 0, z: -Infinity })).toThrow(RangeError);
    const position = { ...source };
    const cue = makeCoinPickupCue(position);
    position.x = 99;
    expect(cue.position.x).toBe(source.x);
    expect(cue.lifetime).toBe(COIN_PICKUP_SECONDS);
    const frame = makeCoinPickupFrame();
    expect(sampleCoinPickup(cue, -0.01, frame)).toBeNull();
    expect(sampleCoinPickup(cue, NaN, frame)).toBeNull();
    expect(sampleCoinPickup(cue, cue.lifetime, frame)).toBeNull();
    expect(() => sampleCoinPickup(cue, 0.5, frame,
      { x: 0, y: Infinity, z: 0 })).toThrow(RangeError);
  });

  it('progresses pop → gold ring and flight → white-gold stars → complete fade', () => {
    const cue = makeCoinPickupCue(source);
    const frame = makeCoinPickupFrame();
    sampleCoinPickup(cue, 0, frame, goatChest);
    expect(frame.coinScale).toBeGreaterThan(0.6);
    expect(frame.ringOpacity).toBe(0);
    expect(frame.sparkleOpacity).toBe(0);

    sampleCoinPickup(cue, 0.36, frame, goatChest);
    expect(frame.coinScale).toBeGreaterThan(0.95);
    expect(frame.coinX).toBeGreaterThan(source.x);
    expect(frame.coinX).toBeLessThan(goatChest.x);
    expect(frame.coinY).toBeGreaterThan(source.y);
    expect(frame.ringOpacity).toBeGreaterThan(0.8);
    expect(frame.sparkleOpacity).toBe(0);

    sampleCoinPickup(cue, 0.91, frame, goatChest);
    expect(frame.coinScale).toBe(0);
    expect(frame.ringOpacity).toBe(0);
    expect(frame.sparkleOpacity).toBeGreaterThan(0.9);
    expect(frame.scatter).toBeGreaterThan(0.6);
    expect(frame.starX).toBe(goatChest.x);
    expect(frame.starY).toBe(goatChest.y);

    sampleCoinPickup(cue, 1.24, frame, goatChest);
    expect(frame.sparkleOpacity).toBeLessThan(0.5);
    expect(sampleCoinPickup(cue, COIN_PICKUP_SECONDS, frame, goatChest)).toBeNull();
  });

  it('samples exact same pose at equal absolute ages, with or without a goat', () => {
    const cue = makeCoinPickupCue(source);
    const first = makeCoinPickupFrame();
    const second = makeCoinPickupFrame();
    sampleCoinPickup(cue, 0.53, first, goatChest);
    sampleCoinPickup(cue, 0.53, second, goatChest);
    expect(second).toEqual(first);
    sampleCoinPickup(cue, 0.53, second);
    expect(second.coinX).not.toBe(first.coinX);
    expect(Number.isFinite(second.coinY)).toBe(true);
    expect(second.coinX).toBeGreaterThan(source.x);
  });
});

function coinRoot(effect: CoinPickupSparkle, index: number): THREE.Group {
  return effect.group.children[index] as THREE.Group;
}

function coinMesh(effect: CoinPickupSparkle, index: number): THREE.Mesh {
  return coinRoot(effect, index).getObjectByName(
    'thick gold and copper coin edge',
  ) as THREE.Mesh;
}

describe('effect 10: pooled headless Three.js lifecycle', () => {
  it('builds shared coin/swoosh geometry and a procedural gold star map once', () => {
    const fx = createCoinPickupSparkle({ capacity: 3 });
    const a = coinMesh(fx, 0);
    const b = coinMesh(fx, 1);
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    const first = coinRoot(fx, 0);
    const second = coinRoot(fx, 1);
    const starsA = first.children.filter(x => x instanceof THREE.Sprite);
    const starsB = second.children.filter(x => x instanceof THREE.Sprite);
    expect(starsA).toHaveLength(COIN_SPARKLE_COUNT);
    expect(starsB).toHaveLength(COIN_SPARKLE_COUNT);
    const map = (starsA[0] as THREE.Sprite).material.map as THREE.DataTexture;
    expect((starsB[0] as THREE.Sprite).material.map).toBe(map);
    expect(map.image.width).toBe(96);
    expect(map.image.height).toBe(96);
    const center = ((48 * 96) + 48) * 4;
    const data = map.image.data as Uint8Array;
    expect(data[center]).toBe(255);
    expect(data[center + 1]).toBeGreaterThan(245);
    expect(data[center + 2]).toBeGreaterThan(230);
    fx.dispose();
  });

  it('moves toward a live goat target without changing the goat', () => {
    const scene = new THREE.Scene();
    const goat = new THREE.Group();
    const chest = new THREE.Object3D();
    chest.position.y = 1.3;
    goat.position.x = 1.5;
    goat.add(chest);
    scene.add(goat);
    const fx = new CoinPickupSparkle({ capacity: 1 });
    scene.add(fx.group);
    fx.emit(source, chest);
    fx.update(0.45);
    const coin = coinRoot(fx, 0).getObjectByName(
      'spinning beveled gold Cud Coin',
    ) as THREE.Group;
    const x = coin.position.x;
    goat.position.x = 2.5;
    fx.update(0.05);
    expect(coin.position.x).toBeGreaterThan(x);
    expect(goat.position.x).toBe(2.5);
    expect(chest.parent).toBe(goat);
    fx.update(0.45);
    const star = coinRoot(fx, 0).children.find(
      node => node instanceof THREE.Sprite && node.visible,
    ) as THREE.Sprite;
    expect(star).toBeDefined();
    expect(star.position.x).toBeGreaterThan(0);
    fx.dispose();
    expect(chest.parent).toBe(goat);
    expect(fx.group.parent).toBeNull();
  });

  it('matches split and single time steps with no frame-object replacement', () => {
    const one = new CoinPickupSparkle({ capacity: 1 });
    const many = new CoinPickupSparkle({ capacity: 1 });
    one.emit(source);
    many.emit(source);
    const original = coinMesh(one, 0).geometry;
    one.update(0.92);
    for (let i = 0; i < 92; i++) many.update(0.01);
    const left = coinRoot(one, 0);
    const right = coinRoot(many, 0);
    const coinLeft = left.getObjectByName('spinning beveled gold Cud Coin') as THREE.Group;
    const coinRight = right.getObjectByName('spinning beveled gold Cud Coin') as THREE.Group;
    expect(coinLeft.position.x).toBeCloseTo(coinRight.position.x, 10);
    expect(coinLeft.rotation.y).toBeCloseTo(coinRight.rotation.y, 10);
    expect(coinLeft.scale.x).toBeCloseTo(coinRight.scale.x, 10);
    const leftStars = left.children.filter(node => node instanceof THREE.Sprite) as THREE.Sprite[];
    const rightStars = right.children.filter(node => node instanceof THREE.Sprite) as THREE.Sprite[];
    for (let i = 0; i < leftStars.length; i++) {
      expect(leftStars[i]!.visible).toBe(rightStars[i]!.visible);
      expect(leftStars[i]!.position.x).toBeCloseTo(rightStars[i]!.position.x, 10);
      expect(leftStars[i]!.scale.x).toBeCloseTo(rightStars[i]!.scale.x, 10);
    }
    expect(coinMesh(one, 0).geometry).toBe(original);
    one.update(COIN_PICKUP_SECONDS);
    many.update(COIN_PICKUP_SECONDS);
    expect(one.activeCount).toBe(0);
    expect(many.activeCount).toBe(0);
    one.dispose();
    many.dispose();
  });

  it('recycles the oldest slot at capacity, clears without reallocating, and reuses', () => {
    const fx = new CoinPickupSparkle({ capacity: 2 });
    const firstMesh = coinMesh(fx, 0);
    const secondMesh = coinMesh(fx, 1);
    fx.emit({ x: 0, y: 0, z: 0 });
    fx.update(0.40);
    fx.emit({ x: 1, y: 0, z: 0 });
    fx.update(0.10);
    expect(fx.activeCount).toBe(2);
    fx.emit({ x: 2, y: 0, z: 0 });
    expect(fx.activeCount).toBe(2);
    expect(coinRoot(fx, 0).position.x).toBe(2); // older burst replaced
    expect(coinRoot(fx, 1).position.x).toBe(1); // newer burst survives
    fx.clear();
    expect(fx.activeCount).toBe(0);
    expect(coinRoot(fx, 0).visible).toBe(false);
    fx.emit({ x: 3, y: 1, z: -2 });
    expect(coinMesh(fx, 0)).toBe(firstMesh);
    expect(coinMesh(fx, 1)).toBe(secondMesh);
    expect(fx.activeCount).toBe(1);
    fx.update(2);
    expect(fx.activeCount).toBe(0);
    fx.dispose();
    fx.dispose();
    expect(fx.group.children).toHaveLength(0);
  });

  it('checks bounds, targets, delta time and disposal correctly', () => {
    expect(() => new CoinPickupSparkle({ capacity: 0 })).toThrow(RangeError);
    expect(() => new CoinPickupSparkle({ capacity: 25 })).toThrow(RangeError);
    expect(() => new CoinPickupSparkle({ capacity: 1.5 })).toThrow(RangeError);
    const fx = new CoinPickupSparkle({ capacity: 1 });
    expect(() => fx.emit({ x: NaN, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => fx.emit(source, {} as THREE.Object3D)).toThrow(TypeError);
    expect(fx.activeCount).toBe(0);
    expect(() => fx.update(-0.01)).toThrow(RangeError);
    expect(() => fx.update(Infinity)).toThrow(RangeError);
    expect(fx.activeCount).toBe(0);
    fx.dispose();
    expect(() => fx.emit(source)).toThrow(/disposed/);
    expect(() => fx.update(0)).toThrow(/disposed/);
    fx.clear(); // safe after dispose
  });
});
