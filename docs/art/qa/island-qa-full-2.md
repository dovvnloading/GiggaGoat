# Billy Isle full visual QA, pass 2 (whole island)

Strict art-director pass of the live World Lab against the target paintings (`docs/art/hifi/07`-`16`), after the
pass-1 fixes (`island-qa-full-1.md`) landed.

**Build tested.** GitHub Pages deploy of `main @ 9026c7e` (CY-11 paving, IS-6 road ribbons). During the pass #140
(DM-1 river quads) and #141 (HF-9 garden patches) merged and deployed; I re-shot bookmarks 08 and 14, the Hoofington
overview, the Dam deck, the Pines/Dam river and the island overview on `main @ 3c30077`. Every caption names its build.

**Method.** Each bookmark was rendered exactly as the World Lab renders it (bookmark select, 7 s for models, pixel
ratio forced to 1, UI hidden), then compared with its painting (top: live, bottom: painting, both 16:9). Each
district was then checked from 2-3 free cameras (goat eye height 1.6-2 m, prop level, and one 60-230 m overview),
placed by script through the page's own OrbitControls instance; scene objects were measured in the live scene graph
(instance transforms, mesh bounds, terrain heights). No source was edited and nothing was built locally.

**Severity.** **A** blocks the art (reads wrong at a glance), **B** clearly wrong, **C** polish. **Fix type**:
**Asset** = a model must be built or rebuilt; **Code** = placement, size, material or logic.
Ids continue pass 1: a pass-1 id means the item is still open; new ids start after the pass-1 numbers. `BK` = bookmark
cameras, `RT` = rising-tide mode. Evidence files are in `docs/art/qa/full-2/`.

## Top 15 (whole island, ranked)

| Rank | Id | Sev | Fix type | Issue | Fix (one line) |
|---|---|---|---|---|---|
| 1 | BK-1 | A | Code | Bookmarks 07, 09, 10 and 13 never render from their authored cameras: OrbitControls `maxPolarAngle = 0.49π` lifts any camera that sits below its target (07: y 9 to 47, 09: 9 to 24.9, 10: 11.5 to 20.8, 13: 6.5 to 10.3), so the eye-level painting views become aerial shots | In `applyBookmark` raise `orbit.maxPolarAngle` (e.g. 0.95π) before `orbit.update()`, and test that the rendered camera equals the bookmark camera |
| 2 | IS-11 / DM-1 | A | Code | The upstream `rippling-river` ribbon flies 10-22 m above the Pines/Dam valley as a straight translucent aqueduct and lies across the right half of bookmark 14; #140 did not remove it | Drape the river ribbon on the terrain (subdivide every 2 m, y = ground + 0.15) and drop river-segment falls near the Dam |
| 3 | MG-5 | A | Asset | Mt Gigga waterfalls are flat striped rectangles laid on smooth slopes (one clipped into a triangle), no source, no pool, foam is five beads in a row | Build a cascade asset (lip, 2-3 steps, splash pool, mist) and place it on a real terrace riser |
| 4 | CY-12 | A | Code | The ring road runs straight through the fenced Crane Yard, between the frame and the tower crane | Route the ring road outside the west fence; add a short gate spur |
| 5 | BW-14 / DT-16 | A | Asset + Code | Every kiosk sign and 7 m Downtown roof-line board is a blank cream panel with two brown bars (reads as a "≡" placeholder); painting signs have names and icons | Asset: five painted sign variants; Code: stop placing signboards on Downtown houses |
| 6 | DT-15 | A | Asset | Downtown rooftop water towers are black steel lattice masts with a grey cone (Kenney industrial), reading as oil derricks; painting: wooden barrel tanks | Build a timber barrel tank on short legs at about 3.5 x 5.5 x 3.5 m |
| 7 | BK-2 | A | Code | Bookmark 07's authored camera (-190, 9, 110) is about 2 m from the barn wall: once BK-1 is fixed the key art shows a red wall | Re-pick the 07 camera 40-60 m south-west of the barn (barn left third, windmill centre, summit centre) |
| 8 | IS-13 | B | Code | Every coastline is a regular staircase of ~4 m teeth in all high views | Shoreline strip/foam along the 0 m contour, or finer coastal terrain and a wider shallow fade |
| 9 | IS-15 | B | Code | Grass/rock slope colouring makes green saw-teeth down every cliff; Mt Gigga reads as a striped cone in 07, 08, 12 | Blend cliff/grass per fragment from the world normal with noise instead of per 3.9 m vertex |
| 10 | IS-14 | B | Code | The ocean is one plane sine wave: parallel 22 m stripes that converge into a sunburst in every high view | Two or three crossed wavelengths plus a distance fade, or a tiling noise |
| 11 | WP-3 / LH-10 / HF-5 | B | Asset + Code | Generic `platform` timber decks float in the air: 4.5 m and 8.5 m up between Pines trees, jutting out of the Lighthouse cliff at 16 m, and a 15 x 12 m deck on the Hoofington lawn | Asset: tree-house deck with posts and ladder; Code: delete the cape and Hoofington decks |
| 12 | CY-13 | B | Code | Crane Yard crates are 3.1-3.6 m cubes stacked into 9 m towers; painting crates are about 1 m | 1.2 x 1.0 x 1.2 m crates, stacks of at most two, on pallets |
| 13 | DM-7 | B | Code | No reservoir: the lake mesh is hidden once the Dam GLB loads, leaving the open sea directly behind the dam and a small rectangular water slab | Keep a reservoir surface for the valley behind the dam, with jetty and boat dressing |
| 14 | IS-16 | B | Code | Golden-hour sun is fixed toward +x/-z: at 09 it is behind the camera (no sun, flat purple/orange band), at 15 only a glow | Put the golden-hour sun low in the west so 09 and 15 frame it |
| 15 | RT-1 | B | Code | Rising tide is shown in noon sun on a calm navy sea, with no storm, whitecaps or floating debris | Storm lighting preset and rougher water when tide > 0; instanced floating debris |

