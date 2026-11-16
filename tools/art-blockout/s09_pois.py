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
ONLY = set(os.environ.get('GG_ONLY', '').split(',')) - {''}
def want(n): return not ONLY or n in ONLY

# 09 BAA-ARDWALK: pier + amusement park ------------------------------------------
if want('09'):
    outdoor((1920, 1080), 'sunset')
    cyl('beach', 60, 2.0, (0, -30, -1.0), 'sand', verts=40, outline=0)
    cyl('grassy', 50, 2.0, (0, -50, -0.9), 'grass', verts=40, outline=0)
    pier((0, 10, 0), L=70, w=14)
    ferris((14, 55, 2.75), r=11, rot=0)
    for i in range(6):
        palm(((-16 if i % 2 else 16) + (i // 2) * 2, -4 - (i // 2) * 7, 0), h=7 + i % 2, seed=i)
    for i in range(4):
        x = -4 + i * 3
        cyl('stall', 1.2, 2.8, (x - 2, 30 + i * 9, 4.2), ('red', 'yellow', 'teal', 'pink')[i], verts=8)
        cyl('stallroof', 1.8, 1.0, (x - 2, 30 + i * 9, 6.1), 'white', verts=8, r2=0.1)
    launch_pad((0, 20, 2.75), rot=0)
    trampoline((-4, 42, 2.75), 1.6)
    for i in range(4):
        beach_ball((-10 + i * 6, -16 + (i % 2) * 4, 0), 0.6)
    for i in range(3):
        buoy((-20 + i * 14, 40 + i * 8, -0.3), c=('red', 'yellow', 'red')[i])
    goat((0, 18, 4.5), rot=R(5), pose='jump', hat='headphones', accent='teal')
    goat((4, 8, 2.75), rot=R(-150), pose='bleat', scarf='pink')
    goat((-8, -10, 0), rot=R(30), pose='run', pattern='spots')
    clouds(8, rad=250, z=60, seed=3)
    text('BAA-ARDWALK', (8, 90, 30), size=6, m='white', extrude=0.3)
    camera((-9, -14, 7), (4, 40, 8), lens=24)
    done.append(render('09_poi_baaardwalk'))

# 10 CRANE YARD ----------------------------------------------------------------
if want('10'):
    outdoor((1920, 1080), 'day')
    island_base(300)
    box('lot', (70, 60, 0.1), (0, 20, 0.05), 'concrete', outline=0)
    crane((10, 40, 0), h=28, jib=26, rot=R(160))
    crane((-30, 60, 0), h=22, jib=20, rot=R(30))
    # half-built tower
    for f in range(6):
        for (dx, dy) in ((-6, -6), (6, -6), (-6, 6), (6, 6)):
            cyl('col', 0.5, 4, (-18 + dx, 30 + dy, 2 + f * 4), 'concrete', verts=6)
        if f < 5:
            box('slab', (14, 14, 0.5), (-18, 30, 4 + f * 4), 'concrete')
    scaffold((-27, 20, 0), w=8, h=14, d=2)
    for i in range(12):
        crate((8 + (i % 4) * 1.6, 8 + (i // 4) * 1.6, 0), s=1.4, rot=R(i * 7))
    for i in range(6):
        crate((8 + (i % 3) * 1.6, 8.8 + (i // 3) * 1.6, 1.4), s=1.4, rot=R(i * 13), m='orange' if i % 2 else 'wood')
    for i in range(8):
        cone((-4 + i * 2.2, 0, 0))
    for i in range(3):
        barrel((20 + i * 1.2, 2, 0), m='orange')
    box('girder', (10, 0.6, 0.8), (22, 46, 22), 'red', rot=(0, 0, R(160)))
    cyl('hook_cable', 0.03, 6, (22, 46, 25.4), 'black', verts=4, outline=0)
    goat((-12, 22, 20.5), rot=R(-30), pose='jump', hat='helmet', accent='yellow')
    goat((6, 4, 0), rot=R(40), pose='headbutt', hat='helmet', accent='orange')
    goat((-24, 18, 11), rot=R(80), pose='climb')
    clouds(8, rad=250, z=80, seed=5)
    text('CRANE YARD', (-5, 90, 36), size=6, m='white', extrude=0.3)
    camera((22, -26, 14), (-6, 30, 10), lens=24)
    done.append(render('10_poi_crane_yard'))

# 11 DOWNTOWN BLEATSVILLE: rooftop parkour ---------------------------------------
if want('11'):
    outdoor((1920, 1080), 'day')
    island_base(300)
    road((0, -40, 0), (0, 160, 0), w=10)
    road((-80, 40, 0), (80, 40, 0), w=10)
    shops = [('BAAKERY', 'pink'), ('HOOF & CO', 'cream'), ('KID ARCADE', 'gigga'), ('GOATFLIX', 'blue'), ('HAY MART', 'yellow'), ('CHEW-CHEW', 'teal')]
    for i in range(6):
        side = -1 if i % 2 == 0 else 1
        y = 10 + (i // 2) * 14
        n, c = shops[i]
        building((side * 13, y, 0), w=11, d=11, h=10 + (i * 5) % 13, c=('cream', 'white', 'pink', 'concrete', 'yellow', 'white')[i],
                 rot=R(-90 * side), sign=n, signc=c, awning=('red', 'teal', 'yellow', 'blue', 'barn', 'pink')[i])
    for i in range(4):
        building((-30 + i * 20, 80, 0), w=14, d=12, h=18 + i * 6, c=('concrete', 'cream', 'white', 'pink')[i])
    for i in range(6):
        lamp((6.5 if i % 2 else -6.5, 4 + i * 8, 0))
    for i in range(3):
        bench((-7.5, 15 + i * 14, 0), rot=R(90))
    cone((2, 20, 0)); cone((3, 21, 0)); mailbox((7, 12, 0))
    # goats parkouring across rooftops
    goat((-3, 4, 0), rot=R(10), pose='run', scarf='gigga')
    goat((-13, 24, 18.5), rot=R(70), pose='jump')
    goat((13, 10, 10.5), rot=R(-40), pose='run', hat='cap', accent='red')
    goat((-11, 38, 15.3), rot=R(200), pose='lick', tongue=3.0)
    launch_pad((-13, 10, 10.0), rot=R(90))
    clouds(8, rad=250, z=90, seed=7)
    text('DOWNTOWN BLEATSVILLE', (0, 130, 50), size=6, m='white', extrude=0.3)
    camera((3, -10, 5), (-1, 40, 9), lens=22)
    done.append(render('11_poi_downtown'))

# 12 MT. GIGGA: cliffs + summit dish ---------------------------------------------
if want('12'):
    outdoor((1920, 1080), 'day')
    island_base(500)
    hill('base', 110, 10, (0, 30, 0), 'grass2', seed=23, verts=14, rings=5)
    rnd = random.Random(8)
    zt = 0
    for t in range(7):
        r = 46 - t * 6
        h = 8.5
        cyl('tier', r, h, (rnd.uniform(-2, 2), 30 + rnd.uniform(-2, 2), zt + h / 2), 'rock' if t % 2 else 'rock2', verts=9, r2=r - 3.5)
        cyl('ledgegrass', r - 3.4, 0.5, (0, 30, zt + h + 0.1), 'grass2', verts=9, outline=0.02)
        zt += h
    for i in range(12):
        a_ = R(-110 + i * 9); rr = 40 - (i % 6) * 5.5
        box('climbface', (5, 0.8, 7.5), (math.cos(a_) * rr, 30 + math.sin(a_) * rr, 4 + (i % 6) * 8.5), mat('climb', (0.80, 0.76, 0.68)), rot=(0, 0, a_ + R(90)), bevel=0.15)
    dish((0, 30, zt), r=4)
    box('flag', (2, 0.1, 1.2), (4.5, 30, zt + 5), 'gigga', outline=0.02)
    cyl('flagpole', 0.08, 6, (3.5, 30, zt + 3), 'white', verts=6)
    goat((-14, -5, 17), rot=R(180), pose='climb', scarf='gigga')
    goat((6, -1, 34.5), rot=R(160), pose='bleat')
    goat((2, 26, zt), rot=R(200), pose='stand', hat='crown')
    goat((25, -10, 30), rot=R(30), pose='glide')
    clouds(12, rad=200, z=75, seed=9)
    text('MT. GIGGA', (0, 90, 80), size=8, m='white', extrude=0.3)
    camera((50, -75, 32), (0, 25, 28), lens=28)
    done.append(render('12_poi_mt_gigga'))

# 13 WHISPERING PINES: forest, river, waterfall, logs ------------------------------
if want('13'):
    outdoor((1920, 1080), 'day')
    island_base(400)
    hill('cliff', 40, 22, (0, 70, 0), 'rock2', seed=31, verts=12, rings=5)
    box('river', (8, 120, 0.2), (0, 10, 0.08), mat('riverm', PAL['sea'], rough=0.1), outline=0)
    box('falls', (7, 0.6, 20), (0, 50, 10), mat('fallm', (0.75, 0.92, 1.0), rough=0.1, emit=0.3), rot=(R(-12), 0, 0), outline=0)
    for i in range(8):
        ball('foam', 1.4, (-3 + i, 52, 0.5), 'white', outline=0, sub=1)
    rnd = random.Random(4)
    for i in range(70):
        x = rnd.uniform(-60, 60); y = rnd.uniform(-20, 90)
        if abs(x) < 8: continue
        tree((x, y, 0), rnd.uniform(1.0, 1.8), 'pine' if rnd.random() < 0.75 else 'round', i)
    for i in range(5):
        cyl('log', 0.6, 7, (-14 + i * 6, 6 + i * 3, 0.6), 'wood', rot=(0, R(90), R(20 * i)), verts=10)
    cyl('logbridge', 0.8, 12, (0, 18, 1.0), 'wood', rot=(0, R(90), 0), verts=10)
    for i in range(6):
        rock((-10 + i * 4, 30 + (i % 2) * 6, 0.4), 1.2, i)
    goat((0, 18, 2.6), rot=R(90), pose='run')
    goat((-12, 8, 1.2), rot=R(-60), pose='flop')
    goat((5, 10, 0), rot=R(-160), pose='lick', tongue=2.4, hat='flower')
    text('WHISPERING PINES', (0, 110, 34), size=6, m='white', extrude=0.3)
    camera((-14, -22, 9), (2, 30, 7), lens=24)
    done.append(render('13_poi_whispering_pines'))

# 14 THE DAM --------------------------------------------------------------------
if want('14'):
    outdoor((1920, 1080), 'day')
    island_base(400)
    hill('valL', 60, 30, (-60, 40, 0), 'grass2', seed=41)
    hill('valR', 60, 30, (60, 40, 0), 'grass2', seed=42)
    box('reservoir', (90, 60, 0.2), (0, 70, 14), mat('res', PAL['deep'], rough=0.1), outline=0)
    box('dam', (70, 6, 18), (0, 38, 9), 'concrete', bevel=0.2)
    box('damtop', (72, 7, 1.0), (0, 38, 18.5), 'concrete', bevel=0.1)
    for i in range(5):
        box('spill', (6, 4, 14), (-20 + i * 10, 34.5, 7), mat('spillw', (0.75, 0.92, 1.0), rough=0.1, emit=0.25), rot=(R(15), 0, 0), outline=0)
    for i in range(12):
        box('rail', (0.2, 0.2, 1.2), (-33 + i * 6, 35.2, 19.6), 'yellow', outline=0.01)
    box('river', (30, 50, 0.2), (0, 8, 0.1), mat('riverm', PAL['sea'], rough=0.1), outline=0)
    box('control', (8, 6, 6), (28, 38, 22), 'cream', bevel=0.1)
    box('ctrlroof', (8.6, 6.6, 0.5), (28, 38, 25.2), 'barn')
    goat((-6, 38, 19), rot=R(90), pose='run', hat='cap')
    goat((10, 34, 12), rot=R(180), pose='flop')
    for i in range(4):
        barrel((-12 + i * 7, 12 + i * 3, 0), m='orange')
    text('THE DAM', (0, 100, 40), size=7, m='white', extrude=0.3)
    camera((-30, -25, 20), (0, 38, 10), lens=26)
    done.append(render('14_poi_the_dam'))

# 15 OLD LIGHTHOUSE -------------------------------------------------------------
if want('15'):
    outdoor((1920, 1080), 'sunset')
    hill('point', 30, 10, (0, 30, 0), 'rock2', seed=51, verts=12, rings=4)
    hill('grasscap', 18, 11, (0, 30, 0.2), 'grass2', seed=52, verts=12, rings=3)
    lighthouse((0, 30, 9.5), h=20)
    house((10, 26, 8.0), w=6, d=5, h=4, wall='white', roofm='red', rot=R(-30))
    for i in range(10):
        rock((math.cos(i) * 26, 30 + math.sin(i) * 26, -0.2), 2.5, i, m='rock')
    # shipwreck + secret cave hint
    box('wreck', (12, 4, 3), (-30, 10, 0.5), 'wood2', rot=(R(10), R(20), R(30)))
    box('mast', (0.5, 0.5, 9), (-30, 10, 4), 'wood2', rot=(R(25), 0, 0))
    ball('cave', 4, (14, 16, 0), mat('cavem', (0.05, 0.05, 0.08)), scale=(1, 0.5, 0.8), outline=0)
    ball('relic', 0.6, (13, 14.5, 1), mat('relicm', PAL['yellow'], emit=4), outline=0.02)
    goat((-4, 22, 9), rot=R(-160), pose='bleat', hat='tophat')
    goat((-29, 10, 3.2), rot=R(40), pose='stand', hat='helmet', accent='red')
    clouds(8, rad=200, z=50, seed=11)
    text('OLD LIGHTHOUSE', (0, 70, 40), size=6, m='white', extrude=0.3)
    camera((-40, -30, 12), (0, 30, 12), lens=28)
    done.append(render('15_poi_lighthouse'))

__result__ = done
