import * as THREE from 'three';

interface Batch {
  mesh: THREE.InstancedMesh;
  parts: Part[];
}

interface Part {
  id: number;
  source: THREE.Mesh;
  matrix: THREE.Matrix4;
  reflected: boolean;
  batch: Batch;
  slot: number;
}

interface Placement {
  root: THREE.Object3D;
  parts: Part[];
}

export class StructureBatches {
  readonly group = new THREE.Group();
  private readonly placements = new Map<number, Placement>();
  private readonly batches = new Map<string, Batch[]>();
  private readonly meshBatches = new Map<THREE.Object3D, Batch>();
  private readonly reflections = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  private readonly reflection = new THREE.Matrix4().makeScale(-1, 1, 1);
  private readonly matrix = new THREE.Matrix4();
  private readonly bounds = new THREE.Box3();

  constructor(readonly capacity = 1024) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1024)
      throw new RangeError('Batch capacity must be between 1 and 1024.');
  }

  get batchCount(): number {
    let count = 0;
    for (const batch of this.meshBatches.values()) if (batch.mesh.count) count++;
    return count;
  }

  get allocatedBatchCount(): number {
    return this.meshBatches.size;
  }

  get partCount(): number {
    let count = 0;
    for (const batch of this.meshBatches.values()) count += batch.mesh.count;
    return count;
  }

  add(id: number, root: THREE.Object3D): void {
    if (this.placements.has(id)) throw new Error(`Placement ${id} already has batches.`);
    root.updateWorldMatrix(true, true);
    const parts: Part[] = [];
    root.traverseVisible((source) => {
      if (!(source instanceof THREE.Mesh)) return;
      const reflected = source.matrixWorld.determinant() < 0;
      const part: Part = {
        id,
        source,
        matrix: source.matrixWorld.clone(),
        reflected,
        batch: this.batchFor(source, reflected),
        slot: 0,
      };
      this.insert(part);
      parts.push(part);
    });
    this.placements.set(id, { root, parts });
  }

  update(id: number): void {
    const placement = this.placements.get(id);
    if (!placement) return;
    placement.root.updateWorldMatrix(true, true);
    for (const part of placement.parts) {
      if (part.matrix.equals(part.source.matrixWorld)) continue;
      part.matrix.copy(part.source.matrixWorld);
      const reflected = part.matrix.determinant() < 0;
      if (reflected !== part.reflected) {
        this.removePart(part);
        part.reflected = reflected;
        part.batch = this.batchFor(part.source, reflected);
        this.insert(part);
      } else {
        this.write(part);
      }
    }
  }

  remove(id: number): void {
    const placement = this.placements.get(id);
    if (!placement) return;
    for (const part of placement.parts) this.removePart(part);
    this.placements.delete(id);
  }

  placementId(hit: THREE.Intersection): number | undefined {
    if (hit.instanceId === undefined) return undefined;
    return this.meshBatches.get(hit.object)?.parts[hit.instanceId]?.id;
  }

  private batchFor(source: THREE.Mesh, reflected: boolean): Batch {
    const geometry = reflected ? this.reflectedGeometry(source.geometry) : source.geometry;
    const materials = Array.isArray(source.material) ? source.material : [source.material];
    const key = `${geometry.id}/${materials.map((material) => material.uuid).join(',')}/${source.castShadow}/${source.receiveShadow}/${source.renderOrder}/${source.layers.mask}`;
    let batches = this.batches.get(key);
    if (!batches) {
      batches = [];
      this.batches.set(key, batches);
    }
    const available = batches.find((batch) => batch.parts.length < this.capacity);
    if (available) return available;
    const mesh = new THREE.InstancedMesh(geometry, source.material, this.capacity);
    mesh.name = 'Structure batch';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    mesh.renderOrder = source.renderOrder;
    mesh.layers.mask = source.layers.mask;
    mesh.boundingBox = new THREE.Box3();
    mesh.boundingSphere = new THREE.Sphere();
    const batch: Batch = { mesh, parts: [] };
    batches.push(batch);
    this.meshBatches.set(mesh, batch);
    this.group.add(mesh);
    return batch;
  }

  private insert(part: Part): void {
    const { batch } = part;
    part.slot = batch.parts.length;
    batch.parts.push(part);
    batch.mesh.count = batch.parts.length;
    batch.mesh.visible = true;
    this.write(part);
  }

  private write(part: Part): void {
    const { mesh } = part.batch;
    this.matrix.copy(part.matrix);
    if (part.reflected) this.matrix.multiply(this.reflection);
    mesh.setMatrixAt(part.slot, this.matrix);
    mesh.getMatrixAt(part.slot, this.matrix);
    mesh.instanceMatrix.addUpdateRange(part.slot * 16, 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox && mesh.boundingBox && mesh.boundingSphere) {
      this.bounds.copy(mesh.geometry.boundingBox).applyMatrix4(this.matrix);
      // Expanding bounds avoids scanning unchanged instances during pop animations and removals.
      mesh.boundingBox.union(this.bounds);
      mesh.boundingBox.getBoundingSphere(mesh.boundingSphere);
    }
  }

  private removePart(part: Part): void {
    const { batch, slot } = part;
    const last = batch.parts.pop();
    if (!last) return;
    if (last !== part) {
      batch.parts[slot] = last;
      last.slot = slot;
      batch.mesh.getMatrixAt(batch.parts.length, this.matrix);
      batch.mesh.setMatrixAt(slot, this.matrix);
      batch.mesh.instanceMatrix.addUpdateRange(slot * 16, 16);
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
    batch.mesh.count = batch.parts.length;
    batch.mesh.visible = batch.parts.length > 0;
    if (!batch.parts.length) {
      batch.mesh.boundingBox?.makeEmpty();
      batch.mesh.boundingSphere?.makeEmpty();
    }
  }

  private reflectedGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
    const cached = this.reflections.get(source);
    if (cached) return cached;
    // Three.js instances cannot carry a negative determinant. Bake the reflection and reverse winding.
    const geometry = source.clone().applyMatrix4(this.reflection);
    const index = geometry.getIndex();
    const count = index?.count ?? geometry.getAttribute('position').count;
    const reversed: number[] = [];
    for (let i = 0; i < count; i += 3)
      reversed.push(index?.getX(i) ?? i, index?.getX(i + 2) ?? i + 2, index?.getX(i + 1) ?? i + 1);
    geometry.setIndex(reversed);
    const tangent = geometry.getAttribute('tangent');
    if (tangent) for (let i = 0; i < tangent.count; i++) tangent.setW(i, -tangent.getW(i));
    this.reflections.set(source, geometry);
    return geometry;
  }

  dispose(): void {
    for (const batch of this.meshBatches.values()) batch.mesh.dispose();
    for (const geometry of this.reflections.values()) geometry.dispose();
    this.group.clear();
    this.placements.clear();
    this.batches.clear();
    this.meshBatches.clear();
    this.reflections.clear();
  }
}
