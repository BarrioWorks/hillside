import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingDefinition } from '../domain';

const white = '#e8e6d8',
  concrete = '#b8b8a7',
  dark = '#294a4c',
  metal = '#4c6260',
  brick = '#b56d4e',
  leaf = '#387b4d';
class Shapes {
  readonly parts: THREE.BufferGeometry[] = [];
  add(geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number, rotation = 0): void {
    geometry.rotateY(rotation);
    geometry.translate(x, y, z);
    const rgb = new THREE.Color(color);
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = rgb.r;
      colors[i * 3 + 1] = rgb.g;
      colors[i * 3 + 2] = rgb.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.deleteAttribute('uv');
    this.parts.push(geometry);
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string): void {
    this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z);
  }
  cylinder(r: number, h: number, x: number, y: number, z: number, color: string, top = r): void {
    this.add(new THREE.CylinderGeometry(top, r, h, 10), color, x, y, z);
  }
  bush(x: number, y: number, z: number, r = 0.17): void {
    this.add(new THREE.IcosahedronGeometry(r, 1), leaf, x, y, z);
  }
  planter(x: number, y: number, z: number): void {
    this.box(0.26, 0.22, 0.25, x, y + 0.11, z, brick);
    this.bush(x, y + 0.3, z);
  }
  finish(): THREE.BufferGeometry {
    const normalized = this.parts.map((part) => (part.index ? part.toNonIndexed() : part));
    const result = mergeGeometries(normalized);
    for (const part of normalized) part.dispose();
    for (const part of this.parts) part.dispose();
    if (!result) throw new Error('Could not assemble building geometry.');
    result.computeBoundingBox();
    return result;
  }
}
function windowFront(s: Shapes, x: number, y: number, z: number, w = 0.24, h = 0.33, grille = false): void {
  s.box(w + 0.07, h + 0.07, 0.055, x, y, z, white);
  s.box(w, h, 0.066, x, y, z + 0.01, dark);
  s.box(w + 0.13, 0.055, 0.15, x, y - h / 2 - 0.04, z + 0.04, concrete);
  s.box(0.025, h, 0.075, x, y, z + 0.025, white);
  if (grille)
    for (let i = -1; i <= 1; i++) s.box(0.012, h + 0.04, 0.03, x + (i * w) / 3, y, z + 0.065, metal);
}
function windowSide(s: Shapes, x: number, y: number, z: number): void {
  s.box(0.055, 0.4, 0.33, x, y, z, white);
  s.box(0.066, 0.32, 0.25, x + 0.01, y, z, dark);
  s.box(0.085, 0.33, 0.025, x + 0.02, y, z, white);
}
function railing(s: Shapes, x: number, y: number, z: number, w: number): void {
  s.box(w, 0.035, 0.035, x, y + 0.28, z, metal);
  for (let i = 0; i <= Math.ceil(w / 0.13); i++)
    s.box(0.018, 0.3, 0.025, x - w / 2 + (i * w) / Math.ceil(w / 0.13), y + 0.13, z, metal);
}
function roof(s: Shapes, w: number, d: number, h: number, tank = true): void {
  s.box(w + 0.08, 0.12, d + 0.08, 0, h, 0, concrete);
  s.box(w + 0.08, 0.21, 0.065, 0, h + 0.12, -d / 2, white);
  s.box(w + 0.08, 0.21, 0.065, 0, h + 0.12, d / 2, white);
  s.box(0.065, 0.21, d, -w / 2, h + 0.12, 0, white);
  s.box(0.065, 0.21, d, w / 2, h + 0.12, 0, white);
  if (tank) {
    s.box(0.35, 0.08, 0.35, -w * 0.23, h + 0.1, -d * 0.2, concrete);
    s.cylinder(0.15, 0.34, -w * 0.23, h + 0.31, -d * 0.2, '#455c65');
    s.cylinder(0.17, 0.04, -w * 0.23, h + 0.5, -d * 0.2, metal);
  }
}
function balcony(s: Shapes, w: number, y: number, z: number): void {
  s.box(w, 0.075, 0.34, 0, y - 0.23, z + 0.13, concrete);
  railing(s, 0, y - 0.18, z + 0.3, w);
  s.box(0.025, 0.29, 0.3, -w / 2, y - 0.04, z + 0.15, metal);
  s.box(0.025, 0.29, 0.3, w / 2, y - 0.04, z + 0.15, metal);
}
function bricks(s: Shapes, w: number, d: number, y: number, rows = 4): void {
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < Math.floor(w / 0.22); col++) {
      const x = -w / 2 + 0.1 + col * 0.22 + (row % 2) * 0.07;
      if (x < w / 2 - 0.05) s.box(0.17, 0.012, 0.012, x, y + row * 0.11, d / 2 + 0.004, '#d79670');
    }
}
const variants: Record<string, readonly string[]> = {
  casa: ['#e9b44c', '#cf8066', '#8bb4b4'],
  tienda: ['#e77c65', '#d6a14f', '#83a99e'],
  torre: ['#b96547', '#ab674f', '#c07855'],
  terraza: ['#69aeb5', '#8ba788', '#cf987a'],
  taller: ['#cb8063', '#b18b68', '#9aa6a0'],
  esquina: ['#e7d8b5', '#c8d4cc', '#d5b1a0'],
};
function architecture(source: BuildingDefinition, variation: number): THREE.BufferGeometry {
  const def = { ...source, color: variants[source.id]?.[variation] ?? source.color };
  const s = new Shapes();
  const w = def.width * 0.85,
    d = def.depth * 0.84;
  const h = Math.max(0.8, def.height);
  const front = d / 2;
  if (def.id === 'casa') {
    s.box(w, h, d, 0, h / 2, 0, def.color);
    s.box(w, 0.46, d + 0.012, 0, 0.23, 0, brick);
    bricks(s, w, d, 0.08, 4);
    s.box(0.25, 0.57, 0.055, -w * 0.22, 0.3, front + 0.03, '#466e76');
    windowFront(s, w * 0.23, 0.65, front + 0.03, 0.24, 0.34, true);
    roof(s, w, d, h);
    s.planter(w * 0.28, h + 0.06, d * 0.25);
  } else if (def.id === 'tienda') {
    s.box(w, h, d, 0, h / 2, 0, def.color);
    s.box(w, 0.13, d + 0.04, 0, 0.12, 0, brick);
    s.box(w * 0.67, 0.59, 0.06, -w * 0.08, 0.36, front + 0.04, dark);
    s.box(0.04, 0.6, 0.075, -w * 0.08, 0.36, front + 0.08, white);
    s.box(w * 0.85, 0.17, 0.09, 0, 0.83, front + 0.04, '#f2df9c');
    for (let i = 0; i < 7; i++)
      s.box(w * 0.14, 0.06, 0.45, -w * 0.42 + i * w * 0.14, 0.72, front + 0.2, i % 2 ? '#e9e5d2' : '#3a8c7f');
    if (h > 1.6) {
      windowFront(s, -w * 0.24, h - 0.46, front + 0.025);
      windowFront(s, w * 0.24, h - 0.46, front + 0.025);
    }
    roof(s, w, d, h);
    s.box(0.3, 0.28, 0.23, w * 0.35, 0.14, front + 0.23, brick);
    s.bush(w * 0.35, 0.4, front + 0.23, 0.18);
  } else if (def.id === 'torre') {
    s.box(w * 0.92, h, d * 0.9, 0, h / 2, 0, brick);
    bricks(s, w * 0.92, d * 0.9, 0.12, Math.floor(h / 0.11) - 1);
    s.box(0.11, h, d + 0.03, -w * 0.46, h / 2, 0, concrete);
    s.box(0.11, h, d + 0.03, w * 0.46, h / 2, 0, concrete);
    for (let level = 0.5; level < h - 0.15; level += 0.72) {
      windowFront(s, -w * 0.21, level, front * 0.91, 0.2, 0.34);
      windowFront(s, w * 0.21, level, front * 0.91, 0.2, 0.34);
      balcony(s, w * 0.94, level, front * 0.94);
    }
    roof(s, w, d, h);
    s.box(w * 0.45, 0.38, d * 0.4, w * 0.15, h + 0.19, -d * 0.2, '#cf9a72');
    roof(s, w * 0.5, d * 0.45, h + 0.4, false);
  } else if (def.id === 'terraza') {
    s.box(w, h * 0.65, d, 0, h * 0.325, 0, def.color);
    roof(s, w, d, h * 0.65, false);
    s.box(w * 0.47, h * 0.35, d * 0.47, -w * 0.24, h * 0.825, -d * 0.25, white);
    roof(s, w * 0.49, d * 0.49, h, false);
    windowFront(s, -w * 0.24, h * 0.34, front + 0.03, 0.28, 0.37);
    s.box(0.25, 0.57, 0.06, w * 0.25, 0.3, front + 0.03, dark);
    for (const x of [-w * 0.4, w * 0.4]) {
      s.box(0.045, 0.6, 0.045, x, h * 0.65 + 0.3, d * 0.18, metal);
      s.planter(x, h * 0.65 + 0.06, d * 0.38);
    }
    for (let i = 0; i < 5; i++)
      s.box(w * 0.94, 0.045, 0.055, 0, h * 0.65 + 0.62, -d * 0.05 + i * 0.16, '#d7b58a');
    s.box(0.35, 0.035, 0.3, 0, h * 0.65 + 0.3, d * 0.23, white);
    s.cylinder(0.03, 0.3, 0, h * 0.65 + 0.15, d * 0.23, metal);
    railing(s, 0, h * 0.65 + 0.03, front, w);
  } else if (def.id === 'taller') {
    s.box(w, h * 0.75, d, 0, h * 0.375, 0, def.color);
    s.box(w * 0.75, 0.65, 0.08, 0, 0.36, front + 0.03, metal);
    for (let i = 0; i < 8; i++) s.box(w * 0.73, 0.016, 0.025, 0, 0.08 + i * 0.075, front + 0.08, '#81918a');
    s.box(w * 0.92, 0.12, d + 0.12, 0, h * 0.75, 0, concrete);
    s.box(w * 0.45, h * 0.25, d * 0.75, -w * 0.23, h * 0.875, -d * 0.1, brick);
    roof(s, w * 0.48, d * 0.78, h, false);
    windowFront(s, -w * 0.23, h * 0.86, front * 0.6, 0.2, 0.22, true);
    s.cylinder(0.07, 0.5, w * 0.29, h * 0.75 + 0.25, -d * 0.25, metal);
    s.box(0.24, 0.3, 0.24, w * 0.43, 0.15, front + 0.24, '#ba9c64');
  } else if (def.id === 'esquina') {
    s.box(w, h, d, 0, h / 2, 0, def.color);
    s.box(w, 0.43, d + 0.02, 0, 0.215, 0, white);
    s.box(w * 0.5, 0.62, 0.06, -w * 0.18, 0.33, front + 0.04, '#397c86');
    windowFront(s, w * 0.29, 0.57, front + 0.03, 0.24, 0.28, true);
    for (let y = 1; y < h - 0.1; y += 0.7) {
      windowFront(s, -w * 0.23, y, front + 0.02);
      windowFront(s, w * 0.23, y, front + 0.02);
      windowSide(s, w / 2 + 0.02, y, 0);
      balcony(s, w * 0.95, y, front + 0.02);
    }
    roof(s, w, d, h);
    s.planter(w * 0.28, h + 0.06, d * 0.25);
  }
  windowSide(s, w / 2 + 0.018, Math.min(h - 0.3, 0.75), -d * 0.15);
  if (variation === 1) {
    s.planter(w * 0.27, h + 0.06, -d * 0.28);
    s.planter(w * 0.27, h + 0.06, d * 0.24);
  }
  if (variation === 2) {
    s.box(0.1, 0.55, 0.1, -w * 0.28, h + 0.3, d * 0.22, metal);
    s.box(0.4, 0.03, 0.03, -w * 0.28, h + 0.54, d * 0.22, metal);
    s.box(0.03, 0.03, 0.24, -w * 0.28, h + 0.54, d * 0.22, metal);
  }
  return s.finish();
}
function prop(def: BuildingDefinition): THREE.BufferGeometry {
  const s = new Shapes();
  if (def.id === 'path') {
    s.box(0.98, 0.07, 0.98, 0, 0.025, 0, '#c5c0a9');
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        s.box(
          0.294,
          0.025,
          0.294,
          -0.315 + i * 0.315,
          0.073,
          -0.315 + j * 0.315,
          (i + j) % 2 ? '#d6d0bb' : '#ddd6bf',
        );
  } else if (def.id === 'stairs') {
    for (let i = 0; i < 6; i++) {
      const h = ((i + 1) * 0.55) / 6;
      s.box(0.85, h, 1 / 6, 0, h / 2, -0.5 + (i + 0.5) / 6, concrete);
    }
    for (const x of [-0.45, 0.45]) {
      for (let i = 0; i < 4; i++)
        s.box(0.025, 0.35, 0.025, x, 0.17 + (i * 0.55) / 3, -0.46 + (i * 0.92) / 3, metal);
      const rail = new THREE.BoxGeometry(0.025, 0.025, 1.1);
      rail.rotateX(-Math.atan(0.55));
      s.add(rail, metal, x, 0.61, 0);
    }
  } else if (def.id === 'tree') {
    s.cylinder(0.055, 0.7, 0, 0.35, 0, '#866c4a');
    s.bush(0, 0.92, 0, 0.43);
    s.bush(0.2, 1.1, 0.08, 0.32);
    s.bush(-0.17, 0.95, -0.18, 0.31);
    s.box(0.53, 0.07, 0.53, 0, 0.035, 0, brick);
  } else if (def.id === 'planter') {
    s.box(0.66, 0.29, 0.4, 0, 0.145, 0, brick);
    for (const x of [-0.2, 0, 0.2]) {
      s.bush(x, 0.4, 0, 0.19);
      s.cylinder(0.035, 0.08, x, 0.58, 0, '#e9c465');
    }
  } else {
    s.box(0.75, 0.06, 0.32, 0, 0.3, 0, '#ac8554');
    s.box(0.75, 0.27, 0.04, 0, 0.46, -0.15, '#ac8554');
    for (const x of [-0.27, 0.27]) s.box(0.045, 0.3, 0.27, x, 0.15, 0, metal);
  }
  return s.finish();
}
export class ModelLibrary {
  readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private awning: THREE.Object3D | null = null;
  private overhang: THREE.Object3D | null = null;
  detailsStatus: 'loading' | 'ready' | 'error' = 'loading';
  constructor(readonly catalog: BuildingDefinition[]) {
    for (const def of catalog) {
      for (let variant = 0; variant < 3; variant++)
        this.geometries.set(
          `${def.id}/${variant}`,
          def.category === 'building' ? architecture(def, variant) : prop(def),
        );
    }
  }
  async loadDetails(): Promise<void> {
    const loader = new GLTFLoader();
    const results = await Promise.allSettled([
      loader.loadAsync('/models/detail-awning.glb'),
      loader.loadAsync('/models/detail-overhang.glb'),
    ]);
    const [awning, overhang] = results;
    if (awning?.status === 'fulfilled') this.awning = awning.value.scene;
    if (overhang?.status === 'fulfilled') this.overhang = overhang.value.scene;
    this.detailsStatus = this.awning && this.overhang ? 'ready' : 'error';
  }
  create(kind: string, variation = 0): THREE.Mesh {
    const variant = Math.abs(variation) % 3;
    const geometry = this.geometries.get(`${kind}/${variant}`);
    if (!geometry) throw new Error(`Unknown model ${kind}`);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const definition = this.catalog.find((def) => def.id === kind);
    const source = kind === 'tienda' ? this.awning : kind === 'taller' ? this.overhang : null;
    if (source && definition) {
      const detail = source.clone(true);
      detail.position.set(0, 0, 0);
      detail.rotation.set(0, 0, 0);
      detail.scale.setScalar(1);
      detail.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(detail);
      const size = bounds.getSize(new THREE.Vector3());
      const scale = Math.min(1.2, (definition.width * 0.72) / Math.max(size.x, 0.01));
      const center = bounds.getCenter(new THREE.Vector3());
      const wrapper = new THREE.Group();
      wrapper.add(detail);
      detail.position.set(-center.x, -bounds.min.y, -bounds.min.z);
      wrapper.scale.setScalar(scale);
      wrapper.position.set(
        0,
        kind === 'tienda' ? 0.71 : definition.height * 0.73,
        definition.depth * 0.42 + 0.01,
      );
      wrapper.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      mesh.add(wrapper);
    }
    return mesh;
  }
  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.material.dispose();
  }
}
