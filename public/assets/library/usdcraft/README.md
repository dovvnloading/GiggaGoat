# NVIDIA USDCraft-10K picks (Apache-2.0)

Models converted from [nvidia/USDCraft-10K](https://huggingface.co/datasets/nvidia/USDCraft-10K)
(Apache-2.0, NVIDIA): 10,000 programmatically modelled, flat-coloured objects. The full dataset is kept
outside the repo; only prepared picks live here.

Every file here was converted from USD in Blender: collision meshes removed, parts joined, welded,
reduced, metres at game scale, base at y=0, centred on X/Z, flat named materials (no textures), matte.

| File | Source | Size (W x D x H m) | Tris | Use |
|---|---|---|---|---|
| street-lamp-lantern.glb | ds_R500_03 | visible 4.2 m lamp + orange hoof pennant inside an invisible 0.72 x 7.8 x 0.72 m collider frame (anchor triangles) | 3k | every street/park lamp in Hoofington, Downtown and the Baa-ardwalk; black cast iron with warm glowing lantern glass (emissive), matching the paintings |

Render with the GLB's own materials through InstancedMesh (one draw call for all lamps). Do not bake to vertex colours or tint.
