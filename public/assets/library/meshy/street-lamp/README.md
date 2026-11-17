# Victorian street lamp (Meshy community, CC0)

- `street-lamp.glb`: black cast-iron lamp post with a glass lantern head, matching the lamps in the Hoofington and Downtown paintings. About 5k triangles, one 1024px WEBP texture (baseColor), about 540 KB.
- Units: metres. 3.2 m tall, base at y=0, centred on X/Z. The lantern is symmetric, so facing does not matter.
- Source: "lamp" by MKHORIZON on Meshy, licence CC0: https://www.meshy.ai/posts/lamp-01a16feb-a816-745e-b34e-a4aa78be53fc
- Reduced from 27.6k triangles in Blender (weld, decimate, 1K texture, matte material).

Use it for every street/park lamp (replaces `kenney/city-kit-roads/light-curved.glb`, a modern highway light). Render it with its texture through instancing (one draw call for all lamps). Do not bake it into vertex colours and do not tint it.
