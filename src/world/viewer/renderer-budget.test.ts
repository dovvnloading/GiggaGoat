import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldScene, generateIsland } from '../index';
import { ART_BOOKMARKS } from './bookmarks';
import {
  MAX_VIEWER_PIXEL_RATIO, MIN_VIEWER_PIXEL_RATIO,
  createAdaptiveViewerResolution,
} from './adaptive-resolution';

describe('world-viewer GPU fragment work budget', () => {
  it('caps initial resolution independently of a high-DPI screen', () => {
    expect(MAX_VIEWER_PIXEL_RATIO).toBe(1);
    expect(MIN_VIEWER_PIXEL_RATIO).toBeLessThanOrEqual(0.5);
    for (const dpr of [1.5, 2, 3, 4]) {
      expect(createAdaptiveViewerResolution(dpr).ratio).toBe(1);
    }
    // A 1280x720 CSS viewport previously used a 1920x1080 (2.25x
    // fragment) framebuffer at 1.5 DPR. The new default is 1280x720.
    const oldPixels = Math.round(1280 * 1.5) * Math.round(720 * 1.5);
    const newPixels = 1280 * 720 * MAX_VIEWER_PIXEL_RATIO ** 2;
    expect(newPixels / oldPixels).toBeLessThanOrEqual(0.45);
  });

  it('drops under a sustained 18 FPS load and recovers only after stable 60 Hz', () => {
    // Test every art bookmark with the same worst-case cadence, including
    // Crane Yard, nighttime and the rising-tide material.
    for (const bookmark of ART_BOOKMARKS) {
      const controller = createAdaptiveViewerResolution(1.5);
      let changes = 0;
      for (let frame = 0; frame < 100; frame++) {
        if (controller.frame(1 / 18) !== null) changes++;
      }
      expect(changes, bookmark.label).toBeGreaterThan(2);
      expect(controller.ratio, bookmark.label).toBe(MIN_VIEWER_PIXEL_RATIO);
      const lowest = controller.ratio;
      for (let frame = 0; frame < 60; frame++) {
        controller.frame(1 / 60);
      }
      expect(controller.ratio, bookmark.label).toBe(lowest);
      for (let frame = 0; frame < 480; frame++) {
        controller.frame(1 / 60);
      }
      expect(controller.ratio, bookmark.label).toBeGreaterThan(lowest);
      expect(controller.ratio, bookmark.label).toBeLessThanOrEqual(MAX_VIEWER_PIXEL_RATIO);
    }
  });

  it('ignores tab suspension and obeys the actual display DPR', () => {
    const controller = createAdaptiveViewerResolution(0.75);
    expect(controller.ratio).toBe(0.75);
    for (let i = 0; i < 10; i++) controller.frame(1 / 18);
    controller.frame(30); // Background tab: not thirty seconds of slow GPU.
    expect(controller.ratio).toBe(0.75);
    for (let i = 0; i < 100; i++) controller.frame(1 / 18);
    expect(controller.ratio).toBe(MIN_VIEWER_PIXEL_RATIO);
    for (let i = 0; i < 1000; i++) controller.frame(1 / 60);
    expect(controller.ratio).toBeLessThanOrEqual(0.75);
    expect(createAdaptiveViewerResolution(Number.NaN).ratio).toBe(1);
  });

  it('avoids per-pixel noise hashes/powers on the full-screen sea and sky', () => {
    const view = createWorldScene(generateIsland({ seed: 'billy-isle', resolution: 65 }));
    try {
      const sea = view.water.material as THREE.ShaderMaterial;
      expect(sea.transparent).toBe(true);
      expect(sea.fragmentShader).toContain('uTerrain');
      expect(sea.fragmentShader).toContain('uLevel');
      expect(sea.fragmentShader).toContain('foam');
      expect(sea.fragmentShader.match(/\bsin\s*\(/g)).toHaveLength(1);
      expect(sea.fragmentShader).not.toMatch(/\b(pow|hash21|cos)\s*\(/);
      const dome = view.group.getObjectByName('gradient-sky') as THREE.Mesh;
      expect(dome).toBeDefined();
      const sky = dome.material as THREE.ShaderMaterial;
      expect(sky.fragmentShader).not.toMatch(/\bpow\s*\(/);
      expect(sky.fragmentShader).toContain('glow *= glow');
    } finally {
      view.dispose();
    }
  });
});
