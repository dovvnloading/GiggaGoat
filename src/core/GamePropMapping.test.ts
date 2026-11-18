import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { PropFactory, BUILD_PIECE_SIZES, DEFAULT_CRATE_SIZE } from '../props';
import { HEIST_BALE_SIZE, type WorldLibraryPropKind } from '../props/PropFactory';
import { createWorldScene, generateIsland } from '../world';
import * as hoofingtonArt from '../world/visual-hoofington';
import { PROP_LIBRARY_MODELS } from '../world/library-props';
import { fitLibraryModel, isAuthoredLibraryAsset } from '../world/library-fit';
import type { GigPropSpawn } from '../gigs';
import {
  WORLD_LIBRARY_KINDS, createWorldLibraryProp, createBoardLibraryProp,
  createSurfaceLibraryProp, createSpawnLibraryProp, createHeistHayLibraryProp,
  createBuildLibraryProp, createDebrisLibraryProp,
} from './GamePropMapping';

function factory(): PropFactory {
  return new PropFactory({
    assetBaseUrl: 'https://game.example/GiggaGoat/',
    loadModel: async () => {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial()));
      return group;
    },
  });
}

describe('GameView factory prop mapping', () => {
  it('seats the Hoofington launch deck at the bottom of its solid collider', () => {
    const f = factory();
    try {
      const halfExtents = { x: 2.1, y: .23, z: 2.1 };
      const root = createSurfaceLibraryProp(f, { kind: 'launch', halfExtents, artAtGround: true });
      const bounds = new THREE.Box3().setFromObject(root);
      expect(bounds.min.y).toBeCloseTo(-halfExtents.y, 3);
      expect(bounds.max.y).toBeGreaterThan(halfExtents.y);
    } finally { f.dispose(); }
  });

  it('keeps physics-bound props out of both scenery rendering paths', () => {
    const island = generateIsland({ resolution: 65 });
    const source = vi.spyOn(hoofingtonArt, 'buildHoofingtonVisuals');
    const world = createWorldScene(island, { externallyRenderedPropKinds: WORLD_LIBRARY_KINDS });
    try {
      const descriptors = source.mock.calls[0]![0].props;
      expect(descriptors.some(prop => WORLD_LIBRARY_KINDS.has(prop.kind))).toBe(false);
      expect(descriptors.some(prop => prop.kind === 'house')).toBe(true);
      for (const kind of WORLD_LIBRARY_KINDS) {
        expect(world.group.getObjectByName('props-' + kind)).toBeUndefined();
      }
      expect(island.props.some(prop => prop.kind === 'fence' && prop.breakable)).toBe(true);
    } finally {
      world.dispose();
      source.mockRestore();
    }
  });

  it('maps the supported world kinds, leaving unrelated world art alone', () => {
    const f = factory();
    const cases = [
      ['crate', 'world-crate'],
      ['barrel', 'world-barrel'],
      ['hay-bale', 'world-hay-bale'],
      ['fence', 'world-fence'],
      ['ramp', 'world-ramp'],
      ['trampoline', 'world-trampoline'],
    ] as const;
    expect([...WORLD_LIBRARY_KINDS].sort()).toEqual(cases.map(x => x[0]).sort());
    for (const [kind, name] of cases) {
      const root = createWorldLibraryProp(f, {
        kind, size: { x: 3, y: 1, z: 2 },
      });
      expect(root?.userData.propKind).toBe(name);
      expect(root).toBeInstanceOf(THREE.Group);
      expect(root!.scale.toArray()).toEqual([1, 1, 1]);
    }
    expect(createWorldLibraryProp(f, {
      kind: 'tree-pine', size: DEFAULT_CRATE_SIZE,
    })).toBeNull();
    f.dispose();
  });

  it('covers all twelve workshop stations through their GameView call paths', () => {
    const f = factory();
    const cases = [
      ['gig clipboard board', createBoardLibraryProp(f), 'gig-board'],
      ['world crate', createWorldLibraryProp(f,
        { kind: 'crate', size: DEFAULT_CRATE_SIZE }), 'world-crate'],
      ['breakable debris', createDebrisLibraryProp(f, .42), 'crate-debris'],
      ['red trampoline', createSurfaceLibraryProp(f,
        { kind: 'trampoline', halfExtents: { x: 2.1, y: .23, z: 2.1 } }), 'trampoline'],
      ['launch marker', createSurfaceLibraryProp(f,
        { kind: 'launch', halfExtents: { x: 2.1, y: .23, z: 2.1 } }), 'launch'],
      ['Hay Heist bale', createHeistHayLibraryProp(f, 'red'), 'heist-hay'],
      ['world barrel', createWorldLibraryProp(f,
        { kind: 'barrel', size: DEFAULT_CRATE_SIZE }), 'world-barrel'],
      ['gig supplies', createSpawnLibraryProp(f,
        { role: 'parcel', size: DEFAULT_CRATE_SIZE }), 'crate'],
      ['Hay-Build floor', createBuildLibraryProp(f, 'floor'), 'build-floor'],
      ['fence wall', createBuildLibraryProp(f, 'wall'), 'build-wall'],
      ['plank ramp', createBuildLibraryProp(f, 'ramp'), 'build-ramp'],
      ['build launch pad', createBuildLibraryProp(f, 'launch-pad'), 'build-launch-pad'],
    ] as const;
    for (const [station, root, expectedKind] of cases) {
      expect(root?.userData.propKind, station).toBe(expectedKind);
      expect(root, station).toBeInstanceOf(THREE.Group);
      expect(root?.children.length, station).toBeGreaterThan(0);
    }
    const debris = cases[2]![1]!;
    expect(debris.scale.x).toBeCloseTo(.42 / .35);
    expect(cases[8]![1]!.userData.nominalSize).toEqual(BUILD_PIECE_SIZES.floor);
    f.dispose();
  });

  it('keeps each team’s bindings legible on the proxy and the shipped straw roll', async () => {
    const path = PROP_LIBRARY_MODELS['hay-bale'];
    const bytes = await readFile(new URL('../../public/' + path, import.meta.url));
    const { scene } = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
    const loadModel = vi.fn(async () => scene);
    const f = new PropFactory({ loadModel, assetBaseUrl: 'https://game.example/GiggaGoat/' });
    try {
      const red = createHeistHayLibraryProp(f, 'red');
      const blue = createHeistHayLibraryProp(f, 'blue');
      const colors = (root: THREE.Group): number[] => {
        const hex: number[] = [];
        root.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) if (material instanceof THREE.MeshToonMaterial) {
            hex.push(material.color.getHex());
          }
        });
        return hex;
      };
      expect(colors(red).filter(color => color === 0xdd2a49)).toHaveLength(2);
      expect(colors(blue).filter(color => color === 0x117adc)).toHaveLength(2);
      await f.whenReady();
      expect(loadModel).toHaveBeenCalledExactlyOnceWith('https://game.example/GiggaGoat/' + path);
      const redArt = colors(red).filter(color => color !== 0xdd2a49);
      const blueArt = colors(blue).filter(color => color !== 0x117adc);
      expect(redArt.length).toBeGreaterThanOrEqual(4);
      expect(blueArt).toEqual(redArt);
      expect(colors(red)).toContain(0xdd2a49);
      expect(colors(blue)).toContain(0x117adc);
      for (const root of [red, blue]) {
        expect(root.userData.assetStatus).toBe('ready');
        const bounds = new THREE.Box3().setFromObject(root);
        const size = bounds.getSize(new THREE.Vector3());
        expect(size.x).toBeCloseTo(HEIST_BALE_SIZE.x, 4);
        expect(size.z).toBeCloseTo(HEIST_BALE_SIZE.z, 4);
        expect(bounds.min.y).toBeCloseTo(-HEIST_BALE_SIZE.y / 2, 4);
        expect(bounds.max.y).toBeCloseTo(HEIST_BALE_SIZE.y / 2, 4);
      }
    } finally {
      f.dispose();
    }
  });

  it('routes all currently defined gig spawn roles to sized library supplies', () => {
    const f = factory();
    const roles: GigPropSpawn['role'][] = ['parcel', 'gnome', 'tower', 'stack-crate'];
    for (const role of roles) {
      const root = createSpawnLibraryProp(f, { role, size: { x: 2.1, y: .8, z: 1.3 } });
      expect(root.userData.propKind).toBe('crate');
      expect(root.scale.x).toBeCloseTo(2.1 / DEFAULT_CRATE_SIZE.x);
      expect(root.scale.y).toBeCloseTo(.8 / DEFAULT_CRATE_SIZE.y);
    }
    f.dispose();
  });
});

