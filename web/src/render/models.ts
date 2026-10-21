import * as THREE from 'three';
import { Builder, random } from './builder';
import { type PaletteName, Surface } from './palette';

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
  b.bar(
    new THREE.Vector3(0, height * 0.6, 0),
    new THREE.Vector3(0.18, height * 0.95, 0.06),
    0.035,
    'wood',
    Surface.wood,
  );
  const clusters = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < clusters; i++) {
    const a = (i / clusters) * Math.PI * 2 + rng();
    const r = i === 0 ? 0 : 0.2 + rng() * 0.1;
    const leaf: PaletteName = bloom && rng() < 0.75 ? bloom : i % 2 ? 'leaf' : 'leafDeep';
    b.blob(
      0.26 + rng() * 0.1,
      Math.cos(a) * r,
      height + 0.1 + rng() * 0.18,
      Math.sin(a) * r,
      leaf,
      Surface.foliage,
      0.82,
      1,
    );
  }
  return b.finish();
}
