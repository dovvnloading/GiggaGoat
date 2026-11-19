import * as THREE from 'three';
import { climbStep } from '../physics/climb-gait';
import type { RayHit } from '../physics';
import type { GoatVariant } from './rigged';
import { HIP_BONES } from './skinned-ragdoll-pose';

interface ClimbingLeg {
  hip: THREE.Bone;
  knee: THREE.Bone;
  toe: THREE.Bone;
  sole: THREE.Vector3;
  toeOffset: THREE.Vector3;
  hipAnimation: THREE.Quaternion;
  kneeAnimation: THREE.Quaternion;
  foothold: THREE.Vector3;
  planted: boolean;
}

type Contact = Pick<RayHit, 'point' | 'normal'>;
const UP = new THREE.Vector3(0, 1, 0);

/** Align the authored body with the contacted face and solve the actual leg
 * bones to alternating world-space footholds. Runs after the animation mixer. */
export class SkinnedClimbPose {
  private weight = 0;
  private phase = 0;
  private applied = false;
  private readonly planePoint = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly down = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
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

  private constructor(private readonly legs: ClimbingLeg[]) {}

  static create(model: THREE.Group, variant: GoatVariant,
    soles: readonly (readonly [number, number])[]): SkinnedClimbPose | null {
    const legs: ClimbingLeg[] = [];
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
        kneeAnimation: new THREE.Quaternion(), foothold: new THREE.Vector3(), planted: false });
    }
    return new SkinnedClimbPose(legs);
  }

  restore(): void {
    if (!this.applied) return;
    for (const leg of this.legs) {
      leg.hip.quaternion.copy(leg.hipAnimation);
      leg.knee.quaternion.copy(leg.kneeAnimation);
    }
    this.applied = false;
  }

  reset(): void {
    this.restore();
    this.weight = 0;
    for (const leg of this.legs) leg.planted = false;
  }

  apply(model: THREE.Group, torso: { x: number; y: number; z: number },
    wall: Contact | null, phase: number, size: number, dt: number): void {
    this.weight = dt === 0 ? Number(!!wall) : THREE.MathUtils.clamp(this.weight + (wall ? 8 : -8) * dt, 0, 1);
    if (!this.weight) return;
    if (wall) {
      this.normal.copy(wall.normal).normalize();
      this.planePoint.copy(wall.point);
      this.phase = phase;
    }
    this.down.copy(UP).negate().addScaledVector(this.normal, this.normal.y).normalize();
    this.right.crossVectors(this.normal, this.down);
    this.rotation.setFromRotationMatrix(this.basis.makeBasis(this.right, this.normal, this.down));
    this.origin.copy(torso).sub(this.planePoint);
    const distance = this.origin.dot(this.normal);
    this.origin.copy(torso).addScaledVector(this.normal, -distance);
    // Bend the knees slightly even in stance so each planted leg has room to push.
    this.target.copy(this.origin).addScaledVector(this.normal, -.13 * size);
    model.position.lerp(this.target, this.weight);
    model.quaternion.slerp(this.rotation, this.weight);
    model.updateWorldMatrix(true, true);
    this.applied = true;
    for (const [i, leg] of this.legs.entries()) {
      const step = climbStep(this.phase, i === 1 || i === 2);
      this.target.copy(this.origin).addScaledVector(this.right, leg.sole.x * size)
        .addScaledVector(this.down, (leg.sole.z + step.down) * size)
        .addScaledVector(this.normal, (.018 + step.lift) * size);
      const plant = !!wall && step.lift === 0;
      if (plant) {
        if (!leg.planted || leg.foothold.distanceToSquared(this.target) > (.28 * size) ** 2) {
          leg.foothold.copy(this.target);
        }
        this.target.copy(leg.foothold);
      }
      leg.planted = plant;
      leg.hipAnimation.copy(leg.hip.quaternion);
      leg.kneeAnimation.copy(leg.knee.quaternion);
      this.solve(leg, i < 2);
    }
  }

  private solve(leg: ClimbingLeg, fore: boolean): void {
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
    this.aim(leg.hip, this.hip, this.knee, this.kneeGoal);
    leg.knee.getWorldPosition(this.knee);
    leg.toe.localToWorld(this.sole.copy(leg.toeOffset));
    this.aim(leg.knee, this.knee, this.sole, this.target);
  }

  private aim(bone: THREE.Bone, pivot: THREE.Vector3, end: THREE.Vector3, goal: THREE.Vector3): void {
    this.from.subVectors(end, pivot).normalize();
    this.to.subVectors(goal, pivot).normalize();
    this.delta.setFromUnitVectors(this.from, this.to);
    bone.parent!.getWorldQuaternion(this.parentRotation);
    this.rotation.copy(this.parentRotation).invert().multiply(this.delta).multiply(this.parentRotation)
      .multiply(bone.quaternion);
    bone.quaternion.slerp(this.rotation, this.weight);
    bone.updateWorldMatrix(false, true);
  }
}
