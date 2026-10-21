import * as THREE from 'three';
import type { Edge, Kind, Meet, Region } from '../domain';
import { building, buildingStyle } from './architecture';
import { Builder, random } from './builder';
import { edgeAngle, facing, INRADIUS, LEVEL } from './hex';
import { tree } from './models';
import { type PaletteName, Surface } from './palette';

/**
 * What a tile needs to know to dress itself. Per-side arrays are already rotated into world directions and
 * come from the Rust rules: `paths` groups path edges joined inside the tile, `entrances` gives the path group
 * each home opens onto, and `sides` says how each edge meets its neighbor.
 */
export interface TileSite {
  q: number;
  r: number;
  kind: Kind;
  edges: readonly Edge[];
  paths: readonly number[];
  entrances: readonly (number | null)[];
  variation: number;
  elevation: number;
  region: Region;
}
/** How one side meets its neighbor: the Rust meet and the neighbor's height above this tile. */
export interface SideState {
  meet: Meet;
  rise: number;
}
export interface Part {
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}
type Point = { x: number; z: number };

/** Houses are the existing shape-grammar buildings, scaled to sit two to four on a tile. */
const HOUSE_SCALE = 0.74;
const HOUSE_DISTANCE = 1.12;
/** Closest a house center may come to the middle of a walkway. */
const HOUSE_CLEARANCE = 0.62;
export const PATH_WIDTH = 0.56;
const COPING = 0.08;
const WATER_WIDTH = 0.62;
const BANK = 0.16;
export const STAIR_RUN = 0.8;
const STAIR_STEPS = 5;
const DEAD_END = 0.45;
const CLIFF_END = 0.38;
const HOMES = ['casa', 'casa', 'esquina', 'torre', 'casa', 'taller', 'esquina', 'casa'] as const;
const CURVE_STEPS = 12;

const anchor = (side: number, distance = INRADIUS): Point => {
  const angle = edgeAngle(side);
  return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
};
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** Quadratic Bézier samples; the end tangents point at the control point, so a curve from an edge midpoint
 * through a control on the edge normal leaves the edge square, and joins its neighbor's curve smoothly. */
function bezier(from: Point, control: Point, to: Point, steps = CURVE_STEPS): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return lerp(lerp(from, control, t), lerp(control, to, t), t);
  });
}

/** How a path edge ends: at the edge, at stairs climbing to the neighbor, or short of a dead end or cliff. */
export type PathEnd = 'edge' | 'stairs' | 'deadEnd' | 'cliff';

export function pathEnd(state: SideState | undefined): PathEnd {
  if (!state || state.meet === 'open') return 'edge';
  if (state.meet === 'steep') return 'cliff';
  if (state.meet !== 'match') return 'deadEnd';
  return state.rise > 0 ? 'stairs' : 'edge';
}

function endDistance(end: PathEnd): number {
  switch (end) {
    case 'stairs':
      return INRADIUS - STAIR_RUN;
    case 'deadEnd':
      return INRADIUS - DEAD_END;
    case 'cliff':
      return INRADIUS - CLIFF_END;
    default:
      return INRADIUS;
  }
}

export interface Walk {
  group: number;
  sides: number[];
  /** Centerlines in tile space, each starting at a side's end point. */
  curves: Point[][];
  /** Where three or more sides meet, a small paved landing. */
  hub: Point | null;
}

/**
 * Lays out each path group as curves between its edges. Two edges make one curve through the tile; three
 * or more meet at a landing; one edge leads in to a doorstep. Different groups never share a point.
 */
export function walks(
  site: Pick<TileSite, 'edges' | 'paths'>,
  sides: readonly (SideState | undefined)[],
): Walk[] {
  const groups = new Map<number, number[]>();
  site.paths.forEach((group, side) => {
    if (group && site.edges[side] === 'path') groups.set(group, [...(groups.get(group) ?? []), side]);
  });
  return [...groups.entries()].map(([group, members]) => {
    const ends = members.map((side) => anchor(side, endDistance(pathEnd(sides[side]))));
    if (members.length === 1) {
      const side = members[0] as number;
      return { group, sides: members, curves: [[ends[0] as Point, anchor(side, 0.5)]], hub: null };
    }
    if (members.length === 2)
      return {
        group,
        sides: members,
        curves: [bezier(ends[0] as Point, { x: 0, z: 0 }, ends[1] as Point)],
        hub: null,
      };
    const mean = members
      .map((side) => anchor(side))
      .reduce((sum, p) => ({ x: sum.x + p.x / members.length, z: sum.z + p.z / members.length }), {
        x: 0,
        z: 0,
      });
    const hub = { x: mean.x * 0.35, z: mean.z * 0.35 };
    return {
      group,
      sides: members,
      curves: members.map((side, i) => bezier(ends[i] as Point, anchor(side, 0.55), hub, 8)),
      hub,
    };
  });
}

