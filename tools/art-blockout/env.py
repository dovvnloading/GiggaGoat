"""Outdoor environment helpers for Gigga-Goat concept scenes."""
import math, random
from gg import *
from props import *
R = math.radians


def outdoor(res=(1920, 1080), time='day'):
    if time == 'sunset':
        reset(res, sky_top=(0.45, 0.55, 0.95), sky_bottom=(1.0, 0.72, 0.50), strength=1.1)
        sun(rot=(78, 0, -60), energy=3.0, color=(1.0, 0.78, 0.55))
    elif time == 'storm':
        reset(res, sky_top=(0.40, 0.48, 0.62), sky_bottom=(0.70, 0.76, 0.82), strength=0.9)
        sun(rot=(45, 0, 30), energy=1.8, color=(0.85, 0.9, 1.0))
    else:
        reset(res, sky_top=(0.40, 0.70, 1.0), sky_bottom=(0.88, 0.95, 1.0), strength=0.75)
        sun(rot=(48, 0, 35), energy=3.8, color=(1.0, 0.95, 0.85))
    water(3000, (0, 0, -0.3))
    return bpy.context.scene


def island_base(r=120, h=1.0, loc=(0, 0, 0), sand=True):
    x, y, z = loc
    if sand:
        cyl('beach', r + 8, 2.0, (x, y, z - 1.08), 'sand', verts=40, outline=0)
    cyl('land', r, 2.0, (x, y, z - 1.0), 'grass', verts=40, outline=0)


def cloud(loc, s=1.0, seed=0):
    rnd = random.Random(seed)
    x, y, z = loc
    for i in range(6):
        ball('cloud', (2.2 + rnd.random() * 1.8) * s, (x + (i - 3) * 2.4 * s + rnd.random(), y + rnd.random() * 2, z + rnd.random() * 1.5 * s),
             mat('cloudm', (1, 1, 1), rough=1.0), sub=2, outline=0, scale=(1.2, 1, 0.75))


def clouds(n=8, rad=260, z=70, seed=1):
    rnd = random.Random(seed)
    for i in range(n):
        a = rnd.random() * 2 * math.pi
        d = rad * (0.5 + rnd.random() * 0.5)
        cloud((math.cos(a) * d, math.sin(a) * d, z + rnd.random() * 30), s=2 + rnd.random() * 2, seed=i)


def mountain(loc, r=60, h=55, seed=3, snow=True):
    x, y, z = loc
    hill('mt', r, h, loc, 'rock', seed=seed, verts=12, rings=7)
    hill('mtgreen', r * 1.15, h * 0.35, (x, y, z - 0.5), 'grass2', seed=seed + 1, verts=14, rings=5)
    if snow:
        hill('snowcap', r * 0.28, h * 0.22, (x, y, z + h * 0.8), 'snow', seed=seed + 2, verts=10, rings=3)


def road(p0, p1, w=4.0, m='asphalt', dashes=True, z=0.05):
    a, b = Vector(p0), Vector(p1)
    d = b - a; L = d.length; ang = math.atan2(d.y, d.x)
    mid = (a + b) / 2
    box('road', (L, w, 0.1), (mid.x, mid.y, z), m, rot=(0, 0, ang), bevel=0, outline=0)
    if dashes:
        n = int(L / 4)
        for i in range(n):
            p = a + d * ((i + 0.5) / n)
            box('dash', (1.4, 0.18, 0.02), (p.x, p.y, z + 0.06), 'white', rot=(0, 0, ang), bevel=0, outline=0)


def barn(loc, rot=0, s=1.0):
    x, y, z = loc
    root = house(loc, w=10 * s, d=8 * s, h=6 * s, wall='barn', roofm='roof', rot=rot, door='white', windows=False)
    box('x1', (5.0 * s, 0.15, 0.3), (0, -4 * s - 0.15, 2.3 * s), 'barn', rot=(0, R(48), 0), parent=root, outline=0.01)
    box('x2', (5.0 * s, 0.15, 0.3), (0, -4 * s - 0.15, 2.3 * s), 'barn', rot=(0, R(-48), 0), parent=root, outline=0.01)
    box('bigdoor', (3.6 * s, 0.12, 4.4 * s), (0, -4 * s - 0.05, 2.2 * s), 'white', parent=root, outline=0.02)
    box('loft', (1.6 * s, 0.2, 1.4 * s), (0, -4 * s - 0.05, 6.6 * s), 'white', parent=root, outline=0.02)
    return root


