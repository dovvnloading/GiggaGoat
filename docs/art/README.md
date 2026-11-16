# Gigga-Goat reference art

Agents: this folder is the visual target. When a brief cites an image here, match its look, layout and
level of detail as closely as real-time three.js allows. Read [ART_PLAN.md](ART_PLAN.md) for phases and status.

## Style rules (match these in code)

- **Shapes:** chunky, readable silhouettes; slightly rounded bevels; nothing razor-thin. Props are big enough to read from 30 m.
- **Shading:** soft stylised 3D with gentle toon ramps and subtle dark outlines (inverted-hull or post-process edge).
  Warm key light, cool soft fill/sky light, soft shadows, light ambient occlusion. Never photoreal.
- **Colour:** bright and saturated but tasteful. Palette:
  Grass `#77B754`, sand `#F7DB99`, shallows `#21A8C6` to deep `#0F669E`, rock `#8C919E`, hay `#F2C14F`,
  barn red `#D84F3D`, UI accents gigga purple `#7A4CFF`, orange `#FF891E`, yellow `#FFD833`.
- **Density:** every location is a playground. Lots of small, physical, lickable/pushable things: crates, bales, cones,
  barrels, benches, signs, planters, and climbable ledges everywhere.
- **Water:** turquoise shallows, foam at shorelines and under falls, sparkles; rivers and spillways read clearly.
- **Sky:** bright blue with big puffy clouds by day; warm pink-orange golden hour for the Baa-ardwalk and Lighthouse.

## Phase A: environment (hi-fi, `hifi/`)

| File | What it defines |
|---|---|
| `hifi/07_key_art.png` | Overall look and mood of the game. |
| `hifi/18_billy_isle_map.png` | Island layout: where every location sits, the ring road, dirt paths, beaches, river, islets. |
| `hifi/08_poi_hoofington.png` | Starter farm village at street level: road, barn + silo, houses, windmill, gnomes, mailboxes, trampoline. |
| `hifi/09_poi_baaardwalk.png` | Pier + mini amusement park at sunset: stalls, ferris wheel, launch pad, buoys, beach. |
| `hifi/10_poi_crane_yard.png` | Construction site: tower cranes, half-built tower, scaffolding, crates, cones, containers. |
| `hifi/11_poi_downtown.png` | Main street with shops, awnings, lamp posts, fountain square, parkour rooftops. |
| `hifi/12_poi_mt_gigga.png` | Terraced climbable mountain: grassy ledges per tier, climbing faces, caves, waterfalls, summit dish. |
| `hifi/13_poi_whispering_pines.png` | Forest: river, waterfall, log bridge, stepping stones, lookout tower, mushrooms. |
| `hifi/14_poi_the_dam.png` | Dam wall with spillways, top walkway, control house, reservoir dock, river below. |
| `hifi/15_poi_lighthouse.png` | Lighthouse islet at sunset: keeper's cottage, shipwreck, sea cave with a Goat Relic. |
| `hifi/16_mode_rising_tide.png` | Rising-tide party mode: flooded island, last dry terraces, floating debris. |
| `hifi/21_goat_model_sheet.png` | The hero goat: turnaround, size tiers KID/BILLY/BIG/GIGGA, action poses. |
| `hifi/22_hud_mockup.png` | In-game HUD: GIGGA size meter, combo + score, stamina ring, Hay-Build hotbar, minimap, current gig. |

Only the hi-fi images above are reference art. Characters, props and UI get their own hi-fi references when those phases start (see ART_PLAN.md).
