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

# 04 cosmetics --------------------------------------------------------------
cyc((1920, 1080))
looks = [dict(hat='cap', accent='blue'), dict(hat='crown', fur='fur2'), dict(hat='traffic', pattern='spots'), dict(hat='tophat', scarf='red'),
         dict(hat='headphones', accent='teal', pattern='stripe'), dict(hat='helmet', accent='red', horns='spike'), dict(hat='flower', fur='hoof', scarf='pink'),
         dict(pattern='socks', accent='gigga', horns='gigga', scarf='yellow'), dict(fur='dirt', hat='cap', accent='green', scarf='teal'), dict(fur='rock2', horns='spike', scarf='orange', pattern='stripe', accent='yellow')]
labels = ['Skater Cap', 'Golden Crown', 'Cone + Spots', 'Top Hat', 'Beats + Stripe', 'Crash Helmet', 'Flower Child', 'GIGGA Socks', 'Mudlark', 'Granite']
for i, (kw, lab) in enumerate(zip(looks, labels)):
    col, row = i % 5, i // 5
    x, y = -12 + col * 6, 6 - row * 12
    goat((x, y, 0), rot=R(-145), **kw)
    label(lab, (x, y - 2.4, 0.1), size=0.45)
label('GEAR & LOOKS (cosmetic, no pay-to-win)', (0, 12, 5.5), size=0.9)
camera((0, -33, 22), (0, 0.5, 0.8), lens=40)
done.append(render('04_goat_cosmetics'))

__result__ = done
