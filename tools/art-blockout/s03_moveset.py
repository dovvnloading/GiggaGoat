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

# 03 move set ---------------------------------------------------------------
cyc((1920, 1080))
moves = [('run', 'SPRINT', {}), ('jump', 'JUMP / FLIP', {}), ('headbutt', 'HEADBUTT (charge)', {}), ('lick', 'TONGUE GRAB', {'tongue': 2.2}),
         ('bleat', 'BLEAT SHOVE', {}), ('flop', 'FLOP / RAGDOLL', {}), ('climb', 'WALL CLIMB', {}), ('glide', 'GOAT-CHUTE', {})]
for i, (pose, lab, kw) in enumerate(moves):
    col, row = i % 4, i // 4
    x, y = -10.5 + col * 7, 7 - row * 13
    goat((x, y, 0), rot=R(-90 if pose in ('climb','lick','headbutt') else -65), pose=pose, **kw)
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
camera((0.5, -34, 24), (0.5, 0.5, 0.5), lens=40)
done.append(render('03_goat_moveset'))


__result__ = done