const worldKinds = [
  'crate', 'barrel', 'hay-bale', 'fence', 'ramp', 'trampoline',
] as const satisfies readonly WorldLibraryPropKind[];
const native: Record<WorldLibraryPropKind, [number, number, number]> = {
  crate: [2, 1, 1], barrel: [1, 2, 1], 'hay-bale': [1.8, 1.1, .9],
  fence: [4, 1, .4], ramp: [1.7, .5, 2.2], trampoline: [2, .3, 2],
};
const assetBase = 'https://game.example/GiggaGoat/';

function mockWorldModel(url: string): THREE.Object3D {
  const kind = worldKinds.find(k => url.endsWith(PROP_LIBRARY_MODELS[k]));
  const dims: [number, number, number] = kind ? native[kind]! : [1, 1, 1];
  const root = new THREE.Group();
  // Offset and non-cubic native meshes exercise centroid correction, grounding
  // and the aspect-preserving quarter-turn path.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dims),
    new THREE.MeshStandardMaterial({ color: 0x89b1d5 }));
  mesh.position.set(2, 3, -1);
  root.add(mesh);
  return root;
}

function loadedMesh(root: THREE.Group): THREE.Mesh {
  const mesh = root.getObjectByName('world-library-model');
  expect(mesh).toBeInstanceOf(THREE.Mesh);
  return mesh as THREE.Mesh;
}

