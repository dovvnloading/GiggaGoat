import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Game } from './Game';
import { GameCharacters } from './GameCharacters';
import { CAMERA_TARGET_HEIGHT, SPAWN_CAMERA_PITCH, SPAWN_CAMERA_YAW_OFFSET,
  goatCameraLookAhead, goatCameraOffset } from './GoatCamera';
import { planGoatSafeHud, projectGoatScreenBox, rectsIntersect, visibleGoatBounds,
  type HudPanelRect, type ScreenRect } from './HudOcclusion';

const rect = (left: number, top: number, width: number, height: number): ScreenRect => ({
  left, top, right: left + width, bottom: top + height,
});

describe('goat-safe HUD in free roam', () => {
  it('keeps the real goat screen-space box separate from all default panels and prompts', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 97 });
    const characters = new GameCharacters(new THREE.Scene(), game);
    try {
      characters.update(0, game.physics.alpha);
      const size = game.rules.style.scale;
      const pose = game.goat.torso.translation();
      const target = new THREE.Vector3(pose.x, pose.y + CAMERA_TARGET_HEIGHT * size, pose.z);
      const yaw = -game.island.spawns[0]!.heading + SPAWN_CAMERA_YAW_OFFSET;
      const offset = goatCameraOffset(size, yaw, SPAWN_CAMERA_PITCH);
      const ahead = goatCameraLookAhead(size, yaw);
      const camera = new THREE.PerspectiveCamera(67, 1568 / 744, .07, 2200);
      camera.position.copy(target).add(new THREE.Vector3(offset.x, offset.y, offset.z));
      camera.lookAt(target.clone().add(new THREE.Vector3(ahead.x, ahead.y, ahead.z)));
      const viewport = rect(0, 0, 1568, 744);
      const goat = projectGoatScreenBox(visibleGoatBounds(characters.player.root), camera, viewport);
      expect(goat).not.toBeNull();
      const goatBox = goat!;
      // Approximate painted extents of the existing CSS corner cards at the
      // supplied 1568x744 QA resolution; the build hotbar is absent in free roam.
      const panels: HudPanelRect[] = [
        { id: 'meter', rect: rect(21, 8, 486, 168) },
        { id: 'combo', rect: rect(520, 7, 528, 166) },
        { id: 'map', rect: rect(1270, 7, 285, 305) },
        { id: 'gig', rect: rect(1180, 309, 376, 210) },
        { id: 'stamina', rect: rect(25, 509, 215, 215) },
      ];
      const layout = planGoatSafeHud(goatBox, viewport, panels,
        [{ id: 'click', width: 285, height: 45 }]);
      expect(layout.hiddenPanels.size, 'default view should preserve the corner HUD').toBe(0);
      expect(layout.prompts.has('click')).toBe(true);
      for (const panel of panels) {
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
    // An intersecting near-plane view conservatively protects the whole screen.
    const camera = new THREE.PerspectiveCamera(67, 360 / 600, .07, 2200);
    camera.updateMatrixWorld(true);
    const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(1, 1, 1));
    expect(projectGoatScreenBox(box, camera, viewport)).toEqual(viewport);
  });
});
