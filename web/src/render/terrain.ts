import * as THREE from 'three';
import type { Snapshot } from '../domain';
import { Builder, random, STEP } from './builder';
import { worldMaterial } from './material';
import { tree } from './models';
import { PALETTE, type PaletteName, Surface, type SurfaceId } from './palette';

export { STEP };
export const MARGIN = 3;
const BASE = -1.5;

export function heightAt(snapshot: Snapshot, x: number, z: number): number {
  return (snapshot.cells[z * snapshot.width + x]?.height ?? 0) * STEP;
}

/** Writes raw quads; the terrain has thousands of faces, too many for one BufferGeometry per face. */
class Quads {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly color: number[] = [];
  readonly surface: number[] = [];
  quad(corners: THREE.Vector3[], shades: number[], tint: THREE.Color, surface: SurfaceId): void {
    const [a, b, , d] = corners as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = corners[i] as THREE.Vector3;
      const shade = shades[i] ?? 1;
      this.position.push(p.x, p.y, p.z);
      this.normal.push(n.x, n.y, n.z);
      this.color.push(tint.r * shade, tint.g * shade, tint.b * shade);
      this.surface.push(surface);
    }
  }
  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    geometry.setAttribute('surface', new THREE.Float32BufferAttribute(this.surface, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const;

export class Terrain {
  readonly group = new THREE.Group();
  readonly pickable: THREE.InstancedMesh;
  private readonly resources: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(readonly snapshot: Snapshot) {
    const { width, depth } = snapshot;
    const level = (x: number, z: number): number => {
      const cx = THREE.MathUtils.clamp(x, 0, width - 1),
        cz = THREE.MathUtils.clamp(z, 0, depth - 1);
      return heightAt(snapshot, cx, cz);
    };
    const inside = (x: number, z: number) =>
      x >= -MARGIN && z >= -MARGIN && x < width + MARGIN && z < depth + MARGIN;
    const rng = random(snapshot.seed);
    const quads = new Quads();
    const grass = new THREE.Color(PALETTE.grass);
    const wild = new THREE.Color(PALETTE.leaf).lerp(grass, 0.45);
    const stone = new THREE.Color(PALETTE.stone);
    const coping = new THREE.Color(PALETTE.concrete).multiplyScalar(1.08);
    const soil = new THREE.Color(PALETTE.soil);
    const fractions = [0, 0.18, 0.82, 1];
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    for (let z = -MARGIN; z < depth + MARGIN; z++)
      for (let x = -MARGIN; x < width + MARGIN; x++) {
        const top = level(x, z);
        const playable = x >= 0 && z >= 0 && x < width && z < depth;
        const tint = (playable ? grass : wild).clone().multiplyScalar(0.97 + rng() * 0.04);
        const higher = DIRECTIONS.map(([dx, dz]) => inside(x + dx, z + dz) && level(x + dx, z + dz) > top + 0.01);
        const occlusion = (fx: number, fz: number): number => {
          const weight = (f: number) => (f === 0 ? 1 : f < 0.5 ? 0.35 : 0);
          let shade = 1;
          if (higher[0]) shade -= 0.3 * weight(1 - fz);
          if (higher[1]) shade -= 0.3 * weight(1 - fx);
          if (higher[2]) shade -= 0.3 * weight(fz);
          if (higher[3]) shade -= 0.3 * weight(fx);
          return Math.max(shade, 0.55);
        };
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++) {
            const x0 = fractions[i] as number,
              x1 = fractions[i + 1] as number,
              z0 = fractions[j] as number,
              z1 = fractions[j + 1] as number;
            quads.quad(
              [v(x + x0, top, z + z1), v(x + x1, top, z + z1), v(x + x1, top, z + z0), v(x + x0, top, z + z0)],
              [occlusion(x0, z1), occlusion(x1, z1), occlusion(x1, z0), occlusion(x0, z0)],
              tint,
              Surface.grass,
            );
          }
        DIRECTIONS.forEach(([dx, dz], side) => {
          const outer = !inside(x + dx, z + dz);
          const below = outer ? BASE : level(x + dx, z + dz);
          if (below >= top - 0.01) return;
          // Edge endpoints, ordered so the quad faces outward.
          const ex = [x + 1, x + 1, x, x][side] as number,
            ez = [z + 1, z, z, z + 1][side] as number,
            fx = [x, x + 1, x + 1, x][side] as number,
            fz = [z + 1, z + 1, z, z][side] as number;
          const material = outer ? soil : stone.clone().multiplyScalar(0.94 + rng() * 0.08);
          const surface = outer ? Surface.soil : Surface.stone;
          const wallTop = outer ? top - 0.12 : top;
          quads.quad(
            [v(fx, below, fz), v(ex, below, ez), v(ex, wallTop, ez), v(fx, wallTop, fz)],
            [0.78, 0.78, 1, 1],
            material,
            surface,
          );
          if (outer) {
            quads.quad([v(fx, wallTop, fz), v(ex, wallTop, ez), v(ex, top, ez), v(fx, top, fz)], [1, 1, 1, 1], wild.clone().multiplyScalar(0.8), Surface.grass);
            return;
          }
          // Concrete coping: a lip along the terrace edge that catches light and outlines each terrace.
          const ox = dx * 0.04,
            oz = dz * 0.04;
          const lip = top + 0.05;
          const ix = -dx * 0.08,
            iz = -dz * 0.08;
          quads.quad([v(fx + ox, lip, fz + oz), v(ex + ox, lip, ez + oz), v(ex + ix, lip, ez + iz), v(fx + ix, lip, fz + iz)], [1, 1, 1, 1], coping, Surface.concrete);
          quads.quad([v(fx + ox, top - 0.05, fz + oz), v(ex + ox, top - 0.05, ez + oz), v(ex + ox, lip, ez + oz), v(fx + ox, lip, fz + oz)], [0.92, 0.92, 1, 1], coping, Surface.concrete);
          quads.quad([v(fx + ix, lip, fz + iz), v(ex + ix, lip, ez + iz), v(ex + ix, top, ez + iz), v(fx + ix, top, fz + iz)], [1, 1, 0.8, 0.8], coping, Surface.concrete);
        });
      }
    // Base slab under the diorama.
    const x0 = -MARGIN - 0.12,
      x1 = width + MARGIN + 0.12,
      z0 = -MARGIN - 0.12,
      z1 = depth + MARGIN + 0.12;
    const slab = new THREE.Color(PALETTE.brickDark).multiplyScalar(0.55);
    const yb = BASE - 0.16;
    quads.quad([v(x0, yb, z1), v(x1, yb, z1), v(x1, BASE, z1), v(x0, BASE, z1)], [1, 1, 1, 1], slab, Surface.paint);
    quads.quad([v(x1, yb, z1), v(x1, yb, z0), v(x1, BASE, z0), v(x1, BASE, z1)], [1, 1, 1, 1], slab, Surface.paint);
    quads.quad([v(x1, yb, z0), v(x0, yb, z0), v(x0, BASE, z0), v(x1, BASE, z0)], [1, 1, 1, 1], slab, Surface.paint);
    quads.quad([v(x0, yb, z0), v(x0, yb, z1), v(x0, BASE, z1), v(x0, BASE, z0)], [1, 1, 1, 1], slab, Surface.paint);
    quads.quad([v(x0, BASE, z1), v(x1, BASE, z1), v(x1, BASE, z0), v(x0, BASE, z0)], [1, 1, 1, 1], slab, Surface.paint);

    const ground = new THREE.Mesh(quads.geometry(), worldMaterial);
    ground.receiveShadow = true;
    ground.castShadow = true;
    this.resources.push(ground.geometry);
    this.group.add(ground);
    this.group.add(this.margin(snapshot, level, rng));

    const pickGeometry = new THREE.BoxGeometry(1, 0.1, 1);
    const pickMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.resources.push(pickGeometry, pickMaterial);
    this.pickable = new THREE.InstancedMesh(pickGeometry, pickMaterial, snapshot.cells.length);
    const dummy = new THREE.Object3D();
    snapshot.cells.forEach((cell, index) => {
      dummy.position.set(cell.x + 0.5, cell.height * STEP - 0.05, cell.z + 0.5);
      dummy.updateMatrix();
      this.pickable.setMatrixAt(index, dummy.matrix);
    });
    this.group.add(this.pickable);
  }

  /** Vegetation fringe on the non-playable margin frames the neighborhood like a diorama edge. */
  private margin(snapshot: Snapshot, level: (x: number, z: number) => number, rng: () => number): THREE.Mesh {
    const b = new Builder(false);
    const trees = Array.from({ length: 16 }, (_, i) => tree(i, false));
    for (let z = -MARGIN; z < snapshot.depth + MARGIN; z++)
      for (let x = -MARGIN; x < snapshot.width + MARGIN; x++) {
        if (x >= 0 && z >= 0 && x < snapshot.width && z < snapshot.depth) continue;
        const y = level(x, z);
        const roll = rng();
        const px = x + 0.25 + rng() * 0.5,
          pz = z + 0.25 + rng() * 0.5;
        if (roll < 0.34) {
          const source = trees[Math.floor(rng() * (rng() < 0.85 ? 10 : 16))];
          if (!source) continue;
          const matrix = new THREE.Matrix4()
            .makeRotationY(rng() * Math.PI * 2)
            .scale(new THREE.Vector3().setScalar(0.85 + rng() * 0.6))
            .setPosition(px, y - 0.06, pz);
          b.merge(source, matrix);
        } else if (roll < 0.72) {
          const shrub: PaletteName = rng() < 0.5 ? 'leaf' : 'leafDeep';
          b.blob(0.2 + rng() * 0.16, px, y + 0.08, pz, shrub, Surface.foliage, 0.7, 1);
          if (rng() < 0.5) b.blob(0.14 + rng() * 0.1, px + 0.25, y + 0.05, pz - 0.15, 'leaf', Surface.foliage, 0.7, 0);
        } else if (roll < 0.8) {
          b.blob(0.12 + rng() * 0.1, px, y + 0.02, pz, 'stone', Surface.stone, 0.55, 0);
        }
      }
    for (const source of trees) source.dispose();
    const mesh = new THREE.Mesh(b.finish(), worldMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.resources.push(mesh.geometry);
    return mesh;
  }

  cellFromIntersection(hit: THREE.Intersection): { x: number; z: number } | null {
    if (hit.instanceId === undefined) return null;
    const cell = this.snapshot.cells[hit.instanceId];
    return cell ? { x: cell.x, z: cell.z } : null;
  }

  dispose(): void {
    this.pickable.dispose();
    for (const resource of this.resources) resource.dispose();
  }
}
