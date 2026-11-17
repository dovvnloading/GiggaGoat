import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Game } from './Game';
import { GameCharacters } from './GameCharacters';
import { CAMERA_TARGET_HEIGHT, SPAWN_CAMERA_PITCH, SPAWN_CAMERA_YAW_OFFSET,
  goatCameraLookAhead, goatCameraOffset, goatCameraVerticalOffset } from './GoatCamera';
import { planGoatSafeHud, projectGoatScreenBox, rectsIntersect, visibleGoatBounds,
  type ScreenRect } from './HudOcclusion';

const VIEWPORTS = [[1280, 720], [1600, 900], [1920, 1080]] as const;
const rect = (left: number, top: number, width: number, height: number): ScreenRect => ({
  left, top, right: left + width, bottom: top + height,
});

describe('free-roam camera / compact HUD reference framing', () => {
  it.each(VIEWPORTS)('reserves the build tray and shifts the projected player at %ix%i',
    (width, height) => {
      const viewport = rect(0, 0, width, height);
      const rawGoat = rect(width / 2 - 92, height * .60, 184, height * .26);
      const offset = goatCameraVerticalOffset(rawGoat, viewport);
      const safeBottom = Math.min(height * .775, height - 150);
      expect(rawGoat.bottom - offset).toBeCloseTo(safeBottom, 6);
      expect(safeBottom).toBeLessThan(height - 132); // compact tray plus raised badge
      expect(goatCameraVerticalOffset(rawGoat, viewport)).toBe(offset);
    });

  it('projects the real sculpt above the compact tray across desktop viewports and tiers',
    async () => {
      const game = await Game.create({ seed: 'billy-isle', resolution: 97 });
      const characters = new GameCharacters(new THREE.Scene(), game);
      try {
        const yaw = -game.island.spawns[0]!.heading + SPAWN_CAMERA_YAW_OFFSET;
        for (const size of [.6, 1, 1.6, 3]) {
          game.goat.resize(size);
          characters.update(0, game.physics.alpha);
          const pose = game.goat.torso.translation();
          const target = new THREE.Vector3(pose.x, pose.y + CAMERA_TARGET_HEIGHT * size, pose.z);
          const offset = goatCameraOffset(size, yaw, SPAWN_CAMERA_PITCH);
          const ahead = goatCameraLookAhead(size, yaw);
          const bounds = visibleGoatBounds(characters.player.root);
          for (const [width, height] of VIEWPORTS) {
            const camera = new THREE.PerspectiveCamera(67, width / height, .07, 2200);
            camera.position.copy(target).add(new THREE.Vector3(offset.x, offset.y, offset.z));
            camera.lookAt(target.clone().add(new THREE.Vector3(ahead.x, ahead.y, ahead.z)));
            const viewport = rect(0, 0, width, height);
            const unframed = projectGoatScreenBox(bounds, camera, viewport, false);
            expect(unframed, `tier ${size} at ${width}x${height}`).not.toBeNull();
            camera.setViewOffset(width, height, 0,
              goatCameraVerticalOffset(unframed!, viewport), width, height);
            const goat = projectGoatScreenBox(bounds, camera, viewport);
            expect(goat, `tier ${size} at ${width}x${height}`).not.toBeNull();
            const box = goat!;
            const safeBottom = Math.min(height * .775, height - 150);
            expect(box.bottom, `goat / tray at ${width}x${height}`).toBeLessThanOrEqual(safeBottom + 2);
            expect(box.top, `goat clipped at ${width}x${height}`).toBeGreaterThan(12);
            expect(box.left).toBeGreaterThan(width * .2);
            expect(box.right).toBeLessThan(width * .8);
            const trayWidth = Math.min(560, width * .43);
            const tray = rect((width - trayWidth) / 2, height - 132, trayWidth, 132);
            expect(rectsIntersect(box, tray)).toBe(false);

            const layout = planGoatSafeHud(box, viewport, [
              { id: 'combo', rect: rect((width - Math.min(510, width * .31)) / 2,
                12, Math.min(510, width * .31), 166) },
              { id: 'hotbar', rect: tray },
            ], [
              { id: 'board', width: 230, height: 32 },
              { id: 'click', width: 235, height: 32 },
            ]);
            expect(layout.hiddenPanels.has('hotbar')).toBe(false);
            for (const prompt of layout.prompts.values()) {
              expect(rectsIntersect(box, prompt)).toBe(false);
              expect(rectsIntersect(tray, prompt)).toBe(false);
            }
            if (size === .6) {
              expect(layout.prompts.size).toBe(2);
              expect([...layout.prompts.values()].every(p => p.bottom < box.top)).toBe(true);
            }
          }
        }
      } finally {
        characters.dispose();
        game.dispose();
      }
    });
});
