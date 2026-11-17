# Gigga-Goat asset library

All models live in `public/assets/library/<source>/<pack>/` and are served by Vite at `assets/library/...`
(e.g. `assets/library/kenney/city-kit-suburban/building-type-a.glb`). `manifest.json` in that folder lists every
model with its path, pack, source, license and credit. Agents: load models with three.js `GLTFLoader`; pick from the
packs mapped to the location you are working on; keep the chunky stylised look of `docs/art/hifi/`; never ship a
CC-BY model without its credit in `CREDITS.md`.

**Total: 4047 models** (kenney: 2689, kaykit: 789, quaternius: 464, polypizza: 104, custom: 1). Licenses: CC0: 3970, CC-BY 3.0: 77.

## Packs

| Source | Pack | Models | License | Best use |
|---|---|---|---|---|
| kaykit | `city-builder-bits` | 41 | CC0 | Downtown / Hoofington city blocks, roads, cars, trees |
| kaykit | `forest-nature-pack` | 105 | CC0 | Whispering Pines and Mt. Gigga trees, rocks, grass |
| kaykit | `furniture-bits` | 53 | CC0 | Furniture, benches, interiors |
| kaykit | `platformer-pack` | 370 | CC0 | Gameplay platforms, springs, coins, hazards |
| kaykit | `resourcebits` | 76 | CC0 | Crates, barrels, sacks, logs, ores (gigs, Crane Yard) |
| kaykit | `restaurant-bits` | 144 | CC0 | Baa-ardwalk snack stalls, food, tables |
| kenney | `building-kit` | 79 | CC0 | Generic building parts for any POI |
| kenney | `car-kit` | 50 | CC0 | Parked cars, trucks, tractors |
| kenney | `city-kit-commercial` | 41 | CC0 | Downtown Bleatsville shops, towers, awnings, signs |
| kenney | `city-kit-industrial` | 37 | CC0 | Crane Yard / Dam industrial buildings, silos, tanks |
| kenney | `city-kit-roads` | 95 | CC0 | Roads, junctions, lamp posts, barriers, traffic lights (whole island) |
| kenney | `city-kit-suburban` | 40 | CC0 | Hoofington houses, fences, driveways, trees |
| kenney | `coaster-kit` | 183 | CC0 | Baa-ardwalk roller coaster track and carts |
| kenney | `factory-kit` | 143 | CC0 | Crane Yard / Dam machinery, conveyors, pipes |
| kenney | `fantasy-town-kit` | 167 | CC0 | Hoofington village pieces, windmill, wells, market stalls |
| kenney | `food-kit` | 200 | CC0 | Baa-ardwalk stall food, picnic props |
| kenney | `furniture-kit` | 140 | CC0 | Benches, tables, chairs, interiors |
| kenney | `holiday-kit` | 99 | CC0 | Bunting, lights, decorations, presents |
| kenney | `mini-arena` | 22 | CC0 | Party-mode arena pieces |
| kenney | `mini-characters` | 43 | CC0 | NPC townsfolk |
| kenney | `mini-forest` | 22 | CC0 | Whispering Pines trees and ground cover |
| kenney | `mini-shop` | 30 | CC0 | Downtown shop interiors and goods |
| kenney | `minigolf-kit` | 126 | CC0 | Baa-ardwalk minigolf, obstacles, flags |
| kenney | `modular-buildings` | 108 | CC0 | Downtown modular facades and rooftops (parkour) |
| kenney | `nature-kit` | 329 | CC0 | Trees, rocks, cliffs, logs, crops, fences, campsite (Mt. Gigga, Pines, farm) |
| kenney | `pirate-kit` | 72 | CC0 | Lighthouse shipwreck and docks |
| kenney | `platformer-kit` | 153 | CC0 | Gameplay props: springs/trampolines, coins, crates, platforms, flags |
| kenney | `retro-urban-kit` | 124 | CC0 | Downtown street details, storefronts |
| kenney | `survival-kit` | 80 | CC0 | Crates, barrels, tools, tents, campfire (gig props, Crane Yard) |
| kenney | `toy-car-kit` | 157 | CC0 | Toy vehicles (party-mode props) |
| kenney | `train-kit` | 103 | CC0 | Train tracks and wagons |
| kenney | `watercraft-kit` | 46 | CC0 | Baa-ardwalk / Lighthouse boats, buoys, jetties |
| polypizza | `barn` | 3 | CC0 | Specific prop (search term: barn) |
| polypizza | `beach-umbrella` | 2 | CC-BY 3.0 | Specific prop (search term: beach umbrella) |
| polypizza | `bridge` | 2 | CC-BY 3.0, CC0 | Specific prop (search term: bridge) |
| polypizza | `buoy` | 2 | CC-BY 3.0 | Specific prop (search term: buoy) |
| polypizza | `carousel` | 2 | CC-BY 3.0 | Specific prop (search term: carousel) |
| polypizza | `cave` | 2 | CC-BY 3.0 | Specific prop (search term: cave) |
| polypizza | `cement-mixer` | 2 | CC-BY 3.0, CC0 | Specific prop (search term: cement mixer) |
| polypizza | `chicken` | 2 | CC-BY 3.0 | Specific prop (search term: chicken) |
| polypizza | `cow` | 2 | CC-BY 3.0, CC0 | Specific prop (search term: cow) |
| polypizza | `crab` | 2 | CC-BY 3.0 | Specific prop (search term: crab) |
| polypizza | `dam` | 2 | CC-BY 3.0 | Specific prop (search term: dam) |
| polypizza | `excavator` | 2 | CC-BY 3.0 | Specific prop (search term: excavator) |
| polypizza | `ferris-wheel` | 3 | CC-BY 3.0, CC0 | Specific prop (search term: ferris wheel) |
| polypizza | `food-truck` | 2 | CC-BY 3.0, CC0 | Specific prop (search term: food truck) |
| polypizza | `fountain` | 2 | CC-BY 3.0 | Specific prop (search term: fountain) |
| polypizza | `garden-gnome` | 3 | CC-BY 3.0, CC0 | Specific prop (search term: garden gnome) |
| polypizza | `goat` | 5 | CC-BY 3.0 | Specific prop (search term: goat) |
| polypizza | `hay-bale` | 2 | CC-BY 3.0, CC0 | Specific prop (search term: hay bale) |
| polypizza | `hot-air-balloon` | 2 | CC-BY 3.0 | Specific prop (search term: hot air balloon) |
| polypizza | `ice-cream` | 2 | CC-BY 3.0, CC0 | Specific prop (search term: ice cream) |
| polypizza | `lighthouse` | 3 | CC-BY 3.0 | Specific prop (search term: lighthouse) |
| polypizza | `log` | 2 | CC-BY 3.0, CC0 | Specific prop (search term: log) |
| polypizza | `mailbox` | 2 | CC-BY 3.0, CC0 | Specific prop (search term: mailbox) |
| polypizza | `market-stall` | 2 | CC0 | Specific prop (search term: market stall) |
| polypizza | `mountain` | 2 | CC-BY 3.0 | Specific prop (search term: mountain) |
| polypizza | `mushroom` | 2 | CC-BY 3.0 | Specific prop (search term: mushroom) |
| polypizza | `picnic-table` | 2 | CC-BY 3.0 | Specific prop (search term: picnic table) |
| polypizza | `pier` | 2 | CC0 | Specific prop (search term: pier) |
| polypizza | `pig` | 2 | CC-BY 3.0, CC0 | Specific prop (search term: pig) |
| polypizza | `ram` | 2 | CC0 | Specific prop (search term: ram) |
| polypizza | `roller-coaster` | 2 | CC-BY 3.0 | Specific prop (search term: roller coaster) |
| polypizza | `rowboat` | 2 | CC-BY 3.0 | Specific prop (search term: rowboat) |
| polypizza | `satellite-dish` | 2 | CC-BY 3.0 | Specific prop (search term: satellite dish) |
| polypizza | `scaffolding` | 2 | CC-BY 3.0 | Specific prop (search term: scaffolding) |
| polypizza | `scarecrow` | 2 | CC-BY 3.0 | Specific prop (search term: scarecrow) |
| polypizza | `seagull` | 2 | CC-BY 3.0 | Specific prop (search term: seagull) |
| polypizza | `sheep` | 2 | CC-BY 3.0, CC0 | Specific prop (search term: sheep) |
| polypizza | `shipping-container` | 1 | CC-BY 3.0 | Specific prop (search term: shipping container) |
| polypizza | `shipwreck` | 2 | CC0 | Specific prop (search term: shipwreck) |
| polypizza | `silo` | 2 | CC0 | Specific prop (search term: silo) |
| polypizza | `surfboard` | 2 | CC-BY 3.0 | Specific prop (search term: surfboard) |
| polypizza | `tower-crane` | 3 | CC-BY 3.0 | Specific prop (search term: tower crane) |
| polypizza | `tractor` | 2 | CC-BY 3.0 | Specific prop (search term: tractor) |
| polypizza | `trampoline` | 2 | CC-BY 3.0 | Specific prop (search term: trampoline) |
| polypizza | `tree-house` | 2 | CC-BY 3.0 | Specific prop (search term: tree house) |
| polypizza | `water-tower` | 2 | CC-BY 3.0, CC0 | Specific prop (search term: water tower) |
| polypizza | `waterfall` | 2 | CC-BY 3.0 | Specific prop (search term: waterfall) |
| polypizza | `windmill` | 3 | CC-BY 3.0 | Specific prop (search term: windmill) |
| quaternius | `animated-animal-pack` | 12 | CC0 | Wildlife for forest and mountain (animated) |
| quaternius | `cars-bundle` | 7 | CC0 | Cars |
| quaternius | `farm-animal-pack` | 7 | CC0 | Hoofington cows, horses, pigs, sheep, llama (animated) |
| quaternius | `farm-buildings-bundle` | 10 | CC0 | Hoofington barn, silo, windmill, coop, fences |
| quaternius | `furniture-pack` | 19 | CC0 | Furniture |
| quaternius | `medieval-village-pack` | 39 | CC0 | Village houses, wells, carts (Hoofington variety) |
| quaternius | `modular-platforming-bundle` | 23 | CC0 | Gameplay platforms |
| quaternius | `modular-train-pack` | 11 | CC0 | Train |
| quaternius | `pirate-kit` | 71 | CC0 | Lighthouse shipwreck and docks |
| quaternius | `stylized-nature-megakit` | 68 | CC0 | Hero nature set: trees, rocks, cliffs, plants (closest to the concept-art style) |
| quaternius | `survival-pack` | 32 | CC0 | Crates, barrels, tools |
| quaternius | `ultimate-food-pack` | 50 | CC0 | Stall food |
| quaternius | `ultimate-house-interior-pack` | 82 | CC0 | Interiors |
| quaternius | `ultimate-platformer-pack` | 21 | CC0 | Gameplay props |
| quaternius | `ultimate-stylized-nature-pack` | 12 | CC0 | Stylized trees (maple, birch, pine) |

