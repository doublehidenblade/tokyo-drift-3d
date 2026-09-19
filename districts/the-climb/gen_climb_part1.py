#!/usr/bin/env python3
"""Generate the-climb v2 assets: winding road, terraced terrain, tiled-roof houses,
harbor. Exports GLBs + placements.json + centerline.json into districts/the-climb/models/."""
import bpy, math, random, json, os
import numpy as np

OUT = '/home/hatch/workspace/ts-spaces/tokyo-drift/districts/the-climb/models'
os.makedirs(OUT, exist_ok=True)
rng = random.Random(20260919)

# ---------- wipe ----------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for coll in (bpy.data.meshes, bpy.data.materials):
    for x in list(coll):
        coll.remove(x)
for im in list(bpy.data.images):
    if im.name.startswith('CL_'):
        bpy.data.images.remove(im)

def sstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

# ---------- road centerline (bottom -> top) ----------
CTRL = [
    ( 8.0,  52.0,  0.0),
    ( 4.0,  40.0,  0.9),
    (-1.0,  30.0,  1.9),
    (-6.0,  20.0,  3.0),
    (-6.5,  10.0,  4.1),
    (-2.0,   1.0,  5.2),
    ( 3.0,  -8.0,  6.3),
    ( 7.5, -18.0,  7.4),
    ( 9.0, -28.0,  8.5),
    ( 7.0, -38.0,  9.6),
    ( 3.0, -47.0, 10.6),
]

def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    out = []
    for a, b, c, d in zip(p0, p1, p2, p3):
        out.append(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2
                         + (-a + 3 * b - 3 * c + d) * t3))
    return out

S = []  # samples: dicts x,y,z, tx,tz (tangent xz), nx,nz (normal xz), s (arclen)
P = [CTRL[0]] + CTRL + [CTRL[-1]]
SEG = 14
for i in range(len(CTRL) - 1):
    p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
    for j in range(SEG):
        S.append(catmull(p0, p1, p2, p3, j / SEG))
S.append(tuple(CTRL[-1]))
# NOTE: CTRL tuples are (x, z, y); remap to x/y/z dicts here.
S = [{'x': p[0], 'y': p[2], 'z': p[1], 'tx': 0, 'tz': 0, 'nx': 0, 'nz': 0, 's': 0.0}
     for p in ([c[0], c[1], c[2]] for c in
               [catmull(P[i], P[i+1], P[i+2], P[i+3], j / SEG)
                for i in range(len(CTRL) - 1) for j in range(SEG)] + [tuple(CTRL[-1])])]
acc = 0.0
for k in range(len(S)):
    if k:
        acc += math.dist((S[k]['x'], S[k]['z']), (S[k-1]['x'], S[k-1]['z']))
    S[k]['s'] = acc
    a = S[max(0, k - 1)]; b = S[min(len(S) - 1, k + 1)]
    tx, tz = b['x'] - a['x'], b['z'] - a['z']
    L = math.hypot(tx, tz) or 1.0
    S[k]['tx'], S[k]['tz'] = tx / L, tz / L
    S[k]['nx'], S[k]['nz'] = tz / L, -tx / L

def road_at(s):
    """interpolate centerline at arclength s"""
    if s <= 0: return S[0]
    for k in range(1, len(S)):
        if S[k]['s'] >= s:
            a, b = S[k - 1], S[k]
            t = (s - a['s']) / max(1e-6, b['s'] - a['s'])
            return {kk: a[kk] + (b[kk] - a[kk]) * t for kk in ('x', 'y', 'z', 'tx', 'tz', 'nx', 'nz')}
    return S[-1]

ROAD_LEN = S[-1]['s']
print('road length %.1f m, %d samples' % (ROAD_LEN, len(S)))

# ---------- terrain height field ----------
def base_hill(x, z):
    if z > 56 or x < -58:
        return -2.6
    h = max(0.0, (-z + 30.0)) * 0.12
    h += max(0.0, (x - 10.0)) * 0.20
    return h

def terrace(h):
    step = 2.2
    t = h / step
    i = math.floor(t)
    f = t - i
    return (i + sstep(0.70, 0.98, f)) * step

PADS = []  # (x, z, y, r)

def nearest_road(x, z):
    best = None
    bd = 1e9
    for p in S[::2]:
        d = (x - p['x']) ** 2 + (z - p['z']) ** 2
        if d < bd:
            bd = d; best = p
    return math.sqrt(bd), best

