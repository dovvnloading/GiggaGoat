import RAPIER from '@dimforge/rapier3d-compat';
import type {
  ColliderBuild, ColliderDescriptor, IslandData, PropColliderDescriptor, PropDescriptor,
} from './types';
import { makeDamColliderDescriptors } from './the-dam';
import { makeGradedBridgeColliders, makeLocalStreets } from './roads';
import { roadRibbonData } from './road-ribbons';
import { hoofingtonVergeData } from './hoofington-verge';
import { accessSlabs } from './access-path';
import { BOARDWALK_SHORE_GUARD_ID, BOARDWALK_SHORE_ID, boardwalkShoreEntry,
  boardwalkWheelSupports } from './boardwalk';
import { pinesLogEntryColliders } from './pines-log-access';
import { LIGHTHOUSE_ACCESS_GUARD_ID, LIGHTHOUSE_ACCESS_ID, keeperCottagePierColliders, lighthouseAccess,
  lighthouseFoundationDepth, lighthouseGuards, lighthouseModelY, lighthouseUpperColliders } from './lighthouse-access';
import { gridSample } from './terrain';
import siloMesh from './silo-collision.json';

function siloCollider(prop: PropDescriptor): PropColliderDescriptor {
  // Same centred fit as the sourced district mesh. Preserve the wall facets,
  // raised bands, pipe, ladder and roof as a single continuous contact surface.
  const { size } = prop;
  const scale = [size.x * .96, size.y * .98, size.z * .96];
  const vertices = Float32Array.from(siloMesh.positions, (n, i) => n / siloMesh.units * scale[i % 3]!);
  return { id: prop.id, shape: 'trimesh', transform: prop.transform, size, body: prop.body,
    vertices, indices: Uint32Array.from(siloMesh.triangles) };
}

function hull(prop: PropDescriptor): Float32Array {
  const { x, y, z } = prop.size;
  if (prop.kind === 'ramp') {
    // A genuine sloping, climbable six-vertex wedge (low end at local -Z).
    return new Float32Array([
      -x / 2, -y / 2, -z / 2,  x / 2, -y / 2, -z / 2,
      -x / 2, -y / 2, z / 2,   x / 2, -y / 2, z / 2,
      -x / 2, y / 2, z / 2,    x / 2, y / 2, z / 2,
    ]);
  }
  // Rock: irregular faceted boulder, never a deceptively huge axis-aligned cube.
  return new Float32Array([
    -x * 0.5, -y * 0.4, -z * 0.35,
     x * 0.45, -y * 0.48, -z * 0.42,
    -x * 0.46, -y * 0.45, z * 0.39,
     x * 0.45, -y * 0.38, z * 0.43,
    -x * 0.25, y * 0.39, -z * 0.29,
     x * 0.27, y * 0.47, -z * 0.2,
    -x * 0.31, y * 0.31, z * 0.27,
     x * 0.19, y * 0.49, z * 0.23,
  ]);
}

type CavePoint = readonly [x: number, y: number, z: number];
type CaveBlock = readonly [part: string, min: CavePoint, max: CavePoint];

// The sea cave's visible jambs, liners and lintel in makeSeaCave. Y here is
// measured from the descriptor centre (the renderer starts at its floor).
const SEA_CAVE_BLOCKS: readonly CaveBlock[] = [
  ['left-jamb', [-.51, -.5, -.535], [-.31, .22, .535]],
  ['right-jamb', [.31, -.5, -.535], [.51, .22, .535]],
  ['left-liner', [-.335, -.47, -.43], [-.265, .15, .07]],
  ['right-liner', [.265, -.47, -.43], [.335, .15, .07]],
  ['lintel', [-.54, .18, -.56], [.54, .50, .56]],
];

// Solid rockDark blocks measured in cave-arch.glb. The rough perimeter
// stones and hanging lantern can overhang these structural cores.
const MOUNTAIN_CAVE_BLOCKS: readonly CaveBlock[] = [
  ['left-jamb', [-5.06, 0, -3.05], [-2.86, 6.4, 2.05]],
  ['right-jamb', [2.86, 0, -3.05], [5.06, 6.4, 2.05]],
  ['lintel', [-5.225, 6.6, -2.75], [5.225, 8, 2.35]],
];

function fitMountainCavePoint([x, y, z]: CavePoint): CavePoint {
  // Match bakeLibraryPropGeometry's centred 98% fit, including the
  // lantern at +Z in the source bounds.
  return [x * .98 / 11, (y - 4.005) * .98 / 8.01, (z - .385) * .98 / 6.87];
}

