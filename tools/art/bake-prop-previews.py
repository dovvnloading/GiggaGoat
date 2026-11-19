"""Bake compact, painted first-frame meshes from the same GLBs the island streams."""
import base64
import json
from pathlib import Path
import re
import runpy
import struct

bake = runpy.run_path(str(Path(__file__).with_name('bake-district-collision.py')))['bake']
root = Path('src/world')
catalog = (root / 'library-props.ts').read_text().split('as const satisfies')[0]
assets = re.findall(r"'([\w-]+)':\s*'(assets/library/[^']+\.glb)'", catalog)
# These set pieces are shipped directly in the scene bundle. Preserve their full mesh.
scenery = {
    'grassClump': 'custom/hoofington-props/grass-clump',
    'meadowFlower': 'kenney/nature-kit/flower_yellowA',
    'keeperDock': 'kenney/pirate-kit/structure-platform-dock',
    'wreckMast': 'kenney/pirate-kit/mast-ropes',
    'tender': 'kenney/watercraft-kit/boat-row-small',
    'pierLantern': 'kenney/fantasy-town-kit/lantern',
}
assets.extend((kind, 'assets/library/' + path + '.glb') for kind, path in scenery.items())
library = {}
for kind, path in assets:
    mesh = bake(Path('public') / path, face_budget=65534 if kind in scenery or kind == 'shipwreck' else 640)
    coords, indices = mesh['vertices'], mesh['indices']
    # Each record has vertex/face counts, signed xyz, then indexed triangles with RGB.
    data = bytearray(struct.pack('<HH', len(coords) // 3, len(indices) // 3))
    data.extend(struct.pack('<' + 'h' * len(coords), *coords))
    for face, paint in enumerate(mesh['paint']):
        rgb = mesh['palette'][paint]
        data.extend(struct.pack('<HHHBBB', *indices[face*3:face*3+3], rgb >> 16, (rgb >> 8) & 255, rgb & 255))
    library[kind] = base64.b64encode(data).decode()
(root / 'prop-kit-previews.json').write_text(json.dumps(library, separators=(',', ':')) + '\n')
print(f'{len(library)} painted kit previews')
