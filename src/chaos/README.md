# Chaos physics layer

All implementation and tests live in `src/chaos/`. This is an **opt-in** companion to the
existing `src/physics/` API: no changes to core, physics, gameplay, world or project
configuration are necessary. Units: metres, seconds, kilograms, N·s. Rapier runs at
the physics world's fixed 60 Hz timestep. No rendering dependencies are used by
simulation modules.

## Start here

```ts
import { PhysicsWorld, V } from '../physics';
import {
  WaterSystem, BreakableRegistry, ChainReactions,
  SurfaceSystem, DynamicBodyBudget, applyPhysicsMaterial,
} from './index';

const physics = await PhysicsWorld.create();
const budget = new DynamicBodyBudget(physics, 600, 15);
const water = new WaterSystem(physics, { seaLevel: -1 });
const destruction = new BreakableRegistry(physics, {
  maxDebris: 128, debrisLifetime: 20, sleepCleanupSeconds: 3, bodyBudget: budget,
});
const chains = new ChainReactions(physics);
const surfaces = new SurfaceSystem(physics);

const crate = physics.createBox(V(0, 2, 0), V(.5,.5,.5), 350);
water.track(crate);
destruction.register(crate, { impulseThreshold: 10, damageThreshold: 30, chunks: 8 });
chains.registerDomino(crate, { neighbourRadius: 1.3 });
water.events.on(event => {
  if (event.type === 'splash') {
    // event.mass and event.impactSpeed are available for 'big-splash' scoring.
  }
});

function update(dt: number) { physics.step(dt); }
function risingTide(height: number) { water.setSeaLevel(height); }

// Dispose in reverse order so no registered hook runs on freed Rapier state.
surfaces.dispose();
chains.dispose();
destruction.dispose();
water.dispose();
budget.dispose();
physics.dispose();
```

## Public API (`./index.ts`)

### `WaterSystem`

- `new WaterSystem(physics, {seaLevel?, density?, linearDrag?, angularDrag?,
  splashSpeed?, maxBuoyancyAcceleration?})`: creates an infinite sea at a mutable
  height, with 1000 kg/m³ default water density. Water is simulated with
  **one-shot impulses**, not persistent forces. Buoyancy estimates volume from
  each collider's actual Rapier shape and rotation (cuboid, sphere, capsule,
  cylinder, with volume-derived fallback); near volume boundaries it clips the
  shape's bounding box. The sea and local water boxes never double-count displaced
  water. Drag is timestep-clamped; light objects get capped buoyancy acceleration
  instead of exploding numerically.
- `seaLevel` getter; `setSeaLevel(y)` immediately changes the global waterline
  and wakes tracked bodies (for rising-tide party mode).
- `addVolume({id?, center,halfExtents,flow})` returns an ID. Local boxes represent
  rivers/reservoirs (their top face is the local water surface), with a velocity
  in m/s. `removeVolume(id)`, `listVolumes()`.
- `track(body,{buoyancyScale?,paddleSpeed?})` returns an untrack function;
  `untrack(body)`. Track a goat's dynamic torso, vehicle or loose prop to float
  it. `setPaddle(body,V(x,0,z))` sets a [-1..1] directional input with a
  default 2.2 m/s target speed; set `V()` to stop.
- `sample(body)` returns `{displaced,fraction,flow,volumeId}`;
  `submergedCount` counts wet tracked bodies.
- `events.on(callback)`, `events.drain()`: typed `enter`, `exit`, `splash`
  events carry `time`, `bodyHandle`, `mass`, `impactSpeed` and `volumeId`.
  Splash also carries `displacedVolume`. An entry faster than `splashSpeed`
  triggers one splash with **downward entry speed**, including waterflow. Hook
  gameplay's combo/style event bus here; this module does not award points.

### `BreakableRegistry`

- `new BreakableRegistry(physics,{maxDebris?,debrisLifetime?,
  sleepCleanupSeconds?,bodyBudget?})`. Default 128 debris max, oldest first
  eviction, sleeping or age-based retirement. Debris is created using real Rapier
  cuboids with CCD, physical mass, friction and restitution.
- `register(body,{impulseThreshold?,damageThreshold?,chunks?,burstImpulse?})`
  returns an unregister function. Collision thresholds use the physics core's
  actual solver contact impulse (N·s). Damage thresholds accumulate weaker
  impacts; direct breaking requires at least one threshold. Shattering divides
  the original volume into a deterministic lattice (up to 64 chunks), inherits
  its linear and angular velocity, then adds an outward burst.
