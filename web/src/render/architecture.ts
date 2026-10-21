import * as THREE from 'three';
import { Builder, facePoint, type Paint, random, type Side } from './builder';
import { PALETTE, type PaletteName, PLASTER, Surface, TRIM } from './palette';

/**
 * Shape grammar for Medellín self-built houses, after Müller et al. 2006 (CGA): a lot becomes a mass of
 * stacked storeys, each storey face is split into bays, and each bay becomes a terminal (window, door,
 * shutter, blank wall). Roofs collect additions in free slots so details never intersect.
 */
export const STOREY = 0.68;
const SLAB = 0.07;
const GAP = 0.03;

type Finish = 'painted' | 'brickUpper' | 'frame' | 'brick';
type Bay = 'window' | 'door' | 'shutter' | 'shop' | 'blank' | 'balcony';
interface Mass {
  w: number;
  d: number;
  x: number;
  z: number;
  floors: number;
  y0: number;
  /** Sides that receive openings; party walls and backs stay mostly blank. */
  open: readonly Side[];
  /** Storey index of the first floor, so upper volumes keep the finish rules of their real level. */
  level?: number;
}
interface Style {
  rng: () => number;
  plaster: PaletteName;
  accent: PaletteName;
  trim: PaletteName;
  finish: Finish;
  grilles: boolean;
  mural: boolean;
  /** Most houses paint only the street facade; side and back walls stay exposed brick. */
  paintedSides: boolean;
  /** Flat roof finish: bare slab, red ceramic terrace tile, or red-oxide waterproofing. */
  deck: { color: Paint; surface: (typeof Surface)[keyof typeof Surface] };
}

function style(kind: string, variation: number): Style {
  const kindSeed = [...kind].reduce((hash, char) => Math.imul(hash, 31) + char.charCodeAt(0), 7) >>> 0;
  const rng = random(kindSeed ^ Math.imul(variation + 1, 0x9e3779b9));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
  const finishes: Record<string, readonly Finish[]> = {
    casa: ['painted', 'painted', 'brickUpper', 'painted', 'frame'],
    tienda: ['painted', 'brickUpper', 'painted', 'painted'],
    torre: ['frame', 'brick', 'brickUpper', 'painted'],
    terraza: ['painted', 'painted', 'brickUpper'],
    taller: ['brick', 'frame', 'brickUpper', 'painted'],
    esquina: ['painted', 'brickUpper', 'painted'],
  };
  const plaster = PLASTER[(variation * 7 + kindSeed) % PLASTER.length] as PaletteName;
  let trim = pick(TRIM);
  if (trim === plaster) trim = 'offWhite';
  return {
    rng,
    plaster,
    accent: PLASTER[(variation * 5 + 3) % PLASTER.length] as PaletteName,
    trim,
    finish: pick(finishes[kind] ?? ['painted']),
    grilles: rng() < 0.6,
    mural: kind === 'esquina' ? variation % 3 !== 2 : variation % 7 === 3,
    paintedSides: rng() < 0.6,
    deck: (
      [
        { color: 'concrete', surface: Surface.concrete },
        { color: 'stone', surface: Surface.concrete },
        { color: 'terracotta', surface: Surface.tile },
        { color: 'concrete', surface: Surface.concrete },
        { color: 'brickRed', surface: Surface.paint },
        { color: 'stone', surface: Surface.concrete },
        { color: 'concrete', surface: Surface.concrete },
        { color: 'terracotta', surface: Surface.tile },
      ] as const
    )[variation % 8] ?? { color: 'concrete', surface: Surface.concrete },
  };
}

function wallFor(
  s: Style,
  floor: number,
  side: Side,
): { color: Paint; surface: (typeof Surface)[keyof typeof Surface] } {
  const painted = { color: s.plaster, surface: Surface.plaster } as const;
  const brick = { color: 'brick', surface: Surface.brick } as const;
  if (side !== 0 && (side === 2 || !s.paintedSides) && s.finish !== 'painted') return brick;
  if (side === 2 && !s.paintedSides) return brick;
  if (s.finish === 'painted') return painted;
  if (s.finish === 'brick') return floor === 0 && side === 0 ? painted : brick;
  if (s.finish === 'brickUpper') return floor === 0 ? painted : brick;
  return brick;
}

