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

def _frame(cam, d):
    sc = bpy.context.scene
    hw = d * 18.0 / cam.data.lens
    return hw, hw * sc.render.resolution_y / sc.render.resolution_x

def hud_plane(cam, name, w, h, x, y, color, emit=1.0, alpha=1.0, d=2.0):
    """Camera-parented plane; x,y,w,h in normalised frame units (-1..1)."""
    hw, hh = _frame(cam, d)
    w, h, x, y = w * hw, h * hw, x * hw, y * hh
    o = box(name, (w, h, 0.001), (0, 0, 0), mat(name + 'm', color, emit=emit, alpha=alpha), outline=0, bevel=0)
    o.parent = cam
    o.location = (x, y, -d)
    o.rotation_euler = (0, 0, 0)
    return o

def hud_text(cam, s, x, y, size, color=(1, 1, 1), d=1.99, align='CENTER'):
    hw, hh = _frame(cam, d)
    x, y, size = x * hw, y * hh, size * hw
    t = text(s, (0, 0, 0), size=size, m=mat('ht' + s[:6], color, emit=2.0), extrude=0, rot=(0, 0, 0), align=align)
    t.parent = cam
    t.location = (x, y, -d)
    return t

# 16 RISING TIDE party mode ----------------------------------------------------------
if want('16'):
    outdoor((1920, 1080), 'storm')
    island_base(140, sand=True)
    zt = 0
    for t in range(5):
        r = 26 - t * 4.5
        cyl('tier', r, 3, (0, 0, zt + 1.5), 'grass2' if t < 3 else 'rock', verts=11, r2=r - 1.5)
        zt += 3
    house((-12, 6, 3), w=5, d=4, h=3.5, wall='cream', roofm='barn')
    house((11, 5, 3), w=5, d=4, h=3.5, wall='pink', roofm='roof')
    # risen sea: semi-transparent water at 9 m
    box('tide', (600, 600, 0.2), (0, 0, 4.5), mat('tidew', PAL['sea'], rough=0.05, alpha=0.82), outline=0)
    for i in range(10):
        a = i * 0.63
        ball('foam', 0.8, (math.cos(a) * 19, math.sin(a) * 19, 4.6), 'white', outline=0, sub=1, scale=(2, 1, 0.3))
    goat((-5, -12, 6), rot=R(30), pose='headbutt', hat='cap', accent='blue')
    goat((-2, -9.5, 6.3), rot=R(-150), pose='flop', pattern='spots')
    goat((5, -11, 6), rot=R(160), pose='bleat', hat='traffic')
    goat((0, 0, 15), rot=R(200), pose='stand', hat='crown')
    goat((-6, -20, 4.6), rot=R(80), pose='flop', scarf='pink')
    for i in range(6):
        ball('splash', 0.3 + 0.08 * i, (-6 + (i - 3) * 0.5, -20.5 + (i % 2), 4.8 + i * 0.2), 'white', outline=0, sub=1)
    for i in range(3):
        crate((-8 + i * 7, -14 + (i % 2) * 2, 6), s=1.0, rot=R(i * 30))
    hay_bale((8, -6, 9), round_=True)
    cam = camera((-14, -38, 16), (0, -4, 6), lens=32)
    hud_plane(cam, 'tidebar', 0.6, 0.035, 0, 0.88, PAL['deep'], emit=1.0, alpha=0.9)
    hud_plane(cam, 'tidefill', 0.4, 0.025, -0.1, 0.88, PAL['teal'], emit=1.5, d=1.99)
    hud_text(cam, 'TIDE RISING  -  6 GOATS LEFT', 0, 0.76, 0.035)
    done.append(render('16_mode_rising_tide'))

