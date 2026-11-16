# Gigga-Goat gameplay lane

**Zero engine imports.** This is a deterministic 60 Hz rules module. Rendering, sound,
collision resolution and actual rigid-body impulses belong to adapters outside this lane.
It implements the section 3–4 goat/style loop and section 8 lane boundary of
`docs/DESIGN.md`; the size scales are exactly Kid 0.6, Billy 1, Big 1.6, GIGGA 3.

## Public API (`src/gameplay/index.ts`)

- `new GameSimulation(seed)` creates isolated `events`, `rng`, `abilities`, `style`,
  `inventory`, `build`, `wallet`, `unlocks`, and `challenges` components.
  `update(dt, intent, facts)` consumes *seconds*, performs complete 1/60 s ticks,
  and returns `{ticks, commands, alpha}`. `commands` contains **one immutable-by-convention
  result per tick** for the physics adapter to apply in order. `alpha` is the
  render interpolation fraction. No wall clock or `Math.random` is read.
- `GoatAbilities.update(dt, intent, facts, {glideUnlocked})` is independently usable.
  Input is level-triggered; jump, bleat, flop and tongue-fling are rising edges.
  Charge fires when released. Attach requires `facts.tongueTarget` from a hit test.
  `applyImpact(damage)` feeds ragdoll balance, including delayed
  regeneration for non-knockdown hits. Physics should apply returned
  `headbutt`, `tongue`, `bleat`, `jump`, `ragdoll`, and movement flags, **never**
  move objects inside this rules module. The simulation's style tier is
  authoritative for size; standalone ability calls use `facts.size`.
- `StyleSystem.ingest({type:'flip', quality:1})` (or
  `sim.events.emit('style:input', event)`) scores physics events and emits
  `style:scored` and `size:changed`. Custom trick events use
  `{type:'custom', id:'...', basePoints:0..20}`. `combo` is a defensive copy.
- `Inventory.harvest(material, quantity)` returns the amount accepted under cap.
  `HayBuild.snap(worldPosition, degrees)`, `validatePlacement(placement)`,
  `place`, `edit`, `remove`, `damage` manipulate face-adjacent grid cells. Use
  `build:collapsed` for physics falling bodies; they are already removed from
  the logical graph and **not refunded**. Refunds on manual edit/remove are
  full to encourage experimentation, but edits preserve the damage fraction.
- `CudWallet.credit/spend`, `UnlockRegistry.purchase/isUnlocked/catalog`, and
  `ChallengeTracker.catalog/getProgress` are event-driven. Glide is gated by
  the `glide` unlock; wall chalk reduces climb drain and aerial horns trade
  extra charge stamina for airborne impact; gear is cosmetic and unlock dependencies are validated.
  `recordClimb(metres)` emits measured physics traversal for the climb challenge.
- `SeededRng.next/int` and `EventBus.on/emit` are deterministic utilities.
  Event listeners execute synchronously in registration order. `on` returns
  an unsubscribe callback. External listeners are **not** serialized.
- `sim.toJSON()` / `GameSimulation.fromJSON(parsed)` version and reconstruct
  all internal meters, cooldowns, tick remainder, RNG stream, building IDs,
  inventory, coins and challenge progress. Save at any tick boundary (or with
  a partial accumulated frame); don't mutate returned snapshots expecting
  a live-state change.

## Adapter sketch

```ts
import { GameSimulation, TUNING } from './gameplay';
const game = new GameSimulation(1234);
const frame = game.update(TUNING.fixedDt, { sprint: true }, {
  grounded: true, touchingSteepWall: false, airborneTime: 0,
  speed: 6, size: game.style.tier,
});
for (const command of frame.commands) {
  // Apply physics impulses and tongue joint commands in tick order.
  void command;
}
// Collision/physics callbacks: game.awardStyle({ type: 'flip' });
// game.build.damage(pieceId, headbuttImpulse);
```

`facts.climbDistance` is the **measured external frame distance**, split over
complete ticks; calls that do not yet complete a tick retain it in the snapshot.
Report measured distances rather than inferring vertical speed from horizontal
speed. `impact` represents one collision impulse per external frame. Short
jump/bleat/flop/fling pulses and impacts are latched across unfinished ticks
and included in snapshots; long-held inputs should be sampled each tick.

## Tuning guide

**Edit only `config.ts`** for gameplay numbers. Stamina (100 max, sprint 12/s,
climb 20/s, charge 14/s) makes sprinting a travel tool and climbing a short
high-skill commitment. A 0.85 s delay prevents instant hold-release recharge.
Flop takes ~2 s to stand and headbutt charges for 0.1–1.5 s; the tap/ram/meteor
levels reward timing and fast moving headbutts earn up to a 40%
momentum boost, not button mashing. Bleats cap at three in any sliding
five-second window.

Combos have **3.2 s between tricks**; each unique type increases point value,
while reusing a trick multiplies its next score by 0.53. A one-trick farm earns
**zero GIGGA meter**. Even with perfect quality, GIGGA needs at least **8
tricks and 4 distinct trick types within one live combo**, in addition to a
full meter. Billy enters at 16, Big at 55, GIGGA at 100; exits are lower
(10/44/74) to prevent size jitter. After a combo dies, GIGGA drains 5.5/s
(~4.7 s before exiting) while ordinary meter fades 1.3/s. Exponential
scale easing gives a satisfying grow/shrink transition without overshoot.
The size modifier table expresses the nimble-small / bulldozer-large tradeoff.

Building uses 2 m cubes, 6-face connections, up to 48 vertical cells, modest
material costs and high caps for quick freestyle construction. Any piece at
`y=0` anchors to the world; a component disconnected from *every* ground
anchor is removed atomically and appears in one `build:collapsed` event.
Rotation changes mesh orientation, not graph connectivity. Broken pieces
never refund materials. Physically simulating falling pieces is an adapter task.

## Developer sandbox

Run `npm run dev`, open **`/src/gameplay/sandbox/index.html`** on the Vite
server (typically `http://localhost:5173/src/gameplay/sandbox/index.html`).
It is a separate development HTML entry: the normal game boot and production
`index.html` are untouched. Buttons inject real style events/ability intents,
show commands, harvest materials, and manipulate the same build grid used by
production callers. Seed and JSON snapshot controls make bugs reproducible.

Tests: `npm run typecheck`, `npm test`, `npm run build` (or `npm run ci`).
