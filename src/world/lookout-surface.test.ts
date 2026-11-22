import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Game } from '../core/Game';
import { generateIsland } from './island';
import { heightAt } from './island';
import { kitPreview } from './kit-preview';
import { bakeLibraryPropGeometry, PROP_LIBRARY_MODELS } from './library-props';
import { createWorldScene } from './render';
import collision from './lookout-collision.json';
import type { PropDescriptor } from './types';

async function lookoutGeometry(): Promise<THREE.BufferGeometry> {
  const bytes = readFileSync('public/' + PROP_LIBRARY_MODELS.lookout);
  const model = (await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '')).scene;
  return bakeLibraryPropGeometry('lookout', model)!;
}

function fittedMesh(geometry: THREE.BufferGeometry, prop: PropDescriptor): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const { position, rotationY } = prop.transform;
  mesh.position.set(position.x, position.y, position.z);
  mesh.rotation.y = rotationY;
  mesh.scale.set(prop.size.x, prop.size.y, prop.size.z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe('Pines lookout visual deck', () => {
  it('uses one visible deck while retaining the walkable support', async () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const lookout = island.props.find(p => p.poiId === 'whispering-pines' && p.kind === 'lookout')!;
    const deck = island.props.find(p => p.poiId === 'whispering-pines' && p.kind === 'platform' &&
      p.id.startsWith('detail-'))!;
    const scene = createWorldScene(island);
    const tower = fittedMesh(await lookoutGeometry(), lookout);
    const fallback = fittedMesh(kitPreview('lookout', lookout.size), lookout);
    try {
      const batch = scene.group.getObjectByName('props-platform') as THREE.InstancedMesh;
      const platforms = island.props.filter(p => p.kind === 'platform' && !p.id.startsWith('the-dam-compat-'));
      const index = platforms.findIndex(p => p.id === deck.id);
      expect(index).toBeGreaterThanOrEqual(0);
      const matrix = new THREE.Matrix4();
      batch.getMatrixAt(index, matrix);
      expect(matrix.getMaxScaleOnAxis()).toBe(0);
      const other = platforms.findIndex(p => p.id !== deck.id);
      batch.getMatrixAt(other, matrix);
      expect(matrix.getMaxScaleOnAxis()).toBeGreaterThan(0);
      expect(island.colliders.some(collider => 'id' in collider && collider.id === deck.id)).toBe(true);
      const top = deck.transform.position.y + deck.size.y / 2;
      const ray = new THREE.Raycaster(new THREE.Vector3(deck.transform.position.x, top + 1,
        deck.transform.position.z), new THREE.Vector3(0, -1, 0));
      expect(Math.abs(ray.intersectObject(tower)[0]!.point.y - top)).toBeLessThan(.15);
      expect(Math.abs(ray.intersectObject(fallback)[0]!.point.y - top)).toBeLessThan(.02);
    } finally {
      scene.dispose();
      tower.geometry.dispose(); (tower.material as THREE.Material).dispose();
      fallback.geometry.dispose(); (fallback.material as THREE.Material).dispose();
    }
  });

  it('keeps the collision mesh aligned to the authored lookout triangles', async () => {
    const geometry = await lookoutGeometry();
    try {
      const positions = geometry.getAttribute('position');
      expect(collision.triangles).toHaveLength(positions.count);
      for (let i = 0; i < positions.count; i++) {
        const index = collision.triangles[i]! * 3;
        for (const [axis, value] of [positions.getX(i), positions.getY(i), positions.getZ(i)].entries()) {
          expect(Math.abs(collision.positions[index + axis]! / collision.units - value)).toBeLessThan(.00002);
        }
      }
    } finally { geometry.dispose(); }
  });

  it('supports a goat on the actual lookout deck', async () => {
    const game = await Game.create({ seed: 'billy-isle', resolution: 97 });
    try {
      const deck = game.island.props.find(p => p.poiId === 'whispering-pines' && p.kind === 'platform' &&
        p.id.startsWith('detail-'))!;
      const { x, y, z } = deck.transform.position;
      const top = y + deck.size.y / 2;
      game.teleport({ x, y: top, z }, 0);
      for (let tick = 0; tick < 90; tick++) game.step();
      expect(game.goat.locomotion.grounded).toBe(true);
      expect(game.goat.isRagdoll).toBe(false);
      expect(game.goat.torso.translation().y).toBeCloseTo(top + .92 * game.goat.size, 0);
      expect(Math.hypot(game.goat.torso.translation().x - x, game.goat.torso.translation().z - z)).toBeLessThan(1);
    } finally { game.dispose(); }
  });

  it.each([
    { seed: 'billy-isle', resolution: 193 },
    { seed: 'pines-alt', resolution: 97 },
  ])('climbs onto the deck with normal game stamina ($seed)', async options => {
    const game = await Game.create(options);
    try {
      const tower = game.island.props.find(p => p.poiId === 'whispering-pines' && p.kind === 'lookout')!;
      const deck = game.island.props.find(p => p.poiId === 'whispering-pines' && p.kind === 'platform' && p.id.startsWith('detail-'))!;
      const ladder = game.colliders.props.get(tower.id + '-ladder')!;
      const { x, z } = tower.transform.position;
      const startZ = z + 6;
      game.teleport({ x, y: heightAt(game.island, x, startZ), z: startZ }, 0);
      for (let tick = 0; tick < 90; tick++) game.step();
      const top = deck.transform.position.y + deck.size.y / 2;
      let peak = 0, climbed = false;
      for (let tick = 0; tick < 900; tick++) {
        game.step({ moveZ: 1, cameraYaw: 0 });
        peak = Math.max(peak, game.goat.torso.translation().y);
        climbed ||= game.goat.locomotion.climbSurface?.collider.handle === ladder.handle;
        if (game.goat.locomotion.grounded && game.goat.torso.translation().y > top + .3) break;
      }
      expect(climbed).toBe(true);
      expect(peak).toBeGreaterThan(top + .3);
      expect(game.goat.locomotion.grounded).toBe(true);
      expect(game.goat.torso.translation().y).toBeGreaterThan(top + .3);
      expect(game.goat.isRagdoll).toBe(false);
      expect(game.rules.abilities.stamina).toBeGreaterThan(0);
      expect(game.rules.abilities.stamina).toBeLessThan(100);
    } finally { game.dispose(); }
  }, 60_000);
});