/** The nearest centerline point of a walk to `p`. */
function nearestOn(walk: Walk, p: Point): Point {
  let best = walk.hub ?? (walk.curves[0]?.[0] as Point);
  for (const curve of walk.curves)
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1] as Point,
        b = curve[i] as Point;
      const dx = b.x - a.x,
        dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      const q = { x: a.x + dx * t, z: a.z + dz * t };
      if (distance(q, p) < distance(best, p)) best = q;
    }
  return best;
}

/** Distance from `p` to the nearest walkway centerline on the tile. */
export function clearance(all: readonly Walk[], p: Point): number {
  return Math.min(Infinity, ...all.map((walk) => distance(nearestOn(walk, p), p)));
}

/** A flat strip along a polyline, `width` wide, its top at `y`. */
function ribbon(points: readonly Point[], width: number, y: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const half = width / 2;
  const last = points.length - 1;
  const offsets = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)] as Point,
      b = points[Math.min(last, i + 1)] as Point;
    let dx = b.x - a.x,
      dz = b.z - a.z;
    let length = Math.hypot(dx, dz) || 1;
    // A curve that leaves an edge along its normal should meet the edge exactly square, so the neighbor's
    // strip starts where this one ends. Sampled chords are a few degrees off; use the true normal there.
    const radius = Math.hypot(p.x, p.z);
    if ((i === 0 || i === last) && radius > 0.6) {
      const outward = i === 0 ? -1 : 1;
      const rx = (p.x / radius) * outward,
        rz = (p.z / radius) * outward;
      if ((dx * rx + dz * rz) / length > 0.95) {
        dx = rx;
        dz = rz;
        length = 1;
      }
    }
    return {
      x: p.x + (-dz / length) * half,
      z: p.z + (dx / length) * half,
      ox: p.x + (dz / length) * half,
      oz: p.z + (-dx / length) * half,
    };
  });
  for (let i = 1; i < offsets.length; i++) {
    const a = offsets[i - 1] as (typeof offsets)[number],
      b = offsets[i] as (typeof offsets)[number];
    positions.push(a.x, y, a.z, b.ox, y, b.oz, b.x, y, b.z);
    positions.push(a.x, y, a.z, a.ox, y, a.oz, b.ox, y, b.oz);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Wind every triangle upward.
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i),
      az = p.getZ(i);
    const cross = (p.getX(i + 1) - ax) * (p.getZ(i + 2) - az) - (p.getZ(i + 1) - az) * (p.getX(i + 2) - ax);
    if (cross > 0) {
      const x = p.getX(i + 1),
        z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), y, p.getZ(i + 2));
      p.setXYZ(i + 2, x, y, z);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

function disc(radius: number, y: number, segments = 14): THREE.BufferGeometry {
  return new THREE.CircleGeometry(radius, segments).rotateX(-Math.PI / 2).translate(0, y, 0);
}

function stairs(b: Builder, side: number, rise: number): void {
  const angle = edgeAngle(side);
  const turn = facing(angle);
  const start = INRADIUS - STAIR_RUN;
  const depth = STAIR_RUN / STAIR_STEPS;
  for (let i = 0; i < STAIR_STEPS; i++) {
    const height = ((i + 1) * LEVEL * rise) / STAIR_STEPS;
    const d = start + depth * (i + 0.5);
    b.block(
      PATH_WIDTH,
      height + 0.04,
      depth + 0.01,
      Math.cos(angle) * d,
      0,
      Math.sin(angle) * d,
      'walkway',
      Surface.concrete,
      turn,
    );
    const nose = start + depth * (i + 1) - 0.02;
    b.block(
      PATH_WIDTH + 0.02,
      0.025,
      0.04,
      Math.cos(angle) * nose,
      height + 0.03,
      Math.sin(angle) * nose,
      'retaining',
      Surface.concrete,
      turn,
    );
  }
  for (const offset of [-1, 1]) {
    const lateral = (PATH_WIDTH / 2 + 0.06) * offset;
    const d = INRADIUS - STAIR_RUN / 2;
    const x = Math.cos(angle) * d + Math.cos(angle + Math.PI / 2) * lateral;
    const z = Math.sin(angle) * d + Math.sin(angle + Math.PI / 2) * lateral;
    b.block(0.1, LEVEL * rise * 0.6 + 0.08, STAIR_RUN, x, 0, z, 'retaining', Surface.stone, turn);
  }
}

