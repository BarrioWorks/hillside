import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { assets, budgets, io, measure, output, sha256, source } from './common.mjs';

const manifest = JSON.parse(await readFile(`${output}manifest.json`, 'utf8'));
const provenance = JSON.parse(await readFile(`${source}provenance.json`, 'utf8'));
assert.equal(manifest.units, 'meters');
assert.equal(manifest.up, '+Y');
assert.deepEqual(manifest.budgets, budgets);
assert.deepEqual(manifest.assets.map((a) => a.file).sort(), assets.map((a) => a.file).sort());
assert.deepEqual(await readFile(`${output}License.txt`), await readFile(`${source}License.txt`));

function checkPNG(image) {
  const png = Buffer.from(image);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Invalid PNG');
  const chunks = [];
  let header;
  let ended = false;
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    assert(offset + length + 12 <= png.length, 'Truncated PNG');
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = data;
    if (type === 'IDAT') chunks.push(data);
    if (type === 'IEND') ended = true;
    offset += length + 12;
  }
  assert(header && ended && chunks.length, 'Incomplete PNG');
  assert(header.readUInt32BE(0) > 0 && header.readUInt32BE(4) > 0, 'Empty texture');
  assert(inflateSync(Buffer.concat(chunks)).length > 0, 'Empty decoded PNG');
}

for (const expected of assets) {
  const entry = manifest.assets.find((a) => a.file === expected.file);
  const bytes = await readFile(output + expected.file);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB length mismatch');
  assert(bytes.length <= budgets.bytes, 'File exceeds byte budget');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert(json.buffers?.length > 0 && json.buffers.every((b) => !b.uri), 'External buffer dependency');
  assert(
    json.images?.length > 0 && json.images.every((i) => !i.uri && Number.isInteger(i.bufferView)),
    'External/missing image',
  );
  const document = await io.readBinary(bytes);
  const documentRoot = document.getRoot();
  for (const accessor of documentRoot.listAccessors()) {
    assert(accessor.getArray()?.length > 0, 'Empty or missing buffer');
    assert([...accessor.getArray()].every(Number.isFinite), 'Nonfinite accessor');
  }
  for (const node of documentRoot.listNodes()) {
    assert([...node.getMatrix(), ...node.getWorldMatrix()].every(Number.isFinite), 'Nonfinite transform');
    assert(
      node.getScale().every((v) => v > 0),
      'Nonpositive scale',
    );
    assert(Math.abs(Math.hypot(...node.getRotation()) - 1) < 1e-5, 'Invalid quaternion');
    assert.deepEqual(node.getTranslation(), [0, 0, 0], 'Normalization must be baked into geometry');
    assert.deepEqual(node.getScale(), [1, 1, 1]);
    assert.deepEqual(node.getRotation(), [0, 0, 0, 1]);
  }
  const actual = measure(document);
  assert.equal(actual.degenerates, 0, 'Degenerate triangle remains');
  assert(actual.triangles > 0 && actual.triangles <= budgets.triangles, 'Triangle budget exceeded');
  assert(actual.materials > 0 && actual.materials <= budgets.materials, 'Material budget exceeded');
  assert(
    actual.bounds.size.every((v) => Number.isFinite(v) && v > 0 && v < 5),
    'Invalid model size',
  );
  assert(Math.abs(actual.bounds.min[1]) < 1e-6, 'Base must be Y=0');
  for (const axis of [0, 2])
    assert(Math.abs(actual.bounds.min[axis] + actual.bounds.max[axis]) < 1e-5, 'XZ origin must be centered');
  assert(Math.abs(actual.bounds.size[1] - expected.height) < 1e-5, 'Incorrect normalized height');
  const textures = documentRoot.listTextures();
  assert(textures.length > 0 && textures.length <= budgets.textures, 'Texture budget exceeded');
  for (const texture of textures) {
    assert.equal(texture.getMimeType(), 'image/png');
    checkPNG(texture.getImage());
    assert.equal(
      sha256(texture.getImage()),
      provenance.files.find((f) => f.file === 'Textures/colormap.png').sha256,
      'Embedded source texture changed',
    );
  }
  for (const mesh of documentRoot.listMeshes()) {
    for (const primitive of mesh.listPrimitives())
      assert(primitive.getMaterial(), 'Missing primitive material');
  }
  for (const material of documentRoot.listMaterials()) {
    assert(material.getBaseColorTexture(), 'Missing base color texture');
    assert.equal(material.getMetallicFactor(), 0);
    assert.equal(material.getRoughnessFactor(), 0.92);
    assert(
      material.getBaseColorFactor().every((v) => Number.isFinite(v) && v >= 0 && v <= 1),
      'Invalid material color',
    );
  }
  assert.equal(entry.author, provenance.publisher);
  assert.equal(entry.sourceURL, provenance.sourcePage);
  assert.equal(entry.license, 'CC0-1.0');
  assert.equal(entry.licenseFile, 'License.txt');
  assert.equal(entry.archiveSHA256, provenance.archiveSHA256);
  assert.deepEqual(
    entry.source,
    provenance.files.find((f) => f.file === expected.file),
  );
  assert.equal(sha256(await readFile(source + expected.file)), entry.source.sha256);
  assert.deepEqual(entry.dependencies, [provenance.files.find((f) => f.file === 'Textures/colormap.png')]);
  assert(
    entry.modificationHistory.length >= 3 &&
      entry.modificationHistory.every((s) => typeof s === 'string' && s.length > 0),
    'Incomplete modification history',
  );
  const embedded = documentRoot.getExtras().provenance;
  for (const field of [
    'file',
    'author',
    'sourceURL',
    'license',
    'licenseFile',
    'source',
    'dependencies',
    'modificationHistory',
    'archiveSHA256',
    'normalization',
    'removedDegenerateTriangles',
  ]) {
    assert.deepEqual(embedded?.[field], entry[field], `Embedded provenance mismatch: ${field}`);
  }
  assert.equal(entry.outputhash, sha256(bytes), 'Output hash mismatch');
  assert.equal(entry.bytes, bytes.length);
  for (const field of ['bounds', 'triangles', 'degenerates', 'materials'])
    assert.deepEqual(entry[field], actual[field], `Manifest measurement mismatch: ${field}`);
  const original = measure(await io.read(source + expected.file));
  assert.equal(
    actual.triangles,
    original.triangles - entry.removedDegenerateTriangles,
    'Unexpected source triangle loss',
  );
  console.log(
    `PASS ${expected.file}: ${actual.triangles} triangles; base Y=${actual.bounds.min[1]}; embedded PNG; CC0 provenance verified`,
  );
}
console.log(`Validated ${assets.length} self-contained GLBs.`);