function window(
  b: Builder,
  s: Style,
  side: Side,
  m: Mass,
  u: number,
  v: number,
  w = 0.24,
  h = 0.3,
  grille = false,
): void {
  const r = facePoint(side, m.w / 2, m.d / 2, u, 0)[2];
  const at = (out: number, along = 0): [number, number] => {
    const [px, pz] = facePoint(side, m.w / 2, m.d / 2, u + along, out);
    return [m.x + px, m.z + pz];
  };
  const [fx, fz] = at(0.012);
  b.box(w + 0.06, h + 0.06, 0.03, fx, v, fz, s.finish === 'painted' ? 'offWhite' : s.trim, Surface.paint, r);
  const [gx, gz] = at(0.022);
  b.box(w, h, 0.02, gx, v, gz, 'windowDark', Surface.glass, r);
  const [sx, sz] = at(0.04);
  b.box(w + 0.1, 0.035, 0.07, sx, v - h / 2 - 0.035, sz, 'concrete', Surface.concrete, r);
  const [lx, lz] = at(0.035);
  b.box(w + 0.1, 0.035, 0.06, lx, v + h / 2 + 0.05, lz, 'concrete', Surface.concrete, r);
  const [mx, mz] = at(0.035);
  b.box(0.018, h, 0.02, mx, v, mz, s.finish === 'painted' ? 'offWhite' : s.trim, Surface.paint, r);
  if (grille) {
    for (let i = 1; i < 4; i++) {
      const [qx, qz] = at(0.05, -w / 2 + (i * w) / 4);
      b.box(0.012, h + 0.02, 0.012, qx, v, qz, 'metal', Surface.metal, r);
    }
    const [tx, tz] = at(0.05);
    b.box(w + 0.02, 0.012, 0.012, tx, v + h * 0.2, tz, 'metal', Surface.metal, r);
  }
}

function door(b: Builder, s: Style, side: Side, m: Mass, u: number, y0: number): void {
  const [x, z, r] = facePoint(side, m.w / 2, m.d / 2, u, 0.012);
  b.box(0.27, 0.5, 0.03, m.x + x, y0 + 0.25, m.z + z, 'offWhite', Surface.paint, r);
  const [dx, dz] = facePoint(side, m.w / 2, m.d / 2, u, 0.024);
  b.box(0.21, 0.46, 0.02, m.x + dx, y0 + 0.23, m.z + dz, s.trim, Surface.metal, r);
  const [kx, kz] = facePoint(side, m.w / 2, m.d / 2, u, 0.07);
  b.box(0.32, 0.04, 0.12, m.x + kx, y0 + 0.02, m.z + kz, 'concrete', Surface.concrete, r);
}

function shutter(b: Builder, side: Side, m: Mass, u: number, y0: number, w: number, h: number): void {
  const [x, z, r] = facePoint(side, m.w / 2, m.d / 2, u, 0.015);
  b.box(w + 0.05, h + 0.04, 0.03, m.x + x, y0 + h / 2 + 0.02, m.z + z, 'concrete', Surface.concrete, r);
  const [sx, sz] = facePoint(side, m.w / 2, m.d / 2, u, 0.03);
  b.box(w, h, 0.02, m.x + sx, y0 + h / 2, m.z + sz, 'shutter', Surface.corrugated, r);
}

function shop(b: Builder, s: Style, side: Side, m: Mass, u: number, y0: number, w: number): void {
  const [x, z, r] = facePoint(side, m.w / 2, m.d / 2, u, 0.012);
  b.box(w, 0.44, 0.02, m.x + x, y0 + 0.24, m.z + z, 'windowDark', Surface.glass, r);
  const [px, pz] = facePoint(side, m.w / 2, m.d / 2, u, 0.03);
  b.box(
    w + 0.06,
    0.12,
    0.04,
    m.x + px,
    y0 + 0.52,
    m.z + pz,
    s.accent === s.plaster ? 'offWhite' : s.accent,
    Surface.paint,
    r,
  );
  for (let i = 0; i < 3; i++) {
    const [cx, cz] = facePoint(side, m.w / 2, m.d / 2, u - w * 0.3 + i * w * 0.3, 0.09);
    const goods: PaletteName[] = ['mustard', 'coral', 'mutedGreen'];
    b.box(w * 0.22, 0.12, 0.1, m.x + cx, y0 + 0.08, m.z + cz, goods[i] ?? 'ochre', Surface.paint, r);
  }
  const awningColor: Paint = s.trim === 'mustard' ? 'teal' : s.trim;
  for (let i = 0; i < 6; i++) {
    const g = new THREE.BoxGeometry(w / 6, 0.025, 0.26);
    g.rotateX(0.38);
    const along = u - w / 2 + (i + 0.5) * (w / 6);
    const [ax, az, ar] = facePoint(side, m.w / 2, m.d / 2, along, 0.12);
    g.rotateY(ar);
    g.translate(m.x + ax, y0 + 0.62, m.z + az);
    b.add(g, i % 2 ? 'offWhite' : awningColor, Surface.fabric);
  }
}

