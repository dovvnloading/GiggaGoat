# Ground and paving across Billy Isle

The 64 approach and elevated stills below show 32 sites on the production island seed, `billy-isle`. Each sheet pairs a ground-level approach with an elevated view after the shipped kit models and ground materials loaded in the software renderer. The images cover the surfaces, their edges, and the relationship between the scenery and the walkable route.

| District and stills | Changes checked in the scene |
| --- | --- |
| [Hoofington](hoofington.jpg) | Grass, clover and straw lead from the gates to the harvest stand, tractor, seed bench and picking cart. The cart and timber crates stand on the east pasture verge. The southern Mow-Down lawn and western hay-towing lane stay open. |
| [Baa-ardwalk](baa-ardwalk.jpg) | Rippled shell sand joins the boardwalk kiosks, parasols and canoe hire hut. Dune grass and low stones line the edges. The information window faces the approach. |
| [Crane Yard](crane-yard.jpg) | Weathered concrete covers the 80 × 72 m apron. The cable drums occupy the aggregate loading side of the yard, clear of the Stack-Up crate rack and the Demolition practice tower. The loading marks and puddles remain distinct. Subdividing each slab along the terrain faces removed the exposed ground polygons visible in the first pass. |
| [Downtown Bleatsville](downtown-bleatsville.jpg) | Limestone setts extend from the street market through the pocket garden and across the service courts. The raised shop forecourts and sidewalks carry the same stone scale. Planters frame the seating and leave the road edge open. |
| [Mt. Gigga](mt-gigga.jpg) | Slate and lichen follow the bivouac, survey cache, rest shelf and summit trail marker. The loose stone shoulders taper toward the steeper cliff faces. The trail embankments have their own vertical texture coordinates. |
| [Whispering Pines](whispering-pines.jpg) | Fir needles and humus tie the canoe landing, camp, woodcutting bench and timber landing to the forest floor. Ferns, mushrooms and stacked logs mark the clearing edges. |
| [The Dam](the-dam.jpg) | Blue-grey aggregate connects the pump, turbine, inspection pad and spare penstock sections. The elevated bank views show the gravel meeting the service road and ending before the reservoir. |
| [Old Lighthouse](old-lighthouse.jpg) | Flint and chalk shingle cover the keeper’s yard, fish landing and buoy service area. The winding footpath carries a darker treatment of the same material. The lookout and jetty approaches remain identifiable. |

Eight additional close-ups show where the dressed ground meets grass, gravel or a neighbouring surface. [View the transitions](transitions.jpg)

## Materials

Each district has five independently generated 768 × 768 WebP textures. The three alternatives mix across patches several metres wide. A fifth texture carries loose pieces of the same material into the surrounding turf. The WebGL and software renderers use the same spatial pattern. Nearby districts stream at most two additional images at a time across the island.

Downtown’s paving uses a shared three-stone repeat and six courses across the original, the alternatives and the broken verge. The Crane Yard apron and the surrounding ground share a world-space texture scale. The summit shoulders follow the trail grade. The orchard beds and the lighthouse path taper into the surrounding ground.

