import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Game } from './Game';
import { GameCharacters } from './GameCharacters';
import { CAMERA_TARGET_HEIGHT, SPAWN_CAMERA_PITCH,
  goatCameraLookAhead, goatCameraOffset, goatCameraVerticalOffset } from './GoatCamera';
import { planGoatSafeHud, projectGoatScreenBox, rectsIntersect, visibleGoatBounds,
  type HudPanelRect, type ScreenRect } from './HudOcclusion';

const rect = (left: number, top: number, width: number, height: number): ScreenRect => ({
  left, top, right: left + width, bottom: top + height,
});

describe('goat-safe HUD in free roam', () => {
  it('protects the real goat screen-space box and preserves the corner HUD', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 97 });
    const characters = new GameCharacters(new THREE.Scene(), game);
    try {
      for (let i = 0; i < 120; i++) game.step();
      characters.update(0, game.physics.alpha);
      const size = game.rules.style.scale;
      const pose = game.goat.torso.translation();
      const target = new THREE.Vector3(pose.x, pose.y + CAMERA_TARGET_HEIGHT * size, pose.z);
      const yaw = game.goat.locomotion.heading;
      const offset = goatCameraOffset(size, yaw, SPAWN_CAMERA_PITCH);
      const ahead = goatCameraLookAhead(size, yaw);
      const camera = new THREE.PerspectiveCamera(67, 1568 / 744, .07, 2200);
      camera.position.copy(target).add(new THREE.Vector3(offset.x, offset.y, offset.z));
      camera.lookAt(target.clone().add(new THREE.Vector3(ahead.x, ahead.y, ahead.z)));
      const viewport = rect(0, 0, 1568, 744);
      const bounds = visibleGoatBounds(characters.player.root);
      const unframed = projectGoatScreenBox(bounds, camera, viewport, false);
      expect(unframed).not.toBeNull();
      camera.setViewOffset(1568, 744, 0,
        goatCameraVerticalOffset(size, SPAWN_CAMERA_PITCH, camera.fov, 744), 1568, 744);
      const goat = projectGoatScreenBox(bounds, camera, viewport);
      expect(goat).not.toBeNull();
      const goatBox = goat!;
      // Approximate painted extents of the compact, always-visible HUD at the
      // supplied 1568x744 QA resolution, including the Hay-Build tray.
      const panels: HudPanelRect[] = [
        { id: 'meter', rect: rect(21, 8, 486, 168) },
        { id: 'combo', rect: rect(520, 7, 528, 166) },
        { id: 'map', rect: rect(1270, 7, 285, 305) },
        { id: 'gig', rect: rect(1180, 309, 376, 210) },
        { id: 'stamina', rect: rect(25, 509, 215, 215) },
        { id: 'hotbar', rect: rect(504, 609, 560, 124) },
      ];
      const layout = planGoatSafeHud(goatBox, viewport, panels,
        [{ id: 'click', width: 285, height: 45 }]);
      expect([...layout.hiddenPanels].filter(id => id !== 'hotbar')).toEqual([]);
      expect(layout.prompts.has('click')).toBe(true);
      for (const panel of panels.filter(panel => !layout.hiddenPanels.has(panel.id))) {
        expect(rectsIntersect(goatBox, panel.rect), panel.id).toBe(false);
      }
      for (const prompt of layout.prompts.values()) {
        expect(rectsIntersect(goatBox, prompt)).toBe(false);
        expect(prompt.bottom).toBeLessThan(goatBox.top);
      }
    } finally {
      characters.dispose();
      game.dispose();
    }
  });

  it('keeps both transient prompts above the goat and suppresses overlapping panels', () => {
    const viewport = rect(0, 0, 1568, 744);
    const goat = rect(700, 460, 180, 170);
    const panels = [
      { id: 'meter', rect: rect(20, 20, 490, 160) },
      { id: 'hotbar', rect: rect(520, 530, 530, 190) },
      { id: 'stray-panel', rect: rect(850, 450, 240, 170) },
    ];
    const layout = planGoatSafeHud(goat, viewport, panels, [
      { id: 'board', width: 270, height: 40 },
      { id: 'click', width: 290, height: 45 },
    ]);
    expect([...layout.hiddenPanels].sort()).toEqual(['hotbar', 'stray-panel']);
    expect(layout.prompts.size).toBe(2);
    for (const panel of panels.filter(panel => !layout.hiddenPanels.has(panel.id))) {
      expect(rectsIntersect(goat, panel.rect), panel.id).toBe(false);
    }
    for (const prompt of layout.prompts.values()) {
      expect(rectsIntersect(goat, prompt)).toBe(false);
      expect(prompt.bottom).toBeLessThan(goat.top);
    }
    expect(rectsIntersect(layout.prompts.get('board')!, layout.prompts.get('click')!)).toBe(false);
  });

  it('hides prompts rather than letting small viewports or close cameras cover the player', () => {
    const viewport = rect(0, 0, 360, 600);
    const goat = rect(105, 42, 150, 530);
    const layout = planGoatSafeHud(goat, viewport,
      [{ id: 'stamina', rect: rect(100, 460, 160, 130) }],
      [{ id: 'click', width: 250, height: 48 }]);
    expect(layout.hiddenPanels.has('stamina')).toBe(true);
    expect(layout.prompts.size).toBe(0);
  });

  it('preserves DOMRect-style edges for HUD protection and skips invalid framing samples', () => {
    const edges = rect(12, 24, 360, 600);
    const viewport = Object.create({
      get left() { return edges.left; },
      get top() { return edges.top; },
      get right() { return edges.right; },
      get bottom() { return edges.bottom; },
    }) as ScreenRect;
    expect(Object.keys(viewport)).toHaveLength(0);

    const camera = new THREE.PerspectiveCamera(67, 360 / 600, .07, 2200);
    const nearPlaneBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(1, 1, 1));
    expect(projectGoatScreenBox(nearPlaneBox, camera, viewport)).toEqual(edges);
    expect(projectGoatScreenBox(nearPlaneBox, camera, viewport, false)).toBeNull();

    const inFront = nearPlaneBox.clone().translate(new THREE.Vector3(0, 0, -5));
    expect(projectGoatScreenBox(inFront, camera, viewport, false)).not.toBeNull();
    camera.projectionMatrix.elements[5] = NaN;
    expect(projectGoatScreenBox(inFront, camera, viewport)).toEqual(edges);
    expect(projectGoatScreenBox(inFront, camera, viewport, false)).toBeNull();
    camera.updateProjectionMatrix();
    expect(projectGoatScreenBox(inFront, camera, viewport, false)).not.toBeNull();
  });
  it('keeps visible prompts clear of the real spawn goat at desktop sizes', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 97 });
    const characters = new GameCharacters(new THREE.Scene(), game);
    try {
      for (let i = 0; i < 120; i++) game.step();
      characters.update(0, game.physics.alpha);
      const scale = game.rules.style.scale;
      const pose = game.goat.torso.translation();
      const target = new THREE.Vector3(pose.x, pose.y + CAMERA_TARGET_HEIGHT * scale, pose.z);
      const yaw = game.goat.locomotion.heading;
      const offset = goatCameraOffset(scale, yaw, SPAWN_CAMERA_PITCH);
      const ahead = goatCameraLookAhead(scale, yaw);
      const bounds = visibleGoatBounds(characters.player.root);

      for (const [width, height] of [[1280, 720], [1600, 900], [1920, 1080]] as const) {
        const viewport = rect(0, 0, width, height);
        const camera = new THREE.PerspectiveCamera(67, width / height, .07, 2200);
        camera.position.copy(target).add(new THREE.Vector3(offset.x, offset.y, offset.z));
        camera.lookAt(target.clone().add(new THREE.Vector3(ahead.x, ahead.y, ahead.z)));
        const unframed = projectGoatScreenBox(bounds, camera, viewport, false);
        expect(unframed, width + 'x' + height).not.toBeNull();
        camera.setViewOffset(width, height, 0,
          goatCameraVerticalOffset(scale, SPAWN_CAMERA_PITCH, camera.fov, height), width, height);
        const goat = projectGoatScreenBox(bounds, camera, viewport);
        expect(goat, width + 'x' + height).not.toBeNull();

        const comboWidth = Math.max(377, Math.min(545, width * .323));
        const comboHeight = Math.max(155, Math.min(217, width * .127));
        const layout = planGoatSafeHud(goat!, viewport, [
          { id: 'combo', rect: rect((width - comboWidth) / 2, 8, comboWidth, comboHeight) },
        ], [
          { id: 'board', width: 320, height: 43 },
          { id: 'hint', width: 450, height: 43 },
        ]);
        // Protect the goat even when there is only room for one of the prompts:
        // the other prompt is intentionally suppressed instead of overlapping it.
        expect(layout.prompts.size, width + 'x' + height).toBeGreaterThan(0);
        const board = layout.prompts.get('board');
        const hint = layout.prompts.get('hint');
        if (board && hint) expect(rectsIntersect(board, hint)).toBe(false);
        for (const prompt of layout.prompts.values()) {
          expect(rectsIntersect(goat!, prompt), width + 'x' + height).toBe(false);
          expect(prompt.bottom, width + 'x' + height).toBeLessThan(goat!.top);
          expect(prompt.left).toBeGreaterThanOrEqual(0);
          expect(prompt.right).toBeLessThanOrEqual(width);
        }
      }
    } finally {
      characters.dispose();
      game.dispose();
    }
  });

});
