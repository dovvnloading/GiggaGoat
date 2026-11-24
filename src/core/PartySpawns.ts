import type { Collider } from '@dimforge/rapier3d-compat';
import { RAPIER, STANDING_GOAT_RADIUS, V, add, rotate, standingGoatShapes, sub,
  type GoatRagdoll, type GoatSize, type Vec3 } from '../physics';
import { Q, multiplyRotation, uprightRotation } from '../physics/math';
import { heightAt } from '../world';
import type { Point } from '../modes';
import type { Game } from './Game';

type Pose = ReturnType<typeof standingGoatShapes>;
const searchRadius = 10;
const offsets: Point[] = [];
for (let z = -searchRadius; z <= searchRadius; z++) {
  for (let x = -searchRadius; x <= searchRadius; x++) {
    if (Math.hypot(x, z) <= searchRadius) offsets.push({ x, z });
  }
}
// Nearest seats first. Prefer staying on the authored team row for equal distances.
offsets.sort((a, b) => a.x*a.x + a.z*a.z - b.x*b.x - b.z*b.z || Math.abs(a.z) - Math.abs(b.z));

/** Express the existing articulated pose relative to the destination foot-ground point. */
function playerPose(goat: GoatRagdoll, heading?: number): Pose {
  const change = uprightRotation(goat.torso.rotation(), heading);
  return goat.bodies.flatMap(body => Array.from({ length: body.numColliders() }, (_, index) => {
    const collider = body.collider(index);
    const offset = sub(collider.translation(), goat.torso.translation());
    return {
      shape: collider.shape,
      position: add(V(0, .92 * goat.size, 0), change ? rotate(change, offset) : offset),
      rotation: change ? multiplyRotation(change, collider.rotation()) : collider.rotation(),
    };
  }));
}

// Contact with an axis-aligned half-space gives the actual outer extent of
// any Rapier shape in that direction, including rotated limbs and round edges.
function liveBounds(pose: Pose, size: GoatSize) {
  const axes = [V(0, 1, 0), V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1)];
  const planes = axes.map(normal => new RAPIER.HalfSpace(normal));
  let bottom = Infinity;
  let radius = STANDING_GOAT_RADIUS * size;
  for (const part of pose) {
    const extents = planes.map(plane =>
      plane.contactShape(V(), Q(), part.shape, part.position, part.rotation, Infinity)!.distance);
    bottom = Math.min(bottom, extents[0]!);
    const x = Math.max(Math.abs(extents[1]!), Math.abs(extents[2]!));
    const z = Math.max(Math.abs(extents[3]!), Math.abs(extents[4]!));
    radius = Math.max(radius, Math.hypot(x, z));
  }
  return { radius, bottom };
}

/** Plans the whole kickoff against live collision geometry, including before the first step. */
export class PartySpawns {
  private readonly occupied: Array<Point & { radius: number }> = [];
  private readonly supports: Collider[];
  private readonly obstacles: Collider[] = [];

  constructor(private readonly game: Game, starts: Point[]) {
    const world = game.physics.raw;
    world.propagateModifiedBodyPositionsToColliders();
    this.supports = [game.colliders.terrain, ...game.colliders.paths];
    const ignored = new Set(this.supports.map(c => c.handle));
    for (const body of game.goat.bodies) {
      for (let i = 0; i < body.numColliders(); i++) ignored.add(body.collider(i).handle);
    }
    const xs = starts.map(start => start.x), zs = starts.map(start => start.z);
    const left = Math.min(...xs), right = Math.max(...xs);
    const back = Math.min(...zs), front = Math.max(...zs);
    const margin = searchRadius + 3 * Math.max(game.goat.size, .6);
    const region = new RAPIER.Cuboid((right - left) / 2 + margin, game.island.size, (front - back) / 2 + margin);
    const center = V((left + right) / 2, 0, (back + front) / 2);
    const identity = Q();
    world.forEachCollider(c => {
      if (!ignored.has(c.handle) && !c.isSensor() && c.isEnabled() && c.intersectsShape(region, center, identity)) {
        this.obstacles.push(c);
      }
    });
  }

  player(point: Point, heading?: number): Vec3 {
    const goat = this.game.goat;
    const pose = playerPose(goat, heading);
    const { radius, bottom } = liveBounds(pose, goat.size);
    // Keep the current joint angles; even an upside-down or tucked goat enters
    // the arena with the same sole clearance as the standing ragdoll.
    return this.reserve(point, goat.size, pose, radius, .06 * goat.size - bottom);
  }

  bot(point: Point, size: GoatSize, yaw: number): Vec3 {
    return this.reserve(point, size, standingGoatShapes(size, V(), yaw), STANDING_GOAT_RADIUS * size, 0);
  }

  private reserve(point: Point, size: GoatSize, pose: Pose, radius: number, floorOffset: number): Vec3 {
    // Clip the candidate list once per seat. Rapier's step-built broad phase can
    // still be empty when the user starts a party directly from the title menu.
    const extent = searchRadius + 3 * size;
    const region = new RAPIER.Cuboid(extent, this.game.island.size, extent);
    const center = V(point.x, heightAt(this.game.island, point.x, point.z), point.z);
    const identity = Q();
    const nearby = this.obstacles.filter(c => c.intersectsShape(region, center, identity));
    const solids = [...this.supports, ...nearby];
    for (const offset of offsets) {
      const x = point.x + offset.x, z = point.z + offset.z;
      if (this.occupied.some(o => Math.hypot(x - o.x, z - o.z) < radius + o.radius + .12)) continue;
      const foot = this.support(x, z);
      if (!foot) continue;
      foot.y += floorOffset;
      let lift = 0;
      for (const floor of this.supports) {
        for (const part of pose) {
          const hit = floor.contactShape(part.shape, add(foot, part.position), part.rotation, 0);
          if (hit && hit.distance < 0) {
            lift = Math.max(lift, hit.normal1.y > 0 ? -hit.distance / hit.normal1.y : Infinity);
          }
        }
      }
      // Keep the torso inside the planted motor's support range on sloping ground.
      if (lift > .12 * size) continue;
      foot.y += lift;
      if (solids.some(c => pose.some(part => {
        const hit = c.contactShape(part.shape, add(foot, part.position), part.rotation, 0);
        return hit !== null && hit.distance < -.012;
      }))) continue;
      this.occupied.push({ x, z, radius });
      return foot;
    }
    throw new Error('No clear party spawn near the starting area');
  }

  private support(x: number, z: number): Vec3 | null {
    const origin = V(x, heightAt(this.game.island, x, z) + 1.25, z);
    const ray = new RAPIER.Ray(origin, V(0, -1, 0));
    let nearest = Infinity;
    for (const surface of this.supports) {
      const hit = surface.castRayAndGetNormal(ray, 2.5, false);
      if (hit && hit.normal.y >= this.game.goat.locomotion.minWalkingNormalY) {
        nearest = Math.min(nearest, hit.timeOfImpact);
      }
    }
    return Number.isFinite(nearest) ? V(x, origin.y - nearest, z) : null;
  }
}