| District | Base | Alternative A | Alternative B | Alternative C | Transition |
| --- | --- | --- | --- | --- | --- |
| Hoofington | [Original](../../../../public/assets/terrain/hoofington.webp) | [Clover and meadow blades](../../../../public/assets/terrain/hoofington-a.webp) | [Trampled loam](../../../../public/assets/terrain/hoofington-b.webp) | [Sun-dried straw](../../../../public/assets/terrain/hoofington-c.webp) | [Orchard to pasture](../../../../public/assets/terrain/hoofington-edge.webp) |
| Baa-ardwalk | [Original](../../../../public/assets/terrain/baa-ardwalk.webp) | [Pale rippled sand](../../../../public/assets/terrain/baa-ardwalk-a.webp) | [Shell-rich sand](../../../../public/assets/terrain/baa-ardwalk-b.webp) | [Wind-swept sand](../../../../public/assets/terrain/baa-ardwalk-c.webp) | [Dune turf](../../../../public/assets/terrain/baa-ardwalk-edge.webp) |
| Crane Yard | [Original](../../../../public/assets/terrain/crane-yard.webp) | [Weather-spotted concrete](../../../../public/assets/terrain/crane-yard-a.webp) | [Compacted aggregate](../../../../public/assets/terrain/crane-yard-b.webp) | [Dust and wheel wear](../../../../public/assets/terrain/crane-yard-c.webp) | [Crushed slab in gravel](../../../../public/assets/terrain/crane-yard-edge.webp) |
| Downtown Bleatsville | [Original](../../../../public/assets/terrain/downtown-bleatsville.webp) | [Honey limestone](../../../../public/assets/terrain/downtown-bleatsville-a.webp) | [Cool grey-lilac setts](../../../../public/assets/terrain/downtown-bleatsville-b.webp) | [Worn mixed stone](../../../../public/assets/terrain/downtown-bleatsville-c.webp) | [Broken setts in turf](../../../../public/assets/terrain/downtown-bleatsville-edge.webp) |
| Mt. Gigga | [Original](../../../../public/assets/terrain/mt-gigga.webp) | [Fine shale](../../../../public/assets/terrain/mt-gigga-a.webp) | [Fractured plates](../../../../public/assets/terrain/mt-gigga-b.webp) | [Stony warm soil](../../../../public/assets/terrain/mt-gigga-c.webp) | [Slate in alpine grass](../../../../public/assets/terrain/mt-gigga-edge.webp) |
| Whispering Pines | [Original](../../../../public/assets/terrain/whispering-pines.webp) | [Needle litter](../../../../public/assets/terrain/whispering-pines-a.webp) | [Moss and humus](../../../../public/assets/terrain/whispering-pines-b.webp) | [Trampled earth](../../../../public/assets/terrain/whispering-pines-c.webp) | [Needles in forest grass](../../../../public/assets/terrain/whispering-pines-edge.webp) |
| The Dam | [Original](../../../../public/assets/terrain/the-dam.webp) | [Pale stone dust](../../../../public/assets/terrain/the-dam-a.webp) | [Damp crushed rock](../../../../public/assets/terrain/the-dam-b.webp) | [River aggregate](../../../../public/assets/terrain/the-dam-c.webp) | [Gravel in bank grass](../../../../public/assets/terrain/the-dam-edge.webp) |
| Old Lighthouse | [Original](../../../../public/assets/terrain/old-lighthouse.webp) | [Salt-worn flint](../../../../public/assets/terrain/old-lighthouse-a.webp) | [Ochre shingle](../../../../public/assets/terrain/old-lighthouse-b.webp) | [Chalk dust](../../../../public/assets/terrain/old-lighthouse-c.webp) | [Flint in coastal turf](../../../../public/assets/terrain/old-lighthouse-edge.webp) |

The existing Kenney, Quaternius and custom model kits supply the scenery. District collision and route tests cover the public approach to each placement.

<details>
<summary>Texture files and generation prompts</summary>

Each base image used the following shared brief followed by its material description.

Create ONE square seamless tileable terrain albedo texture for a stylized 3D adventure game. A single continuous uniform material fills the entire square. Orthographic straight down. Hand-painted, crisp facets and softly broken edges, matte even diffuse light, broad values with fine material detail. Natural muted colors that fit brightly colored low-poly scenery. Physical area about three metres across. Match opposite edges for tiling in both dimensions. No panels, other swatches, atlas, split composition, captions, vignette, border, horizon, focal object, symbols or cast shadows.

- [hoofington.webp](../../../../public/assets/terrain/hoofington.webp) — Orchard floor after harvest. A fresh moss-green low grass sward broken by muted green clover, small patches of warm loam and short curved straw, gentle wear from harvest traffic. Keep it primarily green.
- [baa-ardwalk.webp](../../../../public/assets/terrain/baa-ardwalk.webp) — Coastal promenade sand and ochre grit, a few ivory broken shells, faint wind ripples. Warm sand at the edge of a seaside boardwalk, cohesive fine grain.
- [crane-yard.webp](../../../../public/assets/terrain/crane-yard.webp) — Pale medium-grey weathered construction-yard concrete. Small exposed dark aggregate, fine aggregate pitting, very subtle scuffed tire streaks, rounded repairs and worn mineral freckles. No painted road markings, stripes, cracks extending to edges, or slab border.
- [downtown-bleatsville.webp](../../../../public/assets/terrain/downtown-bleatsville.webp) — Warm urban limestone and occasional soft lavender-grey city setts, interlocking staggered rectangular paving stones in even horizontal rows. Worn corners, narrow sand-filled joints, subtle mineral flecks. Fit exactly six full or staggered courses vertically with equivalent top and bottom edges.
- [mt-gigga.webp](../../../../public/assets/terrain/mt-gigga.webp) — Mountain trail alpine scree. A field of small flat blue-slate chips, patches of silvery lichens, some exposed warm grey sandy soil in between. Low contrast, no boulders, no twigs.
- [whispering-pines.webp](../../../../public/assets/terrain/whispering-pines.webp) — Conifer woodland floor. Short russet fir needles loosely gathering on dark mossy forest humus, scattered little curled leaves, a few slender twig splinters with cool green moss peeking through. Loamy ground clearly visible.
- [the-dam.webp](../../../../public/assets/terrain/the-dam.webp) — Waterworks service gravel. Muted bluish-grey fine crushed stone mixed with a few smoothed river pebbles, weathered pale cement dust and damp mineral-stained seams. Distinct cooler and lighter than woodland ground. No standing water.
- [old-lighthouse.webp](../../../../public/assets/terrain/old-lighthouse.webp) — Maritime headland flint shingle and pale chalk crumbs scattered in tan-grey salt soil. Low weathered dune grass stubble in loose patches between flat flints, a few whitened shell fragments.