- `hit(body,impulse,cause?)`, `damage(body,amount)`, `shatter(body,cause?)`
  support scripted physics interactions without bypassing limits. A destroyed
  source is removed from the Rapier world; a `destruction` event carries
  `time`, original `bodyHandle`, `mass`, `position`, `cause`
  (`impact | damage | script | soda`) and `debrisHandles`.
- `breakableCount`, `debrisCount`, `debrisHandles`, `cleanup(dt)`,
  `events.on`, `events.drain`, `dispose`.

### `ChainReactions`

- `registerDomino(body,{neighbourRadius?,toppleAngle?,minKnockSpeed?,
  neighbourKickSpeed?})` wakes and delivers a **real upper-body impulse** to
  nearby registered dominos when a tracked prop is knocked or tilted. Each only
  propagates once; toppling emits a separate real-orientation `topple` event.
- `registerSoda(body,{impactThreshold?,radius?,shoveImpulse?})` makes a
  kid-friendly, once-only fizzy-soda crate: real contact impulses or
  `shakeSoda(body,impulse)` build shaking pressure. When it pops, the shared
  physics radial-impulse helper pushes dynamic neighbors. No weapons, fire or
  damage system.
- `events.on`, `events.drain`: `knock` (neighbour handles),
  `topple` (tilt radians), `sodaPop` (mass and affected handles).

### Materials and `SurfaceSystem`

- `PHYSICS_MATERIALS` has six readonly entries: `grass`, `rock`, `wood`,
  `ice`, `mud`, `rubber` with friction/restitution. Use
  `applyPhysicsMaterial(collider, material)` on any Rapier collider.
  Ice uses minimum friction combination so default crate friction doesn't
  cancel the slippery feel; rubber uses maximum bounce.
- `new SurfaceSystem(physics)`: `createTrampoline({id?,position,
  halfExtents,material?,bounceSpeed?,cooldownSeconds?})`,
  `createLaunchPad({id?,position,halfExtents,material?,direction,
  launchSpeed?,cooldownSeconds?})`,
  `createConveyor({id?,position,halfExtents,material?,direction,speed?,
  acceleration?})`. These methods return IDs and create real, static solid
  Rapier colliders plus thin nonblocking sensors at their top face.
- The trampoline adds enough upward impulse to reach a target launch speed;
  pads apply a **directional mass-scaled impulse** with a cooldown per body,
  not a global timer. Conveyors accelerate touching bodies towards the belt
  velocity, bounded by acceleration × dt. Sensor intersections are queried
  locally rather than scanning all world bodies.
- `remove(id)`, `count`, `dispose()`, and `events.on/drain`: typed
  `bounce`, `launch`, `conveyorEnter`, `conveyorExit` events.

### `DynamicBodyBudget`

- `new DynamicBodyBudget(physics,maxDynamic=800,sleepCleanupSeconds=15)`
  manages **only explicitly admitted dynamic props**, not player-owned
  bodies. `admit(body)` returns false when full; `spawn(factory)` avoids
  calling the factory when full; `release(body)`, `available`, `count`,
  `cleanup(dt)`, `dispose()`. Sleep cleanup runs on fixed ticks.
  The optional shared budget in `BreakableRegistry` prevents fragments from
  oversubscribing it.

All event streams support `on(listener) => unsubscribe` and `drain()`;
pending event history is bounded, callbacks dispatch synchronously. Unregister
tracked/registered bodies before externally removing them when convenient; every
system also checks handles and cleans up disappeared bodies. Never call
`physics.raw.step()` yourself alongside `physics.step()`.

## Headless tests and dev lab

`npm run ci` performs TypeScript strict typecheck, Vitest and Vite production build.
`chaos.test.ts` steps **real** Rapier WASM for floating vs sinking, rising
waterline, flow, exact splash speeds, paddling, real hard/soft contact
breakage, accumulated damage, mass/velocity inheritance, debris eviction and
cleanup, a falling domino row, radial soda pop, launch cooldown, trampoline,
conveyor, physical ice-vs-grass sliding, dynamic cap and 500-prop deterministic
step-time benchmark.

Run `npm run dev` and open **/src/chaos/lab/index.html**. The lab is a
separate Vite dev-only HTML entry (not included in the default production
index). Drag to orbit, scroll to zoom, and click props to shove them. It shows
a river/pool, floating crates and goat proxy, breakable crate stacks, a domino
line, a soda crate, rubber trampoline, directional launch pad and conveyor.
Adjust sea level and shove strength from the HUD; events and body/debris
statistics update live. The lab's reset button reloads only this page.
