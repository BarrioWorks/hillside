import * as THREE from 'three';
import type { Snapshot } from '../domain';
export const STEP = 0.55;
export function heightAt(snapshot: Snapshot, x: number, z: number): number {
  return (snapshot.cells.find((cell) => cell.x === x && cell.z === z)?.height ?? 0) * STEP;
}
export class Terrain {
  readonly group = new THREE.Group();
  readonly pickable: THREE.InstancedMesh;
  private readonly resources: (THREE.BufferGeometry | THREE.Material)[] = [];
  constructor(readonly snapshot: Snapshot) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    this.resources.push(geometry, material);
    this.pickable = new THREE.InstancedMesh(geometry, material, snapshot.cells.length);
    const soil = new THREE.InstancedMesh(geometry, material, snapshot.cells.length);
    const dummy = new THREE.Object3D();
    snapshot.cells.forEach((cell, index) => {
      const top = cell.height * STEP;
      const floor = -1.2;
      const variation = Math.sin(cell.x * 17.23 + cell.z * 7.93 + snapshot.seed) * 0.5 + 0.5;
      dummy.position.set(cell.x + 0.5, (top + floor) / 2 - 0.045, cell.z + 0.5);
      dummy.scale.set(0.998, top - floor - 0.09, 0.998);
      dummy.updateMatrix();
      soil.setMatrixAt(index, dummy.matrix);
      soil.setColorAt(index, new THREE.Color().setHSL(0.1, 0.18, 0.52 + variation * 0.045));
      dummy.position.set(cell.x + 0.5, top - 0.045, cell.z + 0.5);
      dummy.scale.set(1, 0.09, 1);
      dummy.updateMatrix();
      this.pickable.setMatrixAt(index, dummy.matrix);
      this.pickable.setColorAt(
        index,
        new THREE.Color().setHSL(0.235 + variation * 0.012, 0.32, 0.38 + variation * 0.025),
      );
    });
    this.pickable.receiveShadow = true;
    soil.receiveShadow = true;
    soil.castShadow = true;
    this.group.add(soil, this.pickable);
    this.landscape(snapshot);
  }
  private landscape(snapshot: Snapshot): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshStandardMaterial({ color: '#c7d4bf', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.3;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.resources.push(ground.geometry, ground.material);
    const mountainGeometry = new THREE.ConeGeometry(1, 1, 7);
    const mountainMaterial = new THREE.MeshStandardMaterial({
      color: '#91b2a2',
      roughness: 1,
      flatShading: true,
    });
    const mountains = new THREE.InstancedMesh(mountainGeometry, mountainMaterial, 16);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const radius = 70 + (i % 3) * 12;
      dummy.position.set(16 + Math.cos(angle) * radius, 2 + (i % 4) * 2, 16 + Math.sin(angle) * radius);
      dummy.scale.set(19 + (i % 3) * 7, 14 + (i % 5) * 4, 16 + (i % 4) * 4);
      dummy.rotation.y = i * 0.7;
      dummy.updateMatrix();
      mountains.setMatrixAt(i, dummy.matrix);
      mountains.setColorAt(i, new THREE.Color().setHSL(0.39, 0.12, 0.57 + (i % 3) * 0.035));
    }
    this.group.add(mountains);
    this.resources.push(mountainGeometry, mountainMaterial);
    const trunkGeometry = new THREE.CylinderGeometry(0.055, 0.1, 0.8, 5),
      leavesGeometry = new THREE.IcosahedronGeometry(0.52, 1);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#7c7657' }),
      leavesMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    this.resources.push(trunkGeometry, leavesGeometry, trunkMaterial, leavesMaterial);
    const count = 180,
      trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count),
      leaves = new THREE.InstancedMesh(leavesGeometry, leavesMaterial, count);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399;
      const r = 21 + (i % 17) * 0.8;
      const x = 16 + Math.cos(angle) * r,
        z = 16 + Math.sin(angle) * r;
      const inside = x >= 0 && x < snapshot.width && z >= 0 && z < snapshot.depth;
      const y = inside ? heightAt(snapshot, Math.floor(x), Math.floor(z)) : -1.2;
      const scale = 0.8 + (i % 7) * 0.15;
      dummy.position.set(x, y + 0.4 * scale, z);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.y = y + 1.0 * scale;
      dummy.scale.set(scale, scale * 1.2, scale);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
      leaves.setColorAt(i, new THREE.Color().setHSL(0.29 + (i % 4) * 0.018, 0.24, 0.34 + (i % 5) * 0.025));
    }
    trunks.castShadow = true;
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    this.group.add(trunks, leaves);
    // Border scenery stays outside playable cells; placement never has to fight decoration.
    for (let i = 0; i < count; i++) {
      const matrix = new THREE.Matrix4();
      trunks.getMatrixAt(i, matrix);
      const p = new THREE.Vector3().setFromMatrixPosition(matrix);
      if (p.x >= 0 && p.x < snapshot.width && p.z >= 0 && p.z < snapshot.depth) {
        matrix.makeScale(0, 0, 0);
        trunks.setMatrixAt(i, matrix);
        leaves.setMatrixAt(i, matrix);
      }
    }
  }
  cellFromIntersection(hit: THREE.Intersection): { x: number; z: number } | null {
    if (hit.instanceId === undefined) return null;
    const cell = this.snapshot.cells[hit.instanceId];
    return cell ? { x: cell.x, z: cell.z } : null;
  }
  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    for (const resource of this.resources) resource.dispose();
  }
}
