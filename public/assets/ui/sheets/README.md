# Gigga-Goat UI sprite sheets

GPT-image sprite sheets generated from `docs/art/hifi/22_hud_mockup.png` (and the current title menu), in the exact HUD style. They are RGBA PNGs with transparent backgrounds and no baked text, so labels and numbers stay live HTML or canvas text. They are served at `assets/ui/sheets/<file>.png`.

Agents building UI should slice these sheets into individual sprites. Slice them by alpha bounding boxes, or use CSS `background-position` and 9-slice `border-image` for the stretchable panels and buttons. Do not redraw these elements in CSS gradients.

| Sheet | Size | Elements (left to right, top to bottom) |
|---|---|---|
| `01_panels.png` | 1448x1086 | GIGGA size-meter frame with tier tabs and gradient bar; style-score starburst with pill and purple combo burst; minimap ring with label plate; current-gig card with clipboard tab; stamina ring; HAY-BUILD hotbar tray with header and arrows; one highlighted slot and four normal slots; small key badge; prompt pill; purple, brown and wide gold banner bars; small purple, brown and gold tab pills; wheat divider; hammer badge; left and right arrows |
| `02_icons.png` | 1448x1086 | goat size tiers (Kid, Billy, Big, GIGGA); stamina hooves; hay floor (bale); fence wall; hay ramp; launch pad; supplies crate; gig clipboard; Cud Coin; combo star; compass N badge; map pin; map markers (red barn house, blue house, pink house, round tree, pine, apple tree) |
| `03_menus.png` | 1536x1024 | tall menu panel; yellow primary button (normal, hover, pressed); purple button (normal, hover, pressed); stat card; toggle off and on; slider track with knob; checkbox empty and checked; close X; back arrow; tab buttons (brown, gold active, purple) |

License: original art made for Gigga-Goat (CC0).