## Bookmark cameras and composition (all paintings)

What works: 08, 11, 14 and 15 frame the right subjects; the authored eye-level cameras of 09 and 10 (if rendered)
are close to their paintings.

| Id | Sev | Where/view | Issue | Evidence | Likely root cause | Fix |
|---|---|---|---|---|---|---|
| BK-1 | A | 07, 09, 10, 13 (08 and 11 by 1-1.4 m) | The rendered camera is not the bookmark camera. Measured after `change`: 07 (-191.8, **47.0**, 111) for authored y 9; 09 y **24.9** for 9; 10 y **20.8** for 11.5; 13 y **10.3** for 6.5; 08 12.5 for 11.5; 11 13.4 for 12. 09 becomes a 20 m-high view of sky and sea with a tiny wheel; 07 becomes an aerial mountain shot | `bm-07-vs-painting.jpg`, `bm-09-vs-painting.jpg` vs `live-09-authored-camera.jpg`, `bm-10-vs-painting.jpg` vs `live-10-authored-camera.jpg` | `viewer/viewer.ts:71` `orbit.maxPolarAngle = Math.PI * 0.49` clamps every camera below its target; `applyBookmark` calls `orbit.update()` (`viewer.ts:267`) and the loop calls it every frame | **Code**: set `orbit.maxPolarAngle` to about 0.95π (or per bookmark) before the update; add a `bookmarks.test.ts` case that compares the camera after one update with the bookmark |
| BK-2 | A | 07 key art | Authored camera (-190, 9, 110) sits about 2 m from the barn's long wall: the unclamped frame is a red wall, a hay bale and the silo base. Painting: hilltop meadow with goats, farm on the left, windmill centre-right, mountain centred | `live-07-authored-camera-against-barn.jpg`, `bm-07-vs-painting.jpg` | `viewer/bookmarks.ts:18-20` | **Code**: re-pick 40-60 m south-west of the barn, eye height ~2.5 m on the meadow (e.g. (-200, 9, 170) aimed at (0, 40, 0)), checked with the bookmark probe test so the barn lands in the left third |
| BK-3 | B | 13 | The authored camera is 1.2 m above the ring road where it crosses the Pines river (road surface y 5.3 at (-131.6, -162.8)): unclamped, the bottom half of the frame is grey asphalt; clamped, a grey band still fills the bottom 12% and a floating deck the top right | `live-13-authored-camera-on-road.jpg`, `bm-13-vs-painting.jpg` | `viewer/bookmarks.ts:39-41` | **Code**: move the camera off the road onto the downstream bank, about 1.8 m above ground, framing log bridge, lookout and river; assert ≥ 3 m from any road point in the bookmark test |
| BK-4 | B | 08 | The street goat is placed 6.5 m ahead on the camera's centre line: only its horns and head poke up at the bottom edge, blocking the road vanishing point. Painting 08 has no goat on the road | `bm-08-vs-painting.jpg` | `viewer/viewer.ts:254-257` (08 uses offset 0 / 6.5 m, scale 1) | **Code**: use the 11 treatment (4 m left, 14 m ahead, 0.78 scale) on the left lawn, or hide it at 08 |
| BK-5 | B | 16 | The camera (264, 249, 284) is inside the cloud ring (radius 330-710 m, y 150-250): a faceted cloud cuts across the left third | `bm-16-vs-painting.jpg` | `visual-sky.ts:98-101` cloud ring vs `viewer/bookmarks.ts:48-50` | **Code**: clouds at y 300-380, or keep bookmark cameras below 140 m |
| BK-6 | C | 12 | Camera at 98 m looks down on the mountain; painting looks up from the base with the cave, waterfall and trail in the foreground | `bm-12-vs-painting.jpg` | `viewer/bookmarks.ts:36-38` | **Code**: camera near the south-east base (~15 m up), aimed at mid-height |
| BK-7 | C | 15 | fov 35 from 38 m: sky is only a flat orange strip; painting is near water level with the sun and pink clouds behind the tower | `bm-15-vs-painting.jpg` | `viewer/bookmarks.ts:45-47` | **Code**: lower to ~10 m over the water south of the wreck, fov ~45 (needs IS-16) |

