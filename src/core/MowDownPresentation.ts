import * as THREE from 'three';
import type { Point } from '../gigs';
import { heightAt, type IslandData } from '../world';

/** Show low ground targets, the edge of the whole lawn, and one actionable label. */
export class MowDownPresentation extends THREE.Group {
  private readonly rings: THREE.InstancedMesh;
  private readonly instanceTransform = new THREE.Matrix4();
  private remaining: Point[] = [];
  private finishedCount = -1;

  constructor(island: IslandData, private readonly patches: readonly Point[],
    private readonly label: THREE.Sprite) {
    super();
    this.name = 'mow-down-guide';
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(.72, .93, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffdd78, transparent: true, opacity: .8,
        side: THREE.DoubleSide, depthWrite: false }), patches.length);
    this.rings.name = 'mow-down-patches';
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    label.name = 'mow-down-next-patch';
    label.material.sizeAttenuation = false;
    this.add(this.rings, label, this.outline(island));
  }

  private outline(island: IslandData): THREE.LineLoop {
    const padding = 1.3;
    const xs = this.patches.map(patch => patch.x);
    const zs = this.patches.map(patch => patch.z);
    const left = Math.min(...xs) - padding, right = Math.max(...xs) + padding;
    const near = Math.min(...zs) - padding, far = Math.max(...zs) + padding;
    const corners = [
      { x: left, z: near }, { x: right, z: near },
      { x: right, z: far }, { x: left, z: far },
    ];
    const points: THREE.Vector3[] = [];
    for (let side = 0; side < corners.length; side++) {
      const a = corners[side]!;
      const b = corners[(side + 1) % corners.length]!;
      const segments = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .6);
      for (let segment = 0; segment < segments; segment++) {
        const amount = segment / segments;
        const x = a.x + (b.x - a.x) * amount;
        const z = a.z + (b.z - a.z) * amount;
        points.push(new THREE.Vector3(x, heightAt(island, x, z) + .12, z));
      }
    }
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: .85, depthWrite: false }));
    outline.name = 'mow-down-boundary';
    return outline;
  }

  update(finishedIds: readonly string[], player: Point): void {
    if (finishedIds.length !== this.finishedCount) {
      this.finishedCount = finishedIds.length;
      this.remaining = this.patches.filter((_, index) => !finishedIds.includes(String(index)));
      this.rings.count = this.remaining.length;
      this.remaining.forEach((patch, slot) => {
        this.instanceTransform.makeTranslation(patch.x, patch.y, patch.z);
        this.rings.setMatrixAt(slot, this.instanceTransform);
      });
      this.rings.instanceMatrix.needsUpdate = true;
    }

    let nearest: Point | null = null;
    let distance = Infinity;
    for (const patch of this.remaining) {
      const candidate = Math.hypot(patch.x - player.x, patch.z - player.z);
      if (candidate < distance) {
        distance = candidate;
        nearest = patch;
      }
    }
    this.label.visible = nearest !== null;
    if (nearest) this.label.position.set(nearest.x, nearest.y + .85, nearest.z);
  }
}
