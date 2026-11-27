# Living Billy Isle — production roadmap and quality standard

**Status:** Downtown pilot and shared environmental motion implemented for review in [#330](https://github.com/dovvnloading/GiggaGoat/pull/330); milestone acceptance remains open. See the [implementation and evidence notes](qa/living-world-pilot.md).
**Audit baseline:** [main at 6f5da81](https://github.com/dovvnloading/GiggaGoat/tree/6f5da81912cecec3fa6cdd659a7fb69e994e52ee), reviewed 2026-11-25.  
**Scope:** free-roam environmental art, ambient life, reactions, animation, sound, and traversal presentation across all eight districts.

## 1. North star

Billy Isle should feel like a small, inhabited world that carries on without the player. From a rooftop, a player should be able to watch people going about their day, activity at shops and farms, wind moving through the streets, birds, vessels and landmarks in motion, and a town that changes as daylight fades. When the goat intervenes, that same world should react and recover.

Aim for premium/AAA-level **craftsmanship**, not photorealism or an unbounded simulation. Keep the compact, colourful, present-day cartoon island, readable goat-scale proportions, intentional compositions, playful physics and the browser performance target. A dense scene full of generic props, a crowd of sliding mannequins, or more animation at the cost of frame pacing is not success.

This roadmap complements the [design bible](../DESIGN.md), [reference art](README.md), [world art plan](WORLD_ART_PLAN.md) and [lived-in detail pass](LIVED_IN_WORLD.md). It does not supersede the art lead's asset selection, palette, scale, approval or layout requirements. New character, prop and animation designs need review against that direction; do not ship temporary geometry or off-style kit assets to meet a count.

## 2. Tracking contract

Use the stable IDs below in follow-up issues, implementation PR titles/descriptions, and evidence. Check a task only when its acceptance conditions and the applicable release gates are met and its implementation has merged. In the same PR, append the issue/PR number, tested commit and links to the relevant captures/profile results in the **Progress log**. Keep blocked work open and record the blocker; do not check a box for a plan, a partial prototype, or a green build alone. Split larger tasks into child issues using the same ID prefix.

- **P0:** first playable quality reference; blocks general rollout.
- **P1:** high-value island-wide work, following the reference and infrastructure.
- **P2:** district expansion and refinements; not permission to lower the quality bar.

The only baseline entries marked complete below are already-merged foundations, not assertions that the current game meets this roadmap. Counts, budgets and benchmarks are proposed until the pilot establishes a measured baseline. No implementation issue numbers or new test results are fabricated here.

## 3. Source audit and foundations

- [x] **BASE-01** — [#329 Living Isle pass 1](https://github.com/dovvnloading/GiggaGoat/pull/329): district-specific bleat discoveries, visual reactions, first-discovery rewards and save persistence. Preserve their stable IDs and reward rules.
- [x] **BASE-02** — [#328 World art detail pass](https://github.com/dovvnloading/GiggaGoat/pull/328): material detail, pavement wear, ground-story batches and pollinators.
- [x] **BASE-03** — the source audit found animated livestock, harbor boats and gulls, fireflies, foliage sway, water, day/night, weather and location ambience.

| Area | Evidence at audit baseline | Gap / implication |
| --- | --- | --- |
| Human activity | [Downtown visuals](../../src/world/visual-downtown.ts) bake the static plan into district LODs; [district sets](../../src/world/district-sets.ts) stage markets, cafés, loading and work areas. | Furnishings and evidence of work exist, but ordinary residents with believable routines and reactions are the missing connective tissue. |
| Animal and harbor life | The baseline had idle and grazing animations at fixed pasture anchors. [Harbor life](../../src/world/visual-harbor-life.ts) uses orbital boats and flocks. [Pollinators](../../src/world/visual-pollinators.ts) have seeded periodic flights. | The low-poly livestock models were removed because their style clashed with Hoofington. Future livestock placements require art approval. |
| Environmental motion | [Prop visuals](../../src/world/visual-props.ts) drive foliage with time and instance-position sine waves; [world renderer](../../src/world/render.ts) already coordinates time, tide, daylight, rain and culling. | Shared wind/gusts, material-specific response and safe dynamic landmarks can give motion a common cause. |
| Reactivity | [Island happenings](../../src/core/IslandHappenings.ts) and [happening visuals](../../src/core/HappeningVisuals.ts) implement short optional bleat scenes. | Broaden to ordinary local responses to accepted goat actions and physical commotion; avoid turning every ambient scene into a HUD quest. |
| Atmosphere | [Weather](../../src/world/island-weather.ts) uses a 480 s playable day and independent weather fronts; [zone ambience](../../src/audio/zone-ambience.ts) crossfades recorded ambience. | Make the world visibly and audibly change with the weather/time; avoid hard cutoffs and disconnected loops. |
| Density and QA | [Environment report](qa/island-environment/report.md) documents remaining large lawn/paving stretches and the limits of still frames; [island QA pass 3](qa/island-qa-full-3.md) records historical weak approaches. | Re-walk current builds before treating historical findings as unresolved; repair actual empty stretches with purposeful compositions. |

Both baseline merge commits had successful CI runs ([#328](https://github.com/dovvnloading/GiggaGoat/actions/runs/45606568463), [#329](https://github.com/dovvnloading/GiggaGoat/actions/runs/45505735560)). This audit is source-based, not an independent runtime visual review. Green CI does not prove premium animation, hardware FPS, visual quality, or route safety across every new feature.

## 4. Milestones — deliver in order

### M0 — Baseline and acceptance setup (P0)

- [ ] **LW-001** — Capture the current production seed in actual gameplay: first 60 seconds from spawn, Downtown main street/fountain/market, all eight district approaches and the connecting roads. Record exact SHA, seed, camera, quality, weather, browser, OS, device, resolution/DPR and renderer. Preserve footage and raw profiles in linked artifacts. Use the same paths before/after; capture fully streamed assets.
- [ ] **LW-002** — Agree on the reference hardware and baseline CPU/GPU/frame pacing, draw calls, triangles, active bodies, memory and asset-load budgets. Identify which current visuals are actually static, popping, clipping or repeating excessively. Reconcile historical QA against the current build; review open mountain traversal [#235](https://github.com/dovvnloading/GiggaGoat/pull/235) before modifying routes.
- [ ] **LW-003** — Art lead approves resident silhouettes, proportions, palette, rigs, locomotion and a small hero-street composition against the reference art. Review the [character kit](../../public/assets/library/kenney/mini-characters) and [car kit](../../public/assets/library/kenney/car-kit) as candidates. Confirm licensing, attribution and animation coverage.

**Exit:** recorded before-state, approved pilot scope and art, reproducible performance baseline, and agreed gates. No visual claims based on mockups or unstreamed placeholder assets.

### M1 — Living Downtown vertical slice (P0)

Target a coherent walk from the main street through the fountain square and market/café area, using actual paved footprints from [downtown-public-space.ts](../../src/world/downtown-public-space.ts) and approved dressing anchors. Start here rather than shipping eight thin, inconsistent passes.

- [ ] **LW-101** — Deterministic pedestrian navigation: author/derive connected safe walking and station paths; validate swept width, support height, crossings, slope, door clearances, props/colliders and gig/spawn/relic exclusion. Omit unsafe sites. Test multiple seeds and supported island sizes.
- [ ] **LW-102** — A small resident cast with destinations and occupations (market vendor, shopper, café guest, delivery worker, walker). Blend walk/turn/stop, idle and station animations with speed-matched gait, planted feet and stable ground contact. Vary phase, pacing and dwell time; no synchronized cycles, visible teleportation or walking through furniture.
- [ ] **LW-103** — Daily schedules and weather-aware activity: opening/delivery in the morning, market activity by day, shelter during rain, evening departures and reduced night activity. Transitions are performed in-world or hidden from view, not sudden actor deletion.
- [ ] **LW-104** — Player reaction and recovery: look/turn, wave/startle, yield, flee when appropriate, return to destination after cooldown. Distinguish harmless proximity from an accepted bleat/headbutt/chaos event. Handle goat size and prevent actor overlap, reaction storms and repeated rewards.
- [ ] **LW-105** — Make the fountain, shopfronts and café/market tell a consistent story: flowing water, approved moving fabric/signs, subtle steam, service details, occupied seating and evening window lighting. Preserve navigable sidewalk and rooftop routes. Add art-approved props in functional clusters, not filler.
- [ ] **LW-106** — One complete reactive market micro-scene: goat disrupts a deliberately interactive produce display; bounded fruit physics and existing chaos/SFX systems respond; vendor and nearby actors react, then recover. Noninteractive decorations must not look misleadingly usable; no required violence, progression changes or uncontrolled rigid body growth.
- [ ] **LW-107** — Spatial sound for the pilot: footsteps and approved resident cues, fountain, activity at stalls, near/far attenuation and weather/zone transitions. Audio follows events and positions, uses existing engine and respects mute/settings, voice caps and browser unlock.

**Exit:** film a continuous 90–120 s goat-height walk (also idle on a rooftop and revisit the same scene after a reaction). It must read as an occupied street even without interaction; a human reviewer must accept animation, collision, art, performance and sound. Fix the pilot before island-wide rollout. Proposed initial visible population: 12–18 nearby residents on High, tuned to measured readability/budget rather than a quota. Lower settings may reduce distant detail but must preserve gameplay and coherent motion.

### M2 — Shared environmental motion (P1)

- [ ] **LW-201** — Seeded, continuous wind direction/speed/gust field, sampled consistently with environment time. Drive material-appropriate motion: anchored trees/grass/flags/fabric, smoke/steam/mist and compatible water/boat cues. Avoid synchronized rocking, mesh-root sliding and motion that contradicts physical supports. Wind must be continuous across weather changes and district boundaries.
- [ ] **LW-202** — Audit existing landmarks and animate only missing motion: windmill sails, Ferris wheel/gondolas, fountain, lighthouse beacon, approved crane/hoist and machinery. Split real model parts at correct pivots, keep gondolas upright, add matching sound/lighting, and verify every accessible solid surface against actual collider motion. If a moving piece is gameplay-accessible, coordinate physics and visuals or leave it static until a safe design is approved. No rotating solid art through stationary collision.
- [ ] **LW-203** — Smooth ambient visibility and behavior transitions for birds, boats, insects and night lights. Use hysteresis, conservative bounds, hidden spawn/despawn or supported fades; avoid weather/distance flicker, expensive transparent layers and resets at frame-rate changes.
- [ ] **LW-204** — Coherent local rain, drip, wetness, mist, shelter and audio changes. Preserve existing shaders and weather clock; provide meaningful software fallback where possible. Do not add expensive full-screen effects without profiling.

**Exit:** a single gust feels related across nearby foliage, flags, fabric and audio; animated landmarks stay physically credible; daylight/rain/tide changes have no visible discontinuities or navigation regression.

### M3 — Landscape density and exploration (P1)

- [ ] **LW-301** — Repair the first-minute route from spawn and sparse district approaches with composed hedges, woodland belts, meadows, fences, paths, rock clusters and roadside stops. Establish foreground/midground/background depth, visual landmarks and recognizable transition cues. Protect travel corridors, sightlines, party arenas and intentional open play spaces.
- [ ] **LW-302** — Enrich coastline with authored beach activity, driftwood/shell and vegetation groups, tidal rock pools where appropriate, dock/fishing equipment and offshore interest. Respect tide levels, swim routes, dock geometry, physics and access to existing secrets. Avoid uniformly scattering items around the entire shoreline.
- [ ] **LW-303** — Add optional small discoveries and purposeful physical objects along quiet routes using existing discovery/chaos systems. No mandatory new HUD prompts, economy farming or duplicate gig mechanics.
- [ ] **LW-304** — Establish a repeatable ground-level composition review: compare routes before/after at goat height, medium and far distance, with daylight and dusk. Ensure meaningful scenery, natural gaps and safe traversal; do not hide emptiness behind fog or add clutter solely to raise prop counts.

**Exit:** every intended travel segment alternates readable open play space with deliberate local interest; all relevant route and collectible tests pass.

### M4 — Traffic, wildlife and reactions (P1)

- [ ] **LW-401** — Small road activity pilot: delivery vans, tractors and occasional civilian cars. Derive safe lane paths from roads, validate turns/grades/bridges, manage stops, obstacle and actor avoidance, and wheel/steering animation. No road traffic on trails, flooded segments, mission routes or unsafe gates. If interactable, define collision/impulse and goat recovery behavior explicitly.
- [ ] **LW-402** — Introduce farm animals that match Hoofington's art direction. Use approved walk, rest and alert clips, constrained paddock paths and player reactions. Chickens and other approved fauna stay in suitable habitats. Validate swept paths, contact and tide safety.
- [ ] **LW-403** — Vary existing harbor and inland bird/wildlife movement using deterministic waypoints and behavior phases (rest, forage, takeoff, glide, return); smooth changes in wind and weather. Validate coast/terrain/prop clearance along full paths, not just endpoints.
- [ ] **LW-404** — Event propagation for nearby reactions: coalesce accepted physics/bleat/chaos events, cap radius/rate and prioritize important responses. Actors and traffic yield without deadlocking, clip-free recovery returns the scene to ordinary activity. Preserve gig/party/build behavior and save semantics.

**Exit:** demonstrate a natural interruption and recovery, ordinary routines without the player, and stress tests with repeated commotion. No unsafe traffic, wildlife overlap or unbounded work.

### M5 — Extend to all districts (P2)

Complete each district only when its own checklist below passes the same visual/technical gates as the pilot. Start with Hoofington and Baa-ardwalk; expand in the order informed by baseline QA. Reuse the proven systems, with genuinely district-specific behavior, not cloned Downtown crowds.

### M6 — Integration and release (P0 release gate; after M1 for pilot and after each rollout)

- [ ] **LW-601** — Full adversarial tour on the production seed and a documented alternate-seed set; all sizes, settings, weather/time, gig/party/build/rescue and reload cases. Compare actual game and World Lab when appropriate.
- [ ] **LW-602** — Pass current CI, real-browser profile, reference-device capture and memory/long-session stress review. Fix regressions rather than weakening tests or dropping useful art to conceal poor implementation.
- [ ] **LW-603** — Independent human art and gameplay/technical review with linked evidence and outstanding defects. No unresolved critical/high-severity visual, interaction, route or performance defects. Reopen any task if later regression invalidates its evidence.

## 5. District backlog

These IDs track outcomes, not quantities. Use the listed reference paintings and existing layout. Confirm actual anchors/asset approvals in each implementation PR.

- [ ] **LW-D01 Downtown Bleatsville (11; M1 reference).** Residents and occupations, café terraces and market activity, delivery alley, readable storefront detail, active fountain, warm dusk windows, moving awnings/signs and local sound. Later add restrained traffic and bicycle detail if navigation/rigs are approved. Acceptance: main street, fountain and market work as one connected inhabited scene without blocked paths or rooftop gigs.
- [ ] **LW-D02 Hoofington (08).** Farmers at harvest/packing stations, improved livestock, wandering chickens, tractors, working windmill, clotheslines, gardens, hose/wheelbarrow/produce detail and worn working paths. Preserve field entrances and Hay Haul. Acceptance: morning-to-evening farm routine reads from the road and at goat height; animals never walk through fences or crops.
- [ ] **LW-D03 Baa-ardwalk (09).** Active attractions and upright Ferris wheel gondolas, visitors around snack/ice-cream stalls, approved balloons/arcade lighting, fishing, moored boat motion, gulls that rest and take flight, beach towels/sandcastles/umbrellas in plausible groups. Acceptance: continuous promenade and swimming access; clear silhouette and welcoming dusk activity without confusing collision or crowded ramps.
- [ ] **LW-D04 Crane Yard (10).** Workers at actual inspection/haulage stations, staged machinery, rotating mixers/conveyors, warning lights/sounds and safe crane movement; purposeful cargo and interactive chain reactions. Acceptance: believable working yard, clear haulage gates, tower routes and physics budget; any moving load has correct collision or is out of reach and visually unambiguous.
- [ ] **LW-D05 Whispering Pines (13).** Habitat-specific birds and approved small wildlife, undergrowth movement, leaf fall, hikers/campers, canoe/woodcutting activity and campfire/smoke where safe; preserve existing fireflies and water. Acceptance: quiet and lively moments alternate; forest trails, lookout, log access and river crossings stay clear.
- [ ] **LW-D06 Mt. Gigga (12).** Hikers/rest points, expedition caches, flags/windsocks, soaring birds, mist and waterfall spray. Keep ridgelines readable and all trail/ledge/cave/summit routes intact. Acceptance: sense of altitude and weather without hidden hazards or loss of climbing access; coordinate with #235 and current route tests.
- [ ] **LW-D07 The Dam (14).** Maintenance activity, readable gauges/indicators and mechanical motion, local mist/water turbulence, turbine/pump sound. Acceptance: working infrastructure, existing spillways and dry/water routes remain physically correct; avoid rotating objects on playable paths.
- [ ] **LW-D08 Old Lighthouse (15).** Night beacon, keeper and fishermen routines, net/rope/boatyard detail, tidal shore life and varied offshore passage. Acceptance: cinematic dusk approach and night identity without obscuring the cave, relic, keeper path or dock routes.
- [ ] **LW-D09 Between districts (18).** Connect the compositions through roads, fields, forest belts, beach edges, landmarks and small optional moments. Acceptance: first minute from spawn and every district-to-district approach meet LW-301–304; leave intentional spaces for goat movement and party play.

## 6. Proposed engineering seams

The Downtown pilot now implements these seams in `ambient-life.ts`, `ambient-navigation.ts`, `environment-wind.ts`, `visual-ambient-life.ts`, `IslandLifeDirector.ts`, `MarketScene.ts` and `IslandLifeAudio.ts`. Keep the [world lane](../../src/world/README.md) independent from core/gameplay/physics when extending them.

| Concern | Suggested location / existing integration |
| --- | --- |
| Seeded actor/activity planning and stable IDs | New world-local ambient-life module; isolated PRNG streams; immutable plans, no mutation of existing terrain/props/relics/spawns or their RNG. |
| Walkable/driveable routes and station clearance | New world-local ambient-navigation module; reuse terrain sampling, road/public-space/access paths, footprints and collider descriptors. Use deck/surface height where terrain is not the supporting surface. |
| Environmental clock and wind | New world-local environment-wind module; integrate [island-weather.ts](../../src/world/island-weather.ts), [render.ts](../../src/world/render.ts), and visual adapters. |
| Actor presentation | Use approved GLBs, shared geometry and materials, and animation LOD in the ambient-life module. Integrate [harbor life](../../src/world/visual-harbor-life.ts) and [prop visuals](../../src/world/visual-props.ts). |
| Schedules, event mediation, gameplay rules | Core-side IslandLifeDirector (or equivalent); existing [Game.ts](../../src/core/Game.ts), happenings, chaos/physics/gameplay events. World must not import core. Reuse deterministic fixed simulation time for authoritative reactions; interpolate presentation. |
| Runtime budgets, lifecycle | [GameView.ts](../../src/core/GameView.ts), [GraphicsQuality.ts](../../src/core/GraphicsQuality.ts), existing culling, adaptive resolution, cached shadows and [dynamic body budget](../../src/chaos/DynamicBodyBudget.ts). |
| Sound | [GameAudio.ts](../../src/core/GameAudio.ts), [zone-ambience.ts](../../src/audio/zone-ambience.ts), existing event, asset and voice management. |

Separate logical population from rendered actors; use nearby budgets and low-frequency/analytical far scheduling. Avoid all-pairs avoidance, per-frame allocation/fetching, one light or material per actor, and full NPC physics for purely ambient motion. If a distant actor must transition state, it should do so consistently without teleporting in the player's view. Reuse existing time rather than introducing conflicting clocks. Discard late async load results on disposal, release owned resources only, and cover regeneration/reload. No new runtime dependency without justification and review.

Party modes and active gigs must not gain accidental obstacles, scores, interference or changed routes. Maintain a policy for suppressing nonessential activity where necessary, including rising tide and build mode; keep visible motion coherent on entering/leaving those modes. Changes to physics, save schema or progression require their own reviewed contracts and tests.

## 7. Non-negotiable adversarial review gates

Apply to every implementation PR; state N/A with a reason only where genuinely inapplicable. A green CI alone is insufficient. The reviewer should actively try to disprove quality claims and require real evidence. Do not mark off gates on the basis of a proposal.

- [ ] **Q01 Art and composition:** matches approved stylized reference, silhouettes, materials, scale and palette. No grey-box filler, generic asset dumping, floating details, texture noise, duplicate props or clutter obscuring interactions. Inspect fully streamed goat-eye and wide views, day/dusk/rain. Art lead approval required for new art.
- [ ] **Q02 Motion:** close slow-motion and normal-speed clips verify contact, planted feet, speed-matched gait, turns, pivots, crossfades, animation phase variation, natural wind and stable frame-rate-independent movement. Watch at least two cycles; reject visible reset, teleport, rhythmic synchronization or foot sliding.
- [ ] **Q03 Physical truth:** validate full swept movement including between samples, clearance from colliders/visual-only sets, stable support surface, dynamic obstruction, crossings and accessible machinery. Every solid-looking interactive object needs behavior consistent with its appearance. Reject invisible walls, path blocking, clipping, falling through ground/decks or misleading collision.
- [ ] **Q04 Purpose and reactivity:** each scene tells a district-specific story and carries on without the player; demonstrate accepted actions, reaction priority, cooldowns, safe recovery and bounded chain responses. No economy farming, cosmetic reactions masquerading as working gameplay, or unrelated new HUD spam.
- [ ] **Q05 Continuity:** approach/recede, rotate the camera, sprint, jump off roofs, resize goat, cross time/weather/tide boundaries and return after culling. No distracting popping, duplicated art after streaming, abrupt sound, or actor resets visible to the player.
- [ ] **Q06 Gameplay integrity:** all relevant gigs, boards, party modes, entrances, spawns, relics, traversal routes, rescue and build mode still work. Validate production/alternate seeds and supported sizes; skip invalid ambient sites rather than forcing them. No silent changes to progression or existing saved discoveries.
- [ ] **Q07 Performance:** satisfy existing per-bookmark Chrome budgets and agreed device budgets; compare before/after and report p50/p95/p99 frame times, worst spikes, draw calls/triangles and active actor/body/voice counts. Measure long sessions, loading and repeated regeneration; no increasing memory/body counts. No weakening thresholds to pass.
- [ ] **Q08 Regression and lifecycle:** run `npm run ci` (typecheck, unit, Chrome tests, production build), add focused deterministic navigation, behavior, transition, event, culling, asset/disposal and save tests as applicable. Verify WebGL and software fallback, Low/Medium/High, pause/background/resume and reload. Do not infer player FPS from headless timings.
- [ ] **Q09 Evidence and independent review:** exact tested SHA, seed(s), browser/hardware, resolution/DPR, graphics setting, renderer, conditions, raw profile, before/after frames and uncut gameplay footage with audio when relevant. Include negative/stress cases and failed checks; request a reviewer not responsible for the implementation. If evidence or review is missing, keep quality acceptance open.

### Performance contract (targets pending M0)

- Target 60 FPS / 16.67 ms delivered-frame budget on the agreed reference device and resolution in a fully streamed representative tour. Report median and tail percentiles; the proposed pilot target is p95 <= 16.67 ms on that device, with no recurrent >33 ms gameplay hitches. Calibrate via M0; any changed target requires explicit owner approval and a recorded rationale, not an implementation-side downgrade.
- Preserve the current [Chrome world profile](../../src/world/viewer/chrome-profile.test.ts) thresholds and existing quality presets. Profile with identical camera, seed, renderer, resolution and shadow settings before/after. Distinguish CPU, GPU, presented frames and software/headless rendering.
- Proposed pilot cap 12–18 visible High-detail residents in Downtown; measure on actual device. Establish caps for lower settings, wildlife, traffic, active bodies, particles, voices, textures and animation work in M0/M1. Prefer shared resources, instancing where suitable, spatial filtering and LOD; do not trade away existing goat control, geometry readability or safe routes.
- Check normal traversal plus worst credible chaos and extended sessions; capture real-device frame pacing (not just `gl.finish()` or screenshots). Software fallback must remain functional and legible; it is not assumed to hit the same frame budget as GPU rendering.

### Adversarial test scenarios

| Attack the implementation | Required outcome |
| --- | --- |
| Stand still for 90–120 s; revisit after several in-game hours. | Ordinary activity persists and varies; no conspicuous loop or idle mannequin scene. |
| Sprint from spawn to town, reverse direction repeatedly, orbit the camera or jump from a roof. | No flashing LOD or spawned-in-front-of-camera actors; scenery remains grounded and routes clear. |
| Trigger a rain front, dusk/night, shelter changes and rising tide. | Actors/animals respond plausibly; no instant disappearance in view, flooded path, or mismatched audio. |
| Approach a vendor/animal as Kid and GIGGA, bleat repeatedly, disrupt multiple objects and leave/revisit. | Accepted reactions occur once per event policy, respect cooldown/budgets, do not softlock or farm coins; recover without overlapping. |
| Start/finish a gig, switch party/build mode, collect relics, rescue/reload, and traverse the three mountain routes. | Existing mechanics and navigation are unchanged; ambient layers cannot interfere. |
| Stream assets slowly, block a candidate asset, switch quality, regenerate several times and pause/resume. | No duplicate/fallback art or leaks; clear degradation behavior; simulation and presentation recover. |

**Stop rule:** if any gate fails or cannot be evidenced, do not claim AAA quality or merge the affected implementation as complete. Fix, narrow scope with explicit rationale, or keep the task open. Never use a polished concept render as proof of the shipped game. PR #330 now includes runtime implementation, so it must be reviewed as code and cannot use the documentation-only exception.

## 8. Progress log

| Date | Task IDs | Issue / PR | Tested SHA / evidence | Status / blockers |
| --- | --- | --- | --- | --- |
| 2026-11-25 | BASE-01 | [#329](https://github.com/dovvnloading/GiggaGoat/pull/329) | [CI](https://github.com/dovvnloading/GiggaGoat/actions/runs/45505735560) | Merged baseline; independent live visual review not established by this audit. |
| 2026-11-25 | BASE-02 | [#328](https://github.com/dovvnloading/GiggaGoat/pull/328) | [CI](https://github.com/dovvnloading/GiggaGoat/actions/runs/45606568463) | Merged baseline; independent live visual review not established by this audit. |
| 2026-11-25 | BASE-03, LW-001–003 | This roadmap | Audit SHA above | Source reviewed; baseline capture, hardware selection and art approval still open. |
| 2026-11-25 | LW-001, LW-101–107, LW-201, LW-203, LW-404, LW-601–603 | [#330](https://github.com/dovvnloading/GiggaGoat/pull/330) | [Pilot implementation, tests and capture procedure](qa/living-world-pilot.md). Each `profile.json` records the capture SHA. | Downtown runtime pilot and regression coverage added. The PR workflow generates before/after browser evidence. Art approval, reference-device budgets, independent review and broader rollout remain open. |

Next actionable work: review the pilot's actual browser captures and continuous gameplay, complete **LW-001–003** hardware/art decisions and **M1** independent acceptance, then extend the proven systems through the district backlog. Traffic, new wildlife routines, solid landmark animation and landscape rollout remain open. Existing shipped assets are reused; this PR adds no external runtime dependency or asset pack.
