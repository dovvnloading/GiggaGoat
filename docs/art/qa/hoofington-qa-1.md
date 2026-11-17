# Hoofington visual QA, pass 1 (art lead)

Compared: live World Lab bookmark 08 and the game at spawn (main @ 10c6650) against
`docs/art/hifi/08_poi_hoofington.png`. Severity: A = breaks the painting at a glance, B = clearly wrong,
C = polish.

| # | Sev | Issue | Root cause | Fix (owner) |
|---|---|---|---|---|
| P1 | A | Fences are giant flat orange (game) / grey-beige (Lab) board walls; painting has low white picket fences | Kenney board fence stretched into a 9.2 x 1.85 x 0.35 m collider box, then baked with a cream lerp | Picket fence GLB at true size (about 1 m tall) inside an invisible 1.85 m bounds frame; white, chunky, pointed pickets (Claude) |
| P2 | A | Mailboxes are person-sized red slabs | 2.2 m tall collider box drives the visual scale | Small mailbox on a post (1.25 m) inside a bounds frame matching the collider (Claude) |
| P3 | A | Red banner bars cross the lamp posts at ground level | Banner placed at ground level (`scatter('banner', ...)`) | Banners hang at 3.4-5 m on the posts, painting-style orange pennants with the goat mark (Claude asset, code lift) |
| P3b | A | Lamps: grey highway lamps; the lantern lamp would stretch to 7.8 m | 0.72 x 7.8 x 0.72 m collider | Lantern lamp variant 4.2 m tall inside a 7.8 m bounds frame (Claude) |
| B2 | A | Shaded walls look dirty grey | Building ramp shade step 88/255 plus dark olive hemisphere ground colour | Lighter, warmer shade (ramp 128) and warmer hemisphere ground colour (Claude) |
| B4 | B | Silo has a red-to-grey vertical smear | Height-based wall/roof lerp still applied to the silo | Silo pre-painted per part, no lerp (Claude) |
| B3 | B | White farmhouse clips into the red barn | Overlapping placements | Move or resize the farmhouse placement (code) |
| P4 | B | Flowers are purple cubes on the grass | Flower model baked to a solid painted block | Flower clusters asset (Claude) |
| E1 | B | Tan rectangle on the road | Unknown decal/plane in the road | Find and remove (code) |
| E2 | B | Clouds are grey-beige lumps | Cloud material colour | White, soft-shaded clouds (Claude) |
| P5 | C | Some trees and bushes are jagged shards | Double-sided alpha-card foliage baked to solid colour | Replace with solid low-poly foliage (Claude) |
| P6 | C | Grass tufts read as noise spikes | Tiny green cones | Remove or soften (Claude) |
| B1 | C | Cream house reads wide and squat | Model choice (type t is wide) | Re-check after lighting fix |
| E3 | C | Gardens are empty compared with the painting | Missing bench, flower beds, garden props in front of houses | Garden dressing pass (Claude) |

Order: P1, P2, P3/P3b, B2, B4, then the B and C items. Each fix gets a render next to the painting crop
before merge and a live check after deploy.
