import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  TRAMPOLINE_MAT_Y, makeTrampolineBoingBurst, makeTrampolineBoingFrame,
  sampleTrampolineBoing,
} from './trampolineBoingMath';
import { TrampolineBoing, createTrampolineBoing } from './TrampolineBoing';

const origin = { x: 0, y: 0, z: 0 };
const matOf = (root: THREE.Object3D): THREE.Mesh => {
  const found = root.getObjectByName('deforming red cream bullseye trampoline mat');
  if (!(found instanceof THREE.Mesh)) throw new Error('missing trampoline mat');
  return found;
};
const partOf = (root: THREE.Object3D, name: string): THREE.Mesh => {
  const found = root.getObjectByName(name);
  if (!(found instanceof THREE.Mesh)) throw new Error('missing ' + name);
  return found;
};

describe('trampoline boing timeline: pure absolute-age sampling', () => {
  it('checks finite inputs and uses zero as a no-op', () => {
    expect(makeTrampolineBoingBurst(origin, 0, 1)).toBeNull();
    expect(makeTrampolineBoingBurst(origin, 1, 0)).toBeNull();
    expect(() => makeTrampolineBoingBurst({ x: NaN, y: 0, z: 0 }, 1, 1)).toThrow(RangeError);
    expect(() => makeTrampolineBoingBurst({ x: 0, y: Infinity, z: 0 }, 1, 1))
      .toThrow(RangeError);
    expect(() => makeTrampolineBoingBurst(origin, -1, 1)).toThrow(RangeError);
    expect(() => makeTrampolineBoingBurst(origin, 1, -1)).toThrow(RangeError);
    expect(() => makeTrampolineBoingBurst(origin, Infinity, 1)).toThrow(RangeError);
    expect(() => makeTrampolineBoingBurst(origin, 1, NaN)).toThrow(RangeError);
  });

  it('goes from flat mat to down-arrow squash, gold rebound, purple flight, and rest', () => {
    const burst = makeTrampolineBoingBurst(origin, 1, 1.5)!;
    const out = makeTrampolineBoingFrame();
    const at = (progress: number) =>
      // Spread copies are test-only; production uses one reusable frame.
      ({ ...sampleTrampolineBoing(burst, progress * burst.lifetime, out)! });
    const rest = at(0);
    const down = at(0.23);
    const bounce = at(0.46);
    const flight = at(0.67);
    const fade = at(0.94);
    expect(rest.matDip).toBe(0);
    expect(rest.goatLift).toBe(0);
    expect(rest.burstOpacity).toBe(0);
    expect(down.matDip).toBeGreaterThan(0.25);
    expect(down.arrowOpacity).toBeGreaterThan(0.9);
    expect(down.goatLift).toBeLessThan(0);
    expect(down.burstOpacity).toBe(0);
    expect(bounce.matDip).toBeLessThan(0);
    expect(bounce.arrowOpacity).toBe(0);
    expect(bounce.burstOpacity).toBeGreaterThan(0.95);
    expect(bounce.burstHeight).toBeGreaterThan(rest.burstHeight);
    expect(flight.goatLift).toBeGreaterThan(1.4);
    expect(flight.arcOpacity).toBeGreaterThan(0.9);
    expect(flight.arcHeight).toBeGreaterThan(bounce.arcHeight);
    expect(fade.burstOpacity).toBe(0);
    expect(fade.arcOpacity).toBeLessThan(flight.arcOpacity);
    expect(Math.abs(fade.matDip)).toBeLessThan(1e-8);
    expect(sampleTrampolineBoing(burst, -0.1, out)).toBeNull();
    expect(sampleTrampolineBoing(burst, burst.lifetime, out)).toBeNull();
    expect(sampleTrampolineBoing(burst, NaN, out)).toBeNull();
  });

  it('scales launch with strength, caps extremes, and never mutates the input', () => {
    const at = { x: 3, y: 0.2, z: -2 };
    const low = makeTrampolineBoingBurst(at, 0.5, 0.5)!;
    const strong = makeTrampolineBoingBurst(at, 2, 4)!;
    const capped = makeTrampolineBoingBurst(at, 100, 100)!;
    expect(capped).toEqual(makeTrampolineBoingBurst(at, 4, 4));
    expect(strong.scale).toBe(2);
    expect(strong.lifetime).toBeGreaterThan(low.lifetime);
    expect(strong.position).toEqual(at);
    expect(strong.position).not.toBe(at);
    const out = makeTrampolineBoingFrame();
    const lowFrame = { ...sampleTrampolineBoing(low, 0.66 * low.lifetime, out)! };
    const strongFrame = { ...sampleTrampolineBoing(strong, 0.66 * strong.lifetime, out)! };
    expect(strongFrame.goatLift).toBeGreaterThan(lowFrame.goatLift);
  });

  it('reuses the same output at every sample (no frame object allocation)', () => {
    const burst = makeTrampolineBoingBurst(origin, 1, 2)!;
    const out = makeTrampolineBoingFrame();
    for (let i = 0; i < 90; i++) {
      expect(sampleTrampolineBoing(burst, burst.lifetime * i / 90, out)).toBe(out);
    }
  });
});

