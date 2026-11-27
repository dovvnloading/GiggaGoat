import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, it, vi } from 'vitest';
import { Game } from '../core/Game';
import { createWorldScene, hashIsland } from './index';
import { PROP_LIBRARY_MODELS } from './library-props';
import { makeDowntownPlacements } from './visual-downtown';
import { bakeHoofingtonGeometry, HOOFINGTON_MODELS, makeHoofingtonPlacements } from './visual-hoofington';
import { buildPropVisuals } from './visual-props';
import { roundOakArtCenterY, treeArtCenterY } from './visual-tree-grounding';
import type { PropDescriptor } from './types';

it('seats the real Hoofington, Downtown and Pines tree soles against their terrain', async () => {
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
    options: { pose?: THREE.Matrix4; fallback?: boolean; roundOak?: boolean } = {}) => {
    const positions = geometry.getAttribute('position');
    const foot: THREE.Vector3[] = [];
    let bottom = Infinity;
    for (let i = 0; i < positions.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(positions, i);
      if (options.pose) p.applyMatrix4(options.pose);
      bottom = Math.min(bottom, p.y);
      if (options.roundOak || Math.hypot(p.x - x, p.z - z) < .9) foot.push(p);
    }
    const clearance = bottom - terrain(x, z);
    if (options.fallback) expect(clearance).toBeLessThan(.02);
    else if (options.roundOak) expect(clearance).toBeLessThanOrEqual(-.0999);
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
      checkSole(fallback.geometry, position.x, position.z, { pose: matrix, fallback: true });
    }

    const oaks = new Map(await Promise.all((['oakA', 'oakB', 'oakC'] as const).map(async model =>
      [model, await load(HOOFINGTON_MODELS[model])] as const)));
    for (const oak of oaks.values()) {
      let bark: THREE.BufferGeometry | undefined;
      oak.traverse(object => {
        if (object instanceof THREE.Mesh && !Array.isArray(object.material) && object.material.name === 'Bark')
          bark = object.geometry;
      });
      const positions = bark!.getAttribute('position');
      const vertices = Array.from({ length: positions.count }, (_, i) =>
        new THREE.Vector3().fromBufferAttribute(positions, i));
      const bottom = Math.min(...vertices.map(vertex => vertex.y));
      const tips = vertices.filter(vertex => Math.hypot(vertex.x, vertex.z) > .58);
      expect(new Set(tips.map(tip => tip.toArray().join(','))).size).toBe(3);
      expect(Math.max(...tips.map(tip => tip.y))).toBeCloseTo(bottom, 5);
      expect(vertices.some(vertex => vertex.y === bottom &&
        Math.hypot(vertex.x, vertex.z) > .33 && Math.hypot(vertex.x, vertex.z) < .36)).toBe(true);

      const bounds = new THREE.Box3().setFromObject(oak);
      const size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
      for (const vertex of vertices.filter(vertex => vertex.y <= .21)) {
        expect(Math.hypot((vertex.x - centre.x) * .98 / size.x,
          (vertex.z - centre.z) * .98 / size.z)).toBeLessThan(.20);
      }
    }
    const placements = [...makeHoofingtonPlacements(island), ...makeDowntownPlacements(island)]
      .flatMap(entry => entry.model === 'oakA' || entry.model === 'oakB' || entry.model === 'oakC'
        ? [{ ...entry, model: entry.model }] : []);
    expect(new Set(placements.map(entry => entry.model)).size).toBe(3);
    expect(placements.length).toBeGreaterThanOrEqual(12);
    for (const placement of placements) {
      const { x, z } = placement.position;
      const geometry = bakeHoofingtonGeometry([placement], oaks)!;
      try { checkSole(geometry, x, z, { roundOak: true }); } finally { geometry.dispose(); }
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
      const draws = render.group.children.filter((mesh): mesh is THREE.InstancedMesh =>
        mesh instanceof THREE.InstancedMesh && mesh.visible &&
        (mesh.name === 'render-near-' + kind || mesh.name.startsWith('habitat-')));
      const visited = new Set<string>();
      for (const draw of draws) for (let i = 0; i < draw.count; i++) {
        draw.getMatrixAt(i, matrix);
        const tree = trees.find(p => Math.hypot(p.transform.position.x - matrix.elements[12],
          p.transform.position.z - matrix.elements[14]) < .001)!;
        expect(visited.has(tree.id)).toBe(false);
        visited.add(tree.id);
        checkSole(draw.geometry, tree.transform.position.x, tree.transform.position.z,
          { pose: matrix, roundOak: draw.name === 'render-near-tree-oak' });
      }
      expect(visited.size).toBe(trees.length);
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

it('seats the oak sole on the downhill side of its footprint', () => {
  const terrain = { size: 600, resolution: 2, heights: new Float32Array([0, 150, 0, 150]) };
  const size = { x: 10, y: 10, z: 8 };
  const anchor = { x: 0, y: 80, z: 0 };
  const centre = roundOakArtCenterY(terrain, anchor, size);
  // Two metres downhill on the quarter-grade slope drops the soil by half a metre.
  expect(centre - .49 * size.y).toBeCloseTo(74.4);
  expect(roundOakArtCenterY(terrain, { ...anchor, y: 83 }, size)).toBe(83);
});
