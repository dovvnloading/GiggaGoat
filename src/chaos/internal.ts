import { RAPIER, V, rotate } from '../physics';
import type { Vec3 } from '../physics';
import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
export const finitePositive = (n: number, name: string): void => {
  if (!Number.isFinite(n) || n <= 0) throw new RangeError(name + ' must be finite and positive');
};
export const magnitude = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
export const unit = (v: Vec3): Vec3 => {
  const l = magnitude(v);
  return l > 1e-8 ? V(v.x / l, v.y / l, v.z / l) : V();
};
export const horizontal = (v: Vec3): Vec3 => V(v.x, 0, v.z);
export const speed = (body: RigidBody): number => magnitude(body.linvel());

/** Bounded event history: consumers can drain once per frame without unbounded allocations. */
export class EventStream<T> {
  private readonly callbacks = new Set<(event: T) => void>();
  private readonly pending: T[] = [];
  constructor(private readonly maxPending = 512) {}
  on(callback: (event: T) => void): () => void {
    this.callbacks.add(callback);
    return () => { this.callbacks.delete(callback); };
  }
  emit(event: T): void {
    if (this.pending.length >= this.maxPending) this.pending.shift();
    this.pending.push(event);
    for (const callback of this.callbacks) callback(event);
  }
  drain(): T[] { return this.pending.splice(0); }
  clear(): void { this.pending.length = 0; this.callbacks.clear(); }
}

/** Approximate AABB of a shape using its real Rapier dimensions and orientation. */
export function colliderHalfExtents(c: Collider): Vec3 {
  const shape = c.shapeType();
  if (shape === RAPIER.ShapeType.Cuboid) {
    const h = c.halfExtents();
    if (h) return V(h.x, h.y, h.z);
    // A malformed or removed collider can return null even for a cuboid.
  }
  if (shape === RAPIER.ShapeType.Ball) {
    const r = c.radius(); return V(r, r, r);
  }
  if (shape === RAPIER.ShapeType.Capsule || shape === RAPIER.ShapeType.Cylinder) {
    const r = c.radius(), h = c.halfHeight();
    return V(r, h + (shape === RAPIER.ShapeType.Capsule ? r : 0), r);
  }
  // Convex/mesh and other exotic shapes: use a conservative volume-derived cube.
  const edge = Math.cbrt(Math.max(0, c.volume()));
  return V(edge / 2, edge / 2, edge / 2);
}

export function colliderWorldExtents(c: Collider): Vec3 {
  const h = colliderHalfExtents(c), q = c.rotation();
  const x = rotate(q, V(h.x, 0, 0));
  const y = rotate(q, V(0, h.y, 0));
  const z = rotate(q, V(0, 0, h.z));
  return V(Math.abs(x.x) + Math.abs(y.x) + Math.abs(z.x),
    Math.abs(x.y) + Math.abs(y.y) + Math.abs(z.y),
    Math.abs(x.z) + Math.abs(y.z) + Math.abs(z.z));
}
