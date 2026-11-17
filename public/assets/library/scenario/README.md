# Scenario 3D collection picks (CC BY 4.0, credit "Scenario")

18 AI-generated models picked from the NVIDIA / Scenario Hugging Face release
[scenario-labs/3d-collection](https://huggingface.co/datasets/scenario-labs/3d-collection)
(licence CC BY 4.0, credit "Scenario"; all assets AI-generated). See `_preview.jpg`.

All files were prepared in Blender, so code should load them as-is:
- units are metres at real game scale (the goat is about 1 m long);
- base at y=0, centred on X/Z;
- **front faces glTF +Z** (vehicle noses, cottage doors, phone-box door, duck's face);
- welded, decimated, 1024px WEBP textures, matte materials.

Render them **with their textures** (shared materials + InstancedMesh for repeats). Do **not** push them through the vertex-colour bakers.

| File | Size (W x D x H m) | Tris | Use |
|---|---|---|---|
| tree-round-a/b/c.glb | ~5.4 x 3.4 x 6.0-6.5 | 0.6-1.2k | low-poly round trees, island-wide filler (vertex-cheap, ideal for instancing) |
| palm-tree.glb | 6.0 x 5.4 x 6.0 | 2.5k | Baa-ardwalk beach, Lighthouse cove |
| thatched-cottage.glb | 5.4 x 4.6 x 6.0 | 6k | Hoofington / Whispering Pines houses |
| storybook-cottage.glb | 6.6 x 5.2 x 7.0 | 20k | Hoofington hero house (one or two only) |
| log-cabin.glb | 4.7 x 4.7 x 5.0 | 20k | Whispering Pines hero cabin (one only, includes its own porch/fence plinth) |
| red-pickup.glb | 2.0 x 4.4 x 1.9 | 5k | parked in Hoofington driveways / farm |
| tractor.glb | 2.6 x 4.5 x 2.6 | 5k | Hoofington farm field |
| flower-cart.glb | 1.9 x 4.7 x 2.2 | 12k | Downtown / Baa-ardwalk market stall (bicycle at the front) |
| bird-fountain.glb | 1.7 x 1.7 x 1.6 | 8.5k | Downtown plaza centrepiece (scale x1.5 for a big plaza) |
| phone-box.glb | 1.1 x 1.1 x 2.6 | 3k | Downtown street corners |
| cactus-pot.glb | 0.4 x 0.4 x 0.6 | 1.5k | Downtown shop-front planters, window sills |
| ice-cream-truck.glb | 3.4 x 4.0 x 3.0 | 4k | Baa-ardwalk |
| camper-van.glb | 2.3 x 2.8 x 2.4 | 19k | Baa-ardwalk car park |
| rubber-duck.glb | 1.6 x 1.8 x 1.5 | 1.5k | giant pond/harbour duck (Baa-ardwalk, Dam lake), a fun physics prop |
| excavator.glb | 2.2 x 4.7 x 3.5 | 5k | Crane Yard |
| stone-well.glb | 2.1 x 2.1 x 2.5 | 3k | Hoofington village green |
