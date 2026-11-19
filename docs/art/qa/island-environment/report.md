# Billy Isle environment visual QA

Reviewed the production island seed at 720 × 405 using the game's software renderer and scene builder. The sheets cover 24 authored locations across eight zones. Each location has a daylight approach, a second ground-level bearing and an elevated view in overcast lighting. Two landmarks also have separate daylight and dusk views. Four farm species have paired animation frames. These make 84 stills. A second pass inspected every location and both landmarks after the asset library finished loading, for 112 stills in total. The local asset loader completed 190 GLB load requests, including 28 distinct Hoofington models and 36 Downtown models.

## Findings and corrections

| Where | What the images exposed | Correction and visual check |
| --- | --- | --- |
| Island scenery | Several embedded kits lost their palette. Light walls, equipment and vegetation were difficult to distinguish while assets streamed. | Baked the source GLB faces and material colors into the first-frame meshes. The crane loader, two market awnings, roadside kiosks and flowers retain distinct colors. Baking now reports a missing source texture. |
| Hoofington | Hay and a tree obscured animals in the pasture. The static town scenery could not show grazing. | Repositioned the cow, sheep and pig. Livestock use independent animated skeletons. The cow and horse lower their heads in the paired frames. Pig and sheep idle motion is subtle. |
| Baa-ardwalk | Kiosk seating sat directly on turf and lacked a visible edge. | Fitted native timber boards beneath the snack counter, lemonade terrace and parasol seating. The reverse views show the extent of each deck. |
| Crane Yard | Equipment lacked a clear relationship to the loading and haulage areas. | Staged the hopper and conveyor by the crane, the truck with its cargo, and the loader with stacked timbers. The reverse views show the equipment relative to the crane supports. |
| Downtown Bleatsville | Market fabric lost its silhouette at ordinary viewing distances. The café loading area and alley had little distinction from the lawn. | Preserved the awning faces, paved the working footprints, and grouped produce, delivery vehicles and refuse by use. The market reads from both ground-level angles. |
| Mt. Gigga | The expedition tent developed holes at distance. Steep faces around the climbers' rest read as green turf in software. | Preserved the tent silhouette and sampled the terrain's cliff exposure, rock colors and strata on the software path. The shelf still carries grass while the riser behind the rest darkens to stone. |
| Whispering Pines | Forest clearings had little to identify their purpose. | Grouped canoes and cut timber near the water, set camp equipment together, and furnished a woodcutting bench. The overviews show their relationship to the trail and trees. |
| The Dam | Plain structural forms obscured the piers and service equipment. The plunge pool showed as one dark color below active spillways. | Restored the kit geometry, placed the pump, turbine and valve equipment on working pads, and shaded the pool from the four outlet positions. The streamed scene revealed a screen of mature pines across the east-bank sightline. Shorter pines now frame the approach, and all four spillways are visible from the same camera. |
| Old Lighthouse | The dock planks were narrower than their physical sections, leaving visible breaks. The sea around the cape had one color. | Fitted planks to the deck footprints while retaining the piles. The three sections now join. The sea samples terrain depth and tide, showing the shelf alongside the piers. |
| Across districts | Rectangular work pads ended abruptly in grass, and the daylight clouds had square edges. | Added surface wear along the actual site approaches. Excluded grass clumps from the approach center. Interpolated cloud samples at display resolution. |

## Zone evidence

Each row of a sheet follows one location across three views.

| Zone | Locations | After streaming |
| --- | --- | --- |
| [Hoofington](hoofington-views.jpg) | Harvest stand, roadside pumpkin cart, seed packing bench, tractor yard | [Loaded scenery](hoofington-streamed.jpg) |
| [Baa-ardwalk](baa-ardwalk-views.jpg) | Beach snack counter, lemonade terrace, promenade parasols | [Loaded scenery](baa-ardwalk-streamed.jpg) |
| [Crane Yard](crane-yard-views.jpg) | Aggregate loading line, haulage staging, loader apron | [Loaded scenery](crane-yard-streamed.jpg) |
| [Downtown Bleatsville](downtown-bleatsville-views.jpg) | Café delivery, delivery alley, street market | [Loaded scenery](downtown-bleatsville-streamed.jpg) |
| [Mt. Gigga](mt-gigga-views.jpg) | Climbers' rest, expedition bivouac, survey cache | [Loaded scenery](mt-gigga-streamed.jpg) |
| [Whispering Pines](whispering-pines-views.jpg) | Canoe landing, trail camp, woodcutter's bench | [Loaded scenery](whispering-pines-streamed.jpg) |
| [The Dam](the-dam-views.jpg) | Pump station, turbine service bay, valve inspection bay | [Loaded scenery](the-dam-streamed.jpg) |
| [Old Lighthouse](old-lighthouse-views.jpg) | Fish landing, keeper's boatyard | [Loaded scenery](old-lighthouse-streamed.jpg) |

[Landmarks in daylight and at dusk](landmarks.jpg) · [Livestock animation frames](livestock.jpg)

## Follow-up rendering checks

The hosted WebGL profiler recorded 467,984 triangles from the Hoofington street camera. The distant lighthouse alone contributed 51,296. The harbor now switches to a distant mesh, individual planted crops are culled outside the view, and the distant Dam uses its batched kit. Close-range checks covered the lighthouse terraces and four active spillways.

The Downtown WebGL capture also revealed two lanterns on the same sidewalk, 0.87 m apart. The road and the shopfront each supplied one. The district lantern now owns that spot.

## Verification limits

The fixed cameras captured both the embedded scenery and the scene after the shipped GLB files and their textures loaded. The images establish placement, silhouettes, palette and selected poses in the software renderer. Player-camera visibility, movement, frame pacing and the WebGL rendering path require separate evidence.

Some long views still have broad areas of uninterrupted lawn or paving. Rooflines and crane structure obscure parts of some reverse views. The approach and elevated images show those same locations from clear bearings. The two animation frames show the endpoints of a pose change. They cannot establish how smooth the motion looks over time.
