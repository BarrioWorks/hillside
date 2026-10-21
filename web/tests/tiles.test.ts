import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  type Edge,
  type Family,
  type HandTile,
  KINDS,
  type Kind,
  REGIONS,
  type Region,
  rotateSides,
  type Tile,
} from '../src/domain';
import { center, DIRECTIONS, edgeAngle, HEX, INRADIUS, LEVEL } from '../src/render/hex';
import { Surface } from '../src/render/palette';
import {
  COPING,
  clearance,
  footprintDistance,
  PATH_WIDTH,
  type Part,
  pathEnd,
  plan,
  type SideState,
  STAIR_RUN,
  segmentsDistance,
  TileKit,
  type TilePlan,
  type TileSite,
  type Walk,
  walks,
} from '../src/render/tiles';
import { realCore, sidesOf, siteOf } from './core-fixture';

/** Measured maximum is about 11.8k triangles (homes on most sides); the budget leaves headroom. */
const TILE_TRIANGLE_BUDGET = 15300;
/** Forest crowns near an edge lean a little past the hex corners; nothing else leaves the hex. */
const FOREST_REACH = HEX + 0.15;
const reach = (where: TileSite) => (where.kind === 'monte' ? FOREST_REACH : HEX + 1e-6);
const WALKWAY_TOP = 0.045;

type Point = { x: number; z: number };
const OPEN: (SideState | undefined)[] = Array.from({ length: 6 }, () => undefined);
const LETTERS: Record<string, Edge> = { H: 'homes', P: 'path', N: 'nature', W: 'water' };

/** Unrotated templates per kind, copied from `templates()` in crates/barrio-core/src/tile.rs. */
const TEMPLATES: Record<Kind, [string, string][]> = {
  casas: [
    ['PHHPHN', '100100'],
    ['PHPHHH', '101000'],
    ['PPHHNH', '110000'],
    ['PHHHHN', '100000'],
    ['PHHPHH', '100200'],
    ['PHPHPH', '101010'],
    ['PHNPHH', '100100'],
    ['HPHHNN', '010000'],
  ],
  tienda: [
    ['PHPHHN', '101000'],
    ['PPHHNH', '110000'],
  ],
  plaza: [
    ['PPHPPH', '110110'],
    ['PNPNPN', '101010'],
    ['PHPPNP', '101101'],
  ],
  parque: [
    ['PNNPNN', '100100'],
    ['PNNNNN', '100000'],
    ['PNPNNN', '101000'],
  ],
  capilla: [['PHPNPN', '101010']],
  monte: [
    ['NNNNNN', '000000'],
    ['NNNNNP', '000001'],
    ['NNNNNH', '000000'],
  ],
  sendero: [
    ['PNNPNN', '100100'],
    ['PNPNNN', '101000'],
    ['PPNNNN', '110000'],
    ['PNNNHN', '100000'],
    ['PNNPNN', '100200'],
  ],
  quebrada: [
    ['WNNWNN', '000000'],
    ['WNWNNN', '000000'],
    ['WWNNNN', '000000'],
    ['WNNWNP', '000001'],
  ],
  inicio: [['PHHPNN', '100100']],
};
const FAMILY: Record<Kind, Family> = {
  casas: 'residential',
  tienda: 'community',
  plaza: 'community',
  parque: 'community',
  capilla: 'community',
  monte: 'nature',
  sendero: 'landscape',
  quebrada: 'water',
  inicio: 'landmark',
};

/** The entrance rule from `entrances()` in tile.rs: the nearest path edge, counterclockwise first on a tie. */
function entrances(edges: readonly Edge[], paths: readonly number[]): (number | null)[] {
  return edges.map((edge, side) => {
    if (edge !== 'homes') return null;
    for (let step = 1; step <= 3; step++)
      for (const other of [(side + step) % 6, (side + 6 - step) % 6])
        if (paths[other]) return paths[other] as number;
    return null;
  });
}
const mirror = <T>(sides: readonly T[]) => sides.map((_, side) => sides[(6 - side) % 6] as T);

function templateTiles(kind: Kind): HandTile[] {
  return (TEMPLATES[kind] ?? []).map(([letters, groups]) => {
    const edges = [...letters].map((letter) => LETTERS[letter] as Edge) as HandTile['edges'];
    const paths = [...groups].map(Number) as HandTile['paths'];
    return {
      kind,
      family: FAMILY[kind],
      edges,
      paths,
      entrances: entrances(edges, paths) as HandTile['entrances'],
    };
  });
}

