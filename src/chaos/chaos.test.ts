import { afterEach, describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { PhysicsWorld, RAPIER, V } from '../physics';
import type { Vec3 } from '../physics';
import { BreakableRegistry, ChainReactions, DynamicBodyBudget, SurfaceSystem,
  WaterSystem, applyPhysicsMaterial, PHYSICS_MATERIALS } from './index';

const worlds: PhysicsWorld[] = [];
const cleanups: Array<() => void> = [];
async function scene(gravity: Vec3 = V(0,-9.81,0)): Promise<PhysicsWorld> {
  const world = await PhysicsWorld.create({gravity});
  worlds.push(world);
  return world;
}
function manage<T extends { dispose(): void }>(value: T): T {
  cleanups.push(() => value.dispose()); return value;
}
function steps(world: PhysicsWorld, count: number): void {
  for (let i=0;i<count;i++) world.step(1/60);
}
afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose();
  for (const world of worlds.splice(0)) world.dispose();
});

describe('water: actual displaced mass, motion and typed events', () => {
  it('floats a light crate while a dense equal-volume rock sinks', async () => {
    const world = await scene(), water = manage(new WaterSystem(world,{seaLevel:0}));
    const crate = world.createBox(V(-3,.2,0),V(.5,.5,.5),450);
    const rock = world.createBox(V(3,.2,0),V(.5,.5,.5),2600);
    water.track(crate); water.track(rock);
    steps(world,300);
    expect(crate.translation().y).toBeGreaterThan(-.4);
    expect(crate.translation().y).toBeLessThan(.8);
    expect(rock.translation().y).toBeLessThan(-5);
    expect(water.sample(crate).displaced).toBeGreaterThan(.25);
  });

  it('rising sea level wets a previously dry stationary prop', async () => {
    const world = await scene(V()), water = manage(new WaterSystem(world,{seaLevel:0}));
    const body = world.createBox(V(0,3,0),V(.4,.4,.4),40);
    water.track(body);
    steps(world,2);
    expect(water.sample(body).displaced).toBe(0);
    expect(water.events.drain().filter(e=>e.type==='enter')).toHaveLength(0);
    water.setSeaLevel(3);
    steps(world,1);
    expect(water.events.drain().some(e=>e.type==='enter' && e.bodyHandle===body.handle)).toBe(true);
    expect(water.sample(body).displaced).toBeGreaterThan(.1);
  });

  it('an isolated river box pushes along its flow, but not outside the water', async () => {
    const world = await scene(V()), water = manage(new WaterSystem(world,{seaLevel:-100}));
    const volume = water.addVolume({id:'river',center:V(0,0,0),
      halfExtents:V(6,2,2),flow:V(3,0,0)});
    expect(volume).toBe('river');
    const body = world.createBox(V(-2,0,0),V(.4,.4,.4),200);
    water.track(body);
    steps(world,60);
    expect(body.linvel().x).toBeGreaterThan(.6);
    expect(water.events.drain().some(e=>e.type==='enter' && e.volumeId==='river')).toBe(true);
    const outside = world.createBox(V(0,0,10),V(.4,.4,.4),200);
    water.track(outside);
    steps(world,10);
    expect(outside.linvel().x).toBeCloseTo(0,6);
    expect(water.removeVolume('river')).toBe(true);
  });

  it('enter/splash carry real downward impact speed, mass and displaced volume', async () => {
    const world = await scene(V()), water = manage(new WaterSystem(world,{seaLevel:0,splashSpeed:3}));
    const body = world.createBox(V(0,2,0),V(.5,.5,.5),24);
    body.setLinvel(V(0,-6,0),true);
    water.track(body);
    steps(world,20);
    const events = water.events.drain();
    const enter = events.find(e=>e.type==='enter');
    const splash = events.find(e=>e.type==='splash');
    expect(enter?.bodyHandle).toBe(body.handle);
    expect(splash).toBeDefined();
    expect(splash?.mass).toBeCloseTo(24,5);
    expect(splash?.impactSpeed).toBeCloseTo(6,1);
    if (splash?.type === 'splash') expect(splash.displacedVolume).toBeGreaterThan(0);
    expect(events.filter(e=>e.type==='splash')).toHaveLength(1);
    water.setSeaLevel(-50);
    steps(world,1);
    expect(water.events.drain().some(e=>e.type==='exit')).toBe(true);
  });

  it('a goat-sized buoyant proxy can paddle slowly rather than rocket away', async () => {
    const world = await scene(), water = manage(new WaterSystem(world,{seaLevel:0}));
    const goat = world.createBox(V(0,.1,0),V(.55,.45,.65),125);
    water.track(goat,{paddleSpeed:2});
    water.setPaddle(goat,V(1,0,0));
    steps(world,180);
    expect(goat.translation().y).toBeGreaterThan(-.4);
    expect(goat.translation().x).toBeGreaterThan(1);
    expect(goat.translation().x).toBeLessThan(7);
    expect(goat.linvel().x).toBeLessThan(2.5);
  });
});

