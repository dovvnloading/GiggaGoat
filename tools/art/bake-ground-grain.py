"""Pack the four shipped Kenney surface tiles into one linear, repeating texture."""
import base64
import json
from pathlib import Path
from PIL import Image, ImageStat

tiles = Path('public/assets/library/kenney/retro-urban-kit/Textures')
channels = []
for name in ('grass', 'dirt', 'rock', 'concrete'):
    image = Image.open(tiles / (name + '.png')).convert('L')
    assert image.size == (64, 64)
    mean = ImageStat.Stat(image).mean[0]
    channels.append(image.point(lambda value: max(0, min(255, round(128 + 2 * (value - mean))))))
packed = Image.merge('RGBA', channels)
Path('src/world/ground-kit-grain.json').write_text(json.dumps(base64.b64encode(packed.tobytes()).decode()) + '\n')
