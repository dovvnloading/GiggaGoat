import { readFile } from 'node:fs/promises';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it, vi } from 'vitest';
import { buildRapierColliders } from './colliders';
import { generateIsland } from './island';
import { PROP_LIBRARY_MODELS } from './library-props';
import { createWorldScene } from './render';
import { buildProceduralPropGeometry, buildPropVisuals } from './visual-props';
import { isPinesDeckStilt } from './visual-pines-deck-stilts';
import { meshSurfaceHeight } from './visual-tide-routes';
import type { PropKind } from './types';

function expectFeetOnGround(mesh: THREE.Mesh, baseline: THREE.BufferGeometry,
  ground: (point: THREE.Vector3) => number): number {
  const original = baseline.getAttribute('position');
  const fitted = mesh.geometry.getAttribute('position');
  const bottom = baseline.boundingBox!.min.y;
  const feet = new Set<number>();
  let worstGap = -Infinity;
  for (let i = 0; i < original.count; i++) {
    const x = original.getX(i), y = original.getY(i), z = original.getZ(i);
    expect(fitted.getX(i)).toBe(x);
    expect(fitted.getZ(i)).toBe(z);
    if (y > bottom + .06) expect(fitted.getY(i)).toBe(y);
    if (y > bottom + .0001 || Math.abs(x) < .33 || Math.abs(z) < .33) continue;
    feet.add(Number(x > 0) + 2 * Number(z > 0));
    const point = new THREE.Vector3(x, fitted.getY(i), z).applyMatrix4(mesh.matrix);
    const floor = ground(point);
    expect(point.y - floor, mesh.name + ' sole').toBeLessThan(-.10);
    worstGap = Math.max(worstGap, new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrix).y - floor);
  }
  expect(feet.size).toBe(4);
  return worstGap;
}

it('plants all eight loading-proxy feet in the actual near and far terrain meshes', () => {
  const island = generateIsland({ seed: 'billy-isle' });
  const view = createWorldScene(island);
  const baseline = buildProceduralPropGeometry('deck-stilts');
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const camera = new THREE.PerspectiveCamera(55, 1, .1, 900);
  const props = island.props.filter(isPinesDeckStilt);
  const near = view.chunks.map(chunk => chunk.geometry);
  const floor = (point: THREE.Vector3): number => {
    ray.ray.origin.set(point.x, 50, point.z);
    return ray.intersectObjects(view.chunks, false)[0]!.point.y;
  };
  try {
    expect(props).toHaveLength(2);
    view.group.updateMatrixWorld(true);
    for (const distance of [30, 350]) {
      camera.position.set(-130, distance * .6, -156 + distance);
      camera.lookAt(-130, 5, -156);
      view.updateCulling(camera);
      for (const prop of props) {
        const mesh = view.group.getObjectByName('render-' + prop.id) as THREE.Mesh;
        expect(mesh.visible).toBe(true);
        if (distance === 350) {
          const at = prop.transform.position;
          ray.ray.origin.set(at.x, 50, at.z);
          const hit = ray.intersectObjects(view.chunks, false)[0]!.object;
          expect((hit as THREE.Mesh).geometry).not.toBe(near[view.chunks.indexOf(hit as THREE.Mesh)]);
        }
        expectFeetOnGround(mesh, baseline, floor);
      }
    }
  } finally {
    baseline.dispose();
    view.dispose();
  }
});

it('streams the painted stilts grounded at both LODs and preserves the playable deck collision', async () => {
  await RAPIER.init();
  const island = generateIsland({ seed: 'billy-isle' });
  const pins = island.props.filter(isPinesDeckStilt);
  const decks = island.props.filter(prop => prop.poiId === 'whispering-pines' &&
    prop.kind === 'platform' && prop.id.startsWith('whispering-pines-platform-'));
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const { props: colliders, terrain } = buildRapierColliders(world, island);
  const view = createWorldScene(island);
  const distant = new THREE.PerspectiveCamera(55, 1, .1, 900);
  distant.position.set(-130, 250, 170);
  distant.lookAt(-130, 5, -156);
  view.updateCulling(distant);
  const coarse = meshSurfaceHeight(view.chunks.filter(chunk => chunk.visible).map(chunk => ({
    geometry: chunk.geometry, x: chunk.position.x, z: chunk.position.z,
  })), 1);
  const loader = new GLTFLoader();
  const assets = new Map<string, Awaited<ReturnType<GLTFLoader['loadAsync']>>>();
  for (const kind of ['platform', 'deck-stilts'] as const satisfies readonly PropKind[]) {
    const path = PROP_LIBRARY_MODELS[kind];
    const bytes = await readFile(new URL('../../public/' + path, import.meta.url));
    assets.set(path, await loader.parseAsync(Uint8Array.from(bytes).buffer, ''));
  }
  const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url =>
    assets.get([...assets.keys()].find(path => url.endsWith(path))!)!);
  vi.stubGlobal('document', {});
  const visuals = buildPropVisuals([...pins, ...decks], 96, island, undefined, coarse);
  try {
    const timber = pins.map(prop => visuals.group.getObjectByName('render-' + prop.id) as THREE.Mesh);
    const placeholder = timber.map(mesh => mesh.geometry);
    await vi.waitFor(() => expect(visuals.group.userData['libraryReady']).toBe(true));
    expect(visuals.group.userData['libraryFailed']).toBe(0);
    expect(load).toHaveBeenCalledTimes(2);
    const original = visuals.group.getObjectByName('props-deck-stilts') as THREE.InstancedMesh;
    const platformBatch = visuals.group.getObjectByName('props-platform') as THREE.InstancedMesh;
    expect(visuals.group.getObjectByName('render-near-platform'))
      .toBe(visuals.group.getObjectByName('render-far-platform'));
    const platformMatrix = new THREE.Matrix4();
    const down = { x: 0, y: -1, z: 0 };
    let oldWorst = -Infinity;
    for (const [index, mesh] of timber.entries()) {
      expect(mesh.geometry).not.toBe(placeholder[index]);
      const floor = ({ x, z }: THREE.Vector3): number => {
        const distance = terrain.castRay(new RAPIER.Ray({ x, y: 50, z }, down), 100, false)!;
        return Math.min(50 - distance, coarse(x, z));
      };
      oldWorst = Math.max(oldWorst, expectFeetOnGround(mesh, original.geometry, floor));
      const pin = pins[index]!;
      expect(colliders.has(pin.id)).toBe(false);
      const { x, z } = pin.transform.position;
      const deckIndex = decks.findIndex(prop => prop.transform.position.x === x && prop.transform.position.z === z);
      expect(deckIndex).toBeGreaterThanOrEqual(0);
      const deck = decks[deckIndex]!;
      const physicalDeck = colliders.get(deck.id)!;
      platformBatch.getMatrixAt(deckIndex, platformMatrix);
      const top = platformBatch.geometry.boundingBox!.max.y;
      const visibleDeckY = new THREE.Vector3(0, top, 0).applyMatrix4(platformMatrix).y;
      const collisionY = 50 - physicalDeck.castRay(new RAPIER.Ray({ x, y: 50, z }, down), 100, false)!;
      expect(Math.abs(collisionY - visibleDeckY)).toBeLessThan(.02);
    }
    expect(oldWorst).toBeGreaterThan(3.4);
  } finally {
    visuals.dispose();
    vi.unstubAllGlobals();
    load.mockRestore();
    view.dispose();
    world.free();
  }
});
