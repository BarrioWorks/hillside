import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { Color } from 'three';
import {
  areaEpsilon,
  assets,
  budgets,
  io,
  measure,
  output,
  sha256,
  source,
  triangleAreaSquared,
} from './common.mjs';

const provenance = JSON.parse(await readFile(`${source}provenance.json`, 'utf8'));
await mkdir(output, { recursive: true });
for (const entry of provenance.files) {
  assert.equal(sha256(await readFile(source + entry.file)), entry.sha256, `Source changed: ${entry.file}`);
}
await copyFile(`${source}License.txt`, `${output}License.txt`);
const manifest = {
  version: 1,
  units: 'meters',
  up: '+Y',
  origin: 'XZ center, minimum Y = 0',
  budgets,
  assets: [],
};
for (const asset of assets) {
  const document = await io.read(source + asset.file);
  const before = measure(document);
  const scale = asset.height / before.bounds.size[1];
  const center = before.bounds.min.map((v, i) => (i === 1 ? v : (v + before.bounds.max[i]) / 2));
  for (const accessor of document.getRoot().listAccessors()) {
    if (
      !document
        .getRoot()
        .listMeshes()
        .some((m) => m.listPrimitives().some((p) => p.getAttribute('POSITION') === accessor))
    )
      continue;
    for (let i = 0; i < accessor.getCount(); i++) {
      accessor.setElement(
        i,
        accessor.getElement(i, []).map((v, axis) => (v - center[axis]) * scale),
      );
    }
  }
  let removed = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : position.getCount();
      const kept = [];
      for (let i = 0; i < count; i += 3) {
        const vertices = [0, 1, 2].map((j) => (indices ? indices.getScalar(i + j) : i + j));
        if (triangleAreaSquared(position, ...vertices) <= areaEpsilon) removed++;
        else kept.push(...vertices);
      }
      const replacement = document
        .createAccessor()
        .setType('SCALAR')
        .setBuffer(position.getBuffer())
        .setArray(new Uint32Array(kept));
      primitive.setIndices(replacement);
      if (indices) indices.dispose();
    }
  }
  const color = new Color(asset.color);
  for (const material of document.getRoot().listMaterials()) {
    material.setBaseColorFactor([color.r, color.g, color.b, 1]).setMetallicFactor(0).setRoughnessFactor(0.92);
  }
  const entry = {
    file: asset.file,
    author: provenance.publisher,
    sourceURL: provenance.sourcePage,
    license: provenance.license,
    licenseFile: 'License.txt',
    source: provenance.files.find((f) => f.file === asset.file),
    archiveSHA256: provenance.archiveSHA256,
    dependencies: [provenance.files.find((f) => f.file === 'Textures/colormap.png')],
    modificationHistory: [
      `Uniform scale ${scale}; centered XZ and translated base to Y=0; Y-up preserved.`,
      `Preserved source mesh, UVs, normals and embedded original colormap PNG; matte ${asset.color} linear-space material tint, roughness 0.92, metalness 0.`,
      `Removed ${removed} zero-area or near-zero-area triangles (squared cross-product <= ${areaEpsilon}); retained all other triangles.`,
    ],
    normalization: { scale, targetHeight: asset.height, tintSRGB: asset.color },
    removedDegenerateTriangles: removed,
  };
  document.getRoot().setExtras({ provenance: entry });
  const bytes = await io.writeBinary(document);
  await writeFile(output + asset.file, bytes);
  const measured = measure(await io.readBinary(bytes));
  manifest.assets.push({ ...entry, ...measured, outputhash: sha256(bytes), bytes: bytes.length });
  console.log(
    `${asset.file}: ${measured.triangles} triangles, removed ${removed}, size ${measured.bounds.size.map((v) => v.toFixed(4)).join(' x ')}`,
  );
}
await writeFile(`${output}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
