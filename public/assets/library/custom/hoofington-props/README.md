# Hoofington props at true scale (art lead, Blender)

Built for `docs/art/qa/hoofington-qa-1.md` (P1, P2). Each GLB contains the visible prop at real size plus
two invisible zero-area anchor triangles at the corners of its gameplay collider box, so the game's
fit-to-collider stretch leaves the prop's real proportions intact. Flat materials, no textures; render with
the model's own colours (no repaint).

| File | Collider frame (W x H x D) | Visible prop |
|---|---|---|
| picket-fence.glb | 9.2 x 1.85 x 0.35 m | white picket fence, 1.05 m tall, pointed pickets, two rails, five posts (#f7f3ea) |
| flowers-pink.glb / flowers-purple.glb / flowers-sunny.glb | 0.65 x 0.72 x 0.65 m | chunky flower clump: leafy mound with nine 5-petal blooms (pink/white, purple/lilac/white, yellow/orange/white), see `_flowers_preview.jpg`; replaces the purple-cube flowers (QA P4) |
| mailbox.glb | 1.3 x 2.2 x 1.0 m | red US mailbox (#e4473a) on a 1 m wood post, yellow flag; door faces glTF +Z |

The street lamp (`../../usdcraft/street-lamp-lantern.glb`) uses the same method: 4.2 m lantern lamp with an
orange hoof-mark pennant (#f28a2e) inside a 0.72 x 7.8 x 0.72 m frame.
