import type { Kind, Region } from '../domain';
import { center, hexAt } from './hex';
import {
  BROADLEAVES,
  type Broadleaf,
  DETAIL_VARIANTS,
  type Detail,
  type DetailKind,
  type PalmKind,
  type Plant,
  SHRUB_VARIANTS,
  type Variant,
} from './models';
import type { PaletteName } from './palette';

/**
 * Where plants grow, decided in world space so neighboring tiles share one forest. Candidates sit on a
 * jittered world lattice; each belongs to the tile whose hex contains it, and its identity comes from its
 * lattice cell and the world seed, never from tile iteration order. Low-frequency fields shape dense cores,
 * clearings, family groves and flowering patches. The tile then rejects what its paths, homes and water
 * cannot hold.
 */

/** A proposal in tile-local coordinates; `priority` orders placement so caps keep the same trees. */
export interface Candidate<T> {
  id: number;
  x: number;
  z: number;
  turn: number;
  scale: number;
  priority: number;
  item: T;
}
export interface Ground {
  q: number;
  r: number;
  kind: Kind;
  region: Region;
  seed: number;
}

const TREE_SPACING = 0.6;
const DETAIL_SPACING = 0.55;
const JITTER = 0.36;

function mix32(h: number, v: number): number {
  let x = Math.imul(h ^ v, 0x9e3779b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}
const SALT = {
  cell: 1,
  jitterX: 2,
  jitterZ: 3,
  present: 4,
  priority: 5,
  size: 6,
  kind: 7,
  yaw: 8,
  plant: 9,
  palm: 10,
  accent: 11,
  shrub: 12,
  variant: 13,
  detail: 14,
  forest: 101,
  forestFine: 102,
  family: 110,
  palmField: 120,
  accentField: 121,
  bloomField: 122,
  variantField: 123,
  detailField: 124,
} as const;
const unit = (h: number) => h / 4294967296;
const hashed = (id: number, salt: number) => unit(mix32(id, salt));

/** Smooth value noise in [0, 1] on a unit lattice. */
function noise(x: number, z: number, seed: number, salt: number): number {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const fx = x - ix,
    fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx),
    sz = fz * fz * (3 - 2 * fz);
  const corner = (dx: number, dz: number) => unit(mix32(mix32(mix32(seed, salt), ix + dx), iz + dz));
  const a = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * sx;
  const b = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * sx;
  return a + (b - a) * sz;
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Forest density at a world point: broad cores and clearings with a finer irregular edge. */
export function forestField(x: number, z: number, seed: number): number {
  return (
    noise(x / 4.2, z / 4.2, seed, SALT.forest) * 0.72 + noise(x / 1.6, z / 1.6, seed, SALT.forestFine) * 0.28
  );
}

interface Profile {
  /** Relative frequency of each broadleaf family; zero removes it from the region. */
  broadleaf: Record<Broadleaf, number>;
  palm: { kind: PalmKind; share: number } | null;
  /** Flowering trees only grow where the accent field passes `threshold`, at `chance` per candidate there. */
  accent: { threshold: number; chance: number; gold: number } | null;
  /** Share of forest-edge candidates that become shrubs. */
  shrub: number;
  humid: boolean;
  blossoms: readonly [PaletteName, PaletteName];
}
const PROFILES: Record<Region, Profile> = {
  medellin: {
    broadleaf: { rounded: 3, spreading: 3, woodland: 2.5, andean: 1 },
    palm: null,
    accent: { threshold: 0.58, chance: 0.3, gold: 0.5 },
    shrub: 0.15,
    humid: true,
    blossoms: ['coral', 'mustard'],
  },
  salento: {
    broadleaf: { rounded: 2, spreading: 1.5, woodland: 3.5, andean: 2 },
    palm: { kind: 'wax', share: 0.12 },
    accent: { threshold: 0.7, chance: 0.22, gold: 0.35 },
    shrub: 0.15,
    humid: true,
    blossoms: ['offWhite', 'bloom'],
  },
  bogota: {
    broadleaf: { rounded: 1.5, spreading: 0.5, woodland: 2.5, andean: 4.5 },
    palm: null,
    accent: null,
    shrub: 0.32,
    humid: true,
    blossoms: ['dustyBlue', 'cream'],
  },
  cartagena: {
    broadleaf: { rounded: 2.5, spreading: 4.5, woodland: 1, andean: 0 },
    palm: { kind: 'coconut', share: 0.22 },
    accent: { threshold: 0.66, chance: 0.3, gold: 0.75 },
    shrub: 0.2,
    humid: false,
    blossoms: ['bloom', 'mustard'],
  },
};

/** How much of the lattice each kind of tile grows, and the most trees and ground details it keeps. */
interface Density {
  trees: number;
  cap: number;
  details: number;
  detailCap: number;
}
export const DENSITY: Record<Kind, Density> = {
  monte: { trees: 1, cap: 15, details: 0.3, detailCap: 6 },
  quebrada: { trees: 0.6, cap: 7, details: 0.3, detailCap: 5 },
  sendero: { trees: 0.5, cap: 6, details: 0.22, detailCap: 4 },
  parque: { trees: 0.5, cap: 6, details: 0.25, detailCap: 4 },
  casas: { trees: 0.3, cap: 3, details: 0.12, detailCap: 2 },
  tienda: { trees: 0.3, cap: 3, details: 0.12, detailCap: 2 },
  capilla: { trees: 0.3, cap: 3, details: 0.12, detailCap: 2 },
  inicio: { trees: 0.3, cap: 3, details: 0.12, detailCap: 2 },
  plaza: { trees: 0, cap: 0, details: 0, detailCap: 0 },
};

interface Cell {
  i: number;
  j: number;
  id: number;
  x: number;
  z: number;
}
function cell(i: number, j: number, seed: number, spacing: number, salt: number): Cell {
  const id = mix32(mix32(mix32(seed, salt), i), j);
  return {
    i,
    j,
    id,
    x: (i + 0.5 + (hashed(id, SALT.jitterX) - 0.5) * 2 * JITTER) * spacing,
    z: (j + 0.5 + (hashed(id, SALT.jitterZ) - 0.5) * 2 * JITTER) * spacing,
  };
}
/** Lattice cells whose jittered point falls in hex (q, r), so every candidate has exactly one owner. */
function owned(ground: Ground, spacing: number, salt: number): Cell[] {
  const c = center(ground.q, ground.r);
  const out: Cell[] = [];
  for (let i = Math.floor((c.x - 2.2) / spacing); i <= Math.ceil((c.x + 2.2) / spacing); i++)
    for (let j = Math.floor((c.z - 2.2) / spacing); j <= Math.ceil((c.z + 2.2) / spacing); j++) {
      const p = cell(i, j, ground.seed, spacing, salt);
      const hex = hexAt(p.x, p.z);
      if (hex.q === ground.q && hex.r === ground.r) out.push(p);
    }
  return out;
}

/** Whether a tree could stand at this lattice cell, from world fields alone; drives seam-safe thinning. */
function present(p: Cell, seed: number): boolean {
  return hashed(p.id, SALT.present) < 0.42 + 0.58 * smoothstep(0.25, 0.6, forestField(p.x, p.z, seed));
}
const size = (p: Cell) => hashed(p.id, SALT.size);
/** A standing cell yields to a stronger neighbor too close for both crowns; neighbors in other tiles count. */
function thinned(p: Cell, seed: number): boolean {
  const mine = hashed(p.id, SALT.priority);
  for (let di = -1; di <= 1; di++)
    for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const n = cell(p.i + di, p.j + dj, seed, TREE_SPACING, SALT.cell);
      if (!present(n, seed) || hashed(n.id, SALT.priority) <= mine) continue;
      const core = smoothstep(0.4, 0.7, forestField((p.x + n.x) * 0.5, (p.z + n.z) * 0.5, seed));
      const separation = (0.36 + 0.18 * (size(p) + size(n))) * (1 - core * 0.25);
      if (Math.hypot(n.x - p.x, n.z - p.z) < separation) return true;
    }
  return false;
}

