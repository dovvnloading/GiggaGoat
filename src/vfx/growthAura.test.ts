import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  assertGrowthTier, GROWTH_BURST_SECONDS, GROWTH_TIER_SCALES,
  makeGrowthAuraFrame, sampleGiggaHold, sampleGrowthBurst,
} from './growthAuraMath';
import { GiggaGrowthPurpleAura, createGiggaGrowthPurpleAura } from './GiggaGrowthPurpleAura';

function object(root: THREE.Object3D, name: string): THREE.Object3D {
  const found = root.getObjectByName(name);
  if (!found) throw new Error('Missing ' + name);
  return found;
}
function mesh(root: THREE.Object3D, name: string): THREE.Mesh {
  const found = object(root, name);
  if (!(found instanceof THREE.Mesh)) throw new Error('Not a mesh: ' + name);
  return found;
}

describe('09 growth purple aura tier timeline', () => {
  it('enforces Kid → Billy → Big → GIGGA values and the in-game scale ratios', () => {
    expect(GROWTH_TIER_SCALES).toEqual([0.6, 1, 1.6, 3]);
    for (const tier of [0, 1, 2, 3]) expect(() => assertGrowthTier(tier)).not.toThrow();
    for (const bad of [-1, 4, 1.5, NaN, Infinity, -Infinity]) {
      expect(() => assertGrowthTier(bad)).toThrow(RangeError);
    }
  });

  it('starts at the hooves, raises spirals and pillars, flashes only for GIGGA, and fades', () => {
    const out = makeGrowthAuraFrame();
    expect(sampleGrowthBurst(0, 0, out)).toBeNull();
    for (const tier of [1, 2, 3] as const) {
      const life = GROWTH_BURST_SECONDS[tier];
      const at = (p: number) => ({ ...sampleGrowthBurst(tier, p * life, out)! });
      const start = at(0);
      const hoof = at(0.10);
      const rise = at(0.36);
      const peak = at(0.55);
      const end = at(0.94);
      expect(start.ring).toBe(0);
      expect(start.pillars).toBe(0);
      expect(hoof.ring).toBeGreaterThan(0.70);
      expect(rise.pillars).toBeGreaterThan(hoof.pillars);
      expect(rise.ribbons).toBeGreaterThan(hoof.ribbons);
      expect(peak.ribbons).toBeGreaterThan(0.85);
      expect(end.ring).toBeLessThan(peak.ring);
      expect(end.motes).toBeLessThan(peak.motes);
      expect(peak.flare).toBe(tier === 3 ? 1 : 0);
      expect(sampleGrowthBurst(tier, life, out)).toBeNull();
      expect(sampleGrowthBurst(tier, -0.01, out)).toBeNull();
      expect(sampleGrowthBurst(tier, NaN, out)).toBeNull();
    }
    const big = sampleGrowthBurst(2, 0.75, out)!;
    const bigRadius = big.radius;
    const bigHeight = big.height;
    const giga = sampleGrowthBurst(3, 0.90, out)!;
    expect(giga.radius).toBeGreaterThan(bigRadius * 1.7);
    expect(giga.height).toBeGreaterThan(bigHeight * 1.7);
  });

  it('samples into the same mutable frame for any time partition', () => {
    const out = makeGrowthAuraFrame();
    for (let i = 0; i < 120; i++) {
      expect(sampleGrowthBurst(3, GROWTH_BURST_SECONDS[3] * i / 120, out)).toBe(out);
    }
    const hold = sampleGiggaHold(0, out);
    expect(hold).toBe(out);
    expect(hold.ring).toBeGreaterThan(0);
    expect(hold.pillars).toBeGreaterThan(0);
    expect(hold.ribbons).toBeGreaterThan(0);
    expect(hold.motes).toBeGreaterThan(0);
    expect(hold.flare).toBe(0);
    expect(sampleGiggaHold(10_000, out).ring).toBeGreaterThan(0.15);
    expect(() => sampleGiggaHold(-1, out)).toThrow(RangeError);
    expect(() => sampleGiggaHold(Infinity, out)).toThrow(RangeError);
  });
});

