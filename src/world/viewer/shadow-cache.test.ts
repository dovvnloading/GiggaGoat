import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland } from '../index';
import { ART_BOOKMARKS } from './bookmarks';
import { createStaticShadowCache } from './shadow-cache';

describe('static world-viewer shadow-pass budget', () => {
  it('runs only one shadow pass per unchanged bookmark, not every animation frame', () => {
    const map = { autoUpdate: true, needsUpdate: false };
    const cache = createStaticShadowCache(map);
    expect(map.autoUpdate).toBe(false);
    const island = generateIsland({ seed: 'billy-isle', resolution: 193 });
    const view = createWorldScene(island, { chunkSegments: 32 });
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.25, 4000);
    let shadowPasses = 0;
    const render = (): void => {
      cache.beforeRender();
      if (map.autoUpdate || map.needsUpdate) shadowPasses++;
      // WebGLShadowMap consumes and resets needsUpdate after its depth pass.
      map.needsUpdate = false;
    };
    try {
      expect(view.sun.castShadow).toBe(true);
      expect(view.sun.shadow.mapSize.x).toBe(1536);
      expect(view.sun.shadow.mapSize.y).toBe(1536);
      for (const mark of ART_BOOKMARKS) {
        camera.position.set(mark.camera.x, mark.camera.y, mark.camera.z);
        camera.lookAt(mark.target.x, mark.target.y, mark.target.z);
        camera.fov = mark.fov;
        camera.updateProjectionMatrix();
        view.setDayNight(mark.day);
        cache.invalidate(); // Lighting and/or the active bookmark changed.
        const before = shadowPasses;
        for (let frame = 0; frame < 180; frame++) {
          view.update(frame / 60);
          if (view.updateCulling(camera)) cache.invalidate();
          render();
        }
        expect(shadowPasses - before, mark.label).toBe(1);
      }
      // A changed daylight setting requires exactly one new full pass.
      view.setDayNight(0.05);
      cache.invalidate();
      render();
      expect(shadowPasses).toBe(ART_BOOKMARKS.length + 1);
      for (let frame = 0; frame < 180; frame++) render();
      expect(shadowPasses).toBe(ART_BOOKMARKS.length + 1);
    } finally {
      view.dispose();
    }
  });

  it('detects shadow-caster visibility transitions, not ordinary terrain LOD changes', () => {
    const view = createWorldScene(generateIsland({ seed: 'billy-isle', resolution: 65 }));
    try {
      const casters: THREE.Mesh[] = [];
      view.group.traverse(object => {
        if (object instanceof THREE.Mesh && object.castShadow) casters.push(object);
      });
      expect(casters.length).toBeGreaterThan(5);
      const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.25, 4000);
      for (const mark of ART_BOOKMARKS) {
        const oldVisibility = casters.map(mesh => mesh.visible);
        camera.position.set(mark.camera.x, mark.camera.y, mark.camera.z);
        camera.lookAt(mark.target.x, mark.target.y, mark.target.z);
        camera.fov = mark.fov;
        camera.updateProjectionMatrix();
        const changed = view.updateCulling(camera);
        expect(changed, mark.label).toBe(casters.some(
          (mesh, index) => mesh.visible !== oldVisibility[index]));
        expect(view.updateCulling(camera), mark.label).toBe(false);
      }
    } finally {
      view.dispose();
    }
  });
});
