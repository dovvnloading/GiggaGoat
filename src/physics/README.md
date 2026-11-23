# Physics lane

Headless Rapier 3D simulation for Gigga-Goat. This directory is self-contained: it does **not**
import from the world, gameplay or core lanes. All APIs described here are exported from
[./index.ts](./index.ts). Units are metres, seconds, kilograms, newtons and N·s.

## Create a world

```ts
import { PhysicsWorld, GoatRagdoll, V } from './physics';

const physics = await PhysicsWorld.create({
  gravity: V(0, -9.81, 0),
  fixedDt: 1/60,       // default
  maxSubsteps: 5,      // default; cap simulation work on a slow frame
  solverIterations: 8,
});
physics.createGround(); // example ground; world lane may create its own bodies
const goat = new GoatRagdoll(physics, { position: V(0,0,0), yaw: 0, size: 1 });

function renderFrame(elapsedSeconds: number) {
  const { steps, alpha, droppedSeconds } = physics.step(elapsedSeconds);
  const visualPose = physics.getInterpolatedTransform(goat.torso, alpha);
  // Render the interpolated transformation; never mutate rigid bodies for rendering.
}
// On level teardown: goat.dispose(); physics.dispose();
```

Initialize with `await PhysicsWorld.create()` **before** constructing bodies. The constructor
initializes the Rapier WASM, fixes `World.timestep` and creates an auto-drained `EventQueue`.
`step(realDeltaSeconds)` advances in exact fixed increments, drops excess accumulated time
rather than spiralling, and returns `{steps, alpha, droppedSeconds, time}`.
Its `alpha` is an interpolation fraction between the previous and current *fixed states*;
rendering intentionally lags by one simulation step. Headless callers can simply
`physics.step(1/60)` as often as needed.

`raw` exposes the underlying `RAPIER.World`, and `RAPIER` is re-exported to create
shapes, joints, fixed props, heightfields, etc. `registerBody(body,{kind,owner?,data?})`
and `unregisterBody(body)` maintain the handle-to-user-data `bodyRegistry`. Register
externally created bodies if you want interpolation and metadata; colliders without
a parent body still participate in queries and contact events.
`removeBody(body)` unregisters and removes an entire Rapier body.
`onBeforeStep` / `onAfterStep` subscribe to deterministic fixed-tick hooks
(returning unsubscriber functions).

### Groups, queries and contacts

`CollisionLayer` contains **terrain, prop, goat, tongue, water-sensor, build-piece**.
`collisionGroups('goat', ['terrain','prop'])` encodes Rapier's 16-bit membership and
filter masks; `groupMask()` and `ALL_COLLISION_LAYERS` are exported for custom
combinations. Water colliders should also call `setSensor(true)`. The canned
`GROUND_QUERY_GROUPS` excludes goat pieces and water sensors.

`physics.raycast(origin, direction, maxDistance, options?)` returns a `RayHit` with
the collider, optional parent body, normal, world-space point, and distance.
`physics.shapeCast(position, rotation, direction, shape, maxDistance, options?)`
returns a `ShapeHit` with the same information. Both accept optional `groups`,
`excludeBody`, `excludeCollider`, `predicate`, and `includeSensors` (false by default).
Directions are normalized; distances are metres.

`physics.onContact(callback)` subscribes to contact start/end and **actual Rapier
contact-force events**. `physics.drainContacts()` returns and clears buffered
`PhysicsContact` values: `type`, `time`, collider and optional body handles,
plus **impulse in N·s** (solver force magnitude × fixed timestep), not a guessed
velocity or frame-dependent force. Colliders must enable
`RAPIER.ActiveEvents.COLLISION_EVENTS | CONTACT_FORCE_EVENTS` to produce events.
Our built-in ground, boxes and goat body parts do so.

## Goat and movement

`new GoatRagdoll(physics,{position?,yaw?,size?,id?})` makes seven actual dynamic rigid
bodies: `torso`, `neck`, `head` and `legs` (four). Six revolute `joints` have
motor targets driven from named poses: `stand`, `walk`, `gallop`, `jumpTuck`,
`climb`, and `flop`. Each body carries its own mass. The torso also carries a
massless rounded collider spanning the ears of the skinned goat. It participates
in solid contact throughout movement and ragdoll poses. Buoyancy uses the trunk.
The live bodies and party spawn checks use the same fixture definitions in
[`GoatGeometry.ts`](./GoatGeometry.ts). Connected joints disable adjacent collision.
Body parts are also accessible by `getPart(name)` and `bodies`.
`goat.setPose(name,phase?)` is available for animations, though the locomotion
controller normally selects and cycles poses.

