# Billy Isle world lane

All code in this directory is isolated from `src/core/`, `src/gameplay/` and `src/physics/`. It exports deterministic **data** and two optional adapters: Three.js visuals and Rapier colliders. The game integrator owns scene attachment, physics stepping, player movement, water effects and object interactions.

## Public API (`src/world/index.ts`)

| Export | Purpose |
| --- | --- |
| `generateIsland({ seed?, size?, resolution? })` | Build the complete island; default 600 m and 193×193 samples. |
| `new IslandGenerator(defaults).generate(overrides)` | Equivalent reusable generator. Seeds may be numbers or strings. |
| `heightAt(island, x, z)` | Bilinear final terrain height (after roads, river and plot cuts). |
| `biomeAt(island, x, z)`, `zoneAt(island, x, z)` | Named biome and POI lookup. |
| `hashIsland(island)` | Stable FNV-style hexadecimal fingerprint of terrain, zones, roads, props, spawns and relics. |
| `landAreaAtTideLevel(island, level)` | Approximate dry terrain area in square metres, sampled from grid cells. |
| `arePoisConnected(roads, ids)` | Undirected graph connectivity check. |
| `makeColliderDescriptors(island)` | Generate serialized-style collider descriptors; already invoked by the generator. |
| `buildRapierColliders(world, island)` | Build the heightfield and static/dynamic prop colliders in an initialized Rapier world. Returns the terrain collider and prop collider/body maps indexed by prop ID. |
| `createWorldScene(island, {chunkSegments?, cullingDistance?})` | Build terrain, instanced scenery, roads, river, reservoir, sea, gradient sky and lighting, without creating a WebGL renderer. |
| `isPointInsideProps(point, props, margin?)` | Yaw-aware broad-phase point test, useful for spawning and collectibles. |
| `isSafeCollectiblePosition(island, position)` | Check ground/sea clearance and prop solidity. |
| `SeededRandom`, `GradientNoise` | Deterministic PRNG and in-house gradient/fractal noise. |
| `POI_IDS`, `BIOMES` | Canonical names/order; types are exported for every descriptor. |

`IslandData` contains row-major `Float32Array heights`, matching `Uint8Array biomeMap` and `zoneMap`, all eight `pois`, `plots`, a descending-elevation `river`, `reservoir`, graded `roads`, `props`, `spawns`, **50 `relics`** and `tideLevels`. It also provides physics-ready `colliders` (heightfield, cuboid, cylinder and convex). All positions and sizes are in **metres**, **Y up**, with X/Z centred on the island and sea level at Y=0. Terrain positions increase X fastest and Z by row. Rapier's required column-major transpose is performed only in the collider adapter.

`PropDescriptor` records ID, kind, POI, Y-rotated transform, size, mass/type (`static` or `dynamic`), collider primitive, collision enabled, and independent `breakable`, `lickable` and `climbable` flags. Dynamic objects have their own rigid bodies; climbable buildings, pads, bridges and even roof surfaces are solid. Ramp descriptors become actual convex wedges rather than impassable boxes.

### Minimal integration

```ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  generateIsland, buildRapierColliders, createWorldScene,
  heightAt, landAreaAtTideLevel,
} from './world';

await RAPIER.init();
const island = generateIsland({ seed: 'multiplayer-lobby-42', resolution: 193 });
const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const colliders = buildRapierColliders(physics, island);
const visuals = createWorldScene(island);
const scene = new THREE.Scene();
scene.add(visuals.group);

const playerStart = island.spawns[0]!.position;
const floorY = heightAt(island, playerStart.x, playerStart.z);

// Each render frame:
visuals.setDayNight(0.5); // 0..1; 0.5 = midday
visuals.updateCulling(camera); // supply the integration's camera

// During a rising-tide mode:
const tide = island.tideLevels[4]!;
visuals.setTideLevel(tide);
const drySquareMetres = landAreaAtTideLevel(island, tide);

// On teardown:
visuals.dispose();
physics.free();
```

The snippet's `camera` comes from the host game's camera and is intentionally not created by the world lane. Call `RAPIER.init()` before building colliders. The world module does **not** step physics or change collision groups.

## World layout

