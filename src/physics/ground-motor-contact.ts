import type { Collider } from '@dimforge/rapier3d-compat';
import { CollisionLayer } from './CollisionGroups';
import type { GoatRagdoll } from './GoatRagdoll';
import { dot, mul, normalize, sub, V, type Vec3 } from './math';

// Hooves can meet the vertical side of a step while the body walks over it.
// Use the load-bearing upper body for walls and leave foot placement to Rapier.
export function* upperBodyColliders(goat: GoatRagdoll): Generator<Collider> {
  for (const body of [goat.head, goat.neck, goat.torso]) {
    for (let i = 0; i < body.numColliders(); i++) yield body.collider(i);
  }
}

/** Test the solver load under a hoof when a loose prop lifts it above the floor. */
export function hasLoadedPropFooting(goat: GoatRagdoll, minNormalY: number): boolean {
  const world = goat.world.raw;
  return goat.legs.some(leg => {
    const hoof = leg.collider(0);
    let supported = false;
    world.contactPairsWith(hoof, other => {
      const prop = other.parent();
      const layers = other.collisionGroups() >>> 16;
      if (supported || !(layers & CollisionLayer.prop) ||
          !prop?.isDynamic() || prop.handle === goat.interactions.tongueBody?.handle) return;
      world.contactPair(hoof, other, (manifold, flipped) => {
        if (!manifold.numSolverContacts() || manifold.normal().y * (flipped ? 1 : -1) < minNormalY) return;
        const point = manifold.solverContactPoint(0);
        if (!point || point.y >= leg.translation().y || Math.abs(prop.velocityAtPoint(point).y) > .5) return;
        // A speculative contact can have the right normal without carrying any load.
        for (let i = 0; i < manifold.numContacts(); i++) {
          if (manifold.contactImpulse(i) > 0) { supported = true; return; }
        }
      });
    });
    return supported;
  });
}

/** Closest planar velocity that moves along or away from every contact face. */
function slideAlongWalls(target: Vec3, normals: readonly Vec3[]): Vec3 {
  const allowed = (velocity: Vec3) => normals.every(n => dot(velocity, n) >= -1e-7);
  if (allowed(target)) return target;

  // In XZ the closest feasible velocity is either on one wall's tangent
  // or zero at the intersection of two walls. Testing all tangents avoids
  // pushing back into a previous wall at an acute corner.
  let best = V();
  let leastChange = dot(target, target);
  for (const normal of normals) {
    const inward = dot(target, normal);
    const along = sub(target, mul(normal, inward));
    if (inward * inward < leastChange && allowed(along)) {
      best = along;
      leastChange = inward * inward;
    }
  }
  return best;
}

/** Let the gait push loose objects, but don't drive the body into fixed scenery. */
export function groundMotorTarget(goat: GoatRagdoll, target: Vec3): Vec3 {
  if (target.x === 0 && target.z === 0) return target;
  const world = goat.world.raw;
  const normals: Vec3[] = [];
  const minWalkingY = goat.locomotion.minWalkingNormalY;
  for (const part of upperBodyColliders(goat)) {
    world.contactPairsWith(part, other => {
      const obstacle = other.parent();
      if (obstacle && !obstacle.isFixed()) return;
      world.contactPair(part, other, (manifold, flipped) => {
        if (!manifold.numSolverContacts()) return;
        const n = manifold.normal();
        if (Math.abs(n.y) >= minWalkingY) return;
        // Rapier orients the normal from the first manifold collider to the second.
        const outward = normalize(flipped ? V(n.x, 0, n.z) : V(-n.x, 0, -n.z));
        normals.push(outward);
      });
    });
  }
  return slideAlongWalls(target, normals);
}
