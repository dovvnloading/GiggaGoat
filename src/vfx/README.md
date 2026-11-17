# VFX lane · Running Dust Puffs

The top-left **RUNNING DUST PUFFS** panel of the approved
[`23_vfx_sheet.png`](../../docs/art/hifi/23_vfx_sheet.png) is the *only*
effect implemented here. It uses soft, overlapping warm apricot / cream cloud
lobes, smaller trailing chips, a small-to-large swell and a quick fade. This
directory does not touch any other lane, game physics or the main game loop.

## Call from gameplay

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

## Production art-review lab

`/src/vfx/lab/index.html` works under `npm run dev` and in the **production
Vite build / GitHub Pages**. The repo's existing lab-page discovery in
`vite.config.ts` includes it automatically. The lab includes a running
Three.js goat, a studio floor, burst/pause/direction/speed controls, and a
side-by-side crop of the *existing* approved reference sheet (bundled by Vite
from `docs/art/hifi`).

## Art-direction self-review

- **Matches:** rounded overlapping cream-and-peach lobes, shaded golden
  undersides, a small dust footfall building into a taller clustered cloud,
  irregular trailing golden specks and a very short airy lifetime.
- **Intentional approximation:** the reference is a hand-painted 2D
  illustration. A camera-facing sprite approximation preserves the rounded
  silhouette and warm color range in a moving 3D game but does not recreate
  illustrated brushwork, exact lobe outlines or the sheet's 2D ground smear.
- **Scope boundary:** no integration into `src/core/` and no other eight VFX
  panels; the owning gameplay system will call `emit` on real footfalls.