/** A planter where a path stops against homes or gardens: the walk ends here on purpose. */
function deadEnd(b: Builder, side: number): void {
  const angle = edgeAngle(side);
  const d = INRADIUS - DEAD_END + 0.12;
  const [x, z] = [Math.cos(angle) * d, Math.sin(angle) * d];
  b.block(0.5, 0.18, 0.2, x, 0, z, 'terracotta', Surface.plaster, facing(angle));
  b.blob(0.13, x, 0.26, z, 'leaf', Surface.foliage, 0.8, 0);
}

/** A railing where a path meets a drop too tall for stairs. */
function cliffRail(b: Builder, side: number): void {
  const angle = edgeAngle(side);
  const d = INRADIUS - CLIFF_END + 0.06;
  const across = { x: Math.cos(angle + Math.PI / 2), z: Math.sin(angle + Math.PI / 2) };
  const at = (lateral: number, y: number) =>
    new THREE.Vector3(Math.cos(angle) * d + across.x * lateral, y, Math.sin(angle) * d + across.z * lateral);
  const half = PATH_WIDTH / 2 + 0.06;
  b.block(
    PATH_WIDTH + 0.16,
    0.12,
    0.1,
    Math.cos(angle) * d,
    0,
    Math.sin(angle) * d,
    'retaining',
    Surface.stone,
    facing(angle),
  );
  b.bar(at(-half, 0.42), at(half, 0.42), 0.035, 'metal', Surface.metal);
  for (const lateral of [-half, 0, half])
    b.bar(at(lateral, 0.1), at(lateral, 0.42), 0.03, 'metal', Surface.metal);
}

function surface(
  site: TileSite,
  sides: readonly (SideState | undefined)[],
  layout: readonly Walk[],
): THREE.BufferGeometry | null {
  const b = new Builder(false);
  const paved = site.kind === 'plaza' || site.kind === 'capilla';
  if (paved) {
    b.add(disc(1.22, 0.035, 12), 'coping', Surface.concrete);
    b.add(disc(1.12, 0.045, 12), 'walkway', Surface.paving);
  }
  for (const walk of layout) {
    for (const curve of walk.curves) {
      b.add(ribbon(curve, PATH_WIDTH + COPING, 0.028), 'coping', Surface.concrete);
      b.add(ribbon(curve, PATH_WIDTH, 0.045), 'walkway', Surface.paving);
    }
    if (walk.hub) {
      b.add(disc(0.44, 0.028).translate(walk.hub.x, 0, walk.hub.z), 'coping', Surface.concrete);
      b.add(disc(0.4, 0.046).translate(walk.hub.x, 0, walk.hub.z), 'walkway', Surface.paving);
    }
    if (walk.sides.length === 1) {
      const end = walk.curves[0]?.[1] as Point;
      b.add(disc(0.33, 0.028).translate(end.x, 0, end.z), 'coping', Surface.concrete);
      b.add(disc(0.29, 0.046).translate(end.x, 0, end.z), 'walkway', Surface.paving);
    }
    for (const side of walk.sides) {
      const end = pathEnd(sides[side]);
      if (end === 'stairs') stairs(b, side, sides[side]?.rise ?? 1);
      if (end === 'deadEnd') deadEnd(b, side);
      if (end === 'cliff') cliffRail(b, side);
    }
  }
  const water = site.edges.flatMap((edge, side) => (edge === 'water' ? [side] : []));
  const channel = (curve: Point[]) => {
    b.add(ribbon(curve, WATER_WIDTH + BANK * 2, 0.012), 'bank', Surface.soil);
    b.add(ribbon(curve, WATER_WIDTH, 0.024), 'water', Surface.water);
  };
  const pond = (at: Point, radius: number) => {
    b.add(disc(radius + BANK, 0.012).translate(at.x, 0, at.z), 'bank', Surface.soil);
    b.add(disc(radius, 0.026).translate(at.x, 0, at.z), 'water', Surface.water);
  };
  if (water.length === 1) {
    const side = water[0] as number;
    channel([anchor(side), anchor(side, 0.5)]);
    pond(anchor(side, 0.45), 0.5);
  } else if (water.length === 2)
    channel(bezier(anchor(water[0] as number), { x: 0, z: 0 }, anchor(water[1] as number)));
  else if (water.length > 2) {
    for (const side of water) channel([anchor(side), anchor(side, 0.3)]);
    pond({ x: 0, z: 0 }, 0.62);
  }
  // A small cascade where the stream drops to a lower neighbor.
  for (const side of water) {
    const rise = sides[side]?.meet === 'match' ? (sides[side]?.rise ?? 0) : 0;
    if (rise >= 0) continue;
    const angle = edgeAngle(side);
    const fall = new THREE.PlaneGeometry(WATER_WIDTH, -rise * LEVEL);
    fall.rotateY(facing(angle));
    const d = INRADIUS + 0.015;
    fall.translate(Math.cos(angle) * d, (rise * LEVEL) / 2 + 0.02, Math.sin(angle) * d);
    b.add(fall, 'water', Surface.water);
  }
  return b.empty ? null : b.finish();
}