/** Every orientation the deck can deal: the template and its mirror image, each turned six ways. */
function orientations(tile: HandTile): HandTile[] {
  const out: HandTile[] = [];
  for (const flipped of [tile, { ...tile, edges: mirror(tile.edges), paths: mirror(tile.paths) }])
    for (let rotation = 0; rotation < 6; rotation++) {
      const edges = rotateSides(flipped.edges, rotation) as HandTile['edges'];
      const paths = rotateSides(flipped.paths, rotation) as HandTile['paths'];
      out.push({ ...tile, edges, paths, entrances: entrances(edges, paths) as HandTile['entrances'] });
    }
  return out;
}

function site(edges: readonly Edge[], paths: readonly number[], overrides: Partial<TileSite> = {}): TileSite {
  return {
    q: 0,
    r: 0,
    kind: 'sendero',
    edges,
    paths,
    entrances: entrances(edges, paths),
    variation: 0,
    elevation: 1,
    region: 'medellin',
    ...overrides,
  };
}
/** A tile with path edges on `sides` (one group) and nature elsewhere. */
function pathTile(sides: number[], groups?: number[]): Pick<TileSite, 'edges' | 'paths'> {
  const edges = Array.from({ length: 6 }, (_, side): Edge => (sides.includes(side) ? 'path' : 'nature'));
  const paths = Array.from({ length: 6 }, (_, side) =>
    sides.includes(side) ? (groups?.[sides.indexOf(side)] ?? 1) : 0,
  );
  return { edges, paths };
}
const anchor = (side: number, distance = INRADIUS): Point => ({
  x: Math.cos(edgeAngle(side)) * distance,
  z: Math.sin(edgeAngle(side)) * distance,
});
const sideState = (side: number, state: SideState) =>
  Array.from({ length: 6 }, (_, other) => (other === side ? state : undefined));

