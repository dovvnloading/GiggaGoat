import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { generateIsland } from './island';
import { buildRapierColliders } from './colliders';
import { DAM_ACCESS_ID, DAM_ACCESS_SUPPORT_ID, DAM_DECK_HEIGHT, getDamPlacement } from './the-dam';
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
      ['bush', 'flower', 'grass-tuft', 'rock'].includes(prop.kind)))
      .toBe(true);
    expect(island.props.find(prop => prop.id === 'the-dam-compat-walkway')?.collidable)
      .toBe(false);
    expect(ids).toContain('the-dam-wall');
    expect(ids).toContain('the-dam-deck');
    expect(ids).toContain('the-dam-control-house');
    expect(ids).toContain('the-dam-pier-4');
    expect(ids).toContain('the-dam-ladder-rung-13');
    expect(descriptors.every(collider => collider.body.type === 'static')).toBe(true);
    expect(descriptors.filter(collider => collider.id.startsWith(DAM_ACCESS_ID) &&
      !collider.id.startsWith(DAM_ACCESS_SUPPORT_ID)).every(collider => collider.shape === 'convex')).toBe(true);

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
    expect(meshes.length).toBe(3); // two masonry batches and the flowing spillways
    expect(meshes.filter(mesh => mesh.castShadow)).toHaveLength(1);
    expect(meshes.filter(mesh => mesh.name.startsWith('Water_Fall_'))).toHaveLength(1);
    expect(prepared.waterfallMaps).toHaveLength(1);
    expect(prepared.waterfallMaps[0]).not.toBe(texture);
    scrollDamWaterfallUVs(prepared.waterfallMaps, 1.5);
    expect(prepared.waterfallMaps[0]!.offset.y).toBeLessThan(-0.5);
    expect(texture.offset.y).toBe(0);
  });

  it('shows the same split front rail in the loaded Dam and its fallback', () => {
    const island = generateIsland({ seed: 'dam-rail', resolution: 65 });
    const source = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: 0xf2c12e });
    const fullRail = new THREE.Mesh(new THREE.BoxGeometry(57.5, .22, .22), paint);
    fullRail.name = 'RailFront_Bar_19.4';
    fullRail.position.set(-1.1, 19.45, 3.75);
    source.add(fullRail);
    const middlePost = new THREE.Mesh(new THREE.BoxGeometry(.30, 1.35, .30), paint);
    middlePost.name = 'RailFront_Post_17';
    middlePost.position.set(14.5, 19.48, 3.75);
    source.add(middlePost);

    const loaded = prepareDamModel(source, island);
    const visuals = buildDamVisuals(island);
    try {
      const fallback = visuals.group.getObjectByName('the-dam-procedural-fallback')!;
      const { position, scale } = getDamPlacement(island);
      const testRail = (model: THREE.Object3D, origin: { x: number; y: number; z: number },
        modelScale: number): void => {
        expect(model.getObjectByName('dam-front-rail')).toBeInstanceOf(THREE.Mesh);
        model.updateWorldMatrix(true, true);
        const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0, modelScale);
        const hitAt = (x: number): number => {
          ray.ray.origin.set(origin.x + x * modelScale,
            origin.y + 19.45 * modelScale, origin.z + 3 * modelScale);
          return ray.intersectObject(model, true).length;
        };
        expect(hitAt(10)).toBeGreaterThan(0);
        expect(hitAt(17.1)).toBeGreaterThan(0);
        for (const x of [13.5, 14.5, 15.5]) expect(hitAt(x)).toBe(0);
      };
      testRail(loaded.group, { x: 0, y: 0, z: 0 }, 1);
      testRail(fallback, position, scale);
    } finally {
      loaded.group.traverse(object => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      paint.dispose();
      visuals.dispose();
    }
  });

  it('keeps a recognizable, collider-aligned Dam visible without the GLB', () => {
    const island = generateIsland({ seed: 'dam-fallback', resolution: 65 });
    const visuals = buildDamVisuals(island);
    try {
      const fallback = visuals.group.getObjectByName('the-dam-procedural-fallback');
      expect(fallback).toBeInstanceOf(THREE.Group);
      expect(fallback?.getObjectByName('dam-fallback-stone'))
        .toBeInstanceOf(THREE.Mesh);
      expect(fallback?.getObjectByName('dam-fallback-house-and-deck'))
        .toBeInstanceOf(THREE.Mesh);
      expect(fallback?.getObjectByName('dam-fallback-spillways'))
        .toBeInstanceOf(THREE.Mesh);
      expect(fallback?.getObjectByName('dam-front-rail')).toBeInstanceOf(THREE.Mesh);
      const access = visuals.group.getObjectByName('dam-board-access-ramp')!;
      expect(access).toBeInstanceOf(THREE.Mesh);
      expect(access.castShadow).toBe(false);
      expect(fallback?.children).toHaveLength(4);
      visuals.group.updateMatrixWorld(true);
      const { position, scale } = getDamPlacement(island);
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0, scale);
      const backRailHits = (localX: number): number => {
        ray.ray.origin.set(position.x + localX * scale,
          position.y + 19.45 * scale, position.z - 4.2 * scale);
        return ray.intersectObject(access, false).length;
      };
      expect(backRailHits(-16)).toBeGreaterThan(0);
      expect(backRailHits(-10)).toBe(0);
      expect(backRailHits(-3)).toBeGreaterThan(0);

      const guardRay = new THREE.Raycaster(
        new THREE.Vector3(position.x - 13 * scale, position.y + 19.7 * scale, position.z - 8.5 * scale),
        new THREE.Vector3(-1, 0, 0), 0, 2 * scale);
      expect(guardRay.intersectObject(access, false)).not.toHaveLength(0);
      expect(fallback?.children.filter(child => (child as THREE.Mesh).castShadow))
        .toHaveLength(1);
    } finally {
      visuals.dispose();
    }
  });

  it('applies current night and flood conditions when the authored Dam water arrives', () => {
    const island = generateIsland({ seed: 'billy-isle', resolution: 65 });
    const { position, scale } = getDamPlacement(island);
    const source = new THREE.Group();
    const foamMaterial = new THREE.MeshStandardMaterial({
      color: 0xd5f2fa, emissive: 0x424b50, emissiveIntensity: 0.5,
    });
    const foam = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), foamMaterial);
    foam.name = 'Water_Foam_0_0';
    foam.position.y = 6;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshStandardMaterial());
    wall.name = 'Wall_Main';
    source.add(foam, wall);
    let completeModelLoad: (() => void) | undefined;
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    const load = vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation((url, onLoad) => {
      if (url.endsWith('/the-dam/the-dam.glb')) completeModelLoad =
        () => onLoad({ scene: source } as Awaited<ReturnType<GLTFLoader['loadAsync']>>);
    });
    const light = new THREE.Vector3(1, 1, 1);
    const dam = buildDamVisuals(island, light);
    try {
      dam.setWaterLevel(position.y + 9 * scale);
      light.set(0.16, 0.20, 0.34);
      dam.refreshWaterLight();
      expect(completeModelLoad).toBeTypeOf('function');
      completeModelLoad!();
      const sculpted = dam.group.getObjectByName('the-dam-model')!;
      const submerged = sculpted.children.find(part => part.userData['damWater'])!;
      const structure = sculpted.children.find(part => part.castShadow)!;
      expect(submerged.visible).toBe(false);
      expect(structure.visible).toBe(true);
      expect(foamMaterial.emissiveIntensity).toBeCloseTo(0.08);

      dam.setWaterLevel(island.seaLevel);
      light.set(1, 1, 1);
      dam.refreshWaterLight();
      expect(submerged.visible).toBe(true);
      expect(foamMaterial.emissiveIntensity).toBe(0.5);
    } finally {
      dam.dispose();
      load.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