def terrain_h(x, z):
    d, rp = nearest_road(x, z)
    h_road = rp['y'] - 0.15
    hb = base_hill(x, z)
    if hb > 0.4 and x > rp['x'] + 6.0:
        hb = terrace(hb)
    if d < 5.0:
        h = h_road
    elif d < 14.0:
        h = h_road + (hb - h_road) * sstep(5.0, 14.0, d)
    else:
        h = hb
    for (px, pz, py, pr) in PADS:
        dd = math.hypot(x - px, z - pz)
        if dd < pr:
            return py
        elif dd < pr + 3.0:
            h = py + (h - py) * sstep(pr, pr + 3.0, dd)
    # gentle noise away from road
    if d > 14.0 and hb > -2.0:
        h += math.sin(x * 0.35 + z * 0.21) * 0.35 + math.sin(x * 0.11 - z * 0.43) * 0.5
    return h

# ---------- house/shop site selection (before final terrain: pads) ----------
sites = []  # dicts: kind, sample_idx, side, variant/word
idx = 10
k = 0
while idx < len(S) - 12:
    side = 1 if (k % 2 == 0) else -1
    off = (8.5 + rng.random() * 3.5) if side > 0 else (8.0 + rng.random() * 2.5)
    p = S[idx]
    hx = p['x'] + side * off * p['nx']
    hz = p['z'] + side * off * p['nz']
    if hz < 48 and hx > -52:  # keep out of water
        variant = ['a', 'b', 'c', 'a', 'b'][k % 5]
        sites.append({'kind': 'house', 'variant': variant, 'i': idx, 'side': side,
                      'x': hx, 'z': hz})
    idx += 8 + rng.randint(0, 3)
    k += 1
# shops near the bottom (harbor commercial strip) + one at top
shop_is = [16, 24, 33]
for si in shop_is:
    p = S[si]
    side = 1 if si % 2 == 0 else -1
    off = 8.0 + rng.random() * 1.5
    sites.append({'kind': 'shop', 'i': si, 'side': side,
                  'x': p['x'] + side * off * p['nx'],
                  'z': p['z'] + side * off * p['nz']})
# sento landmark: bottom, east side, bigger offset
p = S[20]
sites.append({'kind': 'sento', 'i': 20, 'side': 1,
              'x': p['x'] + 12.5 * p['nx'], 'z': p['z'] + 12.5 * p['nz']})

for st in sites:
    st['padY'] = terrain_h(st['x'], st['z'])
    PADS.append((st['x'], st['z'], st['padY'], 7.0))
    rp = S[st['i']]
    dx, dz = rp['x'] - st['x'], rp['z'] - st['z']
    st['rotY'] = math.atan2(dx, dz)  # facade +Z faces road

print('sites:', len(sites))

with open(os.path.join(OUT, 'centerline.json'), 'w') as f:
    json.dump([{'x': round(p['x'], 2), 'y': round(p['y'], 2), 'z': round(p['z'], 2),
                'tx': round(p['tx'], 3), 'tz': round(p['tz'], 3),
                'nx': round(p['nx'], 3), 'nz': round(p['nz'], 3), 's': round(p['s'], 2)}
               for p in S], f)