describe('destruction with real Rapier contacts and bounded fragments', () => {
  async function collisionTrial(strikeSpeed: number): Promise<{registry:BreakableRegistry;target:ReturnType<PhysicsWorld['createBox']>;world:PhysicsWorld}> {
    const world = await scene(V()), registry = manage(new BreakableRegistry(world));
    const target = world.createBox(V(0,0,0),V(.45,.45,.45),8);
    registry.register(target,{impulseThreshold:4,chunks:8,burstImpulse:5});
    const striker = world.createBox(V(-1.1,0,0),V(.35,.35,.35),4);
    striker.setLinvel(V(strikeSpeed,0,0),true);
    steps(world,120);
    return {registry,target,world};
  }

  it('a hard physical hit shatters; an otherwise identical soft collision does not', async () => {
    const soft = await collisionTrial(.35);
    expect(soft.target.isValid()).toBe(true);
    expect(soft.registry.events.drain()).toHaveLength(0);
    const hard = await collisionTrial(11);
    const destruction = hard.registry.events.drain();
    expect(destruction).toHaveLength(1);
    expect(destruction[0]?.cause).toBe('impact');
    expect(destruction[0]?.mass).toBeCloseTo(8);
    expect(destruction[0]?.debrisHandles).toHaveLength(8);
    expect(hard.target.isValid()).toBe(false);
    for (const handle of destruction[0]?.debrisHandles ?? [])
      expect(hard.world.raw.getRigidBody(handle)?.isValid()).toBe(true);
  });

  it('supports accumulated damage without breaking on one soft hit', async () => {
    const world = await scene(V()), registry = manage(new BreakableRegistry(world));
    const body = world.createBox(V(0,0,0),V(.5,.5,.5),10);
    registry.register(body,{impulseThreshold:100,damageThreshold:6,chunks:4});
    expect(registry.damage(body,2)).toBe(false);
    expect(registry.damage(body,3)).toBe(false);
    expect(registry.damage(body,1)).toBe(true);
    expect(registry.events.drain()[0]?.cause).toBe('damage');
  });

  it('never exceeds debris cap, evicts oldest and removes chunks by lifetime', async () => {
    const world = await scene(V()), registry = manage(new BreakableRegistry(world,{
      maxDebris:9,debrisLifetime:.5,sleepCleanupSeconds:10,
    }));
    let first: ReturnType<PhysicsWorld['createBox']> | undefined;
    for (let i=0;i<7;i++) {
      const body = world.createBox(V(i*4,0,0),V(.5,.5,.5),8);
      registry.register(body,{impulseThreshold:1,chunks:8});
      expect(registry.hit(body,20)).toBe(true);
      first ??= world.raw.getRigidBody(registry.debrisHandles[0]!) ?? undefined;
      expect(registry.debrisCount).toBeLessThanOrEqual(9);
    }
    expect(registry.debrisCount).toBe(9);
    expect(first).toBeDefined();
    expect(first!.isValid()).toBe(false);
    steps(world,40);
    expect(registry.debrisCount).toBe(0);
  });

  it('conserves source velocity/mass approximately across unburst fragments', async () => {
    const world = await scene(V()), registry = manage(new BreakableRegistry(world));
    const body = world.createBox(V(0,0,0),V(.6,.6,.6),16);
    body.setLinvel(V(3,0,0),true);
    registry.register(body,{impulseThreshold:5,chunks:8,burstImpulse:0});
    expect(registry.hit(body,8)).toBe(true);
    const evt=registry.events.drain()[0]!;
    const chunks=evt.debrisHandles.map(h=>world.raw.getRigidBody(h)!);
    expect(chunks.reduce((m,c)=>m+c.mass(),0)).toBeCloseTo(16,3);
    for (const chunk of chunks) expect(chunk.linvel().x).toBeCloseTo(3,4);
  });
});

