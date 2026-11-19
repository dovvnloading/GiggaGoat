import { afterEach, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from '../core/Game';
import { CollisionLayer, collisionGroups, GROUND_QUERY_GROUPS } from './CollisionGroups';
import { GoatRagdoll, GOAT_SIZES, type GoatSize } from './GoatRagdoll';
import { PhysicsWorld } from './PhysicsWorld';
import { dot, forward, rotate, sub, V } from './math';

const worlds: PhysicsWorld[] = [];
const goats: GoatRagdoll[] = [];
async function scene(): Promise<PhysicsWorld> {
  const world = await PhysicsWorld.create();
  world.createGround();
  worlds.push(world);
  return world;
}
function goat(world: PhysicsWorld, size: GoatSize = 1): GoatRagdoll {
  const g = new GoatRagdoll(world,{size,position:V(0,0,0)});
  goats.push(g);
  return g;
}
function simulate(world: PhysicsWorld, seconds: number): void {
  for (let i = 0; i < Math.round(seconds*60); i++) world.step(1/60);
}
afterEach(() => {
  for (const g of goats.splice(0)) g.dispose();
  for (const world of worlds.splice(0)) world.dispose();
});

describe('real Rapier physics simulation', () => {
  it('stands unaided for ten seconds with a motor-driven torso and four legs', async () => {
    const w = await scene(), g = goat(w);
    expect(g.bodies).toHaveLength(7);
    expect(g.joints).toHaveLength(6);
    simulate(w,10);
    const torso = g.torso.translation();
    const upright = dot(rotate(g.torso.rotation(),V(0,1,0)),V(0,1,0));
    expect(torso.y).toBeGreaterThan(.52);
    expect(torso.y).toBeLessThan(1.7);
    expect(upright).toBeGreaterThan(.8);
    expect(g.isRagdoll).toBe(false);
    expect(g.balanceValue).toBeGreaterThan(.7);
  });

  it('walks forward several metres without kinematic teleportation', async () => {
    const w = await scene(), g = goat(w);
    simulate(w,.6);
    const before = g.torso.translation().z;
    g.locomotion.setInput({z:1,cameraYaw:0});
    simulate(w,3);
    expect(g.torso.translation().z).toBeLessThan(before-3);
    expect(g.torso.isDynamic()).toBe(true);
  });

  it.each([-1, 1])('faces its travel direction after a quarter-turn (sign %i)', async sign => {
    const w = await scene(), g = goat(w);
    simulate(w,.6);
    const start = g.torso.translation();
    const cameraYaw = sign * Math.PI / 2;
    const travel = forward(cameraYaw);
    const facingTravel = (): number => {
      const { x, z } = rotate(g.torso.rotation(),V(0,0,-1));
      return dot(V(x,0,z),travel) / Math.hypot(x,z);
    };
    g.locomotion.setInput({z:1,cameraYaw});
    simulate(w,2);

    expect(dot(sub(g.torso.translation(),start),travel)).toBeGreaterThan(3);
    expect(facingTravel()).toBeGreaterThan(.95);
    g.locomotion.setInput({z:0});
    simulate(w,1);
    expect(g.isRagdoll).toBe(false);
    expect(facingTravel()).toBeGreaterThan(.98);
    expect(dot(sub(g.head.translation(),g.torso.translation()),travel)).toBeGreaterThan(.2);
  });

  it.each(GOAT_SIZES)('actually folds its stance on a deliberate flop at size %i and recovers', async size => {
    const w = await scene(), g = goat(w, size);
    simulate(w, 1.7);
    expect(g.locomotion.grounded).toBe(true);
    const start = g.torso.translation();
    let lowest = start.y, highest = start.y, drift = 0;
    const events: string[] = [];
    g.events.on(event => {
      if (event.type === 'ragdollStart') events.push(event.reason);
      if (event.type === 'ragdollEnd') events.push('recovered');
    });
    g.flop();
    expect(g.isRagdoll).toBe(true);
    for (let tick = 0; tick < 90 && g.isRagdoll; tick++) {
      w.step(1 / 60);
      const point = g.torso.translation();
      lowest = Math.min(lowest, point.y);
      highest = Math.max(highest, point.y);
      drift = Math.max(drift, Math.hypot(point.x - start.x, point.z - start.z));
    }
    expect(start.y - lowest).toBeGreaterThan(.23 * size);
    expect(highest - start.y).toBeLessThan(.08 * size);
    expect(drift).toBeLessThan(size);
    expect(events).toEqual(['flop', 'recovered']);
    expect(g.isRagdoll).toBe(false);
    simulate(w, 2.6);
    expect(g.balanceValue).toBeGreaterThan(.6);
    expect(rotate(g.torso.rotation(),V(0,1,0)).y).toBeGreaterThan(.55);
  });

  it.each([
    ['Downtown', 3, 143.60, 126.26, Math.PI / 2],
    ['Downtown Big', 1.6, 143.60, 126.26, Math.PI / 2],
    ['coast slope', 3, 99, 219, 2.69],
  ] as const)('recovers a planted flop at %s without launching or scoring airtime', async (site, size, x, z, cameraYaw) => {
    const game = await Game.create({ seed: 'billy-isle' });
    try {
      const g = game.goat;
      game.water.untrack(g.torso);
      g.resize(size);
      game.water.track(g.torso, { buoyancyScale: .7, paddleSpeed: 2.6 });
      const down = new RAPIER.Ray(V(x, 65, z), V(0, -1, 0));
      const surfaces = [game.colliders.terrain, ...game.colliders.paths];
      const hits = surfaces.map(surface => surface.castRay(down, 75, false)).filter(hit => hit >= 0);
      game.teleport(V(x, 65 - Math.min(...hits), z), -cameraYaw);
      for (let tick = 0; tick < 145; tick++) game.step({ cameraYaw });
      expect(g.locomotion.grounded).toBe(true);
      const standing = g.torso.translation().y;
      const score = game.rules.style.score;
      let highest = standing, lowest = standing;
      let jumped = 0, longestFlight = 0;
      const events: string[] = [];
      g.events.on(event => {
        if (event.type === 'landed') longestFlight = Math.max(longestFlight, event.airtime);
        if (event.type === 'jumped') jumped++;
        if (event.type === 'ragdollStart' || event.type === 'ragdollEnd') events.push(event.type);
      });
      for (let tick = 0; tick < 206; tick++) {
        game.step({ cameraYaw, flop: tick === 0 });
        const y = g.torso.translation().y;
        highest = Math.max(highest, y);
        lowest = Math.min(lowest, y);
      }
      expect(standing - lowest).toBeGreaterThan(.24 * size);
      expect(highest - standing, site).toBeLessThan(.22);
      expect(longestFlight).toBeLessThan(.25);
      expect(events).toEqual(['ragdollStart', 'ragdollEnd']);
      expect(jumped).toBe(0);
      expect(game.rules.style.score).toBe(score);
      expect(g.balance.hipRecoveryGain).toBe(1);
      expect(g.locomotion.grounded).toBe(true);
      expect(rotate(g.torso.rotation(), V(0, 1, 0)).y).toBeGreaterThan(.94);
      expect(game.respawns).toBe(0);

      // A genuine grounded jump is available on the pressed tick.
      game.step({ cameraYaw, jump: true });
      expect(jumped).toBe(1);
      expect(g.torso.linvel().y).toBeGreaterThan(3);
    } finally {
      game.dispose();
    }
  });

  it('responds to movement as soon as flop control returns, while the hips are still settling', async () => {
    const w = await scene(), g = goat(w, 3);
    simulate(w, 1.7);
    g.flop();
    for (let tick = 0; tick < 90 && g.isRagdoll; tick++) w.step(1 / 60);
    expect(g.isRagdoll).toBe(false);
    expect(g.balance.hipRecoveryGain).toBe(0);
    const start = g.torso.translation();
    const speed = g.torso.linvel().z;
    g.locomotion.setInput({ z: 1, cameraYaw: 0 });
    w.step(1 / 60);
    expect(g.torso.linvel().z - speed).toBeLessThan(-.06);
    simulate(w, .27);
    expect(start.z - g.torso.translation().z).toBeGreaterThan(.25);
  });

  it('guards a loaded hoof on a ledge while leaving the unsupported torso free to fall', async () => {
    const w = await scene();
    w.raw.createCollider(RAPIER.ColliderDesc.cuboid(4, .15, 9)
      .setTranslation(-4, 2.85, 0).setCollisionGroups(collisionGroups('terrain')));
    const g = new GoatRagdoll(w, { size: 3, position: V(-.16, 3, 0) });
    goats.push(g);
    simulate(w, 105 / 60);
    expect(g.locomotion.groundHit?.point.y).toBeCloseTo(3);
    let limited = false;
    g.events.on(event => {
      if (event.type !== 'ragdollEnd') return;
      // The center now sees the lower ground, with two folded hooves
      // still over the high ledge.
      expect(g.locomotion.groundHit?.point.y).toBeCloseTo(0);
      const ledgeFeet = g.legs.filter(leg =>
        (w.raycast(leg.translation(), V(0, -1, 0), .48 * g.size, { groups: GROUND_QUERY_GROUPS })?.point.y ?? 0) > 2.9);
      expect(ledgeFeet).toHaveLength(2);
      limited = g.balance.hipRecoveryGain === 0;
    });
    g.flop();
    simulate(w, 3.5);
    expect(limited).toBe(true);
    expect(g.balance.hipRecoveryGain).toBe(1);
    expect(g.torso.translation().x).toBeGreaterThan(.9);
    expect(g.torso.translation().y).toBeLessThan(3.4);
  });

  it('still enters ragdoll when a moving crate strikes a planted goat', async () => {
    const w = await scene();
    const g = goat(w, .6);
    simulate(w, .65);
    const knockdowns: string[] = [];
    g.events.on(event => {
      if (event.type === 'ragdollStart') knockdowns.push(event.reason);
    });
    const crate = w.createBox(V(0, .5, -3.6), V(.45, .5, .40), 24);
    crate.setLinvel(V(0, 0, 12), true);
    simulate(w, .65);
    expect(knockdowns).toEqual(['impact']);
    expect(g.isRagdoll).toBe(true);
  });

  it('clings and climbs measurable height on a steep vertical wall', async () => {
    const w = await scene(), g = goat(w);
    const wall = w.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,2,-1.35));
    w.raw.createCollider(RAPIER.ColliderDesc.cuboid(2.2,3,.28)
      .setCollisionGroups(collisionGroups('terrain')),wall);
    w.registerBody(wall,{kind:'terrain'});
    let wallClingCount = 0;
    g.events.on(e=> {if(e.type==='wallClingStart') wallClingCount++;});
    g.locomotion.setInput({z:1});
    let maxHeight = g.torso.translation().y;
    for (let i=0;i<240;i++) {
      w.step(1/60);
      maxHeight = Math.max(maxHeight,g.torso.translation().y);
    }
    expect(wallClingCount).toBeGreaterThan(0);
    expect(maxHeight).toBeGreaterThan(2);
  });

  it('releases immediately when the last foothold disappears while movement is held', async () => {
    const w = await scene(), g = goat(w);
    const wall = w.raw.createCollider(RAPIER.ColliderDesc.cuboid(3, 8, .2)
      .setTranslation(0, 7.9, -2).setCollisionGroups(collisionGroups('terrain')));
    simulate(w, 1);
    g.locomotion.setInput({ z: 1 });
    for (let i = 0; i < 180; i++) {
      w.step(1 / 60);
      if (g.locomotion.isClinging && g.torso.translation().y > 2.4) break;
    }
    expect(g.locomotion.climbSurface?.collider.handle).toBe(wall.handle);
    const rising = g.torso.linvel().y;
    w.raw.removeCollider(wall, true);
    w.step(1 / 60);
    expect(g.locomotion.isClinging).toBe(false);
    expect(g.locomotion.climbSurface).toBeNull();
    simulate(w, .2);
    expect(g.torso.linvel().y).toBeLessThan(rising - 1);
  });

  it.each([[58, .55], [58, 1], [65, .55], [65, 1]])(
    'climbs a %i degree face when the leading head reaches it at input %f', async (angle, input) => {
      const w = await scene(), g = goat(w, .6);
      const rise = 4 * Math.tan(angle * Math.PI / 180);
      w.raw.createCollider(RAPIER.ColliderDesc.trimesh(
        new Float32Array([-4, 0, -2, 4, 0, -2, -4, rise, -6, 4, rise, -6]),
        new Uint32Array([0, 1, 2, 1, 3, 2]), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
        .setFriction(.92).setCollisionGroups(collisionGroups('terrain')));
      simulate(w, 80 / 60);
      const initial = g.torso.translation();
      const surfaces: number[] = [];
      g.events.on(event => {
        if (event.type === 'wallClingStart') surfaces.push(event.normal.y);
      });
      g.locomotion.setInput({ z: input, cameraYaw: 0, canClimb: true });
      for (let tick = 0; tick < 125 && g.torso.translation().y - initial.y < 2.2; tick++) {
        w.step(1 / 60);
      }
      expect(g.torso.translation().y - initial.y).toBeGreaterThanOrEqual(2.2);
      expect(surfaces[0]).toBeCloseTo(Math.cos(angle * Math.PI / 180), 3);
      expect(g.isRagdoll).toBe(false);
      g.locomotion.setInput({ z: 0 });
      w.step(1 / 60);
      expect(g.locomotion.isClinging).toBe(false);
    });

  it('keeps an ordinary low curb outside the climb motor', async () => {
    const w = await scene(), g = goat(w, .6);
    w.raw.createCollider(RAPIER.ColliderDesc.cuboid(3, .07, .15)
      .setTranslation(0, .07, -2.5).setCollisionGroups(collisionGroups('terrain')));
    simulate(w, 80 / 60);
    const climbs: string[] = [];
    g.events.on(event => { if (event.type === 'wallClingStart') climbs.push(event.type); });
    g.locomotion.setInput({ z: 1, cameraYaw: 0, canClimb: true });
    simulate(w, 2);
    expect(g.torso.translation().z).toBeLessThan(-4);
    expect(climbs).toHaveLength(0);
    expect(g.isRagdoll).toBe(false);
  });

  it('rejects a steep sphere contact at a short barrier with no face ahead of the head', async () => {
    const w = await scene(), g = goat(w, .6);
    const cap = w.raw.createCollider(RAPIER.ColliderDesc.cuboid(3, .24, .15)
      .setTranslation(0, .24, -2.5).setCollisionGroups(collisionGroups('terrain')));
    simulate(w, 80 / 60);
    const motion = V(0, 0, -1);
    const head = g.head;
    let sawEdge = false;
    g.locomotion.setInput({ z: .65, cameraYaw: 0, canClimb: true });
    for (let tick = 0; tick < 120; tick++) {
      const hit = w.shapeCast(head.translation(), head.rotation(), motion, head.collider(0).shape,
        .14 * g.size, { predicate: collider => !g.ownsBody(collider.parent()) });
      if (hit?.collider.handle === cap.handle && hit.normal.y < .60 && hit.normal.z > .45) {
        sawEdge = true;
        expect(g.locomotion.findClimbSurface(motion)).toBeNull();
      }
      w.step(1 / 60);
      expect(g.locomotion.isClinging).toBe(false);
    }
    expect(sawEdge).toBe(true);
  });

  it('scales jump height and mass sensibly across size tiers', async () => {
    const measure = async (size: GoatSize): Promise<{height:number;mass:number}> => {
      const w = await scene(), g = goat(w,size);
      simulate(w,1);
      const from = g.torso.translation().y;
      g.locomotion.requestJump();
      let top = from;
      for(let i=0;i<210;i++) {
        w.step(1/60);
        top = Math.max(top,g.torso.translation().y);
      }
      return {height:top-from,mass:g.mass};
    };
    const kid = await measure(.6), big = await measure(1.6);
    expect(kid.height).toBeGreaterThan(.35);
    expect(big.height).toBeGreaterThan(kid.height*1.35);
    expect(big.mass/kid.mass).toBeCloseTo((1.6/.6)**3,5);
  });

  it('reels safely after the attached dynamic target is destroyed externally', async () => {
    const w = await scene(), g = goat(w);
    const bale = w.createBox(V(0, .42, -2.5), V(.4, .4, .4), 8);
    simulate(w, .6);
    expect(g.interactions.attachTongue(V(0, -.75, -2.4))).toBe(true);
    w.removeBody(bale);
    expect(g.interactions.tongueBody).toBeNull();
    g.interactions.setReel(-1);
    expect(() => simulate(w, .2)).not.toThrow();
    expect(g.interactions.tongueJoint).toBeNull();
  });

  it('uses a physical Rapier rope joint to drag a crate with the tongue', async () => {
    const w = await scene(), g = goat(w);
    const crate = w.createBox(V(0,.42,-2.5),V(.4,.4,.4),8);
    simulate(w,.6);
    expect(g.interactions.attachTongue(V(0,-.75,-2.4))).toBe(true);
    expect(g.interactions.tongueJoint).not.toBeNull();
    const before = crate.translation().z;
    g.locomotion.setInput({z:-1});
    simulate(w,2.5);
    expect(crate.translation().z).toBeGreaterThan(before+.35);
  });

  it('can keep the same held body when size progression rebuilds the head', async () => {
    const w = await scene(), g = goat(w, .6);
    const crate = w.createBox(V(0, .42, -2.5), V(.4, .4, .4), 2.5);
    simulate(w, .6);
    const head = g.head.translation(), target = crate.translation();
    expect(g.interactions.attachTongue(V(target.x - head.x, target.y - head.y, target.z - head.z))).toBe(true);
    expect(g.interactions.tongueBody?.handle).toBe(crate.handle);
    const oldHead = g.head.handle;
    const releases: string[] = [];
    const unsubscribe = g.events.on(event => {
      if (event.type === 'tongueDetach') releases.push(event.reason);
    });
    g.resize(1, true);
    expect(g.head.handle).not.toBe(oldHead);
    expect(g.interactions.tongueBody?.handle).toBe(crate.handle);
    expect(g.interactions.tongueJoint?.isValid()).toBe(true);
    simulate(w, .2);
    expect(g.interactions.tongueBody?.handle).toBe(crate.handle);
    expect(releases).toEqual([]);
    g.resize(.6);
    expect(g.interactions.tongueBody).toBeNull();
    expect(releases).toEqual(['replaced']);
    unsubscribe();
  });

  it('moves the same crate further with a charged headbutt than a tap', async () => {
    const trial = async (charge:number):Promise<number> => {
      const w = await scene(), g = goat(w);
      const crate = w.createBox(V(0,.42,-1.8),V(.43,.4,.43),9);
      simulate(w,.25);
      const before = crate.translation().z;
      const hit = g.interactions.headbutt(charge);
      expect(hit?.handle).toBe(crate.handle);
      simulate(w,1);
      return before-crate.translation().z;
    };
    const tap = await trial(0), charged = await trial(1);
    expect(tap).toBeGreaterThan(.1);
    expect(charged).toBeGreaterThan(tap+.5);
  });

  it('has deterministic 60Hz steps independent of render frame partitioning', async () => {
    const a = await scene(), b = await scene();
    const ga = goat(a), gb = goat(b);
    ga.locomotion.setInput({z:1,x:.4,sprint:true,cameraYaw:.4});
    gb.locomotion.setInput({z:1,x:.4,sprint:true,cameraYaw:.4});
    for(let i=0;i<120;i++) a.step(1/60);
    for(let i=0;i<60;i++) b.step(1/30);
    const pa=ga.torso.translation(), pb=gb.torso.translation();
    expect(a.stepCount).toBe(120);
    expect(b.stepCount).toBe(120);
    expect(Math.hypot(pa.x-pb.x,pa.y-pb.y,pa.z-pb.z)).toBeLessThan(1e-5);
    expect(a.alpha).toBeCloseTo(0,8);
  });

  it('clamps runaway frame times, interpolates, and records real impact impulses', async () => {
    const w = await scene();
    const crate = w.createBox(V(0,4,0),V(.4,.4,.4),12);
    const many = w.step(4);
    expect(many.steps).toBe(w.maxSubsteps);
    expect(many.droppedSeconds).toBeGreaterThan(3.8);
    simulate(w,2);
    const impacts = w.drainContacts().filter(e=>e.type==='impact');
    expect(impacts.some(e=>e.impulse>0 && (e.bodyA===crate.handle || e.bodyB===crate.handle))).toBe(true);
    const pose = w.getInterpolatedTransform(crate,.5);
    expect(Number.isFinite(pose.translation.y)).toBe(true);
    expect((collisionGroups('goat','prop') >>> 16) & CollisionLayer.goat).toBeTruthy();
  });
});
