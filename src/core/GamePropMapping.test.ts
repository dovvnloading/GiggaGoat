import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PropFactory, BUILD_PIECE_SIZES, DEFAULT_CRATE_SIZE } from '../props';
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
  it('maps the supported world kinds, leaving unrelated world art alone', () => {
    const f = factory();
    const cases = [
      ['crate', 'crate'],
      ['barrel', 'gig-barrel'],
      ['hay-bale', 'gig-hay'],
      ['fence', 'build-wall'],
      ['ramp', 'build-ramp'],
      ['trampoline', 'trampoline'],
    ] as const;
    expect([...WORLD_LIBRARY_KINDS].sort()).toEqual(cases.map(x => x[0]).sort());
    for (const [kind, name] of cases) {
      const root = createWorldLibraryProp(f, {
        kind, size: { x: 3, y: 1, z: 2 },
      });
      expect(root?.userData.propKind).toBe(name);
      expect(root).toBeInstanceOf(THREE.Group);
      expect(root!.scale.x).toBeGreaterThan(0);
      expect(root!.scale.y).toBeGreaterThan(0);
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
      ['iron-banded crate', createWorldLibraryProp(f,
        { kind: 'crate', size: DEFAULT_CRATE_SIZE }), 'crate'],
      ['breakable debris', createDebrisLibraryProp(f, .42), 'crate-debris'],
      ['red trampoline', createSurfaceLibraryProp(f,
        { kind: 'trampoline', halfExtents: { x: 2.1, y: .23, z: 2.1 } }), 'trampoline'],
      ['launch marker', createSurfaceLibraryProp(f,
        { kind: 'launch', halfExtents: { x: 2.1, y: .23, z: 2.1 } }), 'launch'],
      ['gig hay bale', createHeistHayLibraryProp(f), 'gig-hay'],
      ['gig barrel', createWorldLibraryProp(f,
        { kind: 'barrel', size: DEFAULT_CRATE_SIZE }), 'gig-barrel'],
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
