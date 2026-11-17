import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  LAUNCH_PAD_TOP_Y, launchFlightX, launchFlightY,
  makeLaunchPadBurstCue, makeLaunchPadBurstFrame, sampleLaunchPadBurst,
} from './launchPadMath';
import { LaunchPadBurst, createLaunchPadBurst } from './LaunchPadBurst';

const origin = { x: 0, y: 0, z: 0 };
const forward = { x: 1, y: 0, z: 0 };

function mesh(root: THREE.Object3D, name: string): THREE.Mesh {
  const found = root.getObjectByName(name);
  if (!(found instanceof THREE.Mesh)) throw new Error('missing ' + name);
  return found;
}

describe('launch pad 07 absolute-time stages', () => {
  it('validates coordinates and strength, ignores zero, caps power, normalizes horizontal direction', () => {
    expect(makeLaunchPadBurstCue(origin, forward, 0)).toBeNull();
    expect(() => makeLaunchPadBurstCue({ x: NaN, y: 0, z: 0 }, forward, 1))
      .toThrow(RangeError);
    expect(() => makeLaunchPadBurstCue(origin, { x: 0, y: Infinity, z: 0 }, 1))
      .toThrow(RangeError);
    expect(() => makeLaunchPadBurstCue(origin, forward, -1)).toThrow(RangeError);
    expect(() => makeLaunchPadBurstCue(origin, forward, NaN)).toThrow(RangeError);
    expect(() => makeLaunchPadBurstCue(origin, forward, Infinity)).toThrow(RangeError);
    const at = { x: 3, y: 0.5, z: -1 };
    const heading = { x: 3, y: 9, z: 4 };
    const cue = makeLaunchPadBurstCue(at, heading, 7)!;
    expect(cue.position).toEqual(at);
    expect(cue.position).not.toBe(at);
    expect(cue.direction).toEqual({ x: 0.6, y: 0, z: 0.8 });
    expect(cue.strength).toBe(4);
    expect(cue.lifetime).toBeCloseTo(makeLaunchPadBurstCue(at, heading, 4)!.lifetime);
    expect(makeLaunchPadBurstCue(origin, { x: 0, y: 7, z: 0 }, 1)!.direction)
      .toEqual(forward);
  });

  it('lights arrows, fountains bright upward spikes, then leaves long gold flight streaks', () => {
    const cue = makeLaunchPadBurstCue(origin, forward, 1.5)!;
    const out = makeLaunchPadBurstFrame();
    const at = (t: number) => ({ ...sampleLaunchPadBurst(cue, cue.lifetime * t, out)! });
    const rest = at(0);
    const charge = at(0.15);
    const eruption = at(0.30);
    const flight = at(0.61);
    const fade = at(0.95);
    expect(rest.arrowGlow).toBeGreaterThan(0);
    expect(rest.fountainOpacity).toBe(0);
    expect(rest.trailOpacity).toBe(0);
    expect(rest.goatY).toBeCloseTo(LAUNCH_PAD_TOP_Y + 0.17);
    expect(charge.arrowGlow).toBeGreaterThan(0.95);
    expect(charge.fountainOpacity).toBeGreaterThan(0);
    expect(eruption.fountainOpacity).toBeGreaterThan(0.95);
    expect(eruption.fountainHeight).toBeGreaterThan(charge.fountainHeight);
    expect(flight.fountainOpacity).toBeLessThan(0.05);
    expect(flight.trailOpacity).toBeGreaterThan(0.95);
    expect(flight.goatX).toBeGreaterThan(2);
    expect(flight.goatY).toBeGreaterThan(1.8);
    expect(fade.trailOpacity).toBeLessThan(flight.trailOpacity);
    expect(sampleLaunchPadBurst(cue, -0.01, out)).toBeNull();
    expect(sampleLaunchPadBurst(cue, cue.lifetime, out)).toBeNull();
    expect(sampleLaunchPadBurst(cue, NaN, out)).toBeNull();
  });

  it('scales the flight with strength and reuses its mutable frame object', () => {
    const weak = makeLaunchPadBurstCue(origin, forward, 0.5)!;
    const strong = makeLaunchPadBurstCue(origin, forward, 4)!;
    expect(launchFlightX(4, 0.6)).toBeGreaterThan(launchFlightX(0.5, 0.6));
    expect(launchFlightY(4, 0.6)).toBeGreaterThan(launchFlightY(0.5, 0.6));
    const out = makeLaunchPadBurstFrame();
    const low = { ...sampleLaunchPadBurst(weak, 0.6 * weak.lifetime, out)! };
    const high = { ...sampleLaunchPadBurst(strong, 0.6 * strong.lifetime, out)! };
    expect(high.goatX).toBeGreaterThan(low.goatX);
    expect(high.goatY).toBeGreaterThan(low.goatY);
    for (let i = 0; i < 90; i++) {
      expect(sampleLaunchPadBurst(strong, strong.lifetime * i / 90, out)).toBe(out);
    }
  });
});

