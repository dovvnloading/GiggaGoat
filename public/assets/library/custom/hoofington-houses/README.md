# Hoofington house set (Kenney city-kit-suburban, painting palette)

Seven houses built in Blender from CC0 Kenney `city-kit-suburban` models, the island's single building
family (see `docs/art/WORLD_ART_PLAN.md`). Each one:

- keeps Kenney's geometry and light/shade steps, but its palette texture is recoloured **per part class**
  (wall, roof, trim/plinth, glass, door) with colours sampled from `docs/art/hifi/08_poi_hoofington.png`;
- gains painted shutters and window boxes at every wall window
  (no shutters on dormers); garden bushes stay green (`Foliage` material);
- front faces glTF +Z, base at y=0, native Kenney units (about 1.3 x 1.1 x 1.4); the game stretches it to
  the collider box, so the source types were picked for proportions close to 10 x 9 x 10 m (max ~1.3x).

| File | Kenney type | Wall | Roof | Trim | Used for |
|---|---|---|---|---|---|
| house-f-pink.glb | f (hip roof) | #ec9fb8 | #454860 slate | #ecd6da | Hoofington pink home |
| house-t-cream.glb | t (gable + dormer) | #fbe3c0 | #d65a43 terracotta | #b9ad9c stone | Hoofington cream home |
| house-e-yellow.glb | e (two-storey gable) | #f4cf4f | #4e5a78 blue slate | #e4c794 | Hoofington yellow home |
| house-c-white.glb | c (cross gable) | #f6f1e8 | #c9473b red | #b9ad9c | Hoofington farmhouse |
| house-r-sky.glb | r (narrow gable) | #a9d3ea | #4b4960 slate | #f3ece0 | Hoofington cottage |
| house-t-white.glb | t | #f6f1e8 | #c9473b red | #b9ad9c | island `house` props (Old Lighthouse) |
| house-f-white.glb | f | #f6f1e8 | #c9473b red | #b9ad9c | island `cottage` props |

The village homes have individual shutter, door, window-box and flower palettes. The pink home uses berry shutters and coral flowers. The cream home has olive shutters and marigold boxes. The yellow home has slate-teal shutters, a deep teal door and light flowers. The farmhouse has dark sage shutters with red and apricot flowers. The blue cottage has ivory shutters and blue-painted boxes. Glass is shared. Render these colours directly from the models.
