import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { V } from '../physics';
import { heightAt } from '../world';
import { Game } from './Game';
import { MowDownPresentation } from './MowDownPresentation';

describe('Mow-Down marker readability', () => {
  it('clears the ground ring and moves the single label when the player grazes a patch', async () => {
    const game = await Game.create({ resolution: 97 });
    const { island } = game;
    const { config } = game.gigs.director.startPractice('mow-down', 'hard');
    if (config.kind !== 'mow-down') throw new Error('Expected hard Mow-Down');
    expect(config.patches).toHaveLength(24);

    const label = new THREE.Sprite();
    const guide = new MowDownPresentation(island, config.patches, label);
    const rings = guide.getObjectByName('mow-down-patches') as THREE.InstancedMesh;
    const bounds = guide.getObjectByName('mow-down-boundary') as THREE.LineLoop;
    const midpoint = new THREE.Matrix4();
    try {
      const first = config.patches[0]!;
      guide.update([], first);
      expect(guide.children.filter(child => child instanceof THREE.Sprite)).toEqual([label]);
      expect(label.material.sizeAttenuation).toBe(false);
      expect(rings.count).toBe(config.patches.length);
      expect((rings.geometry as THREE.RingGeometry).parameters).toMatchObject({ outerRadius: .93 });
      expect(bounds.geometry.getAttribute('position').count).toBeGreaterThan(4);
      expect(label.getWorldPosition(new THREE.Vector3())).toMatchObject({ x: first.x, z: first.z });

      game.teleport(V(first.x, heightAt(island, first.x, first.z), first.z), 0);
      for (let i = 0; i < 40; i++) game.step();
      game.step({ graze: true });
      const grazed = game.gigs.active?.finishedIds ?? [];
      expect(grazed).toEqual(['0']);
      guide.update(grazed, first);
      rings.getMatrixAt(0, midpoint);
      const next = config.patches[1]!;
      expect(rings.count).toBe(config.patches.length - 1);
      expect(midpoint.elements[12]).toBeCloseTo(next.x);
      expect(midpoint.elements[14]).toBeCloseTo(next.z);
      expect(Math.hypot(label.position.x - first.x, label.position.z - first.z)).toBeCloseTo(2.1);

      guide.update(config.patches.map((_, i) => String(i)), first);
      expect(rings.count).toBe(0);
      expect(label.visible).toBe(false);
    } finally {
      rings.dispose();
      rings.geometry.dispose();
      (rings.material as THREE.Material).dispose();
      bounds.geometry.dispose();
      (bounds.material as THREE.Material).dispose();
      label.material.dispose();
      game.dispose();
    }
  });
});