describe('launch pad 07 bounded Three.js pool (headless)', () => {
  it('keeps steel pad and shared geometry, mutates only preallocated ribbon buffer', () => {
    const fx = createLaunchPadBurst({ capacity: 2 });
    const scene = new THREE.Scene();
    scene.add(fx.group);
    try {
      expect(fx.group.children).toHaveLength(2);
      fx.emit(origin, forward, 0);
      expect(fx.activeCount).toBe(0);
      fx.emit(new THREE.Vector3(2, 0.4, -1), { x: 0, y: 1, z: 10 }, 2);
      expect(fx.activeCount).toBe(1);
      const root = fx.group.children[0]!;
      expect(root.position.toArray()).toEqual([2, 0.4, -1]);
      expect(root.rotation.y).toBeCloseTo(-Math.PI / 2);
      const steel = mesh(root, 'steel launch pad shell');
      const face = mesh(root, 'illuminated gold arrow face');
      const spikes = mesh(root, 'gold spiky launch fountain');
      const trail = mesh(root, 'long golden flight ribbon trails');
      const buffer = trail.geometry.getAttribute('position');
      const steelGeometry = steel.geometry;
      const fountainGeometry = spikes.geometry;
      const lifetime = makeLaunchPadBurstCue(origin, forward, 2)!.lifetime;
      fx.update(lifetime * 0.30);
      expect(spikes.visible).toBe(true);
      expect((face.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.95);
      fx.update(lifetime * 0.32);
      expect(trail.visible).toBe(true);
      expect(buffer.getX(80)).toBeGreaterThan(0);
      expect(trail.geometry.getAttribute('position')).toBe(buffer);
      expect(steel.geometry).toBe(steelGeometry);
      expect(spikes.geometry).toBe(fountainGeometry);
      fx.emit({ x: -2, y: 0, z: 2 }, forward, 1);
      expect(mesh(fx.group.children[1]!, 'steel launch pad shell').geometry)
        .toBe(steelGeometry);
      expect(mesh(fx.group.children[1]!, 'gold spiky launch fountain').geometry)
        .toBe(fountainGeometry);
      fx.update(10);
      expect(fx.activeCount).toBe(0);
      expect(fx.group.children.every(child => !child.visible)).toBe(true);
    } finally {
      fx.dispose();
    }
    expect(scene.children).not.toContain(fx.group);
    expect(fx.group.children).toHaveLength(0);
    fx.dispose();
    expect(() => fx.emit(origin, forward, 1)).toThrow(/disposed/);
    expect(() => fx.update(0)).toThrow(/disposed/);
  });

  it('uses free slots first and recycles the oldest live launch', () => {
    const fx = new LaunchPadBurst({ capacity: 2 });
    try {
      fx.emit({ x: 1, y: 0, z: 0 }, forward, 1);
      fx.update(0.26);
      fx.emit({ x: 2, y: 0, z: 0 }, forward, 1);
      fx.emit({ x: 3, y: 0, z: 0 }, forward, 1);
      expect(fx.group.children[0]!.position.x).toBe(3);
      expect(fx.group.children[1]!.position.x).toBe(2);
      expect(fx.activeCount).toBe(2);
      fx.clear();
      expect(fx.activeCount).toBe(0);
      expect(fx.group.children.every(child => !child.visible)).toBe(true);
      fx.emit(origin, forward, 1);
      expect(fx.activeCount).toBe(1);
    } finally {
      fx.dispose();
    }
    expect(() => new LaunchPadBurst({ capacity: 0 })).toThrow(RangeError);
    expect(() => new LaunchPadBurst({ capacity: 33 })).toThrow(RangeError);
    expect(() => new LaunchPadBurst({ capacity: 1.5 })).toThrow(RangeError);
    const fx2 = new LaunchPadBurst({ capacity: 1 });
    expect(() => fx2.update(-0.1)).toThrow(RangeError);
    expect(() => fx2.update(Infinity)).toThrow(RangeError);
    fx2.dispose();
  });

  it('produces identical geometry and opacities with different frame partitions', () => {
    const a = new LaunchPadBurst({ capacity: 1 });
    const b = new LaunchPadBurst({ capacity: 1 });
    try {
      a.emit(origin, forward, 2);
      b.emit(origin, forward, 2);
      a.update(0.69);
      for (let i = 0; i < 23; i++) b.update(0.03);
      const ra = a.group.children[0]!;
      const rb = b.group.children[0]!;
      expect(ra.visible).toBe(rb.visible);
      const ribbonA = mesh(ra, 'long golden flight ribbon trails');
      const ribbonB = mesh(rb, 'long golden flight ribbon trails');
      const positionsA = ribbonA.geometry.getAttribute('position');
      const positionsB = ribbonB.geometry.getAttribute('position');
      expect(ribbonA.visible).toBe(true);
      expect(positionsA.count).toBe(positionsB.count);
      for (const index of [0, 25, 80, 120, 170, 199]) {
        expect(positionsA.getX(index)).toBeCloseTo(positionsB.getX(index), 5);
        expect(positionsA.getY(index)).toBeCloseTo(positionsB.getY(index), 5);
      }
      expect((ribbonA.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(
        (ribbonB.material as THREE.MeshBasicMaterial).opacity, 9);
      expect((mesh(ra, 'illuminated gold arrow face').material as THREE.MeshBasicMaterial)
        .opacity).toBeCloseTo(
        (mesh(rb, 'illuminated gold arrow face').material as THREE.MeshBasicMaterial)
          .opacity, 9);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