function balcony(b: Builder, s: Style, side: Side, m: Mass, u: number, y: number, w: number): void {
  const [x, z, r] = facePoint(side, m.w / 2, m.d / 2, u, 0.12);
  b.box(w, 0.045, 0.24, m.x + x, y, m.z + z, 'concrete', Surface.concrete, r);
  // A low solid parapet with a light rail above: how most barrio balconies are built, and far fewer parts than bars.
  const [px, pz] = facePoint(side, m.w / 2, m.d / 2, u, 0.225);
  b.box(
    w,
    0.1,
    0.03,
    m.x + px,
    y + 0.07,
    m.z + pz,
    s.finish === 'painted' ? s.plaster : 'brick',
    s.finish === 'painted' ? Surface.plaster : Surface.brick,
    r,
  );
  const [rx, rz] = facePoint(side, m.w / 2, m.d / 2, u, 0.23);
  b.box(w, 0.02, 0.02, m.x + rx, y + 0.24, m.z + rz, s.trim, Surface.metal, r);
  for (const t of [-0.5, -1 / 6, 1 / 6, 0.5]) {
    const [qx, qz] = facePoint(side, m.w / 2, m.d / 2, u + t * w, 0.23);
    b.box(0.014, 0.12, 0.014, m.x + qx, y + 0.18, m.z + qz, s.trim, Surface.metal, r);
  }
  for (const edge of [-1, 1]) {
    const [ex, ez] = facePoint(side, m.w / 2, m.d / 2, u + (edge * w) / 2, 0.12);
    b.box(0.02, 0.02, 0.22, m.x + ex, y + 0.24, m.z + ez, s.trim, Surface.metal, r);
  }
}

type BayRule = (floor: number, index: number, count: number, side: Side) => Bay;

