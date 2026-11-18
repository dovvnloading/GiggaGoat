# Billy Isle full visual QA, pass 3 (whole island + the real game)

Strict art-director pass of the live GitHub Pages build against the target paintings (`docs/art/hifi/07`-`16`, `18`),
after the pass-2 fixes (`island-qa-full-2.md`) started landing. Format, severity scale and fix types follow pass 2.

**Builds tested.** Main moved four times during the pass, so every caption names its build.

- World Lab full sweep (all bookmarks, every district at three heights, night): `main @ 515a716` (#151 kiosk signs,
  water towers, Downtown dressing).
- Re-shot after #153 (CY-12 ring-road bypass): Crane Yard, bookmark 10, Hoofington junction, sea seam, river mouth,
  Pines overview: `main @ 9ff1a80`.
- Re-checked after #155 (Pines deck stilts, authored clouds) and the cascade merge: bookmarks 08, 12, 13, 16 and both
  cascade sites: `main @ 304fe1b` (latest at the time of writing).
- The actual game (`https://dovvnloading.github.io/GiggaGoat/`), free roam from the Hoofington spawn: Pages deploy of
  `9ff1a80`.

**Method.** World Lab: each bookmark rendered as the Lab renders it (bookmark select, 7 s for models, pixel ratio 1, UI,
labels and thumbnail hidden), window 1756 x 854; bookmark comparisons are centre-cropped to 16:9, which keeps the
vertical field of view, live on top and painting below. Free cameras were placed through the page's own
OrbitControls (`qa_hook.js`) at goat eye height (1.6-2 m), prop level (5-15 m) and one overview (45-760 m) per
district, plus night and golden-hour presets. Measurements come from the live scene graph: instance matrices of the
`props-*` descriptor meshes, mesh bounds, and a bilinear terrain sampler built from the live `terrain-chunk-*`
vertices (3.125 m grid); "ground" values below are that sampler. A visual cause was confirmed by toggling the suspect
mesh in the live page where possible (DM-9). Game: free roam driven with W/A/S/D key holds and mouse drags on the canvas
only, about 40 s of play around Hoofington. Root causes are traced to `main @ 304fe1b` line numbers. Prop positions
were measured on `515a716` / `9ff1a80`; seeded scatter can shift a few metres in later builds, so each fix states a
test to run rather than relying on the exact coordinates. No source was
edited and nothing was built or run locally. Evidence is in `docs/art/qa/full-3/` (49 JPEGs, 6.3 MB).

**Severity.** **A** blocks the art (reads wrong at a glance), **B** clearly wrong, **C** polish. **Fix type**:
**Asset** = a model must be built or rebuilt; **Code** = placement, size, material, shader or logic. Ids continue
pass 2; `RD` = roads, `GM` = the real game.

## Top 15 "fix first" (ranked by how bad it looks to a player)

| Rank | Id | Sev | Fix type | Issue | Fix (one line) |
|---|---|---|---|---|---|
| 1 | GM-1 (+GM-2) | A | Code | In the real game every Hoofington picket fence is covered by a 9.2 x 1.85 m solid ochre slab (the Hay-Build "wall" piece stretched 20x), and hay bales, crates, ramps, barrels and trampolines are swapped for different gameplay models. The World Lab never shows this, so it is invisible in art review | `GamePropMapping.createWorldLibraryProp` must load the same GLB `library-props.ts` uses for the kind (picket-fence.glb, hay-bale.glb, ...) fitted to the descriptor box; never `createBuildPiece('wall')` or the poly.pizza hay block |
| 2 | IS-22 / IS-23 | A | Code | Night: the sea stays day-teal and glows, rivers and falls glow cyan, and a white fog band rings the horizon. Golden hour: a white stripe separates the orange sky from the sea (bookmarks 09, 15) | Drive sea/inland water colour and `scene.fog.color` from the day/night state (horizon colour of the sky dome) |
| 3 | MG-12 | A | Code + Asset | The new cascades are invisible: on Mt Gigga only the lip box and the splash pool show, the falling water sits inside the cliff; white splash puffs lie on the trail; from bookmark 12 they are blue chips | Push each cascade out along its flow until the water profile clears the terrain (or skip the site), keep pools off the trail; Asset: a tall-curtain cascade variant for steep risers |
| 4 | DM-9 | A | Code | A 52 x 44 m white foam ring floats 4-7 m above the Dam plunge pool and slices through the rocks (the white arcs in bookmark 14) | Hide `dam-reservoir-foam` together with `dam-reservoir` when the Dam GLB loads |
| 5 | IS-14 | B | Code | One plane sine wave paints parallel 22 m stripes that converge into a sunburst in every view with sea (pass 2, not started) | Sum three crossed waves and fade the band term with camera distance |
| 6 | IS-13 | B | Code | Every coast is a regular 4 m saw-tooth with white foam "comb teeth" (pass 2, not started) | Shoreline foam ribbon on the smoothed 0 m contour; drop the triangle-following foam term |
| 7 | IS-15 | B | Code | Green saw-teeth hang down every grey cliff; Mt Gigga reads as a striped cone (pass 2, not started) | Blend rock/grass per fragment from the world normal plus noise |
| 8 | HF-16 | B | Code | Village sidewalks and kerbs are flat 4 m slabs each at its own height: at goat height they read as a staircase along every street (Hoofington and Downtown) | Pitch each slab to its segment slope (or a draped strip) so neighbouring tops meet |
| 9 | IS-19 | B | Asset + Code | Meadow "grass" tufts are flattened octahedra: flat green paper diamonds from above, green pyramids from the side, and they lie on Downtown paving and Crane Yard slabs | New 7-blade grass-clump model; exclude paved areas |
| 10 | DT-19 / DT-20 / DT-21 | B | Code | Downtown intersections: planters sit inside the café table sets, six forecourt bushes and three oaks stand inside the shop shells | Drop the two planter rows under the café sets, delete the facade bushes, keep scenery out of building footprints |
| 11 | IS-24 | B | Code | All ground below 7.3 m is tinted toward sand, so Hoofington lawns, the south plain, the beach approach and the Pines banks read olive-khaki | Narrow the sand blend to 1.2-2.9 m with a noisy edge |
| 12 | IS-17 | B | Code | The square edge of the 600 m terrain shows as straight seams and a V corner in the open sea (and as a square under the rising tide) | Make the sea depth/colour radial outside the terrain square; match the seabed skirt colour |
| 13 | IS-21 | B | Code | The island interior is open lawn with lone trees and the 1.7 km coast is empty sand: no rocks, umbrellas, boats or fences (painting 18 is packed) | Tree clumps, mountain-foot boulders, field fences, coastal rocks, umbrellas and boats from existing assets |
| 14 | WP-12 | B | Code | 3.5 x 2.2 x 7 m rocks and logs lie on the ring road through Whispering Pines; the Pines sign stands at the kerb | Reject Pines rocks, logs and trees within road width/2 + 3.5 m |
| 15 | LH-12 / BW-21 | B | Code | A bush and a rock float 10-12 m above the Lighthouse channel; a Baa-ardwalk bench and a 2.4 m beach ball sit under the sea | Re-ground or drop props after `preserveLighthouseChannel`; move the forecourt pieces onto dry sand |

