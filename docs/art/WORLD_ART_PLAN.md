# Billy Isle world art plan

Owner: Claude (art lead / visual developer). Agents only wire up assets that this plan names, with exact
file paths, sizes and placements. Agents do not choose, recolour or reshape art.

## 1. One world, one style

The paintings in `docs/art/hifi/` (07-16) define a single look: a cosy, present-day cartoon island.
Chunky, rounded shapes; flat saturated colours with soft shading; clean trim; lots of flowers and greenery;
asphalt roads, mailboxes, trampolines, street lamps, arcades. There is **no medieval timber framing,
no realistic or weathered texture and no bare modern grey box** anywhere in the paintings.

Rules for every asset:

1. **One building family for the whole island: the Kenney city kits** (`city-kit-suburban`,
   `city-kit-commercial`, `city-kit-industrial`, `city-kit-roads`). They share one author, one proportion
   system and one palette atlas, so homes, shops and industry read as the same world. Do not mix in
   Quaternius medieval, Poly Pizza, Scenario, Meshy-realistic or other building families.
2. **Props**: Kenney kits first; NVIDIA USDCraft-10K (flat-coloured, Apache-2.0) for street furniture and
   yard props Kenney lacks. Same rule: flat colours, chunky, no realistic textures.
3. **Colour comes from the painting, per part.** Every building is recoloured in Blender by replacing its
   palette texture per part class (wall, roof, trim/plinth, glass, door) with colours sampled from that
   district's painting, keeping Kenney's light/shade steps. The game must never repaint a building with a
   single flat colour or a height-based wall/roof split.
4. **Details that sell the painting are added in Blender** before the asset ships: shutters, window boxes
   with flowers, wall lanterns, awnings, chimneys.
5. **Proportions**: pick the model whose native proportions are closest to the gameplay collider box
   (stretch at most ~1.3x on any axis). Never squash a tall model into a wide box.
6. **Every asset is checked side by side with its painting** (render + painting crop) before it is merged,
   and checked again live in the game/World Lab after deploy.

## 2. Rendering rules (apply to every district)

- Buildings keep their authored colours: no lerp toward palette colours in the bakers for houses.
- Toon ramp for buildings has real light/shade contrast (about 1.8:1 lit vs shaded), not 1.2:1.
- No shadow acne: building materials use `shadowSide = BackSide`, shadow radius 1, normal bias about
  1.5 shadow texels. Buildings near the player cast shadows in the game.
- World Lab renders like the game: no ACES/exposure boost (it bleaches pastels).

## 3. Districts

| District | Painting | Building family | Palette (sampled from painting) | Key set pieces |
|---|---|---|---|---|
| Hoofington | 08 | Kenney suburban cottages `t, e, c, f, r` (pitched roofs, chimneys); no flat-roof types | pink wall #ec9fb8 / slate roof #454860; cream wall #fbe3c0 / terracotta roof #d65a43; yellow wall #f4cf4f / blue-slate roof #4e5a78; trim cream stone #e9dfcf; plinth stone #a99f90; glass #9fd0f0; doors wood #7a4b2e; shutters #7fa7d6 | red barn + white trim, silo, windmill, lantern street lamps, red mailboxes, gnome, trampoline, picket fences, window boxes |
| Downtown Bleatsville | 11 | Kenney commercial shopfronts (3-4 storeys) + suburban townhouses at the back | pink #e98aa0, butter yellow #f6d36a, lavender #b9a6e0, mint #9fdcc4, cream #f6ead2; striped awnings red/white, green/white; dark-green shop trim | Baakery, Kid Arcade, Hoof & Co storefronts, water towers, AC units, bunting, black lantern lamps, fountain |
| Baa-ardwalk | 09 | Kenney commercial booths/stalls + boardwalk (Kenney pirate/watercraft planks) | sunset pastels: coral #f08a6c, candy pink #f4a6c8, aqua #7fd6d0, cream #fff1d6, wood #b5794a | ferris wheel, striped booths, white pier rails, palms, beach props |
| Crane Yard | 10 | Kenney industrial + USDCraft construction props | concrete #c9c3b8, safety yellow #f5c518, container blue #2f5a9e / red #c4473b / green #3f7d4c | tower crane, concrete frame with scaffolding, containers, cones, barriers, crates |
| Whispering Pines | 13 | Kenney holiday-kit log cabins + nature kit | pine #3f7d4c, moss #86b95a, log brown #8a5a3a, rock #8f969b | lookout tower, log bridge, waterfall, mushrooms |
| Old Lighthouse | 15 | Kenney suburban cottage (white wall / red roof) + pirate-kit lighthouse/dock | lighthouse red #d13f35 / white #f5f0e6; cottage white #f4efe6 / red roof #c9473b | lighthouse, keeper cottage, shipwreck, dock, cave glow |
| Mt. Gigga | 12 | terrain + Kenney nature; no buildings except summit dish and flags | rock #9aa0a4, grass #7fbf5a | ledges, caves, waterfalls, flags |
| The Dam | 14 | custom Blender dam (done) + Kenney industrial control house | concrete #c7c2b8, safety yellow rails #f2c230 | spillways, control house, pipes |

## 4. Order of work

1. **Hoofington** (now): recoloured Kenney cottage set with shutters and window boxes; baker stops
   repainting houses; shadow/contrast/Lab fixes. Remove the off-style Quaternius timber recolours.
2. Island-wide `house`/`cottage` props switch to the same Hoofington cottage set (Lighthouse keeper
   cottage uses the white/red variant).
3. Downtown shopfront recolours (one per storefront in the painting) + awnings and signs.
4. Baa-ardwalk, Crane Yard, Pines, Lighthouse, in that order, each with its own painting check.