describe('world props use World Lab art rather than gig/build toys', () => {
  it('requests the exact World Lab GLB for all six kinds and draws fitted placeholders', async () => {
    const load = vi.fn(async (url: string) => mockWorldModel(url));
    const f = new PropFactory({ loadModel: load, assetBaseUrl: assetBase });
    for (const kind of worldKinds) {
      const root = createWorldLibraryProp(f, {
        kind, color: 0x728f43, size: { x: 3, y: 1.5, z: .9 },
      })!;
      const placeholder = root.children[0]!.children[0] as THREE.Mesh;
      const material = placeholder.material as THREE.MeshToonMaterial;
      expect(material.color.getHex()).toBe(kind === 'fence' ? 0xffffff : 0x728f43);
      expect(material.vertexColors).toBe(kind === 'fence');
      expect(root.userData.assetStatus).toBe('loading');
    }
    await f.whenReady();
    expect(load.mock.calls.map(call => call[0]).sort())
      .toEqual(worldKinds.map(kind => assetBase + PROP_LIBRARY_MODELS[kind]).sort());
    f.dispose();
  });

  it('uses the Lab fit, footprint, floor and paint for every model', async () => {
    const f = new PropFactory({
      loadModel: async url => mockWorldModel(url), assetBaseUrl: assetBase,
    });
    const size = { x: 9.2, y: 1.85, z: .35 };
    const cases = worldKinds.map(kind => {
      const root = createWorldLibraryProp(f, { kind, size, color: 0x8e6739 })!;
      root.position.set(12, 4, -8);
      return { kind, root };
    });
    await f.whenReady();
    for (const { kind, root } of cases) {
      expect(root.userData.assetStatus, kind).toBe('ready');
      expect(root.children[0]!.userData.assetPath).toBe(PROP_LIBRARY_MODELS[kind]);
      const mesh = loadedMesh(root);
      expect(mesh.geometry.getAttribute('color'), kind).toBeDefined();
      const painted = (mesh.material as THREE.MeshToonMaterial).color;
      if (isAuthoredLibraryAsset(PROP_LIBRARY_MODELS[kind])) {
        expect(painted.getHex(), kind).toBe(0xffffff);
      } else {
        const labTint = new THREE.Color(0x8e6739).lerp(new THREE.Color(0xffffff), .82);
        expect(painted.getHex(), kind).toBe(labTint.getHex());
      }
      const bounds = new THREE.Box3().setFromObject(root);
      const span = bounds.getSize(new THREE.Vector3());
      const fit = fitLibraryModel(new THREE.Vector3(...native[kind]!),
        new THREE.Vector3(size.x, size.y, size.z), PROP_LIBRARY_MODELS[kind]);
      const expected = isAuthoredLibraryAsset(PROP_LIBRARY_MODELS[kind])
        ? new THREE.Vector3(size.x, size.y, size.z)
        : new THREE.Vector3(
          (fit.yaw ? native[kind]![2] : native[kind]![0]) * fit.scale.x,
          native[kind]![1] * fit.scale.y,
          (fit.yaw ? native[kind]![0] : native[kind]![2]) * fit.scale.z);
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(Math.abs(span[axis] - expected[axis]), kind + ':' + axis)
          .toBeLessThan(size[axis] * .02);
        expect(span[axis], kind + ':' + axis).toBeLessThanOrEqual(size[axis] * 1.02);
      }
      expect(bounds.min.y, kind).toBeCloseTo(4 - size.y / 2, 5);
      expect(bounds.getCenter(new THREE.Vector3()).x, kind).toBeCloseTo(12, 5);
      expect(bounds.getCenter(new THREE.Vector3()).z, kind).toBeCloseTo(-8, 5);
    }
    const fence = cases.find(item => item.kind === 'fence')!.root;
    expect(fence.userData.propKind).toBe('world-fence');
    expect(fence.getObjectByName('prop-build-wall')).toBeUndefined();
    expect(fence.getObjectByName('prop-wall')).toBeUndefined();
    f.dispose();
  });

  it('fits every Hoofington picket fence on the default island, including yaw', async () => {
    const island = generateIsland();
    const fences = island.props.filter(p => p.poiId === 'hoofington' && p.kind === 'fence');
    expect(fences.length).toBeGreaterThan(3);
    const f = new PropFactory({
      loadModel: async url => mockWorldModel(url), assetBaseUrl: assetBase,
    });
    const roots = fences.map(prop => {
      const root = createWorldLibraryProp(f, prop)!;
      root.position.set(prop.transform.position.x, prop.transform.position.y,
        prop.transform.position.z);
      root.rotation.y = prop.transform.rotationY;
      return root;
    });
    await f.whenReady();
    for (const [i, prop] of fences.entries()) {
      const root = roots[i]!;
      expect(root.userData.assetStatus, prop.id).toBe('ready');
      const bounds = new THREE.Box3().setFromObject(root);
      const span = bounds.getSize(new THREE.Vector3());
      const c = Math.abs(Math.cos(prop.transform.rotationY));
      const s = Math.abs(Math.sin(prop.transform.rotationY));
      const size = {
        x: c * prop.size.x + s * prop.size.z,
        y: prop.size.y,
        z: s * prop.size.x + c * prop.size.z,
      };
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(Math.abs(span[axis] - size[axis]), prop.id + ':' + axis)
          .toBeLessThan(size[axis] * .02);
      }
      expect(bounds.min.y, prop.id)
        .toBeCloseTo(prop.transform.position.y - prop.size.y / 2, 4);
      expect(root.getObjectByName('prop-build-wall'), prop.id).toBeUndefined();
    }
    f.dispose();
  });

  it('keeps a single picket silhouette while the fence model loads or fails', async () => {
    const fail = vi.fn(async (): Promise<THREE.Object3D> => {
      throw new Error('asset unavailable');
    });
    const f = new PropFactory({ loadModel: fail, assetBaseUrl: assetBase });
    const root = createWorldLibraryProp(f, {
      kind: 'fence', size: { x: 9.2, y: 1.85, z: .35 },
    })!;
    const proxy = root.getObjectByName('world-picket-fence');
    expect(proxy).toBeInstanceOf(THREE.Mesh);
    expect((proxy as THREE.Mesh).geometry.getAttribute('position').count).toBeGreaterThan(36);
    await f.whenReady();
    expect(root.userData.assetStatus).toBe('fallback');
    expect(root.getObjectByName('world-picket-fence')).toBe(proxy);
    expect(root.getObjectByName('library-slot')?.children).toHaveLength(1);
    expect(new THREE.Box3().setFromObject(root).isEmpty()).toBe(false);
    f.dispose();
  });
});
