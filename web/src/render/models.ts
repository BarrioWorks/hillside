import * as THREE from 'three';
import { Builder, type Paint, random } from './builder';
import { PALETTE, type PaletteName, Surface } from './palette';

/** The five broadleaf silhouettes. Each has a few cached geometry variants; palms and shrubs are separate. */
export const BROADLEAVES = ['rounded', 'spreading', 'andean', 'woodland'] as const;
export type Broadleaf = (typeof BROADLEAVES)[number];
export const BLOOMS = ['gold', 'pink'] as const;
export type Bloom = (typeof BLOOMS)[number];
export const VARIANTS = [0, 1, 2] as const;
export type Variant = (typeof VARIANTS)[number];
export type PalmKind = 'wax' | 'coconut';
export const SHRUB_VARIANTS = 8;
export type DetailKind = 'fern' | 'grass' | 'dryGrass' | 'flowers' | 'rock';
export const DETAIL_VARIANTS = 2;

/** Everything a nature sector can grow. `kind` picks the recipe; the rest picks one cached geometry. */
export type Plant =
  | { kind: 'tree'; family: Broadleaf; variant: Variant }
  | { kind: 'flowering'; bloom: Bloom; variant: Variant }
  | { kind: 'palm'; palm: PalmKind; variant: Variant }
  | { kind: 'shrub'; variant: number };
/** Low ground cover; `tint` names the blossom color for flowers and is ignored otherwise. */
export interface Detail {
  kind: DetailKind;
  variant: number;
  tint: PaletteName;
}

/** Cache identity: one geometry per key, so the library stays a fixed, small set however many trees grow. */
export function plantKey(plant: Plant): string {
  switch (plant.kind) {
    case 'tree':
      return `tree/${plant.family}/${plant.variant}`;
    case 'flowering':
      return `tree/flowering/${plant.bloom}/${plant.variant}`;
    case 'palm':
      return `palm/${plant.palm}/${plant.variant}`;
    case 'shrub':
      return `shrub/${plant.variant}`;
    default: {
      const _exhaustive: never = plant;
      return _exhaustive;
    }
  }
}
export function detailKey(detail: Detail): string {
  return detail.kind === 'flowers'
    ? `ground/flowers/${detail.tint}/${detail.variant}`
    : detail.kind === 'rock'
      ? `rock/${detail.variant}`
      : `ground/${detail.kind}/${detail.variant}`;
}

export function plantModel(plant: Plant): THREE.BufferGeometry {
  switch (plant.kind) {
    case 'tree':
      return broadleaf(plant.family, plant.variant);
    case 'flowering':
      return flowering(plant.bloom, plant.variant);
    case 'palm':
      return palm(plant.variant, plant.palm === 'wax');
    case 'shrub':
      return shrub(plant.variant);
    default: {
      const _exhaustive: never = plant;
      return _exhaustive;
    }
  }
}
export function detailModel(detail: Detail): THREE.BufferGeometry {
  switch (detail.kind) {
    case 'fern':
      return fern(detail.variant);
    case 'grass':
      return grass(detail.variant, false);
    case 'dryGrass':
      return grass(detail.variant, true);
    case 'flowers':
      return flowers(detail.variant, detail.tint);
    case 'rock':
      return rock(detail.variant);
    default: {
      const _exhaustive: never = detail.kind;
      return _exhaustive;
    }
  }
}

