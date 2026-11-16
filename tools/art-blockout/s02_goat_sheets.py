import sys, os
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import importlib, gg; importlib.reload(gg)
import goat2; importlib.reload(goat2)
from gg import *
from goat2 import goat
R = math.radians
done = []

def cyc(res, floor=(0.80, 0.90, 0.74), wall=(0.86, 0.93, 1.0), width=80, depth=30):
    """Studio cyclorama: floor + curved back wall."""
    reset(res, sky_top=wall, sky_bottom=wall, strength=1.2)
    bm = bmesh.new()
    n = 10
    rows = []
    for i in range(n + 1):
        t = i / n
        a = t * math.pi / 2
        y = depth * 0.5 + math.sin(a) * 6
        z = (1 - math.cos(a)) * 6
        rows.append((y, z))
    rows = [(-depth, 0)] + rows + [(depth * 0.5 + 6, 40)]
    vs = []
    for (y, z) in rows:
        vs.append((bm.verts.new((-width, y, z)), bm.verts.new((width, y, z))))
    for i in range(len(vs) - 1):
        bm.faces.new((vs[i][0], vs[i][1], vs[i + 1][1], vs[i + 1][0]))
    me = bpy.data.meshes.new('cyc'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('cyc', me); bpy.context.collection.objects.link(o)
    for p in o.data.polygons: p.use_smooth = True
    finish(o, mat('cycm', floor, rough=0.9), 0)
    sun(rot=(50, 0, 25), energy=2.6)
    fill = bpy.data.lights.new('fill', 'SUN'); fill.energy = 0.8
    fo = bpy.data.objects.new('fill', fill); bpy.context.collection.objects.link(fo)
    fo.rotation_euler = (R(60), 0, R(-140))

def label(s, loc, size=0.6):
    t = text(s, loc, size=size, m='black', extrude=0.0)
    return t

# 01 size tiers ------------------------------------------------------------
cyc((1920, 1080))
xs = [-11.5, -7.8, -2.4, 8.0]
for (name, sc, horns), x in zip((('KID 0.6x', 0.6, 'curl'), ('BILLY 1x', 1.0, 'curl'), ('BIG 1.6x', 1.6, 'curl'), ('GIGGA 3x', 3.0, 'gigga')), xs):
    goat((x, 0, 0), rot=R(-90), s=sc, horns=horns, scarf='orange' if sc < 3 else 'gigga')
    label(name, (x, -4, 0.1), size=0.85)
for h in range(0, 11, 2):
    box('tick', (0.5, 0.06, 0.06), (-15.5, 0, h), 'black', outline=0)
    label(f'{h} m', (-16.9, 0, h - 0.2), size=0.45)
cyl('ruler', 0.05, 10, (-15.5, 0, 5), 'black', outline=0)
label('GIGGA METER SIZE TIERS', (-1.5, 6, 11.2), size=1.1)
camera((-1.5, -48, 6.5), (-1.5, 0, 5.0), lens=45)
done.append(render('01_goat_size_tiers'))

# 02 turnaround -------------------------------------------------------------
cyc((1920, 900))
for i, (ang, lab) in enumerate(((0, 'FRONT'), (-45, '3/4'), (-90, 'SIDE'), (180, 'BACK'))):
    x = -9 + i * 6
    goat((x, 0, 0), rot=R(180 + ang), s=1.0)
    label(lab, (x, -2.6, 0.1), size=0.55)
label('BILLY - DEFAULT GOAT (1x, 1.0 m at shoulder)', (0, 4, 4.3), size=0.6)
camera((0, -30, 2.6), (0, 0, 1.9), lens=50)
done.append(render('02_goat_turnaround'))

# 03 move set ---------------------------------------------------------------
cyc((1920, 1080))
moves = [('run', 'SPRINT', {}), ('jump', 'JUMP / FLIP', {}), ('headbutt', 'HEADBUTT (charge)', {}), ('lick', 'TONGUE GRAB', {'tongue': 2.2}),
         ('bleat', 'BLEAT SHOVE', {}), ('flop', 'FLOP / RAGDOLL', {}), ('climb', 'WALL CLIMB', {}), ('glide', 'GOAT-CHUTE', {})]
for i, (pose, lab, kw) in enumerate(moves):
    col, row = i % 4, i // 4
    x, y = -10.5 + col * 7, 5 - row * 9
    goat((x, y, 0), rot=R(-90), pose=pose, **kw)
    if pose == 'climb':
        box('wall', (0.8, 3, 4.5), (x + 1.9, y, 2.25), 'rock', bevel=0.1)
    if pose == 'lick':
        crate((x + 3.9, y, 0), s=0.9)
    if pose == 'headbutt':
        crate((x + 2.7, y, 0.35), s=0.9, rot=R(25))
        for j in range(3):
            box('speed', (0.9, 0.05, 0.05), (x - 2.0, y, 1.0 + j * 0.45), 'white', outline=0)
    if pose == 'bleat':
        for r in (0.6, 1.0, 1.4):
            torus('wave', r, 0.05, (x + 2.2 + r * 0.6, y, 2.4), 'gigga', rot=(0, R(90), 0))
    if pose == 'jump':
        for j in range(4):
            ball('dust', 0.25 + j * 0.05, (x - 1 + j * 0.6, y, 0.2), 'dirt', outline=0.0)
    if pose == 'run':
        for j in range(3):
            ball('dust', 0.3, (x - 1.8 - j * 0.6, y, 0.25 + j * 0.1), 'dirt', outline=0.0)
    label(lab, (x, y - 2.6, 0.1), size=0.5)
camera((0.5, -36, 13), (0.5, 0, 1.5), lens=38)
done.append(render('03_goat_moveset'))

# 04 cosmetics --------------------------------------------------------------
cyc((1920, 1080))
looks = [dict(hat='cap', accent='blue'), dict(hat='crown', fur='fur2'), dict(hat='traffic', pattern='spots'), dict(hat='tophat', scarf='red'),
         dict(hat='headphones', accent='teal', pattern='stripe'), dict(hat='helmet', accent='red', horns='spike'), dict(hat='flower', fur='hoof', scarf='pink'),
         dict(pattern='socks', accent='gigga', horns='gigga', scarf='yellow'), dict(fur='dirt', hat='cap', accent='green', scarf='teal'), dict(fur='rock2', horns='spike', scarf='orange', pattern='stripe', accent='yellow')]
labels = ['Skater Cap', 'Golden Crown', 'Cone + Spots', 'Top Hat', 'Beats + Stripe', 'Crash Helmet', 'Flower Child', 'GIGGA Socks', 'Mudlark', 'Granite']
for i, (kw, lab) in enumerate(zip(looks, labels)):
    col, row = i % 5, i // 5
    x, y = -12 + col * 6, 4 - row * 8
    goat((x, y, 0), rot=R(-145), **kw)
    label(lab, (x, y - 2.4, 0.1), size=0.45)
label('GEAR & LOOKS (cosmetic, no pay-to-win)', (0, 9, 6.5), size=0.8)
camera((0, -34, 12), (0, 0, 1.6), lens=40)
done.append(render('04_goat_cosmetics'))

__result__ = done
