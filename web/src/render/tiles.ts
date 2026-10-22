import * as THREE from 'three';
import type { Edge, Kind, Meet, Region } from '../domain';
import { building, buildingStyle } from './architecture';
import { Builder, random } from './builder';
import { buildingDoor, type DoorAnchor, setBuildingDoor } from './building-door';
import { edgeAngle, facing, HEX, INRADIUS, LEVEL } from './hex';
import { detailKey, detailModel, type Plant, plantKey, plantModel, VARIANTS, type Variant } from './models';
import { type PaletteName, Surface } from './palette';
import {
  type BlockedRegion,
  boundary,
  COPING,
  footprintDistance,
  type PathGraph,
  PedestrianPlanner,
  pave,
  pavementClearance,
  segmentDistance,
  WIDTH,
  withBoundaries,
} from './pedestrian';
import { type Candidate, DENSITY, details, type Ground, plantFor, plants } from './vegetation';

export {
  COPING,
  footprintDistance,
  insideFootprint,
  STAIR_RUN,
  segmentDistance,
  segmentsDistance,
} from './pedestrian';

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
  /** The run's seed for world-space vegetation fields; plant placement is still deterministic without it. */
  seed?: number;
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
export type Point = { x: number; z: number };

/** Houses are the existing shape-grammar buildings, scaled to sit two to four on a tile. */
const HOUSE_SCALE = 0.74;
const HOUSE_DISTANCE = 1.12;
export const PATH_WIDTH = WIDTH.primary;
const WATER_WIDTH = 0.62;
const BANK = 0.16;
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
  const kind = boundary(0, 1, state).kind;
  return kind === 'stairs' ? 'stairs' : kind === 'stop' ? 'deadEnd' : kind === 'cliff' ? 'cliff' : 'edge';
}

export interface Walk {
  readonly group: number;
  readonly sides: readonly number[];
  /** Centerlines in tile space, each starting at a side's end point. */
  readonly curves: readonly (readonly Point[])[];
  /** Where three or more sides meet, a small paved landing. */
  readonly hub: Point | null;
}

function graphWalks(graph: PathGraph): Walk[] {
  return [...new Set(graph.boundaries.map((p) => p.group))].map((group) => {
    const ports = graph.nodes.filter(
      (n) => n.kind === 'crossing' && n.location === 'boundary' && n.group === group,
    );
    const first = ports[0];
    const root = graph.nodes.find(
      (n) => n.group === group && n.kind === 'crossing' && n.location === 'interior',
    );
    const trace = (start: string, end: string): Point[] => {
      const visit = (id: string, previous: string | null): Point[] | null => {
        const node = graph.nodes.find((n) => n.id === id);
        if (!node) return null;
        if (id === end) return [node.at];
        for (const edge of graph.edges) {
          if (edge.class !== 'primary' || (edge.from !== id && edge.to !== id)) continue;
          const next = edge.from === id ? edge.to : edge.from;
          if (next === previous) continue;
          const path = visit(next, id);
          if (path) return [node.at, ...path];
        }
        return null;
      };
      return visit(start, null) ?? [];
    };
    const second = ports[1];
    return {
      group,
      sides: ports.flatMap((n) => (n.kind === 'crossing' ? [n.side] : [])),
      hub: null,
      curves:
        ports.length === 2 && first && second
          ? [trace(first.id, second.id)]
          : ports.map((n) => (root ? trace(n.id, root.id) : [])),
    };
  });
}
export function walks(
  site: Pick<TileSite, 'edges' | 'paths'>,
  sides: readonly (SideState | undefined)[],
): Walk[] {
  return graphWalks(new PedestrianPlanner({ ...site, kind: 'sendero' }, waterRegions(site)).finish(sides));
}