const linear = (name: PaletteName) => new THREE.Color(PALETTE[name]);
const mix = (a: PaletteName, b: PaletteName, t: number) => linear(a).lerp(linear(b), t);
/** Three value groups per crown: cool shadowed underside, body, warm light top. */
interface Tone {
  low: THREE.Color;
  mid: THREE.Color;
  high: THREE.Color;
}
const TONES: Record<Broadleaf, Tone> = {
  rounded: {
    low: linear('crownDeep'),
    mid: mix('crownMid', 'leaf', 0.35),
    high: mix('crownLight', 'meadowLight', 0.25),
  },
  spreading: {
    low: mix('crownDeep', 'leafDeep', 0.3),
    mid: mix('crownMid', 'mutedGreen', 0.3),
    high: mix('crownLight', 'mutedGreen', 0.5),
  },
  andean: {
    low: mix('crownDeep', 'teal', 0.2),
    mid: mix('crownMid', 'teal', 0.18),
    high: mix('crownLight', 'teal', 0.12),
  },
  woodland: {
    low: mix('crownDeep', 'leafDeep', 0.45),
    mid: mix('crownMid', 'leafDeep', 0.25),
    high: linear('crownLight'),
  },
};
const BLOOM_TONES: Record<Bloom, Tone> = {
  gold: {
    low: mix('mustard', 'ochre', 0.55).multiplyScalar(0.78),
    mid: linear('mustard'),
    high: mix('mustard', 'cream', 0.3),
  },
  pink: {
    low: mix('coral', 'bloom', 0.55).multiplyScalar(0.78),
    mid: mix('coral', 'bloom', 0.4),
    high: mix('coral', 'offWhite', 0.35),
  },
};
const BARK = linear('wood');
const PALE_BARK = mix('wood', 'stone', 0.4);
const DARK_BARK = mix('wood', 'windowDark', 0.25);

interface Lobe {
  x: number;
  y: number;
  z: number;
  /** Radii along x, y and z before the yaw. */
  rx: number;
  ry: number;
  rz: number;
  detail: 0 | 1;
  /** Lean of the lobe's vertical axis, radians, toward its yaw. */
  tilt?: number;
}

/**
 * Canopy masses from irregular, softly faceted ellipsoids. Displacement is a smooth function of direction,
 * so every lobe stays closed. Each facet takes one color from its height in the crown and how much it faces
 * the sky, giving painted value groups instead of smooth gradients.
 */
function crown(b: Builder, lobes: readonly Lobe[], tone: Tone, rng: () => number): void {
  const bottom = Math.min(...lobes.map((l) => l.y - l.ry * 0.7));
  const top = Math.max(...lobes.map((l) => l.y + l.ry));
  const v = new THREE.Vector3();
  const flat = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const color = new THREE.Color();
  for (const lobe of lobes) {
    const base = new THREE.IcosahedronGeometry(1, lobe.detail);
    const source = base.getAttribute('position');
    const count = source.count;
    const position = new Float32Array(count * 3);
    const radial = new Float32Array(count * 3);
    const phase = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
    const yaw = rng() * Math.PI * 2;
    const orient = new THREE.Matrix4()
      .makeRotationY(yaw)
      .multiply(new THREE.Matrix4().makeRotationX(lobe.tilt ?? 0));
    const turn = new THREE.Matrix3().setFromMatrix4(orient);
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(source, i).normalize();
      const k =
        1 +
        0.15 * Math.sin(v.x * 3.1 + (phase[0] ?? 0)) * Math.cos(v.z * 2.7 + (phase[1] ?? 0)) +
        0.08 * Math.sin(v.y * 4.3 + (phase[2] ?? 0));
      const y = v.y < -0.25 ? -0.25 + (v.y + 0.25) * 0.5 : v.y;
      e1.set(v.x * k * lobe.rx, y * k * lobe.ry, v.z * k * lobe.rz).applyMatrix3(turn);
      position.set([e1.x + lobe.x, e1.y + lobe.y, e1.z + lobe.z], i * 3);
      e2.set(v.x / lobe.rx, v.y / lobe.ry, v.z / lobe.rz)
        .applyMatrix3(turn)
        .normalize();
      radial.set([e2.x, e2.y, e2.z], i * 3);
    }
    base.dispose();
    const normal = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const shift = (rng() - 0.5) * 0.12;
    for (let t = 0; t < count; t += 3) {
      const a = new THREE.Vector3().fromArray(position, t * 3);
      e1.fromArray(position, t * 3 + 3).sub(a);
      e2.fromArray(position, t * 3 + 6).sub(a);
      flat.crossVectors(e1, e2).normalize();
      const centroid = (a.y + (position[t * 3 + 4] ?? 0) + (position[t * 3 + 7] ?? 0)) / 3;
      const height = THREE.MathUtils.clamp((centroid - bottom) / (top - bottom || 1), 0, 1);
      const value = THREE.MathUtils.clamp(height * 0.7 + Math.max(0, flat.y) * 0.4 - 0.12 + shift, 0, 1);
      if (value < 0.45) color.copy(tone.low).lerp(tone.mid, value / 0.45);
      else color.copy(tone.mid).lerp(tone.high, (value - 0.45) / 0.55);
      for (let corner = 0; corner < 3; corner++) {
        const at = (t + corner) * 3;
        v.fromArray(radial, at).multiplyScalar(0.45).addScaledVector(flat, 0.55).normalize();
        normal.set([v.x, v.y, v.z], at);
        colors.set([color.r, color.g, color.b], at);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute(
      'surface',
      new THREE.BufferAttribute(new Float32Array(count).fill(Surface.foliage), 1),
    );
    b.merge(geometry, IDENTITY);
    geometry.dispose();
  }
}
const IDENTITY = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** A tapered five-sided branch segment from `from` to `to`. */
function limb(b: Builder, from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, bark: Paint): void {
  const direction = to.clone().sub(from);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(r1, r0, length, 5, 1);
  geometry.translate(0, length / 2, 0);
  const matrix = new THREE.Matrix4().compose(
    from,
    new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()),
    new THREE.Vector3(1, 1, 1),
  );
  b.add(geometry, bark, Surface.wood, matrix);
}
const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const FAMILY_SEED: Record<Broadleaf | 'flowering', number> = {
  rounded: 11,
  spreading: 23,
  andean: 37,
  woodland: 41,
  flowering: 53,
};
const seeded = (family: Broadleaf | 'flowering', variant: Variant) =>
  random(FAMILY_SEED[family] * 1009 + variant * 7919 + 17);

