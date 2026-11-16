"""Goat v2 for Gigga-Goat reference art (overrides gg.goat)."""
import bpy, math
from gg import mat, finish, empty, ball, cyl, box, torus


def horn_curve(name, pts, r0, r1, m, parent=None, outline=0.012):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = 1.0; cu.bevel_resolution = 3; cu.resolution_u = 8; cu.use_fill_caps = True
    sp = cu.splines.new('NURBS'); sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        t = i / (len(pts) - 1)
        sp.points[i].co = (*p, 1); sp.points[i].radius = r0 + (r1 - r0) * t
    sp.use_endpoint_u = True; sp.order_u = 3
    o = bpy.data.objects.new(name, cu); bpy.context.collection.objects.link(o)
    if parent:
        o.parent = parent
    for ob in bpy.context.selected_objects:
        ob.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.active_object
    finish(o, mat(m) if isinstance(m, str) else m, outline, smooth=True)
    return o


POSES = {
    #          legrot              bz    body_rot(deg xyz)   head_pos           head_rot(deg)
    'stand':  ([0, 0, 0, 0],        1.55, (0, 0, 0),          (0, 1.25, 1.05),  (0, 0, 0)),
    'run':    ([40, -35, -40, 35],  1.65, (-5, 0, 0),         (0, 1.3, 0.95),   (10, 0, 0)),
    'headbutt': ([-30, -30, 35, 35], 1.5, (14, 0, 0),         (0, 1.45, 0.45),  (55, 0, 0)),
    'jump':   ([65, 65, -65, -65],  1.9,  (-18, 0, 0),        (0, 1.25, 1.05),  (-10, 0, 0)),
    'flop':   ([75, -45, 25, -85],  0.85, (0, 95, 10),        (0, 1.25, 1.0),   (-20, 0, 30)),
    'climb':  ([-45, 35, 35, -45],  1.9,  (-72, 0, 0),        (0, 1.25, 1.05),  (40, 0, 0)),
    'bleat':  ([0, 0, 0, 0],        1.55, (0, 0, 0),          (0, 1.2, 1.2),    (-40, 0, 0)),
    'glide':  ([-75, -75, 75, 75],  1.8,  (0, 0, 0),          (0, 1.25, 1.05),  (0, 0, 0)),
    'sit':    ([0, 0, -85, -85],    1.15, (-25, 0, 0),        (0, 1.25, 1.05),  (15, 0, 0)),
    'lick':   ([10, -10, 0, 0],     1.55, (5, 0, 0),          (0, 1.3, 1.0),    (10, 0, 0)),
}


