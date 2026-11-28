import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PhysicsWorld, Q, RAPIER, V } from '../physics';
import { Game } from './Game';
import { GameCharacters } from './GameCharacters';
import { GameView } from './GameView';
import { CAMERA_TARGET_HEIGHT, PLAY_CAMERA_PITCH, clampCameraPitch, goatCameraVerticalOffset,
  goatOrbitOffset, goatViewDirection } from './GoatCamera';
import { planGoatSafeHud, projectGoatScreenBox, rectsIntersect, visibleGoatBounds,
  type ScreenRect } from './HudOcclusion';

const VIEWPORTS = [[1280, 720], [1600, 900], [1920, 1080]] as const;
const rect = (left: number, top: number, width: number, height: number): ScreenRect => ({
  left, top, right: left + width, bottom: top + height,
});

function cameraFixture(physics: PhysicsWorld) {
  const player = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(67, 16 / 9, .07, 2200);
  const input = { yaw: 0, pitch: PLAY_CAMERA_PITCH };
  const view = Object.assign(Object.create(GameView.prototype) as {
    updateCamera(alpha: number, dt: number): void;
  }, {
    camera, input, currentSettings: { fov: 67 }, titleCamera: false, cameraDistance: Infinity,
    cameraAim: new THREE.Vector3(), cameraTarget: new THREE.Vector3(),
    cameraOffset: new THREE.Vector3(), cameraDirection: new THREE.Vector3(),
    clearBoom: new THREE.Vector3(), probeBoom: new THREE.Vector3(), obstructionFraming: 0,
    cameraCollisionShape: new RAPIER.Ball(.25), cameraCollisionRotation: Q(),
    cameraCollisionFilter: {},
    game: { physics: Object.assign(Object.create(physics) as PhysicsWorld, {
      getInterpolatedTransform: () => ({ translation: V(0, -CAMERA_TARGET_HEIGHT, 0) }),
    }), rules: { style: { scale: 1 } }, goat: {
      ownsBody: () => false, locomotion: { input: { sprint: false } }, torso: { linvel: () => V() },
    } },
    characters: { player: { root: player } }, world: { sun: new THREE.DirectionalLight() },
  });
  return { view, camera, input, player };
}

