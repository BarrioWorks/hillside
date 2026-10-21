import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { StructureBatches } from '../src/render/batches';
import { ModelLibrary } from '../src/render/models';
import { heightAt } from '../src/render/terrain';
import { realCore } from './core-fixture';

function meshes(batches: StructureBatches): THREE.InstancedMesh[] {
  return batches.group.children.filter((child) => child instanceof THREE.InstancedMesh);
}

function onlyMesh(batches: StructureBatches): THREE.InstancedMesh {
  const mesh = meshes(batches)[0];
  if (!mesh) throw new Error('Expected a rendered batch.');
  return mesh;
}

function hits(batches: StructureBatches, x: number, z = 0): THREE.Intersection[] {
  batches.group.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0)).intersectObject(
    batches.group,
    true,
  );
}

function picked(batches: StructureBatches, x: number, z = 0): number | undefined {
  const hit = hits(batches, x, z)[0];
  return hit && batches.placementId(hit);
}

describe('shared structure batches', () => {
  it('renders shared resources once and updates only a changed instance', () => {
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const material = new THREE.MeshStandardMaterial();
    const first = new THREE.Mesh(geometry, material);
    const second = first.clone();
    second.position.x = 4;
    const batches = new StructureBatches();
    batches.add(10, first);
    batches.add(20, second);
    const batch = onlyMesh(batches);
    expect(batches.batchCount).toBe(1);
    expect(batches.partCount).toBe(2);
    expect(batch.geometry).toBe(geometry);
    expect(batch.material).toBe(material);
    expect(first.parent).toBeNull();
    expect(second.parent).toBeNull();
    expect(picked(batches, 0)).toBe(10);
    expect(picked(batches, 4)).toBe(20);

    batch.instanceMatrix.clearUpdateRanges();
    const version = batch.instanceMatrix.version;
    batches.update(10);
    expect(batch.instanceMatrix.version).toBe(version);
    second.position.x = 40;
    second.scale.y = 0.35;
    batches.update(20);
    expect(batch.instanceMatrix.updateRanges).toEqual([{ start: 16, count: 16 }]);
    expect(picked(batches, 4)).toBeUndefined();
    expect(picked(batches, 40)).toBe(20);
    expect(hits(batches, 40)[0]?.point.y).toBeCloseTo(0.35);
    expect(batch.boundingBox?.containsPoint(new THREE.Vector3(40.5, 0.35, 0.5))).toBe(true);
    expect(batch.boundingSphere?.containsPoint(new THREE.Vector3(40.5, 0.35, 0.5))).toBe(true);
    second.scale.y = 1;
    batches.update(20);
    expect(hits(batches, 40)[0]?.point.y).toBeCloseTo(1);
    batches.dispose();
    geometry.dispose();
    material.dispose();
  });

  it('moves the last slot into a removed slot and keeps subsequent updates and picking correct', () => {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    const batches = new StructureBatches();
    const roots = [0, 3, 6, 9].map((x, index) => {
      const root = new THREE.Mesh(geometry, material);
      root.position.x = x;
      batches.add(index + 1, root);
      return root;
    });
    const mesh = onlyMesh(batches);
    mesh.instanceMatrix.clearUpdateRanges();
    batches.remove(2);
    expect(mesh.count).toBe(3);
    expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 16, count: 16 }]);
    expect(picked(batches, 3)).toBeUndefined();
    expect(picked(batches, 9)).toBe(4);
    const moved = roots[3];
    if (!moved) throw new Error('Expected the last placement.');
    moved.position.x = 12;
    batches.update(4);
    expect(picked(batches, 9)).toBeUndefined();
    expect(picked(batches, 12)).toBe(4);
    batches.remove(1);
    batches.remove(3);
    batches.remove(4);
    batches.remove(4);
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);
    expect(batches.batchCount).toBe(0);
    expect(picked(batches, 12)).toBeUndefined();
    batches.add(90, moved);
    expect(onlyMesh(batches)).toBe(mesh);
    expect(batches.allocatedBatchCount).toBe(1);
    expect(picked(batches, 12)).toBe(90);
    batches.dispose();
    geometry.dispose();
    material.dispose();
  });

  it('flattens nested child transforms, duplicate shared parts, roof and overhang picking', () => {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    const roofMaterial = new THREE.MeshBasicMaterial({ color: '#ffaaaa' });
    const root = new THREE.Mesh(geometry, material);
    root.position.set(10, 2, 10);
    root.rotation.y = Math.PI / 2;
    const wrapper = new THREE.Group();
    wrapper.position.set(0, 2, 2);
    wrapper.scale.setScalar(0.5);
    const overhang = new THREE.Mesh(geometry, roofMaterial);
    overhang.position.z = 2;
    wrapper.add(overhang);
    const samePart = new THREE.Mesh(geometry, roofMaterial);
    samePart.position.x = 3;
    wrapper.add(samePart);
    root.add(wrapper);
    const hidden = new THREE.Mesh(geometry, roofMaterial);
    hidden.visible = false;
    root.add(hidden);
    const batches = new StructureBatches();
    batches.add(1, root);
    const copy = root.clone();
    copy.position.x = 20;
    batches.add(2, copy);
    expect(batches.batchCount).toBe(2);
    expect(batches.partCount).toBe(6);
    expect(picked(batches, 10, 10)).toBe(1);
    expect(picked(batches, 13, 10)).toBe(1);
    expect(picked(batches, 23, 10)).toBe(2);
    expect(hits(batches, 13, 10)[0]?.point.y).toBeCloseTo(4.25);
    root.scale.y = 0.35;
    batches.update(1);
    expect(hits(batches, 13, 10)[0]?.point.y).toBeCloseTo(2 + 2.25 * 0.35);
    batches.remove(1);
    expect(batches.partCount).toBe(3);
    expect(picked(batches, 13, 10)).toBeUndefined();
    expect(picked(batches, 23, 10)).toBe(2);
    batches.dispose();
    geometry.dispose();
    material.dispose();
    roofMaterial.dispose();
  });

  it('respects capacity and reuses empty batches and shared material arrays', () => {
    const geometry = new THREE.BoxGeometry();
    const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    const batches = new StructureBatches(2);
    for (let id = 0; id < 5; id++) batches.add(id, new THREE.Mesh(geometry, [...materials]));
    const allocated = meshes(batches);
    expect(allocated.map((mesh) => mesh.count)).toEqual([2, 2, 1]);
    expect(allocated.every((mesh) => mesh.instanceMatrix.count === 2)).toBe(true);
    for (let id = 0; id < 5; id++) batches.remove(id);
    for (let id = 5; id < 10; id++) batches.add(id, new THREE.Mesh(geometry, [...materials]));
    expect(meshes(batches)).toEqual(allocated);
    expect(batches.allocatedBatchCount).toBe(3);
    expect(() => new StructureBatches(1025)).toThrow(RangeError);
    expect(() => new StructureBatches(0)).toThrow(RangeError);
    batches.dispose();
    geometry.dispose();
    for (const material of materials) material.dispose();
  });

  it('keeps different materials and shadow settings in distinct batches', () => {
    const geometry = new THREE.BoxGeometry();
    const a = new THREE.MeshBasicMaterial();
    const b = new THREE.MeshBasicMaterial();
    const batches = new StructureBatches();
    const first = new THREE.Mesh(geometry, a);
    const second = new THREE.Mesh(geometry, b);
    const third = first.clone();
    third.castShadow = true;
    batches.add(1, first);
    batches.add(2, second);
    batches.add(3, third);
    expect(batches.batchCount).toBe(3);
    expect(meshes(batches).filter((mesh) => mesh.castShadow)).toHaveLength(1);
    batches.dispose();
    geometry.dispose();
    a.dispose();
    b.dispose();
  });

  it.each([true, false])(
    'preserves mirrored surfaces with positive instance determinants, indexed=%s',
    (indexed) => {
      const indexedGeometry = new THREE.BoxGeometry(2, 2, 2);
      const geometry = indexed ? indexedGeometry : indexedGeometry.toNonIndexed();
      geometry.translate(1, 1, 0);
      const material = new THREE.MeshBasicMaterial();
      const root = new THREE.Mesh(geometry, material);
      root.position.x = 5;
      root.scale.x = -1;
      const batches = new StructureBatches();
      batches.add(1, root);
      const reflected = onlyMesh(batches);
      const reflectedGeometry = reflected.geometry;
      const instanceMatrix = new THREE.Matrix4();
      reflected.getMatrixAt(0, instanceMatrix);
      expect(instanceMatrix.determinant()).toBeGreaterThan(0);
      expect(reflectedGeometry).not.toBe(geometry);
      expect(picked(batches, 4)).toBe(1);
      expect(hits(batches, 4)[0]?.point.y).toBeCloseTo(2);
      const originalHit = new THREE.Raycaster(
        new THREE.Vector3(4, 30, 0),
        new THREE.Vector3(0, -1, 0),
      ).intersectObject(root)[0];
      expect(hits(batches, 4)[0]?.distance).toBeCloseTo(originalHit?.distance ?? -1);
      const sourceDisposed = vi.fn();
      const materialDisposed = vi.fn();
      const reflectionDisposed = vi.fn();
      const instanceDisposed = vi.fn();
      geometry.addEventListener('dispose', sourceDisposed);
      material.addEventListener('dispose', materialDisposed);
      reflectedGeometry.addEventListener('dispose', reflectionDisposed);
      reflected.addEventListener('dispose', instanceDisposed);
      root.scale.x = 1;
      batches.update(1);
      expect(picked(batches, 4)).toBeUndefined();
      expect(picked(batches, 6)).toBe(1);
      root.scale.x = -1;
      batches.update(1);
      expect(picked(batches, 4)).toBe(1);
      expect(meshes(batches)).toHaveLength(2);
      expect(onlyMesh(batches).geometry).toBe(reflectedGeometry);
      batches.dispose();
      expect(instanceDisposed).toHaveBeenCalledOnce();
      expect(reflectionDisposed).toHaveBeenCalledOnce();
      expect(sourceDisposed).not.toHaveBeenCalled();
      expect(materialDisposed).not.toHaveBeenCalled();
      batches.dispose();
      expect(reflectionDisposed).toHaveBeenCalledOnce();
      geometry.dispose();
      if (!indexed) indexedGeometry.dispose();
      material.dispose();
    },
  );

  it.each(['benchmark', 'mixed catalog'])(
    'preserves all geometry for 500 %s structures',
    async (population) => {
      const core = realCore();
      const library = new ModelLibrary(core.catalog());
      const batches = new StructureBatches();
      try {
        const snapshot = core.command({ type: 'benchmark' }).snapshot;
        const catalog = core.catalog();
        const structures = Array.from({ length: 500 }, (_, index) => {
          const structure = snapshot.structures[Math.floor((index * snapshot.structures.length) / 500)];
          if (!structure) throw new Error('Expected a benchmark placement.');
          return population === 'benchmark'
            ? structure
            : { ...structure, kind: catalog[index % catalog.length]?.id ?? structure.kind };
        });
        expect(structures).toHaveLength(500);
        let triangles = 0;
        let parts = 0;
        for (const structure of structures) {
          const mesh = library.create(structure.kind, structure.variation);
          mesh.position.set(structure.x, heightAt(snapshot, structure.x, structure.z), structure.z);
          mesh.rotation.y = (structure.rotation * Math.PI) / 2;
          mesh.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
            parts++;
          });
          batches.add(structure.id, mesh);
        }
        const instancedTriangles = meshes(batches).reduce(
          (sum, mesh) =>
            sum +
            (mesh.count * (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count)) / 3,
          0,
        );
        expect(parts).toBe(500);
        expect(instancedTriangles).toBe(triangles);
        expect(batches.partCount).toBe(parts);
        // Six buildings × 16 seeded variants dominate; props and street contexts add a few more.
        expect(batches.batchCount).toBeLessThanOrEqual(6 * 16 + 24);
        expect(meshes(batches).every((mesh) => mesh.count <= 1024)).toBe(true);
        const before = meshes(batches);
        for (const structure of structures) batches.remove(structure.id);
        expect(batches.batchCount).toBe(0);
        for (const structure of structures)
          batches.add(structure.id, library.create(structure.kind, structure.variation));
        expect(meshes(batches)).toEqual(before);
      } finally {
        batches.dispose();
        library.dispose();
      }
    },
  );
});
