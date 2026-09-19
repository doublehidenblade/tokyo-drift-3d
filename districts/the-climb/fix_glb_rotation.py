#!/usr/bin/env python3
"""Rotate climb-generated GLBs from (east, north, -up) to (east, up, north).

The gen scripts built Blender meshes in (x=east, y=up, z=north); the glTF
exporter mapped (x,y,z)->(x,z,-y), yielding three.js (east, north, -up).
This bakes the corrective rotation R:(x,y,z)->(x,-z,y) into POSITION and
NORMAL attributes and recomputes POSITION bounds. Copied d2 props are
already y-up and are NOT touched.
"""
import struct, json, os

MODELS = '/home/hatch/workspace/ts-spaces/tokyo-drift/districts/the-climb/models'
FILES = ['cl-harbor.glb', 'cl-house-a.glb', 'cl-house-b.glb', 'cl-house-c.glb',
         'cl-retwalls.glb', 'cl-road.glb', 'cl-roadmarkings.glb', 'cl-shop.glb',
         'cl-terrain.glb']

def rot(p):
    x, y, z = p
    return (x, -z, y)

for fn in FILES:
    path = os.path.join(MODELS, fn)
    data = bytearray(open(path, 'rb').read())
    assert data[0:4] == b'glTF'
    jlen = struct.unpack('<I', data[12:16])[0]
    js = json.loads(data[20:20 + jlen].decode('utf-8'))
    binoff = 20 + jlen
    blen = struct.unpack('<I', data[binoff:binoff + 4])[0]
    assert data[binoff + 4:binoff + 8] == b'BIN\x00'
    binstart = binoff + 8
    buf = bytearray(data[binstart:binstart + blen])

    # collect accessors needing rotation: (accessor_index, is_position)
    targets = {}
    for mi, m in enumerate(js.get('meshes', [])):
        for prim in m['primitives']:
            for attr in ('POSITION', 'NORMAL'):
                if attr in prim.get('attributes', {}):
                    targets[prim['attributes'][attr]] = (attr == 'POSITION')

    for ai, is_pos in sorted(targets.items()):
        acc = js['accessors'][ai]
        assert acc['type'] == 'VEC3' and acc['componentType'] == 5126, (fn, ai, acc)
        bv = js['bufferViews'][acc['bufferView']]
        stride = bv.get('byteStride', 12)
        assert stride == 12, (fn, ai, stride)
        base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        n = acc['count']
        mn = [1e9] * 3
        mx = [-1e9] * 3
        for i in range(n):
            o = base + i * 12
            x, y, z = struct.unpack_from('<3f', buf, o)
            x2, y2, z2 = rot((x, y, z))
            struct.pack_into('<3f', buf, o, x2, y2, z2)
            if is_pos:
                mn[0] = min(mn[0], x2); mn[1] = min(mn[1], y2); mn[2] = min(mn[2], z2)
                mx[0] = max(mx[0], x2); mx[1] = max(mx[1], y2); mx[2] = max(mx[2], z2)
        if is_pos:
            acc['min'] = mn
            acc['max'] = mx

    new_json = json.dumps(js, separators=(',', ':')).encode('utf-8')
    # pad JSON chunk to 4-byte alignment
    pad = (4 - len(new_json) % 4) % 4
    new_json += b' ' * pad
    out = bytearray()
    out += struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(new_json) + 8 + len(buf))
    out += struct.pack('<II', len(new_json), 0x4E4F534A) + new_json
    out += struct.pack('<II', len(buf), 0x004E4942) + buf
    open(path, 'wb').write(out)
    print('rotated', fn)

print('done')
