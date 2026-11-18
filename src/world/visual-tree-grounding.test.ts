import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it, vi } from 'vitest';
import { Game } from '../core/Game';
import { createWorldScene, hashIsland } from './index';
import { PROP_LIBRARY_MODELS } from './library-props';
import { bakeHoofingtonGeometry, HOOFINGTON_MODELS, makeHoofingtonPlacements } from './visual-hoofington';
import { buildPropVisuals } from './visual-props';
import { treeArtCenterY } from './visual-tree-grounding';
import type { PropDescriptor } from './types';

it('seats the real Hoofington and Pines tree soles against their original terrain', async () => {
  const game = await Game.create({ seed: 'billy-isle', resolution: 193 });
  const { island } = game;
  const originalHash = hashIsland(island);
  const world = createWorldScene(island, { chunkSegments: 32 });
  world.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  const terrain = (x: number, z: number): number => {
    ray.set(new THREE.Vector3(x, 400, z), down);
    return ray.intersectObjects(world.chunks, false)[0]!.point.y;
  };
  const matrix = new THREE.Matrix4();
  const checkSole = (geometry: THREE.BufferGeometry, x: number, z: number,
    pose?: THREE.Matrix4, fallback = false) => {
    const positions = geometry.getAttribute('position');
    const foot: THREE.Vector3[] = [];
    let bottom = Infinity;
    for (let i = 0; i < positions.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(positions, i);
      if (pose) p.applyMatrix4(pose);
      bottom = Math.min(bottom, p.y);
      if (Math.hypot(p.x - x, p.z - z) < .9) foot.push(p);
    }
    const clearance = bottom - terrain(x, z);
    if (fallback) expect(clearance).toBeLessThan(.02);
    else expect(clearance).toBeCloseTo(-.10, 4);
    const gaps = foot.filter(p => p.y <= bottom + .03).map(p => p.y - terrain(p.x, p.z));
    expect(gaps.length).toBeGreaterThan(0);
    expect(Math.max(...gaps)).toBeLessThan(.02);
  };
  // The blue-house grove and the trees by the Pines track in the low sweep.
  const treeSites = [
    ['tree-oak', -96.881, 128.876], ['tree-oak', -101.565, 111.133],
    ['tree-oak', -80.276, 123.713], ['tree-pine', -104.944, -126.346],
    ['tree-pine', -123.845, -139.252], ['tree-pine', -109.994, -141.368],
  ] as const;
  const props = treeSites.map(([kind, x, z]) => island.props.find(prop => {
    const at = prop.transform.position;
    return prop.kind === kind && Math.hypot(at.x - x, at.z - z) < .1;
  })!);
  const load = async (path: string): Promise<THREE.Group> => {
    const bytes = Uint8Array.from(readFileSync('public/' + path)).buffer;
    return (await new GLTFLoader().parseAsync(bytes, '')).scene;
  };
  const fixedColliders = new Map<PropDescriptor, number>();
  const visuals = [] as ReturnType<typeof buildPropVisuals>[];
  try {
    for (const prop of props) {
      const position = prop.transform.position;
      const collider = game.colliders.props.get(prop.id)!;
      fixedColliders.set(prop, collider.translation().y);
      expect(Math.abs(collider.translation().y - collider.halfHeight() - terrain(position.x, position.z)))
        .toBeLessThan(.03);
      // A copy of the normalized model at the original physics pose used to float.
      expect(position.y - .49 * prop.size.y - terrain(position.x, position.z)).toBeGreaterThan(.05);
      const fallback = world.group.getObjectByName('props-' + prop.kind) as THREE.InstancedMesh;
      fallback.getMatrixAt(island.props.filter(entry => entry.kind === prop.kind).indexOf(prop), matrix);
      expect(matrix.elements[13]).toBeCloseTo(position.y, 4);
      checkSole(fallback.geometry, position.x, position.z, matrix, true);
    }

    const oaks = new Map(await Promise.all((['oakA', 'oakB', 'oakC'] as const).map(async model =>
      [model, await load(HOOFINGTON_MODELS[model])] as const)));
    const placements = makeHoofingtonPlacements(island).filter(entry => entry.model.startsWith('oak'));
    expect(new Set(placements.map(entry => entry.model)).size).toBe(3);
    expect(placements.length).toBeGreaterThanOrEqual(6);
    for (const placement of placements) {
      const { x, z } = placement.position;
      const geometry = bakeHoofingtonGeometry([placement], oaks)!;
      try { checkSole(geometry, x, z); } finally { geometry.dispose(); }
    }

    const pine = await load(PROP_LIBRARY_MODELS['tree-pine']);
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url =>
      ({ scene: url.endsWith('/pine.glb') ? pine : oaks.get('oakA')! }) as
        Awaited<ReturnType<GLTFLoader['loadAsync']>>);
    vi.stubGlobal('document', {});
    for (const kind of ['tree-oak', 'tree-pine'] as const) {
      const trees = props.filter(prop => prop.kind === kind);
      const render = buildPropVisuals(trees, 96, island);
      visuals.push(render);
      await vi.waitFor(() => expect(render.group.userData['libraryReady']).toBe(true));
      expect(render.group.userData['libraryFailed']).toBe(0);
      const focus = new THREE.Vector3().copy(trees[0]!.transform.position);
      const planes = Array.from({ length: 6 }, () => new THREE.Plane(new THREE.Vector3(), 1));
      render.updateCulling(focus, new THREE.Frustum(...planes), 200, () => false);
      const near = render.group.getObjectByName('render-near-' + kind) as THREE.InstancedMesh;
      expect(near.count).toBe(trees.length);
      for (const [index, tree] of trees.entries()) {
        const { x, z } = tree.transform.position;
        near.getMatrixAt(index, matrix);
        checkSole(near.geometry, x, z, matrix);
      }
    }
    for (const [prop, y] of fixedColliders) {
      expect(game.colliders.props.get(prop.id)!.translation().y).toBe(y);
    }
    expect(hashIsland(island)).toBe(originalHash);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const render of visuals) {
      const geos = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      render.group.traverse(object => {
        if (object instanceof THREE.Mesh) {
          geos.add(object.geometry);
          materials.add(object.material as THREE.Material);
        }
      });
      render.dispose();
      geos.forEach(geo => geo.dispose());
      materials.forEach(material => material.dispose());
    }
    world.dispose();
    game.dispose();
  }
}, 20000);

it('uses the rendered diagonal while retaining raised tree anchors', () => {
  const terrain = { size: 600, resolution: 2, heights: new Float32Array([0, 2, 4, 0]) };
  const anchor = { x: 0, y: 6.5, z: 0 };
  // Bilinear ground is 1.5m here and the rendered b-c diagonal is 3m.
  expect(treeArtCenterY(terrain, anchor, 10, -.49)).toBeCloseTo(7.8);
  expect(treeArtCenterY(terrain, { ...anchor, y: 10.5 }, 10, -.49)).toBe(10.5);
});
