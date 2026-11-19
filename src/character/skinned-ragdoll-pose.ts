import * as THREE from 'three';
import { GROUND_QUERY_GROUPS, type GoatPart, type GoatRagdoll, type RayHit } from '../physics';
import type { GoatVariant } from './rigged';

const LEGS = ['frontLeft', 'frontRight', 'backLeft', 'backRight'] as const satisfies readonly GoatPart[];
export const HIP_BONES: Readonly<Record<GoatVariant, readonly string[]>> = {
  hero: ['joint_27', 'joint_22', 'joint_14', 'joint_10'],
  bandana: ['clavicleL', 'clavicleR', 'rearUprL', 'rearUprR'],
  bell: ['frontUprL', 'frontUprR', 'rearUprL', 'rearUprR'],
};
const DOWN = { x: 0, y: -1, z: 0 };

interface Hip {
  bone: THREE.Bone;
  bindRotation: THREE.Quaternion;
  animatedRotation: THREE.Quaternion;
  animatedPosition: THREE.Vector3;
  samples: number[];
}

/** Keep a small set of actual skin vertices around the contact envelope. */
function extremes(position: THREE.BufferAttribute, indices: readonly number[],
  axes: readonly number[]): number[] {
  const points = new Set<number>();
  for (const x of axes) for (const y of axes) for (const z of axes) {
    if (x === 0 && y === 0 && z === 0) continue;
    let farthest = -Infinity;
    let point = -1;
    for (const index of indices) {
      const distance = position.getX(index) * x + position.getY(index) * y + position.getZ(index) * z;
      if (distance <= farthest) continue;
      farthest = distance;
      point = index;
    }
    if (point >= 0) points.add(point);
  }
  return [...points];
}

/** Art-only retarget of the authored feet to the current Rapier leg pose. */
export class SkinnedRagdollPose {
  weight = 0;
  private applied = false;
  private recovery = 0;
  private readonly contact = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly target = new THREE.Quaternion();
  private readonly axes = new THREE.Matrix4();

  private constructor(private readonly skin: THREE.SkinnedMesh,
    private readonly hips: readonly Hip[], private readonly bodySamples: readonly number[]) {}

