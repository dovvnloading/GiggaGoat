# Gigga-Goat / Party Modes

**Status:** deterministic rules, three playable rounds, seedable solo bots, headless
mock-island runner, and interactive developer console. This entire lane uses TypeScript
data. No Three.js, Rapier, DOM, timers, randomness from the environment, network or
wall clock enters the production rules/brains. The sandbox is the only DOM consumer.

Start with `import { PartyMatch, BotBrain, arenaFromBillyIsle } from './modes';`.

## Public API (`src/modes/index.ts`)

| Export | Contract |
| --- | --- |
| `PartyMatch({mode, seed?, config?}, arena)` | Authoritative 60 Hz match with lobby → countdown → playing → overtime → results. |
| `match.join({id,name,teamId?,bot?})` / `setReady(id,ready)` / `start()` | 2–8 ready goats, lobby only. Hay Heist requires 2–4 teams and one non-overlapping barn per team. |
| `match.step({goats,intents?,contacts?})` | **Exactly one** 1/60-second tick; returns events emitted on this tick. No physics is performed. |
| `match.view()` | Defensive player/bale/score copies and readonly arena reference for rendering, bots and HUD. |
| `match.getEffects(id)` | Whether sprint is permitted, movement speed multiplier, held bale ID, carry stamina drain (per second). |
| `match.onEvent(callback)` / `match.drainEvents()` | Typed synchronous event stream; ordered `{tick,sequence,type,…}`, bounded pending history (256). An unsubscribed callback never fires again. |
| `match.toJSON()` / `PartyMatch.fromJSON(snapshot,arena)` | Versioned JSON snapshot containing counters, scores, contacts, bales, timers, pending events and event sequence. No functions, objects from engines or listener references. |
| `BotBrain(id, 'easy'|'normal'|'hard', seed)` | A bot with a separate seed-based PRNG. `decide(view,goats)` outputs `ModeInputIntent`, **identical to human inputs**. `goal` exposes current tactic. `toJSON/fromJSON` restore planning/RNG memory. |
| `arenaFromBillyIsle(island, readers, teamIds?)` | Read-only bridge to `src/world`: consumes `island.tideLevels`, injected public world `landAreaAtTideLevel` / `heightAt` functions, Mt. Gigga's centre and temporary barn positions near POIs; no transitive Rapier load. |
| `MODE_DEFAULTS`, `TICKS_PER_SECOND` | Named baseline tuning and fixed 60 Hz contract. All tuning is overrideable per match. |

The index also exports the complete type surface: `ModeId`, `Phase`, `Position`,
`Point`, `PlayerSpec`, `PlayerState`, `ModeArena`, `Barn`, `GoatObservation`,
`ModeInputIntent`, `GoatContact`, `ModeFrame`, `RulesConfig`, `MatchOptions`,
`Placement`, `TeamPlacement`, `Bale`, `MatchEvent`, `MatchSnapshot`,
`MatchView`, `GoatModeEffect`, and `BotSnapshot`.

### Minimal host integration

```ts
import { generateIsland, heightAt, landAreaAtTideLevel } from '../world';
import { PartyMatch, BotBrain, arenaFromBillyIsle } from './index';

const island = generateIsland({ seed: 'lobby-17' });
const arena = arenaFromBillyIsle(island, { heightAt, landAreaAtTideLevel });
const match = new PartyMatch({ mode: 'rising-tide', seed: 17 }, arena);
match.join({ id: 'you', name: 'You' });
match.join({ id: 'goat-bot', name: 'Velcro Dave', bot: true });
match.setReady('you', true);
match.setReady('goat-bot', true);
match.start();
const brain = new BotBrain('goat-bot', 'normal', 17);

// At EACH completed physics fixed-timestep (not once per render frame):
const observations = [
  // From the host's actual goat transforms and head rigid body.
  { id: 'you', position: { x: 2, y: 35, z: 0 }, headY: 36,
    facing: { x: 1, z: 0 } },
  { id: 'goat-bot', position: { x: -2, y: 36, z: 0 }, headY: 37,
    facing: { x: -1, z: 0 } },
];
const input = brain.decide(match.view(), observations);
const events = match.step({
  goats: observations,
  intents: { 'goat-bot': input },
  contacts: [], // Host filters real goat–goat hit/contact callbacks into IDs.
});
for (const event of events) {
  if (event.type === 'tide.rose') {
    // chaosWater.setSeaLevel(event.level);
    // worldVisuals.setTideLevel(event.level);
  }
}
```

In production, the host should use `arenaFromBillyIsle(island, { heightAt, landAreaAtTideLevel })` and listen for
`tide.rose` to update existing Chaos `WaterSystem.setSeaLevel` and world
`WorldScene.setTideLevel` methods. Pass the same actual head height the physics
ragdoll uses, including climbing and flotation; don't infer from terrain alone.
All observations (including eliminated goats still present in the world) are supplied
once each active tick. If players disconnect, the host must explicitly settle/replace
them; the rules engine intentionally never guesses a network policy.

