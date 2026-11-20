# Ground and paving across Billy Isle

The 64 stills below show 32 sites on the production island seed, `billy-isle`. Each sheet pairs a ground-level approach with an elevated view after the shipped kit models and ground materials loaded in the software renderer. The images cover the surfaces, their edges, and the relationship between the scenery and the walkable route.

| District and stills | Changes checked in the scene |
| --- | --- |
| [Hoofington](hoofington.jpg) | Grass, clover and straw lead from the gates to the harvest stand, tractor, seed bench and picking cart. The orchard crates are timber and sit clear of the crop rows. |
| [Baa-ardwalk](baa-ardwalk.jpg) | Rippled shell sand joins the boardwalk kiosks, parasols and canoe hire hut. Dune grass and low stones line the edges. The information window faces the approach. |
| [Crane Yard](crane-yard.jpg) | Weathered concrete covers the 80 × 72 m apron. The cable drums occupy an open bay beside the crane. The loading marks and puddles remain distinct. Subdividing each slab along the terrain faces removed the exposed ground polygons visible in the first pass. |
| [Downtown Bleatsville](downtown-bleatsville.jpg) | Limestone setts extend from the street market through the pocket garden and across the service courts. The raised shop forecourts and sidewalks carry the same stone scale. Planters frame the seating and leave the road edge open. |
| [Mt. Gigga](mt-gigga.jpg) | Slate and lichen follow the bivouac, survey cache, rest shelf and summit trail marker. The loose stone shoulders taper toward the steeper cliff faces. The trail embankments have their own vertical texture coordinates. |
| [Whispering Pines](whispering-pines.jpg) | Fir needles and humus tie the canoe landing, camp, woodcutting bench and timber landing to the forest floor. Ferns, mushrooms and stacked logs mark the clearing edges. |
| [The Dam](the-dam.jpg) | Blue-grey aggregate connects the pump, turbine, inspection pad and spare penstock sections. The elevated bank views show the gravel meeting the service road and ending before the reservoir. |
| [Old Lighthouse](old-lighthouse.jpg) | Flint and chalk shingle cover the keeper’s yard, fish landing and buoy service area. The winding footpath carries a darker treatment of the same material. The lookout and jetty approaches remain identifiable. |

## Materials

Eight independent images were generated with Codex’s built-in image generator. Each ships as a separate 768 × 768 WebP and has its own runtime texture. The existing Kenney, Quaternius and custom model kits supply the scenery. The public approach to each placement is covered by the district collision and route regression tests.

<details>
<summary>Texture files and generation prompts</summary>

Each generation used the following shared brief followed by its material description.

Create ONE square seamless tileable terrain albedo texture for a stylized 3D adventure game. A single continuous uniform material fills the entire square. Orthographic straight down. Hand-painted, crisp facets and softly broken edges, matte even diffuse light, broad values with fine material detail. Natural muted colors that fit brightly colored low-poly scenery. Physical area about three metres across. Match opposite edges for tiling in both dimensions. No panels, other swatches, atlas, split composition, captions, vignette, border, horizon, focal object, symbols or cast shadows.

- [hoofington.webp](../../../../public/assets/terrain/hoofington.webp) — Orchard floor after harvest. A fresh moss-green low grass sward broken by muted green clover, small patches of warm loam and short curved straw, gentle wear from harvest traffic. Keep it primarily green.
- [baa-ardwalk.webp](../../../../public/assets/terrain/baa-ardwalk.webp) — Coastal promenade sand and ochre grit, a few ivory broken shells, faint wind ripples. Warm sand at the edge of a seaside boardwalk, cohesive fine grain.
- [crane-yard.webp](../../../../public/assets/terrain/crane-yard.webp) — Pale medium-grey weathered construction-yard concrete. Small exposed dark aggregate, fine aggregate pitting, very subtle scuffed tire streaks, rounded repairs and worn mineral freckles. No painted road markings, stripes, cracks extending to edges, or slab border.
- [downtown-bleatsville.webp](../../../../public/assets/terrain/downtown-bleatsville.webp) — Warm urban limestone and occasional soft lavender-grey city setts, interlocking staggered rectangular paving stones in even horizontal rows. Worn corners, narrow sand-filled joints, subtle mineral flecks. Fit exactly six full or staggered courses vertically with equivalent top and bottom edges.
- [mt-gigga.webp](../../../../public/assets/terrain/mt-gigga.webp) — Mountain trail alpine scree. A field of small flat blue-slate chips, patches of silvery lichens, some exposed warm grey sandy soil in between. Low contrast, no boulders, no twigs.
- [whispering-pines.webp](../../../../public/assets/terrain/whispering-pines.webp) — Conifer woodland floor. Short russet fir needles loosely gathering on dark mossy forest humus, scattered little curled leaves, a few slender twig splinters with cool green moss peeking through. Loamy ground clearly visible.
- [the-dam.webp](../../../../public/assets/terrain/the-dam.webp) — Waterworks service gravel. Muted bluish-grey fine crushed stone mixed with a few smoothed river pebbles, weathered pale cement dust and damp mineral-stained seams. Distinct cooler and lighter than woodland ground. No standing water.
- [old-lighthouse.webp](../../../../public/assets/terrain/old-lighthouse.webp) — Maritime headland flint shingle and pale chalk crumbs scattered in tan-grey salt soil. Low weathered dune grass stubble in loose patches between flat flints, a few whitened shell fragments.

</details>

