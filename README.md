# GiggaGoat

A wobbly-physics goat sandbox for the browser: lick, headbutt, climb and build your way across
Billy Isle, and grow GIGGA by causing stylish chaos. See [docs/DESIGN.md](docs/DESIGN.md).

## Local discoveries

Look for animated roadside vignettes around Billy Isle, from the Hoofington breakfast bell to the keeper's signal lantern. Get close and bleat (E / gamepad X) to trigger a little scene and earn Cud Coins on your first discovery. You can revisit for another reaction after a short cooldown; discoveries persist with your normal save. They are optional and stay out of active gigs and party modes.

## Living Billy Isle roadmap

Track the living-world work, district backlog, milestone acceptance criteria and adversarial quality gates in
[docs/art/LIVING_WORLD_ROADMAP.md](docs/art/LIVING_WORLD_ROADMAP.md). Follow-up implementation PRs should reference its task IDs and link actual gameplay and profiling evidence.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run ci       # typecheck + tests + production build (what CI runs)
```

## Layout

| Path | Lane |
|---|---|
| `src/physics/` | Physics core (Rapier): stepping, goat active ragdoll, tongue, headbutt, impulses |
| `src/world/` | Billy Isle: terrain, water, POIs, roads, dressing, stylised renderer, colliders, viewer |
| `src/gameplay/` | Engine-agnostic rules: abilities, style/combo/GIGGA, Hay-Build, Cud Coins, unlocks |
| `src/chaos/` | Water and buoyancy, breakables, chain reactions, surfaces, trampolines, launch pads |
| `src/modes/` | Party-mode rules (Rising Tide, King of the Peak, Hay Heist) and bot goats |
| `src/gigs/` | Goat Gigs free-roam jobs |
| `src/core/`, `src/main.ts` | The playable game: wiring, camera, input, HUD, menus (integration tasks only) |
| `docs/art/hifi/` | Reference art (see `docs/art/README.md`) |