/** The nearest centerline point of a walk to `p`. */
function nearestOn(walk: Walk, p: Point): Point {
  let best = walk.hub ?? walk.curves[0]?.[0];
  if (!best) return { x: Infinity, z: Infinity };
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

function surface(
  site: TileSite,
  sides: readonly (SideState | undefined)[],
  graph: PathGraph,
): THREE.BufferGeometry | null {
  const b = new Builder(false);
  pave(b, graph);
  const water = site.edges.flatMap((edge, side) => (edge === 'water' ? [side] : []));
  const channel = (curve: Point[]) => {
    b.add(ribbon(curve, WATER_WIDTH + BANK * 2, 0.012), 'bank', Surface.soil);
    b.add(ribbon(curve, WATER_WIDTH, 0.024), 'waterDeep', Surface.water);
    b.add(ribbon(curve, WATER_WIDTH * 0.76, 0.025), 'water', Surface.water);
  };
  const pond = (at: Point, radius: number) => {
    b.add(disc(radius + BANK, 0.012).translate(at.x, 0, at.z), 'bank', Surface.soil);
    b.add(disc(radius, 0.0245).translate(at.x, 0, at.z), 'waterDeep', Surface.water);
    b.add(disc(radius * 0.8, 0.026).translate(at.x, 0, at.z), 'water', Surface.water);
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
  const geometry = b.finish();
  setBuildingDoor(geometry, { x: -0.08, z: 0.931, y: 0, heading: { x: 0, z: 1 }, width: 0.3 });
  return geometry;
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
  for (const x of [-0.4, 0.4]) b.block(0.42, 0.04, 0.04, x, 0.32, 0.56, trim, Surface.paint);
  for (const x of [-0.38, 0.38]) {
    b.block(0.22, 0.3, 0.02, x, 0.22, 0.3, 'windowDark', Surface.glass);
    b.block(0.06, 0.3, 0.025, x - 0.15, 0.22, 0.3, trim, Surface.paint);
    b.block(0.06, 0.3, 0.025, x + 0.15, 0.22, 0.3, trim, Surface.paint);
  }
  b.block(0.2, 0.42, 0.02, 0, 0.05, 0.3, 'wood', Surface.wood);
  const geometry = b.finish();
  setBuildingDoor(geometry, { x: 0, z: 0.601, y: 0, heading: { x: 0, z: 1 }, width: 0.24 });
  return geometry;
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
  const geometry = b.finish();
  setBuildingDoor(geometry, { x: -0.1, z: 0.241, y: 0, heading: { x: 0, z: 1 }, width: 0.24 });
  return geometry;
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
function terrace(): THREE.BufferGeometry {
  const b = new Builder();
  b.block(1.1, 0.28, 1.0, 0, 0, 0, 'retaining', Surface.stone);
  b.block(1.14, 0.04, 1.04, 0, 0.28, 0, 'coping', Surface.concrete);
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

export interface HomePlan {
  side: number;
  group: number | null;
  at: Point;
  turn: number;
  scale: number;
  y: number;
  door: Point;
  doorAnchor: DoorAnchor;
  public: boolean;
  readonly access: readonly Point[] | null;
  connected: boolean;
  footprint: Point[];
  /** The whole model's outline on the ground, overhangs and roofs included. */
  body: Point[];
  model: THREE.BufferGeometry;
}
export interface TilePlan {
  pedestrian: PathGraph;
  readonly walks: readonly Walk[];
  homes: HomePlan[];
}

type ModelLookup = (key: string, make: () => THREE.BufferGeometry) => THREE.BufferGeometry;
const transform = (p: Point, at: Point, turn: number, scale: number): Point => ({
  x: at.x + scale * (p.x * Math.cos(turn) + p.z * Math.sin(turn)),
  z: at.z + scale * (-p.x * Math.sin(turn) + p.z * Math.cos(turn)),
});

function groundBox(model: THREE.BufferGeometry): Point[] {
  const p = model.getAttribute('position');
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < p.count; i++)
    if (p.getY(i) <= 0.1) {
      minX = Math.min(minX, p.getX(i));
      maxX = Math.max(maxX, p.getX(i));
      minZ = Math.min(minZ, p.getZ(i));
      maxZ = Math.max(maxZ, p.getZ(i));
    }
  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ];
}

export function plan(
  site: TileSite,
  sides: readonly (SideState | undefined)[],
  lookup: ModelLookup = (_key, make) => make(),
): TilePlan {
  return planAtScale(site, sides, lookup);
}

/** The geometry lookup may cache models; all placement decisions depend only on the site and sides. */
function planAtScale(
  site: TileSite,
  sides: readonly (SideState | undefined)[],
  lookup: ModelLookup = (_key, make) => make(),
  maxScale = Infinity,
): TilePlan {
  const pedestrian = new PedestrianPlanner(site, waterRegions(site));
  const homes: HomePlan[] = [];
  const start = site.kind === 'inicio' ? site.region : null;
  const landmark = site.kind === 'capilla' ? site.edges.indexOf('nature') : -1;
  const specs = site.edges.flatMap((edge, side) => (edge === 'homes' || side === landmark ? [side] : []));
  for (const [index, side] of specs.entries()) {
    let kind: string = HOMES[(site.variation + index * 3 + side) % HOMES.length] ?? 'casa';
    let variant = (site.variation * 5 + side * 3 + index) % 16;
    if (site.kind === 'tienda' && index === 0) kind = 'tienda';
    if (start === 'medellin') variant = variantWhere('casa', (s) => s.finish !== 'painted', variant);
    if (start === 'bogota') {
      kind = 'taller';
      variant = variantWhere(kind, (s) => s.finish === 'brick', variant);
    }
    if (start === 'salento')
      variant = variantWhere('casa', (s) => s.plaster === 'offWhite' || s.plaster === 'cream', variant);
    if (start === 'cartagena')
      variant = variantWhere('casa', (s) => ['ochre', 'mustard', 'coral'].includes(s.plaster), variant);
    const model =
      side === landmark
        ? lookup(`chapel/${site.variation % 3}`, () => chapel(site.variation % 3))
        : start === 'salento'
          ? lookup(`finca/${site.variation % 4}`, () => finca(site.variation))
          : start === 'cartagena' && index === 0
            ? lookup(`casona/${site.variation % 3}`, () => casona(site.variation))
            : lookup(`building/${kind}/${variant}`, () => building(kind, 1, 1, variant));
    const localDoor = buildingDoor(model);
    const box = groundBox(model);
    if (start === 'medellin') {
      box[0] = { x: Math.min(box[0]?.x ?? 0, -0.57), z: Math.min(box[0]?.z ?? 0, -0.52) };
      box[1] = { x: Math.max(box[1]?.x ?? 0, 0.57), z: box[0].z };
      box[2] = { x: box[1].x, z: Math.max(box[2]?.z ?? 0, 0.52) };
      box[3] = { x: box[0].x, z: box[2].z };
    }
    if (!model.boundingBox) model.computeBoundingBox();
    const bounds = model.boundingBox;
    if (!bounds) throw new Error('House model has no bounds');
    const minX = Math.min(bounds.min.x, ...box.map((p) => p.x)),
      maxX = Math.max(bounds.max.x, ...box.map((p) => p.x));
    const minZ = Math.min(bounds.min.z, ...box.map((p) => p.z)),
      maxZ = Math.max(bounds.max.z, ...box.map((p) => p.z));
    const fullBox = [
      { x: minX, z: minZ },
      { x: maxX, z: minZ },
      { x: maxX, z: maxZ },
      { x: minX, z: maxZ },
    ];
    const group =
      side === landmark ? (site.paths.find((p) => p > 0) ?? null) : (site.entrances[side] ?? null);
    const nearestRoute = (p: Point) =>
      group === null ? { x: 0, z: 0 } : (pedestrian.nearest(group, p) ?? { x: 0, z: 0 });
    let selected: HomePlan | undefined;
    for (const scale of [
      side === landmark
        ? 0.74
        : start === 'salento'
          ? 0.85
          : start === 'cartagena' && index === 0
            ? 0.8
            : HOUSE_SCALE,
      0.64,
      0.54,
      0.44,
      0.34,
    ].filter((s) => s <= maxScale)) {
      for (const spread of [0, -0.08, 0.08, -0.16, 0.16, -0.24, 0.24, -0.32, 0.32, -0.4, 0.4, -0.48, 0.48]) {
        for (const d of [HOUSE_DISTANCE, 1.2, 1.28, 1.36, 1.44, 1.5, 1.04, 0.96]) {
          const angle = edgeAngle(side) + spread;
          const at = { x: Math.cos(angle) * d, z: Math.sin(angle) * d };
          let target = nearestRoute(at);
          let turn = facing(Math.atan2(target.z - at.z, target.x - at.x));
          // Aim the facade normal from its offset door, rather than from the center of the house.
          for (let i = 0; i < 8; i++) {
            const door = transform(localDoor, at, turn, scale);
            target = nearestRoute(door);
            turn = facing(Math.atan2(target.z - door.z, target.x - door.x));
          }
          const footprint = box.map((p) => transform(p, at, turn, scale));
          const full = fullBox.map((p) => transform(p, at, turn, scale));
          if (
            full.some((p) =>
              Array.from({ length: 6 }, (_, s) => anchor(s, 1)).some(
                (n) => p.x * n.x + p.z * n.z > INRADIUS - 0.005,
              ),
            )
          )
            continue;
          if (!pedestrian.roomFor(footprint)) continue;
          const door = transform(localDoor, at, turn, scale);
          const y = start === 'medellin' ? 0.32 * scale : 0;
          const doorAnchor: DoorAnchor = {
            ...door,
            y: y + localDoor.y * scale,
            heading: {
              x: localDoor.heading.x * Math.cos(turn) + localDoor.heading.z * Math.sin(turn),
              z: -localDoor.heading.x * Math.sin(turn) + localDoor.heading.z * Math.cos(turn),
            },
            width: localDoor.width * scale,
          };
          if (!pedestrian.connectDoor(side, group, doorAnchor, footprint, side === landmark)) continue;
          selected = {
            side,
            group,
            at,
            turn,
            scale,
            y,
            door,
            doorAnchor,
            public: side === landmark,
            access: null,
            connected: group !== null,
            footprint,
            body: full,
            model,
          };
          break;
        }
        if (selected) break;
      }
      if (selected) break;
    }
    if (!selected) {
      if (maxScale > 0.34)
        return planAtScale(
          site,
          sides,
          lookup,
          maxScale === Infinity ? 0.64 : Math.round((maxScale - 0.1) * 100) / 100,
        );
      throw new Error(`No house placement: ${site.kind}/${site.edges.join()}/${site.variation}/${side}`);
    }
    homes.push(selected);
  }
  const graph = pedestrian.finish(sides);
  const connectedHomes = homes.map((home) => {
    const door = graph.nodes.find((n) => n.kind === 'door' && n.side === home.side);
    if (!home.connected || !door) return home;
    const visit = (id: string, previous: string | null): Point[] | null => {
      const node = graph.nodes.find((n) => n.id === id);
      if (!node) return null;
      if (
        node.kind === 'crossing' ||
        graph.edges.some((e) => e.class === 'primary' && (e.from === id || e.to === id))
      )
        return [node.at];
      for (const edge of graph.edges) {
        if (edge.from !== id && edge.to !== id) continue;
        const next = edge.from === id ? edge.to : edge.from;
        if (next === previous) continue;
        const path = visit(next, id);
        if (path) return [node.at, ...path];
      }
      return null;
    };
    return { ...home, access: visit(door.id, null) };
  });
  return { pedestrian: graph, walks: graphWalks(graph), homes: connectedHomes };
}

type Rule = 'prop' | 'garden' | 'plant' | 'detail';
interface Disc extends Point {
  radius: number;
}
const outlines = new WeakMap<THREE.BufferGeometry, { hull: Point[]; radius: number }>();
/** A model's convex outline on the ground and its widest horizontal extent about its origin. */
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

function outlineOf(geometry: THREE.BufferGeometry): { hull: Point[]; radius: number } {
  let outline = outlines.get(geometry);
  if (!outline) {
    const p = geometry.getAttribute('position');
    const points = Array.from({ length: p.count }, (_, i) => ({ x: p.getX(i), z: p.getZ(i) })).sort(
      (a, b) => a.x - b.x || a.z - b.z,
    );
    const half = (list: Point[]) => {
      const out: Point[] = [];
      for (const point of list) {
        while (
          out.length > 1 &&
          cross(out[out.length - 2] as Point, out[out.length - 1] as Point, point) <= 0
        )
          out.pop();
        out.push(point);
      }
      return out.slice(0, -1);
    };
    const hull = [...half(points), ...half([...points].reverse())];
    outline = { hull, radius: Math.max(0, ...hull.map((v) => Math.hypot(v.x, v.z))) };
    outlines.set(geometry, outline);
  }
  return outline;
}
/** The nature sector a tile-local point lies in: the side whose edge it faces. */
function sectorOf(x: number, z: number): number {
  const side = Math.round((Math.atan2(z, x) - Math.PI / 6) / (Math.PI / 3));
  return ((side % 6) + 6) % 6;
}
const variantOf = (n: number): Variant => VARIANTS[n % VARIANTS.length] ?? 0;

/** Stream centerlines and ponds, as `surface()` lays them out, for keeping plants on the banks. */
function waterways(site: Pick<TileSite, 'edges'>): { curves: Point[][]; ponds: Disc[] } {
  const water = site.edges.flatMap((edge, side) => (edge === 'water' ? [side] : []));
  if (water.length === 1) {
    const side = water[0] as number;
    return { curves: [[anchor(side), anchor(side, 0.5)]], ponds: [{ ...anchor(side, 0.45), radius: 0.5 }] };
  }
  if (water.length === 2)
    return {
      curves: [bezier(anchor(water[0] as number), { x: 0, z: 0 }, anchor(water[1] as number))],
      ponds: [],
    };
  if (water.length > 2)
    return {
      curves: water.map((side) => [anchor(side), anchor(side, 0.3)]),
      ponds: [{ x: 0, z: 0, radius: 0.62 }],
    };
  return { curves: [], ponds: [] };
}
function waterRegions(site: Pick<TileSite, 'edges'>): BlockedRegion[] {
  const water = waterways(site);
  const regions: BlockedRegion[] = [];
  for (const curve of water.curves) {
    for (const [width, kind] of [
      [WATER_WIDTH + BANK * 2, 'bank'],
      [WATER_WIDTH, 'water'],
    ] as const) {
      const geometry = ribbon(curve, width, 0);
      const p = geometry.getAttribute('position');
      for (let i = 0; i < p.count; i += 3)
        regions.push({ kind, polygon: [0, 1, 2].map((j) => ({ x: p.getX(i + j), z: p.getZ(i + j) })) });
      geometry.dispose();
    }
  }
  for (const pond of water.ponds)
    for (const [radius, kind] of [
      [pond.radius + BANK, 'bank'],
      [pond.radius, 'water'],
    ] as const)
      regions.push({
        kind,
        polygon: Array.from({ length: 14 }, (_, i) => ({
          x: pond.x + Math.cos((i * Math.PI) / 7) * radius,
          z: pond.z + Math.sin((i * Math.PI) / 7) * radius,
        })),
      });
  return regions;
}
function waterDistance(water: ReturnType<typeof waterways>, p: Point): number {
  let best = Infinity;
  for (const curve of water.curves)
    for (let i = 1; i < curve.length; i++)
      best = Math.min(best, segmentDistance(p, curve[i - 1] as Point, curve[i] as Point));
  for (const pond of water.ponds) best = Math.min(best, distance(pond, p) - pond.radius + WATER_WIDTH / 2);
  return best;
}

const intrinsicKey = (site: TileSite): string =>
  `pedestrian-v1/${site.q}/${site.r}/${site.seed ?? 0}/${site.elevation}/${site.kind}/${site.region}/${site.variation}/${site.edges.join()}/${site.paths.join()}/${site.entrances.join()}`;
const boundaryKey = (sides: readonly (SideState | undefined)[]): string =>
  sides.map((side) => (side ? `${side.meet}${side.rise}` : '-')).join();

/** Builds and caches every geometry a tile can show, and lays out a tile from them. */
export class TileKit {
  private readonly cache = new Map<string, THREE.BufferGeometry>();
  private readonly interiors = new Map<string, TilePlan>();
  private readonly plans = new Map<string, TilePlan>();
  private readonly used = new Set<THREE.BufferGeometry>();
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

  /** Geometries used by composed parts; rejected decoration models may also be cached. */
  get size(): number {
    return this.used.size;
  }

  plan(site: TileSite, sides: readonly (SideState | undefined)[]): TilePlan {
    const coreKey = intrinsicKey(site),
      key = `${coreKey}/${boundaryKey(sides)}`;
    let layout = this.plans.get(key);
    if (!layout) {
      let core = this.interiors.get(coreKey);
      if (!core) {
        core = plan(site, [], (name, make) => this.cached(name, make));
        this.interiors.set(coreKey, core);
      }
      const pedestrian = withBoundaries(core.pedestrian, sides);
      layout = { ...core, pedestrian, walks: graphWalks(pedestrian) };
      this.plans.set(key, layout);
    }
    return layout;
  }

  /** Parts in tile-local space: the tile center at the origin, its ground at y = 0. */
  compose(site: TileSite, sides: readonly (SideState | undefined)[]): Part[] {
    const tilePlan = this.plan(site, sides);
    const layout = tilePlan.walks;
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
    const surfaceKey = `surface/${intrinsicKey(site)}/${boundaryKey(sides)}`;
    if (!this.bare.has(surfaceKey)) {
      const geometry = this.cache.get(surfaceKey) ?? surface(site, sides, tilePlan.pedestrian);
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
    const start = site.kind === 'inicio' ? site.region : null;
    const forest = site.kind === 'monte';
    site.edges.forEach((edge, side) => {
      if (edge === 'nature' && !tilePlan.homes.some((h) => h.side === side)) greens.push(side);
    });
    for (const home of tilePlan.homes) {
      if (home.y) add(this.cached('terrace', terrace), home.at.x, home.at.z, home.turn, home.scale);
      add(home.model, home.at.x, home.at.z, home.turn, home.scale, home.y);
      if (clearance(layout, home.at) > 0.62 * home.scale + (PATH_WIDTH + COPING) / 2)
        add(
          this.cached('contact/house', () => contact(0.62)),
          home.at.x,
          home.at.z,
          home.turn,
          home.scale,
          home.y,
        );
    }
    const ground: Ground = {
      q: site.q,
      r: site.r,
      kind: site.kind,
      region: site.region,
      seed: site.seed ?? 0,
    };
    const water = waterways(site);
    const props: Disc[] = [];
    const trunks: Disc[] = [];
    // A crown may lean across a side only onto a level or lower nature neighbor that is already there.
    const closed = [0, 1, 2, 3, 4, 5].map(
      (side) =>
        !(site.edges[side] === 'nature' && sides[side]?.meet === 'match' && (sides[side]?.rise ?? 0) <= 0),
    );
    const limit = forest ? HEX + 0.12 : HEX - 0.02;
    const decorate = (
      geometry: THREE.BufferGeometry,
      x: number,
      z: number,
      turn: number,
      scale = 1,
      rule: Rule = 'prop',
    ): boolean => {
      const outline = outlineOf(geometry);
      const radius = outline.radius * scale;
      const at = { x, z };
      if (pavementClearance(tilePlan.pedestrian, at) < radius + 0.02) return false;
      const placed = outline.hull.map((p) => transform(p, at, turn, scale));
      if (placed.some((p) => Math.hypot(p.x, p.z) > limit)) return false;
      for (let side = 0; side < 6; side++) {
        const n = anchor(side, 1);
        if (closed[side] && placed.some((p) => p.x * n.x + p.z * n.z > INRADIUS - 0.02)) return false;
      }
      if (rule !== 'garden' && tilePlan.homes.some((h) => footprintDistance(h.body, at, at) < radius + 0.05))
        return false;
      const wet = WATER_WIDTH / 2 + (rule === 'plant' ? BANK * 0.5 : 0) + radius * 0.6;
      if (waterDistance(water, at) < wet) return false;
      if (rule !== 'prop' && props.some((d) => distance(d, at) < (d.radius + radius) * 0.6)) return false;
      if (rule === 'detail' && trunks.some((d) => distance(d, at) < 0.16 + radius * 0.5)) return false;
      add(geometry, x, z, turn, scale);
      (rule === 'plant' ? trunks : props).push({ x, z, radius });
      return true;
    };
    const grow = (plant: Plant) => this.cached(plantKey(plant), () => plantModel(plant));
    if (start === 'cartagena') {
      const home = tilePlan.homes[0];
      if (home) {
        const toward = Math.atan2(Math.cos(home.turn), Math.sin(home.turn));
        decorate(
          this.cached(`bougainvillea/${site.variation % 4}`, () => bougainvillea(site.variation)),
          home.at.x + Math.cos(toward + 1.4) * 0.38,
          home.at.z + Math.sin(toward + 1.4) * 0.38,
          toward,
          1,
          'garden',
        );
      }
    }
    if (start === 'salento' || start === 'cartagena')
      for (const side of greens.slice(0, 2)) {
        const [x, z] = sector(side, 1.15, (rng() - 0.5) * 0.4);
        const plant: Plant = {
          kind: 'palm',
          palm: start === 'salento' ? 'wax' : 'coconut',
          variant: variantOf(site.variation),
        };
        decorate(grow(plant), x, z, rng() * 6.28);
      }
    if (start === 'bogota' && greens[0] !== undefined) {
      const [x, z, angle] = sector(greens[0], 0.95);
      decorate(this.cached('bench', bench), x, z, facing(angle + Math.PI));
    }
    if (site.kind === 'parque')
      for (const side of greens) {
        const [x, z, angle] = sector(side, 0.95);
        if (rng() < 0.35 && clearance(layout, { x, z }) > 0.5)
          decorate(this.cached('bench', bench), x, z, facing(angle + Math.PI));
      }
    if (start === 'bogota' || start === 'medellin')
      for (const walk of layout)
        for (const curve of walk.curves) {
          // Street lamps along the public path, set beside it.
          const mid = curve[Math.floor(curve.length / 3)] as Point;
          const next = curve[Math.floor(curve.length / 3) + 1] ?? mid;
          const angle = Math.atan2(next.z - mid.z, next.x - mid.x) + Math.PI / 2;
          decorate(
            this.cached('lamp', lamp),
            mid.x + Math.cos(angle) * 0.42,
            mid.z + Math.sin(angle) * 0.42,
            0,
          );
        }
    if (site.kind === 'plaza') {
      const free = [0, 1, 2, 3, 4, 5].filter((side) => site.edges[side] !== 'path');
      free.slice(0, 2).forEach((side, index) => {
        const [x, z, angle] = sector(side, 0.78);
        if (index === 0) decorate(grow(plantFor(ground, x, z, side)), x, z, rng() * 6.28, 0.9, 'plant');
        else decorate(this.cached('bench', bench), x, z, facing(angle + Math.PI));
      });
    }
    // World-lattice vegetation, kept to the tile's free nature sectors; the middle only on tiles without homes.
    const growable = (x: number, z: number) =>
      greens.includes(sectorOf(x, z)) && (Math.hypot(x, z) > 0.8 || tilePlan.homes.length === 0);
    const density = DENSITY[site.kind];
    let grown = 0;
    for (const candidate of plants(ground)) {
      if (grown >= density.cap) break;
      if (growable(candidate.x, candidate.z) && place(candidate, grow(candidate.item), 'plant')) grown++;
    }
    let covered = 0;
    for (const candidate of details(ground)) {
      if (covered >= density.detailCap) break;
      const model = this.cached(detailKey(candidate.item), () => detailModel(candidate.item));
      if (growable(candidate.x, candidate.z) && place(candidate, model, 'detail')) covered++;
    }
    function place<T>(candidate: Candidate<T>, model: THREE.BufferGeometry, rule: Rule): boolean {
      return decorate(model, candidate.x, candidate.z, candidate.turn, candidate.scale, rule);
    }
    for (const part of parts) this.used.add(part.geometry);
    return parts;
  }

  dispose(): void {
    for (const geometry of this.cache.values()) geometry.dispose();
    this.cache.clear();
    this.plans.clear();
    this.interiors.clear();
    this.bare.clear();
    this.used.clear();
  }
}
