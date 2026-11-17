# VFX lane · Running Dust Puffs + Landing Impact Ring + Headbutt Impact Stars + Water Splash

The top-left **RUNNING DUST PUFFS** and adjacent **LANDING IMPACT RING** panels
of the approved [`23_vfx_sheet.png`](../../docs/art/hifi/23_vfx_sheet.png)
are the first two effects implemented here. Dust uses soft, overlapping warm apricot /
cream lobes and trailing chips. Landing creates a cream-to-gold expanding
ground ellipse, jagged golden impact spikes, and small airborne sandstone
chips. The third **HEADBUTT IMPACT STARS** panel is implemented as a bright collision flash that expands into a sharp golden burst, then three orange-rimmed yellow stars and tiny trailing glints. The fourth **WATER SPLASH** panel adds a blue surface ripple, rising cyan crown jets and ejected teardrop droplets. All five effects stay inside this VFX lane and never drive physics or the main game loop.

## Running dust · call from gameplay

```ts
import { createRunningDustPuffs } from '../vfx';

const dust = createRunningDustPuffs({ seed: 42, capacity: 128 });
scene.add(dust.group);

// When a running hoof touches down (ground point in world coordinates):
dust.emit(hoofContactPosition, goatForwardWorldDirection);

// Once per render frame; pass elapsed **seconds**:
dust.update(dt);

// When unloading the owning scene:
dust.dispose();
```

`position` and `direction` accept `THREE.Vector3` or plain `{x,y,z}`
objects. The direction is **where the goat travels** (dust trails opposite),
projected onto XZ; Y is up. Zero heading uses +X. Supply actual ground
contact, not torso height. Emit on footfalls (about 7–9 per second while
sprinting) rather than calling on *every* rendered frame. One call generates
eight soft puffs and six flying flecks. `update` expands, lifts and fades
them within ~0.9s; `clear()` resets without allocating; `dispose()` frees
all pool materials and the two procedurally generated textures.

The bounded pool has no per-frame GPU allocations. The implementation uses
Three's existing `Sprite`, `SpriteMaterial` and `DataTexture`, with
no image downloads, DOM canvas, extra packages, WebGL renderer ownership,
physics impulses or global listeners. The separate pure `dustMath.ts` is
deterministically tested in Node/Vitest; `runningDust.test.ts` also checks
the real Three scene-graph lifecycle without WebGL.

## Landing impact ring · call from gameplay

```ts
import { createLandingImpactRing } from '../vfx';

const landing = createLandingImpactRing({ capacity: 12 });
scene.add(landing.group);

// When the goat lands: a world-space ground contact and a non-negative impact strength.
landing.emit(landingContactPosition, 1.5);
landing.update(dt);  // call every frame with elapsed seconds
landing.clear();     // optional: reset without releasing GPU resources
landing.dispose();   // on scene teardown
```

`position` accepts `THREE.Vector3` or a plain `{x,y,z}` object and is a
ground contact with +Y up. `strength=0` intentionally does nothing; finite
positive strengths increase ring radius, debris lift and lifetime, capped at
4 for visual safety. Negative/non-finite strengths or coordinates are rejected.
The three-phase animation lasts roughly 0.4–0.6 seconds: narrow ivory ellipse,
widening golden halo with jagged spikes, then quick fade. Eight deterministic
pebble chips move outward/up on a short arc. Multiple impacts overlap within
the fixed capacity; the oldest is recycled when full.

The procedural glow texture, meshes, geometry and materials are allocated
once, without canvas, image downloads, physics, or per-frame GPU allocations.
`landingRingMath.ts` is pure, absolute-age sampled motion logic; the Vitest
suite also exercises the actual Three.js scene-graph lifecycle without WebGL.

## Headbutt impact stars · call from gameplay

```ts
import { createHeadbuttImpactStars } from '../vfx';

const headbutt = createHeadbuttImpactStars({ capacity: 12 });
scene.add(headbutt.group);

// At a goat-head / obstacle contact (world position, travel direction, power):
headbutt.emit(headContactPosition, goatForwardWorldDirection, 1.5);
headbutt.update(dt);  // elapsed seconds; call once per frame
headbutt.clear();     // optional reuse without deallocating
headbutt.dispose();   // on owning scene teardown
```

`position` and `direction` accept `THREE.Vector3` or plain `{x,y,z}`
values. Supply the actual **head collision contact point**, not the goat's
feet: +Y is up, travel direction is projected onto XZ, and a zero-length
horizontal direction defaults to +X. Non-finite coordinates/direction and
negative/non-finite `power` are rejected; `power=0` does nothing; positive
power is capped at 4 to protect readability. Stronger impacts enlarge the
burst, widen the star scatter and slightly extend the lifetime (~0.48–0.61s).