The player/AI intent is `ModeInputIntent extends gameplay.GoatIntent` plus normalized
world-space `moveX`, `moveZ` and optional `dropHay`. The host translates these
into physics `locomotion.setInput` (camera yaw) and gameplay ability actions.
Mode inputs never issue impulses directly; the physics host supplies actual contact
facts in `contacts`. Events carry immutable-by-convention payloads. A side-effecting
event listener should not mutate the match recursively.

### RISING TIDE (last goat standing)

The world-provided, strictly ascending `tideLevels` are stepped on a known fixed
schedule (default every 18 seconds); a warning precedes each rise by four seconds,
including the **actual dry land in m²** from the world API. The sea never drops.
Head height at or below the current waterline for 90 **consecutive** ticks = a
splash. Climbing out resets the counter. A real player-to-player contact within
the last six seconds earns a shove credit when the victim splashes; same-tick
competing contacts use a deterministic ID tie-break, not callback arrival order.
No health, weapons or damage. Multiple goats splashed in the same tick tie for
their elimination placement, including an everyone-splashes joint first.

At the last level, or the time limit if reached first, **overtime** starts and
the final perch is contested for at most 25 seconds. One surviving goat wins
immediately. At the overtime cap, the highest surviving head wins; equal heights
when rounded to the nearest centimetre share first. Placement prizes are 100/65/45/30/20/12/8/5; tied
ranks split the rewards of their occupied slots equally. Rank jumps over ties.

### KING OF THE PEAK

The circular summit zone is centred on the world Mt. Gigga POI and requires being
on its upper terrace (at most six metres below summit Y). **Exactly one goat**
in the zone earns three points per *full, uncontested* second. Two or more goats
contest the zone and cancel its accumulated capture time; an empty zone also
resets it. The first to 90 points wins, or highest total at three minutes.

Catch-up has a visible rule rather than hidden rubber-banding: a goat at least
20 points behind the current leader earns **one extra point per uninterrupted
second of capture**. When tied on the clock, golden-point overtime starts:
the first capture second that breaks the lead wins. If nobody captures before
the cap, the tie is retained and equally rewarded.

### HAY HEIST

Two to four teams have separate barns (11 m capture circles on Billy Isle, or
supplied circles on a custom arena). Each barn starts with three bales. Hold
tongue near any free bale to pick it up; releasing, pressing `dropHay`,
running out of stamina or an enemy headbutt drops it. Shoved carriers have
half a second of pickup lockout so the defender gets a real steal window. Headbutts also punt
nearby loose bales in the observed direction. A bale only scores at an
**opposing** barn when last touched by that barn's team; friendly bales taken
home are returned, not scored. Bales respawn at their source after scoring.
The target is five captures, with score ties going to a golden-delivery overtime.

Carrying cuts movement speed to 70%, disallows sprint, and consumes **9
mode stamina per second**. Mode stamina regenerates when not carrying at 7/s.
Use `match.players[i].stamina` for the party HUD and `match.getEffects(id)`
for movement/gating; do not double-consume the gameplay ability-system stamina
when integrating. Physics may render a tether/physical bale, but the mode's
serialized bale owner and score are authoritative.

### Determinism and test/dev console

No `Date`, `performance.now`, `setTimeout` or `Math.random` is read by the
rules or bots. All scores/times are computed in integer ticks; a host must call
`step` once per completed 60 Hz physics step, even when render frames are
dropped. Snapshot the **match and each bot brain** at the same tick boundary,
plus external transforms. On restoration create an equivalent arena first.

Run `npm run ci` for strict TypeScript, Vitest and the production build.
Tests cover state transitions, all rule types, flood warnings, consecutive
submersion, simultaneous eliminations, deterministic last-touch arbitration,
credit expiry, peak contests, comeback bounds, recovery/punts/stamina, ties,
overtime caps, snapshot replay, real world-data bridging and complete simulated
four-bot matches on a physics-free mocked island.

For a graphical inspection, run `npm run dev` and open
**/src/modes/sandbox/index.html**. It deliberately stays outside the root
production entry. It draws a top-down island using the locked art palette
(grass `#77B754`, sand `#F7DB99`, deep/shallows `#0F669E`/`#21A8C6`,
hay `#F2C14F`, barn red `#D84F3D`, GIGGA purple `#7A4CFF`),
waterline/terraces, goats, barns, bales, scoreboard and typed event feed.
Choose 2–8 goats, all AI or one keyboard goat, any difficulty and seed.
Pause, single-step, accelerate 16×, or export/restore the **whole** match + bot
brain + mock-transform snapshot to reproduce a collision/round precisely.
The console's terrain/physics are approximations for testing mode flow;
production island geometry and ragdolls remain the world/physics lanes' jobs.
