# Art blockout scripts (Blender 5.2, headless)

These scripts produce the layout blockouts in `docs/art/NN_*.jpg`. They are coordinator tooling, not game code.

```bash
blender -b --factory-startup --python tools/art-blockout/s09_pois.py
```

`gg.py` holds materials, primitives, staging and the palette; `goat2.py` the goat; `props.py` and `env.py` the props
and environment builders. Hi-fi images in `docs/art/hifi/` were repainted from these blockouts with ChatGPT image generation.