The no-per-frame-GPU-allocation Three.js effect reuses a bounded sprite pool
(oldest burst recycled when full), shares two procedurally generated
`DataTexture` images, and owns no WebGL renderer, canvas, downloaded art,
physics or global listeners. `headbuttMath.ts` provides deterministic,
absolute-time flash and star sampling, with Vitest tests for validation,
directionality, phase progression and real scene-graph lifecycle.

## Water splash · call from gameplay

```ts
import { createWaterSplash } from '../vfx';

const water = createWaterSplash({ capacity: 12 });
scene.add(water.group);

// When the goat breaks a water surface (+Y up, XZ horizontal):
water.emit(waterSurfaceContactPosition, entrySpeed, relativeMass);
water.update(dt); // elapsed seconds per render frame
water.clear();    // optional: reuse all pooled resources
water.dispose();  // when the scene unloads
```

`position` is a water **surface contact**, not the goat's torso, and accepts
`THREE.Vector3` or plain `{x,y,z}`. `speed` is entry speed in world units
per second (not a direction); `mass` is a relative visual scale (1 ≈ a
goat-sized body). Both must be finite and non-negative. Zero speed or zero mass
intentionally emits nothing. Speed is capped at 16 and mass at 8 for readable,
bounded effects; larger speed lifts jets and droplets higher, larger mass spreads
the crown and ripple wider. Non-finite coordinates or inputs are rejected.

Three absolute-age stages (~0.6–0.8s) follow the approved fourth panel:
a thin blue/white concentric ellipse, a smaller low icy-blue crown, then a
broad curl of 12 tapered cyan jets with pale centers and dark azure edges,
12 glossy airborne teardrops, a foamy inner pool and quick fade. The rings
lie on XZ so they appear elliptical from a gameplay camera. The whole effect
uses bounded, reusable scene-graph slots (oldest recycled when full), shares
procedural `DataTexture` art, and allocates no GPU objects per update.
No renderer, canvas, downloads, physics, global listeners or new dependencies
are owned by the VFX. `waterSplashMath.ts` is pure and deterministically tested;
the Vitest suite also covers the actual Three.js scene graph without WebGL.

## Crate break debris · call from gameplay

```ts
import { createCrateBreakDebris } from '../vfx';

const crates = createCrateBreakDebris({ capacity: 10 });
scene.add(crates.group);

// When a crate is destroyed: bottom-center ground position, direction of the
// incoming impact, and the crate's side length in world units.
crates.emit(crateBottomCenter, incomingImpactDirection, crateSize);
crates.update(dt); // elapsed seconds per render frame
crates.clear();    // optional reset without reallocating
crates.dispose();  // owning scene teardown
```

`position` and `direction` accept `THREE.Vector3` or plain `{x,y,z}` values;
+Y is up, XZ is the ground plane. Provide the crate **base center** (not its
midpoint). The incoming impact direction is projected onto XZ; a vertical or
zero heading falls back to +X. `crateSize` is a side length in world units,
not an impact strength. It must be finite and non-negative; zero emits nothing
and values above 3 are capped to protect visual readability. All coordinates
and direction components must be finite.

The approved fifth-panel progression is an orange/amber wooden crate with
distinct vertical slats and four grey riveted corners, dark Y-shaped cracks,
an ivory-centered gold collision star, seven long wooden boards tumbling
outward, eleven smaller angular wood chips and five warm apricot dust lobes.
The impact direction biases the fragment fan, while crate size uniformly
scales the visible dimensions and scattering distance. Pieces follow
deterministic, gravity-like arcs with a ground clamp, fade, and clear by
~0.9–1.1 seconds; no physics impulses are applied. Oldest bursts are recycled
when the fixed pool is full.

`crateDebrisMath.ts` has pure, absolute-age sampling and Vitest coverage for
validation, stage order, direction, scale, fragment bounds and reproducibility.
`CrateBreakDebris.ts` has no renderer, DOM/canvas, downloaded art, global
listeners, extra packages or per-frame GPU allocation. It owns and disposes
only its preallocated meshes, shared geometries and procedural DataTextures.

## Production art-review lab

`/src/vfx/lab/index.html` works under `npm run dev` and in the **production
Vite build / GitHub Pages**. The repo's existing lab-page discovery in
`vite.config.ts` includes it automatically. The lab includes a running
Three.js goat, a studio floor, dust, landing, headbutt, water and crate triggers, a small
faceted decorative target rock, pause/direction/speed controls, landing
strength, headbutt power, water speed and relative mass sliders, and crops of **all four** approved
panels from the *existing* reference sheet (bundled by Vite from
`docs/art/hifi`). Headbutt hits replay every 2.75 seconds, and paused
single-hit triggering freezes a representative gold-star frame.

