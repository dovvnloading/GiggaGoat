import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { generateIsland } from './island';
import { createWorldScene } from './render';

const damLoad = vi.hoisted(() => ({ ready: false }));
// Model loading is asynchronous in a browser. Simulate its success notification
// without fetching a GLB or changing headless test budgets.
vi.mock('./visual-dam', async () => {
  const THREE = await import('three');
  return {
    buildDamVisuals: () => ({
      group: new THREE.Group(),
      update: (_seconds: number) => {},
      consumeShadowChange: () => {
        const ready = damLoad.ready;
        damLoad.ready = false;
        return ready;
      },
      dispose: () => {},
    }),
  };
});

describe('DM-9: Dam model arrival hides both procedural reservoir surfaces', () => {
  it.each([
    { seed: 'billy-isle', size: 600, resolution: 97 },
    { seed: 'dam-foam-alt', size: 900, resolution: 65 },
  ])('keeps the fallback until the GLB succeeds for $seed / $size',
    ({ seed, size, resolution }) => {
      damLoad.ready = false;
      const island = generateIsland({ seed, size, resolution });
      const scene = createWorldScene(island);
      try {
        const reservoir = scene.group.getObjectByName('dam-reservoir');
        const foam = scene.group.getObjectByName('dam-reservoir-foam');
        expect(reservoir).toBeInstanceOf(THREE.Mesh);
        expect(foam).toBeInstanceOf(THREE.Mesh);
        expect(reservoir!.visible).toBe(true);
        expect(foam!.visible).toBe(true);
        const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
        camera.position.set(0, 150, 350);
        camera.lookAt(0, 0, 0);
        scene.updateCulling(camera);
        expect(reservoir!.visible).toBe(true);
        expect(foam!.visible).toBe(true);

        damLoad.ready = true;
        scene.updateCulling(camera);
        expect(reservoir!.visible).toBe(false);
        expect(foam!.visible).toBe(false);
        scene.updateCulling(camera);
        expect(foam!.visible).toBe(false);
      } finally {
        scene.dispose();
        damLoad.ready = false;
      }
    });
});