function caveArchColliders(prop: PropDescriptor): PropColliderDescriptor[] {
  const { position, rotationY } = prop.transform;
  const { size } = prop;
  const cos = Math.cos(rotationY), sin = Math.sin(rotationY);
  const mountain = prop.poiId === 'mt-gigga';
  const blocks = mountain ? MOUNTAIN_CAVE_BLOCKS : SEA_CAVE_BLOCKS;
  return blocks.map(([part, low, high]) => {
    const min = mountain ? fitMountainCavePoint(low) : low;
    const max = mountain ? fitMountainCavePoint(high) : high;
    const x = (min[0] + max[0]) * size.x / 2;
    const y = (min[1] + max[1]) * size.y / 2;
    const z = (min[2] + max[2]) * size.z / 2;
    return {
      id: prop.id + '-' + part, shape: 'cuboid', body: prop.body,
      transform: {
        position: { x: position.x + cos * x + sin * z, y: position.y + y,
          z: position.z - sin * x + cos * z },
        rotationY,
      },
      size: { x: (max[0] - min[0]) * size.x, y: (max[1] - min[1]) * size.y,
        z: (max[2] - min[2]) * size.z },
    };
  });
}

/** Plain geometry for the Rapier adapter and for debugging/integration. */
export function makeColliderDescriptors(island: IslandData): ColliderDescriptor[] {
  const n = island.resolution;
  // Rapier's heightfield buffer is column-major; the public height grid is row-major.
  const rapierHeights = new Float32Array(n * n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    rapierHeights[x * n + z] = island.heights[z * n + x]!;
  }
  const colliders: ColliderDescriptor[] = [{
    shape: 'heightfield', rows: n - 1, cols: n - 1, heights: rapierHeights,
    scale: { x: island.size, y: 1, z: island.size },
    position: { x: 0, y: 0, z: 0 },
  }];
  const bridgeDecks = makeGradedBridgeColliders(island);
  for (const deck of roadRibbonData(island, 'road').pavedBridgeDecks) bridgeDecks.set(deck.id, deck);
  for (const prop of island.props) {
    if (prop.kind === 'ferris-wheel' && prop.poiId === 'baa-ardwalk') {
      colliders.push(...boardwalkWheelSupports(prop));
      continue;
    }
    if (!prop.collidable) continue;
    if (prop.kind === 'silo' && prop.poiId === 'hoofington') {
      colliders.push(siloCollider(prop));
      continue;
    }
    const bridgeDeck = bridgeDecks.get(prop.id);
    if (bridgeDeck) {
      colliders.push(bridgeDeck);
      continue;
    }
    const shape = prop.kind === 'ramp' ? 'convex' : prop.shape;
    const size = { ...prop.size };
    if (prop.kind === 'tree-pine' || prop.kind === 'tree-oak') {
      size.x = Math.min(1.8, prop.size.x * 0.4);
      size.z = size.x;
    } else if (prop.kind === 'lamp') {
      size.x = Math.min(0.76, prop.size.x);
      size.z = size.x;
    }
    let transform = prop.transform;
    if (prop.kind === 'lighthouse') {
      const depth = lighthouseFoundationDepth(island, prop);
      const floor = transform.position.y - size.y / 2 - depth;
      const top = lighthouseModelY(prop, 1.08);
      size.y = top - floor;
      transform = {
        ...transform,
        position: { ...transform.position, y: (floor + top) / 2 },
      };
      const path = lighthouseAccess(prop, (x, z) => gridSample(island, x, z));
      const scale = island.size / 600;
      colliders.push(...lighthouseUpperColliders(prop), ...accessSlabs(LIGHTHOUSE_ACCESS_ID, path, .27 * scale),
        ...lighthouseGuards(path, scale).flatMap((guard, index) =>
          accessSlabs(LIGHTHOUSE_ACCESS_GUARD_ID + index + '-', guard, 1.22 * scale)));
    }
    if (prop.kind === 'cottage' && prop.poiId === 'old-lighthouse') {
      colliders.push(...keeperCottagePierColliders(island, prop));
    }
    if (prop.kind === 'cave-mouth') {
      // The jambs and lintel leave the centre open all the way to the existing back wall.
      colliders.push(...caveArchColliders(prop));
      size.x = prop.size.x * 0.65;
      size.y = prop.size.y * 0.72;
      size.z = prop.size.z * 0.12;
      const offset = -prop.size.z * 0.40;
      transform = {
        position: {
          x: prop.transform.position.x + Math.sin(prop.transform.rotationY) * offset,
          y: prop.transform.position.y - prop.size.y * 0.06,
          z: prop.transform.position.z + Math.cos(prop.transform.rotationY) * offset,
        },
        rotationY: prop.transform.rotationY,
      };
    }
    if (prop.kind === 'log-bridge' && prop.poiId === 'whispering-pines') {
      colliders.push(...pinesLogEntryColliders(island, prop));
    }
    const collider: PropColliderDescriptor = {
      id: prop.id, shape, transform, size, body: prop.body,
      ...(prop.restitution === undefined ? {} : { restitution: prop.restitution }),
      ...(shape === 'convex' ? { vertices: hull(prop) } : {}),
    };
    colliders.push(collider);
  }
  const boardwalkEntry = boardwalkShoreEntry(island);
  if (boardwalkEntry) {
    const { sections, guards, thickness, piles, scale } = boardwalkEntry;
    colliders.push(...accessSlabs(BOARDWALK_SHORE_ID + 'deck-', sections, thickness),
      ...guards.flatMap((guard, index) => accessSlabs(BOARDWALK_SHORE_GUARD_ID + index + '-', guard, 1.22 * scale)),
      ...piles);
  }
  colliders.push(...makeDamColliderDescriptors(island));
  return colliders;
}

