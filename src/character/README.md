# Character lane · rigged Gigga-Goat

The default `GoatCharacter` displays one of the **three supplied skinned GLBs**.
The original seven-body procedural sculpt remains fully functional and exported
as `LegacyGoatCharacter` (and `createLegacyGoatCharacter`). Only
`src/character/` is changed; the core/physics/gameplay ownership boundary does
not change. No GLBs or dependencies are edited.

## Files and animation

Source assets (and their conventions) are described in
`public/assets/characters/goat/README.md`:

| Variant | Shipped GLB | Look |
| --- | --- | --- |
| `hero` | `goat_hero.glb` | Cream wool, orange scarf |
| `bandana` | `goat_alt_bandana.glb` | Brown patches, blue bandana |
| `bell` | `goat_alt_bell.glb` | Charcoal wool, silver horns, bell |

All six baked clips have identical names in each file: **Idle, Walk, Run,
Jump, Headbutt, Bleat**. They are 30 fps, in-place, with forward at -Z and
hooves at y=0. The mesh is authored for local -Z, but the exported `purebind_armature` root in
all three GLBs includes a 180° Y rotation, which reverses that direction after
loading. `alignRiggedSceneForward` cancels this baked rotation on each cloned
scene (not on the GLB template or physics torso), so the visible nose follows
`forward(yaw)` at every heading while physical pitch and roll remain intact.

`SkeletonUtils.clone` creates one skinned instance per goat;
each instance owns one `AnimationMixer` while model templates and embedded
materials/textures are shared and cached per variant. A failed load leaves the
legacy goat visible and may be retried.

`goatPublicAssetUrl` handles both the Vite dev server and production bundles
with Vite's relative `base: './'`, including a nested lab page or a GitHub
Pages project subpath. It is *not* resolved relative to the current HTML page.

## Compatible game API

```ts
import { createGoatCharacter, LegacyGoatCharacter } from '../character';

const character = createGoatCharacter(game.goat);
scene.add(character.root);
// Once per render frame, after the physics advance:
character.update(dt, stepResult.alpha);
character.play('bleat');
character.play('headbutt', .5);
character.play('jump', 1); // also accepts the legacy 'jump-flip' action
character.mounts.head.add(hatMesh);
character.mounts.neck.add(collarMesh);
character.mounts.back.add(backpackMesh);
const worldHat = character.mountWorldPosition('head');
character.dispose();
```

The class retains `constructor(goat?)`, `createGoatCharacter(goat?)`,
`root`, `update(dt, alpha?)`, `play(action, seconds?)`,
`setPreview(action, tier)`, `seek(seconds)`, `bind(goatOrNull)`,
`mounts`, `mountWorldPosition(name)`, and `dispose()`, plus read-only
`tier`, `action`, `physics`, `variant`, `isReady`. Calling
`setPreviewClip(clip, tier)` lets the art lab audition **Walk** as well as
the other clips without extending the older nine-pose `ACTIONS` vocabulary.

To force a look, pass a second options argument:
`createGoatCharacter(game.goat, { variant: 'bell' })`.
`{ seed: 'island-42' }` instead gives a reproducible hashed choice. Absent
an override, the goat with ID `player` (or an unbound preview) is the hero;
other goat IDs hash to stable variants. A bound character can be rebound to a
different goat without changing any physics-owned rigid body.

While a GLB loads, `root` *is* the exact legacy seven-part sculpt, so core
integration sees the same root object and mounts without any special handling.
When loaded, the old parts detach and the rig occupies that root. Mount anchor
groups are preserved and reparented to the matching skinned head, neck and
spine/back bones (by name where possible, positional bone fallback otherwise).
World-space mount positions remain available as before.

The GLB is positioned from the **interpolated current torso** transform every
frame (never a cached Rapier body; `resize()` replaces handles). The model's
ground origin is offset by local -0.92 m from the torso center at Billy scale,
then scaled by the exact physics tiers **KID 0.6, BILLY 1, BIG 1.6, GIGGA 3**.
The torso quaternion supplies heading and physical tilt. This renderer never
sets a rigid body transform or advances the physics world.

The normal locomotion actions crossfade from the actual torso horizontal speed:
at 0 m/s Idle=1, at **1.2 m/s Walk=1**, at **3.5 m/s Run=1**; intermediate
weights interpolate and sum to one. Walk and Run time scales track speed relative
to those authored speeds (with a safety clamp), and speed is compensated by the
physics controller's size^.16 speed scale. `Headbutt`, `Bleat` and
`Jump` run as short `LoopOnce`, clamped one-shots. A physical takeoff triggers
Jump automatically; explicit `play` calls can change one-shot duration.
Legacy actions such as `flop`, `tongue-grab`, `wall-climb`, and `glide`
remain accepted, with their closest available rig expression. The legacy
implementation retains all the old procedural expression detail and tests.

## Art lab / self-review

Run `npm run dev` and open `/src/character/lab/index.html`.
The lab shows **bell, hero, bandana** side by side in the order of the provided
`_preview.jpg`. The six clip buttons switch all three rigs together; the
four size buttons use the real physics tiers. Orbit, zoom, and pause work
without affecting the simulation. The original lineup is displayed for
side-by-side visual review. In **real Rapier mode**, the center hero alone binds
to a real goat; WASD, Shift, Space, E, Q, T and 1–4 exercise movement and
one-shot animation. The **Walk circle · nose first** button runs a
1.2 m/s Billy-sized circular preview: x = -r cos(yaw), z = -r sin(yaw),
so the model's -Z axis must lead along the path tangent at every yaw. Pause
or orbit to visually check all directions, then stop the circle to restore
the lineup. The lab is also usable in a built GitHub Pages deployment.

Self-review checklist: check initial loading/fallback, side-by-side ordering,
material colors and silhouettes, all six clips, hooves grounded, size scaling,
bone-mounted cosmetics, one-shots and interpolation in physics mode, and return
to three-variant preview. The supplied GLBs are not changed by this lane.

## Checks

`npm run ci` runs strict TypeScript checking, Vitest and Vite build.
`motion.test.ts` still tests the original sculpt and Rapier event/resize
binding (now via `LegacyGoatCharacter`). `rigged.test.ts` exercises variant
selection, speed blending, action-to-clip mapping and the headless legacy
fallback, plus a four-cardinal-yaw forward-alignment test using the actual
exported armature-root rotations in each checked-in GLB. The existing
`src/core` tests remain untouched.
