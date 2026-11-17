# Billy Isle full visual QA, pass 1 (whole island)

Scope: every district, every prop kind and every district model, checked three ways:

1. **Static audit**: every GLB used by `PROP_LIBRARY_MODELS` (`src/world/library-props.ts`), `HOOFINGTON_MODELS`,
   `DOWNTOWN_MODELS`, the Lighthouse and Dam loaders was measured in Blender (native bounds, triangles, materials,
   alpha modes) and compared with the descriptor boxes it is stretched into (live descriptor dump from the World Lab,
   1,394 props, seed `billy-isle`). Full table: Appendix A.
2. **Evidence renders** (Blender, Workbench): every flagged model shown three ways per tile: pink 1 m cube, the same
   GLB at true proportions (uniform scale to the in-game height), and the in-game copy stretched to its collider
   box. Source colours (the game bakes texels to vertex colour and tints lightly).
3. **Live pass**: World Lab bookmarks 07-16 next to their paintings, plus 28 free-camera views (street level and
   overview), at least three per district.

Build tested live: GitHub Pages deploy of `main @ 9fbe0b8` (Hoofington PR #96). While this pass ran, PRs #103
(Downtown painted shops), #106 (Crane Yard authored GLBs) and #88 (USDCraft lantern lamps) merged and deployed; I
re-checked bookmarks 10 and 11, the Downtown skyline and four more district views on that build (`postmerge-*.jpg`). Each row says whether a
merged PR fixed it. Severity: **A** = breaks the look at a glance, **B** = clearly wrong, **C** = polish.

Evidence lives in `docs/art/qa/full-1/` (names below are relative to that folder).

## The giant tan "figure" next to the grey skyscraper

| What | Detail |
|---|---|
| Identity | Not a statue or character. It is the **Downtown "skyline crane"**: `DOWNTOWN_MODELS.skylineCrane` = `kenney/factory-kit/crane.glb` (a small gantry/jib crane: round base, A-frame legs, a column and an arm) |
| Placement | `src/world/visual-downtown.ts:226` (now `:241`): `scatter('skylineCrane', 32, -48, 19, 22, 8, Math.PI / 2, ground + 27, 0xfec544)`, i.e. world ~(177, 71), next to the Downtown `tower` (`layouts.ts:120`, the grey-blue `building-skyscraper-c` 8 x 27 x 8 m) at the east edge of Downtown, above the beach |
| Why it looks like a person | Native 1.93 x 3.55 x 3.68 m stretched to 19 x 22 x 8 m (9.9 / 6.2 / 2.2 per axis = 4.5x distortion) and yawed 90 degrees: the A-frame legs become two "legs", the column a torso, the cab a "head", the arm an outstretched "arm". `bakeLibraryGeometry` lerps it 68% toward the tint `#fec544`, which gives the tan colour |
| Why it floats | The centre Y is `ground + 27` with a 22 m box, so the base sits **16 m above the grass** |
| Evidence | `live-dt-giant-crane-figure.jpg`, `live-dt-east-overview.jpg`, end of street in `bm-11-vs-painting.jpg`, tile 1 of `ev-downtown-stretched-props.jpg` |
| Status | PR #103/#106 replaced the GLB with `custom/crane-yard/skyline-tower-crane.glb` (built at 19 x 22.3 x 8, no tint). **The 16 m float is still there**: `visual-downtown.ts:241-242` still passes `ground + 27` (`postmerge-dt-skyline-crane-floating.jpg`: the new yellow tower crane's mast stops in mid-air). Fix: pass `ground + 11` (half of 22 m), or `y` omitted so `scatter` grounds it (code, one line) |

## Ranked summary (top issues)

| Rank | Id | Sev | Issue | Status after #103/#106/#88 |
|---|---|---|---|---|
| 1 | DT-1 | A | Giant tan crane "figure" floating 16 m above ground beside the skyscraper | GLB fixed; float remains |
| 2 | X-1/X-2 | A | Stretch-to-box rule: 102 of 123 model usages distort more than 1.3x, 55 more than 3x, 32 more than 5x; 10 models (14 uses) are mapped with their long axis across the box | open (systemic) |
| 3 | LH-2 | A | Old Lighthouse draws generic library props under its bespoke art: duplicate cottage, sunken second shipwreck, double docks and cave | open |
| 4 | CY-2/3/4 | A | Crane Yard: Greek temple columns, paper-thin slabs, tombstone "chain-link" fence, squat containers | open (cranes fixed) |
| 5 | BW-1/2 | A | Baa-ardwalk pier is one smeared 27 x 83 m plank slab, mostly lying on grass and sand | open |
| 6 | BW-3/4 | A | Medieval red/green market stalls, grey highway-sign "signboards", 1 m Christmas-light bulbs instead of candy kiosks and bunting | open |
| 7 | LH-1/3 | A | Lighthouse is a grey castle turret with a floating blue cone; cape buried in bright white "cotton ball" boulders | open |
| 8 | MG-1/2 | A | Mt Gigga: 10 m "rabbit-ear" TV antenna as the satellite dish; 49 salmon/teal rock shards sticking out of the cliffs | open |
| 9 | DT-2 | A | Giant 3.3 m AC boxes on every Downtown roof | open |
| 10 | WP-1 | A | Pines lookout is a 24 m grey stone castle turret standing in the river | open |
| 11 | HF-1 | A | Farm animals squashed: cow and horse 7.8x, pig 3.9x, sheep 4x (length axis mapped to the narrow box side) | open |
| 12 | IS-1/2 | A | Ocean is a visible square slab; in rising tide the clouds draw under the water | open |
| 13 | X-4 | B | Kenney Nature Kit colours collapse to salmon pink and teal (logs, rocks, stumps, ledges, stepping stones, Downtown trees) | open |
| 14 | HF-4/WP-7 | B | Village and Pines signs are 5 m grey gravestones (road sign stretched 100x) | open |
| 15 | IS-3 / BW-11 / WP-5 | B | Bookmarks 07, 09, 10 and 13 do not frame their paintings at all | open |

## Downtown Bleatsville (painting 11)

| Id | Sev | Location / view | Issue | Evidence | Root cause | Fix (asset / code) |
|---|---|---|---|---|---|---|
| DT-1 | A | East edge, from beach, Crane Yard road and end of main street | Giant tan "figure" floating beside the skyscraper (see section above) | `live-dt-giant-crane-figure.jpg`, `postmerge-dt-skyline-crane-floating.jpg` | `visual-downtown.ts:241-242` y = ground + 27 for a 22 m box; old GLB `factory-kit/crane.glb` 4.5x | GLB fixed in #103/#106. **Code**: y = ground + 11 |
| DT-2 | A | Every shop roof (16) | Huge white (now grey) boxes with a black hole read as giant tissue boxes; real rooftop AC is ~1.2 x 1 x 1 m | `live-dt-rooftops.jpg`, `postmerge-bm11-downtown.jpg`, `ev-downtown-stretched-props.jpg` | `dressing.ts:228` `ac-unit` 3.3 x 2.1 x 3.1 m; `DOWNTOWN_MODELS.ac` = `modular-buildings/detail-ac-a.glb` (0.24 x 0.11 x 0.24) stretched 14 / 19 / 13 | **Code**: draw the AC at 1.3 x 1.0 x 1.1 m inside the existing collider (visual-only size), one per two roofs; or wall-mounted units like the painting. **Asset** optional |
| DT-3 | A | Rear rows (6 houses), roof views | Mixed families (KayKit F, modular tower-a/d) squashed up to 2.2x with grey-to-pink height gradients | `live-dt-rooftops.jpg`, `ev-downtown-stretched-props.jpg` | `visual-downtown.ts` house mapping + wall/roof lerp `visual-hoofington.ts:315-316` (roof colour applied to every vertex above 71% height) | Fixed by #103 (shop-l/m/f). Remaining stretch: shop-m-pink 1.42x, shop-f-lavender 1.35x (Appendix B) |
| DT-4 | A | Main street facades | Muddy recoloured Kenney/KayKit shops, arcade 2.3x, bakery 1.8x, cafe 1.7x, market 1.9x | `bm-11-vs-painting.jpg` | `SHOP_FRONTS` slot heights 9 / 11.3 / 13.6 / 15.9 m vs native proportions | Fixed in look by #103, but the stretch is unchanged: arcade 1.96x, books 2.0x, bakery 1.81x, ice cream 1.71x, cafe 1.49x, boutique 1.44x. **Code**: swap slots so tall models get the tall rows (e.g. shop-c-yellow to a 9 m row, shop-k-lavender to a 9 m row), or adjust row heights |
| DT-5 | B | East skyline | The 27 m `tower` was a bare grey-blue glass skyscraper (banned by the art plan); now shop-l-peach stretched 2.35x tall, so its windows are 2x tall slits | `live-dt-giant-crane-figure.jpg`, `postmerge-dt-skyline-crane-floating.jpg` | `layouts.ts:120` 8 x 27 x 8 m box; `DOWNTOWN_MODELS.highrise` | **Asset**: shop-m-pink was authored as "tower (replaces the skyscraper)" (1.24 x 3.16 x 1.44 → 1.6x), better still a tower GLB built at 8 x 27 x 8 |
| DT-6 | A | Upper floors, both sides | Grey-blue "retro window" panels float off the facades and a second set of window-box planters/flowers hovers in front of the painted GLBs' own window boxes | `postmerge-bm11-downtown.jpg` (left at the arcade, right at Hay Mart), `live-dt-pavement.jpg` | `visual-downtown.ts:184-206` adds `retroWindow`, `retroBalcony`, `planter`, `flower` at collider face + 0.12 m; painted shops already contain windows and flower boxes | **Code**: delete the retroWindow/retroBalcony/planter/flower overlay loop now that #103 shipped |
| DT-7 | B | Every shopfront | Two awnings per shop: the Kenney `detail-awning-wide` canopy (flat green/grey board) over the painted GLB's own striped awning | `postmerge-bm11-downtown.jpg` (Hay Mart: green board over blue/white stripes) | `visual-downtown.ts:146-152` maps `awning` descriptors to `canopy`/`retroCanopy` (7.8x / 3.1x stretched) | **Code**: stop drawing the `awning` descriptors (keep colliders) |
| DT-8 | B | Above the street | As tested: four rows of 1 m pennants plus holiday-kit Christmas bulbs stretched to 27 m (23.5x). After #103 the pennants are gone and the bulbs are squashed into 0.16 m strands that read as thin dashed lines; the painting has clear, colourful bunting | `bm-11-vs-painting.jpg`, `postmerge-bm11-downtown.jpg` | `visual-downtown.ts:236-239` `lights` (`holiday-kit/lights-colored.glb`) | **Asset**: pennant string GLB at true size, two rows |
| DT-9 | B | Street and rear trees | Teal/cyan canopies | `live-dt-rooftops.jpg`, `live-dt-east-overview.jpg` | `DOWNTOWN_MODELS.oak` = `nature-kit/tree_detailed.glb`, material `leafsGreen` #70e6d6 (X-4) | **Code**: use `custom/hoofington-props/tree-round-a/b/c` (vegetation PR in CI) |
| DT-10 | B | Pavements (24 street planters) | 2.6 x 2.2 m brown boxes with brown-green shard leaves; 1.9x stretched | `live-dt-pavement.jpg`, `postmerge-bm11-downtown.jpg` | `dressing.ts:243,256` sizes; Kenney `suburban/planter.glb` painted by height rule `visual-hoofington.ts:298-301` | **Asset**: barrel/box planter with the custom flower clumps, about 1.2 x 0.9 m visual |
| DT-11 | B | Far end of the main street | Grey road planks fan out and tilt at the junction with the ring road | `live-dt-pavement.jpg` (left background), `postmerge-bm11-downtown.jpg` | Roads are instanced boxes (`render.ts:325-360`); `isDowntownRoadOverlay` (`render.ts:277-288`) only hides overlays inside 21 x 42 m | **Code**: road ribbon mesh with proper joins (see IS-7) |
| DT-12 | C | Pavement | Bench 4.3 m long and 1.55 m tall (3.3x) | `ev-downtown-stretched-props.jpg` | `dressing.ts:252`, `furniture-kit/bench.glb` | **Code**: visual size 2.0 x 0.9 x 0.7 |
| DT-13 | C | Road | Traffic cones 1.15 m tall in the carriageway | `postmerge-bm11-downtown.jpg` | `visual-downtown.ts:233-234` | **Code**: 0.45 x 0.7 x 0.45 |
| DT-14 | C | Whole street | Street and pavements still much wider than the painting; shops set back | `bm-11-vs-painting.jpg` | Layout (`layouts.ts:96-125`), open since downtown-qa-1 D1 | Layout pass |

## Crane Yard (painting 10)

| Id | Sev | Location / view | Issue | Evidence | Root cause | Fix |
|---|---|---|---|---|---|---|
| CY-1 | A | Whole yard, bookmark 10 | Crane jibs were flat black bars floating at 27-38 m; masts were navy tripods | `bm-10-vs-painting.jpg`, `live-crane-overview.jpg`, `ev-crane-yard-stretched-props.jpg` | `crane-jib` = `retro-urban-kit/detail-beam.glb` (long axis Z) in a 78 m X box: 312 / 12 / 3 = 96x; `crane` = factory gantry 12.5x | **Fixed by #106** (`postmerge-bm10-crane-yard.jpg`: yellow lattice cranes, red girder) |
| CY-2 | A | Concrete frame | Columns are classical Greek statue columns with bulging capitals (mint-white), floors are paper-thin purple sheets | `live-crane-ground.jpg`, `postmerge-bm10-crane-yard.jpg`, `ev-crane-yard-stretched-props.jpg` | `concrete-column` = `nature-kit/statue_column.glb` 5.5 / 27.5 / 5.5 = 5x; `concrete-slab` = `factory-kit/floor-large.glb`, a zero-thickness 2-triangle plane (degenerate, cannot be stretched to 1.15 m) | **Asset**: square concrete column (chamfered, #c9c3b8) and slab with real thickness, built at 1.65 x 27.5 and 29 x 1.15 x 26 |
| CY-3 | A | Yard perimeter (36 panels) | "Chain-link fence" reads as rows of grey gravestones / fins | `live-crane-overview.jpg`, `postmerge-crane-containers-fence.jpg`, `postmerge-bm10-crane-yard.jpg` | `chain-fence` = `city-kit-roads/construction-fence.glb`, long axis is Z (0.07 x 0.18 x 0.38) but the box is long in X (8 x 2.85 x 0.18): 107 / 16 / 0.5 = 222x | **Asset**: chain-link panel built at 8 x 2.85 x 0.18 (posts, mesh as solid lattice, no alpha) |
| CY-4 | A | Containers (5) | Squat orange crates with smeared corrugation; the door bars become giant grey T-shapes on the long side | `postmerge-crane-containers-fence.jpg`, `live-crane-ground.jpg`, `postmerge-bm10-crane-yard.jpg` | `shipping-container-a.glb` long axis Z, box long X: 5.1x; rotated 90° it would be 1.14x | **Code**: auto-rotate long axis (X-2); recolour blue/red/green per plan |
| CY-5 | B | Every slab edge, gate barriers | Safety rails are grey "wing" blobs (121x), site barriers grey lumps (8x) | `live-crane-ground.jpg`, `ev-crane-yard-stretched-props.jpg` | Both use `construction-barrier.glb` (long axis Z) in X-long boxes | **Asset**: yellow tube rail 13.1 / 24.8 / 28 m modules; striped jersey barrier built at 4.3 x 1.65 x 0.9 |
| CY-6 | B | Upper slab front | Bunting is giant red/green Christmas bulbs (10.6x); the site flag is a squashed pirate flag (8x) | `live-crane-ground.jpg` | `crane-yard.ts:109,111`, `holiday-kit/lights-colored.glb`, `pirate-kit/flag-high.glb` | **Asset**: pennant string; flat site flag |
| CY-7 | B | Three pipe stacks | Single dark-navy pipe rings, not stacked concrete pipes | `live-crane-ground.jpg` (left) | `pipe-stack` = `factory-kit/pipe-large.glb` 6 x 4.2 x 6.2 | **Asset**: pyramid of 3-6 concrete pipes |
| CY-8 | B | Front-left scaffold | Dark grey-brown solid cage, not yellow tube scaffolding | `live-crane-ground.jpg`, `bm-10-vs-painting.jpg` | `yard-scaffold` = `retro-urban-kit/scaffolding-structure.glb` (alpha "bars" texture baked solid) 4.9x / 5.5x | **Asset**: yellow tube scaffold built at 4.6 x 22.7 x 9.3 and 10.5 x 17.6 x 3.2 |
| CY-9 | C | Cones (15) | 1.65 m tall traffic cones | `live-crane-ground.jpg` | `crane-yard.ts:209` | **Code**: 0.5 x 0.75 x 0.5 visual |
| CY-10 | C | Bookmark 10 | Camera is high and far; painting is at ground level by the fence | `bm-10-vs-painting.jpg` | `viewer/bookmarks.ts` 10 | Camera ~ (215, +4, -8) looking at (190, 12, -45) |
| CY-11 | C | Pad | Road crossing the yard is a separate dark strip with stepped edges; checkerboard slab tones read noisy | `live-crane-ground.jpg` | `visual-ground.ts` yard tiles + road boxes | Polish |

## Baa-ardwalk (painting 09)

| Id | Sev | Location / view | Issue | Evidence | Root cause | Fix |
|---|---|---|---|---|---|---|
| BW-1 | A | Whole pier | The pier and booths stand on grass and sand for most of their length; only the wheel deck is over water | `live-baa-pier-on-land.jpg`, `bm-09-vs-painting.jpg` | `boardwalk.ts:58-65` shore threshold -38 m and POI centre on land | **Code/layout**: move the pier seaward (start at the waterline), or carve the beach |
| BW-2 | A | Deck | One giant terracotta slab with smeared planks; green grass stripes show through | `live-baa-deck-level.jpg` | `pier` = `pirate-kit/structure-platform-dock.glb` stretched 27 x 0.92 x 83 (10.8 / 0.7 / 33 = 47x); `deck` = `platform-planks.glb` 9.6x | **Code**: tile a 2.5 m plank module along the pier (instanced), or **asset**: boardwalk GLB at size |
| BW-3 | A | Booth row | Kenney fantasy-town medieval market stalls (red/green canvas, timber), grey highway-sign backs as signboards, flat green board awnings | `live-baa-deck-level.jpg`, `ev-baaardwalk-stretched-props.jpg` | `booth` = `fantasy-town-kit/stall-red.glb`; `signboard` = `sign-highway-wide.glb` (axis swap, 116x); `awning` = `detail-awning.glb` 7.4x | **Asset**: pastel kiosks (coral, candy pink, aqua, cream) with striped awnings and sign boards, built at 7.2 x 6.8 x 6.4 |
| BW-4 | A | Over the deck | Bunting is Christmas lights with ~1 m red/green bulbs | `live-baa-deck-level.jpg` | `boardwalk.ts:140` 22.8 x 2.4 x 0.3, `lights-colored.glb` 4.8x | **Asset**: pennant string (painting: triangle flags + small bulbs) |
| BW-5 | B | Railings | Brown squashed lattice, not white two-rail balustrade | `live-baa-deck-level.jpg` | `pier-rail` = `pirate-kit/structure-fence.glb` (square 2.5 x 2.2 x 2.5) into 8 x 2.65 x 0.5: 16x | **Asset**: white balustrade 8 m, 1.1 m tall inside a 2.65 m anchor frame |
| BW-6 | B | Under the wheel deck | Piles are see-through scaffold cages hanging in the water | `live-baa-pier-on-land.jpg`, `postmerge-baa-from-sea.jpg` | `scaffold` = `retro-urban-kit/scaffolding-structure.glb` (alpha bars) 9.7x | **Asset**: round timber pile |
| BW-7 | B | Ferris wheel | Grey/black Poly Pizza wheel with white gondolas; painting: white/pink wheel, candy gondolas, lights | `bm-09-vs-painting.jpg` | `polypizza/ferris-wheel` (off-family) | **Asset**: recolour or rebuild |
| BW-8 | B | Beach forecourt | "Bumpers" are grey lumps on the sand | `live-baa-pier-on-land.jpg`, `bm-09-vs-painting.jpg` | `boardwalk.ts:159` `construction-barrier.glb` 2.4 x 2.3 x 2.4 | **Asset**: beach balls / bollards |
| BW-9 | B | Deck | Trampoline is an orange disc | `live-baa-pier-on-land.jpg` | `trampoline` = `platformer-kit/spring.glb` 7 x 1.1 x 7 (4.5x) | **Asset**: blue round trampoline (painting 08/09) |
| BW-10 | B | Deck | Grey highway lamps | `live-baa-deck-level.jpg` | `light-curved.glb` | Fixed by #88 (not re-checked here) |
| BW-11 | B | Bookmark 09 | Camera is inland on the grass looking over the road; painting stands on the beach at the pier, booths left, wheel right; golden-hour sky is flat grey-lilac | `bm-09-vs-painting.jpg` | `viewer/bookmarks.ts` 09 camera (89, 19, 166); `visual-sky.ts` golden colours | Camera ~ (40, 6, 214) looking at (60, 8, 262); warmer sunset gradient |
| BW-13 | C | Surf (16 buoys) | Buoys read as orange stools/gates with grey caps (squat 1.8x) | `postmerge-baa-from-sea.jpg` | `dressing.ts:199` 1.9 x 2.1 x 1.9, `watercraft-kit/buoy.glb` | **Code**: 1.0 x 1.8 x 1.0 |
| BW-12 | C | Deck | Scenery bushes grow through the deck | `live-baa-deck-level.jpg` | `dressing.ts:371-401` vegetation ignores the pier footprint | **Code**: exclude pier footprint |

## Hoofington (painting 08)

| Id | Sev | Location / view | Issue | Evidence | Root cause | Fix |
|---|---|---|---|---|---|---|
| HF-1 | A | West paddock and east field | Cow, horse, pig and sheep squashed into wide, short blobs | `live-hoof-animals-hay-ramp.jpg`, `ev-hoofington-stretched-props.jpg` | `visual-hoofington.ts:160-164` pass the animal length as X (cow 4 x 2.8 x 2), but the Quaternius GLBs are long in Z: cow 1.7 / 0.5 / 0.2 = 7.8x, horse 7.8x, pig 3.9x, sheep 4.0x | **Code**: swap X and Z in those five sizes (cow 2 x 2.8 x 4 etc.) or scale uniformly |
| HF-2 | B | Windmill | Twice as tall and half as wide as authored; sails squeezed | `live-hoof-overview.jpg`, `ev-hoofington-stretched-props.jpg` | `windmill.glb` native 7.9 x 11.4 x 5.0 forced into `layouts.ts:72` 5 x 23 x 5 (0.6 / 2.0 / 1.0 = 3.2x); no anchor frame | **Asset**: windmill authored at 23 m with an anchor frame, or **code**: visual box 9 x 13 x 5.7 |
| HF-3 | B | Hay (35 dynamic + 5 static) | Tied wheat sheaves stretched into crumpled tan baskets; painting has round yellow bales | `live-hoof-animals-hay-ramp.jpg` | `hay_Yu8TOERkpw.glb` (same mesh in Poly Pizza and Quaternius folders) 0.12 x 0.18 x 0.12 stretched to 2.2 x 1.5 x 2.2 (2.2x) | **Asset**: round bale ~1.5 m |
| HF-4 | B | South entrance | Village sign is a 5 x 3 m grey gravestone | `live-hoof-entrance-sign.jpg`, `ev-hoofington-stretched-props.jpg` | `layouts.ts:87` `sign` = `city-kit-roads/road-sign-empty.glb` (thin pole) 100 / 6.3 / 10 = 15.8x | **Asset**: wooden "HOOFINGTON" sign board at 5 x 3 |
| HF-5 | B | East lawn, west paddock | 15 x 12 m orange pallet ("platform"), orange plank pile ("ramp"), 1.8 m orange crates scattered in gardens | `live-hoof-overview.jpg`, `live-hoof-animals-hay-ramp.jpg` | `layouts.ts:73,83,86`; platformer-kit `platform` 2.9x, `platform-ramp` 3.1x, `crate` | **Asset/code**: dress as a garden deck and a hay-bale ramp, wooden farm crates at 1 m; none are in the painting |
| HF-6 | B | Back garden | Trampoline is an orange disc | `ev-hoofington-stretched-props.jpg` | `playPad` = `platformer-kit/spring.glb` 8 x 1.1 x 7 (4.5x) | **Asset**: blue trampoline with legs and net ring |
| HF-7 | B | Front garden | Dark-brown Quaternius medieval bench (style ban) | `ev-hoofington-stretched-props.jpg` | `HOOFINGTON_MODELS.bench` | **Asset**: Kenney/USDCraft park bench (painting: wood slats, black iron) |
| HF-8 | C | Gardens (13) | Meshy gnome: photo-textured, 0.5 m, different style; the generic fallback is a T-posed "100Avatars David" character | `ev-hoofington-stretched-props.jpg` (last tile) | `HOOFINGTON_MODELS.gnome` (Meshy); `PROP_LIBRARY_MODELS.gnome` = `polypizza/garden-gnome/gnome_Yy3yuQ4l6r.glb` | **Asset**: flat-colour gnome ~0.8 m; replace the fallback so a load failure can never show a T-posed figure |
| HF-9 | C | Beach side | Dark olive 11 x 8 m rectangles read as holes | `live-hoof-overview.jpg` (left) | `visual-ground.ts:134-135` `GARDEN` #6F8549 quads | **Code**: vegetable rows or lighter lawn tone |
| HF-10 | C | Behind the village (bookmark 08) | Mountain has no waterfall; the cliff texture reads as dark pine shards | `bm-08-vs-painting.jpg` | terrain colouring, `visual-water.ts` falls only on the far face | Add the painting's waterfall (art) |
| HF-11 | C | Scenery trees | Lollipop trees 1.8x too tall for their width | `live-hoof-overview.jpg` | `dressing.ts:393` width = 0.39 x height vs native 0.72 | See IS-8 |

Hoofington items already fixed and confirmed live: fences, mailboxes, flowers, houses, shutters, silo paint. Lamps
are fixed by #88 (lantern lamps confirmed in Downtown on the post-merge build; Hoofington not re-shot).

## Mt. Gigga (painting 12)

| Id | Sev | Location / view | Issue | Evidence | Root cause | Fix |
|---|---|---|---|---|---|---|
| MG-1 | A | Summit | The "satellite dish" is a 10 m grey V (TV rabbit-ear antenna) | `live-gigga-summit-dish-flag.jpg`, `bm-12-vs-painting.jpg`, `ev-mtgigga-pines-lighthouse-props.jpg` | `satellite-dish` = `furniture-kit/televisionAntenna.glb` (0.27 x 0.10 x 0.08) into 7 x 10 x 7 (26 / 100 / 88 = 3.8x) | **Asset**: white dish on a lattice stand at 7 x 10 x 7 |
| MG-2 | A | All four tiers (49 ledges) | Salmon slabs with cyan tops stick out of the cliff faces like shards; painting: grey stone shelves with grass tops | `live-gigga-ledges-rocks.jpg`, `bm-12-vs-painting.jpg` | `ledge` = `nature-kit/cliff_half_rock.glb` 6x (`dressing.ts:323`) and 4.2x (`layouts.ts:147`); nature-kit colours dirt #f2be9e, grass #73eddd (X-4) | **Asset**: stone shelf #9aa0a4 + grass #7fbf5a at 6.5 x 1.3 x 6.5 |
| MG-3 | B | Slopes | Salmon-pink rocks, some 4x taller than authored | `live-gigga-ledges-rocks.jpg` | `rock` = `rock_largeB.glb` with random boxes (`dressing.ts:329`, `layouts.ts:150`) | **Code**: uniform scale; **asset**: grey rock recolour |
| MG-4 | B | Summit | Flag is a 9 m pole with a tiny squashed pirate flag | `live-gigga-summit-dish-flag.jpg` | `layouts.ts:139` 0.7 x 9 x 0.7, `flag-high.glb` 4.8x | **Asset**: pennant pole (purple flag in painting) |
| MG-5 | B | Cliff waterfalls | Thin cyan strips and ramps with white torus rings | `live-gigga-ledges-rocks.jpg`, `bm-12-vs-painting.jpg` | `visual-water.ts:141-165` flat quad + torus foam, `:193-230` placement | **Art**: wider cascades with splash and mist |
| MG-6 | A | Cave (east face) | No cave: a flat salmon block sticks out of the slope; next to it a ledge slab with a cyan top and a cyan waterfall triangle with a white ring float on the cliff | `postmerge-gigga-cave-ledge.jpg`, `ev-mtgigga-pines-lighthouse-props.jpg` | `dressing.ts:326` `cave-mouth` = `cliff_cave_rock.glb` (0.17 m deep) into 11 x 8 x 6 | **Asset**: stone arch with lantern (painting) |
| MG-7 | C | Whole mountain | Smooth grey spiral cone vs painting's stacked block tiers with pines on each tier | `bm-12-vs-painting.jpg` | terrain shaping/colour (`render.ts:116-166`) | Art direction for terrain |
| MG-8 | C | Trail ends | Brown trail planks fan out at segment ends | `live-gigga-summit-dish-flag.jpg` | instanced trail boxes (IS-7) | IS-7 |

## Whispering Pines (painting 13)

| Id | Sev | Location / view | Issue | Evidence | Root cause | Fix |
|---|---|---|---|---|---|---|
| WP-1 | A | Lookout | A 24 m grey stone castle turret with a plank lid, its base standing in the river; painting: wooden stilt lookout with ladder and flag | `live-pines-lookout.jpg`, `live-pines-tower-in-river.jpg` | `lookout` = `pirate-kit/tower-watch.glb` 2.9x (`dressing.ts:262`); position (24, -19) overlaps the river | **Asset**: wooden lookout at 9 x 24 x 9; **code**: move clear of the river |
| WP-2 | B | Forest floor | Logs (7 m), stumps, rocks and stepping stones are pastel salmon with teal tops | `live-pines-logs-mushrooms.jpg`, `live-pines-tower-in-river.jpg` | Nature-kit `woodBark`/`dirt` #f2be9e, `grass` #73eddd (X-4); stepping stone 3.3x | **Asset**: recolour (log #8a5a3a, rock #8f969b, moss #86b95a) |
| WP-3 | B | Near lookout | Orange platformer planks float at 4.5 m and 8.5 m between trees; another caps the tower | `live-pines-lookout.jpg` | `layouts.ts:179-180`, `dressing.ts:263` `platform` | **Asset**: tree-house decks with posts/rope |
| WP-4 | B | Bookmark 13 | Camera is on the coast sand; painting is a glade with waterfall, log bridge and river; neither waterfall nor log bridge exists | `bm-13-vs-painting.jpg` | `viewer/bookmarks.ts` 13 | Camera over the river near (-120, 6, -175); add log bridge + waterfall (art) |
| WP-5 | C | Pines | Kenney stacked-cone pines, 1.7x fat, flat 2-tone; three pine families on the island (X-6) | `bm-13-vs-painting.jpg` | `tree_pineTallA.glb`, width 0.43 x height | One custom pine set |
| WP-6 | C | Floor | Mushrooms up to 2.3 m | `live-pines-logs-mushrooms.jpg` | `dressing.ts:279` | 0.4-0.9 m, one hero mushroom |
| WP-7 | B | Trail head | Sign is a grey gravestone (same as HF-4) | `ev-hoofington-stretched-props.jpg` | `layouts.ts:181` | Same asset as HF-4 |

## The Dam (painting 14)

| Id | Sev | Location / view | Issue | Evidence | Root cause | Fix |
|---|---|---|---|---|---|---|
| DM-1 | B | Plunge pool, right | A diagonal translucent cyan sheet and a white torus ring float over the rocks | `bm-14-vs-painting.jpg` | `visual-water.ts:193-206` creates `mountain-waterfall-*` quads + foam rings wherever a river segment drops 3.4 m, including inside the dam channel | **Code**: skip segments inside the dam plot |
| DM-2 | B | Banks | Three pine families side by side: Quaternius alpha-card pines (drooping branches), Kenney DefaultA cones, Kenney TallA; shaded sides render near-black | `live-dam-mixed-pines.jpg` | `visual-dam-landscape.ts:550-557` | One custom pine, no alpha cards |
| DM-3 | C | Reservoir | Flat opaque blue disc with no shoreline foam | `live-dam-reservoir.jpg` | `visual-water.ts` reservoir material | Shore foam ring, slight gradient |
| DM-4 | C | Path | Sign post 4.6 m tall (2.3x) | `bm-14-vs-painting.jpg` | `visual-dam-landscape.ts:571` | 2.2 m |
| DM-5 | C | Water | Buoys are survival barrels | `bm-14-vs-painting.jpg` | `visual-dam-landscape.ts:577` | Buoy asset |
| DM-6 | C | Dam deck | A roadside street lamp stands in the middle of the dam walkway; the reservoir surface is almost flush with the deck, and the downstream cyan sheet (DM-1) is visible from the deck | `postmerge-dam-deck.jpg` | Roadside lamps `layouts.ts:226-239` ignore the dam plot; reservoir level vs `DAM_DECK_HEIGHT` (`the-dam.ts:12-22`) | **Code**: skip lamps inside the dam plot; lower the visible reservoir 1-2 m |

The Dam GLB itself matches the painting well.

## Old Lighthouse (painting 15)

| Id | Sev | Location / view | Issue | Evidence | Root cause | Fix |
|---|---|---|---|---|---|---|
| LH-1 | A | Lighthouse | Grey stone pirate tower, blue cone cap floating above a gap, no red/white bands or lantern gallery | `bm-15-vs-painting.jpg`, `live-lh-tower-rocks.jpg` | `lighthouse` = `pirate-kit/tower-complete-large.glb` + glow cylinder (`visual-lighthouse.ts:486-496`) | **Asset**: red #d13f35 / white #f5f0e6 striped lighthouse with gallery and lamp room at 9 x 29 x 9 |
| LH-2 | A | Cottage, wreck, docks, cave | Generic library props render under the bespoke art: the cottage twice (GLB + procedural `makeCottage`, gable poking through the roof), a second shipwreck squashed 5.7x and sunk under the sea, docks twice, the cave twice | `live-lh-cottage-bridge.jpg`, `live-lh-wreck-duplicate.jpg` (ghost hull under water) | `buildLighthouseVisuals` never suppresses `props-*` instances (Hoofington/Downtown do, via `suppressOldArt`); live draw list showed `near-lighthouse`, `near-shipwreck`, `near-cave-mouth`, `far-dock:3`, `far-cottage` | **Code**: suppress generic `lighthouse`, `cottage`, `shipwreck`, `dock`, `cave-mouth` instances in the old-lighthouse plot (keep colliders) |
| LH-3 | A | Whole cape | ~100 bright white-grey "cotton ball" boulders cover the cliff | `bm-15-vs-painting.jpg`, `live-lh-tower-rocks.jpg` | Rock material `MeshLambertMaterial` with emissive `0x777b85` at 0.55 (`visual-lighthouse.ts:389-393`) + 88 shoulder rocks (`:660-680`) | **Code**: no emissive, darker grey-brown, fewer and embedded; **asset**: rocks with green tops |
| LH-4 | B | Rope bridge | Pale cyan deck, salmon posts, rope rails stretched into 3 m vertical U-posts | `live-lh-cottage-bridge.jpg` | `rope-rail` = `platformer-kit/fence-rope.glb` 27x (`dressing.ts:363`); `bridge` = `nature-kit/bridge_wood.glb` 3.1x | **Asset**: rope bridge segment |
| LH-5 | B | Water around the cape | A vertical sheet / darker rectangle shows where the terrain mesh ends under the water | `bm-15-vs-painting.jpg`, `live-lh-wreck-duplicate.jpg` | Terrain stops at the island edge with a vertical cut; transparent sea shows it | **Code**: seabed skirt sloping to deep water, or depth fog in the sea shader |
| LH-6 | B | Sky at golden hour | Flat grey-lilac; painting: saturated sunset | `bm-15-vs-painting.jpg`, `bm-09-vs-painting.jpg` | `visual-sky.ts` golden-hour colours | Warmer gradient, sun glow |
| LH-7 | C | Cape | Extra red-roof house next to the cottage (needed by a gig) | `live-lh-cottage-bridge.jpg` | `layouts.ts:208` | Keep collider, draw a shed or hide |
| LH-8 | C | Cape flag | Squashed pirate flag on a 9 m pole | `bm-15-vs-painting.jpg` | `layouts.ts:222` | Pennant pole |

## Island-wide (ground, roads, water, sky, scenery)

| Id | Sev | Location / view | Issue | Evidence | Root cause | Fix |
|---|---|---|---|---|---|---|
| IS-1 | A | Bookmarks 07, 16, any high view | The sea is a visible square slab with hard edges and a second inner square | `bm-07-vs-painting.jpg`, `bm-16-vs-painting.jpg`, `live-ocean-edges.jpg` | `visual-water.ts:170-176` `PlaneGeometry(size * 2.15)`; no horizon fog | **Code**: far larger sea disc fading into a horizon fog matched to the sky |
| IS-2 | A | Bookmark 16 (rising tide) | Tide water is opaque navy and square; clouds draw under it as dark blobs | `bm-16-vs-painting.jpg` | Sea `renderOrder = 2` (`visual-water.ts:177`) draws after the transparent clouds (`visual-sky.ts:68`, depthWrite false) | **Code**: clouds after water; teal shallow-water colour |
| IS-3 | B | Bookmark 07 | Key art is a ground-level farm vista (barn, silo, windmill, goats, mountain); the bookmark is an aerial island view | `bm-07-vs-painting.jpg` | `viewer/bookmarks.ts` 07 | Camera ~ (-190, 4, 110) looking at (0, 40, 0) |
| IS-4 | B | Bookmark 07 | A low cloud bank sits over Hoofington | `bm-07-vs-painting.jpg` | `visual-sky.ts:80-95` cloud ring at y 100-210 inside the bookmark frustum | Raise or move clouds |
| IS-5 | B | Every meadow | ~1,900 three-sided green cone "spikes" | `live-hoof-animals-hay-ramp.jpg`, `live-pines-tower-in-river.jpg` | `visual-meadow.ts:99` `ConeGeometry(0.17, 0.72, 3)` (QA P6 only fixed the `grass-tuft` prop) | **Asset**: daisy/low grass clumps |
| IS-6 | B | All roads | Saw-tooth edges on curves, overlapping slabs at joins, fans at ends | `live-hoof-entrance-sign.jpg`, `live-dt-pavement.jpg` | `render.ts:325-360` one instanced box per road segment | **Code**: continuous ribbon per road |
| IS-7 | B | Scenery trees | Round trees 1.8x too tall (lollipops), pines 1.6x fat; trees on beach sand | `live-hoof-overview.jpg`, `live-baa-pier-on-land.jpg` | `dressing.ts:389-394` width = 0.39 x height for both kinds | **Code**: width = native aspect (round 0.72 h, pine 0.25 h) |
| IS-8 | B | Scenery flowers/daisies | 1.6x too tall | Appendix A | `dressing.ts:394` width 0.55 x height vs native 0.9 | **Code**: native aspect |
| IS-9 | B | River crossings (27 decks) | Each road segment over water gets its own stretched arched bridge: a row of humps | Appendix A | `roads.ts:211-232` `bridge` per segment, `bridge_wood.glb` 3.1x | **Asset**: flat road bridge deck + railings, tiled |
| IS-10 | C | Sky | Beige clouds read as bread loaves | all bookmarks | `visual-sky.ts:64-95` | Whiter tops, flatter bases |

## Cross-cutting (systemic causes)

| Id | Sev | Issue | Root cause | Fix |
|---|---|---|---|---|
| X-1 | A | Almost every sourced model is distorted. Of 123 model usages, **102 stretch more than 1.3x between axes, 55 more than 3x, 32 more than 5x** (Appendix A) | `bakeLibraryPropGeometry` (`library-props.ts:130-134`) normalises each axis to 0.98 independently and the instance matrix scales to the collider box (`visual-props.ts:701`); `bakeLibraryGeometry` (`visual-hoofington.ts:259-261`), `instantiateLibraryModel` (`visual-lighthouse.ts:378-380`) and `instanceDamAsset` do the same. Collider boxes were sized for gameplay, not for the models | **Code** (one change, big win): default to aspect-preserving fit (uniform scale to fit inside the box, grounded at the box floor, centred); only assets that declare an anchor frame (custom true-scale assets) use per-axis fit. **Asset**: author hero props at their collider size, as done for Hoofington props and the crane set |
| X-2 | A | Long-axis mismatch: 10 models (14 uses) are long in Z but placed in boxes long in X: shipping container, construction fence (chain-fence), construction barrier (safety-rail, site-barrier), highway sign (Baa-ardwalk signboard), detail-beam (jib, girder, counterweight), cow, horse, pig, sheep, ship-wreck (generic and Lighthouse). The rope fence is a horizontal model used as a vertical post | Same baker, no orientation check | **Code**: if `(box.x > box.z) != (native.x > native.z)` rotate the model 90 degrees before fitting; container goes from 5.1x to 1.14x |
| X-3 | A | Degenerate source geometry: zero-thickness `factory-kit/floor-large.glb` (slabs), zero-depth `detail-cables-type-a.glb` (cables, now replaced), 0.17 m deep `cliff_cave_rock.glb` (caves) | Baker divides by `max(0.001, span)` | **Code**: reject models with an axis < 5% of the box; **asset**: proper volumes |
| X-4 | B | Kenney Nature Kit colours collapse to pastel salmon and teal: logs, stumps, rocks, stepping stones, ledges, Downtown/Dam trees, bridge | Nature-kit glTF base colours are washed-out: `dirt`/`woodBark` #f2be9e, `grass` #73eddd, `leafsGreen` #70e6d6, `leafsDark` #72d3d5, `stone` #ddf2f5 (measured in Blender). The bakers copy material colour straight into vertex colour | **Asset**: Blender recolour pass for every nature-kit model in use (rock #9aa0a4/#8f969b, log #8a5a3a, moss #86b95a, leaves #3f7d4c) or **code** palette remap per material name |
| X-5 | B | Alpha-textured models baked into solid shapes: retro scaffolding (bars, BLEND), retro balcony (bars), Quaternius pine leaves (BLEND), fountain water | Vertex-colour bake ignores alpha | **Asset**: solid geometry; no alpha cards (already a plan rule) |
| X-6 | B | Off-plan families still in use: Quaternius (medieval bench, hay, farm animals, Dam pines/rocks), Poly Pizza (barn, ferris wheel, hay, "gnome" avatar), Meshy (gnome), KayKit (Downtown chairs), Kenney fantasy-town (stalls, fountain, lanterns), pirate kit (lighthouse, lookout, pier, rails, docks, flags, wreck), platformer kit (crates, ramps, platforms, springs, rope fence), holiday lights, furniture kit (TV antenna, bench, table, trash) | Sourced to fill every `PropKind` without an art pass (`library-props.ts:13-89`) | Districts without an art pass (Baa-ardwalk, Pines, Mt Gigga, Lighthouse props, Crane Yard minor props) need one, in the plan's order |
| X-7 | B | District overrides are uneven: Hoofington and Downtown suppress the generic instances they replace; the Lighthouse does not (LH-2); the other districts have no override at all | `suppressOldArt` exists only in `visual-hoofington.ts` / `visual-downtown.ts` | One shared "replace generic instances in plot" helper used by every district module |
| X-8 | B | Absurd real-world sizes: AC 3.3 m, cones 1.15-1.65 m, mushrooms 2.3 m, Downtown planters 2.2-2.8 m tall, benches 1.55 m tall and 4.3 m long, hay bales 2.2 m, buoys 2.1 m, sign post 4.6 m, crates 3.6 m, highway lamps 8-8.5 m (lantern lamp is 4.2 m) | Visual size = collider size | Same as X-1: visual size can differ from the collider; list the visual sizes per kind in the art plan |
| X-9 | C | Tint lerps: generic props lerp 18% toward the descriptor colour (`visual-props.ts:815`); district bakes lerp walls 68% and every vertex above 71% height 82% to the roof colour (`visual-hoofington.ts:315-316`), which paints grey bands on tall stretched buildings | Legacy paint path | Keep tints off for Blender-painted assets (already done for Hoofington/Downtown shops) |
| X-10 | B | Bookmarks 07, 09, 10, 13 do not frame their paintings; 16 shows the square sea | `viewer/bookmarks.ts` | Re-shoot cameras (suggestions in IS-3, BW-11, CY-10, WP-4) |

## Evidence index (`docs/art/qa/full-1/`)

- Bookmarks next to paintings: `bm-07-vs-painting.jpg` ... `bm-16-vs-painting.jpg` (live, main @ 9fbe0b8)
- Post-merge re-check (#103, #106, #88): `postmerge-dt-skyline-crane-floating.jpg`, `postmerge-bm11-downtown.jpg`,
  `postmerge-bm10-crane-yard.jpg`
- Free views: `live-dt-giant-crane-figure.jpg`, `live-dt-east-overview.jpg`, `live-dt-rooftops.jpg`, `live-dt-pavement.jpg`,
  `live-crane-ground.jpg`, `live-crane-overview.jpg`, `live-baa-deck-level.jpg`, `live-baa-pier-on-land.jpg`,
  `live-hoof-overview.jpg`, `live-hoof-barn-silo-street.jpg`, `live-hoof-animals-hay-ramp.jpg`, `live-hoof-entrance-sign.jpg`,
  `live-gigga-summit-dish-flag.jpg`, `live-gigga-ledges-rocks.jpg`, `live-pines-lookout.jpg`, `live-pines-logs-mushrooms.jpg`,
  `live-pines-tower-in-river.jpg`, `live-dam-mixed-pines.jpg`, `live-dam-reservoir.jpg`, `live-lh-tower-rocks.jpg`,
  `live-lh-cottage-bridge.jpg`, `live-lh-wreck-duplicate.jpg`, `live-ocean-edges.jpg`, and on the post-merge build
  `postmerge-baa-from-sea.jpg`, `postmerge-crane-containers-fence.jpg`, `postmerge-gigga-cave-ledge.jpg`, `postmerge-dam-deck.jpg`
- Blender stretch sheets (cube / true proportions / in-game stretch, with per-axis factors):
  `ev-downtown-stretched-props.jpg`, `ev-crane-yard-stretched-props.jpg`, `ev-baaardwalk-stretched-props.jpg`,
  `ev-hoofington-stretched-props.jpg`, `ev-mtgigga-pines-lighthouse-props.jpg`

## Appendix A: stretch audit, every model usage (as tested, main @ 9fbe0b8)

Native bounds measured in Blender (glTF axes: W = X, H = Y up, D = Z). Distortion = largest / smallest per-axis
stretch; bold = above the plan's 1.3x limit. Representative descriptor box per use; ranges noted in the district
tables. Rows marked "hidden" are replaced by a district override when it loads.

| use | model (`public/assets/library/...`) | native W x H x D (m) | descriptor box (m) | stretch x / y / z | distortion | placed at (src/world/) | in game |
|---|---|---|---|---|---|---|---|
| crane-cable | kenney/retro-urban-kit/detail-cables-type-a.glb | 1.00 x 0.14 x 0.00 | 0.17 x 11.65 x 0.17 | 0.2 / 81.5 / 170.0 | **degenerate (zero-size axis)** | crane-yard.ts:124 | visible |
| chain-fence | kenney/city-kit-roads/construction-fence.glb | 0.07 x 0.18 x 0.38 | 8 x 2.85 x 0.18 | 106.7 / 15.9 / 0.5 | **222.2x** | crane-yard.ts:152 | visible |
| safety-rail | kenney/city-kit-roads/construction-barrier.glb | 0.14 x 0.13 x 0.23 | 13.1 x 1.25 x 0.18 | 97.0 / 9.6 / 0.8 | **121.3x** | crane-yard.ts:89 | visible |
| signboard (Baa-ardwalk) | kenney/city-kit-roads/sign-highway-wide.glb | 0.13 x 0.71 x 1.00 | 4.6 x 1.4 x 0.3 | 34.8 / 2.0 / 0.3 | **116.2x** | boardwalk.ts:115 | visible |
| crane-jib (main) | kenney/retro-urban-kit/detail-beam.glb | 0.25 x 0.25 x 1.00 | 78 x 3.1 x 3.25 | 312.0 / 12.4 / 3.2 | **96.0x** | crane-yard.ts:118 | visible |
| concrete-slab | kenney/factory-kit/floor-large.glb | 2.00 x 0.00 x 2.00 | 29 x 1.15 x 26 | 14.5 / 1150.0 / 13.0 | **degenerate (zero-size axis)** | crane-yard.ts:84 | visible |
| red-girder | kenney/retro-urban-kit/detail-beam.glb | 0.25 x 0.25 x 1.00 | 21.5 x 1.5 x 1.65 | 86.0 / 6.0 / 1.6 | **52.1x** | crane-yard.ts:126 | visible |
| pier | kenney/pirate-kit/structure-platform-dock.glb | 2.50 x 1.31 x 2.51 | 27 x 0.92 x 83 | 10.8 / 0.7 / 33.0 | **47.1x** | boardwalk.ts:64 | visible |
| rope-rail | kenney/platformer-kit/fence-rope.glb | 0.95 x 0.30 x 0.21 | 0.35 x 3 x 0.35 | 0.4 / 10.0 / 1.7 | **27.1x** | dressing.ts:363 | visible |
| DT lights garland | kenney/holiday-kit/lights-colored.glb | 1.01 x 0.32 x 0.06 | 27 x 0.36 x 0.28 | 26.7 / 1.1 / 4.4 | **23.5x** | visual-downtown.ts:223 | visible |
| pier-rail | kenney/pirate-kit/structure-fence.glb | 2.50 x 2.20 x 2.50 | 8 x 2.65 x 0.5 | 3.2 / 1.2 / 0.2 | **16.0x** | boardwalk.ts:87 | visible |
| sign (Hoofington / Pines) | kenney/city-kit-roads/road-sign-empty.glb | 0.05 x 0.47 x 0.05 | 5 x 3 x 0.5 | 100.0 / 6.3 / 10.0 | **15.8x** | layouts.ts:87,181 | visible |
| crane mast (main) | kenney/factory-kit/crane.glb | 1.93 x 3.55 x 3.68 | 3.35 x 40.5 x 3.35 | 1.7 / 11.4 / 0.9 | **12.5x** | crane-yard.ts:116 | visible |
| crane mast (rear) | kenney/factory-kit/crane.glb | 1.93 x 3.55 x 3.68 | 2.5 x 29.5 x 2.5 | 1.3 / 8.3 / 0.7 | **12.2x** | crane-yard.ts:138 | visible |
| bunting (Crane Yard) | kenney/holiday-kit/lights-colored.glb | 1.01 x 0.32 x 0.06 | 20 x 1.4 x 0.12 | 19.8 / 4.4 / 1.9 | **10.6x** | crane-yard.ts:109 | visible |
| scaffold pier pile | kenney/retro-urban-kit/scaffolding-structure.glb | 1.00 x 1.00 x 1.00 | 0.92 x 8.94 x 0.92 | 0.9 / 8.9 / 0.9 | **9.7x** | boardwalk.ts:77 | visible |
| deck | kenney/pirate-kit/platform-planks.glb | 1.89 x 0.43 x 2.70 | 39 x 0.92 x 27 | 20.6 / 2.1 / 10.0 | **9.6x** | boardwalk.ts:66 | visible |
| site-barrier | kenney/city-kit-roads/construction-barrier.glb | 0.14 x 0.13 x 0.23 | 4.3 x 1.65 x 0.9 | 31.9 / 12.7 / 4.0 | **8.0x** | crane-yard.ts:201 | visible |
| flag (Crane Yard) | kenney/pirate-kit/flag-high.glb | 1.34 x 3.60 x 0.40 | 4 x 3.2 x 0.15 | 3.0 / 0.9 / 0.4 | **8.0x** | crane-yard.ts:111 | visible |
| Hoof cow | quaternius/farm-animal-pack/cow_5XSc2Fka3F.glb | 2.34 x 6.12 x 9.18 | 4 x 2.8 x 2 | 1.7 / 0.5 / 0.2 | **7.8x** | visual-hoofington.ts:160 | visible |
| DT canopy (detail-awning-wide) | kenney/city-kit-commercial/detail-awning-wide.glb | 0.80 x 0.40 x 0.15 | 10 x 0.9 x 2.6 | 12.5 / 2.2 / 17.6 | **7.8x** | visual-downtown.ts:132 | visible |
| Hoof horse | quaternius/farm-animal-pack/horse_F8HAAcLeBL.glb | 2.56 x 8.00 x 9.24 | 4 x 3.5 x 1.85 | 1.6 / 0.4 / 0.2 | **7.8x** | visual-hoofington.ts:164 | visible |
| beam (counterweight) | kenney/retro-urban-kit/detail-beam.glb | 0.25 x 0.25 x 1.00 | 6.3 x 3.5 x 3.4 | 25.2 / 14.0 / 3.4 | **7.4x** | crane-yard.ts:122 | visible |
| awning (Baa-ardwalk) | kenney/city-kit-commercial/detail-awning.glb | 0.40 x 0.40 x 0.15 | 7.4 x 1 x 2.5 | 18.5 / 2.5 / 16.9 | **7.4x** | boardwalk.ts:111 | visible |
| scaffold wheel support | kenney/retro-urban-kit/scaffolding-structure.glb | 1.00 x 1.00 x 1.00 | 1.3 x 8 x 1.3 | 1.3 / 8.0 / 1.3 | **6.2x** | boardwalk.ts:126 | visible |
| ledge (Mt Gigga tiers) | kenney/nature-kit/cliff_half_rock.glb | 1.00 x 0.50 x 0.42 | 6.5 x 1.3 x 6.5 | 6.5 / 2.6 / 15.5 | **6.0x** | dressing.ts:323 | visible |
| shipwreck (generic) | kenney/pirate-kit/ship-wreck.glb | 4.80 x 9.96 x 10.60 | 22 x 8 x 8.5 | 4.6 / 0.8 / 0.8 | **5.7x** | dressing.ts:336 | visible + duplicate |
| LH wreck GLB | kenney/pirate-kit/ship-wreck.glb | 4.80 x 9.96 x 10.60 | 22 x 11.6 x 8.5 | 4.6 / 1.2 / 0.8 | **5.7x** | visual-lighthouse.ts:600 | visible |
| cave-mouth (Lighthouse) | kenney/nature-kit/cliff_cave_rock.glb | 1.00 x 1.00 x 0.17 | 9 x 5.5 x 5 | 9.0 / 5.5 / 29.6 | **5.4x** | dressing.ts:338 | visible + duplicate |
| lamp (roadside) | kenney/city-kit-roads/light-curved.glb | 0.05 x 0.68 x 0.23 | 0.55 x 8.5 x 0.55 | 11.0 / 12.6 / 2.4 | **5.2x** | layouts.ts:236 | visible (PR #88 swaps) |
| container | kenney/city-kit-industrial/shipping-container-a.glb | 0.37 x 0.35 x 0.82 | 12.2 x 4.6 x 5.3 | 32.7 / 13.2 / 6.4 | **5.1x** | crane-yard.ts:176 | visible |
| concrete-column | kenney/nature-kit/statue_column.glb | 0.30 x 1.00 x 0.30 | 1.65 x 27.5 x 1.65 | 5.5 / 27.5 / 5.5 | **5.0x** | crane-yard.ts:80 | visible |
| yard-scaffold | kenney/retro-urban-kit/scaffolding-structure.glb | 1.00 x 1.00 x 1.00 | 4.6 x 22.7 x 9.3 | 4.6 / 22.7 / 9.3 | **4.9x** | crane-yard.ts:101 | visible |
| crane-cab | kenney/factory-kit/crane-lift.glb | 0.72 x 2.50 x 0.72 | 5.2 x 3.7 x 4.1 | 7.3 / 1.5 / 5.7 | **4.9x** | crane-yard.ts:120 | visible |
| bunting (Baa-ardwalk) | kenney/holiday-kit/lights-colored.glb | 1.01 x 0.32 x 0.06 | 22.8 x 2.4 x 0.3 | 22.6 / 7.6 / 4.7 | **4.8x** | boardwalk.ts:140 | visible |
| flag (Mt Gigga) | kenney/pirate-kit/flag-high.glb | 1.34 x 3.60 x 0.40 | 0.7 x 9 x 0.7 | 0.5 / 2.5 / 1.8 | **4.8x** | layouts.ts:139 | visible |
| trampoline / playPad | kenney/platformer-kit/spring.glb | 0.75 x 0.47 x 0.75 | 8 x 1.1 x 7 | 10.7 / 2.4 / 9.3 | **4.5x** | dressing.ts:68 | visible |
| skylineCrane (Downtown) | kenney/factory-kit/crane.glb | 1.93 x 3.55 x 3.68 | 19 x 22 x 8 | 9.9 / 6.2 / 2.2 | **4.5x** | visual-downtown.ts:226 | visible, floats +16 m |
| lamp (Downtown) | kenney/city-kit-roads/light-curved.glb | 0.05 x 0.68 x 0.23 | 0.6 x 8 x 0.6 | 12.0 / 11.9 / 2.7 | **4.5x** | layouts.ts:122 | visible (PR #88 swaps) |
| lamp (Baa-ardwalk) | kenney/city-kit-roads/light-curved.glb | 0.05 x 0.68 x 0.23 | 0.85 x 8.4 x 0.85 | 17.0 / 12.4 / 3.8 | **4.5x** | boardwalk.ts:132 | visible (PR #88 swaps) |
| cave-mouth (Mt Gigga) | kenney/nature-kit/cliff_cave_rock.glb | 1.00 x 1.00 x 0.17 | 11 x 8 x 6 | 11.0 / 8.0 / 35.5 | **4.4x** | dressing.ts:326 | visible |
| ledge (Mt Gigga shelves) | kenney/nature-kit/cliff_half_rock.glb | 1.00 x 0.50 x 0.42 | 6 x 1.2 x 4.2 | 6.0 / 2.4 / 10.0 | **4.2x** | layouts.ts:147 | visible |
| rock (Mt Gigga, tall case) | kenney/nature-kit/rock_largeB.glb | 0.77 x 0.43 x 1.01 | 2.5 x 4.3 x 2.5 | 3.3 / 10.0 / 2.5 | **4.1x** | dressing.ts:329 | visible |
| Hoof sheep | quaternius/farm-animal-pack/sheep_C39AUXUUes.glb | 2.23 x 5.35 x 5.92 | 2.5 x 1.9 x 1.65 | 1.1 / 0.4 / 0.3 | **4.0x** | visual-hoofington.ts:161 | visible |
| Hoof pig | quaternius/farm-animal-pack/pig_TNvG3QUFlp.glb | 3.30 x 5.59 x 9.78 | 2 x 1.6 x 1.5 | 0.6 / 0.3 / 0.2 | **3.9x** | visual-hoofington.ts:163 | visible |
| Dam cliff rocks | kenney/nature-kit/rock_largeA.glb | 0.79 x 0.26 x 1.01 | 6 x 5.1 x 5.4 | 7.6 / 19.6 / 5.3 | **3.7x** | visual-dam-landscape.ts:548 | visible |
| satellite-dish | kenney/furniture-kit/televisionAntenna.glb | 0.27 x 0.10 x 0.08 | 7 x 10 x 7 | 26.4 / 97.1 / 87.5 | **3.7x** | layouts.ts:137 | visible |
| dock (generic, Lighthouse) | kenney/pirate-kit/structure-platform-dock-small.glb | 1.90 x 1.31 x 2.51 | 8 x 1.6 x 8 | 4.2 / 1.2 / 3.2 | **3.5x** | dressing.ts:343 | visible + duplicate |
| stepping-stone | kenney/nature-kit/rock_smallFlatA.glb | 0.50 x 0.07 x 0.43 | 3.1 x 1.35 x 3 | 6.2 / 20.8 / 7.0 | **3.3x** | dressing.ts:268 | visible |
| bench (Downtown) | kenney/furniture-kit/bench.glb | 0.40 x 0.47 x 0.20 | 4.3 x 1.55 x 1.3 | 10.7 / 3.3 / 6.5 | **3.3x** | dressing.ts:252 | visible |
| windmill | custom/hoofington-props/windmill.glb | 7.92 x 11.41 x 4.99 | 5 x 23 x 5 | 0.6 / 2.0 / 1.0 | **3.2x** | layouts.ts:72 | visible |
| bridge deck | kenney/nature-kit/bridge_wood.glb | 1.04 x 0.40 x 1.04 | 4.8 x 0.7 x 5.7 | 4.6 / 1.7 / 5.5 | **3.1x** | roads.ts:223 | visible |
| DT retroCanopy | kenney/retro-urban-kit/detail-awning-wide.glb | 1.00 x 0.28 x 0.30 | 10 x 0.9 x 2.6 | 10.0 / 3.2 / 8.7 | **3.1x** | visual-downtown.ts:132 | visible |
| LH mast GLB | kenney/pirate-kit/mast-ropes.glb | 4.39 x 7.89 x 2.35 | 2.7 x 15 x 2.7 | 0.6 / 1.9 / 1.1 | **3.1x** | visual-lighthouse.ts:614 | visible |
| ramp (Hoofington) | kenney/platformer-kit/platform-ramp.glb | 1.00 x 0.57 x 1.03 | 6 x 2 x 11 | 6.0 / 3.5 / 10.7 | **3.1x** | layouts.ts:86 | visible |
| platform (Hoofington) | kenney/platformer-kit/platform.glb | 1.00 x 0.20 x 1.00 | 15 x 1 x 12 | 15.0 / 5.1 / 12.0 | **2.9x** | layouts.ts:73 | visible |
| lookout | kenney/pirate-kit/tower-watch.glb | 3.05 x 2.79 x 3.05 | 9 x 24 x 9 | 3.0 / 8.6 / 3.0 | **2.9x** | dressing.ts:262 | visible |
| LH dock GLB | kenney/pirate-kit/structure-platform-dock.glb | 2.50 x 1.31 x 2.51 | 8 x 1.6 x 8 | 3.2 / 1.2 / 3.2 | **2.6x** | visual-lighthouse.ts:742 | visible |
| Dam signpost | kenney/survival-kit/signpost-single.glb | 0.21 x 0.46 x 0.04 | 3.7 x 4.6 x 1 | 17.7 / 10.0 / 23.3 | **2.3x** | visual-dam-landscape.ts:571 | visible |
| gnome (generic fallback) | polypizza/garden-gnome/gnome_Yy3yuQ4l6r.glb | 1.86 x 5.26 x 4.31 | 0.85 x 1.6 x 0.85 | 0.5 / 0.3 / 0.2 | **2.3x** | dressing.ts:83 | hidden when Meshy gnome loads |
| DT arcade (building-k) | kenney/city-kit-commercial/building-k.glb | 2.08 x 1.47 x 0.94 | 11 x 13.6 x 11.4 | 5.3 / 9.3 / 12.1 | **2.3x** | visual-downtown.ts:75 | visible |
| DT rear brickHouse (tower-d) | kenney/modular-buildings/building-sample-tower-d.glb | 1.10 x 3.76 x 1.10 | 10 x 18 x 11.5 | 9.1 / 4.8 / 10.5 | **2.2x** | visual-downtown.ts:123 | visible |
| hay-bale | quaternius/medieval-village-pack/hay_Yu8TOERkpw.glb | 0.12 x 0.18 x 0.12 | 2.2 x 1.5 x 2.2 | 18.2 / 8.4 / 17.6 | **2.2x** | layouts.ts:79 | visible |
| DT window-box flower | kenney/nature-kit/flower_purpleA.glb | 0.16 x 0.24 x 0.18 | 0.9 x 0.65 x 0.62 | 5.7 / 2.7 / 3.4 | **2.1x** | visual-downtown.ts:191 | visible |
| DT bread display | kenney/mini-shop/display-bread.glb | 0.70 x 0.50 x 0.60 | 2.7 x 2.05 x 1.2 | 3.9 / 4.1 / 2.0 | **2.0x** | visual-downtown.ts:215 | visible |
| platform (Pines lookout top) | kenney/platformer-kit/platform.glb | 1.00 x 0.20 x 1.00 | 11 x 1.1 x 11 | 11.0 / 5.6 / 11.0 | **1.9x** | dressing.ts:263 | visible |
| ramp (Downtown) | kenney/platformer-kit/platform-ramp.glb | 1.00 x 0.57 x 1.03 | 4.5 x 3 x 9 | 4.5 / 5.3 / 8.8 | **1.9x** | layouts.ts:107 | visible |
| planter (Downtown street) | kenney/city-kit-suburban/planter.glb | 0.40 x 0.18 x 0.30 | 2.6 x 2.2 x 2.6 | 6.5 / 12.4 / 8.7 | **1.9x** | dressing.ts:243 | visible |
| DT ice cream market (building-g) | kenney/city-kit-commercial/building-g.glb | 0.97 x 1.69 x 0.92 | 11 x 11.3 x 11.4 | 11.3 / 6.7 / 12.4 | **1.9x** | visual-downtown.ts:82 | visible |
| tree-oak (scenery) | custom/hoofington-props/tree-round-a.glb | 4.35 x 6.07 x 4.27 | 4.3 x 11 x 4.3 | 1.0 / 1.8 / 1.0 | **1.8x** | dressing.ts:393 | visible |
| mushroom | kenney/nature-kit/mushroom_red.glb | 0.17 x 0.20 x 0.20 | 1.7 x 2.3 x 1.25 | 9.8 / 11.3 / 6.2 | **1.8x** | dressing.ts:279 | visible |
| buoy | kenney/watercraft-kit/buoy.glb | 0.93 x 1.84 x 0.93 | 1.9 x 2.1 x 1.9 | 2.0 / 1.1 / 2.0 | **1.8x** | dressing.ts:199 | visible |
| DT bakery (building-h) | kenney/city-kit-commercial/building-h.glb | 0.88 x 1.29 x 1.01 | 11 x 9 x 11.4 | 12.4 / 7.0 / 11.3 | **1.8x** | visual-downtown.ts:76 | visible |
| DT rear kayHouse (KayKit F) | kaykit/city-builder-bits/building_F_withoutBase.gltf | 2.01 x 2.25 x 1.30 | 10 x 15 x 11.5 | 5.0 / 6.7 / 8.8 | **1.8x** | visual-downtown.ts:123 | visible |
| planter (Hoofington) | kenney/city-kit-suburban/planter.glb | 0.40 x 0.18 x 0.30 | 1.8 x 1.4 x 1.8 | 4.5 / 7.9 / 6.0 | **1.8x** | dressing.ts:115 | visible |
| tree-pine (Pines) | kenney/nature-kit/tree_pineTallA.glb | 0.39 x 1.53 x 0.39 | 5.4 x 12.5 x 5.4 | 14.0 / 8.2 / 13.8 | **1.7x** | layouts.ts:167 | visible |
| DT cafe (building-e) | kenney/city-kit-commercial/building-e.glb | 1.64 x 0.89 x 1.01 | 11 x 9 x 11.4 | 6.7 / 10.1 / 11.3 | **1.7x** | visual-downtown.ts:72 | visible |
| DT window-box planter | kenney/city-kit-suburban/planter.glb | 0.40 x 0.18 x 0.30 | 1.45 x 0.48 x 0.65 | 3.6 / 2.7 / 2.2 | **1.7x** | visual-downtown.ts:188 | visible |
| bumper | kenney/city-kit-roads/construction-barrier.glb | 0.14 x 0.13 x 0.23 | 2.4 x 2.3 x 2.4 | 17.8 / 17.7 / 10.7 | **1.7x** | boardwalk.ts:159 | visible |
| flower (scenery) | custom/hoofington-props/flowers-pink.glb | 0.65 x 0.72 x 0.65 | 0.6 x 1.1 x 0.6 | 0.9 / 1.5 / 0.9 | **1.7x** | dressing.ts:393 | visible |
| grass-tuft (daisies) | custom/hoofington-props/daisies.glb | 0.65 x 0.72 x 0.65 | 0.55 x 1 x 0.55 | 0.8 / 1.4 / 0.8 | **1.6x** | dressing.ts:393 | visible |
| DT table | kenney/furniture-kit/tableRound.glb | 0.69 x 0.37 x 0.80 | 1.55 x 1.15 x 1.55 | 2.2 / 3.1 / 1.9 | **1.6x** | visual-downtown.ts:203 | visible |
| DT boutique (building-j) | kenney/city-kit-commercial/building-j.glb | 2.08 x 1.69 x 1.34 | 11 x 9 x 11.4 | 5.3 / 5.3 / 8.5 | **1.6x** | visual-downtown.ts:74 | visible |
| bench (Baa-ardwalk) | kenney/retro-urban-kit/detail-bench.glb | 0.60 x 0.41 x 0.32 | 3.5 x 1.5 x 1.2 | 5.8 / 3.7 / 3.7 | **1.6x** | boardwalk.ts:147 | visible |
| tree-pine (scenery) | kenney/nature-kit/tree_pineTallA.glb | 0.39 x 1.53 x 0.39 | 5.5 x 14 x 5.5 | 14.2 / 9.2 / 14.0 | **1.6x** | dressing.ts:393 | visible |
| DT retroBalcony | kenney/retro-urban-kit/balcony-type-a.glb | 1.00 x 0.28 x 0.28 | 2.5 x 0.7 x 1.1 | 2.5 / 2.5 / 3.9 | **1.6x** | visual-downtown.ts:180 | visible |
| bench (Hoofington) | quaternius/medieval-village-pack/bench_7uSlZo3n9Y.glb | 0.67 x 0.19 x 0.22 | 3.6 x 1.55 x 1.3 | 5.4 / 8.3 / 5.9 | **1.5x** | dressing.ts:118 | visible |
| DT AC unit | kenney/modular-buildings/detail-ac-a.glb | 0.24 x 0.11 x 0.24 | 3.3 x 2.1 x 3.1 | 13.8 / 19.8 / 12.9 | **1.5x** | visual-downtown.ts:143 | visible |
| DT rear townhouse (tower-a) | kenney/modular-buildings/building-sample-tower-a.glb | 1.10 x 2.50 x 1.25 | 10 x 15 x 11.5 | 9.1 / 6.0 / 9.2 | **1.5x** | visual-downtown.ts:123 | visible |
| water-tower | kenney/city-kit-industrial/water-tower.glb | 0.85 x 2.14 x 0.83 | 4.5 x 7.6 x 4.5 | 5.3 / 3.5 / 5.4 | **1.5x** | dressing.ts:232 | visible |
| log | kenney/nature-kit/log.glb | 0.23 x 0.17 x 0.71 | 3.5 x 2.2 x 7 | 15.0 / 12.7 / 9.9 | **1.5x** | layouts.ts:174 | visible |
| rock (Pines) | kenney/nature-kit/rock_largeB.glb | 0.77 x 0.43 x 1.01 | 3.5 x 2.2 x 7 | 4.6 / 5.1 / 6.9 | **1.5x** | layouts.ts:174 | visible |
| pipe-stack | kenney/factory-kit/pipe-large.glb | 1.00 x 1.00 x 1.00 | 6 x 4.2 x 6.2 | 6.0 / 4.2 / 6.2 | **1.5x** | crane-yard.ts:189 | visible |
| DT trash can | kenney/furniture-kit/trashcan.glb | 0.21 x 0.43 x 0.23 | 0.85 x 1.2 x 0.85 | 4.1 / 2.8 / 3.6 | **1.5x** | visual-downtown.ts:200 | visible |
| stump | kenney/nature-kit/stump_round.glb | 0.32 x 0.21 x 0.37 | 2.8 x 2.2 x 2.8 | 8.7 / 10.7 / 7.5 | **1.4x** | dressing.ts:283 | visible |
| DT cone | kenney/city-kit-roads/construction-cone.glb | 0.07 x 0.09 x 0.07 | 0.65 x 1.15 x 0.65 | 8.7 / 12.2 / 8.7 | **1.4x** | visual-downtown.ts:219 | visible |
| DT corner shop (building-b) | kenney/city-kit-commercial/building-b.glb | 0.97 x 1.29 x 0.94 | 11 x 11.3 x 11.4 | 11.3 / 8.7 / 12.1 | **1.4x** | visual-downtown.ts:80 | visible |
| Hoof planter (scatter) | kenney/city-kit-suburban/planter.glb | 0.40 x 0.18 x 0.30 | 1.5 x 0.85 x 1.05 | 3.8 / 4.8 / 3.5 | **1.4x** | visual-hoofington.ts:144 | visible |
| ferris-wheel | polypizza/ferris-wheel/ferris-wheel_6CepsZjXBw.glb | 1.00 x 1.14 x 0.21 | 29.5 x 29 x 4.6 | 29.4 / 25.6 / 22.1 | **1.3x** | boardwalk.ts:122 | visible |
| DT hay mart (building-g) | kenney/city-kit-commercial/building-g.glb | 0.97 x 1.69 x 0.92 | 11 x 15.9 x 11.4 | 11.3 / 9.4 / 12.4 | **1.3x** | visual-downtown.ts:83 | visible |
| cone (Crane Yard) | kenney/city-kit-roads/construction-cone.glb | 0.07 x 0.09 x 0.07 | 1 x 1.65 x 1 | 13.3 / 17.6 / 13.3 | **1.3x** | crane-yard.ts:209 | visible |
| booth | kenney/fantasy-town-kit/stall-red.glb | 1.00 x 1.24 x 1.00 | 7.2 x 6.8 x 6.4 | 7.2 / 5.5 / 6.4 | **1.3x** | boardwalk.ts:108 | visible |
| DT books (KayKit D) | kaykit/city-builder-bits/building_D_withoutBase.gltf | 1.61 x 2.25 x 1.30 | 11 x 15.9 x 11.4 | 6.8 / 7.1 / 8.8 | 1.3x | visual-downtown.ts:81 | visible |
| DT oak (tree_detailed) | kenney/nature-kit/tree_detailed.glb | 0.85 x 1.33 x 0.76 | 6.8 x 13.5 x 6.8 | 8.0 / 10.1 / 8.9 | 1.3x | visual-downtown.ts:211 | visible |
| house farmhouse | custom/hoofington-houses/house-c-white.glb | 1.31 x 1.03 x 1.04 | 10 x 9 x 10 | 7.7 / 8.7 / 9.6 | 1.3x | layouts.ts:68 | visible |
| house yellowHome | custom/hoofington-houses/house-e-yellow.glb | 1.30 x 1.14 x 1.04 | 10 x 9 x 10 | 7.7 / 7.9 / 9.6 | 1.2x | layouts.ts:64 | visible |
| cottage (Hoofington) | custom/hoofington-houses/house-r-sky.glb | 1.03 x 1.14 x 1.04 | 9 x 8 x 8 | 8.8 / 7.0 / 7.7 | 1.2x | dressing.ts:66 | visible |
| DT cinema (building-d) | kenney/city-kit-commercial/building-d.glb | 0.84 x 1.29 x 0.90 | 11 x 13.6 x 11.4 | 13.1 / 10.5 / 12.7 | 1.2x | visual-downtown.ts:73 | visible |
| barn (Hoofington) | polypizza/barn/barn_A6UkPq33aZ.glb | 0.50 x 0.44 x 0.70 | 15 x 12 x 17 | 30.1 / 27.0 / 24.1 | 1.2x | visual-hoofington.ts:21 | visible |
| barrel (Downtown) | kenney/survival-kit/barrel.glb | 0.24 x 0.34 x 0.24 | 1.5 x 1.8 x 1.5 | 6.4 / 5.2 / 6.4 | 1.2x | layouts.ts:127 | visible |
| crate (yard) | kenney/platformer-kit/crate.glb | 0.50 x 0.50 x 0.50 | 3.6 x 3 x 3.6 | 7.2 / 6.0 / 7.2 | 1.2x | crane-yard.ts:184 | visible |
| house creamHome | custom/hoofington-houses/house-t-cream.glb | 1.34 x 1.16 x 1.44 | 10 x 8 x 9 | 7.5 / 6.9 / 6.2 | 1.2x | layouts.ts:70 | visible |
| bush (scenery) | custom/hoofington-props/bush-round-a.glb | 1.54 x 1.02 x 1.39 | 3.4 x 2.7 x 3.4 | 2.2 / 2.6 / 2.4 | 1.2x | dressing.ts:393 | visible |
| DT tower (skyscraper-c) | kenney/city-kit-commercial/building-skyscraper-c.glb | 1.28 x 4.08 x 1.39 | 8 x 27 x 8 | 6.2 / 6.6 / 5.8 | 1.1x | visual-downtown.ts:127 | visible |
| lighthouse | kenney/pirate-kit/tower-complete-large.glb | 3.63 x 10.22 x 3.63 | 9 x 29 x 9 | 2.5 / 2.8 / 2.5 | 1.1x | layouts.ts:205 | visible |
| silo | custom/hoofington-props/silo.glb | 3.67 x 9.07 x 3.51 | 7.5 x 21 x 7.5 | 2.0 / 2.3 / 2.1 | 1.1x | dressing.ts:62 | visible |
| house pinkHome | custom/hoofington-houses/house-f-pink.glb | 1.44 x 1.14 x 1.42 | 9 x 8 x 9 | 6.2 / 7.0 / 6.3 | 1.1x | layouts.ts:66 | visible |
| barn (generic) | quaternius/farm-buildings-bundle/small-barn_aTcDP7UERC.glb | 6.08 x 4.96 x 6.27 | 15 x 12 x 17 | 2.5 / 2.4 / 2.7 | 1.1x | layouts.ts:63 | hidden by Hoofington override |
| house (Old Lighthouse) | custom/hoofington-houses/house-t-white.glb | 1.34 x 1.16 x 1.44 | 9 x 7 x 9 | 6.7 / 6.1 / 6.2 | 1.1x | layouts.ts:208 | visible |
| cottage (Old Lighthouse, generic) | custom/hoofington-houses/house-f-white.glb | 1.44 x 1.14 x 1.42 | 10 x 8 x 9 | 6.9 / 7.0 / 6.3 | 1.1x | layouts.ts:209 | visible + duplicate |
| fence (picket) | custom/hoofington-props/picket-fence.glb | 9.20 x 1.85 x 0.35 | 9 x 1.85 x 0.34 | 1.0 / 1.0 / 1.0 | 1.0x | dressing.ts:90 | visible |
| Hoof oak (scatter) | custom/hoofington-props/tree-round-a.glb | 4.35 x 6.07 x 4.27 | 12 x 17 x 12 | 2.8 / 2.8 / 2.8 | 1.0x | visual-hoofington.ts:135 | visible |
| mailbox | custom/hoofington-props/mailbox.glb | 1.30 x 2.20 x 1.00 | 1.3 x 2.2 x 1 | 1.0 / 1.0 / 1.0 | 1.0x | dressing.ts:78 | visible |

## Appendix B: models merged during this pass (#103 Downtown shops, #106 Crane Yard)

| Slot (model) and box | Stretch x / y / z | Distortion |
|---|---|---|
| cafe (shop-e-peach) 11 x 9 x 11.4 | 6.7 / 10.0 / 9.3 | **1.49x** |
| cinema (shop-d-mint) 11 x 13.6 x 11.4 | 13.1 / 10.5 / 10.5 | 1.25x |
| boutique (shop-j-cream) 11 x 9 x 11.4 | 5.1 / 5.3 / 7.4 | **1.44x** |
| Kid Arcade (shop-k-lavender) 11 x 13.6 x 11.4 | 5.3 / 9.2 / 10.4 | **1.96x** |
| Baakery (shop-h-pink) 11 x 9 x 11.4 | 12.5 / 6.9 / 9.8 | **1.81x** |
| Flowers / Hoof & Co (shop-b-pink) 11 x 11.3 x 11.4 | 11.3 / 8.7 / 9.6 | 1.30x |
| Books (shop-c-yellow) 11 x 15.9 x 11.4 | 12.4 / 17.7 / 8.8 | **2.00x** |
| Ice Cream (shop-g-yellow) 11 x 11.3 x 11.4 | 11.3 / 6.6 / 10.5 | **1.71x** |
| Hay Mart (shop-g-yellow) 11 x 15.9 x 11.4 | 11.3 / 9.4 / 10.5 | 1.21x |
| rear row z > 0 (shop-l-peach) 10 x 15 x 11.5 | 7.0 / 6.6 / 7.2 | 1.10x |
| rear row z = 0 (shop-m-pink) 10 x 18 x 11.5 | 8.1 / 5.7 / 8.0 | **1.42x** |
| rear row z < 0 (shop-f-lavender) 10 x 15 x 11.5 | 11.9 / 8.8 / 9.7 | **1.35x** |
| tower (shop-l-peach) 8 x 27 x 8 | 5.6 / 11.8 / 5.0 | **2.35x** |
| skyline-tower-crane 19 x 22 x 8 | 1.0 / 1.0 / 1.0 | 1.01x |
| crane-mast 3.35 x 40.5 x 3.35 | 0.9 / 1.0 / 0.9 | 1.07x |

The crane set is built at collider size (about 1x). Seven of the twelve Downtown building slots still exceed 1.3x;
the worst are the tower (2.35x), Books (2.0x) and Kid Arcade (1.96x).
