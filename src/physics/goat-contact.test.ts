import RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, describe, expect, it } from 'vitest';
import { GOAT_SIZES, GoatRagdoll, type GoatSize } from './GoatRagdoll';
import { PhysicsWorld } from './PhysicsWorld';
import { standingGoatShapes } from './GoatGeometry';
import { distance, V, worldPoint } from './math';

let world: PhysicsWorld;
afterEach(() => world?.dispose());

async function scene() {
  world = await PhysicsWorld.create();
  world.createGround();
}

function steps(count: number) {
  for (let i = 0; i < count; i++) world.step(world.fixedDt);
}

describe('goat contact geometry', () => {
  it.each(GOAT_SIZES)('separates two overlapping idle silhouettes at size %s', async (size: GoatSize) => {
    await scene();
    const a = new GoatRagdoll(world, { size, position: V() });
    const b = new GoatRagdoll(world, { size, position: V(.77 * size, 0, 0) });
    steps(120);
    // The shipped goat rigs span 0.97–1.05 m across the ears at Billy scale.
    expect(b.torso.translation().x - a.torso.translation().x).toBeGreaterThan(.92 * size);
    expect(a.isRagdoll || b.isRagdoll).toBe(false);
  });

  it.each([{ size: .6, yaw: Math.PI / 2 }, { size: 3, yaw: 2.1 }] as const)(
    'queries the same shape poses as a live spawn at size $size, yaw $yaw', async ({ size, yaw }) => {
      await scene();
      const position = V(2, 3, -4);
      const goat = new GoatRagdoll(world, { size, position, yaw });
      const proposed = standingGoatShapes(size, position, yaw);
      const live = goat.bodies.flatMap(body =>
        Array.from({ length: body.numColliders() }, (_, i) => body.collider(i)));
      expect(live).toHaveLength(proposed.length);
      for (const [i, shape] of proposed.entries()) {
        const collider = live[i]!;
        expect(shape.shape.type).toBe(collider.shapeType());
        expect(distance(shape.position, collider.translation())).toBeLessThan(1e-5);
        const a = shape.rotation, b = collider.rotation();
        expect(Math.abs(a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w)).toBeCloseTo(1, 5);
      }
    });

  it('lets a nearby goat stand clear beyond its actual width', async () => {
    await scene();
    const a = new GoatRagdoll(world, { position: V() });
    const b = new GoatRagdoll(world, { position: V(1.08, 0, 0) });
    steps(90);
    const touches = world.drainContacts().filter(c =>
      (a.ownsBody(c.bodyA) && b.ownsBody(c.bodyB)) || (a.ownsBody(c.bodyB) && b.ownsBody(c.bodyA)));
    expect(touches).toHaveLength(0);
    expect(b.torso.translation().x - a.torso.translation().x).toBeCloseTo(1.08, 2);
  });

  it('transfers a sideways shove to a neighboring goat at the outside of its rig', async () => {
    await scene();
    const left = new GoatRagdoll(world, { position: V() });
    const right = new GoatRagdoll(world, { position: V(1.15, 0, 0) });
    steps(60);
    let firstContact = 0;
    world.onContact(c => {
      if (c.type !== 'impact' || firstContact) return;
      if ((left.ownsBody(c.bodyA) && right.ownsBody(c.bodyB)) ||
          (left.ownsBody(c.bodyB) && right.ownsBody(c.bodyA))) {
        firstContact = right.torso.translation().x - left.torso.translation().x;
      }
    });
    for (const body of left.bodies) body.applyImpulse(V(body.mass() * 3, 0, 0), true);
    let fastest = 0;
    let closest = Infinity;
    for (let i = 0; i < 45; i++) {
      left.torso.applyImpulse(V(left.mass * .05, 0, 0), true);
      steps(1);
      fastest = Math.max(fastest, right.torso.linvel().x);
      closest = Math.min(closest, right.torso.translation().x - left.torso.translation().x);
    }
    expect(firstContact).toBeGreaterThan(.94);
    expect(closest).toBeGreaterThan(.93);
    expect(fastest).toBeGreaterThan(.02);
  });

  it('carries the upper contact surface through a flop and a live resize', async () => {
    await scene();
    const goat = new GoatRagdoll(world, { position: V(0, 6, 0) });
    goat.flop();
    for (const body of goat.bodies) body.setAngvel(V(0, 0, 3), true);
    steps(20);
    expect(goat.isRagdoll).toBe(true);
    goat.resize(1.6);
    const torso = goat.torso, size = goat.size;
    const contains = (point: ReturnType<typeof V>) => {
      for (let i = 0; i < torso.numColliders(); i++) {
        if (torso.collider(i).containsPoint(point)) return true;
      }
      return false;
    };
    const nearEar = V(.45 * size, .4 * size, -.09 * size);
    const rolledEar = worldPoint(torso.translation(), torso.rotation(), nearEar);
    expect(contains(rolledEar)).toBe(true);
    // The corner alongside the rump stays clear while the body is rolled.
    const clear = worldPoint(torso.translation(), torso.rotation(), V(.45 * size, .4 * size, .45 * size));
    expect(contains(clear)).toBe(false);
  });

  it('keeps a side wall outside the visible shoulder and ears', async () => {
    await scene();
    const goat = new GoatRagdoll(world);
    world.raw.createCollider(RAPIER.ColliderDesc.cuboid(.05, 1.25, 2).setTranslation(.46, 1.25, 0));
    steps(120);
    expect(.41 - goat.torso.translation().x).toBeGreaterThan(.46);
    expect(goat.isRagdoll).toBe(false);
  });
});
