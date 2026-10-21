import * as THREE from 'three';
import type { Snapshot, Structure } from '../domain';
import { Builder, STEP } from './builder';
import { worldMaterial } from './material';
import { PALETTE, Surface } from './palette';

/** Details derived from the neighborhood rather than placed: ground cover, utility poles, and cables. */
export interface Lot {
  structure: Structure;
  category: string;
  width: number;
  depth: number;
  height: number;
}

const hash = (x: number, z: number, salt: number) => {
  let h = Math.imul(x + 1013, 0x27d4eb2d) ^ Math.imul(z + 7919, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

function tuft(): THREE.BufferGeometry {
  const b = new Builder(false);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const blade = new THREE.ConeGeometry(0.025, 0.16 + (i % 2) * 0.06, 3);
    blade.rotateZ(Math.cos(a) * 0.35);
    blade.rotateX(Math.sin(a) * 0.35);
    blade.translate(Math.cos(a) * 0.04, 0.08, Math.sin(a) * 0.04);
    b.add(blade, i % 2 ? 'mutedGreen' : 'grass', Surface.foliage);
  }
  return b.finish();
}

function flowers(): THREE.BufferGeometry {
  const b = new Builder(false);
  const colors = ['coral', 'mustard', 'offWhite', 'dustyBlue'] as const;
  for (let i = 0; i < 6; i++) {
    const x = Math.cos(i * 2.4) * 0.12 * (0.4 + (i % 3) * 0.3),
      z = Math.sin(i * 2.4) * 0.12 * (0.4 + (i % 3) * 0.3);
    b.blob(0.05, x, 0.04, z, 'leaf', Surface.foliage, 0.8, 0);
    b.blob(0.028, x, 0.1, z, colors[i % colors.length] ?? 'coral', Surface.paint, 1, 0);
  }
  return b.finish();
}

function pole(): THREE.BufferGeometry {
  const b = new Builder(false);
  b.cylinder(0.05, 2.05, 0, 0, 0, 'concrete', Surface.concrete, 0.03, 6);
  b.block(0.5, 0.04, 0.05, 0, 1.86, 0, 'metal', Surface.metal);
  for (const x of [-0.21, 0, 0.21]) b.cylinder(0.018, 0.05, x, 1.9, 0, 'offWhite', Surface.paint, 0.018, 5);
  b.cylinder(0.08, 0.2, 0.09, 1.5, 0.07, 'metal', Surface.metal, 0.08, 8);
  return b.finish();
}

export class Decor {
  readonly group = new THREE.Group();
  private readonly cover: THREE.InstancedMesh[];
  private readonly poles: THREE.InstancedMesh;
  private readonly cables: THREE.LineSegments;
  private readonly matrix = new THREE.Matrix4();

  constructor(capacity = 2048) {
    this.cover = [tuft(), flowers()].map((geometry) => {
      const mesh = new THREE.InstancedMesh(geometry, worldMaterial, capacity);
      mesh.receiveShadow = true;
      mesh.count = 0;
      this.group.add(mesh);
      return mesh;
    });
    this.poles = new THREE.InstancedMesh(pole(), worldMaterial, 256);
    this.poles.castShadow = true;
    this.poles.receiveShadow = true;
    this.poles.count = 0;
    this.cables = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: PALETTE.tankBlack, transparent: true, opacity: 0.75 }),
    );
    this.group.add(this.poles, this.cables);
  }

  update(snapshot: Snapshot, lots: readonly Lot[]): void {
    const occupied = new Set<number>();
    for (const lot of lots)
      for (let z = lot.structure.z; z < lot.structure.z + lot.depth; z++)
        for (let x = lot.structure.x; x < lot.structure.x + lot.width; x++) occupied.add(z * snapshot.width + x);
    const counts = [0, 0];
    for (const cell of snapshot.cells) {
      if (occupied.has(cell.z * snapshot.width + cell.x)) continue;
      for (let i = 0; i < 2; i++) {
        const roll = hash(cell.x, cell.z, i);
        const kind = roll < 0.16 ? 0 : roll < 0.22 ? 1 : -1;
        const mesh = kind >= 0 ? this.cover[kind] : undefined;
        if (!mesh || (counts[kind] ?? 0) >= mesh.instanceMatrix.count) continue;
        const scale = 0.8 + hash(cell.x, cell.z, i + 7) * 0.7;
        this.matrix
          .makeRotationY(roll * 40)
          .scale(new THREE.Vector3(scale, scale, scale))
          .setPosition(
            cell.x + 0.15 + hash(cell.x, cell.z, i + 3) * 0.7,
            cell.height * STEP,
            cell.z + 0.15 + hash(cell.x, cell.z, i + 5) * 0.7,
          );
        const slot = counts[kind] ?? 0;
        counts[kind] = slot + 1;
        mesh.setMatrixAt(slot, this.matrix);
      }
    }
    this.cover.forEach((mesh, i) => {
      mesh.count = counts[i] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
    this.wire(snapshot, lots);
  }

  /** Poles along streets with spacing, wired to each other and to the nearest homes. */
  private wire(snapshot: Snapshot, lots: readonly Lot[]): void {
    const top = (cell: { x: number; z: number }) => (snapshot.cells[cell.z * snapshot.width + cell.x]?.height ?? 0) * STEP;
    const streets = lots
      .filter((lot) => lot.category === 'path')
      .map((lot) => lot.structure)
      .sort((a, b) => hash(a.x, a.z, 11) - hash(b.x, b.z, 11));
    const poles: THREE.Vector3[] = [];
    for (const street of streets) {
      const point = new THREE.Vector3(street.x + 0.9, top(street), street.z + 0.9);
      if (poles.some((other) => Math.hypot(other.x - point.x, other.z - point.z) < 4.2)) continue;
      poles.push(point);
      if (poles.length >= this.poles.instanceMatrix.count) break;
    }
    poles.forEach((point, i) => {
      this.matrix.makeRotationY(hash(Math.round(point.x), Math.round(point.z), 2) > 0.5 ? 0 : Math.PI / 2).setPosition(point);
      this.poles.setMatrixAt(i, this.matrix);
    });
    this.poles.count = poles.length;
    this.poles.instanceMatrix.needsUpdate = true;
    this.poles.computeBoundingSphere();
    const segments: number[] = [];
    const sag = (from: THREE.Vector3, to: THREE.Vector3, depth: number) => {
      let previous = from;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const next = from.clone().lerp(to, t);
        next.y -= Math.sin(t * Math.PI) * depth;
        segments.push(previous.x, previous.y, previous.z, next.x, next.y, next.z);
        previous = next;
      }
    };
    const head = (p: THREE.Vector3) => p.clone().setY(p.y + 1.9);
    poles.forEach((from, i) => {
      const nearest = poles
        .map((to, j) => ({ j, d: from.distanceTo(to) }))
        .filter(({ j, d }) => j > i && d < 7.5)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const { j } of nearest) {
        const to = poles[j];
        if (to) sag(head(from), head(to), 0.22);
      }
      const homes = lots
        .filter((lot) => lot.category === 'building')
        .map((lot) => {
          const cx = THREE.MathUtils.clamp(from.x, lot.structure.x + 0.1, lot.structure.x + lot.width - 0.1);
          const cz = THREE.MathUtils.clamp(from.z, lot.structure.z + 0.1, lot.structure.z + lot.depth - 0.1);
          return new THREE.Vector3(cx, top(lot.structure) + Math.min(lot.height * 0.75, 1.3), cz);
        })
        .filter((point) => Math.hypot(point.x - from.x, point.z - from.z) < 3.2)
        .sort((a, b) => a.distanceTo(from) - b.distanceTo(from))
        .slice(0, 3);
      for (const home of homes) sag(head(from).setY(from.y + 1.75), home, 0.12);
    });
    this.cables.geometry.dispose();
    this.cables.geometry = new THREE.BufferGeometry();
    this.cables.geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
  }

  dispose(): void {
    for (const mesh of [...this.cover, this.poles]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.cables.geometry.dispose();
    (this.cables.material as THREE.Material).dispose();
  }
}