## Coverage by location

| Location | Main packs |
|---|---|
| Hoofington (farm village) | kenney city-kit-suburban, fantasy-town-kit, nature-kit; quaternius farm-buildings-bundle, farm-animal-pack, medieval-village-pack; polypizza barn, silo, windmill, hay-bale, tractor, scarecrow, mailbox, garden-gnome, chicken, cow, sheep, pig |
| Baa-ardwalk (pier + fair) | polypizza ferris-wheel, carousel, roller-coaster, pier, buoy, beach-umbrella, surfboard, ice-cream, food-truck, market-stall; kenney coaster-kit, watercraft-kit, food-kit, minigolf-kit, holiday-kit; kaykit restaurant-bits |
| Crane Yard | polypizza tower-crane, excavator, cement-mixer, scaffolding, shipping-container; kenney city-kit-industrial, factory-kit, survival-kit; kaykit resourcebits |
| Downtown Bleatsville | kenney city-kit-commercial, city-kit-roads, retro-urban-kit, modular-buildings, mini-shop, car-kit; kaykit city-builder-bits, furniture-bits |
| Mt. Gigga | quaternius stylized-nature-megakit (rocks, cliffs); kenney nature-kit; kaykit forest-nature-pack; polypizza mountain, cave, satellite-dish |
| Whispering Pines | quaternius stylized-nature-megakit, ultimate-stylized-nature-pack, animated-animal-pack; kaykit forest-nature-pack; kenney mini-forest; polypizza log, mushroom, waterfall, tree-house, bridge |
| The Dam | **custom `the-dam`** (hero model matched to `docs/art/hifi/14_poi_the_dam.png`); kenney city-kit-industrial, factory-kit (extra pipes, tanks); polypizza water-tower |
| Old Lighthouse | polypizza lighthouse, shipwreck, rowboat, crab, seagull; kenney pirate-kit, watercraft-kit; quaternius pirate-kit |
| Gameplay props | kenney platformer-kit (springs, coins); kaykit platformer-pack; polypizza trampoline; survival/resource crates and barrels |
| NPCs / animals | kenney mini-characters; quaternius farm and animated animals; polypizza goat, ram, seagull, crab |