Eight POIs are given controlled, seed-jittered anchor districts; their layouts have stable grammar but randomized detail. Hoofington has farm fences/hay/barns; Baa-ardwalk has an out-to-sea pier and an open-frame ferris wheel; Crane Yard has a graded concrete-paved enclosure with chain-link perimeter fencing and two road gates, four accessible open concrete tower floors and yellow scaffolding, twin lattice tower cranes (one suspending a red I-girder), containers, pipe pyramids, striped barriers, stacked crates and cones; Downtown Bleatsville has a dense grid of staggered, walkable rooftops; Mt. Gigga has a long spiral trail and intermittent climbable cliff shelves; Whispering Pines has clustered trees, a river and logs; The Dam has a carved reservoir and spillway; Old Lighthouse sits on a rock-strewn cape. A fixed connected graph of graded roads and switchback trails runs between these districts. River crossings get separate walkable bridge decks, preserving the channel beneath them.

The generator scales the layout and vertical heights with `size`. Use at least 65 samples per side for recognizable roads; 193 is the recommended rendering/physics resolution. The square grid extends to sea outside the irregular island coast. Tide heights rise toward the mountain and `landAreaAtTideLevel` cannot increase as water rises. Water planes are visual; the integration layer should decide splash/elimination rules and rising-water physics.

## Development viewer

Start the existing Vite dev server with `npm run dev`, then open:

**http://localhost:5173/src/world/viewer/index.html**

This standalone page is deliberately not mounted in the application's root `index.html`. It provides a seed/regenerate input, orbit and WASD flying cameras, POI labels, live collider wireframes (including terrain), tide scrubber with dry-land area and adjustable day/night lighting. It never imports another lane. The regular Vite production build remains controlled by the existing root entry point.

**Shadow performance:** The viewer's terrain, buildings and shadow-casting prop transforms are static, but Three.js normally re-renders its 1536×1536 directional shadow map every animation frame. The viewer now caches this map and refreshes it when the island is regenerated, sun direction/daylight changes, or camera culling changes which shadow casters are present. Camera movement alone does not require rebuilding shadows if the casters remain the same. The animation loop and the all-bookmarks image exporter share this invalidation path. This keeps the same shadow resolution and scene detail; the game integrator may retain dynamic shadows because its actors move.

**Live frame budget:** The standalone viewer now starts at at most 1.0 device pixel ratio instead of 1.5 (a 2.25× reduction in shaded pixels on a 1.5-DPR screen). It samples actual delivered-frame intervals in 0.75-second windows and steps the render scale down toward 0.5 when the 60 Hz budget is persistently missed. Scale rises slowly after sustained on-budget frames, and a background-tab pause is ignored. The panel reports the current scale. This is a viewer-only policy; the game integrator still owns its renderer. The sea's full-screen material reuses one animated wave instead of evaluating a sparkle hash, power function and several extra trigonometric terms per fragment; the sky uses repeated squaring instead of `pow`. Fixed-panel backdrop blurs are removed to avoid an extra compositing cost. Coast foam, depth tint, tides, silhouette/detail geometry and shadows remain available.

**Real-browser profiling:** On GitHub's Ubuntu runner (with Chrome installed), `src/world/viewer/chrome-profile.test.ts` starts Vite and a real headless Chrome WebGL renderer, measures CPU + completed GL-render cost with `gl.finish()`, for every art bookmark. Headless Chrome in GitHub Actions may suspend offscreen `requestAnimationFrame` delivery, so this benchmark does not infer displayed FPS from rAF. Tests use a fixed 1280×720 CSS viewport and 1.5 device DPR; the profile prints GPU backend, framebuffer size, triangles and draw calls. The report is logged as `WORLD_CHROME_PROFILE` only. Synchronous GPU-work timings are **not** equivalent to delivered FPS, and results from Chrome's SwiftShader backend do not establish a frame-rate guarantee on other graphics hardware. `renderer-budget.test.ts` guards the pixel-scale feedback and hot fragment-shader work without requiring a browser locally.

## Checks

`npm run ci` runs strict TypeScript, Vitest and Vite build without extra dependencies. `crane-yard.test.ts` guards the four-storey open tower, crane/hoist hierarchy, perimeter fence with road gates, cargo and scene meshes. `world.test.ts` covers determinism, seed differentiation, POI land/clearance, network continuity and slope limits, plot grading, spawn/relic safety and variety, monotonic tides, scene creation without the DOM, and an initialized headless Rapier dropped-ball collision against the generated terrain.
