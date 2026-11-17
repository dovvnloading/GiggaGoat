# Nature Kit recolour (island QA X-4)

Kenney's Nature Kit ships washed-out pastel materials: bark, dirt and wood
come out salmon (#f2be9e), and grass and pine needles come out teal
(#73eddd / #72d3d5). The district bakers sample material colours into vertex
colours, so in game logs, stumps, rocks, ledges, the cave, the fence and the
bridge read as pink, and pines read as teal.

The 15 files the code references were recoloured in place (same paths, same
geometry, material colours only), matched to the hi-fi paintings in
docs/art/hifi/:

| Material      | sRGB    | Material     | sRGB    |
|---------------|---------|--------------|---------|
| woodBark      | #8a5a3a | grass        | #6fb34a |
| woodBarkDark  | #6b4a33 | leafsGreen   | #5aa548 |
| woodInner     | #d9b07a | leafsDark    | #2f7d4a |
| wood          | #b0794a | colorRed     | #e0473f |
| woodDark      | #7a5232 | colorYellow  | #f4c430 |
| dirt (rock)   | #8f9296 | colorPurple  | #9b6ad6 |
| stone         | #a9a49c | _defaultMat  | #f6efe2 |

bridge_wood.glb uses a plank colour (#c08a55) for its `stone` deck material.
All metallic values were set to 0.

Recoloured files: tree_pineTallA, tree_pineDefaultA, rock_largeA, rock_largeB,
rock_smallFlatA, stump_round, log, plant_bushDetailed, mushroom_red,
flower_yellowB, flower_purpleA, fence_simple, cliff_half_rock,
cliff_cave_rock, bridge_wood. Licence unchanged (CC0, Kenney).
