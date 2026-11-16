# Gigga-Goat — Design Bible

> Status: living document. Owned by the coordinator. Lane threads read it; they do not edit it.

## 1. Pitch

**You are a goat. Physics is your friend. Chaos makes you bigger.**

Gigga-Goat is a wobbly-physics open-island sandbox for the browser. You play a floppy,
physics-driven goat on **Billy Isle**, a small, dense island packed with things to climb,
lick, headbutt, launch and knock over. Causing *stylish* chaos fills your **GIGGA meter**;
fill it and your goat literally grows — Kid → Billy → Big → **GIGGA** — and the world
suddenly becomes a toy box at your feet.

Around that toy box sit three ways to play:

1. **Free Roam** — explore, do *Goat Gigs* (jobs) for Cud Coins, find secrets, unlock gear.
2. **Party Modes** — short, no-weapons competitive rounds (knock-outs, races, builds, hide-and-seek)
   on the same island, with a rising tide instead of a storm.
3. **Hay-Build** — a fast snap-grid building tool (ramps, walls, floors, launch pads) that is
   wobbly, physical, and knock-down-able.

Target audience: **ages 11–15**. They are not little kids. They want to look skilled in front of
friends, to be funny on purpose, to customise, and to always have something new to unlock.
No cringe narrator, no "random = funny" slop, no guns, no gore.

## 2. What we take from each reference (and what we refuse)

| Reference | Keep | Refuse |
|---|---|---|
| Wobbly Life | Wobbly active-ragdoll bodies that are *controllable*; jobs as repeatable physics mini-games; earn money → houses, outfits, vehicles; co-op energy | Slow, aimless driving jobs; tedious grind |
| Goat Simulator | Tongue that sticks to anything and drags it; headbutt everything; ragdoll on command; secrets everywhere; mutator-style abilities | Pure meme humour, broken-by-design jank that stops being funny after 10 minutes |
| Fortnite | Snap building as a *movement and creativity* skill; emotes and cosmetics as social currency; short rounds with a shrinking map; named POIs; constant "new this week" | Guns, eliminations-by-weapon, pay-to-win, battle-pass FOMO pressure |

