"""Shared prop builders for Gigga-Goat reference art."""
import math, random
from gg import *
R = math.radians


def soda_crate(loc, rot=0):
    x, y, z = loc
    box('soda', (1.0, 0.8, 0.7), (x, y, z + 0.35), 'teal', rot=(0, 0, rot), bevel=0.06)
    for i in range(3):
        for j in range(2):
            cyl('can', 0.12, 0.35, (x - 0.3 + i * 0.3, y - 0.17 + j * 0.34, z + 0.85), 'pink' if (i + j) % 2 else 'yellow', verts=10, outline=0.01)
    for k in range(5):
        ball('fizz', 0.06 + 0.02 * k, (x + 0.3 - k * 0.12, y, z + 1.2 + k * 0.22), 'white', outline=0.006)


def barrel(loc, m='wood'):
    x, y, z = loc
    cyl('barrel', 0.45, 1.1, (x, y, z + 0.55), m, verts=12)
    for h in (0.2, 0.9):
        torus('hoop', 0.46, 0.035, (x, y, z + h), 'roof')


def trampoline(loc, r=1.5):
    x, y, z = loc
    cyl('tramp', r, 0.15, (x, y, z + 0.6), 'gigga', verts=20)
    torus('rim', r, 0.1, (x, y, z + 0.65), 'blue')
    for i in range(6):
        a = i * math.pi / 3
        cyl('leg', 0.05, 0.6, (x + math.cos(a) * r * 0.9, y + math.sin(a) * r * 0.9, z + 0.3), 'roof', verts=6, outline=0.01)


def launch_pad(loc, rot=0, s=1.0):
    x, y, z = loc
    box('pad', (2.2 * s, 2.2 * s, 0.3), (x, y, z + 0.15), 'orange', rot=(0, 0, rot), bevel=0.08)
    for i in range(3):
        a = rot
        d = -0.5 + i * 0.5
        box('chev', (0.9 * s, 0.22, 0.06), (x - math.sin(a) * d * s, y + math.cos(a) * d * s, z + 0.33), 'yellow', rot=(0, 0, rot), outline=0.008)


def gnome(loc, rot=0):
    x, y, z = loc
    cyl('gbody', 0.28, 0.5, (x, y, z + 0.25), 'blue', verts=10, r2=0.22)
    ball('ghead', 0.2, (x, y, z + 0.62), 'cream')
    ball('gbeard', 0.18, (x, y + 0.12, z + 0.52), 'white', scale=(1, 0.7, 1.2))
    cyl('ghat', 0.2, 0.45, (x, y, z + 0.95), 'red', verts=10, r2=0.01)


def mailbox(loc):
    x, y, z = loc
    cyl('mpost', 0.06, 1.0, (x, y, z + 0.5), 'wood2', verts=6)
    cyl('mbox', 0.22, 0.6, (x, y, z + 1.1), 'red', rot=(R(90), 0, 0), verts=12)


def bench(loc, rot=0):
    x, y, z = loc
    box('seat', (2.0, 0.6, 0.1), (x, y, z + 0.5), 'wood', rot=(0, 0, rot))
    box('back', (2.0, 0.1, 0.5), (x - math.sin(rot) * -0.3, y + math.cos(rot) * -0.3, z + 0.85), 'wood', rot=(0, 0, rot))
    for k in (-0.8, 0.8):
        box('bleg', (0.1, 0.55, 0.5), (x + math.cos(rot) * k, y + math.sin(rot) * k, z + 0.25), 'roof', rot=(0, 0, rot), outline=0.01)


def cone(loc):
    x, y, z = loc
    box('cbase', (0.5, 0.5, 0.06), (x, y, z + 0.03), 'orange', outline=0.01)
    cyl('cone', 0.2, 0.7, (x, y, z + 0.4), 'orange', verts=10, r2=0.03)
    cyl('cband', 0.15, 0.1, (x, y, z + 0.42), 'white', verts=10, r2=0.12, outline=0)


def beach_ball(loc, r=0.5):
    x, y, z = loc
    ball('bball', r, (x, y, z + r), 'white', sub=2)
    for i, c in enumerate(('red', 'blue', 'yellow')):
        ball('bstripe', r * 1.01, (x, y, z + r), c, scale=(0.25, 1, 1), sub=2, outline=0, rot=(0, 0, i * math.pi / 3))


def picnic(loc, rot=0):
    x, y, z = loc
    box('ptop', (2.2, 1.0, 0.12), (x, y, z + 0.8), 'wood', rot=(0, 0, rot))
    for k in (-0.75, 0.75):
        box('pseat', (2.2, 0.35, 0.1), (x - math.sin(rot) * k, y + math.cos(rot) * k, z + 0.45), 'wood', rot=(0, 0, rot))
    box('pleg', (0.15, 1.6, 0.8), (x, y, z + 0.4), 'wood2', rot=(0, 0, rot), outline=0.01)


