"""Gigga-Goat reference-art toolkit for Blender (headless). Stylised low-poly toon look."""
import bpy, bmesh, math, random
from mathutils import Vector, Euler

OUT = __import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "..", "..", "docs", "art")

PAL = {
    'sky': (0.56, 0.83, 1.0), 'sky_h': (0.96, 0.92, 0.80),
    'grass': (0.47, 0.72, 0.33), 'grass2': (0.38, 0.62, 0.28), 'dirt': (0.66, 0.50, 0.33),
    'sand': (0.97, 0.86, 0.60), 'sea': (0.13, 0.66, 0.78), 'deep': (0.06, 0.40, 0.62),
    'rock': (0.55, 0.57, 0.62), 'rock2': (0.42, 0.44, 0.50), 'snow': (0.96, 0.97, 1.0),
    'hay': (0.95, 0.76, 0.31), 'wood': (0.63, 0.44, 0.24), 'wood2': (0.48, 0.32, 0.18),
    'barn': (0.85, 0.31, 0.24), 'roof': (0.30, 0.33, 0.45), 'white': (0.96, 0.95, 0.91),
    'fur': (0.98, 0.93, 0.84), 'fur2': (0.86, 0.78, 0.66), 'horn': (0.80, 0.62, 0.36),
    'hoof': (0.20, 0.17, 0.16), 'nose': (0.35, 0.22, 0.22), 'black': (0.03, 0.03, 0.04),
    'pink': (0.98, 0.50, 0.62), 'tongue': (0.95, 0.38, 0.50),
    'gigga': (0.48, 0.30, 1.0), 'orange': (1.0, 0.54, 0.12), 'teal': (0.10, 0.85, 0.70),
    'yellow': (1.0, 0.85, 0.20), 'scrap': (0.55, 0.60, 0.62), 'leaf': (0.25, 0.60, 0.25),
    'leaf2': (0.45, 0.72, 0.22), 'pine': (0.12, 0.42, 0.28), 'concrete': (0.78, 0.78, 0.76),
    'asphalt': (0.28, 0.29, 0.32), 'glass': (0.60, 0.85, 0.95), 'cream': (1.0, 0.96, 0.86),
    'blue': (0.20, 0.45, 0.95), 'red': (0.92, 0.22, 0.20), 'green': (0.20, 0.75, 0.35),
}

_mats = {}

def lin(c):
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

def mat(name, color=None, rough=0.75, emit=0.0, metal=0.0, alpha=1.0):
    key = (name, color, rough, emit, metal, alpha)
    if key in _mats:
        return _mats[key]
    if not isinstance(name, str):
        return name
    c = PAL.get(name, (1, 0, 1)) if color is None else color
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*lin(c), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    try:
        b.inputs['Specular IOR Level'].default_value = 0.5 if rough < 0.3 else 0.15
    except Exception:
        pass
    if emit:
        b.inputs['Emission Color'].default_value = (*lin(c), 1)
        b.inputs['Emission Strength'].default_value = emit
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    _mats[key] = m
    return m

_outline = None
def outline_mat():
    global _outline
    if _outline is None:
        m = bpy.data.materials.new('Outline')
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        o = nt.nodes.new('ShaderNodeOutputMaterial')
        e = nt.nodes.new('ShaderNodeEmission')
        e.inputs['Color'].default_value = (0.02, 0.02, 0.03, 1)
        nt.links.new(e.outputs[0], o.inputs[0])
        m.use_backface_culling = True
        _outline = m
    return _outline

def finish(obj, m, outline=0.035, smooth=False, bevel=0.0, segs=2):
    obj.data.materials.clear()
    obj.data.materials.append(m)
    if bevel:
        bm = obj.modifiers.new('bevel', 'BEVEL'); bm.width = bevel; bm.segments = segs; bm.limit_method = 'ANGLE'
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    if outline:
        obj.data.materials.append(outline_mat())
        s = obj.modifiers.new('outline', 'SOLIDIFY')
        s.thickness = outline; s.offset = 1; s.use_flip_normals = True; s.material_offset = 1
    return obj

def _new(prim, **kw):
    prim(**kw)
    return bpy.context.active_object

