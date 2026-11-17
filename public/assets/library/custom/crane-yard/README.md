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
