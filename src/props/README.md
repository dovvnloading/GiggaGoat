# Props — library-backed visual lane

This lane only constructs Three.js scene objects. It owns **no physics**, imports
no other game lane and **does not modify** `src/core/GameView.ts`. The future
core integration should replace existing meshes with these `Group` roots, and
keep applying exactly the same rigid-body positions and quaternions.

```ts
import { PropFactory } from '../props';
const props = new PropFactory();
scene.add(props.createGigBoard());               // ground-relative; GameView board +0.15
scene.add(props.createCrate(crateDescriptor.size));
scene.add(props.createCrateDebris(debrisRadius)); // legacy BoxGeometry(1) scale
scene.add(props.createTrampoline(marker.halfExtents));
scene.add(props.createLaunchPad(marker.halfExtents));
scene.add(props.createGigProp(spawn.size, 'hay')); // or 'barrel' / 'crate'
scene.add(props.createBuildPiece('ramp'));        // centred on physics body
// Remove all prop roots from the scene before calling props.dispose().
props.dispose();
```

The methods return **synchronous, usable** `THREE.Group` objects. Each initially
contains coloured low-poly fallbacks; as GLBs load, a cached source prototype is
cloned and fitted into that part's precise assigned slot. The parent group never
changes identity or transform. `group.userData.nominalSize` holds the intended
legacy size; `group.userData.assetStatus` reports `loading`, `ready` or
`fallback`. A failed request is cached as a failure, so no retry storm occurs.
`whenReady()` can await currently requested assets for tests/lab. The caller
must use one factory for its scene and call `dispose()` on scene teardown.

**Asset paths / license:** library URLs are based on Vite's application root
even on nested lab routes or GitHub Pages. All selected assets are **CC0**
according to `public/assets/library/manifest.json`: Kenney Survival Kit
(box, box-large, barrel, fence, signpost), Platformer Kit (spring, arrow),
Fantasy Town Kit (planks), and Poly Pizza's *Hay* by Quaternius. The Poly Pizza
trampoline is CC-BY 3.0, so the similar Kenney spring is used instead to stay
within this task's `src/props/`-only scope (which prevents editing root
`CREDITS.md`). If that model is substituted later, the required credit must
be added to root credits.

**Size reference:** see `GameView.createBoardMarkers`,
`createSurfaceMarkers`, `buildGeometry`, `updateDebris` and
`updateGigVisuals`. Surface markers take their existing half-extents (currently
2.1 / 0.23 / 2.1 from `Game.setupSurfaces`); decorative spring and top rim
rise *above* the box just as today's rim does. Hay-Build sizes are
floor/launch-pad 2×0.46×2, wall 0.46×2×2 and ramp 2×1.8×2 rising toward +Z.
The ramp remains aligned with the convex-hull collider.

Open `/src/props/lab/` via `npm run dev` to compare all six factory kinds,
each Hay-Build variant and spawned gig hay/barrel/crate against the old meshes.
Vite's existing automatic lab-page discovery includes this page in production
builds without any changes outside this directory.