def box(name, size, loc, m, rot=(0, 0, 0), bevel=0.04, outline=0.03, parent=None):
    o = _new(bpy.ops.mesh.primitive_cube_add, size=1, location=loc, rotation=rot)
    o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    finish(o, mat(m) if isinstance(m, str) else m, outline, bevel=bevel)
    if parent: o.parent = parent
    return o

def cyl(name, r, h, loc, m, rot=(0, 0, 0), verts=10, outline=0.03, bevel=0.0, r2=None, parent=None):
    if r2 is None:
        o = _new(bpy.ops.mesh.primitive_cylinder_add, radius=r, depth=h, location=loc, rotation=rot, vertices=verts)
    else:
        o = _new(bpy.ops.mesh.primitive_cone_add, radius1=r, radius2=r2, depth=h, location=loc, rotation=rot, vertices=verts)
    o.name = name
    finish(o, mat(m) if isinstance(m, str) else m, outline, bevel=bevel)
    if parent: o.parent = parent
    return o

def ball(name, r, loc, m, scale=(1, 1, 1), sub=2, outline=0.03, smooth=True, parent=None, rot=(0, 0, 0)):
    o = _new(bpy.ops.mesh.primitive_ico_sphere_add, radius=r, location=loc, subdivisions=sub, rotation=rot)
    o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    finish(o, mat(m) if isinstance(m, str) else m, outline, smooth=smooth)
    if parent: o.parent = parent
    return o

def torus(name, R, r, loc, m, rot=(0, 0, 0), outline=0.02, parent=None):
    o = _new(bpy.ops.mesh.primitive_torus_add, major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=24, minor_segments=8)
    o.name = name
    finish(o, mat(m) if isinstance(m, str) else m, outline, smooth=True)
    if parent: o.parent = parent
    return o

def empty(name, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.location = loc; e.rotation_euler = rot; e.scale = (scale, scale, scale)
    return e

def text(s, loc, size=1.0, m='white', rot=(math.radians(90), 0, 0), align='CENTER', extrude=0.05, outline=0.0, parent=None):
    bpy.ops.object.text_add(location=loc, rotation=rot)
    t = bpy.context.active_object
    t.data.body = s; t.data.size = size; t.data.align_x = align; t.data.extrude = extrude
    t.data.materials.append(mat(m) if isinstance(m, str) else m)
    if parent: t.parent = parent
    return t

# ---------------------------------------------------------------- scene
def reset(res=(1600, 900), sky_top=None, sky_bottom=None, strength=1.0):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    global _outline
    _outline = None
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            sc.render.engine = eng; break
        except Exception:
            pass
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 90
    try:
        sc.view_settings.view_transform = 'Standard'
        sc.view_settings.look = 'None'
    except Exception:
        pass
    ee = sc.eevee
    for attr, val in (('taa_render_samples', 48), ('use_shadows', True), ('use_raytracing', False)):
        try: setattr(ee, attr, val)
        except Exception: pass
    w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (*lin(sky_bottom or PAL['sky_h']), 1)
    ramp.color_ramp.elements[1].position = 0.55
    ramp.color_ramp.elements[1].color = (*lin(sky_top or PAL['sky']), 1)
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], ramp.inputs[0])
    # Generated z on world goes -1..1 over direction; remap
    mp = nt.nodes.new('ShaderNodeMapRange'); mp.inputs[1].default_value = -0.05; mp.inputs[2].default_value = 0.6
    nt.links.new(sep.outputs['Z'], mp.inputs[0]); nt.links.new(mp.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], bg.inputs[0])
    bg.inputs[1].default_value = strength
    return sc

def sun(rot=(50, 0, 35), energy=3.2, color=(1.0, 0.96, 0.88), angle=8):
    d = bpy.data.lights.new('Sun', 'SUN'); d.energy = energy; d.color = color
    d.angle = math.radians(angle)
    o = bpy.data.objects.new('Sun', d); bpy.context.collection.objects.link(o)
    o.rotation_euler = [math.radians(a) for a in rot]
    return o

def camera(loc, target, lens=35, ortho=None):
    c = bpy.data.cameras.new('Cam'); c.lens = lens; c.clip_end = 3000
    if ortho:
        c.type = 'ORTHO'; c.ortho_scale = ortho
    o = bpy.data.objects.new('Cam', c); bpy.context.collection.objects.link(o)
    o.location = loc
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = o
    return o

