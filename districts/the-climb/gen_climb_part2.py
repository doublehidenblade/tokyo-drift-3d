#!/usr/bin/env python3
"""Part 2: export houses/shop, emit placements.json, copy reused prop GLBs."""
import bpy, math, random, json, os, shutil

OUT = '/home/hatch/workspace/ts-spaces/tokyo-drift/districts/the-climb/models'
SRC = '/home/hatch/workspace/ts-spaces/tokyo-drift/public/models/the-climb'
rng = random.Random(20260919)

# re-exec part1 to rebuild scene state (imports run top-level code)
exec(open('/home/hatch/workspace/ts-spaces/tokyo-drift/districts/the-climb/gen_climb_part1.py',
          encoding='utf-8').read().replace(
    "OUT = '/home/hatch/workspace/ts-spaces/tokyo-drift/districts/the-climb/models'",
    "OUT = '/home/hatch/workspace/ts-spaces/tokyo-drift/districts/the-climb/models'"))

# ---------- export houses / shop ----------
for variant, builder in HOUSE_BUILDERS.items():
    obj = builder().build('cl_house_' + variant, HOUSE_MATS)
    export_glb([obj], 'cl-house-%s.glb' % variant)
    bpy.data.objects.remove(obj, do_unlink=True)

shop_obj = build_shop().build('cl_shop', HOUSE_MATS)
export_glb([shop_obj], 'cl-shop.glb')
bpy.data.objects.remove(shop_obj, do_unlink=True)

# ---------- copy reused prop GLBs ----------
COPIES = {
    'bt-cl-sento.glb': 'cl-sento.glb',
    'bt-cl-lamp.glb': 'cl-lamp.glb',
    'bt-cl-pole.glb': 'cl-pole.glb',
    'bt-cl-pine.glb': 'cl-pine.glb',
    'bt-cl-rock.glb': 'cl-rock.glb',
    'bt-cl-cone.glb': 'cl-cone.glb',
    'bt-cl-sedan.glb': 'cl-sedan.glb',
    'bt-cl-ped.glb': 'cl-ped.glb',
    'bt-cl-stairs.glb': 'cl-stairs.glb',
    'bt-cl-kanban-red.glb': 'cl-kanban-red.glb',
    'bt-cl-kanban-orange.glb': 'cl-kanban-orange.glb',
    'bt-cl-kanban-green.glb': 'cl-kanban-green.glb',
}
for src, dst in COPIES.items():
    shutil.copy(os.path.join(SRC, src), os.path.join(OUT, dst))

# ---------- placements ----------
placements = {'houses': [], 'shops': [], 'sento': None, 'kanban': [], 'neon': [],
              'lamps': [], 'poles': [], 'pines': [], 'rocks': [], 'stairs': [],
              'sedan': None, 'cones': [], 'peds': []}

for st in sites:
    rec = {'x': round(st['x'], 2), 'z': round(st['z'], 2),
           'y': round(st['padY'], 2), 'rotY': round(st['rotY'], 3)}
    if st['kind'] == 'house':
        rec['variant'] = st['variant']
        placements['houses'].append(rec)
    elif st['kind'] == 'shop':
        placements['shops'].append(rec)
    elif st['kind'] == 'sento':
        placements['sento'] = rec

# kanban signs mounted on shop/sento facades (facade faces road via rotY)
KANBAN_WORDS = [
    ('cl-kanban-red.glb', '銭湯', '#a01010', '#ffe3e3', 21),
    ('cl-kanban-orange.glb', '居酒屋', '#c33d08', '#ffe9c9', 22),
    ('cl-kanban-green.glb', '喫茶店', '#0a6e35', '#e2ffe9', 23),
]
ki = 0
for shop in placements['shops'][:3]:
    f, word, bg, fg, seed = KANBAN_WORDS[ki % 3]
    ki += 1
    fx = math.sin(shop['rotY']); fz = math.cos(shop['rotY'])  # facade dir (local +Z)
    # blade sign: perpendicular to facade, arms reach back into the wall
    placements['kanban'].append({
        'file': f, 'word': word, 'bg': bg, 'fg': fg, 'seed': seed,
        'x': round(shop['x'] + fx * 3.45, 2), 'z': round(shop['z'] + fz * 3.45, 2),
        'y': round(shop['y'] + 0.4, 2), 'rotY': round(shop['rotY'] - math.pi / 2, 3)})
if placements['sento']:
    sn = placements['sento']
    fx = math.sin(sn['rotY']); fz = math.cos(sn['rotY'])
    placements['kanban'].append({
        'file': 'cl-kanban-red.glb', 'word': '温泉', 'bg': '#a01010', 'fg': '#ffe3e3',
        'seed': 24, 'x': round(sn['x'] + fx * 3.9, 2), 'z': round(sn['z'] + fz * 3.9, 2),
        'y': round(sn['y'] + 0.4, 2), 'rotY': round(sn['rotY'] - math.pi / 2, 3)})