# 17 GIGGA MODE chaos in downtown -----------------------------------------------------
if want('17'):
    outdoor((1920, 1080), 'day')
    island_base(300)
    road((0, -40, 0), (0, 160, 0), w=12)
    for i in range(6):
        side = -1 if i % 2 == 0 else 1
        building((side * 15, 10 + (i // 2) * 16, 0), w=12, d=12, h=9 + (i * 4) % 9, c=('cream', 'white', 'pink', 'concrete', 'yellow', 'white')[i], rot=R(-90 * side))
    g = goat((0, 22, 0), rot=R(-15), s=3.0, horns='gigga', pose='headbutt', scarf='gigga')
    # flying debris + cars knocked
    rnd = random.Random(2)
    for i in range(18):
        crate((rnd.uniform(-8, 8), rnd.uniform(28, 40), rnd.uniform(2, 14)), s=rnd.uniform(0.8, 1.6), rot=rnd.uniform(0, 6), m=rnd.choice(['wood', 'orange', 'hay']))
    for i in range(3):
        box('car', (2.2, 4.2, 1.5), (6 - i * 5, 36 + i * 3, 3 + i * 3), ('red', 'blue', 'yellow')[i], rot=(rnd.uniform(0, 1), rnd.uniform(0, 1), rnd.uniform(0, 3)), bevel=0.3)
    # GIGGA aura rings
    for r in (5, 7.5, 10):
        torus('aura', r, 0.12, (0, 22, 0.3), mat('auram', PAL['gigga'], emit=3.0), rot=(0, 0, 0))
    goat((-6, 4, 0), rot=R(20), s=0.6, pose='run', hat='cap', accent='green')
    goat((5, 6, 0), rot=R(-30), s=1.0, pose='jump')
    cam = camera((10, -16, 7), (-1, 22, 9), lens=24)
    hud_plane(cam, 'gmback', 0.42, 0.04, -0.7, -0.85, (0.1, 0.1, 0.15), emit=0.5, alpha=0.8)
    hud_plane(cam, 'gmfill', 0.40, 0.028, -0.7, -0.85, PAL['gigga'], emit=2.5)
    hud_text(cam, 'GIGGA!', -0.7, -0.74, 0.05, PAL['yellow'])
    hud_text(cam, 'GOAT-ROCKET  x6', 0.62, 0.85, 0.055, PAL['yellow'])
    hud_text(cam, '+ TOPPLE  + DESTRUCTION  + BIG SPLASH', 0.62, 0.74, 0.025)
    done.append(render('17_gigga_mode_chaos'))

# 18 BILLY ISLE map (top-down) ----------------------------------------------------------
if want('18'):
    reset((1600, 1600), sky_top=PAL['deep'], sky_bottom=PAL['deep'], strength=1.0)
    sun(rot=(30, 0, 40), energy=3.0)
    water(3000, (0, 0, -0.3))
    # irregular island: union of blobs
    rnd = random.Random(12)
    for i in range(14):
        a = i / 14 * 2 * math.pi
        d = 170 + rnd.uniform(-40, 40)
        cyl('sandblob', 120 + rnd.uniform(-20, 20), 1.0, (math.cos(a) * d * 0.55, math.sin(a) * d * 0.55, -0.4), 'sand', verts=18, outline=0)
        cyl('grassblob', 105 + rnd.uniform(-20, 20), 1.0, (math.cos(a) * d * 0.5, math.sin(a) * d * 0.5, -0.1), 'grass', verts=18, outline=0)
    # mountain center
    zt = 0
    for t in range(6):
        cyl('tier', 70 - t * 10, 10, (10, 20, zt + 5), 'rock' if t % 2 else 'rock2', verts=9, r2=66 - t * 10, outline=0.3)
        zt += 10
    # river & forest NW
    for i in range(12):
        box('river', (8, 22, 1), (-40 - i * 9, 60 + i * 6, 0.1), mat('riverm', PAL['sea']), rot=(0, 0, R(-55)), outline=0)
    for i in range(80):
        x = rnd.uniform(-220, -80); y = rnd.uniform(40, 200)
        cyl('pine', 6, 10, (x, y, 5), 'pine', verts=6, r2=0.3, outline=0.2)
    # dam reservoir N
    cyl('reservoir', 45, 1.2, (40, 200, 0.4), mat('res', PAL['deep']), verts=16, outline=0)
    box('dam', (70, 8, 6), (40, 160, 3), 'concrete', outline=0.3)
    # roads ring + spokes
    for i in range(24):
        a0 = i / 24 * 2 * math.pi; a1 = (i + 1) / 24 * 2 * math.pi
        road((math.cos(a0) * 150, math.sin(a0) * 150, 1.0), (math.cos(a1) * 150, math.sin(a1) * 150, 1.0), w=8, dashes=False)
    # POI markers
    pois = [('HOOFINGTON', (-60, -170)), ('BAA-ARDWALK', (150, -180)), ('CRANE YARD', (200, 20)), ('DOWNTOWN\nBLEATSVILLE', (120, -60)),
            ('MT. GIGGA', (10, 20)), ('WHISPERING\nPINES', (-160, 120)), ('THE DAM', (40, 200)), ('OLD\nLIGHTHOUSE', (-250, -60))]
    for name, (x, y) in pois:
        cyl('pin', 9, 3, (x, y, 70), mat('pinm', PAL['orange'], emit=1.0), verts=16, outline=0.5)
        t = text(name, (x, y - 22, 72), size=13, m=mat('lbl', (1, 1, 1), emit=1.5), rot=(0, 0, 0), extrude=0)
    # landmarks
    barn((-60, -150, 0), s=3.0); ferris((150, -215, 0), r=18); crane((200, 40, 0), h=30, jib=30)
    for i in range(10):
        building((100 + (i % 4) * 18, -40 - (i // 4) * 18, 0), w=12, d=12, h=8 + i * 2)
    cyl('islet', 40, 1.0, (-250, -70, -0.2), 'sand', verts=14, outline=0)
    cyl('isletrock', 30, 3.0, (-250, -70, 0.5), 'rock2', verts=10, outline=0.3)
    lighthouse((-250, -80, 2), h=25)
    pier((150, -230, 0), L=60, w=12, rot=R(180))
    text('BILLY ISLE', (0, 330, 72), size=34, m=mat('ttl', PAL['yellow'], emit=1.0), rot=(0, 0, 0), extrude=0)
    camera((0, 20, 900), (0, 20, 0), lens=50, ortho=720)
    done.append(render('18_billy_isle_map'))

# 19 HUD mockup over a gameplay shot ------------------------------------------------
if want('19'):
    outdoor((1920, 1080), 'day')
    island_base(300)
    road((0, -40, 0), (0, 100, 0), w=6)
    barn((-18, 30, 0)); windmill((22, 50, 0), rot=R(-20))
    for i in range(8):
        hay_bale((-12 + i * 3, 14, 0), rot=R(i * 20), round_=(i % 2 == 0))
    house((14, 18, 0), w=7, d=6, h=4.5, wall='cream', roofm='barn', rot=R(-90))
    goat((0, 1, 0.0), rot=R(-20), pose='run', scarf='orange')
    box('ghostwall', (4, 0.35, 4), (0, 12, 2), mat('ghost', PAL['teal'], emit=1.5, alpha=0.35), outline=0)
    for i in range(3):
        box('built', (4, 4, 0.3), (-4 + i * 4, 8, 0.15), 'hay', bevel=0.06)
    cam = camera((0, -10, 6), (0, 10, 1), lens=28)
    hud_plane(cam, 'gback', 0.42, 0.04, -0.72, 0.86, (0.08, 0.08, 0.12), emit=0.4, alpha=0.85)
    hud_plane(cam, 'gfill', 0.26, 0.028, -0.79, 0.86, PAL['gigga'], emit=2.5, d=1.99)
    hud_text(cam, 'GIGGA METER   BILLY -> BIG', -0.72, 0.74, 0.024, PAL['yellow'])
    hud_text(cam, 'LICK-SLINGSHOT', 0.72, 0.84, 0.05, PAL['yellow'])
    hud_text(cam, 'x3 combo   1,240 style', 0.72, 0.72, 0.028)
    hud_text(cam, 'GOAT GIG: Hay Haul   3/8 bales   01:24', 0, 0.9, 0.028)
    for i in range(16):
        a_ = i / 16 * 2 * math.pi
        hud_plane(cam, 'st%d' % i, 0.016, 0.016, -0.86 + math.cos(a_) * 0.045, -0.72 + math.sin(a_) * 0.08, PAL['green'] if i < 11 else (0.3, 0.3, 0.3), emit=2.0)
    hud_text(cam, 'STAMINA', -0.86, -0.92, 0.02)
    for i, (lab, c) in enumerate((('FLOOR', 'hay'), ('WALL', 'hay'), ('RAMP', 'wood'), ('PAD', 'orange'))):
        x = -0.18 + i * 0.12
        hud_plane(cam, 'slot%d' % i, 0.1, 0.1, x, -0.74, PAL[c], emit=0.8, alpha=0.95)
        hud_text(cam, f'{i+1} {lab}', x, -0.94, 0.018)
    hud_text(cam, 'HAY 34   WOOD 12   SCRAP 3', 0, -0.54, 0.022)
    hud_plane(cam, 'mmsea', 0.2, 0.2, 0.86, -0.66, PAL['sea'], emit=0.6, alpha=0.9, d=2.01)
    hud_plane(cam, 'mm', 0.16, 0.16, 0.86, -0.66, PAL['grass'], emit=0.6, alpha=0.9)
    hud_plane(cam, 'mmme', 0.02, 0.02, 0.86, -0.66, PAL['orange'], emit=3, d=1.98)
    hud_text(cam, 'HOOFINGTON', 0.86, -0.97, 0.02)
    done.append(render('19_hud_mockup'))

# 20 palette ---------------------------------------------------------------------------
if want('20'):
    reset((1920, 1080), sky_top=(0.96, 0.96, 0.94), sky_bottom=(0.96, 0.96, 0.94), strength=0.0)
    keys = ['sky', 'sea', 'deep', 'sand', 'grass', 'grass2', 'pine', 'rock', 'rock2', 'snow', 'hay', 'wood', 'wood2', 'barn', 'roof',
            'cream', 'fur', 'horn', 'hoof', 'tongue', 'gigga', 'orange', 'yellow', 'teal', 'pink', 'red', 'blue', 'green', 'concrete', 'asphalt']
    cam = camera((0, -1, 50), (0, -1, 0), lens=50, ortho=38)
    box('bg', (80, 50, 0.1), (0, 0, -0.5), mat('bgm', (0.96, 0.96, 0.94), emit=1.0), outline=0)
    for i, k in enumerate(keys):
        c, r = i % 6, i // 6
        x, y = -14 + c * 5.6, 8.5 - r * 4.3
        o = box('sw' + k, (4.6, 2.6, 0.1), (x, y + 0.6, 0), mat('pal' + k, PAL[k], emit=1.0), outline=0, bevel=0.1)
        hx = '#%02X%02X%02X' % tuple(int(v * 255) for v in PAL[k])
        text(f'{k}  {hx}', (x, y - 1.3, 0.2), size=0.55, m=mat('ink', (0.1, 0.1, 0.1), emit=1.0), rot=(0, 0, 0), extrude=0)
    text('GIGGA-GOAT PALETTE (sRGB). UI accent = gigga purple + orange + yellow', (0, 12.3, 0.2), size=0.8, m=mat('ink', (0.1, 0.1, 0.1), emit=1.0), rot=(0, 0, 0), extrude=0)
    done.append(render('20_palette'))

__result__ = done