describe('neighbour propagation and safe fizzy-soda pop', () => {
  it('topples a physical six-piece domino row from one shove', async () => {
    const world = await scene(), chain = manage(new ChainReactions(world));
    world.createGround(V(20,.2,20),V(0,-.2,0));
    const row = Array.from({length:6}, (_,i) => {
      const body = world.createBox(V(i*.56,.66,0),V(.12,.65,.3),2);
      chain.registerDomino(body,{neighbourRadius:.75,neighbourKickSpeed:3.5,
        minKnockSpeed:.4,toppleAngle:.38});
      return body;
    });
    steps(world,50);
    const first=row[0]!;
    const p=first.translation();
    first.applyImpulseAtPoint(V(8,0,0),V(p.x,p.y+.52,p.z),true);
    steps(world,240);
    const fallen = new Set(chain.events.drain().filter(e=>e.type==='topple').map(e=>e.bodyHandle));
    expect(row.every(body=>fallen.has(body.handle))).toBe(true);
    expect(row[5]!.rotation().w).not.toBeCloseTo(1,2);
  });

  it('a shaken soda crate pops exactly once and shoves adjacent props', async () => {
    const world=await scene(V()), chain=manage(new ChainReactions(world));
    const soda=world.createBox(V(0,0,0),V(.5,.5,.5),15);
    const target=world.createBox(V(1.4,0,0),V(.4,.4,.4),5);
    chain.registerSoda(soda,{impactThreshold:6,radius:4,shoveImpulse:35});
    expect(chain.shakeSoda(soda,2)).toBe(false);
    expect(target.linvel().x).toBe(0);
    expect(chain.shakeSoda(soda,5)).toBe(true);
    expect(target.linvel().x).toBeGreaterThan(.4);
    expect(chain.shakeSoda(soda,10)).toBe(false);
    const events=chain.events.drain();
    expect(events.filter(e=>e.type==='sodaPop')).toHaveLength(1);
    expect(events[0]?.type).toBe('sodaPop');
    if (events[0]?.type==='sodaPop') expect(events[0].affectedHandles).toContain(target.handle);
  });

  it('a real high-impulse collision triggers an unarmed soda pop', async () => {
    const world = await scene(V()), chain=manage(new ChainReactions(world));
    const soda=world.createBox(V(0,0,0),V(.5,.5,.5),15);
    chain.registerSoda(soda,{impactThreshold:3,radius:4,shoveImpulse:25});
    const ball=world.createBox(V(-2,0,0),V(.35,.35,.35),5);
    ball.setLinvel(V(12,0,0),true);
    steps(world,80);
    expect(chain.events.drain().filter(e=>e.type==='sodaPop')).toHaveLength(1);
  });
});

