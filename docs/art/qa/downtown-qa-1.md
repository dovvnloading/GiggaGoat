# Downtown Bleatsville visual QA, pass 1 (art lead)

Compared: live World Lab bookmark 11 (main @ 2cb0aea) against `docs/art/hifi/11_poi_downtown.png`.

| # | Sev | Issue | Root cause | Fix (owner) |
|---|---|---|---|---|
| D2 | A | Facades muted grey-blue; mixed KayKit / modular / Kenney styles | Mixed building families, palette lerp repaint | `custom/downtown-shops`: 11 Kenney commercial buildings recoloured per part (pastel walls, cream trim, flower boxes) with Blender shopfronts (Claude, merged #101); wiring + no repaint (agent) |
| D3 | A | Giant shop signs float 0.93 m in front of the facades at 4.8 m | `signAtlas` offset/size | Signs flush (0.04 m) on each model's sign board using per-model anchors (agent, from Claude's numbers) |
| D1 | A | Street wide and empty; shops set far back behind huge sidewalks | Layout (`layouts.ts` city section) | Layout pass: shops on the pavement line, narrower carriageway, 3-4 storey street wall (Claude to spec after the wiring lands) |
| D4 | B | Three rows of huge pennant garlands | `lights` scatter scale | 45% size, two rows (agent) |
| D7 | B | Brown planter boxes with shard leaves | Kenney planter/flower baked to solid colour | Flower clumps/barrel planters (Claude) |
| D6 | B | Grey highway lamps | Lamp swap PR #88 | World agent |
| D5 | B | Dark blocky object on a left roof | Unknown roof prop | Re-check after the shop swap |