describe('trampoline boing Three.js bounded pool (no renderer)', () => {
  it('deforms only the mat while keeping rim, legs and shared geometry stable', () => {
    const effect = createTrampolineBoing({ capacity: 2 });
    const scene = new THREE.Scene();
    scene.add(effect.group);
    try {
      expect(effect.group.children).toHaveLength(2);
      effect.emit(origin, 1, 0);
      effect.emit(origin, 0, 1);
      expect(effect.activeCount).toBe(0);
      effect.emit(new THREE.Vector3(1, 0.25, -2), 1.3, 1);
      expect(effect.activeCount).toBe(1);
      const root = effect.group.children[0]!;
      expect(root.position.toArray()).toEqual([1, 0.25, -2]);
      expect(root.scale.x).toBeCloseTo(1.3);
      const mat = matOf(root);
      const geometry = mat.geometry;
      const buffer = geometry.getAttribute('position');
      const rim = root.children.find(item => item instanceof THREE.Mesh &&
        item.geometry.type === 'TorusGeometry')!;
      const rimY = rim.position.y;
      expect(buffer.getY(0)).toBeCloseTo(TRAMPOLINE_MAT_Y);
      effect.update(0.23 * makeTrampolineBoingBurst(origin, 1, 1)!.lifetime);
      expect(buffer.getY(0)).toBeLessThan(TRAMPOLINE_MAT_Y - 0.2);
      expect(rim.position.y).toBe(rimY);
      expect(mat.geometry).toBe(geometry);
      expect(mat.geometry.getAttribute('position')).toBe(buffer);
      const rays = partOf(root, 'gold rim rebound speed-line fan');
      effect.update(0.23 * makeTrampolineBoingBurst(origin, 1, 1)!.lifetime);
      expect(rays.visible).toBe(true);
      const arcs = partOf(root, 'purple motion arcs trailing launched goat');
      effect.update(0.21 * makeTrampolineBoingBurst(origin, 1, 1)!.lifetime);
      expect(arcs.visible).toBe(true);
      effect.update(10);
      expect(effect.activeCount).toBe(0);
      expect(root.visible).toBe(false);
    } finally {
      effect.dispose();
    }
    expect(scene.children).not.toContain(effect.group);
    expect(effect.group.children).toHaveLength(0);
    effect.dispose();
    expect(() => effect.emit(origin, 1, 1)).toThrow(/disposed/);
    expect(() => effect.update(0)).toThrow(/disposed/);
  });

  it('prefers a free slot and recycles the oldest when capacity is full', () => {
    const effect = new TrampolineBoing({ capacity: 2 });
    try {
      effect.emit({ x: 10, y: 0, z: 0 }, 1, 1);
      effect.update(0.2);
      effect.emit({ x: 20, y: 0, z: 0 }, 1, 1);
      effect.emit({ x: 30, y: 0, z: 0 }, 1, 1);
      expect(effect.group.children[0]!.position.x).toBe(30);
      expect(effect.group.children[1]!.position.x).toBe(20);
      expect(effect.activeCount).toBe(2);
      effect.update(5);
      effect.emit({ x: 40, y: 0, z: 0 }, 1, 1);
      expect(effect.activeCount).toBe(1);
      effect.clear();
      expect(effect.activeCount).toBe(0);
      expect(effect.group.children.every(item => !item.visible)).toBe(true);
    } finally {
      effect.dispose();
    }
    expect(() => new TrampolineBoing({ capacity: 0 })).toThrow(RangeError);
    expect(() => new TrampolineBoing({ capacity: 33 })).toThrow(RangeError);
    expect(() => new TrampolineBoing({ capacity: 1.5 })).toThrow(RangeError);
    const effect2 = new TrampolineBoing();
    expect(() => effect2.update(-0.01)).toThrow(RangeError);
    expect(() => effect2.update(Infinity)).toThrow(RangeError);
    effect2.dispose();
  });

  it('lands on exactly the same positions and opacities at different frame rates', () => {
    const a = new TrampolineBoing({ capacity: 1 });
    const b = new TrampolineBoing({ capacity: 1 });
    try {
      a.emit(origin, 1.2, 2);
      b.emit(origin, 1.2, 2);
      a.update(0.69);
      for (let i = 0; i < 23; i++) b.update(0.03);
      const ra = a.group.children[0]!;
      const rb = b.group.children[0]!;
      expect(ra.visible).toBe(rb.visible);
      expect(matOf(ra).geometry.getAttribute('position').getY(0)).toBeCloseTo(
        matOf(rb).geometry.getAttribute('position').getY(0), 9);
      const raysA = partOf(ra, 'gold rim rebound speed-line fan');
      const raysB = partOf(rb, 'gold rim rebound speed-line fan');
      expect((raysA.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(
        (raysB.material as THREE.MeshBasicMaterial).opacity, 9);
      expect(partOf(ra, 'purple motion arcs trailing launched goat').scale.y).toBeCloseTo(
        partOf(rb, 'purple motion arcs trailing launched goat').scale.y, 9);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
