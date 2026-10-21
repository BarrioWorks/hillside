import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const source = `${root}asset-sources/kenney-city-kit-commercial/`;
export const output = `${root}web/public/models/`;
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const assets = [
  { file: 'building-a.glb', height: 2.4, color: '#d5946e' },
  { file: 'building-e.glb', height: 2, color: '#e2ba75' },
  { file: 'building-i.glb', height: 2.8, color: '#8bc4bc' },
  { file: 'detail-awning.glb', height: 0.4, color: '#df987e' },
  { file: 'detail-overhang.glb', height: 0.4, color: '#e2d6bb' },
];
export const budgets = { triangles: 3000, materials: 2, textures: 1, bytes: 500000 };
export const areaEpsilon = 1e-16;

export function triangleAreaSquared(position, a, b, c) {
  const p = position.getElement(a, []);
  const q = position.getElement(b, []);
  const r = position.getElement(c, []);
  const u = q.map((v, i) => v - p[i]);
  const v = r.map((value, i) => value - p[i]);
  return (
    (u[1] * v[2] - u[2] * v[1]) ** 2 + (u[2] * v[0] - u[0] * v[2]) ** 2 + (u[0] * v[1] - u[1] * v[0]) ** 2
  );
}

export function measure(document) {
  const scene = document.getRoot().getDefaultScene();
  assert(scene, 'A default scene is required');
  const bounds = getBounds(scene);
  bounds.size = bounds.max.map((v, i) => v - bounds.min[i]);
  let triangles = 0;
  let degenerates = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      assert.equal(primitive.getMode(), 4, 'Only triangle primitives are supported');
      const position = primitive.getAttribute('POSITION');
      assert(position && position.getType() === 'VEC3', 'VEC3 positions are required');
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : position.getCount();
      assert.equal(count % 3, 0, 'Incomplete triangle');
      for (let i = 0; i < count; i += 3) {
        const vertices = [0, 1, 2].map((j) => (indices ? indices.getScalar(i + j) : i + j));
        for (const index of vertices) {
          assert(
            Number.isInteger(index) && index >= 0 && index < position.getCount(),
            'Invalid vertex index',
          );
        }
        if (triangleAreaSquared(position, ...vertices) <= areaEpsilon) degenerates++;
        triangles++;
      }
    }
  }
  return { bounds, triangles, degenerates, materials: document.getRoot().listMaterials().length };
}