describe('09 reusable Three.js aura and bounded pulse pool (headless)', () => {
  it('attaches without owning the goat, animates follow-local, and holds softly at GIGGA', () => {
    const goat = new THREE.Group();
    const world = new THREE.Scene();
    world.add(goat);
    const aura = createGiggaGrowthPurpleAura({ capacity: 2, hoofOffsetY: 0.07 });
    try {
      expect(aura.attach(goat)).toBe(aura);
      expect(aura.group.parent).toBe(goat);
      expect(aura.group.position.y).toBeCloseTo(0.07);
      aura.setTier(0);
      expect(aura.activeCount).toBe(0);
      aura.triggerGrow();
      expect(aura.activeCount).toBe(0);
      aura.triggerGrow(1);
      expect(aura.tier).toBe(1);
      expect(aura.activeCount).toBe(1);
      aura.update(0.38);
      expect(object(aura.group, 'violet hoof glow rings').visible).toBe(true);
      aura.triggerGrow(2);
      expect(aura.activeCount).toBe(2);
      aura.update(0.26);
      aura.triggerGrow(3);
      expect(aura.tier).toBe(3);
      const hold = object(aura.group, 'GIGGA soft looping hold aura');
      expect(hold.visible).toBe(true);
      aura.update(GROWTH_BURST_SECONDS[3] + 0.01);
      expect(aura.activeCount).toBe(0);
      expect(hold.visible).toBe(true);
      const softOutline = mesh(hold, 'bright lilac hoof outline');
      expect((softOutline.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0);
      const persistentRing = (softOutline.material as THREE.MeshBasicMaterial).opacity;
      aura.triggerGrow();
      aura.update(GROWTH_BURST_SECONDS[3] * 0.55);
      const pulse = ['growth aura pooled pulse 0', 'growth aura pooled pulse 1']
        .map(name => object(aura.group, name))
        .find(root => object(root, 'GIGGA bright purple flare').visible)!;
      expect(object(pulse, 'GIGGA bright purple flare').visible).toBe(true);
      expect((mesh(pulse, 'bright lilac hoof outline').material as THREE.MeshBasicMaterial)
        .opacity).toBeGreaterThan(persistentRing);
      // The aura follows a moved/rotated goat without converting world coordinates.
      goat.position.set(4, 0.5, -3);
      goat.rotation.y = Math.PI / 3;
      goat.updateWorldMatrix(true, true);
      const targetPosition = new THREE.Vector3();
      aura.group.getWorldPosition(targetPosition);
      expect(targetPosition.x).toBeCloseTo(4);
      expect(targetPosition.y).toBeCloseTo(0.57);
      expect(targetPosition.z).toBeCloseTo(-3);
      aura.setTier(2);
      expect(hold.visible).toBe(false);
      expect(aura.activeCount).toBe(0); // downgrade cancels obsolete flashes
      aura.detach();
      expect(aura.group.parent).toBeNull();
      expect(goat.children).not.toContain(aura.group);
      aura.attach(goat);
      aura.setTier(3);
      expect(hold.visible).toBe(true);
    } finally {
      aura.dispose();
    }
    expect(world.children).toContain(goat);
    expect(goat.children).not.toContain(aura.group);
    expect(aura.group.children).toHaveLength(0);
  });

  it('shares GPU geometries/textures, never reconstructs sprites on update, and recycles the oldest slot', () => {
    const aura = new GiggaGrowthPurpleAura({ capacity: 2 });
    const root0 = object(aura.group, 'growth aura pooled pulse 0');
    const root1 = object(aura.group, 'growth aura pooled pulse 1');
    const pulse0 = mesh(root0, 'bright lilac hoof outline');
    const pulse1 = mesh(root1, 'bright lilac hoof outline');
    const ribbon0 = mesh(root0, 'helical violet ribbon 0');
    const ribbon1 = mesh(root1, 'helical violet ribbon 0');
    const sprite0 = object(root0, 'rising purple sparkle mote 0');
    const ringGeometry = pulse0.geometry;
    const spiralGeometry = ribbon0.geometry;
    expect(pulse1.geometry).toBe(ringGeometry);
    expect(ribbon1.geometry).toBe(spiralGeometry);
    try {
      aura.triggerGrow(1);
      aura.update(0.4);
      aura.triggerGrow(2);
      expect(aura.activeCount).toBe(2);
      aura.update(0.1);
      // Oldest (slot 0, 0.5 s) is recycled; slot 1 (0.1 s) is preserved.
      aura.triggerGrow(3);
      expect(aura.activeCount).toBe(2);
      expect(root0.visible).toBe(false); // freshly triggered, first visible frame after update
      aura.update(0.15);
      expect(root0.visible).toBe(true);
      expect(root1.visible).toBe(true);
      for (let i = 0; i < 100; i++) aura.update(1 / 60);
      expect(object(root0, 'rising purple sparkle mote 0')).toBe(sprite0);
      expect(pulse0.geometry).toBe(ringGeometry);
      expect(ribbon0.geometry).toBe(spiralGeometry);
      expect(aura.activeCount).toBeLessThanOrEqual(2);
      aura.clear();
      expect(aura.tier).toBe(0);
      expect(aura.activeCount).toBe(0);
      expect(root0.visible).toBe(false);
      expect(root1.visible).toBe(false);
      aura.triggerGrow(1);
      expect(aura.activeCount).toBe(1);
    } finally {
      aura.dispose();
    }
  });

  it('gives identical motion for one step versus many, validates dt and disposal', () => {
    const a = new GiggaGrowthPurpleAura({ capacity: 1 });
    const b = new GiggaGrowthPurpleAura({ capacity: 1 });
    try {
      a.triggerGrow(3);
      b.triggerGrow(3);
      a.update(0.72);
      for (let i = 0; i < 24; i++) b.update(0.03);
      const ar = object(a.group, 'growth aura pooled pulse 0');
      const br = object(b.group, 'growth aura pooled pulse 0');
      const aOutline = mesh(ar, 'bright lilac hoof outline');
      const bOutline = mesh(br, 'bright lilac hoof outline');
      expect((aOutline.material as THREE.MeshBasicMaterial).opacity)
        .toBeCloseTo((bOutline.material as THREE.MeshBasicMaterial).opacity, 10);
      const aMote = object(ar, 'rising purple sparkle mote 9');
      const bMote = object(br, 'rising purple sparkle mote 9');
      expect(aMote.position.distanceTo(bMote.position)).toBeLessThan(1e-7);
      expect(ar.rotation.y).toBeCloseTo(br.rotation.y);
      expect(() => a.update(-0.1)).toThrow(RangeError);
      expect(() => a.update(NaN)).toThrow(RangeError);
      expect(() => a.setTier(4)).toThrow(RangeError);
      expect(() => a.triggerGrow(2.5)).toThrow(RangeError);
    } finally {
      a.dispose();
      b.dispose();
    }
    a.dispose();
    expect(() => a.attach(new THREE.Group())).toThrow(/disposed/);
    expect(() => a.update(0)).toThrow(/disposed/);
    expect(() => a.triggerGrow(3)).toThrow(/disposed/);
    for (const n of [0, 9, 1.5, NaN]) {
      expect(() => new GiggaGrowthPurpleAura({ capacity: n })).toThrow(RangeError);
    }
    expect(() => new GiggaGrowthPurpleAura({ hoofOffsetY: Infinity })).toThrow(RangeError);
  });
});