def render(name):
    sc = bpy.context.scene
    sc.render.filepath = f"{OUT}/{name}.jpg"
    bpy.ops.render.render(write_still=True)
    return sc.render.filepath

# ---------------------------------------------------------------- terrain bits
def ground(size=200, m='grass', loc=(0, 0, 0)):
    o = _new(bpy.ops.mesh.primitive_plane_add, size=size, location=loc)
    finish(o, mat(m), 0)
    return o

def hill(name, r, h, loc, m='grass', seed=0, verts=14, rings=6, flat=0.0):
    """Low-poly bumpy hill (cone-ish dome)."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    top = bm.verts.new((0, 0, h))
    rings_v = []
    for i in range(1, rings + 1):
        t = i / rings
        z = h * (1 - t ** 1.6) * (1 - flat) + (h * flat if t < 0.3 and flat else 0)
        ring = []
        for j in range(verts):
            a = 2 * math.pi * j / verts + (i % 2) * math.pi / verts
            rr = r * t * (0.85 + 0.3 * rnd.random())
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), max(0, z + (rnd.random() - 0.5) * h * 0.12 * (1 - t)))))
        rings_v.append(ring)
    for j in range(verts):
        bm.faces.new((top, rings_v[0][j], rings_v[0][(j + 1) % verts]))
    for i in range(rings - 1):
        a, b = rings_v[i], rings_v[i + 1]
        for j in range(verts):
            bm.faces.new((a[j], b[j], b[(j + 1) % verts], a[(j + 1) % verts]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    o.location = loc
    finish(o, mat(m) if isinstance(m, str) else m, 0)
    return o

def water(size=400, loc=(0, 0, 0), m='sea'):
    o = _new(bpy.ops.mesh.primitive_plane_add, size=size, location=loc)
    finish(o, mat(m, rough=0.15), 0)
    return o

def tree(loc, s=1.0, kind='round', seed=0):
    rnd = random.Random(seed)
    x, y, z = loc
    cyl('trunk', 0.25 * s, 2.2 * s, (x, y, z + 1.1 * s), 'wood2', verts=7)
    if kind == 'pine':
        for i, (r, hh) in enumerate(((1.6, 2.2), (1.25, 1.9), (0.85, 1.6))):
            cyl('pine', r * s, hh * s, (x, y, z + (2.2 + i * 1.15) * s), 'pine', verts=8, r2=0.05)
    else:
        c = rnd.choice(['leaf', 'leaf2'])
        ball('crown', 1.4 * s, (x, y, z + 3.0 * s), c, sub=1, smooth=False)
        ball('crown2', 0.95 * s, (x + 0.7 * s, y + 0.3 * s, z + 3.7 * s), c, sub=1, smooth=False)

def rock(loc, s=1.0, seed=0, m='rock'):
    rnd = random.Random(seed)
    o = ball('rock', 1.0 * s, loc, m, scale=(1 + rnd.random() * 0.5, 1 + rnd.random() * 0.4, 0.6 + rnd.random() * 0.4), sub=1, smooth=False)
    o.rotation_euler = (0, 0, rnd.random() * 6)
    return o

def hay_bale(loc, rot=0, s=1.0, round_=False):
    if round_:
        o = cyl('bale', 0.9 * s, 1.2 * s, (loc[0], loc[1], loc[2] + 0.9 * s), 'hay', rot=(math.radians(90), 0, rot), verts=14)
        torus('band', 0.9 * s, 0.04 * s, (loc[0], loc[1], loc[2] + 0.9 * s), 'wood2', rot=(math.radians(90), 0, rot))
        return o
    o = box('bale', (1.4 * s, 0.8 * s, 0.7 * s), (loc[0], loc[1], loc[2] + 0.35 * s), 'hay', rot=(0, 0, rot), bevel=0.08)
    return o

def crate(loc, s=1.0, rot=0, m='wood', label=None):
    o = box('crate', (s, s, s), (loc[0], loc[1], loc[2] + s / 2), m, rot=(0, 0, rot), bevel=0.05)
    for k in (-1, 1):
        box('slat', (s * 1.02, s * 0.12, s * 1.02), (loc[0], loc[1] + k * s * 0.3, loc[2] + s / 2), 'wood2', rot=(0, 0, rot), bevel=0.01, outline=0.0)
    return o

def fence(start, end, h=1.0):
    s, e = Vector(start), Vector(end)
    d = e - s; n = max(1, int(d.length / 2))
    ang = math.atan2(d.y, d.x)
    for i in range(n + 1):
        p = s + d * (i / n)
        box('post', (0.18, 0.18, h * 1.2), (p.x, p.y, p.z + h * 0.6), 'white', bevel=0.02, outline=0.015)
    for z in (0.45, 0.85):
        mid = (s + e) / 2
        box('rail', (d.length, 0.1, 0.12), (mid.x, mid.y, mid.z + z * h), 'white', rot=(0, 0, ang), bevel=0.01, outline=0.015)

def lamp(loc, h=4.5):
    x, y, z = loc
    cyl('pole', 0.09, h, (x, y, z + h / 2), 'roof', verts=8)
    box('arm', (0.9, 0.12, 0.12), (x + 0.4, y, z + h), 'roof', bevel=0.0)
    ball('bulb', 0.25, (x + 0.8, y, z + h - 0.2), mat('lampglow', PAL['cream'], emit=4.0), outline=0.01)

def house(loc, w=6, d=5, h=4, wall='cream', roofm='barn', rot=0, door='wood2', windows=True, flat=False):
    x, y, z = loc
    root = empty('house', loc, (0, 0, rot))
    box('walls', (w, d, h), (0, 0, h / 2), wall, bevel=0.05, parent=root)
    if flat:
        box('roof', (w + 0.4, d + 0.4, 0.4), (0, 0, h + 0.2), roofm, bevel=0.05, parent=root)
        box('parapet', (w + 0.4, 0.2, 0.6), (0, d / 2 + 0.1, h + 0.5), roofm, parent=root, outline=0.015)
    else:
        bm = bmesh.new()
        hw, hd, rh = w / 2 + 0.35, d / 2 + 0.35, h * 0.55
        v = [bm.verts.new(p) for p in ((-hw, -hd, 0), (hw, -hd, 0), (hw, hd, 0), (-hw, hd, 0), (-hw, 0, rh), (hw, 0, rh))]
        bm.faces.new((v[0], v[1], v[5], v[4])); bm.faces.new((v[2], v[3], v[4], v[5]))
        bm.faces.new((v[0], v[4], v[3])); bm.faces.new((v[1], v[2], v[5])); bm.faces.new((v[0], v[3], v[2], v[1]))
        me = bpy.data.meshes.new('roof'); bm.to_mesh(me); bm.free()
        r = bpy.data.objects.new('roof', me); bpy.context.collection.objects.link(r)
        r.location = (0, 0, h); r.parent = root
        finish(r, mat(roofm), 0.03)
    box('door', (1.1, 0.12, 2.0), (0, -d / 2 - 0.02, 1.0), door, parent=root, outline=0.015)
    if windows:
        for k in (-1, 1):
            box('win', (1.0, 0.1, 1.0), (k * w * 0.3, -d / 2 - 0.03, h * 0.62), mat('glass', rough=0.1), parent=root, outline=0.02)
    return root

# ---------------------------------------------------------------- the goat
def goat_v1(loc=(0, 0, 0), rot=0, s=1.0, fur='fur', pose='stand', accent=None, hat=None, tongue=0.0, scarf='orange',
         horns='curl', eye_dir=0.0, pattern=None):
    """Chunky stylised goat. pose: stand|run|headbutt|jump|flop|climb|bleat|glide|sit."""
    root = empty('goat', loc, (0, 0, rot), s)
    body = empty('body', (0, 0, 0)); body.parent = root
    P = {'body_rot': (0, 0, 0), 'body_z': 1.25, 'head': (0, 1.55, 2.15), 'head_rot': (0, 0, 0),
         'legs': [(-0.5, 0.65, 0), (0.5, 0.65, 0), (-0.5, -0.75, 0), (0.5, -0.75, 0)], 'leg_rot': [0, 0, 0, 0]}
    if pose == 'run':
        P['leg_rot'] = [35, -30, -35, 30]; P['body_z'] = 1.35; P['body_rot'] = (math.radians(-6), 0, 0)
    elif pose == 'headbutt':
        P['body_rot'] = (math.radians(12), 0, 0); P['head'] = (0, 1.95, 1.65); P['head_rot'] = (math.radians(35), 0, 0)
        P['leg_rot'] = [-25, -25, 30, 30]
    elif pose == 'jump':
        P['body_z'] = 1.5; P['leg_rot'] = [60, 60, -60, -60]; P['body_rot'] = (math.radians(-15), 0, 0)
    elif pose == 'flop':
        P['body_rot'] = (0, math.radians(100), 0); P['body_z'] = 0.75; P['leg_rot'] = [70, -40, 20, -80]
    elif pose == 'climb':
        P['body_rot'] = (math.radians(-70), 0, 0); P['body_z'] = 1.6; P['leg_rot'] = [-40, 30, 30, -40]
    elif pose == 'bleat':
        P['head_rot'] = (math.radians(-35), 0, 0); P['head'] = (0, 1.5, 2.35)
    elif pose == 'glide':
        P['body_z'] = 1.5; P['leg_rot'] = [-70, -70, 70, 70]
    elif pose == 'sit':
        P['body_rot'] = (math.radians(-20), 0, 0); P['body_z'] = 1.0; P['leg_rot'] = [0, 0, -80, -80]
    body.location = (0, 0, P['body_z']); body.rotation_euler = P['body_rot']
    fm = mat(fur)
    ball('torso', 0.9, (0, -0.05, 0), fm, scale=(0.85, 1.35, 0.85), parent=body)
    if pattern == 'spots':
        for i, (px, py, pz) in enumerate(((0.55, 0.3, 0.35), (-0.5, -0.5, 0.4), (0.3, -0.9, 0.3), (-0.6, 0.6, 0.1))):
            ball('spot', 0.32, (px, py, pz), 'hoof', scale=(0.4, 1, 0.8), parent=body, outline=0)
    elif pattern == 'stripe':
        box('stripe', (0.25, 2.3, 0.2), (0, -0.05, 0.74), accent or 'gigga', parent=body, outline=0, bevel=0.08)
    ball('tail', 0.2, (0, -1.25, 0.45), fm, scale=(0.8, 1.2, 1.4), parent=body)
    # legs
    for i, (lx, ly, lz) in enumerate(P['legs']):
        hip = empty('hip', (lx * 0.95, ly, -0.35)); hip.parent = body
        hip.rotation_euler = (math.radians(P['leg_rot'][i]), 0, 0)
        cyl('leg', 0.19, 0.95, (0, 0, -0.45), fm, verts=8, parent=hip, r2=0.15)
        cyl('hoof', 0.17, 0.25, (0, 0, -1.0), 'hoof', verts=8, parent=hip)
    # neck + head
    hx, hy, hz = P['head']
    neck = cyl('neck', 0.33, 0.9, (0, 1.1, 0.55), fm, rot=(math.radians(-40), 0, 0), verts=8, parent=body, r2=0.28)
    head = empty('head', (hx, hy - 0.0, hz - P['body_z'])); head.parent = body
    head.rotation_euler = P['head_rot']
    ball('skull', 0.55, (0, 0, 0), fm, scale=(0.9, 1.15, 0.85), parent=head)
    ball('snout', 0.38, (0, 0.55, -0.18), fm, scale=(0.85, 1.1, 0.8), parent=head)
    ball('nose', 0.13, (0, 0.92, -0.1), 'nose', scale=(1.4, 0.6, 0.9), parent=head, outline=0.01)
    ball('beard', 0.17, (0, 0.55, -0.62), fm, scale=(0.8, 0.8, 1.6), parent=head)
    # eyes: big whites with horizontal goat pupils
    for k in (-1, 1):
        e = ball('eye', 0.2, (k * 0.36, 0.28, 0.16), 'white', scale=(0.7, 1, 1), parent=head, outline=0.015)
        box('pupil', (0.04, 0.2, 0.07), (k * 0.5, 0.3 + eye_dir, 0.16), 'black', parent=head, bevel=0.02, outline=0)
        ear = ball('ear', 0.2, (k * 0.62, -0.05, 0.12), fm, scale=(2.0, 0.6, 0.5), parent=head)
        ear.rotation_euler = (0, math.radians(k * -25), 0)
    # horns
    hm = mat('horn')
    for k in (-1, 1):
        if horns == 'curl':
            for j in range(6):
                t = j / 5
                a = t * math.radians(250)
                r = 0.42 * (1 - 0.35 * t)
                ball('horn', 0.16 * (1 - 0.55 * t), (k * (0.25 + 0.18 * t), -0.25 - r * math.sin(a) * 0.9, 0.5 + r * (1 - math.cos(a)) * 0.6 - 0.1 * t),
                     hm, parent=head, outline=0.012, sub=1)
        elif horns == 'gigga':
            for j in range(9):
                t = j / 8
                a = t * math.radians(330)
                r = 0.65 * (1 - 0.3 * t)
                ball('horn', 0.22 * (1 - 0.6 * t), (k * (0.3 + 0.35 * t), -0.3 - r * math.sin(a), 0.55 + r * (1 - math.cos(a)) * 0.7),
                     hm, parent=head, outline=0.012, sub=1)
        else:  # spike
            cyl('horn', 0.12, 0.6, (k * 0.25, -0.2, 0.75), hm, rot=(math.radians(-25), math.radians(k * 15), 0), r2=0.02, verts=8, parent=head)
    if tongue > 0:
        cyl('tongue', 0.1, tongue, (0, 0.85 + tongue / 2, -0.35), 'tongue', rot=(math.radians(-90), 0, 0), verts=8, parent=head)
        ball('tip', 0.18, (0, 0.85 + tongue, -0.35), 'tongue', parent=head)
    if scarf:
        torus('scarf', 0.36, 0.11, (0, 1.05, 0.45), scarf, rot=(math.radians(50), 0, 0), parent=body)
        box('scarf_tail', (0.18, 0.08, 0.55), (0.15, 0.85, 0.15), scarf, rot=(math.radians(-20), 0, math.radians(15)), parent=body, outline=0.012)
    if hat == 'cap':
        ball('cap', 0.42, (0, -0.05, 0.45), accent or 'blue', scale=(1, 1, 0.55), parent=head)
        box('brim', (0.6, 0.5, 0.06), (0, 0.4, 0.42), accent or 'blue', parent=head, outline=0.012)
    elif hat == 'crown':
        cyl('crown', 0.3, 0.28, (0, -0.05, 0.65), 'yellow', verts=6, parent=head, r2=0.36)
    elif hat == 'traffic':
        cyl('cone', 0.32, 0.8, (0, -0.05, 0.85), 'orange', verts=10, parent=head, r2=0.03)
    elif hat == 'tophat':
        cyl('top', 0.28, 0.6, (0, -0.05, 0.8), 'black', verts=14, parent=head)
        cyl('brim', 0.45, 0.06, (0, -0.05, 0.52), 'black', verts=14, parent=head)
    elif hat == 'headphones':
        torus('band', 0.55, 0.05, (0, -0.05, 0.25), accent or 'teal', rot=(0, math.radians(90), 0), parent=head)
        for k in (-1, 1):
            cyl('cup', 0.18, 0.14, (k * 0.55, -0.05, 0.15), accent or 'teal', rot=(0, math.radians(90), 0), parent=head)
    elif hat == 'helmet':
        ball('helmet', 0.58, (0, -0.05, 0.12), accent or 'red', scale=(1, 1.1, 0.8), parent=head)
    if pose == 'glide':
        # goat-chute: a paraglider wing
        wing = empty('wing', (0, 0, 2.6)); wing.parent = body
        for i in range(7):
            a = math.radians(-45 + i * 15)
            box('panel', (0.72, 1.6, 0.08), (math.sin(a) * 2.6, 0, math.cos(a) * 1.2), 'gigga' if i % 2 else 'orange', rot=(0, a, 0), parent=wing, bevel=0.03, outline=0.015)
    return root

def tag(loc, s, size=0.8, m='black'):
    return text(s, loc, size=size, m=m, extrude=0.0)