# =====================================================================
# mesh builder
# =====================================================================
class MB:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.mats = []   # per-face material index
        self.uvs = []    # per-face list of (u,v)

    def _box_corners(self, cx, cy, cz, sx, sy, sz, yaw=0.0):
        hx, hy, hz = sx / 2, sy / 2, sz / 2
        pts = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
               (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
        cyaw, syaw = math.cos(yaw), math.sin(yaw)
        out = []
        for (lx, ly, lz) in pts:
            wx = lx * cyaw + lz * syaw + cx
            wz = -lx * syaw + lz * cyaw + cz
            out.append((wx, ly + cy, wz))
        return out

    def add_box(self, cx, cy, cz, sx, sy, sz, mat, yaw=0.0, uv_world=0.0):
        c = self._box_corners(cx, cy, cz, sx, sy, sz, yaw)
        # outward-facing windings (verified by hand)
        quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                 (3, 7, 6, 2), (1, 2, 6, 5), (0, 4, 7, 3)]
        base = len(self.verts)
        self.verts.extend(c)
        for q in quads:
            self.faces.append(tuple(base + i for i in q))
            self.mats.append(mat)
            if uv_world > 0:
                # world-scale uvs per face from corner coords
                us = []
                for i in q:
                    us.append((c[i][0] / uv_world, (c[i][1] + c[i][2]) / uv_world))
            else:
                us = [(0, 0), (1, 0), (1, 1), (0, 1)]
            self.uvs.append(us)

    def add_quad(self, v0, v1, v2, v3, mat, uv=None):
        base = len(self.verts)
        self.verts.extend([v0, v1, v2, v3])
        self.faces.append((base, base + 1, base + 2, base + 3))
        self.mats.append(mat)
        self.uvs.append(uv or [(0, 0), (1, 0), (1, 1), (0, 1)])

    def add_tri(self, v0, v1, v2, mat, uv=None):
        base = len(self.verts)
        self.verts.extend([v0, v1, v2])
        self.faces.append((base, base + 1, base + 2))
        self.mats.append(mat)
        self.uvs.append(uv or [(0, 0), (1, 0), (0.5, 1)])

    def add_gable(self, cx, base_y, cz, w, d, h, ov, axis, mat, uv_world=3.0):
        """closed roof prism; ridge along axis ('x' or 'z'). windings point outward."""
        if axis == 'x':
            x0, x1 = cx - (w / 2 + ov), cx + (w / 2 + ov)
            z0, z1 = cz - (d / 2 + ov), cz + (d / 2 + ov)
            uw = (x1 - x0) / uv_world
            slope = math.hypot((z1 - z0) / 2, h) / uv_world
            # south slope (faces -z/+y)
            self.add_quad((x0, base_y, z0), (x0, base_y + h, cz),
                          (x1, base_y + h, cz), (x1, base_y, z0),
                          mat, [(0, 0), (0, slope), (uw, slope), (uw, 0)])
            # north slope (faces +z/+y)
            self.add_quad((x0, base_y, z1), (x1, base_y, z1),
                          (x1, base_y + h, cz), (x0, base_y + h, cz),
                          mat, [(0, 0), (uw, 0), (uw, slope), (0, slope)])
            # gable ends
            self.add_tri((x1, base_y, z1), (x1, base_y, z0), (x1, base_y + h, cz), mat)
            self.add_tri((x0, base_y, z0), (x0, base_y, z1), (x0, base_y + h, cz), mat)
            # underside (closes the prism)
            self.add_quad((x0, base_y, z0), (x1, base_y, z0),
                          (x1, base_y, z1), (x0, base_y, z1), mat)
            # ridge cap
            self.add_box(cx, base_y + h + 0.06, cz, w + 2 * ov, 0.16, 0.34, mat,
                         uv_world=uv_world)
        else:
            z0, z1 = cz - (d / 2 + ov), cz + (d / 2 + ov)
            x0, x1 = cx - (w / 2 + ov), cx + (w / 2 + ov)
            uw = (z1 - z0) / uv_world
            slope = math.hypot((x1 - x0) / 2, h) / uv_world
            # west slope (faces -x/+y)
            self.add_quad((x0, base_y, z0), (cx, base_y + h, z0),
                          (cx, base_y + h, z1), (x0, base_y, z1),
                          mat, [(0, 0), (0, slope), (uw, slope), (uw, 0)])
            # east slope (faces +x/+y)
            self.add_quad((x1, base_y, z0), (cx, base_y + h, z0),
                          (cx, base_y + h, z1), (x1, base_y, z1),
                          mat, [(0, 0), (0, slope), (uw, slope), (uw, 0)])
            # gable ends
            self.add_tri((x0, base_y, z1), (x1, base_y, z1), (cx, base_y + h, z1), mat)
            self.add_tri((x1, base_y, z0), (x0, base_y, z0), (cx, base_y + h, z0), mat)
            # underside
            self.add_quad((x0, base_y, z0), (x1, base_y, z0),
                          (x1, base_y, z1), (x0, base_y, z1), mat)
            # ridge cap
            self.add_box(cx, base_y + h + 0.06, cz, 0.34, 0.16, d + 2 * ov, mat,
                         uv_world=uv_world)

    def build(self, name, materials, smooth=False, double_sided=()):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        for m in materials:
            mesh.materials.append(m)
        for poly, mi in zip(mesh.polygons, self.mats):
            poly.material_index = mi
        uv = mesh.uv_layers.new(name='UVMap')
        for poly, fuv in zip(mesh.polygons, self.uvs):
            for li, (u, v) in zip(poly.loop_indices, fuv):
                uv.data[li].uv = (u, v)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        # normals from authored windings (verified outward by hand)
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        if smooth:
            for poly in mesh.polygons:
                poly.use_smooth = True
        return obj


