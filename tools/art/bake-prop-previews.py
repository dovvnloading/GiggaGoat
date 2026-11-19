"""Bake compact, painted first-frame meshes from the same GLBs the island streams."""
import base64
import json
from pathlib import Path
import re
import runpy
import struct
from urllib.parse import unquote

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
districts = json.loads((root / 'district-kit-models.json').read_text())
assets.extend(('district-' + kind, 'assets/library/' + path) for kind, path in districts.items())
dam = 'assets/library/custom/the-dam/the-dam.glb'
assets.extend([('damMasonry', dam), ('damWorks', dam)])
damStone = ('Pier_', 'Dam_Wall', 'Spillway_')
def dam_works(node):
    return not node.startswith((*damStone, 'Water_', 'RailFront_', 'RailBack_', 'Abutment_'))

# A missing external atlas silently turns the original glTF white in trimesh.
# Check all model dependencies before touching the packed output.
for _, path in assets:
    model = Path('public') / path
    raw = model.read_bytes()
    info = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]]) if model.suffix == '.glb' else json.loads(raw)
    for reference in [*info.get('images', []), *info.get('buffers', [])]:
        uri = reference.get('uri')
        if uri and not uri.startswith('data:') and not (model.parent / unquote(uri)).is_file():
            raise FileNotFoundError(f'{model}: {uri}')

library = {}
for kind, path in assets:
    include = (lambda node: node.startswith(damStone)) if kind == 'damMasonry' else dam_works if kind == 'damWorks' else None
    mesh = bake(Path('public') / path, graphics='two-sided' if kind.startswith('district-') else True, include=include)
    coords, indices = mesh['vertices'], mesh['indices']
    # Each record has vertex/face counts, native frame, signed xyz, then indexed triangles with RGB.
    data = bytearray(struct.pack('<HH4f', len(coords) // 3, len(indices) // 3, *mesh['frame']))
    data.extend(struct.pack('<' + 'h' * len(coords), *coords))
    for face, paint in enumerate(mesh['paint']):
        rgb = mesh['palette'][paint]
        data.extend(struct.pack('<HHHBBB', *indices[face*3:face*3+3], rgb >> 16, (rgb >> 8) & 255, rgb & 255))
    library[kind] = base64.b64encode(data).decode()
(root / 'prop-kit-previews.json').write_text(json.dumps(library, separators=(',', ':')) + '\n')
print(f'{len(library)} painted kit previews')
