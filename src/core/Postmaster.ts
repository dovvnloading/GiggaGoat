import { collisionGroups, PhysicsWorld, RAPIER, type Vec3 } from '../physics';
import type { Collider } from '@dimforge/rapier3d-compat';
import type { IslandData } from '../world/types';

/** Marnie sorts the village deliveries beside the west garden mailbox. */
export class Postmaster {
  readonly position?: Vec3;
  readonly scale: number;
  available = false;
  onDuty = false;
  greetedAt = -Infinity;
  private collider?: Collider;

  constructor(island: IslandData, surfaceAt: (x: number, z: number) => number, private readonly physics: PhysicsWorld) {
    this.scale = island.size / 600;
    const village = island.pois.find(p => p.id === 'hoofington')?.center;
    if (!village) return;
    const westBoxes = island.props.filter(p => p.poiId === 'hoofington' && p.kind === 'mailbox' &&
      p.transform.position.x < village.x);
    const targetZ = village.z + 9.25 * this.scale;
    const box = westBoxes.sort((a, b) => Math.abs(a.transform.position.z - targetZ) -
      Math.abs(b.transform.position.z - targetZ))[0]?.transform.position;
    if (!box) return;
    const x = box.x - 1.55 * this.scale, z = box.z - 1.03 * this.scale;
    this.position = { x, y: surfaceAt(x, z), z };
  }

  nearby(player: Vec3): boolean {
    const p = this.position;
    return !!p && this.onDuty && Math.abs(player.y - p.y) < 2.2 * this.scale &&
      Math.hypot(player.x - p.x, player.z - p.z) < 3 * this.scale;
  }

  step(enabled: boolean, sea: number, player: Vec3): void {
    const p = this.position, k = this.scale;
    this.onDuty = !!p && this.available && enabled && sea < p.y + .08 * k;
    if (!p || !this.onDuty) {
      if (this.collider?.isEnabled()) this.collider.setEnabled(false);
      return;
    }
    if (this.collider?.isEnabled()) return;
    // A returning player can already be standing on her spot when the model streams in.
    if (Math.abs(player.y - p.y) < 2.4 * k && Math.hypot(player.x - p.x, player.z - p.z) < 1.45 * k) return;
    if (this.collider) this.collider.setEnabled(true);
    else this.collider = this.physics.raw.createCollider(RAPIER.ColliderDesc.cylinder(.62 * k, .33 * k)
      .setTranslation(p.x, p.y + .63 * k, p.z).setCollisionGroups(collisionGroups('terrain', 'goat')));
  }

  dispose(): void {
    if (this.collider?.isValid()) this.physics.raw.removeCollider(this.collider, false);
  }
}
