import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { generateIsland } from './island';
import { createWorldScene } from './render';

const damLoad = vi.hoisted(() => ({ ready: false }));
// Model loading is asynchronous in a browser. Simulate its success notification
// without fetching a GLB or changing headless test budgets.
vi.mock('./visual-dam', async importOriginal => {
  const actual = await importOriginal<typeof import('./visual-dam')>();
  return {
    ...actual,
    buildDamVisuals: (...args: Parameters<typeof actual.buildDamVisuals>) => ({
      ...actual.buildDamVisuals(...args),
      consumeShadowChange: () => {
        const ready = damLoad.ready;
        damLoad.ready = false;
        return ready;
      },
    }),
  };
});

describe('DM-01: the same terrain reservoir survives Dam model arrival', () => {
  it.each([
    { seed: 'billy-isle', size: 600, resolution: 97 },
    { seed: 'dam-foam-alt', size: 900, resolution: 65 },
  ])('keeps the terrain reservoir before and after GLB success for $seed / $size',
    ({ seed, size, resolution }) => {
      damLoad.ready = false;
      const island = generateIsland({ seed, size, resolution });
      const scene = createWorldScene(island);
      try {
        const reservoir = scene.group.getObjectByName('dam-reservoir');
        expect(reservoir).toBeInstanceOf(THREE.Mesh);
        expect(reservoir!.visible).toBe(true);
        const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
        camera.position.set(0, 150, 350);
        camera.lookAt(0, 0, 0);
        scene.updateCulling(camera);
        expect(reservoir!.visible).toBe(true);

        damLoad.ready = true;
        scene.updateCulling(camera);
        expect(reservoir!.visible).toBe(true);
        scene.updateCulling(camera);
      } finally {
        scene.dispose();
        damLoad.ready = false;
      }
    });
});
