import sys, os
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import importlib, gg; importlib.reload(gg)
import goat2; importlib.reload(goat2)
import props; importlib.reload(props)
from gg import *
from props import *
from goat2 import goat
R = math.radians
done = []

def cyc(res):
    reset(res, sky_top=(0.86, 0.93, 1.0), sky_bottom=(0.86, 0.93, 1.0), strength=1.2)
    ground(400, mat('floor', (0.82, 0.90, 0.76), rough=0.9))
    sun(rot=(50, 0, 25), energy=2.6)

def label(s, loc, size=0.45):
    return text(s, loc, size=size, m='black', extrude=0.0)

# 05 props -------------------------------------------------------------------
cyc((1920, 1080))
items = [
    ('Hay Bale', lambda p: hay_bale(p, rot=R(20))), ('Round Bale', lambda p: hay_bale(p, round_=True, rot=R(10))),
    ('Crate', lambda p: crate(p, s=1.1, rot=R(15))), ('Fizzy Soda Crate', lambda p: soda_crate(p, rot=R(-10))),
    ('Barrel', lambda p: barrel(p)), ('Trampoline', lambda p: trampoline(p, 1.3)),
    ('Launch Pad', lambda p: launch_pad(p, rot=R(0))), ('Garden Gnome', lambda p: gnome(p)),
    ('Mailbox', lambda p: mailbox(p)), ('Bench', lambda p: bench(p, rot=0)),
    ('Traffic Cone', lambda p: cone(p)), ('Beach Ball', lambda p: beach_ball(p)),
    ('Picnic Table', lambda p: picnic(p)), ('Buoy', lambda p: buoy(p)),
    ('Lamp Post', lambda p: lamp(p, 3.6)), ('Fence', lambda p: fence((p[0] - 1.6, p[1], p[2]), (p[0] + 1.6, p[1], p[2]))),
    ('Oak Tree', lambda p: tree(p, 0.75, 'round', 3)), ('Pine Tree', lambda p: tree(p, 0.75, 'pine')),
    ('Boulder', lambda p: rock((p[0], p[1], p[2] + 0.4), 0.8, 4)), ('Goat (scale)', lambda p: goat(p, rot=R(-130))),
]
cols = 5
for i, (lab, fn) in enumerate(items):
    c, r = i % cols, i // cols
    p = (-12 + c * 6, 9 - r * 6.5, 0)
    fn(p)
    label(lab, (p[0], p[1] - 2.3, 0.05))
label('BILLY ISLE PROP KIT (all physics props: lickable, pushable, most breakable)', (0, 13, 3), size=0.7)
camera((0, -24, 34), (0, -1.5, 0), lens=32)
done.append(render('05_prop_kit'))

# 06 Hay-Build pieces ---------------------------------------------------------
cyc((1920, 1080))
mats = [('HAY', 'hay', 'wood2'), ('WOOD', 'wood', 'wood2'), ('SCRAP', 'scrap', 'roof')]
for row, (mname, m, trim) in enumerate(mats):
    y = 10 - row * 10
    label(mname, (-19.5, y, 0.8), size=0.9)
    x0 = -12
    # floor
    box('floor', (4, 4, 0.3), (x0, y, 0.15), m, bevel=0.06)
    # wall
    box('wall', (4, 0.35, 4), (x0 + 6.5, y, 2.0), m, bevel=0.06)
    for k in (-1.3, 0, 1.3):
        box('trim', (0.15, 0.4, 4), (x0 + 6.5 + k, y, 2.0), trim, outline=0.01)
    # ramp (wedge)
    rp = box('ramp', (4, 4.6, 0.3), (x0 + 13, y, 2.0), m, rot=(R(45), 0, 0), bevel=0.06)
    # launch pad piece
    box('lp', (4, 4, 0.4), (x0 + 19.5, y, 0.2), m, bevel=0.06)
    box('lpspring', (2.4, 2.4, 0.25), (x0 + 19.5, y, 0.5), 'orange', bevel=0.06)
    for j in range(3):
        box('chev', (1.2, 0.22, 0.06), (x0 + 19.5, y - 0.6 + j * 0.6, 0.66), 'yellow', outline=0.006)
for i, lab in enumerate(('FLOOR', 'WALL', 'RAMP', 'LAUNCH PAD')):
    label(lab, (-12 + i * 6.5, -14.5, 0.05), size=0.7)
# ghost placement preview
ghost = box('ghost', (4, 0.35, 4), (15, 10, 2.0), mat('ghost', PAL['teal'], emit=1.5, alpha=0.35), outline=0)
label('placement ghost: valid = teal, invalid = red', (17.5, 6.5, 0.05), size=0.45)
gx = box('ghostbad', (4, 0.35, 4), (20, 10, 2.0), mat('ghostbad', PAL['red'], emit=1.5, alpha=0.35), outline=0)
label('HAY-BUILD PIECES: 4 m snap grid. Hay = cheap & bouncy, Wood = standard, Scrap = tough', (1, 16, 4), size=0.65)
goat((17, -1, 0), rot=R(-120), s=1.0)
label('goat for scale', (17, -3.5, 0.05), size=0.45)
camera((1, -38, 26), (1, 0, 0), lens=32)
done.append(render('06_hay_build_pieces'))

__result__ = done