export function addRapierPropCollider(world: RAPIER.World,
  { props, bodies }: Pick<ColliderBuild, 'props' | 'bodies'>, collider: PropColliderDescriptor): void {
  let desc: RAPIER.ColliderDesc;
  if (collider.shape === 'cuboid') {
    desc = RAPIER.ColliderDesc.cuboid(
      collider.size.x / 2, collider.size.y / 2, collider.size.z / 2);
  } else if (collider.shape === 'cylinder') {
    desc = RAPIER.ColliderDesc.cylinder(
      collider.size.y / 2, Math.max(collider.size.x, collider.size.z) / 2);
  } else if (collider.shape === 'trimesh') {
    desc = RAPIER.ColliderDesc.trimesh(collider.vertices!, collider.indices!, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
  } else {
    const hullDesc = RAPIER.ColliderDesc.convexHull(collider.vertices!);
    if (!hullDesc) throw new Error('Invalid convex collider for ' + collider.id);
    desc = hullDesc;
  }
  const { position, rotationY, rotationX = 0 } = collider.transform;
  const sinYaw = Math.sin(rotationY / 2), cosYaw = Math.cos(rotationY / 2);
  const sinPitch = Math.sin(rotationX / 2), cosPitch = Math.cos(rotationX / 2);
  const rotation = rotationX === 0 ? { x: 0, y: sinYaw, z: 0, w: cosYaw } : {
    x: cosYaw * sinPitch, y: sinYaw * cosPitch,
    z: -sinYaw * sinPitch, w: cosYaw * cosPitch,
  };
  desc.setFriction(0.78).setRestitution(collider.restitution ?? 0.12);
  if (collider.restitution !== undefined) desc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);
  let result: RAPIER.Collider;
  if (collider.body.type === 'dynamic') {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z)
        .setRotation(rotation).setLinearDamping(0.2).setAngularDamping(0.32),
    );
    desc.setMass(collider.body.mass);
    result = world.createCollider(desc, body);
    bodies.set(collider.id, body);
  } else {
    desc.setTranslation(position.x, position.y, position.z).setRotation(rotation);
    result = world.createCollider(desc);
  }
  props.set(collider.id, result);
}

/** Call after await RAPIER.init(). No WebGL, DOM, or renderer is required. */
export function buildRapierColliders(world: RAPIER.World, island: IslandData): ColliderBuild {
  const first = island.colliders[0];
  if (!first || first.shape !== 'heightfield') throw new Error('Island has no terrain collider');
  const terrain = world.createCollider(
    RAPIER.ColliderDesc.heightfield(first.rows, first.cols, first.heights, first.scale)
      .setTranslation(first.position.x, first.position.y, first.position.z)
      .setFriction(0.92),
  );
  const paths: RAPIER.Collider[] = [];
  const addPath = (positions: number[], supportIndices: number[]): void => {
    paths.push(world.createCollider(RAPIER.ColliderDesc.trimesh(
      new Float32Array(positions), new Uint32Array(supportIndices),
      RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES | RAPIER.TriMeshFlags.DELETE_DEGENERATE_TRIANGLES,
    ).setFriction(0.92)));
  };
  for (const type of ['road', 'trail'] as const) {
    const { positions, supportIndices } = roadRibbonData(island, type);
    if (supportIndices.length > 0) addPath(positions, supportIndices);
  }
  const street = makeLocalStreets(island).find(road => road.from === 'hoofington')!;
  const verge = hoofingtonVergeData(island, street);
  addPath(verge.positions, verge.supportIndices);
  const props = new Map<string, RAPIER.Collider>();
  const bodies = new Map<string, RAPIER.RigidBody>();
  for (const collider of island.colliders) {
    if (collider.shape !== 'heightfield') addRapierPropCollider(world, { props, bodies }, collider);
  }
  return { terrain, paths, props, bodies };
}
