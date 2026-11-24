/** Small allocation-friendly vector helpers; no Three.js objects in the simulation. */
export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }
export const V = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const Q = (x = 0, y = 0, z = 0, w = 1): Quat => ({ x, y, z, w });
export const add = (a: Vec3, b: Vec3): Vec3 => V(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => V(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a: Vec3, s: number): Vec3 => V(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x*b.x + a.y*b.y + a.z*b.z;
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  V(a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x);
export const normalize = (a: Vec3): Vec3 => mul(a, 1 / (length(a) || 1));
export const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
export const clampLength = (v: Vec3, max: number): Vec3 =>
  length(v) > max ? mul(normalize(v), max) : v;
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(mul(a, 1-t), mul(b, t));
export const conjugate = (q: Quat): Quat => Q(-q.x, -q.y, -q.z, q.w);
export const multiplyRotation = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
/** Rotation applied to a complete articulated goat by an upright teleport. */
export const uprightRotation = (current: Quat, heading?: number): Quat | null =>
  heading === undefined ? null : multiplyRotation(yawQuaternion(heading), conjugate(current));
export function rotate(q: Quat, v: Vec3): Vec3 {
  const u = V(q.x, q.y, q.z);
  const t = mul(cross(u, v), 2);
  return add(v, add(mul(t, q.w), cross(u, t)));
}
export const inverseRotate = (q: Quat, v: Vec3): Vec3 => rotate(conjugate(q), v);
export const forward = (yaw: number): Vec3 => V(Math.sin(yaw), 0, -Math.cos(yaw));
export const right = (yaw: number): Vec3 => V(Math.cos(yaw), 0, Math.sin(yaw));
export const yawQuaternion = (yaw: number): Quat => Q(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let cosine = a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w;
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (cosine < 0) { cosine = -cosine; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (cosine > 0.9995) {
    const x = a.x + (bx-a.x)*t, y = a.y + (by-a.y)*t;
    const z = a.z + (bz-a.z)*t, w = a.w + (bw-a.w)*t;
    const n = Math.hypot(x,y,z,w);
    return Q(x/n,y/n,z/n,w/n);
  }
  const angle = Math.acos(clamp(cosine,-1,1));
  const s = Math.sin(angle);
  const u = Math.sin((1-t)*angle)/s, v = Math.sin(t*angle)/s;
  return Q(a.x*u+bx*v, a.y*u+by*v, a.z*u+bz*v, a.w*u+bw*v);
}
export const localPoint = (position: Vec3, rotation: Quat, point: Vec3): Vec3 =>
  inverseRotate(rotation, sub(point, position));
export const worldPoint = (position: Vec3, rotation: Quat, point: Vec3): Vec3 =>
  add(position, rotate(rotation, point));