export function broadleaf(family: Broadleaf, variant: Variant): THREE.BufferGeometry {
  const b = new Builder(false);
  const rng = seeded(family, variant);
  const lobes: Lobe[] = [];
  let bark = BARK;
  switch (family) {
    case 'rounded': {
      // Compact: a short trunk and a dense dome in two tiers, the upper smaller and warmer.
      const height = 0.48 + rng() * 0.08;
      const lean = { x: (rng() - 0.5) * 0.06, z: (rng() - 0.5) * 0.06 };
      limb(b, at(0, 0, 0), at(lean.x, height, lean.z), 0.065, 0.05, bark);
      for (const side of [-1, 1])
        limb(
          b,
          at(lean.x, height * 0.8, lean.z),
          at(lean.x + side * 0.12, height + 0.2, lean.z),
          0.035,
          0.024,
          bark,
        );
      const cy = height + 0.32;
      lobes.push({ x: lean.x, y: cy, z: lean.z, rx: 0.32 + rng() * 0.04, ry: 0.28, rz: 0.3, detail: 1 });
      const count = 5 + (variant % 2);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng() * 0.5;
        const d = 0.17 + rng() * 0.06;
        const s = 0.15 + rng() * 0.07;
        lobes.push({
          x: lean.x + Math.cos(a) * d,
          y: cy + (i % 2 ? 0.1 : -0.07) + rng() * 0.05,
          z: lean.z + Math.sin(a) * d,
          rx: s,
          ry: s * 0.85,
          rz: s,
          detail: s > 0.19 ? 1 : 0,
        });
      }
      lobes.push({
        x: lean.x + 0.04,
        y: cy + 0.22,
        z: lean.z - 0.03,
        rx: 0.19,
        ry: 0.15,
        rz: 0.18,
        detail: 1,
      });
      break;
    }
    case 'spreading': {
      // Broad umbrella: a low fork into outward limbs under a flat, wide canopy with open space below.
      const height = 0.42 + rng() * 0.06;
      limb(b, at(0, 0, 0), at(0, height, 0), 0.075, 0.06, bark);
      const tips: THREE.Vector3[] = [];
      const count = variant === 2 ? 4 : 3;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng() * 0.6;
        const reach = 0.34 + rng() * 0.08;
        const tip = at(Math.cos(a) * reach, 0.84 + rng() * 0.08, Math.sin(a) * reach);
        const mid = at(Math.cos(a) * reach * 0.5, height + 0.22, Math.sin(a) * reach * 0.5);
        limb(b, at(0, height - 0.02, 0), mid, 0.05, 0.038, bark);
        limb(b, mid, tip, 0.038, 0.024, bark);
        tips.push(tip);
      }
      lobes.push({ x: 0, y: 1.0, z: 0, rx: 0.34, ry: 0.15, rz: 0.32, detail: 1 });
      for (const tip of tips)
        lobes.push({
          x: tip.x * 1.05,
          y: tip.y + 0.12,
          z: tip.z * 1.05,
          rx: 0.27 + rng() * 0.05,
          ry: 0.12 + rng() * 0.03,
          rz: 0.24 + rng() * 0.05,
          detail: 1,
        });
      for (let i = 0; i < 2; i++) {
        const a = rng() * Math.PI * 2;
        lobes.push({
          x: Math.cos(a) * 0.2,
          y: 1.1 + rng() * 0.04,
          z: Math.sin(a) * 0.2,
          rx: 0.2,
          ry: 0.11,
          rz: 0.18,
          detail: 0,
        });
      }
      break;
    }
    case 'andean': {
      // Tall and narrow: a straight pale trunk with ascending limbs and a column of uneven, rounded masses.
      bark = PALE_BARK;
      const bend = { x: (rng() - 0.5) * 0.08, z: (rng() - 0.5) * 0.08 };
      limb(b, at(0, 0, 0), at(bend.x, 0.55, bend.z), 0.06, 0.046, bark);
      limb(b, at(bend.x, 0.55, bend.z), at(0, 1.1, 0), 0.046, 0.034, bark);
      for (const [i, y] of [0.68, 0.9, 1.08].entries()) {
        const a = i * 2.3 + rng();
        limb(b, at(0, y, 0), at(Math.cos(a) * 0.17, y + 0.28, Math.sin(a) * 0.17), 0.028, 0.018, bark);
      }
      const widths = [
        [0.24, 0.28, 0.22, 0.26, 0.19, 0.13],
        [0.27, 0.23, 0.27, 0.2, 0.22, 0.12],
        [0.22, 0.27, 0.25, 0.21, 0.17, 0.14],
      ][variant] as number[];
      widths.forEach((width, k) => {
        const a = k * 2.4 + rng();
        const offset = k === widths.length - 1 ? 0.02 : 0.04 + rng() * 0.06;
        const w = width * (0.95 + rng() * 0.1);
        lobes.push({
          x: Math.cos(a) * offset,
          y: 0.92 + k * 0.19 + rng() * 0.04,
          z: Math.sin(a) * offset,
          rx: w,
          ry: w * 1.15,
          rz: w * 0.92,
          detail: w > 0.17 ? 1 : 0,
        });
      });
      break;
    }
    case 'woodland': {
      // Primary forest: a leaning, kinked trunk, a heavy crown thrown to one side and a lower counter-limb.
      const heading = variant * 2.1 + rng() * 0.6;
      const lean = 0.14 + rng() * 0.08;
      const dir = { x: Math.cos(heading), z: Math.sin(heading) };
      const perp = { x: -dir.z, z: dir.x };
      const kink = at(dir.x * lean * 0.35 + perp.x * 0.04, 0.55, dir.z * lean * 0.35 + perp.z * 0.04);
      const top = at(dir.x * lean, 1.0, dir.z * lean);
      limb(b, at(0, 0, 0), kink, 0.07, 0.052, bark);
      limb(b, kink, top, 0.052, 0.038, bark);
      const counter = at(-dir.x * 0.3, 0.96, -dir.z * 0.3);
      limb(b, kink, counter, 0.038, 0.022, bark);
      lobes.push({
        x: top.x + dir.x * 0.08,
        y: 1.18,
        z: top.z + dir.z * 0.08,
        rx: 0.34,
        ry: 0.27,
        rz: 0.3,
        detail: 1,
        tilt: 0.25,
      });
      for (let i = 0; i < 4; i++) {
        const spread = (i - 1.5) * 0.75 + (rng() - 0.5) * 0.4;
        const d = 0.22 + rng() * 0.1;
        const s = 0.16 + rng() * 0.08;
        lobes.push({
          x: top.x + (dir.x * Math.cos(spread) - dir.z * Math.sin(spread)) * d,
          y: 1.06 + rng() * 0.3,
          z: top.z + (dir.z * Math.cos(spread) + dir.x * Math.sin(spread)) * d,
          rx: s,
          ry: s * 0.85,
          rz: s * 0.9,
          detail: s > 0.19 ? 1 : 0,
          tilt: 0.3,
        });
      }
      lobes.push({
        x: counter.x,
        y: counter.y + 0.06,
        z: counter.z,
        rx: 0.19,
        ry: 0.15,
        rz: 0.17,
        detail: 1,
      });
      lobes.push({
        x: top.x + perp.x * 0.12,
        y: 1.46 + rng() * 0.06,
        z: top.z + perp.z * 0.12,
        rx: 0.16,
        ry: 0.14,
        rz: 0.15,
        detail: 0,
      });
      break;
    }
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
  crown(b, lobes, TONES[family], rng);
  return b.finish();
}

