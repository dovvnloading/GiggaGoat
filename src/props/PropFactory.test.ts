import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  PropFactory, BUILD_PIECE_SIZES, GIG_BOARD_SIZE,
  SURFACE_HALF_EXTENTS, LIBRARY_MODELS, getBuildPieceSize,
  getSurfaceFootprint, libraryAssetUrl,
  type BuildPieceType, type Size3,
} from './index';

const model = (): THREE.Object3D => {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 1.7),
    new THREE.MeshStandardMaterial({ color: 0xd39b51 }));
  mesh.name = 'mock-library-model';
  group.add(mesh);
  return group;
};
const load = () => vi.fn(async (_url: string): Promise<THREE.Object3D> => model());
const base = 'https://game.example/GiggaGoat/';

function boundingSize(object: THREE.Object3D): THREE.Vector3 {
  return new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
}

describe('legacy GameView size mapping', () => {
  it('keeps each HAY-BUILD size and ramp orientation in physics units', () => {
    expect(BUILD_PIECE_SIZES).toEqual({
      floor: { x: 2, y: .46, z: 2 },
      wall: { x: .46, y: 2, z: 2 },
      ramp: { x: 2, y: 1.8, z: 2 },
      'launch-pad': { x: 2, y: .46, z: 2 },
    });
    const size = getBuildPieceSize('floor');
    size.x = 99; // callers cannot accidentally mutate the shared size table
    expect(getBuildPieceSize('floor').x).toBe(2);
    expect(getSurfaceFootprint()).toEqual({ x: 4.2, y: .18, z: 4.2 });
    expect(SURFACE_HALF_EXTENTS).toEqual({ x: 2.1, y: .23, z: 2.1 });
    expect(GIG_BOARD_SIZE.x).toBe(3.6);
    expect(GIG_BOARD_SIZE.y).toBe(4.25);
  });

  it('scales fallback and loaded meshes into the same game-sized envelopes', async () => {
    const f = new PropFactory({ loadModel: load(), assetBaseUrl: base });
    const types: BuildPieceType[] = ['floor', 'wall', 'ramp', 'launch-pad'];
    const roots = types.map(type => f.createBuildPiece(type));
    const fallbackSizes = roots.map(boundingSize);
    for (const [i, type] of types.entries()) {
      const size = getBuildPieceSize(type);
      const actual = fallbackSizes[i]!;
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(actual[axis]).toBeLessThanOrEqual(size[axis] + .035);
        expect(actual[axis]).toBeGreaterThan(size[axis] * .8);
      }
    }
    await f.whenReady();
    for (const [i, type] of types.entries()) {
      const nominal = getBuildPieceSize(type);
      const root = roots[i]!;
      expect(root.userData.nominalSize).toEqual(nominal);
      expect(root.userData.assetStatus).toBe('ready');
      const extent = boundingSize(root);
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(extent[axis]).toBeLessThanOrEqual(nominal[axis] + .045);
        expect(extent[axis]).toBeGreaterThan(nominal[axis] * .8);
      }
    }
    f.dispose();
  });

  it('accepts variable gig sizes, and uses marker half-extents rather than full widths', () => {
    const f = new PropFactory({ loadModel: load(), assetBaseUrl: base });
    const size: Size3 = { x: 3, y: 2, z: 1.4 };
    const crate = f.createCrate(size);
    const hay = f.createGigProp({ x: 2, y: 1, z: 1.5 }, 'hay');
    const debris = f.createCrateDebris(.52);
    const trampoline = f.createTrampoline({ x: 3, y: .23, z: 1.8 });
    const launch = f.createLaunchPad();
    expect(crate.userData.nominalSize).toEqual(size);
    expect(hay.userData.nominalSize).toEqual({ x: 2, y: 1, z: 1.5 });
    expect(debris.userData.nominalSize).toEqual({ x: .52, y: .52, z: .52 });
    expect(trampoline.userData.nominalSize).toEqual({ x: 6, y: .18, z: 3.6 });
    expect(launch.userData.nominalSize).toEqual({ x: 4.2, y: .18, z: 4.2 });
    expect(f.createGigBoard().userData.groundAnchored).toBe(true);
    expect(crate.userData.groundAnchored).toBe(false);
    f.dispose();
  });
});

describe('library model loader', () => {
  it('uses app-root URLs, never a relative lab/ URL', () => {
    const url = libraryAssetUrl(LIBRARY_MODELS.crate, base);
    expect(url).toBe(base + 'assets/library/kenney/survival-kit/box-large.glb');
    expect(url).not.toContain('/lab/');
    expect(() => libraryAssetUrl('../secrets', base)).toThrow('Invalid');
  });

  it('shows a fallback synchronously then swaps to distinct clones', async () => {
    const fetch = load();
    const f = new PropFactory({ loadModel: fetch, assetBaseUrl: base });
    const a = f.createCrate();
    const b = f.createCrate();
    expect(a.userData.assetStatus).toBe('loading');
    expect(b.userData.assetStatus).toBe('loading');
    expect(a.children.length).toBeGreaterThan(0);
    await f.whenReady();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a.userData.assetStatus).toBe('ready');
    expect(b.userData.assetStatus).toBe('ready');
    expect(a.getObjectByName('mock-library-model')).toBeInstanceOf(THREE.Mesh);
    expect(b.getObjectByName('mock-library-model')).toBeInstanceOf(THREE.Mesh);
    expect(a.getObjectByName('mock-library-model'))
      .not.toBe(b.getObjectByName('mock-library-model'));
    expect(a.position.equals(new THREE.Vector3())).toBe(true);
    f.dispose();
  });

  it('reuses one spring prototype across markers and a build launch pad', async () => {
    const fetch = load();
    const f = new PropFactory({ loadModel: fetch, assetBaseUrl: base });
    const a = f.createTrampoline();
    const b = f.createLaunchPad();
    const c = f.createBuildPiece('launch-pad');
    f.createGigProp({ x: 1.5, y: 1.5, z: 1.5 }, 'crate');
    f.createCrate();
    await f.whenReady();
    const urls = fetch.mock.calls.map(args => args[0]);
    expect(urls.length).toBe(3); // spring, arrow, large box
    expect(new Set(urls).size).toBe(3);
    expect(urls.filter(url => url.includes('/spring.glb'))).toHaveLength(1);
    const arrowSlot = b.children.find(child => child.name === 'library-slot' &&
      child.userData.assetPath === LIBRARY_MODELS.arrow);
    // Kenney's arrow points up local +Y; launch-pad graphics need it flat in XZ.
    expect(arrowSlot?.children[0]?.children[0]?.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect([a, b, c].every(x => x.userData.assetStatus === 'ready')).toBe(true);
    f.dispose();
  });

  it('caches failures and retains a usable toon fallback', async () => {
    const fetch = vi.fn(async (_url: string): Promise<THREE.Object3D> => {
      throw new Error('not found');
    });
    const f = new PropFactory({ loadModel: fetch, assetBaseUrl: base });
    const a = f.createCrate();
    await f.whenReady();
    expect(a.userData.assetStatus).toBe('fallback');
    expect(boundingSize(a).x).toBeGreaterThan(1);
    f.createCrate();
    await f.whenReady();
    expect(fetch).toHaveBeenCalledTimes(1);
    f.dispose();
    expect(() => f.createCrate()).toThrow('disposed');
  });
});