def buoy(loc, c='red'):
    x, y, z = loc
    cyl('buoy', 0.5, 0.9, (x, y, z + 0.45), c, verts=12, r2=0.3)
    cyl('btop', 0.06, 0.8, (x, y, z + 1.3), 'roof', verts=6)
    ball('blight', 0.12, (x, y, z + 1.75), mat('bglow', PAL['yellow'], emit=3))


def scaffold(loc, w=4, h=8, d=2):
    x, y, z = loc
    for i in range(0, int(w) + 1, 2):
        for j in (0, d):
            cyl('pole', 0.06, h, (x + i, y + j, z + h / 2), 'yellow', verts=6, outline=0.01)
    for lv in range(2, int(h) + 1, 3):
        box('plank', (w + 0.4, d + 0.2, 0.1), (x + w / 2, y + d / 2, z + lv), 'wood', outline=0.01)


def crane(loc, h=26, jib=22, rot=0):
    x, y, z = loc
    root = empty('crane', loc, (0, 0, rot))
    for k in range(int(h // 2)):
        box('mast', (1.2, 1.2, 2.0), (0, 0, 1 + k * 2), 'yellow', parent=root, bevel=0.0, outline=0.02)
        box('x', (0.1, 1.6, 0.1), (0.62, 0, 1 + k * 2), 'roof', rot=(R(45), 0, 0), parent=root, outline=0)
    box('jib', (jib, 0.9, 0.9), (jib / 2 - 5, 0, h + 0.5), 'yellow', parent=root, bevel=0.0)
    box('cab', (2, 1.8, 1.6), (0, -1.4, h - 1), 'white', parent=root)
    box('counter', (2.5, 1.5, 1.5), (-5, 0, h - 0.3), 'concrete', parent=root)
    cyl('cable', 0.03, 9, (jib - 7, 0, h - 4.5), 'black', verts=4, parent=root, outline=0)
    crate((0, 0, 0), s=1.4)  # dummy at origin is fine (under mast)
    return root


def ferris(loc, r=10, rot=0):
    x, y, z = loc
    root = empty('ferris', loc, (0, 0, rot))
    torus('wheel', r, 0.25, (0, 0, r + 2), 'white', rot=(R(90), 0, 0), parent=root)
    torus('wheel2', r * 0.55, 0.15, (0, 0, r + 2), 'pink', rot=(R(90), 0, 0), parent=root)
    for i in range(12):
        a = i * math.pi / 6
        cyl('spoke', 0.08, r, (math.cos(a) * r / 2, 0, r + 2 + math.sin(a) * r / 2), 'white', rot=(0, -a + math.pi / 2, 0), verts=6, parent=root, outline=0.01)
        c = ('red', 'yellow', 'teal', 'gigga', 'orange', 'blue')[i % 6]
        box('gondola', (1.3, 1.3, 1.2), (math.cos(a) * r, 0, r + 2 + math.sin(a) * r - 1.0), c, parent=root, bevel=0.1)
    for k in (-1, 1):
        cyl('leg', 0.3, r + 3, (k * 3, 0, (r + 2) / 2), 'white', rot=(0, R(k * 15), 0), verts=8, parent=root)
    return root


def windmill(loc, h=12, rot=0):
    x, y, z = loc
    root = empty('windmill', loc, (0, 0, rot))
    cyl('tower', 2.4, h, (0, 0, h / 2), 'cream', verts=8, r2=1.6, parent=root)
    cyl('cap', 2.0, 2.2, (0, 0, h + 1.0), 'barn', verts=8, r2=0.3, parent=root)
    hub = empty('hub', (0, 2.0, h - 0.5)); hub.parent = root
    for i in range(4):
        a = i * math.pi / 2 + 0.3
        box('blade', (1.2, 0.15, 6.5), (math.cos(a) * 3.3, 0, math.sin(a) * 3.3), 'wood', rot=(0, -a + math.pi / 2, 0), parent=hub)
    return root


def lighthouse(loc, h=18):
    x, y, z = loc
    for i in range(6):
        c = 'red' if i % 2 else 'white'
        cyl('lh', 2.2 - i * 0.18, h / 6, (x, y, z + h / 12 + i * h / 6), c, verts=14, r2=2.2 - (i + 1) * 0.18)
    cyl('gallery', 1.6, 0.3, (x, y, z + h + 0.15), 'roof', verts=14)
    cyl('lamp', 0.9, 1.6, (x, y, z + h + 1.1), mat('lhglow', PAL['yellow'], emit=5), verts=10)
    cyl('lhroof', 1.2, 1.2, (x, y, z + h + 2.4), 'red', verts=10, r2=0.1)


def dish(loc, r=3.0):
    x, y, z = loc
    cyl('dpost', 0.3, 4, (x, y, z + 2), 'concrete', verts=8)
    o = ball('dish', r, (x, y, z + 5), 'white', scale=(1, 1, 0.35), sub=2, rot=(R(-35), 0, 0))
    cyl('feed', 0.06, 2.5, (x, y - 1, z + 6), 'roof', rot=(R(-35), 0, 0), verts=6)