function chapel(variation: number): THREE.BufferGeometry {
  const b = new Builder();
  const wall: PaletteName = variation % 3 === 1 ? 'cream' : 'offWhite';
  const trim: PaletteName = (['dustyBlue', 'teal', 'ochre'] as const)[variation % 3] ?? 'dustyBlue';
  // Nave with a pitched clay roof; the front faces +Z toward the plaza.
  b.block(1.0, 1.0, 1.5, 0, 0, -0.1, wall, Surface.plaster);
  b.block(1.04, 0.08, 1.54, 0, 1.0, -0.1, trim, Surface.paint);
  for (const side of [-1, 1]) {
    const slab = new THREE.BoxGeometry(0.66, 0.06, 1.62);
    slab.rotateZ(side * -0.62);
    slab.translate(side * 0.27, 1.27, -0.1);
    b.add(slab, 'terracotta', Surface.tile);
  }
  const gable = new THREE.CylinderGeometry(0.6, 0.6, 1.5, 3);
  gable.rotateX(Math.PI / 2);
  gable.rotateZ(Math.PI);
  gable.scale(1, 0.4, 1);
  gable.translate(0, 1.2, -0.1);
  b.add(gable, wall, Surface.plaster);
  b.block(0.42, 1.95, 0.42, 0.42, 0, 0.5, wall, Surface.plaster);
  b.block(0.46, 0.08, 0.46, 0.42, 1.95, 0.5, trim, Surface.paint);
  b.block(0.2, 0.3, 0.46, 0.42, 1.55, 0.5, 'windowDark', Surface.glass);
  b.cylinder(0.34, 0.42, 0.42, 2.03, 0.5, 'terracotta', Surface.tile, 0.02, 4);
  b.block(0.02, 0.22, 0.02, 0.42, 2.45, 0.5, 'metal', Surface.metal);
  b.block(0.14, 0.02, 0.02, 0.42, 2.58, 0.5, 'metal', Surface.metal);
  b.block(0.3, 0.5, 0.03, -0.08, 0, 0.66, 'wood', Surface.wood);
  b.cylinder(0.12, 0.03, -0.08, 0.72, 0.66, trim, Surface.paint, 0.12, 12);
  b.block(0.36, 0.06, 0.26, -0.08, -0.02, 0.8, 'stone', Surface.concrete);
  return b.finish();
}

/** A tall wax palm (Salento) or a coconut palm (Cartagena). */
function palm(variation: number, wax: boolean): THREE.BufferGeometry {
  const b = new Builder(false);
  const rng = random(variation * 53 + (wax ? 1 : 2));
  const height = wax ? 2.3 + rng() * 0.4 : 1.4 + rng() * 0.3;
  const lean = wax ? 0 : 0.18;
  b.bar(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(lean, height, 0),
    wax ? 0.07 : 0.08,
    wax ? 'stone' : 'wood',
    Surface.wood,
  );
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng() * 0.3;
    const reach = wax ? 0.42 : 0.55;
    b.bar(
      new THREE.Vector3(lean, height, 0),
      new THREE.Vector3(lean + Math.cos(a) * reach, height - 0.22, Math.sin(a) * reach),
      0.06,
      i % 2 ? 'leaf' : 'leafDeep',
      Surface.foliage,
    );
  }
  b.blob(0.12, lean, height, 0, 'leafDeep', Surface.foliage, 0.8, 0);
  return b.finish();
}

