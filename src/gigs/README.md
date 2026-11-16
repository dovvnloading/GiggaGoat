# GOAT GIGS — deterministic free-roam contracts

Playable, replayable 60 Hz job rules for Gigga-Goat. **Everything here is inside src/gigs/.**
The production rules never import Three.js, Rapier, the DOM, timers, wall clocks or
ambient randomness. The optional dev-only sandbox is the sole DOM user.
Gig Catalog consumes **read-only, public Billy Isle data**; the wallet bridge consumes
**only the public gameplay API**. No modifications to the world, physics, gameplay,
chaos, modes or core lanes are needed.

## Public API: src/gigs/index.ts

| Export | Contract |
|---|---|
| \`GigCatalog(island, seed?)\` | Capture the real POI and prop descriptors. Build identical gigs from identical island/seed inputs. \`seed\` may be a number or string. |
| \`catalog.info(gigId)\` / \`GIG_INFO\` | Player-facing names, instructions, actual POIs, goat verbs, base reward and cosmetic prize metadata. |
| \`catalog.board(poiId, absoluteTick)\` | Location-specific offers deterministically rotated every \`BOARD_CYCLE_TICKS\` (10,800 = 3 minutes at 60 Hz). |
| \`catalog.makeOffer(gigId,difficulty,cycle?,slot?)\` | Deterministic generated offer for replay/test/debug tooling. Not the production accept path. |
| \`catalog.build(offer)\` | \`GigSetup\`: objectives, goal markers, start, limits and exact temporary dynamic prop spawn requests, all as plain data. |
| \`GigDirector(catalog)\` | One independent free-roam gig runner with board clock, bests, gold/cosmetic records and pending rewards. |
| \`director.board(poiId)\` | Current \`GigBoard\`. Board slot IDs become invalid when their schedule expires. |
| \`director.accept(offerId)\` | Accept **only a posted, current board offer**; returns a host-owned \`GigSetup\`. Throws if a gig is already running or the offer is expired. |
| \`director.startPractice(gigId,difficulty)\` | Sandbox/test shortcut; creates a valid deterministic run without a board offer. Do **not** expose as a client-authoritative reward endpoint. |
| \`director.abandon()\` | Ends a running gig without payment; returns whether it did anything. |
| \`director.step(frame)\` | Exactly **one** 1/60 s completed physics tick. No \`dt\` parameter; advances board clock and live gig, returns this tick's typed events. |
| \`director.active\` | Defensive \`GigRun\` copy (status, elapsed, typed objective, metrics, rating, payout, fail reason and immutable-by-convention setup). |
| \`director.personalBests\`, \`director.ownedCosmetics\`, \`director.pendingAwards\` | Defensive progression views. Bests are by gig *and difficulty*, first gold + cosmetic is by gig, pending awards cannot be lost by draining events. |
| \`director.onEvent(fn)\` / \`director.drainEvents()\` | Ordered, defensive, discriminated \`GigEvent\` stream, each event \`{tick,seq,type,...}\`. Subscriptions return unsubscribe. Recent pending history is bounded to 256; the award ledger is separate. |
| \`director.toJSON()\` / \`GigDirector.fromJSON(snapshot,catalog)\` | Versioned serialisable state, with board clock, active progress, metrics, event queue/sequence, pending/claimed rewards, gold flags and personal bests. Construct the **same catalog** before restoration. |
| \`director.acknowledgeAward(attemptId)\` | Low-level exactly-once ledger ACK after a successful external wallet credit. Prefer the bridge. |
| \`GigGameplayBridge(director,wallet,challenges,gameplayBus,forwardChallenges=true)\` | \`settle()\` credits pending payouts through \`CudWallet.credit\`, ACKs them, and optionally forwards only verified compatible achievements to \`ChallengeTracker\` via its existing \`EventBus\`. |
| \`GIG_IDS\`, \`DIFFICULTIES\`, \`TICKS_PER_SECOND\`, \`BOARD_CYCLE_TICKS\` | Stable catalogs and clock constants; exported alongside the complete type surface. |

Public types: \`Point\`, \`GigId\`, \`Difficulty\`, \`Rating\`, \`GigStatus\`,
\`GigVerb\`, \`GigInfo\`, \`GigOffer\`, \`GigBoard\`, \`GigPropSpawn\`,
\`GigMarker\`, \`GigConfig\` (and its eight discriminated variants),
\`GigSetup\`, \`GoatFact\`, \`PropFact\`, \`AbilityFact\`, \`StyleFact\`,
\`GigFrame\`, \`GigObjective\` (eight discriminated objective variants),
\`GigMetrics\`, \`GigRun\`, \`GigBest\`, \`GigAward\`, \`GigEvent\`,
and \`GigSnapshot\`.

## Integrating the actual game (not the sandbox)

\`\`\`ts
import { generateIsland } from '../world';
import { GameSimulation } from '../gameplay';
import { GigCatalog, GigDirector, GigGameplayBridge } from '../gigs';

const island = generateIsland({ seed: 'free-roam-save-01' });
const game = new GameSimulation(1234);
const catalog = new GigCatalog(island, 'free-roam-save-01');
let gigs = new GigDirector(catalog);
let rewards = new GigGameplayBridge(gigs, game.wallet, game.challenges, game.events);

// An in-world board (e.g. at Hoofington) asks for its current notices:
const offers = gigs.board('hoofington').offers;
const setup = gigs.accept(offers[0]!.id);

// PHYSICS HOST: spawn every setup.spawns entry as a dynamic Rapier body in
// the existing physics world (id, position, size, mass, fragile). Mark those
// instances so they can be destroyed on completion, failure or abandon.
// Do NOT mutate permanent world props, including Crane Yard's static tower.
// Show setup.markers as transient objective overlays/route rings.
// Use setup.start as the gig's start / check-in position.

// On EVERY COMPLETED PHYSICS 1/60-second tick (not on render frames):
const tickEvents = gigs.step({
  goat: {
    position: { x: goatX, y: goatY, z: goatZ },  // actual torso/feet reference
    size: goatSize,                            // 0.6, 1, 1.6 or 3
    onStreet: isActuallyTouchingStreet,        // true only from collision data
    grounded: isGrounded,
  },
  abilities: [
    // Each executed ability pulse for THIS tick, from gameplay/physics actions:
    // { type: 'tongue', targetId: 'hoofington-hay-bale-...' },
    // { type: 'headbutt', targetId: 'gig-tower-...' },
    // { type: 'climb', metres: measuredUpwardClimbThisTick },
    // { type: 'eat' }, { type: 'bleat' }, { type: 'flop' },
  ],
  props: [
    // ONE observed row per relevant gig prop/world bale on this tick:
    // { id: '...', position: {x,y,z}, velocity: {x,y,z},
    //   broken: false, heldByTongue: true, carried: false,
    //   tilt: 0, impact: thisTickActualContactImpulseNS },
  ],
  style: [
    // Gameplay-awarded style events ON THIS tick, not raw animation presses:
    // { type: 'big-splash', points: 20 },
  ],
});
rewards.settle();  // after evaluation, before saving
for (const event of tickEvents) {
  // Update UI from event types; release setup.spawns on terminal events.
  void event;
}

// Persist *both* game.toJSON() and gigs.toJSON() at the same fixed-tick
// boundary, after settlement; restore with GameSimulation.fromJSON and
// GigDirector.fromJSON(savedGigs, equivalentCatalog). Reconstruct the
// temporary physics bodies and resume their saved transforms separately.
\`\`\`

\`goatX\` etc. above stand for the host's real measured values; they are
**not defined by the gig module**. The core integration belongs to the core
lane and is intentionally not edited by this PR.

### Exact fact rules

- Coordinates are **metres, Y up** (X/Z are the island plane), and IDs must
  match the real world prop IDs or \`setup.spawns\` IDs. Feed \`props\` every tick
  even for resting props, not only when they move. Missing props do not count
  toward objectives. A broken parcel/gnome is a failure.
- \`abilities\` and \`style\` are **edge events**, not held inputs. Report only
  newly executed actions and newly awarded style points. \`tongue\` means a
  successful real attach, not a mouse-down without a hit. \`targetIds\`
  contains members of a physically connected bale chain for chain delivery.
  A valid \`eat\` is a collision/animation-confirmed grazing bite.
- \`PropFact.impact\` is the actual *this-tick* contact impulse in N·s, zero
  or absent otherwise. \`tilt\` is the physical tilt angle from upright in
  radians. \`velocity\` is metres/second. \`heldByTongue\` and \`carried\`
  must reflect real connection/carrier state. Rooftop failure prefers a
  contact-derived \`onStreet\`, and additionally checks minimum height.
- For climbs, report **measured positive upward progress per completed tick**
  as \`{type:'climb',metres}\`, not an "I pressed climb" input. Implausible
  reports above 0.4 m per tick are clamped.
- For a \`big-splash\` report an actual water entry already scored by
  gameplay/chaos. The splash gig checks this **and** the physical drop,
  jumping-board proximity and final water position.
- Call \`step\` once per actual physics tick even if your render frame is
  dropped. Never add an extra catch-up tick without corresponding physics.
  This lane has no random runtime reads, no frame-rate drift and no hidden
  physics forces. Do not mutate returned defensive copies.

### Gig rules / tuning

| Gig (real POI) | Objective and skill expression | Failure / rating skill |
|---|---|---|
| **HAY HAUL** (Hoofington) | Tongue-touch 3/4/5 actual island bales, then physically deliver them to the existing barn. Chain-tow 2+ simultaneously for a +15% multiplier per qualifying batch (max +30%). | Time expiry; gold requires a multi-bale delivery. |
| **ROOFTOP EXPRESS** (Downtown Bleatsville) | Temporary tongue-carried parcel across 3/4/4 roof checkpoints derived from actual walkable shop/house geometry. | Street touch, crushed parcel, lost parcel over 1 second. Gold: no lost-carry ticks. |
| **DEMOLITION CONTRACT** (Crane Yard) | Knock over a temporary, movable 3/4/5-layer marked construction tower **beside the real static tower**. Mass credit uses capped displacement from each piece's starting position; no repeated frame-scoring. | At least one headbutt required; move 56/64/72% of mass. Gold: 1–2 headbutts, silver: at most 5. |
| **MOW-DOWN** (Hoofington) | Clear every cell of a 4×3 / 5×3 / 6×4 lawn grid. Bites hit a radius around actual goat position; each cell scores once. | Gold needs an efficient path (at most half as many bites as cells); distant bites earn nothing. |
| **ESCORT THE GNOME** (Whispering Pines) | Physically nudge a tiny temporary gnome through 4/5/6 route flags. Goat must remain close enough to escort. | Breaks on actual contact impulse ≥48/36/27 N·s or \`broken\`; gold avoids hard impacts. |
| **STACK-UP** (Crane Yard) | Physically stack 2/3/4 out of 4/5/6 crates, aligned on a marked base. Each level must be upright, near-resting, supported by the level below. | Any wobble or missing layer resets the **full 300-tick (5 s)** hold. Gold stacks an extra layer. |
| **SUMMIT SPRINT** (Mt. Gigga) | Climb sequential cliff shelf flags then summit, with minimum real measured climb 4/7/10 m. | Gold needs 1.5× climb goal while fast; checkpoints alone cannot win. |
| **SPLASH DIVE** (Baa-ardwalk) | Reach the world platform's high board, leap into the pier water with a real \`big-splash\`. | Must drop at least 3/5/7 m. Gold drops 2.5 m beyond that minimum. |

**Difficulty** changes goals, routes/objects, clock, and reward multiplier:
Rookie \`easy\` ×1; Pro \`medium\` ×1.35; Legend \`hard\` ×1.7.
Any valid finish gets **bronze**. Silver needs to finish within 82% of
the contract time and meet its silver skill rule. Gold needs 55% and the
gold skill rule. Final coins are \`round(baseCoins × difficultyMultiplier ×
ratingMultiplier × (1 + skillBonus + min(.2, stylePoints/400)))\`,
with rating multipliers **bronze ×1, silver ×1.45, gold ×2.05**.
First gold on each **gig ID** adds **100 Cud Coins** and owns that
gig's cosmetic hat/horns/trail/badge. This never grants gameplay power.
Only best scores improve: rating beats time, then faster time breaks ties.
Repeats continue to pay the full regular award; gold/cosmetics never
double-award. Player-facing boards have seeded three-minute rotation and
show their difficulty; accepting does not eject a run when the board rotates.

### Gameplay wallet/challenge caveat

Gameplay \`UnlockRegistry\` exposes **purchase** but no public cosmetic
\`grant\`, so these eight gig-exclusive cosmetic IDs are owned in
\`director.ownedCosmetics\`; the UI/appearance adapter may present/equip them
without changing existing game unlock prices or prerequisites. Gameplay
\`ChallengeTracker\` has no generic gig-progress method; it listens to the
public \`EventBus\`. \`GigGameplayBridge\` credits verified Demolition
Contract completion as one \`wrecking-crew\` destruction, and verified Summit
Sprint measured climbing as \`mountain-goat\` traversal. Other gigs do **not**
fabricate trick, build or traversal events. If the main game has already sent
these identical physical actions to the gameplay bus, pass
\`forwardChallenges=false\` to avoid duplicate challenge increments.

The \`GigDirector\` award ledger prevents repeat wallet credits **after**
settlement, including across restored snapshots. Persist the wallet/gameplay
and director together immediately after \`bridge.settle()\`; saving one side
without the other is not atomic and could otherwise pay twice after a crash.
Do not trust developer \`startPractice\` or save snapshots as multiplayer
server-authoritative requests.

## Developer console / tests

\`npm run dev\`, then open **/src/gigs/sandbox/index.html**. Select any gig,
tier and seed, or accept a currently rotating job-board offer. WASD moves a
top-down simulated goat; T licks a prop, Shift+T grabs a nearby cluster,
X releases, H headbutts, E bleats, F grazes, C climbs, Space jumps and Q
flops. Drag selected props, change their height and use the goat altitude
slider to inject observed 3D positions. The console shows the real typed
objective, timer, projected medal pace, wallet payout, personal best,
unlocked cosmetic and gig events. Pause, single-step or run at 1×/4×/16×.
**The sandbox intentionally does not claim to solve Rapier physics.**

\`npm run ci\` runs the repository's strict TS, Vitest and production Vite
build. \`gigs.test.ts\` includes world-grounded placements, rotating/expired
offers, seeded reproducibility/variation, **scripted bronze/silver/gold runs
for all eight gigs at all three difficulties**, bespoke anti-cheat and
failure conditions for each gig, exact timer boundaries, style/skill
payouts, first-gold unlocks, personal bests, event order, challenge/wallet
bridge and snapshot replay. All scripts feed the production \`step(facts)\`
API, not a test-only "complete" method.