**Our unique twists (the reason this isn't a clone):**

- **Size is the progression inside a session.** Style points grow the goat in real time. Size
  changes mass, reach, what you can push, and what can push you. Being GIGGA is a power fantasy
  with a timer; small goats are fast, nimble, and can climb where GIGGA can't.
- **Goats climb.** Mountain-goat wall-cling on steep rock and building faces, with stamina.
  Vertical traversal is a first-class skill, combined with tongue-swing and hay-ramps.
- **The tongue is a grappling hook.** Lick-and-hold attaches a springy tether: drag objects,
  swing from lamp posts, tow friends, yank a rival off a ledge.
- **Rising tide, not a storm.** In Party Modes, the sea rises and the island shrinks from the
  shoreline up, ending on the mountain peak. Losing = splash.
- **Style over damage.** There is no health bar. You win fights by knocking goats into water,
  off edges, or into a ragdoll long enough to steal their hay. Funny and skill-based.

## 3. The goat (player character)

Physics-driven **active ragdoll**: a rigid torso + neck/head + four legs held up by joint motors
toward an animated target pose, with a balance controller. Hits, falls and big impacts reduce
"balance" and can fully ragdoll the goat; it recovers by itself after a short beat.

| Verb | Input (kb/mouse) | Feel |
|---|---|---|
| Move / sprint | WASD / Shift | Wobbly but responsive; bouncy gallop at sprint |
| Jump | Space | Springy; double-tap mid-air for a **flip** (style points) |
| Headbutt | LMB (hold to charge) | Forward lunge with impulse proportional to charge and size |
| Lick / tongue | RMB (hold) | Sticky tether to whatever it hits; release to let go or fling |
| Bleat | E | Short radial shove + emote noise; spam-limited |
| Flop | Q | Instant ragdoll (for comedy, dodging, or rolling down hills) |
| Climb | Hold toward steep surface | Wall-cling with stamina drain; jump-off kick |
| Glide | Hold Space in air (once unlocked) | "Goat-chute" (cosmetic glider), slow descent |
| Build | B to toggle, 1–4 pieces, LMB place | Snap grid in front of the goat |

Stamina gates sprint, climb, charge. Balance gates standing up.

## 4. Chaos, style and the GIGGA meter

Every physics event can feed a **style event** (`flip`, `airtime`, `wall-climb`, `tongue-swing`,
`knockback`, `topple`, `destruction`, `near-miss`, `ragdoll-bounce`, `big-splash`...).
Events chain into a **combo** within a short window; variety multiplies, repetition decays
(spamming the same trick earns less). Combo points fill the GIGGA meter.

Size tiers: **Kid (0.6×) → Billy (1×) → Big (1.6×) → GIGGA (3×)**. GIGGA lasts while you keep
the combo alive and drains otherwise. Scale affects mass, impulse, reach, step height and camera.

## 5. Billy Isle (the world)

A compact (~600 m across) handcrafted-feeling island, generated deterministically from a seed so it
is identical for every player. Points of interest:

- **Hoofington** — starter farm village (barns, hay fields, fences, windmill). Spawn.
- **Baa-ardwalk** — seaside pier with a small amusement park (ferris wheel, bumper area, ramps).
- **Crane Yard** — construction site with cranes, scaffolding, stacked crates, half-built tower.
- **Downtown Bleatsville** — tiny dense town: streets, shops, rooftops to parkour across.
- **Mt. Gigga** — the central mountain: cliffs to climb, a summit with a satellite dish.
- **Whispering Pines** — forest with logs, a river and a waterfall.
- **The Dam** — reservoir and spillway (later: water physics fun).
- **Old Lighthouse** — rocky point on the far shore; secrets.

Roads/paths connect the POIs. Stylised, low-poly, bright, readable silhouettes; toon-ish shading.
Day/night cycle. Everything breakable or pushable should be a separate prop.

## 6. Progression & economy (later waves)

- **Cud Coins** from Goat Gigs, challenges and secrets. Spent on gear (hats, horns, fur patterns,
  gliders, trails, emotes), a goat house, and ability unlocks.
- **Gear can matter a little** (like Goat Sim gear) but never pay-to-win: sidegrade abilities.
- **Goat Relics**: 50 hidden collectibles across the island.
- No real-money anything.

## 7. Modes (later waves)

- **Free Roam** + **Goat Gigs**: Hay Haul (tongue-tow bales to the barn), Rooftop Express
  (deliver across downtown rooftops), Demolition Contract (topple the marked tower), Mow-down
  (eat the lawn before the timer), Escort the Gnome, Crane Yard Stack-up...
- **Party Modes** (2–8 goats): *Last Goat Standing* (rising-tide knockout), *Hay Heist*
  (steal hay from rival barns), *Build Race* (build up to a checkpoint), *King of the Peak*,
  *Hide & Bleat* (hide-and-seek where hiders can disguise as props).

## 8. Technical architecture

- **Browser**, TypeScript (strict), **Vite**, **three.js** for rendering, **Rapier**
  (`@dimforge/rapier3d-compat`) for physics, **Vitest** for tests. CI: typecheck + test + build.
- Fixed-timestep simulation (60 Hz) with render interpolation.
- Strict module lanes. Each lane exposes a small public API from its `index.ts` and is unit-tested
  headlessly (Rapier runs in Node).

| Lane | Directory | Responsibility |
|---|---|---|
| Physics | `src/physics/` | Rapier world wrapper, fixed stepping, collision groups, goat active ragdoll + locomotion, tongue tether, headbutt, impulses |
| World | `src/world/` | Deterministic Billy Isle: terrain, water, POIs, roads, dressing props as data, stylised renderer, colliders, viewer |
| Gameplay | `src/gameplay/` | Engine-agnostic rules: abilities/stamina/balance, style/combo/GIGGA, Hay-Build, Cud Coins, unlocks, challenges |
| Chaos | `src/chaos/` | Water and buoyancy, breakables and debris, chain reactions, surfaces, trampolines, launch pads |
| Modes | `src/modes/` | Party-mode rules engine (Rising Tide, King of the Peak, Hay Heist) and bot goats |
| Gigs | `src/gigs/` | Goat Gigs free-roam job framework and contracts |
| Audio | `src/audio/` | Procedural Web Audio SFX, adaptive music, ambience (in progress) |
| Core | `src/core/`, `src/main.ts` | The playable game: wiring of all lanes, camera, input, HUD, menus. Only touched by explicit integration tasks |

Rules for lanes: no lane imports another lane until an integration task says so; shared types that
two lanes need are duplicated minimally or introduced by an integration task.

## 9. Roadmap

1. **Wave 1 — foundations (no art, no playability yet):** physics core, world generation, gameplay rules.
2. **Wave 2 — integration:** a playable goat in the generated island with camera, input, HUD stub.
3. **Wave 3+ —** abilities wired to physics, Hay-Build in world, first Goat Gigs, first Party Mode,
   goat model + animation polish, audio, cosmetics, menus, multiplayer.
