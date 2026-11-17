# Character lane · the real Gigga-Goat

Procedural, art-directed, **rigid-body-bound Three.js sculpt** for the approved
[goat model sheet](../../docs/art/hifi/21_goat_model_sheet.png) and
[key art](../../docs/art/hifi/07_key_art.png). This directory is independent
of core, gameplay, world and audio. Only type-level imports of the physics lane
are used by the renderer. No new packages, asset downloads or external textures.

## Game integration API

When the **core team** replaces the provisional seven-shape render code in
GameView, it should use the existing physics instance; do not construct a second
goat or mutate the simulation:

    import { createGoatCharacter } from '../character';

    const character = createGoatCharacter(game.goat);
    scene.add(character.root); // unscaled, at the Three world origin

    // After game.advance(dt, intent), before renderer.render():
    character.update(dt, stepResult.alpha);

    // Trigger non-event visual expression at the same point the
    // matching gameplay action is accepted:
    character.play('bleat');
    character.play('headbutt', .5);
    // If a later gameplay ability allows air-gliding:
    character.play('glide', 1.5);

    // Attach cosmetic meshes without hardcoded skull offsets:
    character.mounts.head.add(hatMesh);
    character.mounts.neck.add(collarMesh);
    character.mounts.back.add(backpackMesh);
    const hatWorldPosition = character.mountWorldPosition('head');

    // Dispose the art before disposing the Rapier physics world:
    character.dispose();

The constructor accepts an optional GoatRagdoll. The bind(goat) method
switches to physics mode; bind(null) switches to independent preview mode.
update(dt, alpha?) reads **all seven** interpolated Rapier part transforms
every render frame. It does not call PhysicsWorld.step(), set transforms,
teleport bodies or change locomotion. It obtains each rigid body again every
frame, including after goat.resize() destroys and replaces handles.

**Important scope boundary:** The existing GameView under src/core still
renders a provisional placeholder. The character is fully implemented here,
but does *not* silently install itself into src/core: that would violate the
lane boundary. The core team can make the above replacement. Running the
character lab already displays the actual new sculpt.

### API index

| API | Description |
| --- | --- |
| new GoatCharacter(goat?) / createGoatCharacter(goat) | Build all geometry and optional binding |
| character.root | World-space Three Group with the seven body visuals |
| character.update(dt, alpha?) | Render frame, interpolated physics and secondary animation; returns MotionFrame |
| character.play(action, seconds?) | A short *visual* override for bleat, headbutt, glide, etc |
| character.setPreview(action, tier) | Art-only composition (unbind first) |
| character.seek(seconds) | Deterministic art screenshots |
| character.bind(goatOrNull) | Subscribe to landing/impact/ragdoll events or unbind |
| character.mounts.head/neck/back | Tier-scaled costume anchor groups |
| character.mountWorldPosition(name) | Anchor position with all world transforms applied |
| character.tier, character.action, character.physics | Read-only current presentation state |
| character.dispose() | Unsubscribe, free self-owned geometry/materials, detach root |

Actions: **stand, sprint, jump-flip, headbutt, tongue-grab, bleat, flop,
wall-climb, glide**. All nine are present in the approved action-pose panel
(or stand in the turnaround), and each is rendered in the art lab. Tiers:
**KID = 0.6**, **BILLY = 1**, **BIG = 1.6**, **GIGGA = 3**, exactly matching
the physics GoatRagdoll scale. GIGGA has a further **1.32× relative horn size**
and violet additive aura/light.

## What is animated, and by whom

- The *seven* Rapier body transforms, leg hinges, landings, wall cling and
  actual tongue attachments are **authoritative**. This lane consumes them.
- Fleece squash/stretch on the torso is purely cosmetic, with an exponentially
  decaying landing/impact envelope. It does not shorten colliders.
- The floppy ears, fluffy tail and the deforming two-piece orange scarf animate
  independently (plus gold embroidery and tassels); horn size responds to
  tier changes without rebuilding rigid bodies.
- Eyebrows convey angry headbutt, wide-eyed bleat and dozy flop; a deterministic
  automatic blink covers the gold irises and horizontally shaped black pupils.
  Jaw opens for bleat, sprint and tongue-grab; pink tongue extends to an
  actual attached Rapier body's position, or to a preview target.
- For a *glide* expression, a lightweight cosmetic hang-glider appears on
  the **back mount**. It creates no flight physics or collision hull.
- The neck, ears, head, torso and each leg are separate Three groups. Avoid
  modifying their transforms from another system while physics-bound;
  attach cosmetics under the named mounts instead.

The body consists of layered cream ellipsoids with offset pointed fleece
locks; front and back cloven dark hooves; a lifted tuft tail; a broad
muzzle/nostrils; cheek, beard, forelock and soft pink inner ears; two **tapered
full 3D curled ram horns with growth rings**; and a thick scarf with wind-swept
fabric ribbons. Materials are toon-shaded and rimmed by inverted-hull ink
silhouettes, with directional light/shadows and no textures to load.

## Visual lab

Run npm run dev and open **/src/character/lab/index.html**.

The left panel selects **every pose × every tier**; orbit/zoom/pause the new
rendered goat in the middle while the actual approved **model sheet and key art**
appear at right. The scene includes an action-relevant rock, crate, wall or
glider. Click **Enter real Rapier mode** for the physics-driven seven-body
character on a physical ground with a crate; WASD, Shift, Space, Q, E and T
exercise real locomotion, flip, flop, bleat and tether. **1–4** changes size.
In this mode the stage displays real interpolated bodies; pose buttons trigger
appropriate real actions, or visual-only accents when physics provides no
separate animation event. The art-only preview remains deliberately distinct.

## Tests and resource ownership

Run npm run ci. motion.test.ts tests pure deterministic tier mapping,
action precedence, expression frames, landing-envelope decay and preview
transforms, then exercises the sculpt and a real Rapier resize/binding without
DOM or WebGL. Materials and geometry are owned and freed by the character,
as is its event subscription. It never disposes the supplied GoatRagdoll or
PhysicsWorld.

## Art-direction self-review / limitations

The approved images are detailed stylized illustrations, not supplied 3D mesh
assets or rigged animation clips. This geometry approximates the silhouette
in real time: **bulky cream fleece, enormous tan curls, gold horizontal-pupil
eyes, pastel muzzle, beard, floppy ears, short legs, split hooves, saturated
orange scarf**. The shader uses light-facing bands and dark silhouettes, not
hand-painted subsurface scattering or individual rendered strands. The lab
exists to make side-by-side discrepancies visible. The pure lab jump flip,
headbutt and hang-glide compositions are *presentation poses*; physical mode
never fakes Rapier joint orientations for those effects. No new gameplay
flight ability or gear-collision physics is claimed here.