/**
 * The rare accent tree: a dark trunk forking low into a vase of bare limbs, each ending in a separate puff of
 * blossom, with a little green inside. Its gaps keep the silhouette apart from the solid broadleaf crowns.
 */
export function flowering(bloom: Bloom, variant: Variant): THREE.BufferGeometry {
  const b = new Builder(false);
  const rng = seeded('flowering', variant);
  limb(b, at(0, 0, 0), at(0, 0.48, 0), 0.065, 0.05, DARK_BARK);
  const puffs: Lobe[] = [];
  const twigs = [
    [2, 3],
    [2, 2],
    [3, 3],
  ][variant] as number[];
  twigs.forEach((count, fork) => {
    const a = fork * Math.PI + rng() * 0.5;
    const knee = at(Math.cos(a) * 0.22, 0.82 + rng() * 0.06, Math.sin(a) * 0.22);
    limb(b, at(0, 0.46, 0), knee, 0.045, 0.032, DARK_BARK);
    for (let i = 0; i < count; i++) {
      const t = a + (i - (count - 1) / 2) * 0.95 + (rng() - 0.5) * 0.2;
      const reach = 0.4 + rng() * 0.1;
      const tip = at(Math.cos(t) * reach, 1.0 + rng() * 0.18, Math.sin(t) * reach);
      limb(b, knee, tip, 0.028, 0.016, DARK_BARK);
      const s = 0.15 + rng() * 0.04;
      puffs.push({ x: tip.x, y: tip.y + 0.06, z: tip.z, rx: s, ry: s * 0.75, rz: s, detail: 1 });
    }
  });
  crown(b, puffs, BLOOM_TONES[bloom], rng);
  crown(b, [{ x: 0, y: 0.96, z: 0, rx: 0.14, ry: 0.11, rz: 0.13, detail: 0 }], TONES.rounded, rng);
  return b.finish();
}

