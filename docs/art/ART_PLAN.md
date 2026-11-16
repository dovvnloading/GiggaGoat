# Gigga-Goat art production plan

Owned by the coordinator. Art is produced in phases that run one step ahead of the code lanes,
so each brief can point agents at finished reference art for the work they are doing.

## Pipeline

1. **Hi-fi reference** (ChatGPT image generation, done by an agent thread): images in the locked style below,
   saved to `docs/art/hifi/`.
2. **Hand-off**: the next code brief for that area cites the exact hi-fi files to match.

## Locked style (applies to every hi-fi image)

Bright, saturated but tasteful colours. Soft stylised 3D with chunky, readable shapes and slightly rounded bevels.
Gentle toon shading with subtle dark outlines. Soft GI and warm sun. Hand-painted textures. Lots of small,
explorable detail. Never photoreal, never cheesy, no weapons. Palette: hex values in README.md.

## Phases

| Phase | Scope | Images | Feeds which code work | Status |
|---|---|---|---|---|
| **A. Environment** | Key art, island map, the 8 locations, rising-tide arena | 07, 08–15, 16, 18 | World visuals pass (terrain materials, water, sky, POI dressing) and the first playable integration | in progress |
| B. Characters | Goat model sheet, size tiers, move set, cosmetics | produced when this phase starts | Goat mesh + animation on the ragdoll; cosmetics system | after A |
| C. Props & building | Prop kit, Hay-Build pieces, breakables/debris | produced when this phase starts | Prop meshes, breakables, Hay-Build in world | after B |
| D. UI | HUD, menus, emotes, map screen | produced when this phase starts | HUD and menu lane | after C |

## Phase A queue (two image threads in parallel, one image per message, same chat per thread for style consistency)

| Thread | Order |
|---|---|
| Image thread 1 | 07 key art (done), 08 Hoofington, 09 Baa-ardwalk, 10 Crane Yard, 11 Downtown Bleatsville, 16 Rising tide |
| Image thread 2 | 18 Billy Isle map, 12 Mt. Gigga, 13 Whispering Pines, 14 The Dam, 15 Old Lighthouse |

The dev lane (chaos physics) keeps running in its own thread meanwhile. When Phase A lands, both image tabs go back to
code work: the world visuals pass and the first playable integration, each citing the hi-fi environment set.
