import sys, os
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import importlib, gg, props, env, goat2
for m in (gg, props, env, goat2): importlib.reload(m)
from gg import *
from props import *
from env import *
from goat2 import goat
R = math.radians
done = []

# 07 KEY ART: goat on a knoll above Hoofington, Mt. Gigga behind --------------------
outdoor((1920, 1080), 'day')
island_base(400)
hill('knoll', 22, 7, (0, 0, 0), 'grass', seed=5, verts=16, rings=6)
mountain((40, 230, 0), r=110, h=95, seed=7)
hill('h2', 60, 18, (-120, 140, 0), 'grass2', seed=9)
hill('h3', 50, 14, (150, 90, 0), 'grass2', seed=11)
# village below
barn((-28, 55, 0), rot=R(20))
silo((-14, 62, 0))
windmill((22, 70, 0), h=13, rot=R(-25))
for i, (hx, hy, c, rc) in enumerate(((-45, 85, 'cream', 'barn'), (5, 95, 'white', 'roof'), (35, 105, 'cream', 'barn'), (-15, 110, 'pink', 'roof'))):
    house((hx, hy, 0), w=7, d=6, h=4.5, wall=c, roofm=rc, rot=R(10 * i))
road((-80, 40, 0), (80, 120, 0), w=5)
fence((-40, 30, 0), (-5, 38, 0))
for i in range(10):
    hay_bale((-36 + i * 3.2, 44 + (i % 3), 0), rot=R(i * 17), round_=(i % 2 == 0))
for i, (tx, ty) in enumerate(((-60, 60), (-70, 75), (50, 60), (60, 85), (-90, 100), (80, 70), (15, 40))):
    tree((tx, ty, 0), 1.6, 'round', i)
clouds(10, rad=300, z=90)
# hero goat + friends
goat((0, -2, 6.8), rot=R(25), s=1.6, horns='curl', pose='bleat')
goat((-6, 4, 5.2), rot=R(60), s=1.0, hat='cap', accent='blue', pose='jump')
goat((7, 3, 5.6), rot=R(-10), s=1.0, pattern='spots', hat='traffic', pose='run')
crate((4, -8, 4.2), s=1.2, rot=R(30))
camera((-10, -26, 12), (6, 40, 14), lens=26)
t = text('GIGGA-GOAT', (6, 60, 33), size=9, m=mat('title', PAL['yellow'], emit=0.4), extrude=0.8)
t.rotation_euler = bpy.context.scene.camera.rotation_euler.copy()
done.append(render('07_key_art'))

# 08 HOOFINGTON: starter farm village at street level ---------------------------
outdoor((1920, 1080), 'day')
island_base(400)
mountain((60, 300, 0), r=120, h=100, seed=7)
road((0, -60, 0), (0, 120, 0), w=6)
road((-80, 30, 0), (80, 30, 0), w=6)
barn((-22, 50, 0), rot=R(-5), s=1.2)
silo((-36, 62, 0), h=14)
windmill((30, 70, 0), h=14, rot=R(-20))
for i, (hx, hy, c, rc) in enumerate(((12, 8, 'cream', 'barn'), (14, 20, 'white', 'roof'), (-12, 10, 'pink', 'roof'), (-14, 20, 'cream', 'barn'), (12, 42, 'yellow', 'roof'))):
    house((hx, hy, 0), w=7, d=6, h=4.5, wall=c, roofm=rc, rot=R(90 if hx < 0 else -90))
for i in range(5):
    mailbox((7.5, 4 + i * 8, 0))
fence((-40, 36, 0), (-6, 36, 0)); fence((-40, 36, 0), (-40, 70, 0))
for i in range(14):
    hay_bale((-34 + (i % 7) * 4, 40 + (i // 7) * 4, 0), rot=R(i * 23), round_=(i % 3 == 0))
for i, (tx, ty) in enumerate(((-30, 0), (25, -5), (30, 30), (-28, 85), (45, 50), (-50, 20))):
    tree((tx, ty, 0), 1.4, 'round', i)
gnome((5, 0, 0)); gnome((-4.5, 14, 0)); bench((-6, -4, 0), rot=R(90)); lamp((5, 26, 0)); lamp((-5, 34, 0))
trampoline((16, 0, 0), 2.0)
goat((2, -4, 0), rot=R(10), pose='run', scarf='orange')
goat((16, 0, 1.2), rot=R(-40), pose='jump', hat='cap', accent='red')
goat((-6, 6, 0), rot=R(-120), pose='lick', tongue=2.6)
hay_bale((-9.5, 8, 0), rot=R(30))
clouds(8, rad=250, z=80)
text('HOOFINGTON', (0, 120, 30), size=7, m='white', extrude=0.3)
camera((-2, -20, 10), (2, 22, 2), lens=24)
done.append(render('08_poi_hoofington'))
__result__ = done
