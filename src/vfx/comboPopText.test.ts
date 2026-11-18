import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  makeComboPopCue, makeComboPopFrame, sampleComboPop, selectComboPopTier,
} from './comboPopMath';
import { COMBO_POP_PALETTES } from './comboPopArt';
import { ComboPopText, createComboPopText } from './ComboPopText';

const origin = { x: 0, y: 1.6, z: 0 };

function billboard(root: THREE.Object3D, index: number): THREE.Sprite {
  const object = root.children[index];
  if (!(object instanceof THREE.Sprite)) throw new Error('missing combo billboard');
  return object as THREE.Sprite;
}

describe('08 combo pop tier choice and absolute-age timeline', () => {
  it('selects x2/x3/x4 art without losing the real displayed combo count', () => {
    expect(selectComboPopTier(0)).toBeNull();
    expect(selectComboPopTier(1)).toBeNull();
    expect(selectComboPopTier(2)).toBe(2);
    expect(selectComboPopTier(3)).toBe(3);
    expect(selectComboPopTier(4)).toBe(4);
    expect(selectComboPopTier(27)).toBe(4);
    expect(() => selectComboPopTier(-1)).toThrow(RangeError);
    expect(() => selectComboPopTier(1.2)).toThrow(RangeError);
    expect(() => selectComboPopTier(NaN)).toThrow(RangeError);
    expect(() => selectComboPopTier(Infinity)).toThrow(RangeError);
    expect(() => selectComboPopTier(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => makeComboPopCue({ x: NaN, y: 0, z: 0 }, 2)).toThrow(RangeError);
    expect(() => makeComboPopCue({ x: 0, y: -Infinity, z: 0 }, 0))
      .toThrow(RangeError);
    expect(makeComboPopCue(origin, 0)).toBeNull();
    const cue = makeComboPopCue(origin, 27)!;
    expect(cue.tier).toBe(4);
    expect(cue.count).toBe(27);
    expect(cue.position).toEqual(origin);
    expect(cue.position).not.toBe(origin);
    expect(makeComboPopCue(origin, 2)!.lifetime)
      .toBeLessThan(makeComboPopCue(origin, 3)!.lifetime);
    expect(makeComboPopCue(origin, 3)!.lifetime)
      .toBeLessThan(cue.lifetime);
  });

  it('matches blue/yellow, orange/gold and purple/extra-star escalation', () => {
    expect(COMBO_POP_PALETTES[2].word.middle).toBe('#42d5ff');
    expect(COMBO_POP_PALETTES[2].stars).toBe(0);
    expect(COMBO_POP_PALETTES[3].stars).toBe(5);
    expect(COMBO_POP_PALETTES[4].burstOuter).toBe('#d62aec');
    expect(COMBO_POP_PALETTES[4].stars).toBeGreaterThan(COMBO_POP_PALETTES[3].stars);
  });

  it('squashes, stretches past normal size, settles, then drifts and fades', () => {
    const cue = makeComboPopCue(origin, 4)!;
    const frame = makeComboPopFrame();
    const at = (t: number) => ({ ...sampleComboPop(cue, cue.lifetime * t, frame)! });
    const first = at(0.035);
    const bounce = at(0.10);
    const settled = at(0.40);
    const fading = at(0.93);
    expect(first.scaleX).toBeGreaterThan(first.scaleY);
    expect(bounce.scaleY).toBeGreaterThan(1.1);
    expect(bounce.scaleY).toBeGreaterThan(bounce.scaleX);
    expect(settled.scaleX).toBeCloseTo(1, 1);
    expect(settled.scaleY).toBeCloseTo(1, 1);
    expect(settled.opacity).toBeGreaterThan(0.99);
    expect(fading.lift).toBeGreaterThan(settled.lift);
    expect(fading.opacity).toBeLessThan(0.2);
    expect(sampleComboPop(cue, -0.001, frame)).toBeNull();
    expect(sampleComboPop(cue, NaN, frame)).toBeNull();
    expect(sampleComboPop(cue, cue.lifetime, frame)).toBeNull();
    for (let i = 0; i < 100; i++) {
      expect(sampleComboPop(cue, cue.lifetime * i / 100, frame)).toBe(frame);
    }
  });
});

describe('08 combo pop pooled Three.js sprites (headless)', () => {
  it('keeps a close gameplay popup above the center and inside its screen size budget', () => {
    const fx = createComboPopText({ capacity: 1 });
    try {
      const camera = new THREE.PerspectiveCamera(52, 1024 / 576, .08, 100);
      camera.updateMatrixWorld(true);
      fx.emit({ x: 0, y: -2, z: -.55 }, 4);
      for (const aspect of [1024 / 576, 390 / 844]) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        fx.update(.14, camera);
        const sprite = billboard(fx.group, 0);
        const center = sprite.position.clone().project(camera);
        const width = sprite.scale.x * camera.projectionMatrix.elements[0]! / 1.1;
        const height = sprite.scale.y * camera.projectionMatrix.elements[5]! / 1.1;
        expect(sprite.visible).toBe(true);
        expect(width).toBeLessThanOrEqual(.20001);
        expect(height).toBeLessThanOrEqual(.12001);
        expect(center.y).toBeGreaterThanOrEqual(.21999);
      }
      camera.position.z = -1;
      camera.updateMatrixWorld(true);
      fx.update(.04, camera);
      expect(billboard(fx.group, 0).visible).toBe(false);
    } finally {
      fx.dispose();
    }
  });

  it('reuses sprites, materials and per-count textures across overlapping triggers', () => {
    const fx = createComboPopText({ capacity: 2 });
    const scene = new THREE.Scene();
    scene.add(fx.group);
    try {
      expect(fx.group.children).toHaveLength(2);
      fx.emit(origin, 1);
      expect(fx.activeCount).toBe(0);
      fx.emit(new THREE.Vector3(3, 1, -2), 2);
      const a = billboard(fx.group, 0);
      const b = billboard(fx.group, 1);
      const material = a.material;
      const blueTexture = a.material.map;
      expect(a.position.toArray()).toEqual([3, 1, -2]);
      fx.update(0.22);
      expect(a.visible).toBe(true);
      expect(a.material.opacity).toBeGreaterThan(0.9);
      expect(a.position.y).toBeGreaterThan(1);
      fx.emit(origin, 3);
      expect(b.material.map).not.toBe(blueTexture);
      fx.emit(origin, 2); // oldest slot replaced, its original texture reused
      expect(a.material).toBe(material);
      expect(a.material.map).toBe(blueTexture);
      expect(fx.activeCount).toBe(2);
      fx.update(10);
      expect(fx.activeCount).toBe(0);
      expect(fx.group.children.every(child => !child.visible)).toBe(true);
      fx.emit(origin, 5); // count is still shown as x5! on purple tier
      const fiveTexture = b.material.map;
      fx.update(10);
      fx.emit(origin, 5);
      expect(b.material.map).toBe(fiveTexture);
      fx.clear();
      expect(fx.activeCount).toBe(0);
      expect(a.visible).toBe(false);
      expect(b.visible).toBe(false);
    } finally {
      fx.dispose();
    }
    expect(scene.children).not.toContain(fx.group);
    expect(fx.group.children).toHaveLength(0);
    fx.dispose();
    expect(() => fx.emit(origin, 2)).toThrow(/disposed/);
    expect(() => fx.update(0)).toThrow(/disposed/);
  });

  it('recycles the oldest active slot, preferring free slots first', () => {
    const fx = new ComboPopText({ capacity: 3 });
    try {
      fx.emit({ x: 1, y: 0, z: 0 }, 2);
      fx.update(0.4);
      fx.emit({ x: 2, y: 0, z: 0 }, 3);
      fx.emit({ x: 3, y: 0, z: 0 }, 4);
      expect(fx.activeCount).toBe(3);
      fx.emit({ x: 9, y: 0, z: 0 }, 4);
      expect(billboard(fx.group, 0).position.x).toBe(9);
      expect(billboard(fx.group, 1).position.x).toBe(2);
      expect(billboard(fx.group, 2).position.x).toBe(3);
    } finally {
      fx.dispose();
    }
    for (const bad of [0, -1, 1.5, 65, Infinity]) {
      expect(() => new ComboPopText({ capacity: bad })).toThrow(RangeError);
    }
    const fx2 = new ComboPopText({ capacity: 1 });
    expect(() => fx2.update(-0.1)).toThrow(RangeError);
    expect(() => fx2.update(Infinity)).toThrow(RangeError);
    fx2.dispose();
  });

  it('produces the same pose after one large time step or many small ones', () => {
    const a = new ComboPopText({ capacity: 1 });
    const b = new ComboPopText({ capacity: 1 });
    try {
      a.emit(origin, 4);
      b.emit(origin, 4);
      a.update(0.65);
      for (let i = 0; i < 65; i++) b.update(0.01);
      const sa = billboard(a.group, 0);
      const sb = billboard(b.group, 0);
      expect(sa.visible).toBe(sb.visible);
      expect(sa.scale.x).toBeCloseTo(sb.scale.x, 10);
      expect(sa.scale.y).toBeCloseTo(sb.scale.y, 10);
      expect(sa.position.y).toBeCloseTo(sb.position.y, 10);
      expect(sa.material.opacity).toBeCloseTo(sb.material.opacity, 10);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
