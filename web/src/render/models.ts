import * as THREE from 'three';
import type { BuildingDefinition } from '../domain';
import { building } from './architecture';
import { Builder, random, STEP } from './builder';
import { worldMaterial } from './material';
import { type PaletteName, Surface } from './palette';

/**
 * What surrounds a structure on each side, in local (unrotated) order: front (+Z), right (+X), back, left.
 * `link` is a street, stair, or building; `open` is level ground; `drop` and `rise` are terrace edges.
 */
export type Edge = 'link' | 'open' | 'drop' | 'rise';
export type Context = readonly [Edge, Edge, Edge, Edge];
export const OPEN: Context = ['open', 'open', 'open', 'open'];

function path(context: Context, variation: number): THREE.BufferGeometry {
  const b = new Builder(false);
  b.block(1, 0.05, 1, 0, -0.02, 0, 'stone', Surface.paving);
  const sides: [number, number, number, number][] = [
    [0, 0.47, 1, 0.06],
    [0.47, 0, 0.06, 1],
    [0, -0.47, 1, 0.06],
    [-0.47, 0, 0.06, 1],
  ];
  context.forEach((edge, side) => {
    const [x, z, w, d] = sides[side] ?? [0, 0, 0, 0];
    if (edge === 'open') b.block(w, 0.075, d, x, 0, z, 'offWhite', Surface.concrete);
    if (edge === 'drop') {
      b.block(w, 0.1, d, x, 0, z, 'concrete', Surface.concrete);
      const along = w > d ? 'x' : 'z';
      for (let i = 0; i <= 4; i++) {
        const t = -0.46 + i * 0.23;
        b.block(0.018, 0.3, 0.018, along === 'x' ? t : x, 0.1, along === 'z' ? t : z, 'metal', Surface.metal);
      }
      b.block(along === 'x' ? 1 : 0.025, 0.025, along === 'z' ? 1 : 0.025, x, 0.38, z, 'teal', Surface.metal);
    }
  });
  const lampSide = context.findIndex((edge) => edge === 'open' || edge === 'drop');
  if (variation % 5 === 0 && lampSide >= 0) {
    const [sx, sz] = sides[lampSide] ?? [0, 0];
    const x = sx ? sx * 0.9 : 0.3,
      z = sz ? sz * 0.9 : 0.3;
    b.cylinder(0.025, 1.15, x, 0.05, z, 'metal', Surface.metal, 0.018, 6);
    b.bar(new THREE.Vector3(x, 1.18, z), new THREE.Vector3(x * 0.55, 1.2, z * 0.55), 0.03, 'metal', Surface.metal);
    b.block(0.1, 0.05, 0.1, x * 0.55, 1.14, z * 0.55, 'lamp', Surface.glass);
  }
  return b.finish();
}

function stairs(): THREE.BufferGeometry {
  const b = new Builder(false);
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const h = ((i + 1) * STEP) / steps;
    b.block(0.8, h, 1 / steps + 0.01, 0, -0.02, -0.5 + (i + 0.5) / steps, i % 2 ? 'stone' : 'offWhite', Surface.concrete);
  }
  for (const x of [-0.45, 0.45]) {
    for (let i = 0; i < steps; i++) {
      const h = ((i + 1) * STEP) / steps + 0.08;
      b.block(0.1, h, 1 / steps, x, -0.02, -0.5 + (i + 0.5) / steps, 'stone', Surface.stone);
    }
  }
  const rail = (x: number) => {
    b.bar(new THREE.Vector3(x, 0.35, -0.48), new THREE.Vector3(x, STEP + 0.36, 0.48), 0.026, 'mustard', Surface.metal);
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      b.block(0.016, 0.3, 0.016, x, (t * STEP * 0.92) + 0.06, -0.46 + t * 0.92, 'metal', Surface.metal);
    }
  };
  rail(0.42);
  return b.finish();
}

