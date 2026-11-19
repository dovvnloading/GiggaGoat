import * as THREE from 'three';
import { climbStep } from '../physics/climb-gait';
import type { PhysicsWorld, RayHit } from '../physics';
import type { GoatRagdoll } from '../physics';
import { GROUND_QUERY_GROUPS, RAPIER } from '../physics';
import type { GoatVariant } from './rigged';
import { HIP_BONES } from './skinned-ragdoll-pose';

interface RigLeg {
  hip: THREE.Bone;
  knee: THREE.Bone;
  toe: THREE.Bone;
  sole: THREE.Vector3;
  toeOffset: THREE.Vector3;
  hipAnimation: THREE.Quaternion;
  kneeAnimation: THREE.Quaternion;
  foothold: THREE.Vector3;
  wallTarget: THREE.Vector3;
  planted: boolean;
  supportHandle?: number;
}

type Contact = Pick<RayHit, 'point' | 'normal'> & Partial<Pick<RayHit, 'collider'>>;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = { x: 0, y: -1, z: 0 };
const UPRIGHT = { x: 0, y: 0, z: 0, w: 1 };
const TROT_PHASE = [0, .5, .5, 0] as const;
const GALLOP_PHASE = [0, .13, .52, .65] as const;

/** Retarget the animated leg chains to footholds and airborne poses after the mixer. */
export class SkinnedLegPose {
  private weight = 0;
  private phase = 0;
  private stride = 0;
  private airWeight = 0;
  private fallSpeed = 0;
  private landing = 0;
  private landingTime = 0;
  private groundedGait = false;
  private applied = false;
  private readonly planePoint = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly down = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly hoofContact = new RAPIER.Cylinder(.01, .055);
  private readonly wallRoot = new THREE.Vector3();
  private readonly wallRayOrigin = new THREE.Vector3();
  private readonly wallRayDir = new THREE.Vector3();
  private readonly hip = new THREE.Vector3();
  private readonly knee = new THREE.Vector3();
  private readonly sole = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly kneeGoal = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private readonly delta = new THREE.Quaternion();
  private readonly neckAnimation = new THREE.Quaternion();
  private readonly bodyLean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -.20);

  private constructor(private readonly legs: RigLeg[], private readonly neck: THREE.Bone | null) {}

  static create(model: THREE.Group, variant: GoatVariant,
    soles: readonly (readonly [number, number])[]): SkinnedLegPose | null {
    const legs: RigLeg[] = [];
    model.updateWorldMatrix(true, true);
    for (const [i, name] of HIP_BONES[variant].entries()) {
      const hip = model.getObjectByName(name);
      if (!(hip instanceof THREE.Bone)) return null;
      const chain: THREE.Bone[] = [hip];
      for (let child = hip.children.find(b => b instanceof THREE.Bone);
        child instanceof THREE.Bone; child = child.children.find(b => b instanceof THREE.Bone)) chain.push(child);
      if (chain.length < 3) return null;
      const toe = chain[chain.length - 1]!;
      const [x, z] = soles[i]!;
      const sole = new THREE.Vector3(x, 0, z);
      const toeOffset = toe.worldToLocal(model.localToWorld(sole.clone()));
      const kneeHeight = model.worldToLocal(hip.getWorldPosition(new THREE.Vector3())).y * .53;
      const height = (bone: THREE.Bone) => model.worldToLocal(bone.getWorldPosition(new THREE.Vector3())).y;
      const knee = chain.slice(1, -1).reduce((best, bone) =>
        Math.abs(height(bone) - kneeHeight) < Math.abs(height(best) - kneeHeight) ? bone : best);
      legs.push({ hip, knee, toe, sole, toeOffset, hipAnimation: new THREE.Quaternion(),
        kneeAnimation: new THREE.Quaternion(), foothold: new THREE.Vector3(), wallTarget: new THREE.Vector3(), planted: false });
    }
    const neck = model.getObjectByName(variant === 'hero' ? 'joint_17' : 'neck_01');
    return new SkinnedLegPose(legs, neck instanceof THREE.Bone ? neck : null);
  }

  restore(): void {
    if (!this.applied) return;
    for (const leg of this.legs) {
      leg.hip.quaternion.copy(leg.hipAnimation);
      leg.knee.quaternion.copy(leg.kneeAnimation);
    }
    if (this.neck) this.neck.quaternion.copy(this.neckAnimation);
    this.applied = false;
  }

  reset(): void {
    this.restore();
    this.weight = 0;
    this.airWeight = this.fallSpeed = this.landing = 0;
    this.groundedGait = false;
    for (const leg of this.legs) leg.planted = false;
  }

  applyClimb(model: THREE.Group, torso: { x: number; y: number; z: number },
    wall: Contact | null, phase: number, size: number, dt: number, world?: PhysicsWorld): void {
    if (wall && this.groundedGait) {
      for (const leg of this.legs) leg.planted = false;
      this.groundedGait = false;
    }
    const entering = this.weight === 0;
    this.weight = dt === 0 ? Number(!!wall) : THREE.MathUtils.clamp(this.weight + (wall ? 8 : -8) * dt, 0, 1);
    if (!this.weight) return;
    if (wall) {
      if (entering || dt === 0) this.normal.copy(wall.normal);
      else this.normal.lerp(wall.normal, -Math.expm1(-18 * dt)).normalize();
      this.planePoint.copy(wall.point);
      this.phase = phase;
    }
    this.down.copy(UP).negate().addScaledVector(this.normal, this.normal.y).normalize();
    this.right.crossVectors(this.normal, this.down);
    this.rotation.setFromRotationMatrix(this.basis.makeBasis(this.right, this.normal, this.down)).multiply(this.bodyLean);
    this.origin.copy(torso).sub(this.planePoint);
    const distance = this.origin.dot(this.normal);
    this.origin.copy(torso).addScaledVector(this.normal, -distance);
    this.wallRayDir.copy(this.normal).negate();
    let recessed = 0;
    for (const [i, leg] of this.legs.entries()) {
      const step = climbStep(this.phase, i === 1 || i === 2);
      const target = leg.wallTarget.copy(this.origin).addScaledVector(this.right, leg.sole.x * size)
        .addScaledVector(this.down, (leg.sole.z + step.down) * size);
      this.wallRayOrigin.copy(target).addScaledVector(this.normal, .8 * size);
      // The torso can grip a drainpipe while the hooves straddle it and
      // bear on a separate piece of the silo. Probe the world at each foot.
      const surface = wall && world?.raycast(this.wallRayOrigin, this.wallRayDir, 1.6 * size, {
        groups: GROUND_QUERY_GROUPS,
        predicate: c => c.handle === wall.collider?.handle || !c.parent()?.isDynamic(),
      });
      let supported = !!surface || !world;
      let depth = surface ? .8 * size - surface.distance : 0;
      let support = surface?.collider.handle;
      // On a narrow pole a forward probe can pass either side of the grip.
      // Reach sideways to the real pole instead of planting in empty air.
      const edge = wall?.collider && (!surface || depth < -.25 * size)
        ? wall.collider.projectPoint(target, false) : null;
      if (edge && target.distanceToSquared(edge.point) < (.38 * size) ** 2) {
        depth = this.direction.subVectors(edge.point, target).dot(this.normal);
        target.copy(edge.point);
        support = wall?.collider?.handle;
        supported = true;
      } else target.addScaledVector(this.normal, depth);
      target.addScaledVector(this.normal, (.028 + step.lift) * size);
      const plant = !!wall && step.lift === 0 && supported;
      if (plant) {
        if (!leg.planted || leg.supportHandle !== support ||
            leg.foothold.distanceToSquared(target) > (.48 * size) ** 2) leg.foothold.copy(target);
        leg.supportHandle = support;
        target.copy(leg.foothold);
      }
      leg.planted = plant;
      recessed = Math.min(recessed, Math.max(-.28 * size, depth));
    }
    // A raised band may support one pair while the other pair bears on the
    // recessed silo wall. Carry the hips within reach of both pairs and
    // damp only changes in wall depth, preserving vertical climbing travel.
    this.target.copy(this.origin).addScaledVector(this.normal, recessed - .19 * size);
    if (!entering && dt > 0) {
      const previousDepth = this.wallRoot.sub(this.target).dot(this.normal);
      this.target.addScaledVector(this.normal, previousDepth * Math.exp(-14 * dt));
    }
    this.wallRoot.copy(this.target);
    model.position.lerp(this.target, this.weight);
    model.quaternion.slerp(this.rotation, this.weight);
    model.updateWorldMatrix(true, true);
    this.applied = true;
    if (this.neck) {
      this.neckAnimation.copy(this.neck.quaternion);
      this.delta.setFromAxisAngle(this.right, -.43);
      this.rotateBone(this.neck);
    }
    for (const [i, leg] of this.legs.entries()) {
      this.target.copy(leg.wallTarget);
      leg.hipAnimation.copy(leg.hip.quaternion);
      leg.kneeAnimation.copy(leg.knee.quaternion);
      this.solve(leg, i < 2);
      // At a pipe edge the articulated toe can sweep sideways over a proud
      // seam even when its intended end point clears it. Check the solved
      // sole there before presenting the frame.
      if (wall && world && !leg.planted && this.weight === 1) {
        leg.toe.localToWorld(this.sole.copy(leg.toeOffset));
        this.wallRayOrigin.copy(this.sole).addScaledVector(this.normal, .55 * size);
        const obstacle = world.raycast(this.wallRayOrigin, this.wallRayDir, .55 * size, {
          groups: GROUND_QUERY_GROUPS, predicate: c => c.handle === wall.collider?.handle || !c.parent()?.isDynamic(),
        });
        if (obstacle && this.normal.dot(obstacle.normal) > .4) {
          this.target.copy(this.sole).addScaledVector(this.normal, .58 * size - obstacle.distance);
          this.solve(leg, i < 2);
        }
      }
    }
  }

  /** The body's trajectory comes from Rapier. Solve the visible hooves in
   * model space during flight and against the support plane during stance. */
  applyLocomotion(model: THREE.Group, goat: GoatRagdoll, dt: number, vy: number, glide: boolean): void {
    if (this.weight > 0) {
      this.airWeight = this.fallSpeed = this.landing = 0;
      this.groundedGait = false;
      return;
    }
    const loco = goat.locomotion, size = goat.size, velocity = goat.torso.linvel();
    const flight = !loco.grounded && goat.pose === 'jumpTuck';
    const speed = Math.hypot(velocity.x, velocity.z);
    const stride = goat.pose === 'walk' || goat.pose === 'gallop';
    const floor = loco.groundHit;
    if (flight) {
      this.airWeight = Math.min(1, this.airWeight + dt * 16);
      this.fallSpeed = Math.max(this.fallSpeed, -velocity.y / Math.sqrt(size));
      this.landing = 0;
    } else if (loco.grounded && this.airWeight > 0) {
      this.landing = THREE.MathUtils.smoothstep(this.fallSpeed, .8, 4);
      this.landingTime = 0;
      this.airWeight = this.fallSpeed = 0;
    }
    this.landingTime += dt;
    const t = Math.min(1, this.landingTime / .24);
    const compress = this.landing * Math.sin(Math.PI * t) * (1 - t);
    if (!flight && (!floor || floor.normal.y < .65 || (!stride && compress < .001))) {
      this.groundedGait = false;
      return;
    }
    const gathered = (1 - THREE.MathUtils.smoothstep(vy, .34, .95)) * THREE.MathUtils.smoothstep(vy, -.82, -.16);
    const tuck = glide ? .45 : loco.isFlipping ? 1 : gathered * (loco.jumpedFromSupport ? 1 : .4);
    const reach = THREE.MathUtils.smoothstep(-vy, .08, .75);
    const gallop = goat.pose === 'gallop';
    const length = gallop ? 1.95 : 1.50;
    const stance = gallop ? .34 : .52;
    // At low speed shorten the step, rather than blending a planted hoof back
    // into the baked leg swing. The latter pulls it through its own support.
    const stepAmount = THREE.MathUtils.smoothstep(speed / size ** .16, 0, 2.0);
    const weight = flight ? this.airWeight : 1;
    if (flight) {
      this.target.set(0, .92 * size, 0).applyQuaternion(model.quaternion);
      model.position.add(this.target);
      model.rotateX(this.airWeight * (.24 * THREE.MathUtils.clamp(vy, -1, 1)));
      model.position.sub(this.target.set(0, .92 * size, 0).applyQuaternion(model.quaternion));
    } else if (floor) {
      const n = floor.normal, p = floor.point;
      const floorY = p.y - ((model.position.x - p.x) * n.x + (model.position.z - p.z) * n.z) / n.y;
      // Follow the support's bank while keeping some of the body's physical
      // lean. On a sharp turn the outside hip otherwise lifts beyond reach.
      this.direction.copy(UP).applyQuaternion(model.quaternion);
      this.delta.setFromUnitVectors(this.direction, this.normal.copy(n).normalize());
      model.quaternion.premultiply(this.rotation.identity().slerp(this.delta, .65));
      // The outer legs also travel when the body pivots around a planted foot.
      const turnSpeed = Math.min(8, Math.abs(goat.torso.angvel().y)) * .38 * size;
      this.stride = (this.stride + dt * (speed + turnSpeed) / (length * size)) % 1;
      // Flex the supporting legs enough to reach ahead of the shoulder or
      // behind the hip without straightening the knee and skidding.
      const stanceFlex = stride ? (gallop ? .19 : .10) * stepAmount : 0;
      model.position.y = floorY + size * (.005 - stanceFlex - compress * .27);
    }
    model.updateWorldMatrix(true, true);
    this.applied = true;
    if (this.neck) this.neckAnimation.copy(this.neck.quaternion);
    this.down.set(0, 0, 1).applyQuaternion(model.quaternion);
    for (const [i, leg] of this.legs.entries()) {
      const fore = i < 2;
      leg.hipAnimation.copy(leg.hip.quaternion);
      leg.kneeAnimation.copy(leg.knee.quaternion);
      this.target.copy(leg.sole);
      if (flight) {
        // The forelegs gather first while the hinds finish pushing off.
        this.target.y += fore ? .20 + .32 * tuck - .18 * reach : .04 + .48 * tuck + .05 * reach;
        this.target.z += fore ? .25 * tuck - .29 * reach : .36 * Math.max(0, vy) - .32 * tuck;
        model.localToWorld(this.target);
        leg.planted = false;
      } else if (floor) {
        const phase = (this.stride + (gallop ? GALLOP_PHASE : TROT_PHASE)[i]!) % 1;
        const plant = !stride || phase < stance;
        const swing = (phase - stance) / (1 - stance);
        const step = plant ? phase / stance : 1 - THREE.MathUtils.smoothstep(swing, 0, 1);
        model.localToWorld(this.target);
        if (stride && speed > .001) {
          const travel = (.5 - step) * stance * length * size * stepAmount / speed;
          this.target.x += velocity.x * travel;
          this.target.z += velocity.z * travel;
        }
        const n = floor.normal, p = floor.point;
        this.target.y = p.y - ((this.target.x - p.x) * n.x + (this.target.z - p.z) * n.z) / n.y;
        this.origin.copy(this.target).y += .38 * size;
        // A hoof can straddle the asphalt lip while its center is still over
        // the lower terrain. Sweep the width of the sole for the step height.
        this.hoofContact.radius = .055 * size;
        const hit = goat.world.shapeCast(this.origin, UPRIGHT, DOWN, this.hoofContact,
          .82 * size, { groups: GROUND_QUERY_GROUPS });
        if (hit && hit.normal.y >= .65) this.target.y = this.origin.y - hit.distance - this.hoofContact.halfHeight;
        this.target.y += size * (.014 + (plant ? 0 : stepAmount * (gallop ? .34 : .23) * Math.sin(Math.PI * swing)));
        if (plant) {
          if (!hit || hit.normal.y < .65) { leg.planted = false; continue; }
          if (this.groundedGait && leg.planted && leg.supportHandle === hit.collider.handle &&
              leg.foothold.distanceTo(this.target) < size * .42 &&
              (hit.body === null || hit.body.isFixed())) this.target.copy(leg.foothold);
          leg.supportHandle = hit.collider.handle;
        }
        leg.foothold.copy(this.target);
        leg.planted = plant;
      }
      this.solve(leg, fore, weight);
    }
    this.groundedGait = !flight;
  }

  private solve(leg: RigLeg, fore: boolean, weight = this.weight): void {
    leg.hip.getWorldPosition(this.hip);
    leg.knee.getWorldPosition(this.knee);
    leg.toe.localToWorld(this.sole.copy(leg.toeOffset));
    const upper = this.hip.distanceTo(this.knee), lower = this.knee.distanceTo(this.sole);
    this.direction.subVectors(this.target, this.hip);
    const distance = THREE.MathUtils.clamp(this.direction.length(), Math.abs(upper - lower) + .0001,
      upper + lower - .0001);
    this.direction.normalize();
    this.pole.copy(this.down).multiplyScalar(fore ? 1 : -1);
    this.pole.addScaledVector(this.direction, -this.pole.dot(this.direction)).normalize();
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    this.kneeGoal.copy(this.hip).addScaledVector(this.direction, along)
      .addScaledVector(this.pole, Math.sqrt(Math.max(0, upper * upper - along * along)));
    this.aim(leg.hip, this.hip, this.knee, this.kneeGoal, weight);
    leg.knee.getWorldPosition(this.knee);
    leg.toe.localToWorld(this.sole.copy(leg.toeOffset));
    this.aim(leg.knee, this.knee, this.sole, this.target, weight);
  }

  private aim(bone: THREE.Bone, pivot: THREE.Vector3, end: THREE.Vector3, goal: THREE.Vector3, weight: number): void {
    this.from.subVectors(end, pivot).normalize();
    this.to.subVectors(goal, pivot).normalize();
    this.delta.setFromUnitVectors(this.from, this.to);
    this.rotateBone(bone, weight);
  }

  private rotateBone(bone: THREE.Bone, weight = this.weight): void {
    bone.parent!.getWorldQuaternion(this.parentRotation);
    this.rotation.copy(this.parentRotation).invert().multiply(this.delta).multiply(this.parentRotation)
      .multiply(bone.quaternion);
    bone.quaternion.slerp(this.rotation, weight);
    bone.updateWorldMatrix(false, true);
  }
}
