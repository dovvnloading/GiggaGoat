import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildRapierColliders, createWorldScene, generateIsland, heightAt } from './index';
import type { PropDescriptor } from './types';
import { ART_BOOKMARKS } from './viewer/bookmarks';
import { paintingAssetUrl } from './viewer/reference-art';

function floorOf(prop: PropDescriptor): number {
  return prop.transform.position.y - prop.size.y / 2;
}
function topOf(prop: PropDescriptor): number {
  return prop.transform.position.y + prop.size.y / 2;
}

/** All four corners of a rotated attraction must be supported by a single deck. */
function footprintOnDeck(prop: PropDescriptor, deck: PropDescriptor, epsilon: number): boolean {
  const angle = prop.transform.rotationY;
  const c = Math.cos(angle), s = Math.sin(angle);
  const p = prop.transform.position, d = deck.transform.position;
  return [-1, 1].every(sx => [-1, 1].every(sz => {
    const localX = sx * prop.size.x / 2, localZ = sz * prop.size.z / 2;
    const x = p.x + c * localX + s * localZ;
    const z = p.z - s * localX + c * localZ;
    return Math.abs(x - d.x) < deck.size.x / 2 - epsilon &&
      Math.abs(z - d.z) < deck.size.z / 2 - epsilon;
  }));
}

describe('Baa-ardwalk approved painting / shore-to-pier regression', () => {
  it('joins sandy land to the sea with overlapping, walkable wooden platforms', () => {
    for (const seed of ['billy-isle', 'shore-check', 'other-coast']) {
      for (const size of [400, 600, 850]) {
        const island = generateIsland({ seed, size, resolution: 97 });
        const scale = size / 600;
        const props = island.props.filter(p => p.poiId === 'baa-ardwalk');
        const pier = props.find(p => p.kind === 'pier')!;
        const head = props.find(p => p.kind === 'deck')!;
        expect(pier, seed).toBeDefined();
        expect(head, seed).toBeDefined();
        expect(pier.collidable && pier.climbable).toBe(true);
        expect(head.collidable && head.climbable).toBe(true);
        const nearShore = pier.transform.position.z - pier.size.z / 2;
        const pierEnd = pier.transform.position.z + pier.size.z / 2;
        const headStart = head.transform.position.z - head.size.z / 2;
        const farSea = head.transform.position.z + head.size.z / 2;
        const dryHeight = heightAt(island, pier.transform.position.x, nearShore);
        expect(dryHeight, seed).toBeGreaterThan(0.5 * scale);
        expect(topOf(pier) - dryHeight, seed).toBeGreaterThan(0);
        expect(topOf(pier) - dryHeight, seed).toBeLessThan(1.2 * scale);
        expect(heightAt(island, head.transform.position.x, farSea), seed)
          .toBeLessThan(0);
        expect(headStart, seed).toBeLessThan(pierEnd);
        expect(headStart, seed).toBeGreaterThan(nearShore);
        expect(Math.abs(topOf(head) - topOf(pier)), seed).toBeLessThan(0.08 * scale);
        expect(farSea - nearShore, seed).toBeGreaterThan(100 * scale);
        const colliders = new Set(island.colliders
          .filter(c => c.shape !== 'heightfield').map(c => c.id));
        expect(colliders.has(pier.id)).toBe(true);
        expect(colliders.has(head.id)).toBe(true);
      }
    }
  });

  it('supports every candy-coloured stall and the complete ferris wheel on deck', () => {
    for (const seed of ['billy-isle', 'art-deck-A', 'art-deck-B']) {
      const island = generateIsland({ seed, resolution: 193 });
      const props = island.props.filter(p => p.poiId === 'baa-ardwalk');
      const pier = props.find(p => p.kind === 'pier')!;
      const head = props.find(p => p.kind === 'deck')!;
      const shops = props.filter(p => p.kind === 'booth');
      const wheels = props.filter(p => p.kind === 'ferris-wheel');
      expect(shops).toHaveLength(5);
      expect(wheels).toHaveLength(1);
      for (const stall of shops) {
        expect(footprintOnDeck(stall, pier, 0.05), stall.id).toBe(true);
        expect(Math.abs(floorOf(stall) - topOf(pier)), stall.id).toBeLessThan(0.05);
        // Guards against the earlier grading pass moving stalls back onto sand.
        expect(floorOf(stall), stall.id)
          .toBeGreaterThan(heightAt(island, stall.transform.position.x,
            stall.transform.position.z) + 0.3);
      }
      const wheel = wheels[0]!;
      expect(footprintOnDeck(wheel, head, 0.1)).toBe(true);
      expect(Math.abs(floorOf(wheel) - topOf(head))).toBeLessThan(0.05);
      expect(wheel.transform.position.z).toBeGreaterThan(
        shops[shops.length - 1]!.transform.position.z + 15);
      for (const kind of ['awning', 'signboard', 'bunting', 'lamp', 'pier-rail']) {
        expect(props.some(p => p.kind === kind), kind).toBe(true);
      }
      expect(props.filter(p => p.kind === 'pier-rail').length).toBeGreaterThan(20);
      expect(props.filter(p => p.kind === 'bunting')
        .every(p => !p.collidable && floorOf(p) > topOf(pier) + 5)).toBe(true);
      expect(props.filter(p => p.kind === 'scaffold')
        .some(p => floorOf(p) < 0 && topOf(p) < topOf(pier) + 8)).toBe(true);
    }
  });

  it('has visible planking and rail meshes and a resolvable original painting', () => {
    for (const bookmark of ART_BOOKMARKS) {
      expect(() => paintingAssetUrl(bookmark.image), bookmark.image).not.toThrow();
      expect(paintingAssetUrl(bookmark.image)).toBeTruthy();
    }
    const boardwalkCamera = ART_BOOKMARKS.find(b => b.id === '09')!;
    expect(boardwalkCamera.camera.z).toBeLessThan(boardwalkCamera.target.z);
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const visuals = createWorldScene(island);
    for (const kind of ['pier', 'deck', 'pier-rail', 'ferris-wheel', 'bunting']) {
      const mesh = visuals.group.getObjectByName('props-' + kind);
      expect(mesh, kind).toBeInstanceOf(THREE.InstancedMesh);
      expect((mesh as THREE.InstancedMesh).count, kind).toBeGreaterThan(0);
    }
    visuals.dispose();
  });

  it('lets a simulated goat-sized ball land on the wheel platform above seawater', async () => {
    await RAPIER.init();
    const island = generateIsland({ seed: 'billy-isle', resolution: 97 });
    const head = island.props.find(p => p.poiId === 'baa-ardwalk' && p.kind === 'deck')!;
    const targetY = topOf(head);
    const x = head.transform.position.x + 13, z = head.transform.position.z - 3;
    expect(heightAt(island, x, z)).toBeLessThan(targetY - 2);
    const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    buildRapierColliders(physics, island);
    const ball = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, targetY + 7, z));
    physics.createCollider(RAPIER.ColliderDesc.ball(0.6).setRestitution(0), ball);
    for (let i = 0; i < 150; i++) physics.step();
    expect(Math.abs(ball.translation().y - (targetY + 0.6))).toBeLessThan(0.22);
    physics.free();
  });
});