The three alternatives and the transition in each row were generated separately. The following phrases describe the individual art direction.

**Hoofington**

- A — Lush orchard verge with tiny rounded clover clusters and narrow meadow blades, soft light yellow green.
- B — Worn orchard wheel lanes, grass showing through earth with broken straw, muted green still dominant. No long straight tire track.
- C — Drier picking-yard turf, finely chopped straw and patches of muted ochre grass with a little bare soil.
- Transition — Orchard edge material: sparse ordinary pasture grass interspersed throughout with tiny green clover and short strands of orchard straw. About 70% quiet meadow sod, 30% orchard floor in uneven interlocking patches; generous open green.

**Baa-ardwalk**

- A — Fine pale dune sand, low ripples broken by small chalky shell fragments.
- B — Compacted beach foot traffic with soft shell grit and subdued, irregular shallow dimples. No identifiable footprints.
- C — Drier windswept promenade sand with shell flakes and faint narrow ribbons of coarse ochre sand.
- Transition — Dune margin: pale shell sand PARTIALLY buried in quiet muted green seaside turf and low salt grass. Irregular fine islands of sand interpenetrating sod across whole tile; no straight dividing line.

**Crane Yard**

- A — Pale poured concrete with fine exposed aggregate and restrained water spotting.
- B — Worn medium grey concrete showing crushed clinker and little spalled pebbles.
- C — Wheel-polished industrial concrete with broad subtle rubber scuffs and dispersed pale repairs. No painted lines.
- Transition — Apron perimeter: small irregular broken edges of dusty grey concrete embedded in tan, compacted gravel and traces of muted green verge. Low contrast, loosely distributed, no slab outlines or painted markings.

**Downtown Bleatsville**

- A — Six even horizontal courses of honey limestone setts with a few warm grey stones, tight staggered joints.
- B — Six horizontal courses of slightly greyer and lavender limestone city setts, uniformly narrow pale grout, worn edges.
- C — Six regular horizontal courses of buff sandstone setts with a few subtle replaced pale stones, offset rectangular courses.
- Transition — Old downtown garden paving edge: clusters of warm honey and gray-lilac limestone setts on the original six-course orthogonal grid, with entire stones missing and their places filled by quiet muted green lawn and soft earth. Several small intact clusters, worn grass between them, irregular scattered perimeter.

**Mt. Gigga**

- A — A finer trail-shelf scree with a few thin fractured blue-grey shale plates and little pale dust.
- B — Light grey alpine talus and flatter angled slate flakes, soft grey-green lichen in sheltered cracks.
- C — Exposed slightly warmer mineral grit with dusty blue slate fragments and silver lichen on larger chips.
- Transition — Alpine turf meeting scree: flush blue-grey slate chips emerge in irregular sparse groups from short olive alpine sod and lichen. Roughly half quiet mountain turf, broken small mineral edges, no isolated hero boulder.

**Whispering Pines**

- A — Closely interlocked russet pine needles on dark compact humus, occasional small curled leaf.
- B — Mossier shaded conifer ground with fine dark duff, flat green moss islands and short amber needles.
- C — A drying forest clearing floor with muted brown leaf fragments, a few slender twigs and worn moss.
- Transition — Forest edge: faded fir needles scattered in loose pockets among cool mossy muted green forest grass and broad quiet green sod. Ragged interlocking grassy tufts and needles with no strong track.

**The Dam**

- A — Fine angular grey maintenance gravel, cool pale stone dust, occasional small exposed river stones.
- B — Darker damp charcoal-blue waterworks gravel, irregular silvery mineral flecks. No puddles.
- C — Light grey washed river aggregate set in dusty service gravel with small rounded speckled stones.
- Transition — Service strip edge: loose cool grey gravel scattered sparsely into muted green bank grass and damp pale silt. The boundaries around stones and tiny clumps are irregular, leaving patches of plain turf.

**Old Lighthouse**

- A — Small chalky shingle and neutral pale flint, gently weathered sand and salt flecks.
- B — A flint-rich headland patch, taupe-grey fragments in firm pale ochre soil with low dry salt grass.
- C — A paler patch of bleached chalk crumbs, sandy soil and little flat brown stones.
- Transition — Headland margin: loose pale flints and chalk fragments scattered in little pools between low muted green coastal turf and faded salt grass. Thin, patchy and irregular, with much of the underlying ground exposed.

</details>