/** Builds one storey-stacked volume: walls, slab bands, frame columns, then splits each open face into bays. */
function mass(b: Builder, s: Style, m: Mass, rule: BayRule): void {
  const level = m.level ?? 0;
  for (let storey = 0; storey < m.floors; storey++) {
    const y = m.y0 + storey * STOREY;
    const floor = storey + level;
    for (const side of [0, 1, 2, 3] as const) {
      const wall =
        side === 3 && s.mural && floor < 2
          ? { color: s.plaster as Paint, surface: Surface.mural }
          : wallFor(s, floor, side);
      const along = side % 2 ? m.d - 0.24 : m.w;
      const [x, z, r] = facePoint(side, m.w / 2, m.d / 2, 0, -0.06);
      b.box(along, STOREY, 0.12, m.x + x, y + STOREY / 2, m.z + z, wall.color, wall.surface, r);
    }
    if (storey > 0 || m.y0 > 0)
      b.box(m.w + 0.03, SLAB, m.d + 0.03, m.x, y + SLAB / 2 - 0.01, m.z, 'concrete', Surface.concrete);
  }
  b.box(m.w - 0.2, 0.05, m.d - 0.2, m.x, m.y0 + 0.02, m.z, 'concrete', Surface.concrete);
  if (level === 0 && m.y0 === 0)
    for (const side of [0, 1, 2, 3] as const) {
      const wall = wallFor(s, 0, side);
      if (wall.surface !== Surface.plaster) continue;
      const along = side % 2 ? m.d : m.w + 0.02;
      const [x, z, r] = facePoint(side, m.w / 2, m.d / 2, 0, 0.006);
      const tone = new THREE.Color(PALETTE[s.plaster]).multiplyScalar(0.72);
      b.box(along, 0.17, 0.012, m.x + x, 0.085, m.z + z, tone, Surface.plaster, r);
    }
  if (level === 0 && m.y0 === 0 && s.rng() < 0.6) {
    const [x, z] = facePoint(0, m.w / 2, m.d / 2, m.w / 2 - 0.03, 0.02);
    b.block(0.025, m.floors * STOREY + 0.1, 0.025, m.x + x, 0, m.z + z, 'shutter', Surface.metal);
  }
  if (s.finish === 'frame' || s.finish === 'brick')
    for (const cx of [-1, 1])
      for (const cz of [-1, 1])
        b.block(
          0.09,
          m.floors * STOREY,
          0.09,
          m.x + (cx * (m.w - 0.07)) / 2,
          m.y0,
          m.z + (cz * (m.d - 0.07)) / 2,
          'concrete',
          Surface.concrete,
        );
  for (const side of m.open) {
    const along = side % 2 ? m.d : m.w;
    const count = Math.max(1, Math.round(along / 0.46));
    const bay = along / count;
    for (let storey = 0; storey < m.floors; storey++) {
      const y0 = m.y0 + storey * STOREY;
      for (let i = 0; i < count; i++) {
        const u = -along / 2 + (i + 0.5) * bay;
        const kind = rule(storey + level, i, count, side);
        if (kind === 'window')
          window(b, s, side, m, u, y0 + STOREY * 0.55, 0.24, 0.3, s.grilles && storey + level === 0);
        else if (kind === 'balcony') {
          window(b, s, side, m, u, y0 + STOREY * 0.5, 0.2, 0.4);
          balcony(b, s, side, m, u, y0 + 0.05, Math.min(bay * 0.95, 0.5));
        } else if (kind === 'door') door(b, s, side, m, u, y0);
        else if (kind === 'shutter') shutter(b, side, m, u, y0, bay * 0.86, 0.48);
        else if (kind === 'shop') shop(b, s, side, m, u, y0, bay * 0.86);
      }
    }
  }
}

interface Roof {
  w: number;
  d: number;
  x: number;
  z: number;
  y: number;
}