/** Where a walk ends at `side`, and the next centerline point inward from there. */
function endAt(layout: readonly Walk[], side: number): { end: Point; inward: Point } {
  const walk = layout.find((candidate) => candidate.sides.includes(side));
  if (!walk) throw new Error(`No walk reaches side ${side}`);
  const index = walk.sides.indexOf(side);
  if (walk.sides.length === 2) {
    const curve = walk.curves[0] as Point[];
    return index === 0
      ? { end: curve[0] as Point, inward: curve[1] as Point }
      : { end: curve[curve.length - 1] as Point, inward: curve[curve.length - 2] as Point };
  }
  const curve = walk.curves[index] as Point[];
  return { end: curve[0] as Point, inward: curve[1] as Point };
}
const shift = (p: Point, by: Point): Point => ({ x: p.x + by.x, z: p.z + by.z });
const cross = (a: Point, b: Point) => a.x * b.z - a.z * b.x;
const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;
const minus = (a: Point, b: Point): Point => ({ x: a.x - b.x, z: a.z - b.z });
const unit = (a: Point): Point => {
  const length = Math.hypot(a.x, a.z);
  return { x: a.x / length, z: a.z / length };
};
/** Shortest distance between two walks' centerlines; polylines are closest at a vertex of one of them. */
function gap(a: Walk, b: Walk): number {
  const vertices = (walk: Walk) => walk.curves.flat();
  return Math.min(...vertices(a).map((p) => clearance([b], p)), ...vertices(b).map((p) => clearance([a], p)));
}
function positions(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const position = geometry.getAttribute('position');
  return Array.from({ length: position.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(position, i),
  );
}

describe('path layout inside a tile', () => {
  it('ends a path at the edge midpoint when the side is open or matches on the same level', () => {
    for (const state of [undefined, { meet: 'open', rise: 0 }, { meet: 'match', rise: 0 }] as const) {
      expect(pathEnd(state)).toBe('edge');
      const { end } = endAt(walks(pathTile([0, 3]), sideState(0, state ?? { meet: 'open', rise: 0 })), 0);
      expect(end.x).toBeCloseTo(anchor(0).x, 9);
      expect(end.z).toBeCloseTo(anchor(0).z, 9);
    }
  });

  it('connects two compatible path edges logically and visually across all six sides', () => {
    const kit = new TileKit();
    // Straight, bent, dead-end and junction walks, so every curve shape meets the seam.
    const shapes = (side: number): [string, number[]][] => [
      ['straight', [side, (side + 3) % 6]],
      ['bent', [side, (side + 2) % 6]],
      ['dead end', [side]],
      ['junction', [side, (side + 2) % 6, (side + 4) % 6]],
      ['T junction', [side, (side + 1) % 6, (side + 3) % 6]],
    ];
    /** Worst deviation per shape: centerline end tangent off the edge normal (radians), strip corner off the seam. */
    const worst = new Map<string, { angle: number; corner: number }>();
    let seams = 0;
    for (let side = 0; side < 6; side++) {
      const back = (side + 3) % 6;
      const d = DIRECTIONS[side] as { q: number; r: number };
      const a = center(0, 0),
        b = center(d.q, d.r);
      const mid = shift(a, anchor(side));
      const normal = anchor(side, 1);
      const along = { x: -normal.z, z: normal.x };
      const corners = [-1, 1].map((sign) =>
        shift(mid, { x: along.x * sign * (PATH_WIDTH / 2), z: along.z * sign * (PATH_WIDTH / 2) }),
      );
      for (const [at, from, shape] of [
        ...shapes(side).map(([name, sides]) => [a, side, [name, sides]] as const),
        ...shapes(back).map(([name, sides]) => [b, back, [name, sides]] as const),
      ]) {
        const [name, members] = shape;
        const tile = pathTile(members);
        const sides = sideState(from, { meet: 'match', rise: 0 });
        const { end, inward } = endAt(walks(tile, sides), from);
        // The centerline ends exactly on the shared edge midpoint, in world coordinates.
        const world = shift(end, at);
        expect(Math.hypot(world.x - mid.x, world.z - mid.z), `${name} side ${from}`).toBeLessThan(1e-6);
        // It leaves the edge along the edge normal.
        const direction = unit(minus(inward, end));
        expect(dot(direction, anchor(from, 1))).toBeLessThan(0);
        const angle = Math.abs(Math.asin(cross(direction, anchor(from, 1))));
        // The paved strip's top reaches both seam corners of the shared strip.
        const surface = kit.compose(site(tile.edges, tile.paths), sides)[0] as Part;
        const tops = positions(surface.geometry).filter((p) => Math.abs(p.y - WALKWAY_TOP) < 1e-4);
        const corner = Math.max(
          ...corners.map((c) => Math.min(...tops.map((p) => Math.hypot(p.x + at.x - c.x, p.z + at.z - c.z)))),
        );
        const sofar = worst.get(name) ?? { angle: 0, corner: 0 };
        worst.set(name, { angle: Math.max(sofar.angle, angle), corner: Math.max(sofar.corner, corner) });
        seams++;
      }
    }
    expect(seams).toBe(6 * 2 * 5);
    console.info('seam deviation by walk shape', JSON.stringify(Object.fromEntries(worst)));
    // Straight walks, doorstep leads and centered junctions meet their neighbor with no kink and no gap.
    for (const name of ['straight', 'dead end', 'junction']) {
      expect(worst.get(name)?.angle, name).toBeLessThan(1e-9);
      expect(worst.get(name)?.corner, name).toBeLessThan(1e-5);
    }
    // Curved walks leave square in the Bézier. Their sampled first chord leans a little, but the paved strip
    // uses the true edge normal at the seam, so its corners still meet the neighbor's exactly.
    for (const name of ['bent', 'T junction']) {
      expect(worst.get(name)?.angle, name).toBeLessThan(0.05);
      expect(worst.get(name)?.corner, name).toBeLessThan(1e-5);
    }
    kit.dispose();
  });

  it.each([[0], [0, 3], [0, 1], [0, 2, 4], [0, 1, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5]])(
    'reaches every midpoint and hub without gaps (case %#)',
    (...members) => {
      const layout = walks(pathTile(members), OPEN);
      for (const side of members) {
        const { end } = endAt(layout, side);
        expect(Math.hypot(end.x - anchor(side).x, end.z - anchor(side).z)).toBeLessThan(1e-9);
      }
      for (const walk of layout)
        if (walk.hub)
          for (const curve of walk.curves) {
            const end = curve.at(-1) as Point;
            expect(Math.hypot(end.x - walk.hub.x, end.z - walk.hub.z)).toBeLessThanOrEqual(
              0.4 - PATH_WIDTH / 2,
            );
          }
    },
  );

  it('meets a neighbor straight on: both end tangents collinear through the seam', () => {
    for (let side = 0; side < 6; side++) {
      const back = (side + 3) % 6;
      const d = DIRECTIONS[side] as { q: number; r: number };
      const a = center(0, 0),
        b = center(d.q, d.r);
      const fromA = endAt(walks(pathTile([side, back]), sideState(side, { meet: 'match', rise: 0 })), side);
      const fromB = endAt(walks(pathTile([back]), sideState(back, { meet: 'match', rise: 0 })), back);
      const endA = shift(fromA.end, a),
        endB = shift(fromB.end, b);
      expect(Math.hypot(endA.x - endB.x, endA.z - endB.z)).toBeLessThan(1e-6);
      const inA = unit(minus(shift(fromA.inward, a), endA)),
        inB = unit(minus(shift(fromB.inward, b), endB));
      expect(Math.abs(cross(inA, inB))).toBeLessThan(1e-9);
      expect(dot(inA, inB)).toBeCloseTo(-1, 9);
    }
  });

  it('turns connectivity with the tile when it rotates', () => {
    // A bent walk between sides 0 and 2, beside a separate dead-end on side 4.
    const base = {
      edges: ['path', 'homes', 'path', 'nature', 'path', 'nature'] as Edge[],
      paths: [1, 0, 1, 0, 2, 0],
    };
    for (let rotation = 0; rotation < 6; rotation++) {
      const turned = { edges: rotateSides(base.edges, rotation), paths: rotateSides(base.paths, rotation) };
      const layout = walks(turned, OPEN);
      const bySide = (group: number) => layout.find((walk) => walk.group === group)?.sides;
      expect(bySide(1)).toEqual([rotation % 6, (2 + rotation) % 6].sort((x, y) => x - y));
      expect(bySide(2)).toEqual([(4 + rotation) % 6]);
      // A neighbor's path across side 0 joins the bent walk only when the walk faces it.
      const reaches = layout.some((walk) => walk.group === 1 && walk.sides.includes(0));
      expect(reaches, `rotation ${rotation}`).toBe(rotation === 0 || rotation === 4);
      // Each end turns with the tile: 60° per sixth-turn about the center.
      const turnedEnd = endAt(layout, (2 + rotation) % 6).end;
      expect(turnedEnd.x).toBeCloseTo(anchor((2 + rotation) % 6).x, 9);
      expect(turnedEnd.z).toBeCloseTo(anchor((2 + rotation) % 6).z, 9);
    }
  });

  it('keeps disconnected path anchors inside one tile disconnected', () => {
    const layout = walks(pathTile([0, 3], [1, 2]), OPEN);
    expect(layout).toHaveLength(2);
    expect(layout.map((walk) => walk.sides)).toEqual([[0], [3]]);
    expect(gap(layout[0] as Walk, layout[1] as Walk)).toBeGreaterThanOrEqual(PATH_WIDTH);
    // Every template with separate walks keeps them a full path width apart, in every orientation.
    for (const kind of KINDS)
      for (const template of templateTiles(kind))
        for (const tile of orientations(template)) {
          const parts = walks(tile, OPEN);
          for (let i = 0; i < parts.length; i++)
            for (let j = i + 1; j < parts.length; j++)
              expect(
                gap(parts[i] as Walk, parts[j] as Walk),
                `${kind} ${tile.edges.join()}`,
              ).toBeGreaterThanOrEqual(PATH_WIDTH);
        }
  });

  it('ends at stairs one terrace up, short of a cliff, and at a dead end against other edges', () => {
    const tile = pathTile([0, 3]);
    const distanceAt = (state: SideState) => {
      const { end } = endAt(walks(tile, sideState(0, state)), 0);
      // Still on the edge normal, only shorter.
      expect(Math.abs(cross(end, anchor(0, 1)))).toBeLessThan(1e-9);
      return Math.hypot(end.x, end.z);
    };
    expect(pathEnd({ meet: 'match', rise: 1 })).toBe('stairs');
    expect(distanceAt({ meet: 'match', rise: 1 })).toBeCloseTo(INRADIUS - STAIR_RUN, 9);
    // The upper tile's walk runs to the edge, where the stairs arrive.
    expect(pathEnd({ meet: 'match', rise: -1 })).toBe('edge');
    expect(pathEnd({ meet: 'steep', rise: 2 })).toBe('cliff');
    expect(pathEnd({ meet: 'steep', rise: -2 })).toBe('cliff');
    expect(distanceAt({ meet: 'steep', rise: 2 })).toBeLessThan(INRADIUS - 0.3);
    expect(pathEnd({ meet: 'differ', rise: 0 })).toBe('deadEnd');
    expect(distanceAt({ meet: 'differ', rise: 0 })).toBeLessThan(INRADIUS - 0.3);
    // The stair flight climbs a whole terrace by the edge.
    const kit = new TileKit();
    const surface = (state: SideState) =>
      (kit.compose(site(tile.edges, tile.paths), sideState(0, state))[0] as Part).geometry;
    const box = (geometry: THREE.BufferGeometry) =>
      new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute);
    expect(box(surface({ meet: 'match', rise: 1 })).max.y).toBeGreaterThanOrEqual(LEVEL);
    expect(box(surface({ meet: 'match', rise: 0 })).max.y).toBeLessThan(LEVEL / 2);
    // Nothing paved reaches the edge across a cliff or a dead end; a level match paves right up to it.
    const normal = anchor(0, 1);
    const pavedAtEdge = (state: SideState) =>
      positions(surface(state)).some(
        (p) =>
          dot({ x: p.x, z: p.z }, normal) > INRADIUS - 0.2 &&
          Math.abs(cross(normal, { x: p.x, z: p.z })) < PATH_WIDTH,
      );
    expect(pavedAtEdge({ meet: 'match', rise: 0 })).toBe(true);
    expect(pavedAtEdge({ meet: 'steep', rise: 2 })).toBe(false);
    expect(pavedAtEdge({ meet: 'steep', rise: -2 })).toBe(false);
    expect(pavedAtEdge({ meet: 'differ', rise: 0 })).toBe(false);
    kit.dispose();
  });
});