Sizes are `GOAT_SIZES = [0.6,1,1.6,3]`, type `GoatSize`.
Geometry/reach scales as `s`, body mass and directional impulses as `s³`, angular
motor strength as `s⁵` (moment-of-inertia law). Constructor `size` picks a tier,
and `goat.resize(size)` swaps the colliders/joints in place, preserving torso
velocity and heading. Rebuilding purposely clears a current tongue tether.
`goat.motors` contains live `stiffness`, `damping`, and `maxTorque` knobs.

`goat.locomotion.setInput({x,z,cameraYaw,sprint,canSprint,canClimb})` accepts partial
input at any frame rate; values are consumed on the next fixed tick. Positive z
means camera-forward and positive x camera-right. `requestJump()` handles
ground jumps with coyote time and jump buffering; a second aerial press
injects a physical somersault torque. Check `grounded`, `groundHit`,
`isClinging`, `airborneSeconds`, and `heading` for HUD/camera state.
Walking slopes are limited by `maxSlopeDegrees`. While grounded, the walking
motor uses upper-body contact normals to slide along fixed walls and stop at
closed corners. Loose props and other goats still receive the physical shove.
Moving into steep walls with climbing enabled engages the climbing controller. Wall-cling can be disabled by external
`setInput({canClimb:false})` at any moment.

`goat.balance` maintains upright torque and a critically damped ride-height
spring only while a suitable surface is within reach. Impacts lower
`balance.value`; a strong collision triggers complete ragdoll (zero joint motor
force) until it has settled, then automatically restores the motors and
upright controller. `goat.flop()` immediately triggers the same physical
ragdoll. The tunables in `goat.balance.tuning` and
`goat.locomotion.tuning` are mutable.

**Stamina is not consumed here.** `goat.locomotion.staminaRates` exposes
`sprintPerSecond`, `climbPerSecond`, `chargePerSecond`, and
`climbJumpCost`. Gameplay owns stamina balances, regeneration and gating,
and supplies the `canSprint`/`canClimb` permissions.

## Interaction physics

`goat.interactions` provides:

- `headbutt(charge: number = 0)`: accepts a clamped 0–1 charge and lunges
  the torso forward. The first ray/shape hit receives a scaled physical impulse
  at its collision point, including angular response; a hit dynamic body is returned.
- `attachTongue(direction?: Vec3): boolean`: casts from the head to the first
  solid collider; creates a **real Rapier rope joint** to its parent body, or
  a fixed anchor for world colliders, plus a damped spring for elastic towing.
  `setReel(-1|0|1)` is a continuous input; `reel(metres)` changes the max
  rope length immediately by recreating its joint.
  `detachTongue('released')` breaks the tether and flings a tensioned dynamic target.
  Excessive spring force breaks it automatically. Observe `isTongueAttached`,
  `tongueLength`, `tongueBody`, and `tongueJoint`.
- `bleat()`: cooldown-limited physical radial shove.
- `applyImpulseAt(body,impulse,worldPoint?)` and
  `applyExplosion(physics,center,radius,impulse,ignore?)` are generic,
  reusable helpers. Explosion returns affected `{bodyHandle,mass,speed,impulse}` entries.

All interaction constants are in the mutable `goat.interactions.tuning` object.
They do not deduct stamina or award style points.

## Events for gameplay

Each goat has `goat.events.on(callback)` (returns unsubscribe) and
`goat.events.drain()` (returns queued events and clears the buffer).
`PhysicsEvent` is a discriminated TypeScript union, with the event's `goatId`
and simulation `time`. Events are: `landed` (airtime/verticalSpeed),
`impact` (impulse and other body handle), `flipped` (rotations),
`airtimeStart`/`airtimeEnd`, `wallClingStart`/`wallClingEnd`,
`ragdollStart`/`ragdollEnd`, `tongueAttach`/`tongueDetach`, and
`knockedBody` (handle, mass, speed, impulse). No scoring rules are coupled
to these events.

## Lab and tests

Run `npm run dev`, then open **/src/physics/lab/index.html**. Vite serves this
HTML entry directly in development; it isn't included in the standard root
production build. The lab uses Rapier debug-render lines in Three.js, a third-person
mouse-look camera, live tunable sliders, event feed, flat ground, crates and a
climbable wall. Click the canvas to lock the cursor. WASD moves, Shift sprints,
Space jumps/flips, Q flops, E bleats, LMB hold/releases a charged headbutt,
RMB attaches/releases the tongue, R/F reels, wheel adjusts rope length, and 1–4
changes size tiers.

Run `npm run ci` for strict TypeScript, headless Vitest, and production Vite build.
`physics.test.ts` runs the actual Rapier WASM and simulates standing for ten seconds,
walking, ragdoll recovery, wall climbing, size-scaled jumps, crate towing,
charged-vs-tap headbutts, deterministic stepping, interpolation/step clamping,
and real contact-force impulses.
