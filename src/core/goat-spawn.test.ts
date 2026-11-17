import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { forward } from '../physics';
import { heightAt } from '../world';
import { Game } from './Game';
import { GameCharacters } from './GameCharacters';
import {
  CAMERA_TARGET_HEIGHT, SPAWN_CAMERA_PITCH, SPAWN_CAMERA_YAW_OFFSET,
  goatCameraOffset,
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
      const ground = heightAt(game.island, spawn.position.x, spawn.position.z);
      const size = game.goat.size;
      expect(size).toBe(.6);
      // The world spawn is an elevated safe placement marker, not a foot origin.
      expect(spawn.position.y - ground).toBeGreaterThan(1);
      expect(game.goat.torso.translation().y - ground).toBeCloseTo(.92 * size, 4);
      expect(torsoUp(game)).toBeGreaterThan(.99);
      for (let i = 0; i < 120; i++) game.step();
      expect(torsoUp(game)).toBeGreaterThan(.78);
      expect(game.goat.isRagdoll).toBe(false);
      console.log('goat pose after 120 ticks', {
        torso: game.goat.torso.translation(), head: game.goat.head.translation(),
        neck: game.goat.neck.translation(), up: torsoUp(game), pose: game.goat.pose,
      });
      expect(game.goat.head.translation().y).toBeGreaterThan(
        game.goat.torso.translation().y + .05 * size);
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
      camera.lookAt(target);
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
      console.log('opening camera horns', { yaw, offset,
        hornScreens: hornScreens.map(p => ({ x: p.x, y: p.y, z: p.z })) });
      expect(Math.abs(hornScreens[0]!.x - hornScreens[1]!.x)).toBeGreaterThan(.025);
    } finally {
      characters.dispose();
      game.dispose();
    }
  });
});