/** A tall wax palm (Salento) or a leaning coconut palm (coast), with arched two-segment fronds. */
export function palm(variant: Variant, wax: boolean): THREE.BufferGeometry {
  const b = new Builder(false);
  const rng = random(variant * 53 + (wax ? 1 : 2));
  const height = wax ? 2.3 + rng() * 0.4 : 1.4 + rng() * 0.3;
  const lean = wax ? 0 : 0.18;
  b.bar(at(0, 0, 0), at(lean, height, 0), wax ? 0.07 : 0.08, wax ? 'stone' : 'wood', Surface.wood);
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rng() * 0.3;
    const reach = wax ? 0.42 : 0.55;
    const tone: PaletteName = i % 2 ? 'leaf' : 'leafDeep';
    const crest = at(lean + Math.cos(a) * reach * 0.5, height + 0.06, Math.sin(a) * reach * 0.5);
    const tip = at(lean + Math.cos(a) * reach, height - 0.24, Math.sin(a) * reach);
    b.bar(at(lean, height, 0), crest, 0.06, tone, Surface.foliage);
    b.bar(crest, tip, 0.05, tone, Surface.foliage);
  }
  b.blob(0.12, lean, height, 0, 'leafDeep', Surface.foliage, 0.8, 0);
  return b.finish();
}

