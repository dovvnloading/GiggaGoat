import * as THREE from 'three';
import type { GigPropSpawn } from '../gigs';
import type { PropDescriptor } from '../world';
import { isSodaBarrel } from '../world/types';
import {
  PropFactory, BUILD_PIECE_SIZES, DEFAULT_CRATE_SIZE, SURFACE_HALF_EXTENTS,
  type BuildPieceType, type Size3,
} from '../props';
import type { WorldLibraryPropKind } from '../props/PropFactory';
import type { SurfaceMarker } from './Game';

/** Only world kinds with a corresponding library-backed factory shape are replaced. */
export const WORLD_LIBRARY_KINDS = new Set<PropDescriptor['kind']>([
  'crate', 'barrel', 'hay-bale', 'fence', 'ramp', 'trampoline',
]);

function fitRoot(root: THREE.Group, size: Size3, nominal: Size3): THREE.Group {
  root.scale.set(size.x / nominal.x, size.y / nominal.y, size.z / nominal.z);
  return root;
}

export function createWorldLibraryProp(factory: PropFactory,
  prop: Pick<PropDescriptor, 'kind' | 'size' | 'color'> & { id?: string }): THREE.Group | null {
  if (!WORLD_LIBRARY_KINDS.has(prop.kind)) return null;
  // Timber model rises toward local -Z. The main tread plane runs from
  // 5.48% to 100.31% of its overall fitted height at the two ends.
  const artFit = prop.kind === 'ramp' && prop.id?.startsWith('downtown-bleatsville-ramp-')
    ? { yaw: Math.PI, treadElevations: [.0548, 1.0031] as const } : undefined;
  const root = factory.createWorldProp(prop.kind as WorldLibraryPropKind, prop.size, prop.color,
    artFit);
  if (isSodaBarrel(prop)) factory.addSodaLabel(root, prop.size);
  return root;
}

export function createBoardLibraryProp(factory: PropFactory): THREE.Group {
  return factory.createGigBoard();
}

export function createSurfaceLibraryProp(factory: PropFactory,
  marker: Pick<SurfaceMarker, 'kind' | 'halfExtents' | 'farmSpringboard'>): THREE.Group {
  if (marker.farmSpringboard) return factory.createFarmSpringboard(marker.halfExtents);
  return marker.kind === 'trampoline'
    ? factory.createTrampoline(marker.halfExtents)
    : factory.createLaunchPad(marker.halfExtents);
}

export function createSpawnLibraryProp(factory: PropFactory,
  spawn: Pick<GigPropSpawn, 'role' | 'size'>): THREE.Group {
  if (spawn.role === 'gnome') return factory.createWorldProp('gnome', spawn.size, undefined);
  const root = factory.createGigProp(DEFAULT_CRATE_SIZE, 'crate');
  return fitRoot(root, spawn.size, DEFAULT_CRATE_SIZE);
}

export function createHeistHayLibraryProp(factory: PropFactory, teamId: string): THREE.Group {
  return factory.createHeistBale(teamId === 'red' ? 'red' : 'blue');
}

export function createBuildLibraryProp(factory: PropFactory,
  type: BuildPieceType): THREE.Group {
  return factory.createBuildPiece(type);
}

/** Scale the shared debris root to the physics-derived radius, avoiding per-chunk meshes. */
export function createDebrisLibraryProp(factory: PropFactory, radius: number): THREE.Group {
  return fitRoot(factory.createCrateDebris(), { x: radius, y: radius, z: radius },
    { x: .35, y: .35, z: .35 });
}