/** Parapet traced from the roof boundary, then additions placed into a slot grid so they never overlap. */
function roof(
  b: Builder,
  s: Style,
  r: Roof,
  options: { parapet?: 'wall' | 'rail' | 'none'; slots?: number; features?: readonly string[] },
): void {
  b.box(r.w + 0.04, 0.05, r.d + 0.04, r.x, r.y + 0.025, r.z, 'concrete', Surface.concrete);
  b.block(r.w - 0.09, 0.012, r.d - 0.09, r.x, r.y + 0.05, r.z, s.deck.color, s.deck.surface);
  const parapet = options.parapet ?? 'wall';
  if (parapet === 'wall') {
    const color: Paint = s.finish === 'painted' ? s.plaster : 'brick';
    const surface = s.finish === 'painted' ? Surface.plaster : Surface.brick;
    b.block(r.w + 0.04, 0.14, 0.05, r.x, r.y, r.z + r.d / 2 - 0.005, color, surface);
    b.block(r.w + 0.04, 0.14, 0.05, r.x, r.y, r.z - r.d / 2 + 0.005, color, surface);
    b.block(0.05, 0.14, r.d - 0.04, r.x + r.w / 2 - 0.005, r.y, r.z, color, surface);
    b.block(0.05, 0.14, r.d - 0.04, r.x - r.w / 2 + 0.005, r.y, r.z, color, surface);
    for (const [w, d, x, z] of [
      [r.w + 0.08, 0.08, r.x, r.z + r.d / 2 - 0.005],
      [r.w + 0.08, 0.08, r.x, r.z - r.d / 2 + 0.005],
      [0.08, r.d, r.x + r.w / 2 - 0.005, r.z],
      [0.08, r.d, r.x - r.w / 2 + 0.005, r.z],
    ] as const)
      b.block(w, 0.025, d, x, r.y + 0.14, z, 'concrete', Surface.concrete);
  } else if (parapet === 'rail') {
    for (const [w, d, x, z] of [
      [r.w, 0.018, r.x, r.z + r.d / 2 - 0.02],
      [r.w, 0.018, r.x, r.z - r.d / 2 + 0.02],
      [0.018, r.d, r.x + r.w / 2 - 0.02, r.z],
      [0.018, r.d, r.x - r.w / 2 + 0.02, r.z],
    ] as const) {
      b.block(w, 0.02, d, x, r.y + 0.26, z, s.trim, Surface.metal);
      const posts = Math.max(2, Math.round(Math.max(w, d) / 0.3));
      for (let i = 0; i <= posts; i++) {
        const t = -0.5 + i / posts;
        b.block(
          0.011,
          0.26,
          0.011,
          x + (w > d ? t * w : 0),
          r.y + 0.05,
          z + (d > w ? t * d : 0),
          'metal',
          Surface.metal,
        );
      }
    }
  }
  const features = options.features ?? [];
  const columns = Math.max(1, Math.round(r.w / 0.45));
  const rows = Math.max(1, Math.round(r.d / 0.45));
  const slots: [number, number][] = [];
  for (let i = 0; i < columns; i++)
    for (let j = 0; j < rows; j++)
      slots.push([r.x - r.w / 2 + (i + 0.5) * (r.w / columns), r.z - r.d / 2 + (j + 0.5) * (r.d / rows)]);
  slots.sort(() => s.rng() - 0.5);
  const top = r.y + 0.05;
  for (const feature of features) {
    const slot = slots.pop();
    if (!slot) break;
    const [x, z] = slot;
    if (feature === 'tank') {
      b.block(0.26, 0.06, 0.26, x, top, z, 'concrete', Surface.concrete);
      b.cylinder(0.12, 0.24, x, top + 0.06, z, 'tankBlack', Surface.paint, 0.1, 12);
      b.cylinder(0.07, 0.04, x, top + 0.3, z, 'tankBlack', Surface.paint, 0.07, 10);
    } else if (feature === 'plants') {
      for (const [dx, dz, c] of [
        [-0.08, 0, 'terracotta'],
        [0.09, 0.06, 'brickRed'],
      ] as const) {
        b.cylinder(0.05, 0.08, x + dx, top, z + dz, c, Surface.paint, 0.065, 8);
        b.blob(0.08, x + dx, top + 0.14, z + dz, dz ? 'leaf' : 'leafDeep', Surface.foliage, 0.9, 0);
      }
    } else if (feature === 'line') {
      for (const dx of [-0.17, 0.17]) b.block(0.015, 0.3, 0.015, x + dx, top, z, 'metal', Surface.metal);
      b.block(0.34, 0.008, 0.008, x, top + 0.29, z, 'metal', Surface.metal);
      const clothes: PaletteName[] = ['offWhite', 'turquoise', 'coral', 'mustard'];
      for (let i = 0; i < 4; i++)
        b.block(
          0.06,
          0.1,
          0.006,
          x - 0.12 + i * 0.08,
          top + 0.18,
          z,
          clothes[(i + Math.floor(s.rng() * 4)) % 4] ?? 'offWhite',
          Surface.fabric,
        );
    } else if (feature === 'dish') {
      b.block(0.02, 0.12, 0.02, x, top, z, 'metal', Surface.metal);
      const dish = new THREE.CylinderGeometry(0.08, 0.03, 0.03, 12);
      dish.rotateX(1.1);
      dish.translate(x, top + 0.14, z + 0.02);
      b.add(dish, 'offWhite', Surface.paint);
    } else if (feature === 'rebar') {
      for (const cx of [-1, 1])
        for (const cz of [-1, 1]) {
          const px = r.x + (cx * (r.w - 0.1)) / 2,
            pz = r.z + (cz * (r.d - 0.1)) / 2;
          b.block(0.08, 0.06, 0.08, px, top - 0.01, pz, 'concrete', Surface.concrete);
          for (const o of [-0.02, 0.02])
            b.block(0.008, 0.2, 0.008, px + o, top + 0.04, pz + o, 'brickDark', Surface.metal);
        }
    } else if (feature === 'shed') {
      b.block(0.36, 0.3, 0.32, x, top, z, 'brick', Surface.brick);
      const sheet = new THREE.BoxGeometry(0.44, 0.02, 0.42);
      sheet.rotateX(0.18);
      sheet.translate(x, top + 0.33, z);
      b.add(sheet, 'zinc', Surface.corrugated);
      b.block(0.12, 0.2, 0.01, x, top, z + 0.165, 'teal', Surface.metal);
    }
  }
}