  static create(model: THREE.Group, variant: GoatVariant): SkinnedRagdollPose | null {
    let skin: THREE.SkinnedMesh | undefined;
    model.traverse(object => { if (object instanceof THREE.SkinnedMesh) skin ??= object; });
    if (!skin) return null;
    const mesh: THREE.SkinnedMesh = skin;
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const feet: number[][] = [[], [], [], []];
    const torso: number[][] = [[], [], []];
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
      if (y <= .022 && Math.abs(x) >= .08 && Math.abs(z) >= .12) {
        feet[Number(x > 0) + 2 * Number(z > 0)]!.push(index);
      } else if (y >= .44) {
        torso[z < -.28 ? 0 : z <= .28 ? 1 : 2]!.push(index);
      }
    }
    const modelInverse = model.getWorldQuaternion(new THREE.Quaternion()).invert();
    const hips: Hip[] = [];
    for (const [index, name] of HIP_BONES[variant].entries()) {
      const bone = mesh.skeleton.bones.find(bone => bone.name === name);
      const contact = extremes(position, feet[index]!, [-1, 1]);
      if (!bone?.parent || contact.length === 0) return null;
      hips.push({
        bone, samples: contact,
        bindRotation: modelInverse.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())),
        animatedRotation: new THREE.Quaternion(), animatedPosition: new THREE.Vector3(),
      });
    }
    return new SkinnedRagdollPose(mesh, hips, torso.flatMap(indices => extremes(position, indices, [-1, 0, 1])));
  }

  /** Put the animated locals back before the mixer evaluates its next frame. */
  restore(): void {
    if (!this.applied) return;
    for (const { bone, animatedPosition, animatedRotation } of this.hips) {
      bone.position.copy(animatedPosition);
      bone.quaternion.copy(animatedRotation);
    }
    this.applied = false;
  }

  reset(): void {
    this.restore();
    this.weight = 0;
    this.recovery = 0;
  }

  blend(goat: GoatRagdoll | null, dt: number): void {
    if (!goat) {
      this.reset();
      return;
    }
    const { grounded, groundHit } = goat.locomotion;
    const active = goat.isRagdoll || goat.pose === 'flop';
    // Restarting the leg motors can rebound even while the floor probe still
    // says grounded. Fade after the body settles or clears the contact area.
    const recoveringContact = this.weight > 0 && groundHit !== null &&
      groundHit.distance < 1.3 * goat.size &&
      (!grounded || Math.abs(goat.torso.linvel().y) > .35 * Math.sqrt(goat.size));
    const tracking = active || recoveringContact;
    this.recovery = tracking ? .18 : Math.max(0, this.recovery - dt);
    const rate = tracking ? 15 : this.recovery > 0 ? 0 : -7;
    this.weight = THREE.MathUtils.clamp(this.weight + dt * rate, 0, 1);
  }

  apply(model: THREE.Group, goat: GoatRagdoll, interpolation: number): void {
    if (this.weight === 0) return;
    const scale = goat.size;
    this.applied = true;
    model.updateWorldMatrix(true, false);
    // SkinnedMesh refreshes its attached bind inverse in updateMatrixWorld.
    model.updateMatrixWorld(true);
    const torso = goat.world.getInterpolatedTransform(goat.torso, interpolation).translation;
    const ground = this.support(goat, torso.x, torso.y, torso.z);
    if (ground) {
      const lift = THREE.MathUtils.clamp(this.depth(this.bodySamples, ground) + .012 * scale, 0, .22 * scale);
      model.position.y += lift * this.weight;
      model.updateMatrixWorld(true);
    }
    for (const [index, hip] of this.hips.entries()) {
      const body = goat.getPart(LEGS[index]!);
      const { translation, rotation } = goat.world.getInterpolatedTransform(body, interpolation);
      const { bone } = hip, parent = bone.parent!;
      hip.animatedRotation.copy(bone.quaternion);
      hip.animatedPosition.copy(bone.position);
      this.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
      parent.getWorldQuaternion(this.target).invert().multiply(this.rotation).multiply(hip.bindRotation);
      bone.quaternion.slerp(this.target, this.weight);
      bone.updateWorldMatrix(false, true);

      // The authored leg lengths differ from the physical boxes. Match the low
      // edge of each physical limb, then clear the local ground at its skin.
      const extents = body.collider(0).halfExtents();
      const basis = this.axes.makeRotationFromQuaternion(this.rotation).elements;
      this.lowest(hip.samples);
      const surface = this.support(goat, this.contact.x, translation.y, this.contact.z);
      const level = extents ? (translation.y - Math.abs(basis[1]!) * extents.x -
        Math.abs(basis[5]!) * extents.y - Math.abs(basis[9]!) * extents.z - this.contact.y) * this.weight : 0;
      const surfaceLift = surface ? this.depth(hip.samples, surface) + .017 * scale : -Infinity;
      const lift = THREE.MathUtils.clamp(Math.max(level, surfaceLift), -.26 * scale, .35 * scale);
      this.anchor.setFromMatrixPosition(bone.matrixWorld);
      this.anchor.y += lift;
      bone.position.copy(parent.worldToLocal(this.anchor));
      bone.updateWorldMatrix(false, true);
    }
  }

  private support(goat: GoatRagdoll, x: number, y: number, z: number): RayHit | null {
    const hit = goat.world.raycast({ x, y: y + .12 * goat.size, z }, DOWN, 1.2 * goat.size,
      { groups: GROUND_QUERY_GROUPS });
    return hit && hit.normal.y > .45 ? hit : null;
  }

  private lowest(samples: readonly number[]): void {
    this.contact.y = Infinity;
    for (const sample of samples) {
      const point = this.skin.getVertexPosition(sample, this.point).applyMatrix4(this.skin.matrixWorld);
      if (point.y < this.contact.y) this.contact.copy(point);
    }
  }

  private depth(samples: readonly number[], hit: RayHit): number {
    let deepest = -Infinity;
    const { point: origin, normal } = hit;
    for (const sample of samples) {
      const point = this.skin.getVertexPosition(sample, this.point).applyMatrix4(this.skin.matrixWorld);
      const separation = (point.x - origin.x) * normal.x +
        (point.y - origin.y) * normal.y + (point.z - origin.z) * normal.z;
      deepest = Math.max(deepest, -separation / normal.y);
    }
    return deepest;
  }
}