function pickVariant(x: number, z: number, id: number, seed: number): Variant {
  const u = noise(x / 3, z / 3, seed, SALT.variantField) * 0.6 + hashed(id, SALT.variant) * 0.4;
  return Math.min(2, Math.floor(u * 3)) as Variant;
}

/** Chooses what grows at a world point: palms and blossoms in their patches, else a broadleaf family grove. */
export function plantAt(x: number, z: number, id: number, region: Region, seed: number): Plant {
  const profile = PROFILES[region];
  const variant = pickVariant(x, z, id, seed);
  if (profile.palm) {
    const field = noise(x / 5.5, z / 5.5, seed, SALT.palmField);
    if (hashed(id, SALT.palm) < profile.palm.share * (0.3 + 1.4 * field))
      return { kind: 'palm', palm: profile.palm.kind, variant };
  }
  if (profile.accent) {
    const field = noise(x / 6.5, z / 6.5, seed, SALT.accentField);
    if (field > profile.accent.threshold && hashed(id, SALT.accent) < profile.accent.chance) {
      const bloom = noise(x / 11, z / 11, seed, SALT.bloomField) < profile.accent.gold ? 'gold' : 'pink';
      return { kind: 'flowering', bloom, variant };
    }
  }
  const weights = BROADLEAVES.map(
    (family, index) =>
      profile.broadleaf[family] * (0.3 + 1.4 * noise(x / 5, z / 5, seed, SALT.family + index)),
  );
  let roll = hashed(id, SALT.plant) * weights.reduce((sum, w) => sum + w, 0);
  for (const [index, family] of BROADLEAVES.entries()) {
    roll -= weights[index] ?? 0;
    if (roll < 0) return { kind: 'tree', family, variant };
  }
  return { kind: 'tree', family: 'rounded', variant };
}