function shrub(variation: number): THREE.BufferGeometry {
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

/** Bougainvillea spilling over a courtyard wall. */
function bougainvillea(variation: number): THREE.BufferGeometry {
  const b = new Builder(false);
  const rng = random(variation * 17 + 3);
  for (let i = 0; i < 5; i++)
    b.blob(
      0.1 + rng() * 0.06,
      (rng() - 0.5) * 0.5,
      0.25 + rng() * 0.35,
      (rng() - 0.5) * 0.15,
      i % 3 ? 'bloom' : 'leaf',
      Surface.foliage,
      0.8,
      0,
    );
  return b.finish();
}

function bench(): THREE.BufferGeometry {
  const b = new Builder(false);
  for (const x of [-0.22, 0.22]) b.block(0.07, 0.18, 0.24, x, 0, 0, 'concrete', Surface.concrete);
  for (let i = 0; i < 3; i++) b.block(0.6, 0.03, 0.07, 0, 0.18, -0.08 + i * 0.08, 'wood', Surface.wood);
  b.block(0.6, 0.14, 0.03, 0, 0.22, -0.12, 'wood', Surface.wood);
  return b.finish();
}

function lamp(): THREE.BufferGeometry {
  const b = new Builder(false);
  b.cylinder(0.035, 0.9, 0, 0, 0, 'metal', Surface.metal, 0.03, 6);
  b.blob(0.08, 0, 0.95, 0, 'lamp', Surface.paint, 1, 0);
  return b.finish();
}

function rock(variation: number): THREE.BufferGeometry {
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

/** A whitewashed coffee-country farmhouse (Salento): one storey, clay roof, colored trim and a veranda. */
function finca(variation: number): THREE.BufferGeometry {
  const b = new Builder();
  const trim: PaletteName =
    (['mutedGreen', 'brickRed', 'dustyBlue', 'mustard'] as const)[variation % 4] ?? 'mutedGreen';
  b.block(1.2, 0.62, 0.78, 0, 0, -0.1, 'offWhite', Surface.plaster);
  b.block(1.22, 0.12, 0.8, 0, 0, -0.1, trim, Surface.paint);
  for (const side of [-1, 1]) {
    const slab = new THREE.BoxGeometry(1.42, 0.05, 0.62);
    slab.rotateX(side * 0.5);
    slab.translate(0, 0.78, -0.1 + side * 0.24);
    b.add(slab, 'terracotta', Surface.tile);
  }
  // Veranda: posts and a rail along the front, which faces +Z.
  b.block(1.3, 0.05, 0.36, 0, 0, 0.42, 'wood', Surface.wood);
  for (const x of [-0.58, -0.2, 0.2, 0.58]) b.block(0.05, 0.6, 0.05, x, 0.05, 0.56, trim, Surface.paint);
  b.block(1.22, 0.04, 0.04, 0, 0.32, 0.56, trim, Surface.paint);
  for (const x of [-0.38, 0.38]) {
    b.block(0.22, 0.3, 0.02, x, 0.22, 0.3, 'windowDark', Surface.glass);
    b.block(0.06, 0.3, 0.025, x - 0.15, 0.22, 0.3, trim, Surface.paint);
    b.block(0.06, 0.3, 0.025, x + 0.15, 0.22, 0.3, trim, Surface.paint);
  }
  b.block(0.2, 0.42, 0.02, 0, 0.05, 0.3, 'wood', Surface.wood);
  return b.finish();
}

/**
 * A Cartagena courtyard house: two ochre storeys with a wooden balcony over the street door, and a walled
 * patio beside it. Shallow front to back, so it stays inside its hex when it backs onto the tile's edge.
 */
function casona(variation: number): THREE.BufferGeometry {
  const b = new Builder();
  const wall: PaletteName = (['ochre', 'mustard', 'coral'] as const)[variation % 3] ?? 'ochre';
  b.block(0.9, 1.15, 0.5, -0.1, 0, -0.05, wall, Surface.plaster);
  b.block(0.94, 0.07, 0.54, -0.1, 1.15, -0.05, 'offWhite', Surface.paint);
  b.block(0.84, 0.04, 0.5, -0.1, 1.22, -0.05, 'terracotta', Surface.tile);
  // Balcony with turned wooden rails over the street door, which faces +Z.
  b.block(0.8, 0.05, 0.2, -0.1, 0.62, 0.3, 'wood', Surface.wood);
  for (let i = 0; i < 6; i++) b.block(0.025, 0.24, 0.025, -0.45 + i * 0.14, 0.67, 0.38, 'wood', Surface.wood);
  b.block(0.8, 0.035, 0.035, -0.1, 0.91, 0.38, 'wood', Surface.wood);
  for (const x of [-0.32, 0.12]) b.block(0.18, 0.34, 0.02, x, 0.7, 0.2, 'windowDark', Surface.glass);
  b.block(0.24, 0.5, 0.02, -0.1, 0, 0.2, 'wood', Surface.wood);
  // The patio beside the house, walled on three sides with a gate toward the street.
  b.block(0.06, 0.34, 0.5, 0.68, 0, -0.05, wall, Surface.plaster);
  b.block(0.36, 0.34, 0.06, 0.53, 0, -0.27, wall, Surface.plaster);
  b.block(0.14, 0.34, 0.06, 0.62, 0, 0.17, wall, Surface.plaster);
  return b.finish();
}

/** A flat darker pad under a building, so it sits on the ground instead of floating above it. */
function contact(radius: number): THREE.BufferGeometry {
  const b = new Builder(false);
  b.add(
    new THREE.CircleGeometry(radius, 16).rotateX(-Math.PI / 2).translate(0, 0.006, 0),
    'contact',
    Surface.soil,
  );
  return b.finish();
}

/** A raised forecourt for the Medellín start: homes one step above the stair street. */
function terrace(side: number): THREE.BufferGeometry {
  const b = new Builder();
  const angle = edgeAngle(side);
  b.block(1.1, 0.28, 1.0, 0, 0, 0, 'retaining', Surface.stone, facing(angle));
  b.block(1.14, 0.04, 1.04, 0, 0.28, 0, 'coping', Surface.concrete, facing(angle));
  return b.finish();
}

/** The first variation whose building style satisfies `wanted`, so regions get recognizable houses. */
function variantWhere(
  kind: string,
  wanted: (style: ReturnType<typeof buildingStyle>) => boolean,
  start: number,
): number {
  for (let i = 0; i < 16; i++) {
    const variation = (start + i) % 16;
    if (wanted(buildingStyle(kind, variation))) return variation;
  }
  return start % 16;
}

/** Builds and caches every geometry a tile can show, and lays out a tile from them. */
export class TileKit {
  private readonly cache = new Map<string, THREE.BufferGeometry>();
  /** Surface layouts with no paths, paving, or water, which need no geometry at all. */
  private readonly bare = new Set<string>();

  private cached(name: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geometry = this.cache.get(name);
    if (!geometry) {
      geometry = make();
      this.cache.set(name, geometry);
    }
    return geometry;
  }

  get size(): number {
    return this.cache.size;
  }

  /** Parts in tile-local space: the tile center at the origin, its ground at y = 0. */
  compose(site: TileSite, sides: readonly (SideState | undefined)[]): Part[] {
    const layout = walks(site, sides);
    const parts: Part[] = [];
    const add = (geometry: THREE.BufferGeometry, x: number, z: number, turn: number, scale = 1, y = 0) =>
      parts.push({
        geometry,
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(x, y, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn),
          new THREE.Vector3(scale, scale, scale),
        ),
      });
    const surfaceKey = `surface/${site.kind === 'plaza' || site.kind === 'capilla' ? 'paved' : 'plain'}/${site.edges.join()}/${site.paths.join()}/${sides
      .map((side) => (side ? `${side.meet}${side.rise}` : '-'))
      .join()}`;
    if (!this.bare.has(surfaceKey)) {
      const geometry = this.cache.get(surfaceKey) ?? surface(site, sides, layout);
      if (geometry) {
        this.cache.set(surfaceKey, geometry);
        parts.push({ geometry, matrix: new THREE.Matrix4() });
      } else this.bare.add(surfaceKey);
    }
    const rng = random(Math.imul(site.q, 7919) ^ Math.imul(site.r, 104729) ^ (site.variation * 131));
    const sector = (side: number, d: number, spread = 0) => {
      const angle = edgeAngle(side) + spread;
      return [Math.cos(angle) * d, Math.sin(angle) * d, angle] as const;
    };
    const greens: number[] = [];
    // A landmark takes the first garden side of its tile.
    let landmarkSide = -1;
    if (site.kind === 'capilla') {
      landmarkSide = site.edges.indexOf('nature');
      if (landmarkSide >= 0) {
        const [x, z, angle] = sector(landmarkSide, 1.0);
        add(
          this.cached(`chapel/${site.variation % 3}`, () => chapel(site.variation % 3)),
          x,
          z,
          facing(angle + Math.PI),
        );
      }
    }
    const start = site.kind === 'inicio' ? site.region : null;
    let homes = 0;
    site.edges.forEach((edge, side) => {
      if (side === landmarkSide) return;
      if (edge === 'nature') {
        greens.push(side);
        return;
      }
      if (edge !== 'homes') return;
      // Each house faces the walk its entrance opens onto, with a short stoop to it.
      const walk = layout.find((candidate) => candidate.group === site.entrances[side]);
      let at = { x: sector(side, HOUSE_DISTANCE)[0], z: sector(side, HOUSE_DISTANCE)[1] };
      for (let d = HOUSE_DISTANCE; d <= 1.36 && clearance(layout, at) < HOUSE_CLEARANCE; d += 0.06)
        at = { x: sector(side, d)[0], z: sector(side, d)[1] };
      const door = walk ? nearestOn(walk, at) : { x: 0, z: 0 };
      const toward = Math.atan2(door.z - at.z, door.x - at.x);
      let kind: string = HOMES[(site.variation + homes * 3 + side) % HOMES.length] ?? 'casa';
      let variant = (site.variation * 5 + side * 3 + homes) % 16;
      if (site.kind === 'tienda' && homes === 0) kind = 'tienda';
      if (start === 'medellin') variant = variantWhere('casa', (s) => s.finish !== 'painted', variant);
      if (start === 'bogota') {
        kind = 'taller';
        variant = variantWhere('taller', (s) => s.finish === 'brick', variant);
      }
      if (start === 'salento')
        variant = variantWhere('casa', (s) => s.plaster === 'offWhite' || s.plaster === 'cream', variant);
      if (start === 'cartagena')
        variant = variantWhere('casa', (s) => ['ochre', 'mustard', 'coral'].includes(s.plaster), variant);
      const lift = start === 'medellin' ? 0.32 : 0;
      if (lift)
        add(
          this.cached(`terrace/${side}`, () => terrace(side)),
          at.x,
          at.z,
          0,
        );
      const model =
        start === 'salento'
          ? this.cached(`finca/${site.variation % 4}`, () => finca(site.variation))
          : start === 'cartagena' && homes === 0
            ? this.cached(`casona/${site.variation % 3}`, () => casona(site.variation))
            : this.cached(`building/${kind}/${variant}`, () => building(kind, 1, 1, variant));
      // A soft darker pad grounds the house, like the shade at the foot of real walls.
      add(
        this.cached('contact/house', () => contact(0.62)),
        at.x,
        at.z,
        facing(toward),
        1,
        lift ? lift : 0,
      );
      add(
        model,
        at.x,
        at.z,
        facing(toward),
        start === 'salento' ? 0.85 : start === 'cartagena' && homes === 0 ? 0.8 : HOUSE_SCALE,
        lift,
      );
      if (walk) {
        const front = { x: at.x + Math.cos(toward) * 0.34, z: at.z + Math.sin(toward) * 0.34 };
        if (distance(front, door) > 0.05) {
          const key = `stoop/${front.x.toFixed(2)},${front.z.toFixed(2)}/${door.x.toFixed(2)},${door.z.toFixed(2)}/${lift}`;
          add(
            this.cached(key, () => {
              const s = new Builder(false);
              s.add(ribbon([front, door], 0.24, 0.05), 'walkway', Surface.paving);
              if (lift) {
                // Steps down from the forecourt to the street.
                for (let i = 0; i < 3; i++) {
                  const p = lerp(front, door, (i + 0.5) / 3);
                  s.block(
                    0.3,
                    lift * (1 - i / 3),
                    0.14,
                    p.x,
                    0,
                    p.z,
                    'walkway',
                    Surface.concrete,
                    facing(toward),
                  );
                }
              }
              return s.finish();
            }),
            0,
            0,
            0,
          );
        }
      }
      if (start === 'cartagena' && homes === 0) {
        const [bx, bz] = [at.x + Math.cos(toward + 1.4) * 0.38, at.z + Math.sin(toward + 1.4) * 0.38];
        add(
          this.cached(`bougainvillea/${site.variation % 4}`, () => bougainvillea(site.variation)),
          bx,
          bz,
          toward,
        );
      }
      homes++;
    });
    const treeAt = (x: number, z: number, scale: number) => {
      if (clearance(layout, { x, z }) < PATH_WIDTH / 2 + 0.28) return;
      const variant = Math.floor(rng() * 16);
      add(
        this.cached(`tree/${variant % 10}`, () => tree(variant % 10 === 9 ? 14 : variant % 10, false)),
        x,
        z,
        rng() * Math.PI * 2,
        scale,
      );
    };
    const shrubAt = (x: number, z: number) => {
      if (clearance(layout, { x, z }) < PATH_WIDTH / 2 + 0.2) return;
      const variant = Math.floor(rng() * 8);
      add(
        this.cached(`shrub/${variant}`, () => shrub(variant)),
        x,
        z,
        rng() * 6.28,
        0.9 + rng() * 0.4,
      );
    };
    const forest = site.kind === 'monte';
    greens.forEach((side, index) => {
      if (start === 'salento' || start === 'cartagena') {
        if (index < 2) {
          const [x, z] = sector(side, 1.15, (rng() - 0.5) * 0.4);
          add(
            this.cached(`palm/${start}/${site.variation % 3}`, () =>
              palm(site.variation, start === 'salento'),
            ),
            x,
            z,
            rng() * 6.28,
          );
        } else {
          const [x, z] = sector(side, 1.1);
          shrubAt(x, z);
        }
        return;
      }
      if (start === 'bogota' && index === 0) {
        const [x, z, angle] = sector(side, 0.95);
        add(this.cached('bench', bench), x, z, facing(angle + Math.PI));
        return;
      }
      if (forest) {
        for (const [d, spread] of [
          [1.08, -0.34],
          [1.12, 0.32],
          [0.75, 0.05],
        ] as const) {
          const [x, z] = sector(side, d + (rng() - 0.5) * 0.15, spread + (rng() - 0.5) * 0.15);
          treeAt(x, z, 0.95 + rng() * 0.35);
        }
        return;
      }
      const roll = rng();
      if (site.kind === 'parque' && roll < 0.35) {
        const [x, z, angle] = sector(side, 0.95);
        if (clearance(layout, { x, z }) > 0.5)
          add(this.cached('bench', bench), x, z, facing(angle + Math.PI));
        const [sx, sz] = sector(side, 1.35, 0.35);
        shrubAt(sx, sz);
      } else if (roll < (site.kind === 'parque' ? 0.85 : 0.55)) {
        const [x, z] = sector(side, 1.1 + (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.4);
        treeAt(x, z, 0.85 + rng() * 0.3);
      } else {
        const [x, z] = sector(side, 1.15, (rng() - 0.5) * 0.5);
        shrubAt(x, z);
      }
      if (site.kind === 'quebrada' && rng() < 0.6) {
        const [x, z] = sector(side, 0.55, (rng() - 0.5) * 0.6);
        if (clearance(layout, { x, z }) > 0.5) {
          const variant = Math.floor(rng() * 4);
          add(
            this.cached(`rock/${variant}`, () => rock(variant)),
            x,
            z,
            rng() * 6.28,
          );
        }
      }
    });
    if (forest && greens.length === 6) treeAt((rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3, 1.2);
    if (start === 'bogota' || start === 'medellin')
      for (const walk of layout)
        for (const curve of walk.curves) {
          // Street lamps along the public path, set beside it.
          const mid = curve[Math.floor(curve.length / 3)] as Point;
          const next = curve[Math.floor(curve.length / 3) + 1] ?? mid;
          const angle = Math.atan2(next.z - mid.z, next.x - mid.x) + Math.PI / 2;
          add(this.cached('lamp', lamp), mid.x + Math.cos(angle) * 0.42, mid.z + Math.sin(angle) * 0.42, 0);
        }
    if (site.kind === 'plaza') {
      const free = [0, 1, 2, 3, 4, 5].filter((side) => site.edges[side] !== 'path');
      free.slice(0, 2).forEach((side, index) => {
        const [x, z, angle] = sector(side, 0.78);
        if (index === 0) treeAt(x, z, 0.9);
        else add(this.cached('bench', bench), x, z, facing(angle + Math.PI));
      });
    }
    return parts;
  }

  dispose(): void {
    for (const geometry of this.cache.values()) geometry.dispose();
    this.cache.clear();
  }
}