describe('free-roam camera / compact HUD reference framing', () => {
  it('changes the lens aboard each ride when the player adjusts the field of view', async () => {
    const game = await Game.create({ resolution: 65 });
    try {
      const { view, camera } = cameraFixture(game.physics);
      Object.assign(view, { game });
      for (const ride of ['boat', 'plane', 'balloon', 'tram'] as const) {
        game.travel.active = ride;
        for (const fov of [95, 55]) {
          view.currentSettings.fov = fov;
          for (let i = 0; i < 120; i++) view.updateCamera(0, 1 / 60);
          expect(camera.fov).toBeCloseTo(fov, 1);
          expect(camera.projectionMatrix.elements[5]).toBeCloseTo(1 / Math.tan(fov * Math.PI / 360), 2);
        }
      }
    } finally {
      game.dispose();
    }
  });

  it('snaps the camera pivot for a short teleport while retaining normal follow smoothing', async () => {
    const physics = await PhysicsWorld.create();
    try {
      const { view } = cameraFixture(physics);
      const pose = { translation: V(0, -CAMERA_TARGET_HEIGHT, 0) };
      const game = {
        teleportVersion: 0,
        physics: Object.assign(Object.create(physics) as PhysicsWorld, {
          getInterpolatedTransform: () => pose,
        }),
        rules: { style: { scale: 1 } },
        goat: { ownsBody: () => false, locomotion: { input: { sprint: false } },
          torso: { linvel: () => V() } },
      };
      const target = new THREE.Vector3();
      Object.assign(view, { game, cameraTarget: target, cameraTeleportVersion: 0 });
      view.updateCamera(0, 1 / 60);
      pose.translation.x = 3;
      view.updateCamera(0, 1 / 60);
      expect(target.x).toBeGreaterThan(0);
      expect(target.x).toBeLessThan(3);
      pose.translation.x = 8;
      game.teleportVersion++;
      view.updateCamera(0, 1 / 60);
      expect(target.x).toBeCloseTo(8, 8);
    } finally { physics.dispose(); }
  });

  it.each([0, .24])('keeps the chase camera clear of a close obstacle at x=%s', async x => {
    const physics = await PhysicsWorld.create();
    try {
      const wall = physics.createGround(V(.13, 2, .04), V(x, 0, .52));
      physics.step(physics.fixedDt);
      const offset = goatOrbitOffset(1, 0, PLAY_CAMERA_PITCH);
      const { view, camera, player } = cameraFixture(physics);
      if (x > 0) expect(physics.raycast(V(), offset, 5)).toBeNull();
      view.updateCamera(0, 1 / 60);
      expect(camera.position.length()).toBeGreaterThan(2.35);
      expect(player.visible).toBe(true);
      const towardsCamera = camera.position.clone().normalize();
      expect(physics.shapeCast(V(), Q(), towardsCamera, new RAPIER.Ball(.25),
        camera.position.length())).toBeNull();
      camera.updateMatrixWorld();
      for (const y of [-.7, .7]) {
        const hoofOrHorn = new THREE.Vector3(0, y, 0).project(camera);
        expect(Math.abs(hoofOrHorn.y)).toBeLessThan(.9);
      }

      physics.removeBody(wall);
      physics.step(physics.fixedDt);
      view.updateCamera(0, .5);
      expect(camera.position.z).toBeGreaterThan(4);
      expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true);
      expect(player.visible).toBe(true);
    } finally {
      physics.dispose();
    }
  });

  it('uses the movement heading on the first frame of a turn and leaves room to look up', async () => {
    const physics = await PhysicsWorld.create();
    try {
      const { view, camera, input } = cameraFixture(physics);
      view.updateCamera(0, 1 / 60);
      const distance = camera.position.length();
      const direction = new THREE.Vector3();
      for (const yaw of [Math.PI / 2, -Math.PI / 2, Math.PI - .01, -Math.PI + .01]) {
        input.yaw = yaw;
        view.updateCamera(0, 1 / 60);
        camera.getWorldDirection(direction).setY(0).normalize();
        expect(direction.x).toBeCloseTo(Math.sin(yaw), 8);
        expect(direction.z).toBeCloseTo(-Math.cos(yaw), 8);
        expect(camera.position.length()).toBeCloseTo(distance, 8);
        expect(camera.position.dot(direction)).toBeLessThan(-3);
      }
      for (const pitch of [clampCameraPitch(-4), clampCameraPitch(4)]) {
        input.pitch = pitch;
        view.updateCamera(0, 1 / 60);
        expect(camera.position.y).toBeGreaterThan(0);
        expect(camera.getWorldDirection(direction).y).toBeCloseTo(-Math.sin(pitch), 8);
      }
    } finally {
      physics.dispose();
    }
  });

  it('keeps the settled chase framing near center and reserves more space on short viewports', () => {
    const desktopLift = goatCameraVerticalOffset(.6, .055, 67, 883);
    const compactLift = goatCameraVerticalOffset(.6, .055, 67, 600);
    expect(desktopLift).toBeLessThan(25);
    expect(compactLift / 600).toBeGreaterThan(desktopLift / 883);
    expect(goatCameraVerticalOffset(1, 1.15, 42, 360)).toBeLessThanOrEqual(36);
  });

  it('leaves room for the build tray at the level spawn angle', () => {
    const viewport = rect(0, 0, 1542, 883);
    const panel = { id: 'hotbar', rect: rect(462, 714, 618, 159) };
    // In the live default shot the unshifted goat extends down to 702px.
    const goat = rect(688, 434, 166, 268);
    const lift = goatCameraVerticalOffset(.6, 0, 67, 883);
    expect(planGoatSafeHud(goat, viewport, [panel], []).hiddenPanels.has('hotbar')).toBe(true);
    expect(planGoatSafeHud({
      ...goat, top: goat.top - lift, bottom: goat.bottom - lift,
    }, viewport, [panel], []).hiddenPanels.has('hotbar')).toBe(false);
  });

  it('does not move the world projection as the rendered goat bounds change', () => {
    const width = 1542, height = 883;
    const camera = new THREE.PerspectiveCamera(67, width / height, .07, 2200);
    const viewport = rect(0, 0, width, height);
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.8, .8, 1));
    root.add(mesh);
    root.position.z = -4;
    const update = vi.fn();
    const view = Object.assign(Object.create(GameView.prototype) as {
      applyCameraFraming(lift: number): void;
      updateCameraFraming(dt: number): void;
      updateHud(): void;
    }, {
      camera, titleCamera: false,
      cameraViewport: new THREE.Vector2(width, height),
      input: { yaw: Math.PI, pitch: .055 },
      currentSettings: { fov: 67 },
      game: { rules: { style: { scale: .6 } } },
      renderer: { domElement: { getBoundingClientRect: () => viewport } },
      characters: { player: { root } },
      hud: { update },
    });
    view.applyCameraFraming(goatCameraVerticalOffset(.6, .055, 67, height, false));
    const projection = camera.projectionMatrix.clone();
    vi.stubGlobal('document', { pointerLockElement: null });
    try {
      view.updateHud();
      const standing = update.mock.lastCall;
      for (const [y, z, visible] of [[-.6, 0, true], [0, 4, true], [0, 0, false]] as const) {
        mesh.position.set(0, y, z);
        root.visible = visible;
        view.updateCameraFraming(1 / 60);
        view.updateHud();
        expect(update.mock.lastCall).toEqual(standing);
        expect(camera.projectionMatrix.equals(projection)).toBe(true);
      }
    } finally {
      mesh.geometry.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('keeps the real sculpt framed and separates visible HUD across desktop viewports and tiers',
    async () => {
      const game = await Game.create({ seed: 'billy-isle', resolution: 97 });
      const characters = new GameCharacters(new THREE.Scene(), game);
      try {
        const yaw = game.goat.locomotion.heading;
        for (const [tier, size] of [['Kid', .6], ['Billy', 1], ['Big', 1.6], ['GIGGA', 3]] as const) {
          game.rules.events.emit('size:changed', { from: 'Kid', to: tier, targetScale: size });
          for (let i = 0; i < 120; i++) game.step();
          expect(game.goat.size).toBe(size);
          characters.update(0, game.physics.alpha);
          const pose = game.goat.torso.translation();
          const target = new THREE.Vector3(pose.x, pose.y + CAMERA_TARGET_HEIGHT * size, pose.z);
          const offset = goatOrbitOffset(size, yaw, PLAY_CAMERA_PITCH);
          const direction = goatViewDirection(yaw, PLAY_CAMERA_PITCH);
          const bounds = visibleGoatBounds(characters.player.root);
          for (const [width, height] of VIEWPORTS) {
            const camera = new THREE.PerspectiveCamera(67, width / height, .07, 2200);
            camera.position.copy(target).add(new THREE.Vector3(offset.x, offset.y, offset.z));
            camera.lookAt(camera.position.clone().add(new THREE.Vector3(direction.x, direction.y, direction.z)));
            const viewport = rect(0, 0, width, height);
            const unframed = projectGoatScreenBox(bounds, camera, viewport, false);
            expect(unframed, `tier ${size} at ${width}x${height}`).not.toBeNull();
            camera.setViewOffset(width, height, 0,
              goatCameraVerticalOffset(size, PLAY_CAMERA_PITCH, camera.fov, height, false), width, height);
            const goat = projectGoatScreenBox(bounds, camera, viewport);
            expect(goat, `tier ${size} at ${width}x${height}`).not.toBeNull();
            const box = goat!;
            expect(box.top, `goat clipped: tier ${size} at ${width}x${height}; original ${unframed!.top.toFixed(1)}..${unframed!.bottom.toFixed(1)}`).toBeGreaterThan(12);
            expect(box.left).toBeGreaterThan(width * .2);
            expect(box.right).toBeLessThan(width * .8);
            const trayWidth = Math.min(560, width * .43);
            const tray = rect((width - trayWidth) / 2, height - 132, trayWidth, 132);
            const layout = planGoatSafeHud(box, viewport, [
              { id: 'combo', rect: rect((width - Math.min(510, width * .31)) / 2,
                12, Math.min(510, width * .31), 166) },
              { id: 'hotbar', rect: tray },
            ], [
              { id: 'board', width: 230, height: 32 },
              { id: 'click', width: 235, height: 32 },
            ]);
            if (rectsIntersect(box, tray)) expect(layout.hiddenPanels.has('hotbar')).toBe(true);
            for (const prompt of layout.prompts.values()) {
              expect(rectsIntersect(box, prompt)).toBe(false);
              expect(rectsIntersect(tray, prompt)).toBe(false);
            }
            if (size === .6) {
              // When both prompts cannot fit, the nearby-gig action takes priority;
              // the pointer-lock hint is optional and must never cover the goat.
              expect(layout.prompts.has('board')).toBe(true);
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