Next five: BK-9 (bookmark 09 composition), GM-3 (combo burst over the goat), WP-14 (squashed glade cascade), RD-1
(ring-road notches at every district), BW-19 (Baa-ardwalk dressing at ~1.7x scale).

## Already fixed: verified on the live build

| Item | Result |
|---|---|
| BK-1 / BK-2 | Bookmarks render their authored cameras exactly (07 (-167.5, 9, 97), 09 (50, 7, 249), 10 (195, 11.5, -3), 13 (-130, 6.5, -175.5)). 07 composition is still poor (oak trunk fills the right third, `bm-07-vs-painting.jpg`), queued as a new camera |
| Bookmark 09 reframe | Camera is now on the sand, but on the pier axis at plank level: see BK-9 |
| LH bridge ropes | Sagging rope rails present and readable (`live-lh-from-sea.jpg`) |
| IS-11 / DM-1 / WP-8 | Upstream river lies on the ground; no aqueduct. New issue at the mouth: IS-18 |
| BW-14 | Kiosk signs read ICE CREAM, POPCORN, GAMES, PRIZES, CANDY (`live-baa-deck-north.jpg`) |
| DT-15 / DT-16 / DT-8 | Timber barrel water towers, no parapet boards on houses, bunting reads as a garland (`bm-11-vs-painting.jpg`) |
| Bench / planter spacing (#151) | Benches clear; café tables now collide with planters: DT-19 |
| CY-12 (#153) | Ring road runs west of the fence with a gate spur (`live-crane-overview-after-reroute.jpg`) |
| WP-3 (#155) | Pines decks stand on posts with bracing and a ladder (`bm-13-vs-painting.jpg` is pre-#155; checked live on 304fe1b) |
| BK-5 / IS-10 (#155) | Clouds are authored puffs at 300-380 m; none in frame at 16. They are now small and sparse: IS-25 |
| MG-5 / WP-4 (cascades) | Merged but not working visually: MG-12, WP-14 |

## Bookmarks against the paintings

| Id | Sev | Where/view | Issue | Evidence | Root cause | Fix type | Exact fix |
|---|---|---|---|---|---|---|---|
| BK-9 | B | Bookmark 09 | Camera (50, 7, 249) stands on the sand 6 m before the pier root, 2.4 m above ground, on the pier's centre line: planks fill the bottom 40%, kiosks read as a wall of sheds on the left, and the 29 m wheel is 98 m away (15% of frame height). Painting: diagonal pier from bottom left, kiosks along the far rail, wheel large right of centre, sun on the right horizon, palms framing | `bm-09-vs-painting.jpg`, `live-09-proposed-camera.jpg` | `viewer/bookmarks.ts:29-31` | Code | Camera `{x: 28, y: 7.5, z: 250}`, target `{x: 64, y: 13, z: 318}`, fov 60 (ground there 2.09 m; tested live, see evidence). For the queued 09 sun: azimuth (-0.35, 0, 0.94) from the camera, 3-5° up, so it lands right of the wheel. Bookmark test: wheel centre projects to x 0.55-0.72 of the frame |
| BK-10 | C | Bookmark 11 (and 08 until removed) | The World Lab street goat is a primitive placeholder (dodecahedron body, cone horns, torus scarf), 2.7 m tall at scale 1 and 2.1 m at 11's 0.78 scale, against an art-plan goat of 1.2 m | `bm-11-vs-painting.jpg`, `bm-08-vs-painting.jpg` | `viewer/viewer.ts:79-129` `makeStreetGoat`, placed `:247-258` | Code | Load `assets/characters/goat/goat_hero.glb` (the game goat), scale to 1.2 m tall, idle pose; or hide it at 11 as well |
| (queued) | | 07, 12, 13, 15 | Still visible, already queued for new cameras: 07 oak trunk in the right third, 12 aerial cone shot, 13 bottom third asphalt (BK-3), 15 fov-35 strip | `bm-07`, `bm-12`, `bm-13`, `bm-15-vs-painting.jpg` | | | Queued |

## Island-wide: sea, sky, lighting, terrain

| Id | Sev | Where/view | Issue | Evidence | Root cause | Fix type | Exact fix |
|---|---|---|---|---|---|---|---|
| IS-22 | A | Night preset (and golden hour) everywhere | The sea keeps its day colours (#48c9c9 / #2a8fc0) at night and glows bright teal under a navy sky; the river ribbons, Dam pool and fall cards stay saturated cyan in a dark street | `live-island-overview-night.jpg`, `live-dt-night-street.jpg` | `visual-water.ts:120-185` `seaMaterial` and `:192-` `inlandMaterial` are unlit ShaderMaterials with constant colours; `render.ts:544-550` `setDayNight` updates only sky, sun and fill | Code | Add uniforms `uDaylight` (0-1) and `uGolden` to the sea and inland water materials, set them in `setDayNight` from `state.daylight` and the golden factor; in both fragment shaders `color *= mix(vec3(0.16, 0.20, 0.34), vec3(1.0), uDaylight); color = mix(color, color * vec3(1.0, 0.72, 0.55), 0.35 * uGolden);` (night sea about #1b3550). Test: at phase 0.025 the sea colour luminance < 0.25 |
| IS-23 | A | Horizon at golden hour (09, 15) and night | Fog colour is the constant day horizon (0.76, 0.88, 0.98): the far sea turns into a white stripe between an orange sky and the sea at golden hour, and into a glowing white ring at night | `bm-15-vs-painting.jpg`, `bm-09-vs-painting.jpg`, `live-island-overview-night.jpg` | `viewer/viewer.ts:224` and `core/GameView.ts:119` create fog with `SKY_HORIZON_COLOR` once; `visual-sky.ts` computes per-phase horizon colours only inside the dome shader (`:57-72`) | Code | Export `skyHorizonColor(phase): THREE.Color` from `visual-sky.ts` returning the dome colour at `dir.y = 0` (day `SKY_HORIZON_COLOR`, golden `GOLDEN_HOUR_SKY.horizon`, night (0.18, 0.22, 0.38), mixed as the shader does); after every `setDayNight` copy it into `scene.fog.color` in the viewer and in GameView. Test: fog colour equals the dome horizon ±0.02 at phases 0.025, 0.285, 0.5 |
| IS-17 | B | Open sea around the island; every view above ~20 m; rising tide | The 600 m terrain square shows in the water as straight seams and a V-shaped corner at (-300, +300); at tide 49 the whole drowned square is outlined | `live-sea-square-seabed-corner.jpg`, `bm-16-vs-painting.jpg` | `visual-water.ts:167` clamps the height-atlas UV, so outside ±300 m the depth (and colour) freezes at the border value while the seabed skirt (`:72-90`) drops to -10/-40 m with its own wet-sand colour `0xd9c79a` at the seam | Code | In the sea fragment shader after the depth line: `float outside = max(0.0, max(abs(vWorld.x), abs(vWorld.z)) - uSize * 0.5); depth = max(depth, uLevel - ground + outside * 0.12);` and set the skirt's first-ring colour to the terrain's submerged colour #4D9C9F instead of `wetSand`. Test: sea colour sampled along z = 300 from x = -280 to -340 changes monotonically with no step > 3% |
| IS-18 | B | North-west river mouth (-227, -243) | The striped river ribbon continues about 30 m out over the open sea as a translucent carpet | `live-river-mouth-over-sea.jpg` | `island.ts:101` last river point (-227, -243, level -1) lies offshore; `visual-water.ts:570` builds `forestOutflow` from `island.river.slice(11)` including it | Code | Build the visual ribbon only up to the first sample where `gridSample < 0.1`, and fade a per-vertex alpha to 0 over the last 6 m. Test: no ribbon vertex where `gridSample < -0.3` |
| IS-19 | B | Every lawn at goat height; Downtown paving, Lighthouse cape | The 1,900 meadow tufts are two squashed octahedra: from above flat green diamonds ("paper confetti"), from the side green pyramids; they also lie on Downtown paving and forecourts | `live-dt-cafe-in-planter.jpg`, `live-hoof-verge-sidewalk-steps.jpg`, `game-brown-wall-close.jpg` | Geometry `visual-meadow.ts:97-105`; exclusion `:39-50` only rejects road ribbons (`width/2 + 1.1 m`) and building discs, not sidewalks, Downtown pavements or the Crane Yard pad | Asset + Code | **Asset** `custom/hoofington-props/grass-clump.glb`, 0.6 x 0.4 x 0.6 m, 7 tapered blades plus 2 short ones, colours #6fae4f / #8cc65c / #a9d77a, < 120 triangles. **Code** use it for `meadow-grass-sprigs` at scale 0.7-1.2, and also reject points within `width/2 + 3.4 m` of `makeLocalStreets` (covers kerb and walkway), inside the Downtown plot (radius 38 m around (145, 119)) and the Crane Yard pad (abs(x-185) ≤ 41, abs(z+47) ≤ 37) |
| IS-21 | B | Island interior between districts, the whole coastline | Bare lawn with single round trees; beaches are empty sand all round; painting 18 shows forest belts, rock clusters at the mountain foot, fenced fields, beach umbrellas, coastal rocks and boats | `live-island-overview-day.jpg`, `bm-18-vs-painting.jpg`, `live-coast-sawtooth.jpg`, `live-beach-goat-eye.jpg`, `game-empty-plain.jpg` | `dressing.ts:537-572`: 440 items over radius 103-273 m (one per ~450 m², 18% trees), no coastal or offshore dressing | Code | Seeded, after existing RNG use: 24 clumps of 4-7 `tree-oak` (8-14 m) plus 2 bushes each at radius 110-250 m; 40 `rock` groups (1.2-2.5 m) on the mountain foot ring (radius 100-125 m); 6 picket-fence runs of 3 panels around the Hoofington fields; 30 coastal rock clusters on the 0-1.5 m contour; 6 `polypizza/beach-umbrella` umbrellas with towels on the Baa-ardwalk and Hoofington beaches; 4 boats (`kenney/watercraft-kit/boat-sail-a.glb`, `boat-fishing-small.glb`) 150-300 m offshore. All outside roads (width/2 + 3 m), POI plots and rivers |
| IS-24 | B | All ground below 7.3 m: Hoofington, the south plain, Baa-ardwalk approach, Pines banks | Lawns read olive-khaki rather than the painting's fresh green; beaches have no crisp edge | `live-baa-beach-approach.jpg`, `game-empty-plain.jpg`, `live-pines-river-goat-eye.jpg` | `render.ts:142` `color.lerp(COLORS.sand, 1 - smoothstep(1.8, 7.3, h))`: Hoofington (h ≈ 6) gets 14% sand, the south plain (h ≈ 5) 38% | Code | `color.lerp(COLORS.sand, 1 - smoothstep(1.2, 2.9, h + 0.5 * Math.sin(x * 0.13) * Math.cos(z * 0.11)))`. Test: vertex colour at Hoofington centre has no sand component; at h = 1.0 it is pure sand |
| IS-25 | C | Sky, every bookmark (after #155) | Authored clouds are now 3-5 small cotton puffs high up; the sky reads empty against the paintings' large cumulus banks near the horizon | `bm-12-304fe1b-cascades.jpg` | `visual-sky.ts` cloud placement (#155) | Code | 14-18 clouds at 2-3x the current scale (60-120 m wide), plus 6 low banks at radius 1,200-1,500 m, y 120-200 m so they sit just above the sea line in eye-level views |
| IS-20 | C | Horizon in 09, 12, 14, 15, 16 | No distant islets or headlands; the paintings all put land on the horizon | `bm-12-vs-painting.jpg`, `bm-15-vs-painting.jpg` | Not built | Asset + Code | **Asset** two islet silhouettes (60-120 m wide, 15-40 m tall, rock sides, grass cap, flat toon colours). **Code** 5 instances at radius 900-1,300 m (azimuths behind 09, 12 and 15), fogged |
| IS-13 | B | All coasts | Still a 4 m saw-tooth, now with white foam "comb teeth" at every tooth | `live-coast-sawtooth.jpg`, `live-beach-goat-eye.jpg` | Pass 2: 3.125 m terrain triangles; foam term `visual-water.ts:178-180` follows them | Code | Shoreline ribbon: marching-squares 0 m contour of `island.heights`, Chaikin-smoothed twice, extruded ±1.25 m at y 0.06, colour #f3f8f1 alpha 0.6, animated; remove `coast * foam` from the sea shader |
| IS-14 | B | Open sea | Still parallel stripes converging into a sunburst | `live-island-overview-day.jpg`, `bm-12-vs-painting.jpg` | `visual-water.ts:175-177` single wave | Code | `wave = 0.5 + 0.5 * (0.45 * sin(dot(xz, vec2(0.23, 0.18)) + t * 1.25) + 0.35 * sin(dot(xz, vec2(-0.11, 0.29)) + t * 0.9) + 0.20 * sin(dot(xz, vec2(0.31, -0.07)) + t * 1.6));` and multiply the band term by `1.0 - smoothstep(60.0, 260.0, distance(vWorld.xz, cameraPosition.xz))` |
| IS-15 | B | All slopes, Mt Gigga | Still green saw-teeth hanging into grey | `bm-08-vs-painting.jpg`, `live-gigga-base.jpg` | `render.ts:143-176` cliff and terrace colour per 3.1 m vertex | Code | Stop writing `cliff`/`rockFace` into vertex colour; in the terrain material `onBeforeCompile`: `rock = smoothstep(0.30, 0.42, 1.0 - worldNormal.y + (noise(vWorld.xz * 0.15) - 0.5) * 0.08)`, `color = mix(vertexColor, MT_GIGGA_STONE, rock)` |

## Roads

| Id | Sev | Where/view | Issue | Evidence | Root cause | Fix type | Exact fix |
|---|---|---|---|---|---|---|---|
| RD-1 | B | Every place the ring road passes a POI centre; seen at the Baa-ardwalk root (58, 228) | Two road ribbons overlap with square ends at different angles, leaving a stepped notch in the road edge | `live-baa-beach-approach.jpg` | `roads.ts:8-25`: the ring is built from separate links that end and start at POI centres; no join geometry | Code | Build the asphalt ring as one closed Catmull-Rom spline through the via points and POI centres (one ribbon), or emit a round junction disc (radius width/2 + 0.3 m, 16 segments, same material, +0.01 m) at every shared link endpoint |
| HF-13 | B | Hoofington south junction (-147, 177) | Still: the east sidewalk slab pokes past the street end into the junction | `live-hoof-junction-kerb-sign.jpg` | `visual-streets.ts:96-106` | Code | Stop kerb and walkway pieces 1.5 m before the ring-road ribbon edge (test against `paths-road` vertices) |

## Hoofington (painting 08)

| Id | Sev | Where/view | Issue | Evidence | Root cause | Fix type | Exact fix |
|---|---|---|---|---|---|---|---|
| HF-16 | B | Every village street at goat height (Hoofington and Downtown) | Sidewalks and kerbs are 3.97 m flat boxes, each at the ground height of its own midpoint: on the gentle slope they step 0.1-0.3 m like stairs and bury their ends | `live-hoof-verge-sidewalk-steps.jpg`, `bm-08-vs-painting.jpg` | `visual-streets.ts:98` and `:104` (`y = gridSample(mid) + 0.20 / 0.12`), boxes composed without pitch `:140-160` | Code | For each piece sample `ya`/`yb` at the segment ends, set `y = (ya + yb) / 2 + offset`, pitch = `atan2(yb - ya, length)` (Euler order YXZ: yaw then pitch), length + 0.3 m overlap. Test: consecutive walkway tops meet within 0.02 m |
| HF-15 | C | Hoofington junction (-141.3, 172.7); Pines (-150.6, -134.5) | `signpost.glb` reads as a blank board with a dark bar and an oval (arrow without a head, hoof icon) from any distance; the Pines one stands 1.9 m from the asphalt | `live-hoof-junction-kerb-sign.jpg`, `live-pines-rock-on-road.jpg` | Asset `custom/props/signpost.glb`; placed `layouts.ts:100`, `:211` | Asset + Code | **Asset** two variants, 4.5 x 3 x 0.5 m: cream lettering "HOOFINGTON" / "WHISPERING PINES" on the plank, a clear arrowhead, goat-head roundel (painting 13). **Code** keep signs ≥ 4 m from any road ribbon |
| HF-12 | B | Bookmark 08, street level | Still: 8-10 m of empty lawn between road and fences | `bm-08-vs-painting.jpg`, `live-hoof-verge-sidewalk-steps.jpg` | Pass 2 | Code | Pass 2 fix (houses ~4 m behind the pavement, front-garden props) |
| HF-3 / HF-5 / HF-10 | | | Still visible, already queued (bales in tidy rows, lawn platform and hay ramp removal, mountain waterfall at 08) | `live-hoof-hay-field.jpg`, `bm-08-vs-painting.jpg` | | | Queued |

## Baa-ardwalk (painting 09)

| Id | Sev | Where/view | Issue | Evidence | Root cause | Fix type | Exact fix |
|---|---|---|---|---|---|---|---|
| BW-19 | B | Whole pier | Everything is ~1.7x the art-plan scale: kiosks 7.2 x 6.8 x 6.4 m (two storeys), benches 3.5 x 1.5 x 1.2, trampoline 7 x 1.1 x 7, beach balls 2.4 m, lamps 8.4 m, on a 27 m deck; next to a 1.2 m goat it reads as a giant's pier and the painting's dense promenade becomes empty planks | `live-baa-deck-north.jpg`, `live-baa-deck-south.jpg`, `bm-09-vs-painting.jpg` | `boardwalk.ts:132` (booth), `:166-180` (benches, trampoline, bumpers), lamps `:151-156` | Code | Booth 5.0 x 4.8 x 4.5 (sign `centreY` deckY + 4.2, awning + 3.2); bench 2.0 x 0.95 x 0.75 (BW-17); trampoline 3.6 x 0.8 x 3.6; bumper 1.0 x 1.0 x 1.0; lamp 0.72 x 7.8 x 0.72. Custom GLBs stretch per axis, so keep each box's proportions. Fill the freed deck with 3 crate stacks, 4 barrels and 2 life-ring posts on the west rail |
| BW-20 | C | Kiosks | The kiosk reads as a corrugated shed with a lifted lid: plain slab walls, dark window with "bar chart" goods; painting: striped booths with scalloped canopies and goods on the counter | `live-baa-deck-north.jpg`, `live-baa-pier-from-sea.jpg` | Asset `custom/baaardwalk/kiosk.glb` | Asset | Rebuild at 5.0 x 4.8 x 4.5 m: pitched striped canopy with scalloped valance, open counter with 6-8 coloured goods, side lanterns, white walls for descriptor tint (as now) |
| BW-21 | B | Forecourt at the pier root | On the east side the forecourt bench (78.1, -1.73, 260.1; ground -2.48) and beach ball (85.1, -2.30, 264.1) sit under the sea; on the west side they sit on the tide line (ground 0.65) | `live-09-proposed-camera.jpg` (west bench at the bottom), measured live | `boardwalk.ts:176-181` places them at `side * 29 / -28` and `side * 22 / -32` without a ground check | Code | Place them at dz -40 to -46, abs(dx) ≤ 16, and skip any piece where `gridSample < 1.0` |
| BW-15 / BW-17 / BW-18 | B / C / C | | Still visible (deck 27 m and head 39 m wide; benches 3.5 m; olive sand, IS-24) | `live-baa-deck-south.jpg`, `live-baa-beach-approach.jpg` | | Code | See BW-19 and IS-24 |

## Crane Yard (painting 10)

| Id | Sev | Where/view | Issue | Evidence | Root cause | Fix type | Exact fix |
|---|---|---|---|---|---|---|---|
| CY-16 | C | Pad perimeter (and Mt Gigga foot) | The concrete pad fades into grass through an 8-10 m grey smear instead of a clean edge | `live-crane-overview-after-reroute.jpg` | Biome colour `industrial` #9EAE90 per vertex (`render.ts:136-140`) interpolated across 3.1 m triangles around the slabs | Code | Restrict the `industrial` tint to vertices inside the pad rectangle and add a 0.25 m-wide, 0.12 m-high concrete kerb strip around the slab perimeter |
| CY-17 | C | Site barriers (8) | Barriers render plain cream: the red diagonal stripes promised in the README never show | `bm-10-vs-painting.jpg` | Asset `custom/crane-yard/site-barrier.glb`: the red primitive (z ±0.30, y 0.62-1.45) lies on or inside the tapered white faces, so it is hidden | Asset | Offset the stripe quads 0.015 m outward along each face normal (or cut them into the body as separate faces) |
| CY-18 | C | Cable spools | The spool flange reads as a giant chocolate-chip cookie (tan disc with dark square holes) | `live-crane-goat-eye.jpg` | Asset `custom/props/cable-spool.glb` | Asset | Plywood flange #c99a5b with 6 darker radial spokes and a thin rim, visible dark cable drum #3a3f45, no square holes |
| CY-13 / CY-14 / CY-15 | B / C / C | | Still visible: 3.0-3.6 m crates stacked three high, flat dark puddles, green seams between slabs | `bm-10-vs-painting.jpg`, `live-crane-goat-eye.jpg` | `crane-yard.ts:144`, `:184`; `visual-ground.ts:98` | Code | Pass 2 fixes |

## Downtown Bleatsville (painting 11)

| Id | Sev | Where/view | Issue | Evidence | Root cause | Fix type | Exact fix |
|---|---|---|---|---|---|---|---|
| DT-19 | B | Both pavements, café sets at dz -21 and 13 | A planter box with flowers sits in the middle of each café set: the two chairs face a planter and the table is buried in it | `live-dt-cafe-in-planter.jpg`, `live-dt-pavement-goat-eye.jpg` | Tables `visual-downtown.ts:261` at (±13.4, -21/13) with chairs at ±1.65 overlap planters `dressing.ts:262` at (±12.1, -20/12) | Code | Skip the planters (and their flowers) whose z is within 3 m of a café table (rows dz -20 and 12, both sides). Test: no planter AABB intersects a table or chair AABB |
| DT-20 | B | Shop fronts | Six 2.4 m forecourt bushes at x = ±15 stand 0.7-1.9 m inside the shop shells (facades at abs(dx) = 14.3) | `live-dt-cafe-in-planter.jpg` (right) | `visual-downtown.ts:265-268` | Code | Delete these six bushes (every free pavement slot at x ±13.5 collides with a planter, bench, flower or bin) |
| DT-21 | B | West shop row | Three island-wide oaks stand inside shops: (123.8, 159.1), (126.0, 104.9), (127.3, 122.1); canopies poke out of facades and balconies | `live-dt-pavement-goat-eye.jpg` | `dressing.ts:567-571` excludes only the boardwalk, Crane Yard and Downtown infill, not shops or houses | Code | Reject vegetation whose disc (width/2 + 1 m) intersects any `shop`, `house`, `barn`, `cottage`, `booth`, `control-house`, `windmill` or `silo` descriptor box (yaw-aware). Test: zero intersections island-wide |
| DT-14 / DT-17 | B | | Still visible: 30 m between facades; brown trail ribbon lies on the asphalt at the north end, fountain off-axis | `bm-11-vs-painting.jpg`, `live-dt-north-trail-on-road.jpg` | Pass 2 | Code | Pass 2 fixes; clip trail ribbons 1 m short of any road ribbon |

## Old Lighthouse (painting 15)

| Id | Sev | Where/view | Issue | Evidence | Root cause | Fix type | Exact fix |
|---|---|---|---|---|---|---|---|
| LH-12 | B | East face of the cape, above the channel | `props-bush` at (-232.3, 0.1) floats with its base at 8.0 m over ground -2.6 m; `props-rock` at (-240.6, 2.0) floats with its base at 13.0 m over ground 0.4-2.2 m. From the sea and the dock they hang on the cliff face | `live-lh-from-sea.jpg`, `live-lh-dock-floating-bush.jpg` | `island.ts:143-151`: props (`populateProps`) and dressing (`dressIsland`) are placed before `preserveLighthouseChannel` carves the channel | Code | After `preserveLighthouseChannel`, drop every `rock`, `bush`, `flower`, `grass-tuft`, `tree-*` or `mushroom` prop whose base is > 0.5 m above `gridSample` at its centre (do not move them: it keeps RNG and gameplay ids). Test: no such prop floats > 0.5 m |
| LH-8 / LH-9 / LH-11 | B / B / C | | Still visible: flag pole at the waterline (centre y -1.06, ground -2.6), empty dock piles in the sea, bright white wedges under the cape boulders | `live-lh-from-sea.jpg`, `live-lh-dock-floating-bush.jpg`, `bm-15-vs-painting.jpg` | `layouts.ts:261`; `visual-lighthouse.ts` piles and rock paint | Code | Pass 2 fixes |

## Mt. Gigga (painting 12)

| Id | Sev | Where/view | Issue | Evidence | Root cause | Fix type | Exact fix |
|---|---|---|---|---|---|---|---|
| MG-12 | A | All four mountain cascades (304fe1b) | Cascade #2 (49.4, 37.8, 61; box 6.7 x 18.0 x 11.0): only the blue lip box at the top and the pool at the bottom show; the cliff between is bare rock with two white specks, so the stepped water is inside the terrain. Its splash puffs lie across the trail. From bookmark 12 all four read as small blue chips with white blobs on the tier tops | `live-gigga-cascade-buried.jpg`, `bm-12-304fe1b-cascades.jpg` | `dressing.ts:700-718`: box centred on the midpoint of top and bottom with depth `run + 2` (≤ 12 m); the model's water steps descend linearly over its depth while the real riser is steeper and convex, so they end up under the surface. No trail clearance for the pool | Code + Asset | **Code** sample `gridSample` at 6 points along the model's water line (lip to pool); while any point is above the water surface + 0.2 m, move the box outward along the flow by 0.5 m (max 4 m); skip the site if still buried; reject sites whose pool disc (radius = width/2 + 1 m) touches a trail ribbon. **Asset** `custom/props/cascade-tall.glb`, 6.6 x 14 x 4.0 m: 0.6 m lip overhang, one straight curtain with a mid-height ledge, 6 m splash pool, for risers with drop/run > 2 |
| MG-9 / MG-10 / MG-7 | B / C / B | | Still visible: ledges are pancakes on the slope, the summit trail is two overlapping ribbons with a hard seam, the mountain is a smooth cone | `live-gigga-trail-ledge.jpg`, `live-gigga-summit-trail.jpg`, `live-gigga-base.jpg` | `layouts.ts` ledges; `render.ts` `paths-trail`; terrain | Code | Pass 2 fixes |

## Whispering Pines (painting 13)

| Id | Sev | Where/view | Issue | Evidence | Root cause | Fix type | Exact fix |
|---|---|---|---|---|---|---|---|
| WP-12 | B | Ring road through the Pines | 3.5 x 2.2 x 7 m rocks lie on the asphalt at (-141.9, -142.4) (0.3 m from the ribbon edge) and (-146.5, -152.0); a 7 m log at (-129.3, -160.7); pines at (-181.0, -91.1) and (-136.8, -147.3) stand at the road edge. Also a gameplay block | `live-pines-rock-on-road.jpg` | `layouts.ts:202-208` (17 rocks/logs at `rng.range(±43, ±48)`) and `:187-201` (trees) check river and height but not roads | Code | Reject rocks and logs within `road.width/2 + 3.5 m` and trees within `road.width/2 + 2 m` of any `island.roads` point (keep the RNG draws). Test: no Pines prop footprint within those distances |
| WP-13 | C | Pines floor | The same 17 props are 7 m long and lie at random angles everywhere, reading as storm debris rather than the painting's two mossy logs | `live-pines-overview.jpg` | `layouts.ts:202-208` sizes | Code | Logs 1.0 x 0.9 x 4.5 m, rocks 2.2 x 1.6 x 2.5 m; place 6 of them along the river banks and the trail, not across the glade |
| WP-14 | B | Glade cascade (-83.5, 2.9, -137) | The cascade is stretched to 18.8 x 3.2 x 4.5 m (2.85x wide, 0.30x tall of the 6.6 x 10.5 x 9.2 model): a flat grey weir with a translucent blue box across the river. Painting: an 8-10 m fall over a rock step | `live-pines-glade-cascade-squashed.jpg` | `dressing.ts:780-801` takes the box straight from the found site; no stretch limit | Code | Clamp to the art-plan rule (any axis 0.77-1.3x the native size); if the site's drop is < 8 m, place the native-size cascade with its base on the river at the site and build the riser from 3 `rock` props (5-7 m) behind and beside the lip |
| WP-9 / WP-10 | B / C | | Still visible: straight canal with even white stripes; khaki banks (IS-24), flat stone slab mid-river | `live-pines-river-goat-eye.jpg`, `live-pines-overview.jpg` | `visual-water.ts:208-215` stripe term | Code | Pass 2 fixes |

## The Dam (painting 14)

| Id | Sev | Where/view | Issue | Evidence | Root cause | Fix type | Exact fix |
|---|---|---|---|---|---|---|---|
| DM-9 | A | Plunge pool, right bank, bookmark 14 | White crescents arc over the pool and through the rocks: the procedural reservoir's 52 x 44 m foam ring at y 10.5, 4-7 m above the pool water. Hiding it in the live page removes every arc | `bm-14-vs-painting.jpg`, `live-dam-overview-foam-ring.jpg`, `live-dam-14-foam-ring-hidden.jpg` | `render.ts:596-597` hides `dam-reservoir` when the Dam GLB loads but not `dam-reservoir-foam` (`visual-water.ts:623`) | Code | Hide (or do not create) `dam-reservoir-foam` together with `dam-reservoir`. Test: after the Dam GLB loads, `inland.getObjectByName('dam-reservoir-foam').visible === false` |
| DM-7 / DM-8 | B / C | | Still visible: the reservoir is the GLB's dark rectangular slab with a straight edge against the open sea; foam is thin ring outlines | `live-dam-deck-slab.jpg`, `live-dam-overview-foam-ring.jpg` | Pass 2 | Code | Pass 2 fixes |

## The real game (goat height)

| Id | Sev | Where/view | Issue | Evidence | Root cause | Fix type | Exact fix |
|---|---|---|---|---|---|---|---|
| GM-1 | A | Hoofington from the spawn, every fence | Every picket fence is wrapped in a solid ochre slab 9.2 m long, 1.85 m tall, with a straw-like grain; white picket tips poke through. It breaks into flat brown slabs. The World Lab shows the white picket fences, so this never appears in art review | `game-vs-lab-fences.jpg`, `game-brown-wall-close.jpg` | `core/GamePropMapping.ts:11-13` replaces world kinds `crate, barrel, hay-bale, fence, ramp, trampoline`; `:32-34` maps `fence` to `createBuildPiece('wall')` (`props/PropFactory.ts:356-366`: 0.46 x 2 x 2 survival fence plus boards) stretched by `fitRoot` to 9.2 x 1.85 x 0.35 (x 20, z 0.175); `core/GameView.ts:169-198` adds it per prop on top of the library picket fence | Code | In `createWorldLibraryProp` load the World Lab model for the kind (the path in `world/library-props.ts`: `fence` → `custom/hoofington-props/picket-fence.glb`, `hay-bale` → `custom/hoofington-props/hay-bale.glb`, `crate` → `kenney/platformer-kit/crate.glb`, `barrel` → `kenney/survival-kit/barrel.glb`, `ramp` → `custom/hoofington-props/wooden-ramp.glb`, `trampoline` → `custom/baaardwalk/trampoline.glb`), fitted like the Lab (custom: per axis to the box; others: `fitLibraryModel`). Test: for each kind the root's world AABB equals the descriptor box ±2%, and no fence root contains a `PropFactory` wood material |
| GM-2 | B | Hoofington field, Downtown, Crane Yard (code-traced; not reached in the short session) | Same mapping: round hay bales become rectangular poly.pizza "Hay" blocks with rope bands, Hoofington ramps become build ramps, crates become survival-kit boxes: a different asset family from the World Lab | | `GamePropMapping.ts:21-44`, `PropFactory.ts:30`, `:331-339` | Code | Covered by the GM-1 change |
| GM-3 | B | Any combo | The COMBO x3 burst (about 500 x 500 px at 1568 x 763) is drawn in world space on the goat, hiding the goat and the path ahead | `game-combo-over-goat.jpg` | `core/GameVfx.ts:174` emits `ComboPopText` at the event position (the goat) | Code | Emit at goat position + 3.0 m up and 1.5 m to camera-right, scale so the burst is ≤ 18% of screen height, fade within 0.6 s; never inside the central 30% of the screen |
| GM-4 | C | Minimap | The coastline is a staircase of 17.5 px square tiles (16 x 16 biome grid), cheap next to the painted HUD mock-up (22) | `game-vs-lab-fences.jpg`, `game-empty-plain.jpg` | `core/HudArtwork.ts:49-58` | Code | 64 x 64 samples and draw the coast as one smoothed SVG path (marching squares on height 0, Chaikin twice) with a 3 px sand stroke over a sea fill |
| GM-5 | C | Free-roam spawn surroundings | The first minute of play crosses 100+ m of flat olive ground with nothing on it (IS-24 colour + IS-21 emptiness): the most-seen view of the game | `game-empty-plain.jpg` | IS-21, IS-24 | Code | IS-21 and IS-24 |
| GM-6 | C | Screen centre | "CLICK TO PLAY · MOUSE TO LOOK" and "GOAT GIGS" chips sit in the middle of the play view at 30-40% height until pointer lock | `game-vs-lab-fences.jpg` | `core/GameHud.ts:90-91` (`.gg-hint` at `top: clamp(184px, 14.5vw, 232px)`, `.gg-board-hint` below it) | Code | Move hint chips to the bottom centre (≥ 82% height), hide after 6 s or on first mouse move |

Not seen in the game session: camera clipping into walls (the camera hugged a house wall at 1-2 m but did not enter),
physics jitter, props falling through the ground, LOD popping. The goat model, run animation and scarf match sheet 21
closely enough.

## Pass-2 items not started: still visible?

| Id | Still visible | Note / evidence |
|---|---|---|
| MG-9 floating ledges | Yes | `live-gigga-trail-ledge.jpg` |
| MG-10 trail drape | Yes | summit seam, `live-gigga-summit-trail.jpg` |
| CY-13 crate size | Yes | 3.0-3.6 m crates three high, `bm-10-vs-painting.jpg` |
| CY-14 puddles | Yes | flat dark ellipses, `live-crane-goat-eye.jpg` |
| CY-15 slab gaps | Yes | green seams, `live-crane-goat-eye.jpg` (Downtown forecourts show the same, `live-dt-cafe-in-planter.jpg`) |
| LH-8 flag at waterline | Yes | flag centre y -1.06, ground -2.6, `live-lh-from-sea.jpg` |
| LH-9 dock piles | Yes | `live-lh-dock-floating-bush.jpg` |
| LH-11 white rock undersides | Yes | `live-lh-from-sea.jpg` |
| BW-15 deck width | Yes | 26.5 m main deck, 38.3 m head (measured) |
| BW-17 bench size | Yes | 3.5 x 1.5 x 1.2 m (measured) |
| BW-18 olive sand / empty approach | Yes | root cause now traced: IS-24 |
| HF-12 empty verges | Yes | `live-hoof-verge-sidewalk-steps.jpg` |
| HF-13 kerb into junction | Yes | `live-hoof-junction-kerb-sign.jpg` |
| IS-13 shoreline | Yes | `live-coast-sawtooth.jpg` |
| IS-14 sea waves | Yes | `live-island-overview-day.jpg` |
| IS-15 cliff blend | Yes | `bm-08-vs-painting.jpg` |
| WP-9 river canal | Yes | `live-pines-river-goat-eye.jpg` |
| WP-10 banks | Yes | `live-pines-river-goat-eye.jpg` |
| DM-7 reservoir | Yes | `live-dam-deck-slab.jpg` |
| DM-8 ring foam | Yes | `bm-14-vs-painting.jpg` |
| RT-1 rising tide mood | Yes | `bm-16-vs-painting.jpg` |
| DT-17 vista end / trail on road | Yes | `live-dt-north-trail-on-road.jpg` |