def std_mat(name, color=(0.5, 0.5, 0.5, 1), rough=0.9, metallic=0.0,
            emission=None, emission_strength=0.0, image=None, emission_image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metallic
    if image is not None:
        tex = m.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
        if emission_image is not None:
            tex = m.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image = emission_image
            m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
    return m


def numpy_image(name, w, h, fn):
    img = bpy.data.images.new('CL_' + name, w, h, alpha=False)
    arr = np.zeros((h, w, 4), dtype=np.float32)
    fn(arr)
    arr[:, :, 3] = 1.0
    img.pixels[:] = arr.reshape(-1).tolist()
    img.pack()
    return img

# ---------- procedural textures ----------
def stone_fn(arr):
    h, w, _ = arr.shape
    arr[:, :] = (0.16, 0.15, 0.16, 1)
    row_h = 32
    for ry in range(0, h, row_h):
        off = (ry // row_h) % 2 * 30
        x = -off
        while x < w:
            bw = 44 + rng.randint(0, 26)
            v = 0.42 + rng.random() * 0.22
            arr[ry:ry + row_h - 3, max(0, x):min(w, x + bw - 3), 0] = v * (0.95 + rng.random() * 0.1)
            arr[ry:ry + row_h - 3, max(0, x):min(w, x + bw - 3), 1] = v * 0.94
            arr[ry:ry + row_h - 3, max(0, x):min(w, x + bw - 3), 2] = v * 0.88
            x += bw
    noise = np.random.rand(h, w) * 0.08
    arr[:, :, 0] += noise * 0.5
    arr[:, :, 1] += noise * 0.5
    arr[:, :, 2] += noise * 0.5

def tile_fn(arr):
    h, w, _ = arr.shape
    yy, xx = np.mgrid[0:h, 0:w]
    row = (yy // 16)
    ph = ((xx + (row % 2) * 16) % 32) / 32 * math.pi
    v = 0.16 + 0.10 * np.abs(np.sin(ph)) + np.where((yy % 16) < 2, -0.06, 0.0)
    arr[:, :, 0] = v * 0.9
    arr[:, :, 1] = v * 0.95
    arr[:, :, 2] = v * 1.15

def window_wall_fn(arr):
    """warm lit windows grid for distant harbor blocks"""
    h, w, _ = arr.shape
    arr[:, :] = (0.008, 0.010, 0.016, 1)
    for ry in range(8, h - 8, 18):
        for rx in range(8, w - 8, 16):
            r = rng.random()
            if r < 0.42:
                warm = 0.55 + rng.random() * 0.45
                cool = rng.random() < 0.18
                col = (warm * 0.45, warm * 0.75, warm) if cool else (warm, warm * 0.62, warm * 0.30)
                arr[ry:ry + 9, rx:rx + 8, 0] = col[0]
                arr[ry:ry + 9, rx:rx + 8, 1] = col[1]
                arr[ry:ry + 9, rx:rx + 8, 2] = col[2]

def interior_fn(arr):
    """warm shop interior with dark lattice mullions"""
    h, w, _ = arr.shape
    yy, xx = np.mgrid[0:h, 0:w]
    grad = 0.75 + 0.25 * (1 - yy / h)
    arr[:, :, 0] = 1.0 * grad
    arr[:, :, 1] = 0.55 * grad
    arr[:, :, 2] = 0.26 * grad
    mx = (xx % 42) < 5
    my = (yy % 56) < 5
    arr[mx | my, 0] = 0.05
    arr[mx | my, 1] = 0.035
    arr[mx | my, 2] = 0.02

stone_img = numpy_image('stone', 256, 256, stone_fn)
tile_img = numpy_image('tile', 256, 256, tile_fn)
winwall_img = numpy_image('winwall', 256, 256, window_wall_fn)
interior_img = numpy_image('interior', 128, 128, interior_fn)

# ---------- shared materials ----------
M_stone = std_mat('CL_stone', rough=0.95, image=stone_img)
M_tile = std_mat('CL_tile', rough=0.85, image=tile_img)
M_asphalt = std_mat('CL_asphalt', color=(0.055, 0.06, 0.075, 1), rough=0.5)
M_paint = std_mat('CL_paint', color=(0.75, 0.78, 0.82, 1), rough=0.6,
                  emission=(0.7, 0.72, 0.78), emission_strength=0.25)
M_wood = std_mat('CL_wood', color=(0.16, 0.11, 0.075, 1), rough=0.9)
M_wood_dark = std_mat('CL_wood_dark', color=(0.09, 0.06, 0.045, 1), rough=0.92)
M_plaster = std_mat('CL_plaster', color=(0.42, 0.38, 0.33, 1), rough=0.95)
M_win_warm = std_mat('CL_win_warm', color=(0.1, 0.06, 0.03, 1), rough=0.4,
                     emission=(1.0, 0.62, 0.28), emission_strength=2.4)
M_win_dim = std_mat('CL_win_dim', color=(0.08, 0.05, 0.03, 1), rough=0.4,
                    emission=(1.0, 0.55, 0.22), emission_strength=0.9)
M_win_dark = std_mat('CL_win_dark', color=(0.03, 0.035, 0.05, 1), rough=0.35, metallic=0.2)
M_lamp = std_mat('CL_lamp', color=(0.2, 0.12, 0.06, 1), rough=0.5,
                 emission=(1.0, 0.72, 0.38), emission_strength=3.2)
M_door = std_mat('CL_door', color=(0.07, 0.05, 0.04, 1), rough=0.9)
M_interior = std_mat('CL_interior', color=(0.1, 0.06, 0.03, 1), rough=0.7,
                     emission=(1.0, 1.0, 1.0), emission_strength=1.6,
                     emission_image=interior_img)
M_noren = std_mat('CL_noren', color=(0.06, 0.10, 0.30, 1), rough=0.9)
M_signboard = std_mat('CL_signboard', color=(0.05, 0.05, 0.06, 1), rough=0.7)
M_ground = std_mat('CL_ground', color=(0.035, 0.05, 0.055, 1), rough=1.0)
M_water = std_mat('CL_water', color=(0.015, 0.045, 0.085, 1), rough=0.12, metallic=0.55)
M_harbor_bldg = std_mat('CL_harbor_bldg', color=(0.012, 0.015, 0.025, 1), rough=0.9)
M_harbor_win = std_mat('CL_harbor_win', color=(0.02, 0.02, 0.03, 1), rough=0.8,
                       emission=(1.0, 1.0, 1.0), emission_strength=1.5,
                       emission_image=winwall_img)
def neon_mat(name, color):
    return std_mat(name, color=(0.02, 0.02, 0.02, 1), rough=0.5,
                   emission=color, emission_strength=5.0)
M_neon_pink = neon_mat('CL_neon_pink', (1.0, 0.16, 0.45))
M_neon_cyan = neon_mat('CL_neon_cyan', (0.15, 0.85, 1.0))
M_neon_red = neon_mat('CL_neon_red', (1.0, 0.22, 0.10))
M_neon_blue = neon_mat('CL_neon_blue', (0.25, 0.35, 1.0))
M_neon_green = neon_mat('CL_neon_green', (0.2, 1.0, 0.45))
M_neon_amber = neon_mat('CL_neon_amber', (1.0, 0.62, 0.15))

HOUSE_MATS = [M_stone, M_tile, M_wood, M_wood_dark, M_plaster, M_win_warm, M_win_dim,
              M_win_dark, M_lamp, M_door, M_interior, M_noren, M_signboard]
MI = {m.name: i for i, m in enumerate(HOUSE_MATS)}

# window plane helper (facade at local +Z)
def add_window(mb, x, y, z, w, h, kind='warm', facing='+z'):
    mi = {'warm': MI['CL_win_warm'], 'dim': MI['CL_win_dim'], 'dark': MI['CL_win_dark']}[kind]
    if facing == '+z':
        mb.add_quad((x - w/2, y - h/2, z), (x + w/2, y - h/2, z),
                    (x + w/2, y + h/2, z), (x - w/2, y + h/2, z), mi)
        # frame
        mb.add_box(x, y, z - 0.03, w + 0.18, h + 0.18, 0.08, MI['CL_wood_dark'])
    elif facing == '+x':
        mb.add_quad((z, y - h/2, x + w/2), (z, y - h/2, x - w/2),
                    (z, y + h/2, x - w/2), (z, y + h/2, x + w/2), mi)
        mb.add_box(z - 0.03, y, x, 0.08, h + 0.18, w + 0.18, MI['CL_wood_dark'])

def add_wall_lamp(mb, x, y, z):
    mb.add_box(x, y + 0.12, z - 0.10, 0.08, 0.08, 0.22, MI['CL_wood_dark'])
    mb.add_box(x, y, z, 0.22, 0.30, 0.22, MI['CL_lamp'])

def build_house_a():
    mb = MB()
    mb.add_box(0, 0.6, 0, 9.6, 1.2, 7.6, MI['CL_stone'], uv_world=2.5)
    mb.add_box(0, 3.6, 0.3, 8.4, 4.8, 6.4, MI['CL_wood'])
    mb.add_box(-5.9, 3.0, -0.5, 3.4, 3.6, 4.6, MI['CL_plaster'])
    mb.add_gable(0, 6.0, 0.3, 8.4, 6.4, 2.4, 0.7, 'x', MI['CL_tile'])
    mb.add_gable(-5.9, 4.8, -0.5, 3.4, 4.6, 1.6, 0.5, 'z', MI['CL_tile'])
    for i, wx in enumerate([-2.9, -1.0, 1.0, 2.9]):
        add_window(mb, wx, 2.7, 3.52, 1.15, 1.35, ['warm', 'dim', 'dark', 'warm'][i])
        add_window(mb, wx, 4.9, 3.52, 1.05, 1.15, ['dim', 'warm', 'warm', 'dark'][i])
    add_window(mb, 2.6, 2.7, 4.22, 1.0, 1.2, 'dim', facing='+x')
    add_window(mb, 2.6, 4.9, 4.22, 1.0, 1.1, 'warm', facing='+x')
    mb.add_box(-1.9, 2.2, 3.55, 1.25, 2.5, 0.18, MI['CL_door'])
    mb.add_box(-1.9, 1.28, 3.8, 1.7, 0.16, 0.7, MI['CL_stone'])
    add_wall_lamp(mb, -0.9, 3.3, 3.62)
    return mb

def build_house_b():
    mb = MB()
    mb.add_box(0, 0.6, 0, 10.6, 1.2, 8.6, MI['CL_stone'], uv_world=2.5)
    mb.add_box(0, 2.9, 0, 9.4, 3.4, 7.4, MI['CL_plaster'])
    mb.add_box(0.4, 6.2, 0, 7.6, 3.2, 6.2, MI['CL_wood'])
    mb.add_gable(0.4, 7.8, 0, 7.6, 6.2, 2.2, 0.6, 'x', MI['CL_tile'])
    # balcony railing on the setback terrace
    for px in [-3.6, -1.8, 0.0, 1.8, 3.6]:
        mb.add_box(px, 5.15, 3.55, 0.09, 1.1, 0.09, MI['CL_wood_dark'])
    mb.add_box(0, 5.68, 3.55, 7.6, 0.09, 0.09, MI['CL_wood_dark'])
    for i, wx in enumerate([-3.4, -1.15, 1.15, 3.4]):
        add_window(mb, wx, 2.9, 3.72, 1.2, 1.4, ['warm', 'warm', 'dim', 'dark'][i])
    for i, wx in enumerate([-2.4, 0.4, 3.0]):
        add_window(mb, wx, 6.2, 3.12, 1.1, 1.25, ['dim', 'warm', 'warm'][i])
    add_window(mb, 2.0, 6.2, 4.22, 1.0, 1.2, 'dark', facing='+x')
    mb.add_box(2.6, 2.1, 3.75, 1.2, 2.4, 0.18, MI['CL_door'])
    add_wall_lamp(mb, 3.6, 3.2, 3.82)
    return mb

def build_house_c():
    mb = MB()
    mb.add_box(0, 0.5, 0, 7.6, 1.0, 6.6, MI['CL_stone'], uv_world=2.5)
    mb.add_box(0, 2.5, 0, 6.4, 3.0, 5.4, MI['CL_wood'])
    mb.add_gable(0, 4.0, 0, 6.4, 5.4, 3.0, 0.6, 'x', MI['CL_tile'])
    add_window(mb, -1.7, 2.6, 2.72, 1.1, 1.25, 'warm')
    add_window(mb, 1.7, 2.6, 2.72, 1.1, 1.25, 'dim')
    mb.add_box(0, 2.0, 2.75, 1.1, 2.2, 0.16, MI['CL_door'])
    add_wall_lamp(mb, 1.0, 3.1, 2.82)
    return mb

def build_shop():
    mb = MB()
    mb.add_box(0, 0.5, 0, 8.6, 1.0, 7.1, MI['CL_stone'], uv_world=2.5)
    mb.add_box(0, 3.1, 0, 7.8, 4.2, 6.2, MI['CL_wood_dark'])
    mb.add_gable(0, 5.2, 0, 7.8, 6.2, 2.0, 0.7, 'x', MI['CL_tile'])
    # lit storefront with lattice
    mb.add_quad((-3.3, 1.35, 3.12), (2.1, 1.35, 3.12), (2.1, 3.95, 3.12), (-3.3, 3.95, 3.12),
                MI['CL_interior'])
    mb.add_box(-0.6, 4.05, 3.14, 5.8, 0.22, 0.14, MI['CL_wood'])
    mb.add_box(-0.6, 1.25, 3.14, 5.8, 0.22, 0.14, MI['CL_wood'])
    # noren curtain
    mb.add_quad((-1.7, 3.35, 3.22), (0.5, 3.35, 3.22), (0.5, 4.25, 3.22), (-1.7, 4.25, 3.22),
                MI['CL_noren'])
    # signboard with support arms (HTML paints real kanji onto CL_signboard)
    mb.add_box(-0.6, 4.75, 3.30, 3.6, 0.95, 0.14, MI['CL_signboard'])
    mb.add_box(-2.2, 4.75, 3.18, 0.10, 0.10, 0.5, MI['CL_wood_dark'])
    mb.add_box(1.0, 4.75, 3.18, 0.10, 0.10, 0.5, MI['CL_wood_dark'])
    add_window(mb, 2.9, 2.8, 3.12, 0.9, 1.1, 'warm')
    add_window(mb, -2.9, 2.8, 3.12, 0.9, 1.1, 'dim')
    add_window(mb, -1.0, 2.8, 3.92, 1.0, 1.1, 'warm', facing='+x')
    mb.add_box(2.9, 2.0, 3.15, 1.0, 2.0, 0.16, MI['CL_door'])
    add_wall_lamp(mb, 1.9, 3.2, 3.22)
    return mb

HOUSE_BUILDERS = {'a': build_house_a, 'b': build_house_b, 'c': build_house_c}

def export_glb(objs, filename):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, filename), export_format='GLB',
                              use_selection=True, export_materials='EXPORT')
    bpy.ops.object.select_all(action='DESELECT')

# ---------- road ----------
mb = MB()
NV = 3
for k, p in enumerate(S):
    y = p['y']
    mb.verts.append((p['x'] - 3.5 * p['nx'], y, p['z'] - 3.5 * p['nz']))
    mb.verts.append((p['x'], y + 0.07, p['z']))
    mb.verts.append((p['x'] + 3.5 * p['nx'], y, p['z'] + 3.5 * p['nz']))
    for _ in range(3):
        mb.uvs.append([(0, 0)])  # placeholder, fixed below
    if k:
        b = (k - 1) * 3
        mb.faces.append((b, b + 3, b + 4, b + 1))
        mb.faces.append((b + 1, b + 4, b + 5, b + 2))
        mb.mats.extend([0, 0])
        mb.uvs.extend([[(0, 0), (0, 1), (1, 1), (1, 0)], [(0, 0), (0, 1), (1, 1), (1, 0)]])
# rebuild uvs properly
mb2 = MB()
for k, p in enumerate(S):
    y = p['y']
    v = p['s'] / 7.0
    mb2.verts.append((p['x'] - 3.5 * p['nx'], y, p['z'] - 3.5 * p['nz']))
    mb2.verts.append((p['x'], y + 0.07, p['z']))
    mb2.verts.append((p['x'] + 3.5 * p['nx'], y, p['z'] + 3.5 * p['nz']))
    if k:
        b = (k - 1) * 3
        v0 = S[k - 1]['s'] / 7.0
        mb2.faces.append((b, b + 3, b + 4, b + 1))
        mb2.faces.append((b + 1, b + 4, b + 5, b + 2))
        mb2.mats.extend([0, 0])
        mb2.uvs.append([(0, v0), (0, v), (0.5, v), (0.5, v0)])
        mb2.uvs.append([(0.5, v0), (0.5, v), (1, v), (1, v0)])
road_obj = mb2.build('cl_road', [M_asphalt])
export_glb([road_obj], 'cl-road.glb')

# ---------- markings ----------
mb = MB()
MI2 = [M_paint]
# center dashes
s = 4.0
while s < ROAD_LEN - 4:
    a = road_at(s); b = road_at(s + 3.0)
    cx0 = (a['x'] + b['x']) / 2; cz0 = (a['z'] + b['z']) / 2
    tx, tz = a['tx'], a['tz']
    nx, nz = a['nx'], a['nz']
    y0 = (a['y'] + b['y']) / 2 + 0.10
    hx, hz = tx * 1.5, tz * 1.5
    mb.add_quad((cx0 - hx + nx * 0.09, y0, cz0 - hz + nz * 0.09),
                (cx0 - hx - nx * 0.09, y0, cz0 - hz - nz * 0.09),
                (cx0 + hx - nx * 0.09, y0, cz0 + hz - nz * 0.09),
                (cx0 + hx + nx * 0.09, y0, cz0 + hz + nz * 0.09), 0)
    s += 7.0
# edge lines
for side in (-1, 1):
    prev = None
    for p in S[::2]:
        x = p['x'] + side * 3.15 * p['nx']; z = p['z'] + side * 3.15 * p['nz']
        y = p['y'] + 0.10
        if prev:
            x0, z0, y0, p0 = prev
            nx0 = (p0['nx'] + p['nx']) / 2; nz0 = (p0['nz'] + p['nz']) / 2
            mb.add_quad((x0 + nx0 * 0.07, y0, z0 + nz0 * 0.07),
                        (x0 - nx0 * 0.07, y0, z0 - nz0 * 0.07),
                        (x - p['nx'] * 0.07, y, z - p['nz'] * 0.07),
                        (x + p['nx'] * 0.07, y, z + p['nz'] * 0.07), 0)
        prev = (x, z, y, p)
mark_obj = mb.build('cl_markings', MI2)
export_glb([mark_obj], 'cl-roadmarkings.glb')

# ---------- terrain ----------
xs = np.arange(-90, 92.5, 2.5)
zs = np.arange(-70, 72.5, 2.5)
NX, NZ = len(xs), len(zs)
H = np.zeros((NZ, NX))
for j, z in enumerate(zs):
    for i, x in enumerate(xs):
        H[j, i] = terrain_h(x, z)
mb = MB()
for j, z in enumerate(zs):
    for i, x in enumerate(xs):
        mb.verts.append((x, H[j, i], z))
for j in range(NZ - 1):
    for i in range(NX - 1):
        b = j * NX + i
        mb.faces.append((b, b + NX, b + 1 + NX, b + 1))
        mb.mats.append(0)
        mb.uvs.append([(x / 8, z / 8) for (x, z) in
                       [(xs[i], zs[j]), (xs[i], zs[j + 1]),
                        (xs[i + 1], zs[j + 1]), (xs[i + 1], zs[j])]])
terr_obj = mb.build('cl_terrain', [M_ground], smooth=True)
export_glb([terr_obj], 'cl-terrain.glb')

# ---------- retaining walls along road ----------
mb = MB()
for k in range(0, len(S) - 2, 3):
    p = S[k]
    q = S[k + 2]
    mx = (p['x'] + q['x']) / 2; mz = (p['z'] + q['z']) / 2
    my = (p['y'] + q['y']) / 2
    yaw = math.atan2((q['x'] - p['x']), (q['z'] - p['z']))
    seglen = math.dist((p['x'], p['z']), (q['x'], q['z'])) + 0.4
    for side in (-1, 1):
        wx = mx + side * 3.9 * p['nx']; wz = mz + side * 3.9 * p['nz']
        ty = terrain_h(wx, wz)
        top = my - 0.05
        if ty < top - 0.6:
            hgt = top - (ty - 0.25)
            mb.add_box(wx, top - hgt / 2, wz, 0.7, hgt, seglen, 0, yaw=yaw, uv_world=2.5)
wall_obj = mb.build('cl_retwalls', [M_stone])
export_glb([wall_obj], 'cl-retwalls.glb')

# ---------- harbor ----------
mb = MB()
WMI = [M_water, M_harbor_bldg, M_harbor_win, M_neon_pink, M_neon_cyan, M_neon_red,
       M_neon_blue, M_neon_green, M_neon_amber]
# water: south bay + west bay (wound to face +y)
mb.add_quad((-90, -1.5, 56), (-90, -1.5, 112), (90, -1.5, 112), (90, -1.5, 56), 0,
            [(0, 0), (0, 4), (8, 4), (8, 0)])
mb.add_quad((-90, -1.5, -70), (-90, -1.5, 56), (-58, -1.5, 56), (-58, -1.5, -70), 0,
            [(0, 0), (0, 9), (3, 9), (3, 0)])
# far shore strip
mb.add_box(0, -1.0, 96, 190, 3.0, 12, 1)
# skyline blocks with lit windows
neons = [3, 4, 5, 6, 7, 8]
for bi in range(16):
    bx = -80 + bi * 10.5 + rng.uniform(-2, 2)
    bw = rng.uniform(6, 11); bh = rng.uniform(9, 36); bd = rng.uniform(6, 10)
    bz = 96 + rng.uniform(-2, 3)
    mb.add_box(bx, bh / 2, bz, bw, bh, bd, 2, uv_world=14.0)
    if bi % 3 == 0:
        nm = neons[(bi // 3) % len(neons)]
        mb.add_box(bx, bh + 0.4, bz - bd / 2 - 0.3, bw * 0.75, 0.55, 0.55, nm)
# bridge with cyan underglow
mb.add_box(0, 2.2, 80, 150, 1.1, 3.2, 1)
mb.add_box(0, 1.55, 80, 150, 0.28, 0.28, 4)
# moored ships
for sx, sz in [(-30, 68), (25, 72)]:
    mb.add_box(sx, -0.6, sz, 20, 2.6, 5.5, 1, yaw=0.2)
    mb.add_box(sx + 5, 1.6, sz, 5, 2.4, 4, 2, yaw=0.2, uv_world=14.0)
harbor_obj = mb.build('cl_harbor', WMI)
export_glb([harbor_obj], 'cl-harbor.glb')