# neon wall signs on the bottom commercial strip (attached to shop facades)
NEON_WORDS = [('温泉', '#ff2d78'), ('ラーメン', '#ffb020'), ('焼鳥', '#ff5a1f'), ('中華', '#22d3ee')]
for n, shop in enumerate(placements['shops']):
    word, color = NEON_WORDS[n % len(NEON_WORDS)]
    fx = math.sin(shop['rotY']); fz = math.cos(shop['rotY'])
    placements['neon'].append({
        'word': word, 'color': color, 'seed': 40 + n,
        'x': round(shop['x'] + fx * 3.28, 2), 'z': round(shop['z'] + fz * 3.28, 2),
        'y': round(shop['y'] + 5.7, 2), 'rotY': round(shop['rotY'], 3)})

# lamps along the road, alternating sides
li = 0
for s in np.arange(6, ROAD_LEN - 6, 11):
    p = road_at(s)
    side = 1 if (li % 2 == 0) else -1
    placements['lamps'].append({
        'x': round(p['x'] + side * 4.35 * p['nx'], 2),
        'z': round(p['z'] + side * 4.35 * p['nz'], 2),
        'y': round(p['y'] - 0.05, 2),
        # lamp head extends along local +X -> aim +X at the road
        'rotY': round(math.atan2(side * p['nz'], -side * p['nx']), 3),
        'side': side})
    li += 1

# utility poles, east side
for s in np.arange(10, ROAD_LEN - 10, 26):
    p = road_at(s)
    placements['poles'].append({
        'x': round(p['x'] + 5.6 * p['nx'], 2),
        'z': round(p['z'] + 5.6 * p['nz'], 2),
        'y': round(p['y'] - 0.1, 2)})

# pines scattered on the hill (east + top), clear of road and pads
pine_n = 0
tries = 0
while pine_n < 46 and tries < 800:
    tries += 1
    x = rng.uniform(-20, 85); z = rng.uniform(-65, 45)
    d, rp = nearest_road(x, z)
    if d < 12:
        continue
    if any(math.hypot(x - px, z - pz) < 9 for (px, pz, py, pr) in PADS):
        continue
    y = terrain_h(x, z)
    if y < 0.5:
        continue
    placements['pines'].append({'x': round(x, 2), 'z': round(z, 2), 'y': round(y - 0.2, 2),
                                's': round(rng.uniform(0.8, 1.5), 2),
                                'rotY': round(rng.uniform(0, 6.28), 2)})
    pine_n += 1

# rocks near road cuts
for s in (18, 47, 73, 95):
    p = road_at(s)
    side = -1 if s % 2 else 1
    rx = p['x'] + side * 6.4 * p['nx']; rz = p['z'] + side * 6.4 * p['nz']
    placements['rocks'].append({'x': round(rx, 2), 'z': round(rz, 2),
                                'y': round(terrain_h(rx, rz), 2)})

# stairs climbing the east terraces (two flights)
for s in (34, 68):
    p = road_at(s)
    sx = p['x'] + 10.5 * p['nx']; sz = p['z'] + 10.5 * p['nz']
    placements['stairs'].append({'x': round(sx, 2), 'z': round(sz, 2),
                                 'y': round(terrain_h(sx, sz), 2),
                                 'rotY': round(math.atan2(p['tx'], p['tz']) + math.pi / 2, 3)})

# parked sedan + cones + pedestrians
sp = road_at(58)
placements['sedan'] = {'x': round(sp['x'] - 2.2 * sp['nx'], 2),
                       'z': round(sp['z'] - 2.2 * sp['nz'], 2),
                       'y': round(sp['y'] + 0.02, 2),
                       'rotY': round(math.atan2(sp['tx'], sp['tz']), 3)}
cp = road_at(40)
for dx, dz in ((-2.6, 1.2), (-2.2, 2.4), (-2.9, 2.6)):
    placements['cones'].append({'x': round(cp['x'] + dx * cp['nx'], 2),
                                'z': round(cp['z'] + dz, 2),
                                'y': round(cp['y'] + 0.02, 2)})
for s, sd in ((50, 2.4), (80, -2.6)):
    p = road_at(s)
    placements['peds'].append({'x': round(p['x'] + sd * p['nx'], 2),
                               'z': round(p['z'] + sd * p['nz'], 2),
                               'y': round(p['y'] + 0.02, 2),
                               'rotY': round(rng.uniform(0, 6.28), 2)})

with open(os.path.join(OUT, 'placements.json'), 'w') as f:
    json.dump(placements, f, indent=1)
print('placements: houses=%d shops=%d lamps=%d pines=%d' % (
    len(placements['houses']), len(placements['shops']),
    len(placements['lamps']), len(placements['pines'])))

# ---------- manifest ----------
manifest = {
    'scene': 'the-climb v2',
    'units': 'meters',
    'notes': 'winding climbing road; houses on terraced pads; harbor south/west',
    'files': sorted(os.listdir(OUT)),
}
with open(os.path.join(OUT, 'climb-manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=1)
print('done ->', OUT)