/** HandTiles the real core deals, gathered by playing whole runs. */
function dealt(seeds: number[]): HandTile[] {
  const seen = new Map<string, HandTile>();
  for (const seed of seeds) {
    const core = realCore(seed);
    for (
      let snapshot = core.snapshot();
      snapshot.current;
      snapshot = core.command({ type: 'autoplay', count: 1 }).snapshot
    )
      for (const tile of [snapshot.current, ...snapshot.upcoming])
        seen.set(`${tile.kind}/${tile.edges.join()}/${tile.paths.join()}`, tile);
  }
  return [...seen.values()];
}

const modelCache = new Map<string, THREE.BufferGeometry>();
const cachedModel = (key: string, make: () => THREE.BufferGeometry) => {
  let model = modelCache.get(key);
  if (!model) {
    model = make();
    modelCache.set(key, model);
  }
  return model;
};
function checkHomes(layout: TilePlan, label: string) {
  for (const home of layout.homes) {
    expect(home.model.userData.door, label).toBeDefined();
    for (const walk of layout.walks)
      if (walk.hub)
        expect(footprintDistance(home.footprint, walk.hub, walk.hub), label).toBeGreaterThanOrEqual(
          0.46 - 1e-8,
        );
    for (const walk of layout.walks)
      for (const curve of walk.curves)
        for (let i = 1; i < curve.length; i++)
          expect(
            footprintDistance(home.footprint, curve[i - 1] as Point, curve[i] as Point),
            label,
          ).toBeGreaterThanOrEqual((PATH_WIDTH + COPING) / 2 + 0.02 - 1e-8);
    for (const other of layout.homes)
      if (other !== home)
        for (let i = 0; i < home.footprint.length; i++)
          expect(
            footprintDistance(
              other.footprint,
              home.footprint[i] as Point,
              home.footprint[(i + 1) % 4] as Point,
            ),
            label,
          ).toBeGreaterThanOrEqual(0.02 - 1e-8);
    if (!home.connected) {
      expect(home.access, label).toBeNull();
      continue;
    }
    expect(home.access, label).not.toBeNull();
    const a = home.access?.[0] as Point,
      b = home.access?.at(-1) as Point;
    expect(Math.hypot(a.x - home.door.x, a.z - home.door.z), label).toBeLessThanOrEqual(0.03);
    const walk = layout.walks.find((w) => w.group === home.group) as Walk;
    expect(clearance([walk], b), label).toBeLessThanOrEqual(1e-6);
    for (const other of layout.homes) {
      if (other === home) {
        expect(footprintDistance(other.footprint, a, b), label).toBeGreaterThan(0);
      } else expect(footprintDistance(other.footprint, a, b), label).toBeGreaterThanOrEqual(0.12);
    }
    for (const other of layout.walks)
      if (other !== walk)
        for (const curve of other.curves)
          for (let i = 1; i < curve.length; i++)
            expect(
              segmentsDistance(a, b, curve[i - 1] as Point, curve[i] as Point),
              label,
            ).toBeGreaterThanOrEqual(PATH_WIDTH / 2 + 0.12);
  }
}