## Art-direction self-review

### Running Dust Puffs

- **Matches:** rounded overlapping cream-and-peach lobes, shaded golden
  undersides, a small dust footfall building into a taller clustered cloud,
  irregular trailing golden specks and a very short airy lifetime.
- **Intentional approximation:** the reference is a hand-painted 2D
  illustration. A camera-facing sprite approximation preserves the rounded
  silhouette and warm color range in a moving 3D game but does not recreate
  illustrated brushwork, exact lobe outlines or the sheet's 2D ground smear.
- **Scope boundary:** no integration into `src/core/` and no other eight VFX
  panels; the owning gameplay system will call `emit` on real footfalls.

### Landing Impact Ring

- **Matches:** narrow pale-yellow/ivory first ellipse; rapidly expanding,
  luminous warm-gold outline; an irregular crown of yellow/cream pointed
  tongues rising off its rim; low, outward-flung peach sandstone chips; a
  short peak and fade. The ring lies on the XZ ground plane, so it reads as
  an ellipse from the lab camera, like the reference's three progression poses.
- **Intentional approximation:** the painted panel includes hand-drawn
  perspective flares and loose rubble strokes. Procedural 3D triangles,
  anti-aliased DataTexture glow and tiny tetrahedral chips cannot reproduce
  those brushstroke shapes exactly; their silhouette and color hierarchy
  are preserved. The lab uses the existing sprinting goat as a scale/context
  stand-in rather than editing the character's animations.
- **Scope boundary:** ring is callable via `emit(position, strength)` but is
  deliberately not wired into gameplay physics or any other VFX panel.

### Headbutt Impact Stars

- **Matches:** first a small bright ivory-centered orange/yellow eight-point
  spark; then a much larger sharp many-ray golden impact flare; then three
  separate five-point, bright-yellow stars with thick orange-red rims,
  scattered forwards/up with smaller golden glints and a fast fade.
- **Intentional approximation:** the approved third-panel starbursts and gold
  stars have irregular hand-painted outlines and glowing 2D shading. Soft
  procedural DataTextures plus camera-facing sprites preserve their strong
  silhouettes, warm hue hierarchy and three-stage timing, not the exact
  brushstroke details. The lab's low-poly grey target rock is only a scale
  and collision-context stand-in, not a new gameplay collider.
- **Scope boundary:** effect is triggered at arbitrary contact with
  `emit(position, direction, power)`; no gameplay, character source,
  other VFX panels, or repository files outside `src/vfx/` are modified.

### Water Splash

- **Matches:** thin oval bright-blue water rings, a soft blue water surface,
  a small early splash growing into a broad upright cyan crown with darker
  azure borders and pale icy highlights, outward-curving jets and detached
  shiny blue teardrops that rise/fall before a quick fade.
- **Intentional approximation:** the reference paints sweeping 2D fluid arcs,
  white foam strokes and distorted reflections. Staggered, double-sided
  colored triangle ribbons, ring geometry and anti-aliased procedural sprite
  textures capture the three-stage silhouette and color hierarchy from a
  moving 3D camera, not the individual brushstrokes or fluid simulation.
- **Scope boundary:** `emit(position, speed, mass)` is a standalone visual
  hook. The lab is a cosmetic preview only; no water collision, buoyancy,
  gameplay or other VFX panels were changed.

### Crate Break Debris

- **Matches:** wooden orange-gold planks with darker seams; the squared crate
  silhouette and grey riveted metal corner plates; a bold branching black
  crack before an ivory/yellow burst; several *large* rotating plank pieces,
  much smaller angular splinters and a low, warm dust cloud that disperses
  rapidly. Directional wood spray and size controls are previewable in the lab.
- **Intentional approximation:** the approved panel uses painted irregular
  fracture surfaces, stylized brushstroke sparks and a 2D storyboard. Reused
  shaded cuboids, small tetrahedral chips and procedurally soft sprites retain
  the silhouettes, orange/brown/grey hierarchy and intact→cracked→burst→chips
  timing, not exact hand-painted grain or bespoke broken-end profiles.
- **Scope boundary:** this is cosmetic feedback at
  `emit(crateBottomCenter, impactDirection, crateSize)`, not a persistent
  crate entity. The gameplay caller remains responsible for deleting its
  actual crate and for collisions, loot or physics. No files outside
  `src/vfx/` or other VFX cues were changed.
