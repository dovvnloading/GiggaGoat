import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { forward, RAPIER, V } from '../physics';
import { heightAt } from '../world';
import { Game } from './Game';
import { GameCharacters } from './GameCharacters';
import {
  CAMERA_TARGET_HEIGHT, SPAWN_CAMERA_PITCH, SPAWN_CAMERA_YAW_OFFSET,
  goatCameraLookAhead, goatCameraOffset,
} from './GoatCamera';

const create = (): Promise<Game> => Game.create({ seed: 'billy-isle', resolution: 97 });
const torsoUp = (game: Game): number => {
  const q = game.goat.torso.rotation();
  return 1 - 2 * (q.x * q.x + q.z * q.z);
};

describe('Player spawn pose and approved goat silhouette', () => {
  it('starts the actual KID ragdoll at ground height, stands after settling, and resets on rescue', async () => {
    const game = await create();
    try {
      const spawn = game.island.spawns[0]!;
      const terrain = heightAt(game.island, spawn.position.x, spawn.position.z);
      const ray = new RAPIER.Ray(spawn.position, V(0, -1, 0));
      const hit = Math.min(...[game.colliders.terrain, ...game.colliders.paths]
        .map(collider => collider.castRay(ray, 4, false)).filter(distance => distance >= 0));
      const ground = spawn.position.y - hit;
      const size = game.goat.size;
      expect(size).toBe(.6);
      // The world spawn is an elevated safe placement marker, not a foot origin.
      expect(spawn.position.y - terrain).toBeGreaterThan(1);
      expect(game.goat.torso.translation().y - ground).toBeCloseTo(.92 * size, 4);
      expect(torsoUp(game)).toBeGreaterThan(.99);
      // At spawn the rigid-body head, eyes and horns start above the torso.
      // Subsequent neck/head joint sag is a separate physics-lane defect
      // tracked in the PR; core must not fake physics-bound art transforms.
      expect(game.goat.head.translation().y - game.goat.torso.translation().y)
        .toBeGreaterThan(.2 * size);
      for (let i = 0; i < 120; i++) game.step();
      expect(torsoUp(game)).toBeGreaterThan(.78);
      expect(game.goat.isRagdoll).toBe(false);
      expect(game.goat.torso.translation().y - ground).toBeGreaterThan(.35 * size);

      // A rescue must undo a prior sideways orientation without recreating
      // seven bodies or discarding their six physical joints.
      const handles = game.goat.bodies.map(body => body.handle);
      const half = Math.SQRT1_2;
      game.goat.torso.setRotation({ x: 0, y: 0, z: half, w: half }, true);
      expect(torsoUp(game)).toBeLessThan(.01);
      game.respawn();
      expect(game.goat.bodies.map(body => body.handle)).toEqual(handles);
      expect(game.goat.joints).toHaveLength(6);
      expect(torsoUp(game)).toBeGreaterThan(.99);
      expect(game.goat.torso.translation().y - ground).toBeCloseTo(.92 * size, 4);
    } finally {
      game.dispose();
    }
  });


  it('opens at street-eye height with the goat in the lower third at every size tier', () => {
    const yaw = .35;
    let previousDistance = 0;
    for (const size of [.6, 1, 1.6, 3]) {
      const pivot = new THREE.Vector3(0, CAMERA_TARGET_HEIGHT * size, 0);
      const offset = goatCameraOffset(size, yaw, SPAWN_CAMERA_PITCH);
      const lead = goatCameraLookAhead(size, yaw);
      const camera = new THREE.PerspectiveCamera(67, 16 / 9, .07, 2200);
      camera.position.copy(pivot).add(new THREE.Vector3(offset.x, offset.y, offset.z));
      camera.lookAt(pivot.clone().add(new THREE.Vector3(lead.x, lead.y, lead.z)));
      camera.updateMatrixWorld(true);

      const torso = new THREE.Vector3(0, 0, 0).project(camera);
      // NDC -1 is the bottom of the frame: leave the goat in the lower third,
      // while the flat, eye-level horizon stays near the frame's midpoint.
      expect(torso.y, 'goat too high in frame at size ' + size).toBeLessThan(-.3);
      expect(torso.y, 'goat clipped at size ' + size).toBeGreaterThan(-.75);
      const horizon = camera.position.clone().add(new THREE.Vector3(
        Math.sin(yaw) * 1000, 0, -Math.cos(yaw) * 1000)).project(camera);
      expect(Math.abs(horizon.y), 'horizon at size ' + size).toBeLessThan(.12);

      const distance = Math.hypot(offset.x, offset.z);
      expect(distance).toBeGreaterThan(previousDistance);
      previousDistance = distance;
    }
    // Collision may shorten the orbit: the fallback must re-center the goat.
    const blockedAim = goatCameraLookAhead(.6, yaw, 0);
    expect(Math.hypot(blockedAim.x, blockedAim.y, blockedAim.z)).toBe(0);
  });

  it('frames the real horn, face, scarf and hooves from an opening three-quarter camera', async () => {
    const game = await create();
    const characters = new GameCharacters(new THREE.Scene(), game);
    try {
      characters.update(0, game.physics.alpha);
      const root = characters.player.root;
      const yaw = -game.island.spawns[0]!.heading + SPAWN_CAMERA_YAW_OFFSET;
      const size = game.goat.size;
      const p = game.goat.torso.translation();
      const target = new THREE.Vector3(p.x, p.y + CAMERA_TARGET_HEIGHT * size, p.z);
      const offset = goatCameraOffset(size, yaw, SPAWN_CAMERA_PITCH);
      const camera = new THREE.PerspectiveCamera(67, 16 / 9, .07, 2200);
      camera.position.copy(target).add(new THREE.Vector3(offset.x, offset.y, offset.z));
      const lookAhead = goatCameraLookAhead(size, yaw);
      camera.lookAt(target.clone().add(new THREE.Vector3(
        lookAhead.x, lookAhead.y, lookAhead.z)));
      camera.updateMatrixWorld(true);
      root.updateWorldMatrix(true, true);

      // Camera must face the actual rigid body's -Z axis, not the locomotion
      // heading (the physics lane currently gives these opposite yaw signs).
      const facing = forward(-game.island.spawns[0]!.heading);
      const toCamera = camera.position.clone().sub(target).setY(0).normalize();
      expect(toCamera.dot(new THREE.Vector3(facing.x, 0, facing.z))).toBeGreaterThan(.65);

      const feature = (name: string): THREE.Vector3 => {
        const object = root.getObjectByName(name);
        expect(object, name).toBeDefined();
        const screen = object!.getWorldPosition(new THREE.Vector3()).project(camera);
        expect(screen.x, name + ' horizontal clip').toBeGreaterThan(-.9);
        expect(screen.x, name + ' horizontal clip').toBeLessThan(.9);
        expect(screen.y, name + ' vertical clip').toBeGreaterThan(-.9);
        expect(screen.y, name + ' vertical clip').toBeLessThan(.9);
        expect(screen.z, name + ' camera depth').toBeLessThan(1);
        return screen;
      };
      const head = feature('ragdoll head');
      const hoof = feature('dark split hoof');
      feature('gold horizontal-pupil iris');
      feature('wind-swept scarf ribbon');
      const horn = feature('heavy tapered spiral horn');
      expect(head.y - hoof.y).toBeGreaterThan(.12);
      expect(horn.y).toBeGreaterThan(hoof.y);

      const horns: THREE.Object3D[] = [];
      root.traverse(object => {
        if (object.name === 'heavy tapered spiral horn') horns.push(object);
      });
      expect(horns).toHaveLength(2);
      const hornScreens = horns.map(h =>
        h.getWorldPosition(new THREE.Vector3()).project(camera));
      expect(Math.abs(hornScreens[0]!.x - hornScreens[1]!.x)).toBeGreaterThan(.025);
    } finally {
      characters.dispose();
      game.dispose();
    }
  });
});