/** Builds a building in local space: footprint centered on the origin, front facade facing +Z. */
export function building(
  kind: string,
  width: number,
  depth: number,
  variation: number,
): THREE.BufferGeometry {
  const s = style(kind, variation);
  const b = new Builder();
  const W = width - GAP,
    D = depth - GAP;
  const base = { w: W, d: D, x: 0, z: 0, y0: 0 };
  const residential: BayRule = (floor, i, count, side) => {
    if (side !== 0) return s.rng() < 0.55 ? 'window' : 'blank';
    if (floor === 0) return i === variation % count ? 'door' : 'window';
    return s.rng() < 0.35 ? 'balcony' : 'window';
  };
  const roofFeatures = (): string[] => {
    const all = ['tank', 'plants', 'line', 'dish', 'shed', 'plants'];
    const chosen = ['tank'];
    for (const f of all.slice(1)) if (s.rng() < 0.42) chosen.push(f);
    if (s.rng() < 0.45) chosen.unshift('rebar');
    return chosen;
  };
  // Volado: upper storeys cantilever over the street, a signature of self-built Medellín houses.
  const volado = (floors: number, open: readonly Side[], rule: BayRule) => {
    mass(b, s, { ...base, floors: 1, open }, rule);
    const upper = { ...base, d: D + 0.1, z: 0.05, y0: STOREY, floors: floors - 1, open, level: 1 };
    mass(b, s, upper, rule);
    b.block(W - 0.04, 0.05, 0.1, 0, STOREY - 0.04, D / 2 + 0.05, 'concrete', Surface.concrete);
    return upper;
  };
  const cantilever = variation % 3 !== 1;
  if (kind === 'casa') {
    const floors = 2;
    if (cantilever) volado(floors, [0, 1, 3], residential);
    else mass(b, s, { ...base, floors, open: [0, 1, 3] }, residential);
    const area = cantilever ? { w: W, d: D + 0.1, x: 0, z: 0.05 } : { w: W, d: D, x: 0, z: 0 };
    const top = floors * STOREY;
    if (variation % 3 === 0) {
      const room = {
        w: W * 0.55,
        d: D * 0.55,
        x: -W * 0.2,
        z: -D * 0.2,
        y0: top,
        floors: 1,
        open: [0] as Side[],
      };
      roof(b, s, { ...area, y: top }, { parapet: 'rail', features: [] });
      mass(b, { ...s, finish: 'brick' }, room, () => 'window');
      roof(
        b,
        s,
        { w: room.w, d: room.d, x: room.x, z: room.z, y: top + STOREY },
        { parapet: 'none', features: ['tank'] },
      );
      roof(
        b,
        s,
        { w: W * 0.4, d: D * 0.35, x: W * 0.28, z: D * 0.3, y: top },
        { parapet: 'none', features: ['plants'] },
      );
    } else roof(b, s, { ...area, y: top }, { features: roofFeatures().slice(0, 3) });
  } else if (kind === 'tienda') {
    const rule: BayRule = (floor, i, count, side) => {
      if (side !== 0) return floor > 0 && s.rng() < 0.5 ? 'window' : 'blank';
      if (floor === 0) return i === count - 1 ? 'door' : 'shop';
      return i % 2 ? 'balcony' : 'window';
    };
    const top = cantilever ? volado(2, [0, 1, 3], rule) : base;
    if (!cantilever) mass(b, s, { ...base, floors: 2, open: [0, 1, 3] }, rule);
    roof(b, s, { w: top.w, d: top.d, x: top.x, z: top.z, y: 2 * STOREY }, { features: roofFeatures() });
  } else if (kind === 'torre') {
    const floors = 4;
    mass(b, s, { ...base, floors, open: [0, 1, 2, 3] }, (floor, i, _count, side) => {
      if (floor === 0 && side === 0) return i === 0 ? 'door' : 'window';
      if (side === 0 && floor > 0) return 'balcony';
      return side === 2 ? 'blank' : 'window';
    });
    roof(
      b,
      s,
      { ...base, y: floors * STOREY },
      { features: ['tank', variation % 2 ? 'line' : 'plants', 'rebar'] },
    );
  } else if (kind === 'terraza') {
    mass(b, s, { ...base, floors: 2, open: [0, 1, 2, 3] }, residential);
    const top = 2 * STOREY;
    roof(b, s, { ...base, y: top }, { parapet: 'rail', features: ['plants', 'line', 'plants'] });
    const room = {
      w: W * 0.48,
      d: D * 0.5,
      x: -W * 0.24,
      z: -D * 0.22,
      y0: top,
      floors: 1,
      open: [0, 1] as Side[],
    };
    mass(b, { ...s, finish: variation % 2 ? 'brick' : s.finish }, room, (_f, i) =>
      i === 0 ? 'door' : 'window',
    );
    roof(
      b,
      s,
      { w: room.w, d: room.d, x: room.x, z: room.z, y: top + STOREY },
      { features: ['tank', 'dish'] },
    );
    for (const cx of [0.08, 0.44])
      for (const cz of [0.12, 0.42])
        b.block(0.03, 0.42, 0.03, W * cx, top + 0.05, D * cz, 'wood', Surface.wood);
    for (let i = 0; i < 5; i++)
      b.block(0.42, 0.03, 0.035, W * 0.26, top + 0.47, D * 0.1 + i * D * 0.08, 'wood', Surface.wood);
  } else if (kind === 'taller') {
    mass(b, s, { ...base, floors: 1, open: [0] }, (_f, i, n) => (i === n - 1 ? 'door' : 'shutter'));
    const top = STOREY;
    roof(b, s, { ...base, y: top }, { parapet: 'none', features: [] });
    const upper = { w: W * 0.55, d: D, x: -W * 0.22, z: 0, y0: top, floors: 1, open: [0, 3] as Side[] };
    mass(b, { ...s, finish: 'brick' }, upper, () => (s.rng() < 0.7 ? 'window' : 'blank'));
    roof(
      b,
      s,
      { w: upper.w, d: upper.d, x: upper.x, z: upper.z, y: top + STOREY },
      { parapet: 'none', features: ['tank', 'rebar'] },
    );
    const sheet = new THREE.BoxGeometry(W * 0.44, 0.025, D + 0.12);
    sheet.rotateX(-0.16);
    sheet.translate(W * 0.28, top + 0.36, 0);
    b.add(sheet, 'zinc', Surface.corrugated);
    for (const cz of [-1, 1])
      b.block(0.04, 0.3, 0.04, W * 0.47, top + 0.02, (cz * D) / 2.3, 'metal', Surface.metal);
  } else if (kind === 'esquina') {
    const floors = 3;
    mass(b, s, { ...base, floors, open: [0, 1, 2] }, (floor, i, count, side) => {
      if (floor === 0) return side === 0 ? 'door' : i === count - 1 ? 'shop' : 'window';
      return side === 1 && i === 0 ? 'balcony' : side === 0 ? 'balcony' : 'window';
    });
    roof(b, s, { ...base, y: floors * STOREY }, { features: roofFeatures() });
    // Exterior stair climbing the mural wall to the first floor landing.
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const z = D / 2 - 0.12 - i * ((D * 0.62) / steps);
      b.block(
        0.2,
        0.05,
        (D * 0.62) / steps + 0.01,
        -W / 2 - 0.11,
        ((i + 1) * STOREY) / steps - 0.05,
        z,
        'concrete',
        Surface.concrete,
      );
    }
    b.block(0.2, 0.05, 0.3, -W / 2 - 0.11, STOREY - 0.05, -D / 2 + 0.2, 'concrete', Surface.concrete);
    b.bar(
      new THREE.Vector3(-W / 2 - 0.2, 0.28, D / 2 - 0.1),
      new THREE.Vector3(-W / 2 - 0.2, STOREY + 0.26, -D / 2 + 0.36),
      0.018,
      s.trim,
      Surface.metal,
    );
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      b.block(
        0.012,
        0.26,
        0.012,
        -W / 2 - 0.2,
        t * STOREY + 0.02,
        D / 2 - 0.1 - t * (D - 0.46),
        'metal',
        Surface.metal,
      );
    }
  }
  if (s.rng() < 0.5 && kind !== 'torre') {
    const [x, z, r] = facePoint(1, W / 2, D / 2, (s.rng() - 0.5) * 0.3, 0.05);
    b.box(0.16, 0.12, 0.09, x, STOREY * 1.25, z, 'offWhite', Surface.paint, r);
  }
  return b.finish();
}

export function buildingStyle(kind: string, variation: number): { plaster: PaletteName; finish: Finish } {
  const s = style(kind, variation);
  return { plaster: s.plaster, finish: s.finish };
}
