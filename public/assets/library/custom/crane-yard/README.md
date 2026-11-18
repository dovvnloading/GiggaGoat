# Tower crane set (art lead, Blender, flat materials)

Replaces the stretched Kenney factory gantry crane (which read as a giant tan "figure" next to Downtown)
and the flat beams that floated as black bars over Crane Yard. Each file is built at the exact size of its
gameplay collider box (glTF X = length, Y = up, Z = depth), so the fit-to-box stretch is ~1x.
Yellow #f5c518 / #dba614, dark steel #3b3f46, glass #9fd0f0, red #e5483a, concrete #bdb6aa.
Render with the models' own colours (no tint).

| File | Collider (X x Y x Z m) | Used for |
|---|---|---|
| crane-mast.glb | 3.35 x 40.5 x 3.35 | kind `crane` (tower mast, square lattice, concrete foot) |
| crane-jib.glb | 78 x 3.1 x 3.25 | kind `crane-jib` (triangular lattice truss) |
| crane-cab.glb | 5.2 x 3.7 x 4.1 | kind `crane-cab` (glazed operator cab) |
| crane-cable.glb | 0.17 x 11.65 x 0.17 | kind `crane-cable` (steel cable, anchor frame) |
| red-girder.glb | 21.5 x 1.5 x 1.65 | kind `red-girder` (red I-beam, anchor frame) |
| skyline-tower-crane.glb | 19 x 22 x 8 | Downtown `skylineCrane` (complete tower crane: mast, jib, counter-jib, cab, hook) |

## Site props (island QA CY-2 to CY-8)

Replace the stretched Kenney statue columns, zero-thickness floor planes, construction fences/barriers
used as rails and fences, pirate flag, holiday lights and factory pipe. Built at (or within ~1.5x of) their
gameplay boxes, palette from painting 10: concrete #bab4aa / #cdc7bc / #9c968c, rebar #8a4f32,
yellow #f5c518, galvanised #9aa3ab, pennants red/yellow/blue/green/orange/purple, banner #f07f2c.

| File | Built at (X x Y x Z m) | Used for |
|---|---|---|
| concrete-column.glb | 1.65 x 27.5 x 1.65 | kind `concrete-column` (chamfered column, haunch collars at slab heights 4.5/10.7/16.9/23.1, rebar stubs) |
| concrete-slab.glb | 29 x 1.15 x 26 | kind `concrete-slab` (slab with real thickness, edge beam, light top; also the scaffold decks and crane pad) |
| chain-fence.glb | 8 x 2.85 x 0.18 | kind `chain-fence` (galvanised posts and rails, two-sided diamond mesh, no alpha) |
| safety-rail.glb | 20 x 1.25 x 0.18 | kind `safety-rail` (yellow posts, top and mid rail, toe board; 13.1-28 m runs) |
| site-barrier.glb | 4.3 x 1.65 x 0.9 | kind `site-barrier` (white jersey barrier, red diagonal stripes both faces; QA pass 3 CY-17: stripes now 0.02 m proud with outward normals, so single-sided baked materials no longer cull them) |
| pipe-stack.glb | 6 x 4.2 x 6.2 | kind `pipe-stack` (3 + 2 hollow concrete pipes on timber skids) |
| yard-scaffold.glb | 7 x 20 x 6 | kind `yard-scaffold` (yellow tube scaffold, 3 x 2 bays, braces, toe boards, ladder; slots 4.6x22.7x9.3 and 10.5x17.6x3.2) |
| bunting.glb | 21.4 x 1.9 x 0.2 | kind `bunting` (sagging rope, 22 two-sided pennants; Crane Yard 20x1.4 and Baa-ardwalk 22.8x2.4) |
| site-banner.glb | 4 x 3.2 x 0.15 | Crane Yard site banner (orange cloth, cream cloven hoof print) — needs its own kind; `flag` is also the 9 m peak flagpoles |
| container.glb | 12.2 x 3.2 x 3.0 | kind `container` (corrugated 40 ft box painted near-white so the per-descriptor colour tints it blue/red; frame, door bars) |

All render with their own colours (no tint), except `container`, which expects its descriptor colour
applied at full strength.