export function tree(variation: number, planted = true): THREE.BufferGeometry {
  const b = new Builder(false);
  const rng = random(variation * 131 + 7);
  const bloom: PaletteName | null = variation >= 13 ? 'coral' : variation >= 10 ? 'mustard' : null;
  if (planted) {
    b.block(0.5, 0.08, 0.5, 0, -0.02, 0, 'concrete', Surface.concrete);
    b.block(0.4, 0.02, 0.4, 0, 0.05, 0, 'soil', Surface.soil);
  }
  const height = 0.85 + rng() * 0.3;
  b.cylinder(0.05, height, 0, 0, 0, 'wood', Surface.wood, 0.035, 6);
  b.bar(new THREE.Vector3(0, height * 0.6, 0), new THREE.Vector3(0.18, height * 0.95, 0.06), 0.035, 'wood', Surface.wood);
  const clusters = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < clusters; i++) {
    const a = (i / clusters) * Math.PI * 2 + rng();
    const r = i === 0 ? 0 : 0.2 + rng() * 0.1;
    const leaf: PaletteName = bloom && rng() < 0.75 ? bloom : i % 2 ? 'leaf' : 'leafDeep';
    b.blob(0.26 + rng() * 0.1, Math.cos(a) * r, height + 0.1 + rng() * 0.18, Math.sin(a) * r, leaf, Surface.foliage, 0.82, 1);
  }
  return b.finish();
}

function planter(variation: number): THREE.BufferGeometry {
  const b = new Builder(false);
  b.block(0.7, 0.26, 0.42, 0, -0.02, 0, variation % 2 ? 'terracotta' : 'concrete', variation % 2 ? Surface.plaster : Surface.concrete);
  b.block(0.62, 0.02, 0.34, 0, 0.23, 0, 'soil', Surface.soil);
  const flowers: PaletteName[] = ['coral', 'mustard', 'offWhite', 'coral'];
  for (let i = 0; i < 4; i++) {
    const x = -0.22 + i * 0.15;
    b.blob(0.13, x, 0.33, (i % 2) * 0.05 - 0.02, i % 2 ? 'leaf' : 'leafDeep', Surface.foliage, 0.8, 0);
    b.blob(0.035, x + 0.03, 0.44, 0.04, flowers[(i + variation) % 4] ?? 'coral', Surface.paint, 1, 0);
  }
  return b.finish();
}

function bench(): THREE.BufferGeometry {
  const b = new Builder(false);
  b.block(1, 0.03, 1, 0, -0.02, 0, 'stone', Surface.paving);
  for (const x of [-0.28, 0.28]) b.block(0.08, 0.2, 0.3, x, 0, -0.05, 'concrete', Surface.concrete);
  for (let i = 0; i < 3; i++) b.block(0.74, 0.03, 0.08, 0, 0.2, -0.15 + i * 0.1, 'wood', Surface.wood);
  b.block(0.74, 0.16, 0.03, 0, 0.26, -0.2, 'wood', Surface.wood);
  b.block(0.28, 0.32, 0.28, 0.42, 0, 0.32, 'terracotta', Surface.plaster);
  b.blob(0.18, 0.42, 0.42, 0.32, 'leaf', Surface.foliage, 0.9, 1);
  return b.finish();
}

export class ModelLibrary {
  readonly material = worldMaterial;
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly definitions: Map<string, BuildingDefinition>;
  constructor(readonly catalog: BuildingDefinition[]) {
    this.definitions = new Map(catalog.map((def) => [def.id, def]));
  }

  /** Geometry varies by kind, a 16-way seeded variation, and (for streets) the surrounding context. */
  private geometry(kind: string, variation: number, context: Context): THREE.BufferGeometry {
    const def = this.definitions.get(kind);
    if (!def) throw new Error(`Unknown model ${kind}`);
    const variant = Math.abs(variation) % 16;
    const key =
      def.category === 'building'
        ? `${kind}/${variant}`
        : kind === 'path'
          ? `path/${variant % 5 === 0 ? 'lamp' : 'plain'}/${context.join(',')}`
          : kind === 'tree' || kind === 'planter'
            ? `${kind}/${variant}`
            : kind;
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry =
        def.category === 'building'
          ? building(kind, def.width, def.depth, variant)
          : kind === 'path'
            ? path(context, variant)
            : kind === 'stairs'
              ? stairs()
              : kind === 'tree'
                ? tree(variant)
                : kind === 'planter'
                  ? planter(variant)
                  : bench();
      this.geometries.set(key, geometry);
    }
    return geometry;
  }

  create(kind: string, variation = 0, context: Context = OPEN): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry(kind, variation, context), this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
  }
}
