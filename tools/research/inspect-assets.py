"""Inspect original GLBs directly. This is not a substitute for the renderer validator."""
import hashlib
import json
import math
from pathlib import Path
import struct

root = Path(__file__).resolve().parents[2]
folder = root / 'asset-sources/kenney-city-kit-commercial'
manifest = json.loads((folder / 'provenance.json').read_text())
rows = []
for entry in manifest['files']:
    path = folder / entry['file']
    data = path.read_bytes()
    assert len(data) == entry['bytes'], path
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], path
    if path.suffix != '.glb':
        continue
    magic, version, total = struct.unpack_from('<4sII', data)
    assert magic == b'glTF' and version == 2 and total == len(data), path
    chunks = {}
    offset = 12
    while offset < total:
        length, kind = struct.unpack_from('<II', data, offset)
        offset += 8
        assert length % 4 == 0 and offset + length <= total, path
        chunks[kind] = data[offset:offset + length]
        offset += length
    document = json.loads(chunks[0x4e4f534a])
    binary = chunks[0x004e4942]
    assert len(document['buffers']) == 1 and 'uri' not in document['buffers'][0], path
    assert document['buffers'][0]['byteLength'] <= len(binary), path
    for image in document.get('images', []):
        if 'uri' in image:
            assert (path.parent / image['uri']).is_file(), image
    bounds_min = [math.inf] * 3
    bounds_max = [-math.inf] * 3
    triangles = vertices = 0
    for mesh in document['meshes']:
        for primitive in mesh['primitives']:
            assert primitive.get('mode', 4) == 4, path
            accessor = document['accessors'][primitive['attributes']['POSITION']]
            view = document['bufferViews'][accessor['bufferView']]
            assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3', path
            stride = view.get('byteStride', 12)
            start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
            for index in range(accessor['count']):
                position = struct.unpack_from('<fff', binary, start + index * stride)
                assert all(math.isfinite(value) for value in position), path
                for axis in range(3):
                    bounds_min[axis] = min(bounds_min[axis], position[axis])
                    bounds_max[axis] = max(bounds_max[axis], position[axis])
            vertices += accessor['count']
            count = document['accessors'][primitive['indices']]['count'] if 'indices' in primitive else accessor['count']
            assert count % 3 == 0, path
            triangles += count // 3
    row = {'file': entry['file'], 'bytes': len(data), 'vertices': vertices, 'triangles': triangles,
           'min': bounds_min, 'max': bounds_max, 'size': [b-a for a,b in zip(bounds_min,bounds_max)],
           'meshes': len(document['meshes']), 'materials': len(document.get('materials', [])),
           'nodes': document.get('nodes', []), 'images': document.get('images', [])}
    rows.append(row)
output = root / 'tools/research/asset-inspection.json'
output.write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps(rows, indent=2))
