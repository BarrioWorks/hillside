"""Re-extract the selected original Kenney files, with a pinned archive digest."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

root = Path(__file__).resolve().parents[2]
manifest_path = root / 'asset-sources/kenney-city-kit-commercial/provenance.json'
manifest = json.loads(manifest_path.read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--archive', type=Path, help='Use an already downloaded archive')
args = parser.parse_args()
data = args.archive.read_bytes() if args.archive else urllib.request.urlopen(manifest['downloadURL'], timeout=180).read()
assert hashlib.sha256(data).hexdigest() == manifest['archiveSHA256'], 'Upstream archive changed'
archive = zipfile.ZipFile(io.BytesIO(data))
for entry in manifest['files']:
    content = archive.read(entry['sourceMember'])
    assert hashlib.sha256(content).hexdigest() == entry['sha256'], entry['file']
    destination = manifest_path.parent / entry['file']
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
license_data = archive.read('License.txt')
assert b'Creative Commons Zero, CC0' in license_data, 'License declaration changed'
(manifest_path.parent / 'License.txt').write_bytes(license_data)
print('Extracted selected models, their texture, and the packaged CC0 license.')