def silo(loc, h=12):
    x, y, z = loc
    cyl('silo', 2.2, h, (x, y, z + h / 2), 'concrete', verts=14)
    ball('dome', 2.2, (x, y, z + h), 'red', scale=(1, 1, 0.6))


def building(loc, w=8, d=8, h=14, c='cream', rot=0, roofc='roof', sign=None, signc='yellow', awning=None):
    x, y, z = loc
    root = empty('bld', loc, (0, 0, rot))
    box('b', (w, d, h), (0, 0, h / 2), c, parent=root, bevel=0.05)
    box('cap', (w + 0.3, d + 0.3, 0.5), (0, 0, h + 0.25), roofc, parent=root, bevel=0.03)
    floors = max(1, int(h // 3.5))
    for f in range(1, floors):
        for k in range(int(w // 2.5)):
            wx = -w / 2 + 1.25 + k * 2.5
            box('w', (1.2, 0.1, 1.5), (wx, -d / 2 - 0.03, f * 3.5 + 0.6), mat('glass', rough=0.1), parent=root, outline=0.012)
    box('door', (1.8, 0.1, 2.6), (0, -d / 2 - 0.03, 1.3), 'wood2', parent=root, outline=0.015)
    if awning:
        box('awn', (w * 0.8, 1.6, 0.15), (0, -d / 2 - 0.8, 3.2), awning, rot=(R(-15), 0, 0), parent=root, outline=0.015)
    if sign:
        box('signb', (w * 0.7, 0.2, 1.2), (0, -d / 2 - 0.15, 4.1), signc, parent=root, outline=0.015)
        t = text(sign, (0, -d / 2 - 0.3, 3.75), size=0.75, m='black', extrude=0.02)
        t.parent = root
    # rooftop clutter (parkour!)
    box('ac', (1.5, 1.2, 1.0), (w * 0.25, d * 0.2, h + 1.0), 'concrete', parent=root)
    box('vent', (0.6, 0.6, 1.4), (-w * 0.3, -d * 0.2, h + 1.2), 'scrap', parent=root)
    return root


def palm(loc, h=7, seed=0):
    x, y, z = loc
    rnd = random.Random(seed)
    for i in range(6):
        cyl('ptrunk', 0.35 - i * 0.03, h / 6, (x + i * 0.12, y, z + h / 12 + i * h / 6), 'wood', verts=7)
    for j in range(6):
        a = j * math.pi / 3 + rnd.random() * 0.3
        box('frond', (3.2, 0.9, 0.12), (x + 0.7 + math.cos(a) * 1.5, y + math.sin(a) * 1.5, z + h - 0.2), 'leaf2', rot=(0, R(18), a), outline=0.012)


def pier(loc, L=60, w=7, rot=0):
    x, y, z = loc
    root = empty('pier', loc, (0, 0, rot))
    box('deck', (w, L, 0.5), (0, L / 2, 2.5), 'wood', parent=root, bevel=0.03)
    for i in range(0, int(L) + 1, 6):
        for k in (-1, 1):
            cyl('pile', 0.3, 4, (k * (w / 2 - 0.3), i, 0.8), 'wood2', verts=8, parent=root)
    for i in range(0, int(L), 3):
        for k in (-1, 1):
            box('rail', (0.15, 0.15, 1.1), (k * (w / 2 - 0.1), i, 3.3), 'white', parent=root, outline=0.01)
    for k in (-1, 1):
        box('railtop', (0.15, L, 0.15), (k * (w / 2 - 0.1), L / 2, 3.85), 'white', parent=root, outline=0.01)
    return root


def tide_ring(r, z, c='sea', alpha=0.55):
    o = cyl('tide', r, 0.2, (0, 0, z), mat('tide', PAL[c], alpha=alpha, rough=0.1), verts=48, outline=0)
    return o