export function shrub(variation: number): THREE.BufferGeometry {
  const b = new Builder(false);
  const rng = random(variation * 97 + 13);
  const tones: PaletteName[] = ['crownLight', 'crownMid', 'crownDeep'];
  for (let i = 0; i < 3; i++) {
    const tone = tones[Math.floor(rng() * 3)] ?? 'crownMid';
    b.blob(0.16 + rng() * 0.1, (rng() - 0.5) * 0.3, 0.1, (rng() - 0.5) * 0.3, tone, Surface.foliage, 0.75, 1);
  }
  if (variation % 4 === 1) b.blob(0.05, 0.08, 0.26, 0.05, 'coral', Surface.paint, 1, 0);
  return b.finish();
}

export function rock(variation: number): THREE.BufferGeometry {
  const b = new Builder(false);
  const rng = random(variation * 31 + 5);
  for (let i = 0; i < 2 + (variation % 2); i++)
    b.blob(
      0.08 + rng() * 0.08,
      (rng() - 0.5) * 0.25,
      0.02,
      (rng() - 0.5) * 0.25,
      'stone',
      Surface.stone,
      0.6,
      0,
    );
  return b.finish();
}

/** Two-sided triangles, so thin leaves read from any side without a double-sided material. */
function leaves(
  b: Builder,
  triangles: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, Paint][],
): void {
  for (const [a, c, d, paint] of triangles)
    for (const [p, q] of [
      [c, d],
      [d, c],
    ] as const) {
      const geometry = new THREE.BufferGeometry().setFromPoints([a, p, q]);
      geometry.computeVertexNormals();
      b.add(geometry, paint, Surface.foliage);
    }
}

/** A low fern: arched fronds radiating from the ground. */
function fern(variant: number): THREE.BufferGeometry {
  const b = new Builder(false);
  const rng = random(variant * 71 + 9);
  const count = 6 + variant;
  const parts: [THREE.Vector3, THREE.Vector3, THREE.Vector3, Paint][] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng() * 0.4;
    const length = 0.2 + rng() * 0.08;
    const dir = { x: Math.cos(a), z: Math.sin(a) };
    const side = { x: -dir.z * 0.045, z: dir.x * 0.045 };
    const mid = { x: dir.x * length * 0.5, z: dir.z * length * 0.5 };
    const left = at(mid.x + side.x, 0.11, mid.z + side.z);
    const right = at(mid.x - side.x, 0.11, mid.z - side.z);
    const paint: Paint = i % 2 ? 'leafDeep' : 'crownMid';
    parts.push([at(0, 0.01, 0), left, right, paint]);
    parts.push([left, at(dir.x * length, 0.04, dir.z * length), right, paint]);
  }
  leaves(b, parts);
  return b.finish();
}

/** A tuft of upright blades, green in the highlands or straw-colored on the dry coast. */
function grass(variant: number, dry: boolean): THREE.BufferGeometry {
  const b = new Builder(false);
  const rng = random(variant * 43 + (dry ? 29 : 7));
  const parts: [THREE.Vector3, THREE.Vector3, THREE.Vector3, Paint][] = [];
  const tones: Paint[] = dry
    ? [mix('ochre', 'grass', 0.35), mix('mustard', 'meadow', 0.5)]
    : ['meadowLow', 'leaf'];
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 0.07;
    const base = { x: Math.cos(a) * r, z: Math.sin(a) * r };
    const w = { x: -Math.sin(a) * 0.022, z: Math.cos(a) * 0.022 };
    const tip = at(base.x * 2.4, 0.16 + rng() * 0.08, base.z * 2.4);
    parts.push([
      at(base.x - w.x, 0, base.z - w.z),
      tip,
      at(base.x + w.x, 0, base.z + w.z),
      tones[i % 2] ?? 'leaf',
    ]);
  }
  leaves(b, parts);
  return b.finish();
}

/** A low green mound with a few blossoms; the regional tint chooses their color. */
function flowers(variant: number, tint: PaletteName): THREE.BufferGeometry {
  const b = new Builder(false);
  const rng = random(variant * 61 + 3);
  b.blob(0.11, 0, 0.02, 0, 'crownMid', Surface.foliage, 0.5, 0);
  for (let i = 0; i < 4 + variant; i++) {
    const a = rng() * Math.PI * 2;
    const r = 0.03 + rng() * 0.07;
    b.blob(0.034, Math.cos(a) * r, 0.07 + rng() * 0.03, Math.sin(a) * r, tint, Surface.foliage, 0.8, 0);
  }
  return b.finish();
}