describe('buildings and walkways', () => {
  const fromCore = dealt([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  it('deals only template tiles, with the entrances the template rule gives', () => {
    const known = new Set(
      KINDS.flatMap((kind) => templateTiles(kind).flatMap(orientations)).map((tile) => JSON.stringify(tile)),
    );
    expect(fromCore.length).toBeGreaterThan(20);
    for (const tile of fromCore) {
      expect(tile.entrances).toEqual(entrances(tile.edges, tile.paths));
      // Recovery tiles (a lone spring, a meadow) are the only ones outside the templates.
      if (!known.has(JSON.stringify(tile)))
        expect([...tile.edges].sort().join(), JSON.stringify(tile)).toMatch(/^(nature,)*(nature|water)$/);
    }
  });

  it('keeps house footprints and door access clear across templates, regions and contexts', () => {
    const tiles = [
      ...fromCore,
      ...(['casas', 'tienda', 'plaza', 'parque', 'capilla', 'inicio'] as const).flatMap((kind) =>
        templateTiles(kind).flatMap(orientations),
      ),
    ].filter((tile) => tile.edges.includes('homes') || tile.kind === 'capilla');
    const contexts: [string, (SideState | undefined)[]][] = [
      ['open', OPEN],
      ['level', Array.from({ length: 6 }, () => ({ meet: 'match', rise: 0 }) as const)],
      ['stairs', Array.from({ length: 6 }, () => ({ meet: 'match', rise: 1 }) as const)],
      ['dead ends', Array.from({ length: 6 }, () => ({ meet: 'differ', rise: 0 }) as const)],
      ['cliffs', Array.from({ length: 6 }, () => ({ meet: 'steep', rise: 2 }) as const)],
    ];
    let buildings = 0;
    for (const tile of tiles)
      for (const region of REGIONS)
        for (const variation of [0, 7])
          for (const [label, sides] of contexts) {
            const where: TileSite = {
              ...site(tile.edges, tile.paths, { kind: tile.kind, variation, region }),
              entrances: tile.entrances,
            };
            const layout = plan(where, sides, cachedModel);
            checkHomes(layout, `${tile.kind} ${tile.edges.join()} ${region} ${label}`);
            buildings += layout.homes.length;
          }
    expect(buildings).toBeGreaterThan(1000);
  }, 30000);
});

/** Real placed tiles of every kind, with the sides they actually meet. */
function placedTiles(): { tile: Tile; region: Region; sides: SideState[] }[] {
  const out: { tile: Tile; region: Region; sides: SideState[] }[] = [];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { tiles, region } = realCore(seed).command({ type: 'autoplay', count: 30 }).snapshot;
    for (const tile of tiles) out.push({ tile, region, sides: sidesOf(tile, tiles) });
  }
  return out;
}

/** Synthetic contexts: alone, ringed by level matches, by stairs up and down, by cliffs, and by dead ends. */
function contexts(): [string, (SideState | undefined)[]][] {
  const ring = (state: SideState) => Array.from({ length: 6 }, () => state);
  return [
    ['alone', OPEN],
    ['level', ring({ meet: 'match', rise: 0 })],
    ['stairs up', ring({ meet: 'match', rise: 1 })],
    ['stairs down', ring({ meet: 'match', rise: -1 })],
    ['cliffs', ring({ meet: 'steep', rise: 2 })],
    ['dead ends', ring({ meet: 'differ', rise: 0 })],
  ];
}

function worldBounds(part: Part): { box: THREE.Box3; radius: number } {
  const box = new THREE.Box3();
  let radius = 0;
  for (const v of positions(part.geometry)) {
    v.applyMatrix4(part.matrix);
    box.expandByPoint(v);
    radius = Math.max(radius, Math.hypot(v.x, v.z));
  }
  return { box, radius };
}
const triangleCount = (geometry: THREE.BufferGeometry) =>
  (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
const tileTriangles = (parts: Part[]) => parts.reduce((sum, part) => sum + triangleCount(part.geometry), 0);

describe('tile composition', () => {
  const kit = new TileKit();
  const placed = placedTiles();
  const samples = KINDS.map((kind) => ({ kind, tile: templateTiles(kind)[0] as HandTile }));

  it('composes every kind, variation and context with finite parts inside its hex and above ground', () => {
    const cases: [string, TileSite, (SideState | undefined)[]][] = placed.map(({ tile, region, sides }) => [
      `${tile.kind} at ${tile.q},${tile.r}`,
      siteOf(tile, region),
      sides,
    ]);
    for (const { kind, tile } of samples)
      for (const region of REGIONS)
        for (const variation of [0, 1, 5, 15])
          for (const [label, sides] of contexts())
            cases.push([
              `${kind}/${region}/${variation}/${label}`,
              { ...site(tile.edges, tile.paths, { kind, variation, region }), entrances: tile.entrances },
              sides,
            ]);
    const worst = { radius: 0, low: 0 };
    for (const [label, where, sides] of cases) {
      const parts = kit.compose(where, sides);
      for (const part of parts) {
        const position = part.geometry.getAttribute('position');
        expect(position.count, label).toBeGreaterThan(0);
        expect(Array.from(position.array).every(Number.isFinite), label).toBe(true);
        expect(part.geometry.getAttribute('color')?.count, label).toBe(position.count);
        expect(part.geometry.getAttribute('surface')?.count, label).toBe(position.count);
        const { box, radius } = worldBounds(part);
        worst.radius = Math.max(worst.radius, radius);
        worst.low = Math.min(worst.low, box.min.y);
        expect(radius, label).toBeLessThanOrEqual(reach(where));
        // Only a cascade drops below the ground, down to the lower neighbor it flows into.
        const drop = Math.min(0, ...sides.map((side) => (side?.meet === 'match' ? side.rise : 0))) * LEVEL;
        expect(box.min.y, label).toBeGreaterThanOrEqual(drop - 0.05);
      }
    }
    console.info('tile part extent', JSON.stringify({ cases: cases.length, ...worst }));
  }, 30000);

  it('shares cached geometry between identical tiles', () => {
    const { tile, region, sides } = placed.find(
      ({ tile }) => tile.kind === 'casas',
    ) as (typeof placed)[number];
    const first = kit.compose(siteOf(tile, region), sides);
    const size = kit.size;
    const second = kit.compose({ ...siteOf(tile, region) }, [...sides]);
    for (const [index, part] of second.entries()) expect(part.geometry).toBe(first[index]?.geometry);
    expect(kit.size).toBe(size);
  });

  it('produces identical path geometry for the same site from two kits', () => {
    const one = new TileKit(),
      two = new TileKit();
    const same = (a: THREE.BufferGeometry, b: THREE.BufferGeometry) => {
      const x = a.getAttribute('position').array,
        y = b.getAttribute('position').array;
      return x.length === y.length && x.every((value, i) => value === y[i]);
    };
    const cases: [TileSite, (SideState | undefined)[]][] = placed
      .filter(({ tile }) => tile.edges.includes('path'))
      .slice(0, 16)
      .map(({ tile, region, sides }) => [siteOf(tile, region), sides]);
    const curved = pathTile([0, 2, 4]);
    for (const [, sides] of contexts()) cases.push([site(curved.edges, curved.paths), sides]);
    for (const [where, sides] of cases) {
      const a = one.compose(where, sides),
        b = two.compose({ ...where }, [...sides]);
      expect(b).toHaveLength(a.length);
      const surfaceA = a[0] as Part,
        surfaceB = b[0] as Part;
      expect(surfaceB.geometry).not.toBe(surfaceA.geometry);
      expect(same(surfaceA.geometry, surfaceB.geometry), `${where.kind} ${where.edges.join()}`).toBe(true);
      for (const [index, part] of a.entries())
        expect(b[index]?.matrix.elements).toEqual(part.matrix.elements);
      expect(walks(where, sides)).toEqual(walks({ ...where }, [...sides]));
    }
    one.dispose();
    two.dispose();
  });

  it(`keeps every composed tile within ${TILE_TRIANGLE_BUDGET} triangles`, () => {
    const report: Partial<Record<Kind, number>> = {};
    const note = (kind: Kind, parts: Part[]) => {
      report[kind] = Math.max(report[kind] ?? 0, tileTriangles(parts));
    };
    for (const { tile, region, sides } of placed) note(tile.kind, kit.compose(siteOf(tile, region), sides));
    for (const kind of KINDS)
      for (const tile of templateTiles(kind))
        for (const region of REGIONS)
          for (let variation = 0; variation < 16; variation += 3)
            for (const [, sides] of contexts())
              note(
                kind,
                kit.compose(
                  { ...site(tile.edges, tile.paths, { kind, variation, region }), entrances: tile.entrances },
                  sides,
                ),
              );
    console.info('max triangles per composed tile', JSON.stringify(report));
    for (const kind of KINDS) expect(report[kind], kind).toBeLessThanOrEqual(TILE_TRIANGLE_BUDGET);
  });
});

describe('real core path geometry', () => {
  const runs = Array.from(
    { length: 10 },
    (_, i) => realCore(i + 1).command({ type: 'autoplay', count: 40 }).snapshot,
  );
  it('keeps real house footprints, doors and access clear and reports disconnected homes', () => {
    let connected = 0,
      disconnected = 0;
    for (const { tiles, region } of runs)
      for (const tile of tiles) {
        const layout = plan(siteOf(tile, region), sidesOf(tile, tiles), cachedModel);
        checkHomes(layout, `${tile.q},${tile.r} ${tile.kind}`);
        expect(layout.homes.filter((h) => tile.edges[h.side] === 'homes')).toHaveLength(
          tile.edges.filter((e) => e === 'homes').length,
        );
        for (const home of layout.homes) {
          expect(home.connected).toBe(tile.entrances[home.side] !== null);
          if (home.connected) connected++;
          else disconnected++;
        }
      }
    expect(connected).toBeGreaterThan(0);
    expect(disconnected).toBeGreaterThan(0);
  }, 30000);

  it('keeps ground-floor vertices, tree crowns and every decoration clear of walks and access', () => {
    const kit = new TileKit();
    let houses = 0,
      housesInside = 0,
      trees = 0,
      treesOver = 0,
      decorations = 0;
    for (const { tiles, region } of runs)
      for (const tile of tiles) {
        const where = siteOf(tile, region),
          sides = sidesOf(tile, tiles);
        const layout = plan(where, sides, cachedModel);
        for (const part of kit.compose(where, sides)) {
          const cache = (kit as unknown as { cache: Map<string, THREE.BufferGeometry> }).cache;
          const name = [...cache].find(([, g]) => g === part.geometry)?.[0] ?? '';
          const house = /^(building|finca|casona|chapel)\//.test(name);
          const decoration = /^(tree|shrub|palm|bench|lamp|rock|bougainvillea)(\/|$)/.test(name);
          if (!house && !decoration) continue;
          let overlaps = false;
          const p = part.geometry.getAttribute('position');
          for (let i = 0; i < p.count; i++) {
            const local = new THREE.Vector3().fromBufferAttribute(p, i);
            if (house && local.y > 0.1) continue;
            const v = local.applyMatrix4(part.matrix);
            const crown = v.y > 0.5;
            const room = clearance(layout.walks, v);
            if (room < PATH_WIDTH / 2 - 1e-6 && (house || crown)) overlaps = true;
            if (decoration) {
              expect(room, name).toBeGreaterThanOrEqual((PATH_WIDTH + COPING) / 2);
              for (const home of layout.homes)
                if (home.access)
                  expect(
                    segmentsDistance(v, v, home.access[0] as Point, home.access[1] as Point),
                    name,
                  ).toBeGreaterThanOrEqual(0.12);
            }
          }
          if (house) {
            houses++;
            if (overlaps) housesInside++;
          }
          if (name.startsWith('tree/')) {
            trees++;
            if (overlaps) treesOver++;
          }
          if (decoration) decorations++;
        }
      }
    console.info(
      'path occlusion seeds 1..10 autoplay 40',
      JSON.stringify({ houses, housesInside, trees, treesOver, decorations }),
    );
    expect(housesInside).toBe(0);
    expect(treesOver).toBe(0);
    expect(decorations).toBeGreaterThan(0);
    kit.dispose();
  }, 30000);

  it('matches Rust groups and network ids and joins actual ribbon and stair vertices across every Match seam', () => {
    const kit = new TileKit();
    let seams = 0,
      stairs = 0;
    for (const { tiles, region } of runs)
      for (const tile of tiles) {
        const layout = walks(tile, sidesOf(tile, tiles));
        for (const walk of layout) {
          const first = walk.sides[0] as number;
          expect(walk.sides).toEqual(
            tile.edges.flatMap((edge, side) =>
              edge === 'path' &&
              tile.paths[side] === walk.group &&
              tile.networks[side] === tile.networks[first]
                ? [side]
                : [],
            ),
          );
        }
        for (const [side, d] of DIRECTIONS.entries()) {
          if (tile.edges[side] !== 'path' || tile.meets[side] !== 'match') continue;
          const other = tiles.find((t) => t.q === tile.q + d.q && t.r === tile.r + d.r);
          if (other?.edges[(side + 3) % 6] !== 'path') continue;
          expect(tile.networks[side]).toBe(other.networks[(side + 3) % 6]);
          if (tile.elevation > other.elevation) continue;
          const at = center(tile.q, tile.r),
            mid = shift(at, anchor(side)),
            normal = anchor(side, 1);
          const height = Math.max(tile.elevation, other.elevation) * LEVEL + WALKWAY_TOP;
          const ends = (owner: Tile) => {
            const c = center(owner.q, owner.r);
            const found: Point[] = [];
            for (const part of kit.compose(siteOf(owner, region), sidesOf(owner, tiles))) {
              const p = part.geometry.getAttribute('position'),
                surface = part.geometry.getAttribute('surface');
              for (let i = 0; i < p.count; i++) {
                if (surface.getX(i) !== Surface.paving && surface.getX(i) !== Surface.concrete) continue;
                const v = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(part.matrix);
                v.x += c.x;
                v.z += c.z;
                v.y += owner.elevation * LEVEL;
                if (Math.abs(v.y - height) > 0.001) continue;
                const delta = minus(v, mid);
                if (
                  Math.abs(dot(delta, normal)) > 0.001 ||
                  Math.abs(cross(normal, delta)) > PATH_WIDTH / 2 + 0.001
                )
                  continue;
                if (!found.some((q) => Math.hypot(q.x - v.x, q.z - v.z) < 1e-5))
                  found.push({ x: v.x, z: v.z });
              }
            }
            return found;
          };
          const a = ends(tile),
            b = ends(other);
          expect(a.length, `lower ${tile.q},${tile.r}/${side}`).toBeGreaterThanOrEqual(2);
          expect(b.length).toBeGreaterThanOrEqual(2);
          for (const p of a)
            expect(Math.min(...b.map((q) => Math.hypot(p.x - q.x, p.z - q.z)))).toBeLessThan(1e-3);
          const width = (points: Point[]) =>
            Math.max(...points.map((p) => cross(normal, minus(p, mid)))) -
            Math.min(...points.map((p) => cross(normal, minus(p, mid))));
          expect(width(a)).toBeCloseTo(PATH_WIDTH, 3);
          expect(width(b)).toBeCloseTo(width(a), 3);
          seams++;
          if (tile.elevation < other.elevation) stairs++;
        }
      }
    expect(seams).toBeGreaterThan(0);
    expect(stairs).toBeGreaterThan(0);
    kit.dispose();
  }, 30000);
});
