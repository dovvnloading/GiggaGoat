import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { generateIsland } from './island';
import { buildRapierColliders } from './colliders';
import { DAM_DECK_HEIGHT, getDamPlacement } from './the-dam';
import { buildDamVisuals, prepareDamModel, scrollDamWaterfallUVs } from './visual-dam';
import type { PropColliderDescriptor } from './types';

describe('The Dam hero POI', () => {
  it('builds solid deck, wall, piers, house and ladder footholds in headless Rapier', async () => {
    await RAPIER.init();
    const island = generateIsland({ seed: 'dam-rapier', resolution: 65 });
    const origin = getDamPlacement(island);
    const descriptors = island.colliders.filter((collider): collider is PropColliderDescriptor =>
      collider.shape !== 'heightfield' && collider.id.startsWith('the-dam-'));
    const ids = new Set(descriptors.map(collider => collider.id));
    const damProps = island.props.filter(prop => prop.poiId === 'the-dam');
    expect(damProps.some(prop => prop.id === 'the-dam-compat-walkway')).toBe(true);
    expect(damProps.every(prop => prop.id === 'the-dam-compat-walkway' ||
      prop.kind === 'bush' || prop.kind === 'flower' || prop.kind === 'grass-tuft'))
      .toBe(true);
    expect(island.props.find(prop => prop.id === 'the-dam-compat-walkway')?.collidable)
      .toBe(false);
    expect(ids).toContain('the-dam-wall');
    expect(ids).toContain('the-dam-deck');
    expect(ids).toContain('the-dam-control-house');
    expect(ids).toContain('the-dam-pier-4');
    expect(ids).toContain('the-dam-ladder-rung-13');
    expect(descriptors.every(collider => collider.shape === 'cuboid' &&
      collider.body.type === 'static')).toBe(true);

    const deck = descriptors.find(collider => collider.id === 'the-dam-deck')!;
    const deckTop = deck.transform.position.y + deck.size.y / 2;
    expect(deckTop).toBeCloseTo(origin.position.y + DAM_DECK_HEIGHT * origin.scale, 5);
    expect(deck.size.x).toBeCloseTo(60 * origin.scale, 5);
    expect(deck.transform.position.z).toBeCloseTo(origin.position.z, 5);

    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      const built = buildRapierColliders(world, island);
      for (const id of ids) expect(built.props.has(id)).toBe(true);
      const ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(
        origin.position.x, deckTop + 8, origin.position.z));
      world.createCollider(RAPIER.ColliderDesc.ball(0.5), ball);
      for (let i = 0; i < 220; i++) world.step();
      expect(ball.translation().y).toBeCloseTo(deckTop + 0.5, 1);
    } finally {
      world.free();
    }
  });

  it('batches static GLB meshes, isolates flowing UVs and casts shadows only from structure', () => {
    const island = generateIsland({ seed: 'dam-mesh', resolution: 65 });
    const root = new THREE.Group();
    const masonry = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
    const texture = new THREE.Texture();
    const water = new THREE.MeshStandardMaterial({ map: texture, transparent: true });
    const add = (name: string, material: THREE.Material): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
      mesh.name = name;
      root.add(mesh);
    };
    add('Wall_Main', masonry);
    add('ControlHouse_Walls', masonry);
    add('Pipe_Right', masonry);
    add('Water_Fall_0', water);
    add('Water_Fall_1', water);
    add('Water_Reservoir', water);
    const prepared = prepareDamModel(root, island);
    const meshes = prepared.group.children.filter((child): child is THREE.Mesh =>
      child instanceof THREE.Mesh);
    expect(meshes.length).toBe(4); // two masonry batches + waterfall + reservoir
    expect(meshes.filter(mesh => mesh.castShadow)).toHaveLength(1);
    expect(meshes.filter(mesh => mesh.name.startsWith('Water_Fall_'))).toHaveLength(1);
    expect(prepared.waterfallMaps).toHaveLength(1);
    expect(prepared.waterfallMaps[0]).not.toBe(texture);
    scrollDamWaterfallUVs(prepared.waterfallMaps, 1.5);
    expect(prepared.waterfallMaps[0]!.offset.y).toBeLessThan(-0.5);
    expect(texture.offset.y).toBe(0);
  });

  it('keeps a recognizable, collider-aligned Dam visible without the GLB', () => {
    const island = generateIsland({ seed: 'dam-fallback', resolution: 65 });
    const visuals = buildDamVisuals(island);
    try {
      const fallback = visuals.group.getObjectByName('the-dam-procedural-fallback');
      expect(fallback).toBeInstanceOf(THREE.Group);
      expect(fallback?.getObjectByName('dam-fallback-stone'))
        .toBeInstanceOf(THREE.Mesh);
      expect(fallback?.getObjectByName('dam-fallback-house'))
        .toBeInstanceOf(THREE.Mesh);
      expect(fallback?.getObjectByName('dam-fallback-spillways'))
        .toBeInstanceOf(THREE.Mesh);
      expect(fallback?.children).toHaveLength(4);
      expect(fallback?.children.filter(child => (child as THREE.Mesh).castShadow))
        .toHaveLength(1);
    } finally {
      visuals.dispose();
    }
  });
});
