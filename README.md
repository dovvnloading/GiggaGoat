# GiggaGoat

A wobbly-physics goat sandbox for the browser: lick, headbutt, climb and build your way across
Billy Isle, and grow GIGGA by causing stylish chaos. See [docs/DESIGN.md](docs/DESIGN.md).

## Develop

```bash
npm install
npm run dev      # local dev server
npm run ci       # typecheck + tests + production build (what CI runs)
```

## Layout

| Path | Lane |
|---|---|
| `src/physics/` | Physics core (Rapier): stepping, goat active ragdoll, tongue, impulses |
| `src/world/` | Billy Isle generation: terrain, water, POIs, roads, props, colliders |
| `src/gameplay/` | Engine-agnostic rules: abilities, style/combo/GIGGA, Hay-Build, inventory |
| `src/core/`, `src/main.ts` | Boot + integration (integration tasks only) |
