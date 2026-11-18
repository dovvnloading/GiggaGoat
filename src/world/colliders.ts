import RAPIER from '@dimforge/rapier3d-compat';
import type {
  ColliderBuild, ColliderDescriptor, IslandData, PropColliderDescriptor, PropDescriptor,
} from './types';
import { makeDamColliderDescriptors } from './the-dam';
import { makeLighthouseBridgeColliders } from './roads';

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
  const bridgeDecks = makeLighthouseBridgeColliders(island);
  for (const prop of island.props) {
    if (!prop.collidable) continue;
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
    // Cave entrances are open arches: the solid primitive is their recessed back wall,
    // not a box sealing the passage. The visual rock pillars form the side boundaries.
    let transform = prop.transform;
    if (prop.kind === 'cave-mouth') {
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
    const collider: PropColliderDescriptor = {
      id: prop.id, shape, transform, size, body: prop.body,
      ...(shape === 'convex' ? { vertices: hull(prop) } : {}),
    };
    colliders.push(collider);
  }
  colliders.push(...makeDamColliderDescriptors(island));
  return colliders;
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
  const props = new Map<string, RAPIER.Collider>();
  const bodies = new Map<string, RAPIER.RigidBody>();
  for (const collider of island.colliders) {
    if (collider.shape === 'heightfield') continue;
    let desc: RAPIER.ColliderDesc;
    if (collider.shape === 'cuboid') {
      desc = RAPIER.ColliderDesc.cuboid(
        collider.size.x / 2, collider.size.y / 2, collider.size.z / 2);
    } else if (collider.shape === 'cylinder') {
      desc = RAPIER.ColliderDesc.cylinder(
        collider.size.y / 2, Math.max(collider.size.x, collider.size.z) / 2);
    } else {
      const hullDesc = RAPIER.ColliderDesc.convexHull(collider.vertices!);
      if (!hullDesc) throw new Error('Invalid convex collider for ' + collider.id);
      desc = hullDesc;
    }
    const { position, rotationY } = collider.transform;
    const rotation = { x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) };
    desc.setFriction(0.78).setRestitution(0.12);
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
  return { terrain, props, bodies };
}