## Island-wide (water, terrain, sky)

What works: the round sea with seabed skirt (no square slab), road ribbons without slab fans (IS-6), the toon
lighting and outline style, pines and round trees in one family.

| Id | Sev | Where/view | Issue | Evidence | Likely root cause | Fix |
|---|---|---|---|---|---|---|
| IS-11 | A | Valley between Mt Gigga, Whispering Pines and the Dam; visible from 13, 14 and the island overview | The upstream river ribbon is a straight translucent sheet in the air. Live vertex data vs terrain: (-42.5, -103.1) ribbon y 23.1 over ground 1.1 (22 m up); (-30.3, -142.0) 14.1 over 2.4; (-22.5, -173.7) 12.1 over 3.7. It crosses over the pines like an aqueduct and slices over the Dam plunge pool (DM-1) | `live-pines-dam-floating-river.jpg` (on 3c30077, after #140), `bm-14-vs-painting.jpg`, thin blue line in `bm-13-vs-painting.jpg` | `visual-water.ts:221-262` `riverMesh` puts each pair at `p.level + 0.12` and joins 30-40 m segments straight, never sampling terrain; `:336` builds it from `island.river.slice(0, 5)`, whose levels do not match the carved ground. #140 only drops quads steeper than 0.25 near the Dam; these are 0.12-0.22 | **Code**: subdivide every 2 m and set y = `gridSample` + 0.15 (or carve the bed to the river levels in terrain generation); where level drops > 2 m over a segment, emit a waterfall instead of a sloping ribbon |
| IS-13 | B | Every coast, any view above ~20 m | Sand/sea edge is a regular staircase of ~4 m teeth (Hoofington beach, Crane Yard shore, whole island) | `live-hoof-coast-bales-sawtooth.jpg`, `live-island-overview.jpg`, `live-crane-overview-road.jpg` | Likely the 193-sample terrain grid (~3.9 m cells, `viewer.ts:223`) and its triangle diagonals crossing the flat sea; the sea's `cover` fade (`visual-water.ts:180`) is too narrow to hide it | **Code**: shoreline foam/sand strip built along the 0 m contour, or finer coastal terrain plus a wider shallow-water fade |
| IS-14 | B | Open sea, every high or mid view | One plane wave `sin(dot(xz, (0.23, 0.18)))` drives all colour bands: parallel 22 m stripes that converge in perspective into a sunburst around the island | `live-island-overview.jpg`, `bm-12-vs-painting.jpg`, `bm-15-vs-painting.jpg`, `live-gigga-summit.jpg` | `visual-water.ts:174-176` | **Code**: sum two or three waves at different angles and wavelengths, fade the band term with distance; keep the coastal foam |
| IS-15 | B | All slopes, Mt Gigga most | Grass-to-rock colour changes per terrain vertex, so every cliff shows rows of green saw-teeth hanging into grey (MG-7 shape problem made worse) | `bm-07-vs-painting.jpg`, `bm-08-vs-painting.jpg`, `bm-12-vs-painting.jpg`, `live-gigga-lower-waterfall.jpg` | `render.ts:132-192` slope/cliff/terrace colour written per vertex and interpolated across 3.9 m triangles | **Code**: compute the cliff/grass blend in the terrain fragment shader from the world normal and height (with noise), or snap it to the terrace bands |
| IS-16 | B | Golden hour (09, 15) | Sun direction is `(cos·0.7 + 0.48·day, alt·0.87, -0.63)`, always east/north: at 09 (looking south) the sun is behind the camera, so the sky is a flat purple-to-orange band with no sun; painting 09 has the sun on the sea horizon at right, 15 at left | `bm-09-vs-painting.jpg`, `live-09-authored-camera.jpg`, `bm-15-vs-painting.jpg` | `visual-sky.ts:151-152`, sun mesh `:158` | **Code**: golden-hour azimuth in the west (-x), 3-6° altitude; add warm cloud rims |
| IS-10 | C | Sky, all bookmarks | Clouds are triplets of inflated ellipsoids at one height band, uniform cream (pink at golden hour): read as bread rolls, not the painting's layered cumulus | all `bm-*.jpg` | `visual-sky.ts:81-116` | **Asset/Code**: 3-4 authored cloud meshes with flat bases, varied heights (open since pass 1) |

## Hoofington (painting 08)

What works: houses with shutters and flower boxes, red barn, silo with ladder, windmill with sails, picket fences,
red mailboxes, lantern lamps, upright round bales, gnomes, round trees; the overall palette now matches the painting.

| Id | Sev | Where/view | Issue | Evidence | Likely root cause | Fix |
|---|---|---|---|---|---|---|
| HF-12 | B | Bookmark 08, street level | Houses stand back behind 8-10 m of empty lawn on both sides; the painting's cottages sit on the pavement with front-garden clutter (bench, watering can, gnome, trampoline, barrel, lamp banners). The street reads empty | `bm-08-vs-painting.jpg`, `live-hoof-street-level-kerb.jpg` | `layouts.ts:66-73` house centres at ±20-22 m with 9-10 m boxes | **Code**: bring house fronts to ~4 m behind the pavement; move bench, gnome, trampoline, barrel and planter into the front gardens inside the 08 frame |
| HF-13 | B | South end of the main street, goat height | A pale sidewalk/kerb slab runs diagonally into the left lane at the junction with the ring road | `live-hoof-street-level-kerb.jpg` | `visual-streets.ts` walkway and kerb strips (`render(walkways, 'paved-village-sidewalks')`, `:162-163`) extend past the street end into the junction | **Code**: clip sidewalk and kerb strips at the ring-road ribbon edge |
| HF-5 | B | South lawn, east lawn, west field | Still a 15 x 12 m timber deck on the lawn with the trampoline beside it, seven 1.8 m orange crates scattered under the trees, a 6 x 11 m ramp in the hay field; none of this is in the painting | `live-hoof-overview.jpg`, `live-hoof-coast-bales-sawtooth.jpg` | `layouts.ts:75` (platform), `:84-88` (crates, ramp) | **Code**: remove the deck and crates (or 1 m farm crates by the barn); trampoline into a back garden |
| HF-3 | C | West field | The 2.2 m upright bales (art-plan size) are scattered at random, intersect each other and the fence (bales #1 and #6 are 0.9 m apart at (-184, 118) on the fence line) and pile onto the ramp; from any height they read as gold coins. Painting: a few bales on their side in a tidy row by the barn | `live-hoof-west-field-hay.jpg`, `live-hoof-coast-bales-sawtooth.jpg` | `layouts.ts:80-83` (19 random dynamic bales), `dressing.ts:105` (static bales) | **Code**: two or three tidy rows/stacks in the farmyard, ≥ 2.6 m apart, clear of fences. **Asset** optional: on-side bale variant |
| HF-10 | C | Bookmark 08 | Still no waterfall on the mountain face behind the village (the painting's focal point) | `bm-08-vs-painting.jpg` | `visual-water.ts:417-432` places terrace falls on other faces | In progress per pass-1 item |
| HF-14 | C | Overview | The new vegetable patches (#141) read as bare brown squares from 70 m | `live-hoof-overview.jpg` | `visual-ground.ts` patches | Check at street level; add row texture or crop clumps |

## Baa-ardwalk (painting 09)

What works: the pier now starts at the waterline and runs over the sea (BW-1 fixed); pastel kiosks with striped
valances, triangle pennant bunting, white balustrades, timber piles, lantern lamps, white/pink Ferris wheel with
coloured gondolas, striped buoys, palms and beach balls.

| Id | Sev | Where/view | Issue | Evidence | Likely root cause | Fix |
|---|---|---|---|---|---|---|
| BW-14 | A | Every kiosk (5) | Signboards are blank cream panels with two dark bars, reading as a "≡" menu icon; no name or icon from any angle checked (the README promises an orange hoof roundel, which does not read). Painting: named signs with icons (ice cream, hoof logo) | `live-baa-deck-level.jpg`, `live-baa-side-from-sea.jpg`, `bm-09-vs-painting.jpg` | `custom/baaardwalk/signboard.glb` (4.6 x 1.4 x 0.3), placed `boardwalk.ts:135-138` | **Asset**: five painted variants (e.g. SNACKS, GAMES, ICE CREAM, PRIZES, SHAVED ICE, each with an icon), chosen by kiosk index |
| BW-15 | B | Deck, goat height | The deck is 27 m wide (head 39 m): kiosks line one edge, two thirds of the planks are empty. Painting: a narrower boardwalk filled with kiosks, crates, barrels, trampoline, goats, lamps on both rails | `live-baa-deck-level.jpg`, `live-island-overview.jpg` | `boardwalk.ts:75-77` pier widths | **Code**: narrow the walkway to ~14 m or dress the open side (crates, barrels, life rings, second lamp row, goat spots) |
| BW-11 | B | Bookmark 09 | As rendered (BK-1) it is a 20 m-high view: half the frame is flat sky and the wheel is small at the far end. Authored view is close to the painting but the wheel sits centred and far, no foreground beach or palm | `bm-09-vs-painting.jpg`, `live-09-authored-camera.jpg` | BK-1, `viewer/bookmarks.ts:27-29` | **Code**: after BK-1, camera on the sand right of the pier root so the wheel lands right of centre and a palm frames the left |
| BW-16 | B | Golden hour | No sun in frame (IS-16); the sky is a two-band gradient | `bm-09-vs-painting.jpg` | IS-16 | IS-16 |
| BW-17 | C | Deck and forecourt (9 benches) | Benches are 3.5 x 1.5 x 1.2 m (1.75x the art-plan 2.0 x 0.95 x 0.75) and read as black frames from behind | `live-baa-deck-level.jpg` | `boardwalk.ts:162-176` | **Code**: art-plan size |
| BW-18 | C | Beach approach | Empty olive-khaki sand under golden-hour light; painting foreground: beach balls, sandcastle, driftwood, flowers, warm sand | `live-baa-beach-approach.jpg` | Sand vertex colour under the golden-hour tint; no forecourt dressing | **Code**: warmer sand at golden hour; dress the forecourt from the hero-dressing set |

## Crane Yard (painting 10)

What works: yellow lattice tower cranes with cab and red girder, the concrete frame with real slabs and yellow safety
rails, yellow scaffold, chain-link fence, pipe stacks, cable spool, floodlights, cones at true size, containers along
their long axis, the quiet 8 m paving (CY-11).

| Id | Sev | Where/view | Issue | Evidence | Likely root cause | Fix |
|---|---|---|---|---|---|---|
| CY-12 | A | Whole yard | The ring road ribbon enters the fenced site, passes between the frame and the big crane and leaves through the far side; from goat height it is a dark highway through the work site | `live-crane-overview-road.jpg`, `live-crane-ground-level.jpg`, `bm-10-vs-painting.jpg` | `roads.ts:12-15` links Downtown → Crane Yard → Dam through the POI centre | **Code**: route the ring road outside the west fence; a 6 m gate spur into the yard |
| CY-13 | B | Crate stacks (front right of 10) | Crates are 3.1-3.6 m cubes stacked three high (9 m towers); in bookmark 10 they fill the right quarter of the frame. Painting: ~1 m crates on pallets | `bm-10-vs-painting.jpg`, `live-10-authored-camera.jpg`, `live-crane-overview-road.jpg` | `crane-yard.ts:144` (3.1 x 2.7 x 3), `:184` (3.6 x 3.0 x 3.6); X-8 | **Code**: 1.2 x 1.0 x 1.2 m, at most two high, on the pallet stacks |
| CY-10 | B | Bookmark 10 | As rendered (BK-1) the camera is 14 m up; the authored 4.5 m view matches the painting's framing (fence foreground, frame left, crane right) | `bm-10-vs-painting.jpg`, `live-10-authored-camera.jpg` | BK-1 | BK-1 |
| CY-14 | C | Paving | Puddles are flat dark-blue ellipses with no rim or sky reflection: they read as holes | `live-crane-ground-level.jpg` | CY-11 puddle discs (`visual-ground.ts`) | **Code**: lighter sky-tinted colour, soft edge, irregular outline |
| CY-15 | C | Paving, goat height | Thin green lines cross the slab joins (grass showing through gaps) | `live-crane-ground-level.jpg` | CY-11 slab tiling over the grass | **Code**: one continuous apron under the slabs, or no gaps |

## Downtown Bleatsville (painting 11)

What works: painted shopfronts with names (KID ARCADE, HAY MART, ICE CREAM, BOOKS, GOATFLIX, BOUTIQUE, CAFE,
FLOWERS), striped awnings, lantern lamps, planters, cones at true size, the skyline crane grounded (DT-1 fixed),
Crane Yard on the vista.

| Id | Sev | Where/view | Issue | Evidence | Likely root cause | Fix |
|---|---|---|---|---|---|---|
| DT-15 | A | Roofs (4 towers), top-left of 11 | Water towers are black steel lattice masts with a grey cone and orange band, 4.5 x 7.6 x 4.5 m: oil derricks or radio masts, not the painting's wooden barrel tanks | `bm-11-vs-painting.jpg`, `live-dt-rooftops-towers-signs.jpg`, `live-dt-street-end.jpg` | `water-tower` = `kenney/city-kit-industrial/water-tower.glb` (`library-props.ts:62`, `visual-downtown.ts:45`), placed `dressing.ts:247-250` | **Asset**: timber barrel tank, conical lid, four short legs, about 3.5 x 5.5 x 3.5 m |
| DT-16 | A | Roof lines of the tall rear houses, both top corners of 11 | 7 x 2.5 m blank "≡" boards (the Baa-ardwalk signboard GLB) stand at the parapets of houses, reading as empty billboards | `bm-11-vs-painting.jpg`, `live-dt-rooftops-towers-signs.jpg` | `dressing.ts:238-241` places a signboard on every building; `visual-downtown.ts:405-414` hides signboards only next to shops (houses are matched for awnings only) | **Code**: no signboards on houses (match houses for signboards too) |
| DT-8 | B | Above the street | Bunting is still two thin dashed lines high in the sky | `bm-11-vs-painting.jpg`, `live-dt-street-level.jpg` | `visual-downtown.ts:282-284` squashes `crane-yard/bunting.glb` to 27 x **0.162** x 0.126 m at ground + 14.2 m | **Code**: 27 x 1.4 x 0.12 m at ~8 m (as on the Baa-ardwalk, where the same GLB reads well) |
| DT-14 | B | Whole street | Carriageway, two pavements, grass verges and forecourts put ~30 m between facades; the painting's street is narrow with shops on the pavement | `bm-11-vs-painting.jpg`, `live-dt-street-level.jpg` | `layouts.ts` Downtown block, `visual-streets.ts` verges | Layout pass (open since downtown-qa-1) |
| DT-17 | B | North end of the main street | The vista ends in open grass with a brown trail patch lying on the asphalt at the T-junction; the fountain is in an off-axis side plaza. Painting: a fountain with a goat statue closes the vista | `live-dt-street-end.jpg`, `live-dt-rooftops-towers-signs.jpg` | `dressing.ts:252` fountain side plaza; trail ribbon end overlaps the road (`render.ts` `paths-trail`) | **Code**: fountain on the street axis at the north end; clip trail ends at road edges |
| DT-18 | C | FLOWERS shop | A bench intersects a planter box | `live-dt-street-end.jpg` | `dressing.ts:267` bench positions vs planters | **Code**: keep 0.5 m between bench and planter boxes |

## Mt. Gigga (painting 12)

What works: white satellite dish on a lattice stand (MG-1 fixed), purple-orange pennant (MG-4 fixed), grassy tier
tops with pines, stone cave arch (MG-6 fixed), grey rock colour.

| Id | Sev | Where/view | Issue | Evidence | Likely root cause | Fix |
|---|---|---|---|---|---|---|
| MG-5 | A | South-east face, both terrace falls | Each waterfall is one flat quad with horizontal white stripes laid on a smooth slope: no stream feeding it, no pool, hard rectangular edges. The upper one is clipped by the terrain into a right triangle; its foam is five translucent beads in a row | `live-gigga-lower-waterfall.jpg`, `live-gigga-upper-waterfall-trail.jpg`, `bm-12-vs-painting.jpg` | `visual-water.ts:263-305` `makeFalls` (4-vertex quad, 5 icosahedron flecks), placed `:417-432` at fixed angles 0.54 / 0.89 rad between radii 38-46 m and 74-83 m | **Asset**: cascade (curved lip, 2-3 steps, splash pool, mist) placed on a vertical riser; **Code**: pick spots where drop/run > 1.5 or cut a notch |
| MG-7 | B | Whole mountain | Still a smooth sloping cone with saw-tooth colour (IS-15) instead of stacked vertical stone tiers with flat grassy shelves, boulders, fences and flags | `bm-12-vs-painting.jpg`, `live-tide-mountain-low.jpg` | Terrain shaping (`render.ts`, terrain generation) | Art direction for terrain tiers |
| MG-9 | B | All tiers | Ledges are thin grey discs with grass tops hanging on the slopes at random heights; from below they read as floating pancakes | `live-gigga-upper-waterfall-trail.jpg`, `live-tide-mountain-low.jpg` | `layouts.ts:165`, `dressing.ts:461` (6.5 x 1.3 x 6.5) | **Code**: sink 40-50% into the uphill slope and back them onto it, or turn them into terrace steps |
| MG-10 | C | Upper tier, summit | The trail ribbon appears to float as a thin brown band across a cliff where the ground dips between samples; it ends at the summit in a jagged notch | `live-gigga-upper-waterfall-trail.jpg`, `live-gigga-summit.jpg` | IS-6 trail ribbon (`render.ts` `paths-trail`) | **Code**: drape vertices on `gridSample` every 1-2 m; round end caps |

## Whispering Pines (painting 13)

What works: timber stilt lookout with ladder and red roof (WP-1 fixed), round mossy log bridge with rope lashings,
one consistent pine family, red mushrooms, ferns.

| Id | Sev | Where/view | Issue | Evidence | Likely root cause | Fix |
|---|---|---|---|---|---|---|
| WP-3 | B | Near the lookout, top right of 13 | Two timber decks (9 x 1.1 x 8 and 8 x 1.1 x 7 m) float 4.5 m and 8.5 m above the ground between pines, with no posts, ladder or trunk | `live-pines-road-bridge-floating-decks.jpg`, `bm-13-vs-painting.jpg`, `live-13-authored-camera-on-road.jpg` | `layouts.ts:198-199` (`lift` 4.5 / 8.5); `custom/pines/timber-deck.glb` has no legs | **Asset**: tree-house deck with four posts and a ladder at those heights |
| WP-8 | A | Background of 13 | The floating river ribbon and a flat waterfall sheet hang on the mountain behind the glade (IS-11) | `bm-13-vs-painting.jpg`, `live-pines-dam-floating-river.jpg` | IS-11 | IS-11 |
| WP-9 | B | River in 13 | The river is a straight canal: uniform width, straight sandy banks, white stripes across the full width at even spacing; no boulders, rapids or lily pads in frame. Painting: winding rocky brook with boulders, rapids and lily pads | `bm-13-vs-painting.jpg`, `live-13-authored-camera-on-road.jpg` | `visual-water.ts:207-215` stripe term `sin(vUv.y * 45 - t * 5)`; river polyline with ~40 m segments | **Code**: lower-contrast, broken streaks; meander the polyline; boulders and lily pads along the 13 frame |
| WP-4 | B | Glade | Still no waterfall in the glade (the painting's centre) | `bm-13-vs-painting.jpg` | Not built | **Asset**: small falls over a rock step upstream of the log bridge |
| WP-10 | C | Banks | Forest floor and banks are flat olive-khaki with few rocks; painting: mossy grey boulders and green banks. A large flat grey stone with a grass top lies in the stream by the road deck | `bm-13-vs-painting.jpg`, `live-pines-road-bridge-floating-decks.jpg` | Terrain colour (`render.ts`), stepping-stone sizes | **Code**: greener bank tint; 4-6 mossy boulders in the 13 frame |

## The Dam (painting 14)

What works: the Dam GLB (four spillways, control house with dish, yellow rails, lamps, warning sign), the sign, reeds,
buoys, consistent pines.

| Id | Sev | Where/view | Issue | Evidence | Likely root cause | Fix |
|---|---|---|---|---|---|---|
| DM-1 | A | Right half of 14 | Still open after #140 on `3c30077`: two cyan sheets lie over the right bank. Hiding `rippling-river` in the live scene removes the large one (IS-11); the near sheet is `mountain-waterfall-1` (x -39..-25, y 14..23, z -131..-120). A white half ring hovers over the rocks | `bm-14-vs-painting.jpg`, `live-dam-deck.jpg` | IS-11; `visual-water.ts:402-412` builds falls from river-level drops and only skips segments whose midpoint is inside the Dam plot radius | **Code**: IS-11; build river falls only where the terrain itself drops ≥ 3 m, and skip within 70 m of the Dam (as #140 does for quads) |
| DM-7 | B | Upstream of the dam | No reservoir: the procedural lake is hidden as soon as the Dam GLB loads, so from the deck the open sea is directly behind the dam, and from above only the GLB's small rectangular water slab shows. Painting: a wide lake with islands, a jetty and a boat | `live-dam-deck.jpg`, `live-island-overview.jpg` | `render.ts:595-597` hides `dam-reservoir` when the Dam GLB loads | **Code**: keep (and reshape) the reservoir to fill the valley behind the dam; jetty and boat from the hero-dressing set |
| DM-8 | C | Plunge pool | Foam is dozens of thin white ring outlines (36 instances) that read as hoops or bubbles, not spray | `bm-14-vs-painting.jpg`, `live-dam-deck.jpg` | `dam-four-falls-white-foam` (`visual-dam-landscape.ts`) | **Code/Asset**: filled soft foam patches plus spray cards |

## Old Lighthouse (painting 15)

What works: red/white striped lighthouse with gallery and lamp room (LH-1 fixed), single cottage and wreck, darker,
fewer cape rocks (LH-3), glowing cave, warm sunset glow behind the tower.

| Id | Sev | Where/view | Issue | Evidence | Likely root cause | Fix |
|---|---|---|---|---|---|---|
| LH-10 | B | West cliff, left of 15 | A 7 x 1 x 6 m timber deck juts horizontally out of the cliff at about 16 m | `live-lh-west-rocks-plank.jpg`, `bm-15-vs-painting.jpg` | `layouts.ts:230` `site(cape, 'platform', -19, -9, 7, 1, 6, { lift: 4 })` | **Code**: remove, or a cliff-top viewing deck with posts |
| LH-9 | B | Dock, right of 15 | Tall square posts stand in the sea around the bespoke dock with nothing on them | `live-lh-dock-flag-bridge.jpg`, `bm-15-vs-painting.jpg` | `visual-lighthouse.ts:579-588`: `lighthouse-dock-piles` (4 posts per generic dock) are always added; only the planked fallback is hidden when the GLB loads | **Code**: add the piles to the fallback group |
| LH-8 | B | Cape flag | The pennant pole stands at the waterline (y -1.1 at (-231, -7)), half under water at the cliff foot | `live-lh-dock-flag-bridge.jpg` | `layouts.ts:248` `site(cape, 'flag', 27.25, 11, …)` lands below sea level | **Code**: move onto the rock at the end of the rope bridge (painting) or clamp to ground ≥ 1 m |
| LH-4 | C | Rope bridge | Reads as a staircase of separate planks on posts; rope rails too thin to read from 15 | `live-lh-dock-flag-bridge.jpg`, `bm-15-vs-painting.jpg` | `bridge` / `rope-rail` dressing | **Asset**: continuous sagging bridge with thick rope rails |
| LH-11 | C | Boulders on the cape | Many boulders show a bright white wedge on their undersides | `live-lh-west-rocks-plank.jpg` | Rock paint after #135 (`visual-lighthouse.ts` rock material) | **Code**: darken undersides or sink rocks 20% |
| LH-7 | C | Next to the cottage | Second red-roof house still drawn | `live-lh-dock-flag-bridge.jpg` | `layouts.ts:227` contract house | Keep the collider, draw a shed |

## Rising tide (painting 16)

What works: the shallow-water ring around the last dry land, the drowned island readable under the water.

| Id | Sev | Where/view | Issue | Evidence | Likely root cause | Fix |
|---|---|---|---|---|---|---|
| RT-1 | B | Bookmark 16, low views | Noon-blue sky, calm uniform navy sea, no whitecaps or spray, no floating barrels, crates, roofs, fences or lamp posts. Painting: storm sky, rough teal water, debris | `bm-16-vs-painting.jpg`, `live-tide-mountain-low.jpg` | Bookmark uses day 0.43 (`viewer/bookmarks.ts:48-50`); sea shader has no tide-dependent roughness (`visual-water.ts:174-181`) | **Code**: storm preset when tide > 0; stronger waves/foam with tide; instanced floating debris from existing props |
| RT-2 | C | Last refuge | Mt Gigga's smooth dome is all that remains; painting shows tiered rock platforms with houses and fences | `live-tide-mountain-low.jpg` | MG-7 | MG-7 |

## Renderer numbers at each bookmark (World Lab panel)

Draw calls and triangles as rendered. FPS is not reported: a second World Lab tab and the screenshot capture were
running, so the adaptive resolution dropped to 0.5 between shots.

| Bookmark | Draw calls | Triangles | Note |
|---|---|---|---|
| 07 | 181 | 440,625 | clamped camera |
| 08 | 213-215 | 350,667 | at the 215 budget from #131 |
| 09 | 40 | 87,454 | clamped; authored camera 43 / 92,506 |
| 10 | 154 | 169,555 | clamped |
| 11 | 210 | 349,814 | |
| 12 | 188 | 332,360 | |
| 13 | 218 | 485,588 | clamped |
| 14 | 131 | 138,405 | |
| 15 | 153 | 154,478 | |
| 16 | 210 | 487,857 | |
| Overview (-330, 230, 330) | 233 | 536,303 | `live-island-overview.jpg` |