def goat(loc=(0, 0, 0), rot=0, s=1.0, fur='fur', pose='stand', accent=None, hat=None, tongue=0.0, scarf='orange',
         horns='curl', eye_dir=0.0, pattern=None, socks='fur2', tilt=(0, 0, 0)):
    R = math.radians
    legrot, bz, brot, hpos, hrot = POSES[pose]
    root = empty('goat', loc, (R(tilt[0]), R(tilt[1]), rot + R(tilt[2])), s)
    body = empty('body'); body.parent = root
    body.location = (0, 0, bz); body.rotation_euler = tuple(R(a) for a in brot)
    fm = mat(fur)
    ball('barrel', 0.62, (0, -0.05, 0), fm, scale=(0.95, 1.7, 0.95), parent=body)
    ball('chest', 0.55, (0, 0.6, 0.08), fm, scale=(1.0, 0.95, 1.05), parent=body)
    ball('rump', 0.5, (0, -0.75, 0.05), fm, scale=(1.05, 0.95, 1.0), parent=body)
    if pattern == 'spots':
        for (px, py, pz) in ((0.5, 0.2, 0.3), (-0.45, -0.5, 0.35), (0.25, -0.85, 0.42), (-0.5, 0.55, 0.15)):
            ball('spot', 0.25, (px, py, pz), 'hoof', scale=(0.45, 1, 0.9), parent=body, outline=0)
    elif pattern == 'stripe':
        box('stripe', (0.22, 1.9, 0.2), (0, -0.05, 0.55), accent or 'gigga', parent=body, outline=0, bevel=0.08)
    elif pattern == 'socks':
        socks = accent or 'gigga'
    cyl('tail', 0.13, 0.45, (0, -1.15, 0.38), fm, rot=(R(-35), 0, 0), verts=8, r2=0.03, parent=body)
    for i, (lx, ly) in enumerate(((-0.36, 0.62), (0.36, 0.62), (-0.36, -0.75), (0.36, -0.75))):
        hip = empty('hip', (lx, ly, -0.35)); hip.parent = body
        hip.rotation_euler = (R(legrot[i]), 0, 0)
        cyl('thigh', 0.2, 0.6, (0, 0, -0.2), fm, verts=8, r2=0.15, parent=hip)
        cyl('shin', 0.13, 0.55, (0, 0, -0.72), socks, verts=8, r2=0.12, parent=hip)
        cyl('hoof', 0.15, 0.2, (0, 0.02, -1.05), 'hoof', verts=8, parent=hip, r2=0.12)
    cyl('neck', 0.3, 0.75, (0, 0.95, 0.55), fm, rot=(R(-35), 0, 0), verts=10, r2=0.25, parent=body)
    head = empty('head', hpos); head.parent = body; head.rotation_euler = tuple(R(a) for a in hrot)
    ball('skull', 0.42, (0, 0, 0.05), fm, scale=(0.95, 1.15, 0.95), parent=head)
    ball('muzzle', 0.3, (0, 0.5, -0.12), fm, scale=(0.9, 1.35, 0.8), parent=head)
    ball('nose', 0.11, (0, 0.88, -0.05), 'nose', scale=(1.5, 0.6, 0.8), parent=head, outline=0.008)
    ball('mouth', 0.08, (0, 0.78, -0.3), 'nose', scale=(2.2, 0.5, 0.4), parent=head, outline=0)
    cyl('beard', 0.13, 0.45, (0, 0.45, -0.5), fm, rot=(R(15), 0, 0), verts=8, r2=0.02, parent=head)
    for k in (-1, 1):
        ball('eye', 0.17, (k * 0.3, 0.25, 0.2), 'white', scale=(0.75, 0.9, 1.1), parent=head, outline=0.012)
        box('pupil', (0.04, 0.17, 0.06), (k * 0.42, 0.28 + eye_dir, 0.2), 'black', parent=head, bevel=0.02, outline=0)
        cyl('ear', 0.11, 0.5, (k * 0.55, -0.05, 0.1), fm, rot=(0, R(k * 105), R(k * -10)), verts=8, r2=0.04, parent=head)
        if horns in ('curl', 'gigga'):
            big = horns == 'gigga'
            n = 14; pts = []
            for i in range(n):
                t = i / (n - 1)
                a = t * (1.15 if big else 0.85) * 2 * math.pi
                r = (0.5 if big else 0.36) * (1 - 0.4 * t)
                pts.append((k * (0.2 + (0.45 if big else 0.28) * t), -0.05 - r + r * math.cos(a), 0.36 + r * math.sin(a)))
            horn_curve('horn', pts, 0.15 if big else 0.12, 0.035, 'horn', parent=head)
        else:
            horn_curve('horn', [(k * 0.18, -0.05, 0.35), (k * 0.25, -0.25, 0.75), (k * 0.3, -0.5, 0.95)], 0.1, 0.02, 'horn', parent=head)
    if tongue > 0:
        pts = [(0, 0.8, -0.28), (0, 0.8 + tongue * 0.5, -0.32 + 0.15 * min(tongue, 2)), (0, 0.8 + tongue, -0.3)]
        horn_curve('tongue', pts, 0.08, 0.06, 'tongue', parent=head, outline=0.008)
        ball('tip', 0.17, (0, 0.8 + tongue, -0.3), 'tongue', scale=(1.3, 0.7, 1), parent=head, outline=0.01)
    if scarf:
        torus('scarf', 0.34, 0.1, (0, 0.95, 0.5), scarf, rot=(R(55), 0, 0), parent=body)
        box('scarf_tail', (0.18, 0.07, 0.5), (0.2, 0.75, 0.25), scarf, rot=(R(-25), 0, R(15)), parent=body, outline=0.01)
    hz = 0.5
    if hat == 'cap':
        ball('cap', 0.4, (0, 0.0, hz), accent or 'blue', scale=(1, 1.05, 0.5), parent=head)
        box('brim', (0.55, 0.45, 0.05), (0, 0.42, hz - 0.03), accent or 'blue', parent=head, outline=0.01)
    elif hat == 'crown':
        cyl('crown', 0.27, 0.26, (0, 0.0, hz + 0.12), 'yellow', verts=6, parent=head, r2=0.33)
    elif hat == 'traffic':
        cyl('cone', 0.3, 0.75, (0, 0.0, hz + 0.32), 'orange', verts=10, parent=head, r2=0.03)
    elif hat == 'tophat':
        cyl('top', 0.25, 0.55, (0, 0.0, hz + 0.3), 'black', verts=14, parent=head)
        cyl('brim', 0.42, 0.05, (0, 0.0, hz + 0.03), 'black', verts=14, parent=head)
    elif hat == 'headphones':
        torus('band', 0.48, 0.05, (0, 0.05, 0.12), accent or 'teal', rot=(0, R(90), 0), parent=head)
        for k in (-1, 1):
            cyl('cup', 0.17, 0.13, (k * 0.47, 0.05, 0.05), accent or 'teal', rot=(0, R(90), 0), parent=head)
    elif hat == 'helmet':
        ball('helmet', 0.5, (0, 0.0, 0.18), accent or 'red', scale=(1, 1.1, 0.8), parent=head)
    elif hat == 'flower':
        for j in range(5):
            a = j * 2 * math.pi / 5
            ball('petal', 0.09, (0.25 + 0.1 * math.cos(a), 0.1, hz + 0.05 + 0.1 * math.sin(a)), 'pink', parent=head, outline=0.006)
        ball('ctr', 0.06, (0.25, 0.12, hz + 0.05), 'yellow', parent=head, outline=0.006)
    if pose == 'glide':
        wing = empty('wing', (0, 0, 2.4)); wing.parent = body
        for i in range(7):
            a = R(-45 + i * 15)
            box('panel', (0.72, 1.5, 0.08), (math.sin(a) * 2.6, 0, math.cos(a) * 1.1), 'gigga' if i % 2 else 'orange', rot=(0, a, 0), parent=wing, bevel=0.03, outline=0.015)
        for k in (-1, 1):
            cyl('line', 0.015, 2.4, (k * 1.2, 0, 1.2), 'black', rot=(0, R(k * -28), 0), verts=4, parent=body, outline=0)
    return root