## Known gaps (to fill from Meshy or generated art)

- **Style mix**: Kenney (flat colour), Quaternius (stylised textured) and Poly Pizza (mixed Google Poly) differ; prefer Kenney + Quaternius + KayKit, use Poly Pizza only for specific landmarks, and unify with the shared toon material.
- **Signature landmarks** that should look unique: Mt. Gigga summit dish, the GIGGA goat statue, Baa-ardwalk ferris wheel styling.

## Custom models

| Model | File | Notes |
|---|---|---|
| The Dam | `custom/the-dam/the-dam.glb` (preview `_preview.png`) | Original CC0 model built in Blender against `docs/art/hifi/14_poi_the_dam.png`. 1 GLB, ~8.6k faces, ~1 MB, metres, Y-up, origin at the base centre of the wall, spillway front faces +Z (control house sits at +X). 60 m wall, 18 m tall, deck top at 18.8 m. Named parts so code can swap or animate them: `Water_Fall_0..3` (streak texture, scroll its UVs for flow), `Water_Foam_*`, `Water_Lip_*`, `Water_Reservoir`, `Lamp_*_Glow`, `ControlHouse_*`, `Pipe_*`, `Ladder_*`, `Rail*`, `Abutment_Rock_*` (drop these if the terrain already supplies cliffs). |
