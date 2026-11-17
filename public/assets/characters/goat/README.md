# Gigga-Goat rigged goats (Meshy + Blender)

Three rigged, animated goat variants that replace the procedural legacy goat. Each one is a single GLB with its texture embedded:

| File | Look | Size |
|---|---|---|
| `goat_hero.glb` | The approved hero goat from `docs/art/hifi/21_goat_model_sheet.png`: cream wool, amber curled horns, orange scarf | ~1.3 MB |
| `goat_alt_bandana.glb` | Brown-and-white patchy goat with short dark horns and a blue bandana | ~1.4 MB |
| `goat_alt_bell.glb` | Charcoal goat with silver curled horns and a green knitted collar with a brass bell | ~1.3 MB |

Preview: `_preview.jpg`. The hero mesh came from Meshy multi-view image-to-3D using the model sheet's front, side and back views. The alternates came from GPT-image turnarounds of that hero. All three were remeshed to about 10K quads, auto-rigged as quadrupeds in Meshy, and animated in Blender.

## Conventions (identical for all three)

- **Units:** metres. Hooves rest on y = 0 at the origin. Total height including horns is about 1.85, and the hip is about 0.69 above the ground, matching the Billy-tier physics goat (`src/physics/GoatRagdoll.ts`). Scale it per size tier (Kid 0.6, Billy 1, Big 1.6, GIGGA 3).
- **Facing:** forward is **-Z**, matching `forward(yaw)` in `src/physics/math.ts`.
- **Skeleton:** a quadruped skin with 37 to 46 bones; bone names differ per variant, but every clip is already baked per file.
- **Animation clips (same names in every file, 30 fps, in place with no root motion):**
  - `Idle` (3 s loop): breathing, look-around, ear flick, tail wag, chewing.
  - `Walk` (32 frames, loop): four-beat lateral gait.
  - `Run` (16 frames, loop): gallop with spine flex.
  - `Jump` (30 frames, one-shot): crouch, launch, tuck, reach, land.
  - `Headbutt` (24 frames, one-shot): wind-up then horns-first strike.
  - `Bleat` (30 frames, one-shot): head up, jaw open.

## Using them in three.js

Load with `GLTFLoader` through the root-safe public-asset URL helper. Play the clips with one `AnimationMixer` per goat, and blend Idle, Walk and Run by ground speed (Walk is about 1.2 m/s at timeScale 1, Run about 3.5 m/s). Fire Jump, Headbutt and Bleat as one-shots with `LoopOnce` and `clampWhenFinished`. Pick a variant per goat (player choice or random per bot) so the island isn't full of identical goats. Clone skinned meshes with `SkeletonUtils.clone`.

License: original art made for Gigga-Goat (CC0).