/** Plant candidates owned by a tile, strongest first. Bigger trees grow in the cores, shrubs at the edges. */
export function plants(ground: Ground): Candidate<Plant>[] {
  const density = DENSITY[ground.kind];
  if (!density.trees) return [];
  const c = center(ground.q, ground.r);
  const profile = PROFILES[ground.region];
  const out: Candidate<Plant>[] = [];
  for (const p of owned(ground, TREE_SPACING, SALT.cell)) {
    if (!present(p, ground.seed)) continue;
    if (thinned(p, ground.seed)) continue;
    if (hashed(p.id, SALT.kind) >= density.trees) continue;
    const forest = forestField(p.x, p.z, ground.seed);
    const core = smoothstep(0.4, 0.75, forest);
    const edge = ground.kind !== 'monte' || forest < 0.45;
    const item: Plant =
      edge && hashed(p.id, SALT.shrub) < profile.shrub * (ground.kind === 'monte' ? 1.6 : 1)
        ? { kind: 'shrub', variant: Math.floor(hashed(p.id, SALT.variant) * SHRUB_VARIANTS) }
        : plantAt(p.x, p.z, p.id, ground.region, ground.seed);
    out.push({
      id: p.id,
      x: p.x - c.x,
      z: p.z - c.z,
      turn: hashed(p.id, SALT.yaw) * Math.PI * 2,
      scale: 0.9 + 0.24 * size(p) + 0.14 * core,
      priority: hashed(p.id, SALT.priority) + core,
      item,
    });
  }
  return out.sort((a, b) => b.priority - a.priority || a.id - b.id);
}

function detailFor(kind: Kind, profile: Profile, u: number, tint: number): Omit<Detail, 'variant'> {
  const blossom = profile.blossoms[tint < 0.5 ? 0 : 1] ?? 'coral';
  const pick = (table: readonly [DetailKind, number][]): DetailKind => {
    let roll = u;
    for (const [detail, share] of table) {
      roll -= share;
      if (roll < 0) return detail;
    }
    return table[table.length - 1]?.[0] ?? 'grass';
  };
  const blade: DetailKind = profile.humid ? 'grass' : 'dryGrass';
  const shade: DetailKind = profile.humid ? 'fern' : 'dryGrass';
  const detail =
    kind === 'monte'
      ? pick([
          [shade, 0.7],
          ['rock', 0.3],
        ])
      : kind === 'quebrada'
        ? pick([
            [shade, 0.5],
            ['rock', 0.5],
          ])
        : kind === 'sendero'
          ? pick([
              [blade, 0.6],
              ['rock', 0.2],
              ['flowers', 0.2],
            ])
          : pick([
              [blade, 0.55],
              ['flowers', 0.45],
            ]);
  return { kind: detail, tint: blossom };
}

/** Low ground cover owned by a tile: ferns in shade, grass and flowers in the open, stones by streams. */
export function details(ground: Ground): Candidate<Detail>[] {
  const density = DENSITY[ground.kind];
  if (!density.details) return [];
  const c = center(ground.q, ground.r);
  const profile = PROFILES[ground.region];
  const out: Candidate<Detail>[] = [];
  for (const p of owned(ground, DETAIL_SPACING, SALT.detail)) {
    const field = noise(p.x / 2.5, p.z / 2.5, ground.seed, SALT.detailField);
    if (hashed(p.id, SALT.present) >= density.details * (0.4 + 1.2 * field)) continue;
    const kind = detailFor(
      ground.kind,
      profile,
      hashed(p.id, SALT.plant),
      noise(p.x / 6, p.z / 6, ground.seed, SALT.bloomField),
    );
    out.push({
      id: p.id,
      x: p.x - c.x,
      z: p.z - c.z,
      turn: hashed(p.id, SALT.yaw) * Math.PI * 2,
      scale: 0.85 + 0.3 * hashed(p.id, SALT.size),
      priority: hashed(p.id, SALT.priority),
      item: { ...kind, variant: Math.floor(hashed(p.id, SALT.variant) * DETAIL_VARIANTS) },
    });
  }
  return out.sort((a, b) => b.priority - a.priority || a.id - b.id);
}

/** A stable single choice for a fixed spot (a plaza corner): the plant that would grow at that world point. */
export function plantFor(ground: Ground, x: number, z: number, salt: number): Plant {
  const c = center(ground.q, ground.r);
  const id = mix32(mix32(mix32(mix32(ground.seed, ground.q), ground.r), salt), SALT.plant);
  return plantAt(c.x + x, c.z + z, id, ground.region, ground.seed);
}
