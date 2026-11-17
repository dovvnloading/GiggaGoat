# Hoofington props at true scale (art lead, Blender)

Built for `docs/art/qa/hoofington-qa-1.md` (P1, P2). Each GLB contains the visible prop at real size plus
two invisible zero-area anchor triangles at the corners of its gameplay collider box, so the game's
fit-to-collider stretch leaves the prop's real proportions intact. Flat materials, no textures; render with
the model's own colours (no repaint).

| File | Collider frame (W x H x D) | Visible prop |
|---|---|---|
| picket-fence.glb | 9.2 x 1.85 x 0.35 m | white picket fence, 1.05 m tall, pointed pickets, two rails, five posts (#f7f3ea) |
| flowers-pink.glb / flowers-purple.glb / flowers-sunny.glb | 0.65 x 0.72 x 0.65 m | chunky flower clump: leafy mound with nine 5-petal blooms (pink/white, purple/lilac/white, yellow/orange/white), see `_flowers_preview.jpg`; replaces the purple-cube flowers (QA P4) |
| silo.glb | (native, fit to collider) | Quaternius CC0 silo painted per part: cream body #f6efe3, terracotta dome #d65a43, wood ladder (QA B4: no repaint) |
| windmill.glb | (native, fit to collider) | Quaternius CC0 windmill painted per part: white plaster tower #f3eee6, terracotta cap and balcony #d65a43, wood sails #c89a63 |
| tree-round-a/b/c.glb | (native ~6 x 6 x 6 m, fit to collider) | painting-style round tree: brown trunk, puffy two-tone canopy of solid blobs, no alpha leaf cards (QA P5) |
| bush-round-a/b.glb | (native ~1.8 x 1.8 x 1.1 m) | puffy solid bush, three greens |
| mailbox.glb | 1.3 x 2.2 x 1.0 m | red US mailbox (#e4473a) on a 1 m wood post, yellow flag; door faces glTF +Z |

The street lamp (`../../usdcraft/street-lamp-lantern.glb`) uses the same method: 4.2 m lantern lamp with an
orange hoof-mark pennant (#f28a2e) inside a 0.72 x 7.8 x 0.72 m frame.