describe('surfaces and budget', () => {
  it('launches actual bodies in a direction and enforces per-body cooldown', async () => {
    const world = await scene(V()), surfaces=manage(new SurfaceSystem(world));
    surfaces.createLaunchPad({position:V(),halfExtents:V(1,.1,1),
      direction:V(1,1,0),launchSpeed:8,cooldownSeconds:1});
    const body=world.createBox(V(0,.5,0),V(.3,.3,.3),4);
    steps(world,1);
    expect(body.linvel().x).toBeGreaterThan(5);
    expect(body.linvel().y).toBeGreaterThan(5);
    expect(surfaces.events.drain().filter(e=>e.type==='launch')).toHaveLength(1);
    for (let i=0;i<30;i++) {
      body.setTranslation(V(0,.5,0),true);
      body.setLinvel(V(),true);
      steps(world,1);
    }
    expect(surfaces.events.drain().filter(e=>e.type==='launch')).toHaveLength(0);
    for (let i=0;i<33;i++) {
      body.setTranslation(V(0,.5,0),true);
      body.setLinvel(V(),true);
      steps(world,1);
    }
    expect(surfaces.events.drain().filter(e=>e.type==='launch')).toHaveLength(1);
  });

  it('trampolines bounce falling props and conveyors carry their passengers', async () => {
    const world=await scene(), surfaces=manage(new SurfaceSystem(world));
    surfaces.createTrampoline({position:V(-3,0,0),halfExtents:V(1,.15,1),bounceSpeed:9});
    surfaces.createConveyor({position:V(3,0,0),halfExtents:V(2,.2,1),
      direction:V(0,0,1),speed:3,acceleration:20});
    const jumper=world.createBox(V(-3,1.5,0),V(.3,.3,.3),3);
    const passenger=world.createBox(V(3,.62,-.5),V(.3,.3,.3),5);
    steps(world,85);
    const events=surfaces.events.drain();
    expect(events.some(e=>e.type==='bounce' && e.bodyHandle===jumper.handle)).toBe(true);
    expect(events.some(e=>e.type==='conveyorEnter' && e.bodyHandle===passenger.handle)).toBe(true);
    expect(passenger.translation().z).toBeGreaterThan(.1);
  });

  it('ice has measurably less friction than grass in the actual solver', async () => {
    async function slide(material: 'grass'|'ice'): Promise<number> {
      const world=await scene();
      const floor=world.raw.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,-.25,0));
      const collider=world.raw.createCollider(RAPIER.ColliderDesc.cuboid(20,.25,20),floor);
      applyPhysicsMaterial(collider,material);
      const body=world.createBox(V(0,.5,0),V(.4,.4,.4),2);
      steps(world,45);
      body.setLinvel(V(6,0,0),true);
      steps(world,120);
      return body.translation().x;
    }
    expect(PHYSICS_MATERIALS.ice.friction).toBeLessThan(PHYSICS_MATERIALS.grass.friction);
    const grass=await slide('grass'), ice=await slide('ice');
    expect(ice).toBeGreaterThan(grass+2);
  });

  it('caps managed dynamic bodies and reclaims sleepers without deleting foreign bodies', async () => {
    const world=await scene(V()), budget=manage(new DynamicBodyBudget(world,2,.1));
    const a=budget.spawn(()=>world.createBox(V(),V(.3,.3,.3),2));
    const b=budget.spawn(()=>world.createBox(V(3,0,0),V(.3,.3,.3),2));
    const foreign=world.createBox(V(5,0,0),V(.3,.3,.3),2);
    expect(a).not.toBeNull(); expect(b).not.toBeNull();
    expect(budget.spawn(()=>world.createBox(V(10,0,0),V(.3,.3,.3),2))).toBeNull();
    expect(budget.count).toBe(2);
    a!.sleep();
    steps(world,10);
    expect(budget.count).toBeLessThan(2);
    expect(world.raw.getRigidBody(foreign.handle)).not.toBeNull();
  });

  it('benchmarks 500 real dynamic props and matches deterministic repeated runs', async () => {
    const start=performance.now();
    const make = async (): Promise<{world:PhysicsWorld;handles:number[]}> => {
      const world=await scene();
      world.createGround(V(50,.5,50),V(0,-.5,0));
      const handles:number[]=[];
      for(let i=0;i<500;i++) {
        const x=i%20, z=Math.floor(i/20)%10, level=Math.floor(i/200);
        const body=world.createBox(V(x*.82-8, .35+level*.72, z*.82-4),
          V(.32,.32,.32),1);
        handles.push(body.handle);
      }
      return {world,handles};
    };
    const a=await make(), b=await make();
    steps(a.world,45); steps(b.world,45);
    for (const i of [0,17,188,301,499]) {
      const p=a.world.raw.getRigidBody(a.handles[i]!)!.translation();
      const q=b.world.raw.getRigidBody(b.handles[i]!)!.translation();
      expect(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)).toBeLessThan(1e-5);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(performance.now()-start).toBeLessThan(15000);
  },20000);
});
