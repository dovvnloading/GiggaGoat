# Living Downtown — implementation and review evidence

Implementation PR: [#330](https://github.com/dovvnloading/GiggaGoat/pull/330). Before-state: [`92001c7`](https://github.com/dovvnloading/GiggaGoat/tree/92001c7ec3f851be8468590b237833e0d0e007f8). Production seed: `billy-isle`.

This PR turns the first living-world slice into running game code. The roadmap's acceptance boxes remain open: code, automated checks, art approval and reference-device performance are different evidence. This document records what exists and what still needs review.

## What is implemented

| Roadmap area | Runtime behavior | Boundaries |
| --- | --- | --- |
| LW-101 navigation | Deterministic walking graph derived from actual Downtown paving, authored crossings and fitted surface heights; swept route checks account for colliders, visual-only furnishings and protected gameplay positions. Live props, fruit, built pieces and the goat obstruct movement. | Unsafe or disconnected destinations are omitted; actors stay on the safe component containing their routine. No road vehicle navigation. |
| LW-102 cast | Up to 16 residents with five roles: vendor, shopper, café guest, delivery worker and walker. Five existing Kenney models use real skeletal clips, distance-driven gait, turn limits, crossfades, phase variation, grounded feet and contact shadows. | No new character designs or asset downloads. Art acceptance and close-motion review remain open. |
| LW-103 routines | Role-specific destinations, varied dwell times, station reservations, rain shelter, night retreat and in-world return to ordinary activity. Population remains stable across weather and quality changes. | A deliberately small Downtown schedule; district-specific farming, maintenance and fishing routines remain open. |
| LW-104 / LW-404 reactions | Accepted bleats cause looks/waves; headbutts and real chaos can startle or trigger a short retreat. Nearby actors yield, recover and resume their route. Higher-priority commotion can supersede a recent bleat. | Six responding actors per accepted event, global coalescing, per-actor cooldown and no event backlog. No extra rewards or save fields. |
| LW-105 street detail | Fountain arcs and basin ripples, cups on the existing café tables, wind-driven steam and warm dusk light on the actual shop window triangles. | Café guests currently stand at safe service/terrace stations. Occupied seating and additional approved service animation remain open. Solid landmarks remain static where moving collision has not been established. |
| LW-106 market | The existing named market produce crate carries six visible apples/oranges. An accepted impact or physical displacement spills them as real Rapier spheres with bounded impulses and ordinary collision. The display is finite and never restocks for reward farming. | All six bodies must fit the shared budget. Bodies are suspended in excluded game modes. Visible sleeping fruit persists; distant/submerged fruit is retired without an on-screen reset. A destroyed source that cannot spill immediately is retired permanently. |
| LW-107 sound | Nearby residents emit distance-driven shoe Foley and quiet nonverbal reaction cues; the fountain and disrupted produce have positional sound. Existing unlock, mute, volume, voice limits and attenuation apply. | Four ambient cues per sample; missed footsteps are not replayed after pause/culling. No invented speech or second audio context. |
| LW-201 / LW-203 environment | A seeded continuous wind field drives foliage, grass, flags/fabric, café steam and compatible harbor motion. Birds, boats and pollinators preserve phase and use smoother day/rain/distance envelopes. | No new rotating solid machinery. WebGL supports the shader wind and opaque hashed fades; the software renderer retains animation/culling but does not execute those shader effects. |

### Runtime and resource budgets

- Logical population is independent of graphics quality. Near residents retain full animation; distant animation updates are limited to 12/8/5 Hz on High/Medium/Low and use deterministic travel phase. Far rendering fades without resetting the routine.
- Five character templates are shared across the cast. Skeletons are cloned per resident; textures, geometry and materials are shared and reference-counted. Fruit is two instanced batches. Windows add no per-window lights, and residents add no per-actor sunlight shadows.
- The navigation search allowance is one route per simulation tick. Actor separation uses a spatial grid. All new routines use the existing physics clock and pause with it.
- The market contributes at most six bodies to the existing dynamic-body budget; it has no recurring spawn queue. It releases owned bodies and budget entries on disposal.
- Gigs, pending gig results, party matches and build mode suppress ambient activity. Mode entry suspends fruit physics before the next Rapier tick. Existing progression, discoveries, rewards and save schemas are preserved.
- Asset failures leave the failed resident/fruit absent instead of displaying placeholder geometry. Late asynchronous completions are disposed safely after teardown.

## Assets and licensing

The pilot reuses the repository's Kenney `mini-characters` and `food-kit` assets. Both are listed as CC0 in the existing [asset library inventory](../../../public/assets/library/README.md). Character files were inspected for the actual skeleton and animation content: the five selected files contain two skinned meshes and 32 native clips each. The renderer selects native locomotion, idle, interaction and emote clips; it does not infer animation coverage from a filename. Fountain, table and window placement follows measured model bounds and existing authored geometry.

## Reproduce browser evidence

The PR's `living-world-evidence` CI job runs the actual `Game`, `GameView`, renderer and audio bridge on the before-state and current change. Its matching WebGL stills use identical seed, High quality, 1280×720 viewport, camera bookmarks and 12 timed samples per view. The separate `living-world-walkthrough` job explicitly selects the game's production software-rendering fallback, with its ordinary 30 Hz frame limit and Low preset in a 640×360 CSS viewport. It validates fallback traversal and sound; a WebGL walkthrough on physical reference hardware remains open. Backend, actual canvas resolution and quality are recorded explicitly. The two jobs upload correspondingly named artifacts and retain independent pass/fail results, so a failed recording cannot pass merely because stills succeeded. The command below requests 24 samples for a longer local measurement. These small headless samples are diagnostic, not statistically reliable reference-device tail-latency acceptance.

With a working Chrome installation:

```bash
npm install
npm run capture:living-world -- --out .living-world-captures/after --label after --samples 24 --tour 100
```

Set `CHROME_PATH` if Chrome is not installed in a standard Linux location. The capture script uses existing dependencies only. `--root` selects a separate checkout; `--seed`, `--quality`, `--points` and `--samples` make the run reproducible. `--tour` adds a continuous 90–120 second scripted controller walk using the real goat camera and the existing audio mix; `--tour-only` omits the still capture. The video defaults to the still quality and 1280×720; `--tour-quality`, `--tour-width` and `--tour-height` independently control it. CI passes `--require-tour-route`, which fails the walkthrough job if the recorded goat does not reach every waypoint, while retaining the video and profile for diagnosis.

The artifacts contain matching JPEGs from spawn, Downtown street/fountain/market/rooftop and eight district approaches, a raw `profile.json` for each checkout, and an uncut `gameplay.webm` for the implemented game. The profile records exact checked-out SHA and dirty state, seed, quality, camera, resolution/DPR, browser, renderer, OS/CPU, individual timing samples, p50/p95/p99, draw calls, triangles, texture/geometry counts, physical bodies, actor states and browser errors. GitHub PR jobs normally check out the synthetic merge commit; use the associated run's head SHA to identify the branch revision. The tour additionally records simulation and render-submission work, actual elapsed simulation, dropped time, reached waypoints, reactions and codec. Fixed views hide the HUD to expose the scene. The tour restores the page HUD, but the video records the game canvas and audio without compositing DOM overlays. The clip uses automated controller input; it is not a human acceptance tour. Pass `--software-renderer` to reproduce the explicit fallback selection; without it, the production renderer chooses WebGL when available.

### Baseline asset issue discovered during capture

The first two capture attempts correctly failed their authored-goat readiness check. Diagnostics identified an existing Vite transformation of `new URL('/', import.meta.url)` into `/@fs/`, causing the goat GLB request to receive the HTML application fallback instead of the model. The old game then displayed its legacy goat sculpt. This PR fixes the public asset URL and regression-tests the actual Vite transformation and resolved development/production URLs. Direct HTTP verification confirmed that the corrected path returns the GLB header and the incorrect path returns HTML.

The recorded baseline source stays unchanged. Its capture alone uses the explicit `--allow-legacy-goat` flag and records the legacy state in the profile, preserving the actual before-state. The implemented game must load the authored goat and the entire resident cast. No corrected source or redirected asset is silently substituted into the baseline. Failed-run diagnostics remain available in [the first capture run](https://github.com/dovvnloading/GiggaGoat/actions/runs/45643701717) and [the diagnostic run](https://github.com/dovvnloading/GiggaGoat/actions/runs/45646262384).

**Measurement correction and limits:** still profiles measure CPU `GameView` submission followed by `gl.finish()`. [Chromium deliberately implements that call as a flush](https://chromium.googlesource.com/chromium/src/third_party/+/master/blink/renderer/modules/webgl/webgl_rendering_context_base.cc), so these values exclude completed GPU rendering, presentation and image readback. Earlier wording calling them completed frames was incorrect. Screenshot wait and tour copy timings expose additional queued work. No reported submission percentile establishes presented-frame FPS or the proposed 16.67 ms reference-device budget. The clip records real wall-clock frame intervals separately. Before-state has no new ambient systems; the same capture harness is applied to both. The fixed camera samples are explicit cuts; only the gameplay clip is continuous.

The first completed artifact, from [the `3886c54` run](https://github.com/dovvnloading/GiggaGoat/actions/runs/45648658197), loaded the authored goat and all 16 residents with no browser errors, but its High-quality recording advanced only 4.10 simulation seconds in 102.99 wall-clock seconds and reached zero waypoints. That clip is diagnostic evidence, not an accepted walkthrough. This finding led to separate video quality controls, per-phase timings and the explicit route-completion requirement. The production timestep and catch-up cap are unchanged.

Later captures isolated additional recording overhead. The [WebGL-only SwiftShader run](https://github.com/dovvnloading/GiggaGoat/actions/runs/45656370686/artifacts/15043648282) reduced total synchronous view work to 1.53 seconds during a 101.08-second recording, yet direct canvas capture still delayed callbacks and completed only one waypoint. The recording harness now measures short timer/render/direct-capture/copy-capture probes, requests video frames explicitly, and copies the unchanged production WebGL pixels to a CPU-backed 2D recording canvas. This is a capture adapter, not a second game renderer. The profile records copy time, requested frames, callback gaps, component timings and the actual route result; successful traversal and usable decoded media must still be verified.

The [copy-adapter probes](https://github.com/dovvnloading/GiggaGoat/actions/runs/45660242252/artifacts/15045425795) showed the delay even without a recorder: software-emulated WebGL needed roughly half a second to produce/read back a frame in this runner. The 100.58-second clip advanced 18.67 simulation seconds and reached two waypoints; it remains failed diagnostic evidence. The CI walkthrough therefore exercises the existing production software fallback explicitly, with the same real-time physics limits and route-completion requirement. This does not repair, replace or certify hardware WebGL performance. High WebGL comparisons and the existing Chrome regression budgets remain separate.

## Verification

Focused automated coverage exercises:

- Determinism and non-mutation of the generated island, protected gameplay footprints, full swept paths, multiple seeds/sizes, pavement support, crossing clearance and safe omission.
- Long-running resident separation and planted-foot support, rain/night transition and recovery, accepted-event priority and cooldown, player/dynamic obstruction, mode suppression and teardown.
- Real character animation clips, distance-driven phase, stable foot grounding, shared resources, near/far quality behavior, failed/late loads and repeated disposal.
- Real Rapier fruit collision, a one-shot six-body cap, shared-budget pressure, visible sleeping fruit, hidden cleanup, crate loss, mode suspension, disposal and unchanged wallet/discovery state.
- Positional ambient sound, missed-stride suppression, pause/background behavior, reaction priority, per-sample limits and disposal.
- Seeded wind continuity, stable vegetation roots, material/shadow shader integration, culling bounds, weather envelopes and streaming/disposal behavior.

The complete runtime revision at `ee0e34a` passed TypeScript, **1,364 unit tests in 172 files**, **25 Chrome tests in three files**, and its production build in [CI](https://github.com/dovvnloading/GiggaGoat/actions/runs/45650291234/job/139332647651). Chrome exercised gameplay, menus, every party mode and the unchanged world-profile limits; the prop library reported 89 loaded assets and zero failures. This run used Chrome 157 with ANGLE/SwiftShader and does not establish physical-GPU performance. Subsequent changes refine capture tooling and evidence documentation without changing runtime code.

The [matching runtime artifact](https://github.com/dovvnloading/GiggaGoat/actions/runs/45650291234/artifacts/15040986798) contains all 13 before/after views, the authored goat, all 16 resident rigs and zero browser errors. Its recorded checkout is the PR merge commit `20cc72c0b0f8e90f3956c31688d61e3d273a6c05`, associated with branch revision `ee0e34a`. Its old recording has the same incomplete-route limitation described above. A reconstruction of the actual rendered meshes and recorded positions verified all 16 residents' supporting heights; the market resident's apparently buried lower body is correctly occluded by a nearer coastal ridge. The newer fountain/market cameras improve review sightlines without moving actors or altering terrain.

The supported GitHub Actions runner provides the browser checks and capture artifact. Existing Chrome profile thresholds are unchanged. Use the PR's checks for the exact tested commit and final test counts; evidence is not silently inferred from a build.

## Review still required

1. Inspect the fully streamed before/after frames and clip. Check silhouettes and palette against the reference art, close feet through at least two walk cycles, turns/crossfades, fountain/table contact, window alignment and dusk/rain readability.
2. Perform an independent 90–120 second human tour with a rooftop idle, accepted bleat, market disruption and revisit. The automated clip supplements this review.
3. Select reference hardware and record delivered frame pacing, CPU/GPU separation, memory and a long session on Low/Medium/High. Check software fallback explicitly; shader wind, hashed fades and fountain/steam point particles are WebGL-only. Resident skeletal motion, solid service props, fruit and ordinary gameplay remain available in software rendering.
4. Exercise alternate seeds and all supported sizes, giant/kid goat proximity, rain/night/tide, pause/background/resume, reload, build mode, gigs and party matches in the browser.
5. Complete seated café service and any approved art refinements before claiming all of LW-105. Continue landscape composition, traffic, expanded wildlife, moving solid landmarks and other district routines through their existing roadmap tasks.

No task is marked accepted merely because its implementation appears in this PR. Q01/Q09 independent approval and Q07 reference-device performance remain open until their evidence is recorded.
