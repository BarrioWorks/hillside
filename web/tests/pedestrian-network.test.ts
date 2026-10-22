import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import scenes from '../../docs/verification/pedestrian/scenes.json';
import { snapshotSchema } from '../src/domain';
import { Builder } from '../src/render/builder';
import { center, DIRECTIONS, INRADIUS, LEVEL } from '../src/render/hex';
import { Surface } from '../src/render/palette';
import {
  edgePoints,
  type PathGraph,
  PedestrianPlanner,
  pave,
  pavement,
  WIDTH,
} from '../src/render/pedestrian';
import { type Part, plan, TileKit, type TileSite } from '../src/render/tiles';
import { realCore, sidesOf, siteOf } from './core-fixture';

const fixtures = scenes.map((scene) => ({
  name: scene.name,
  snapshot: snapshotSchema.parse(scene.snapshot),
}));
const open = Array.from({ length: 6 }, () => ({ meet: 'open', rise: 0 }) as const);
const bare: TileSite = {
  q: 0,
  r: 0,
  seed: 7,
  kind: 'sendero',
  region: 'medellin',
  variation: 0,
  elevation: 0,
  edges: ['path', 'nature', 'nature', 'path', 'nature', 'nature'],
  paths: [1, 0, 0, 1, 0, 0],
  entrances: [null, null, null, null, null, null],
};
const area = (polygons: MultiPolygon): number =>
  polygons.reduce(
    (sum, polygon) =>
      sum +
      polygon.reduce((sum, ring, i) => {
        let area = 0;
        for (let j = 1; j < ring.length; j++) {
          const a = ring[j - 1],
            b = ring[j];
          if (a && b) area += a[0] * b[1] - a[1] * b[0];
        }
        return sum + Math.abs(area / 2) * (i ? -1 : 1);
      }, 0),
    0,
  );

type TopTriangle = { height: number; polygon: Polygon };
function topPaving(parts: readonly Part[]): TopTriangle[] {
  const triangles: TopTriangle[] = [];
  for (const { geometry, matrix } of parts) {
    const p = geometry.getAttribute('position');
    const surfaces = geometry.getAttribute('surface');
    const normals = geometry.getAttribute('normal');
    for (let i = 0; i < (geometry.index?.count ?? p.count); i += 3) {
      const ids = [0, 1, 2].map((j) => geometry.index?.getX(i + j) ?? i + j);
      if (!ids.every((id) => surfaces.getX(id) === Surface.paving && normals.getY(id) > 0.9)) continue;
      const points = ids.map((id) => new THREE.Vector3().fromBufferAttribute(p, id).applyMatrix4(matrix));
      const first = points[0];
      if (!first) throw new Error('Missing triangle vertex');
      const ring = points.map((v): [number, number] => [v.x, v.z]);
      ring.push([first.x, first.z]);
      triangles.push({ height: first.y, polygon: [ring] });
    }
  }
  return triangles;
}

function projectedOverlap(triangles: readonly TopTriangle[]): number {
  const [first, ...rest] = triangles;
  if (!first) return 0;
  return (
    triangles.reduce((sum, triangle) => sum + area([triangle.polygon]), 0) -
    area(polygonClipping.union(first.polygon, ...rest.map((triangle) => triangle.polygon)))
  );
}

function uncoveredRoutes(graph: PathGraph, triangles: readonly TopTriangle[]) {
  const missing: { edge: string; height: number; area: number }[] = [];
  for (const edge of graph.edges) {
    const from = graph.nodes.find((n) => n.id === edge.from)?.at;
    const to = graph.nodes.find((n) => n.id === edge.to)?.at;
    if (!from || !to) throw new Error('Missing graph endpoint');
    const traversal = edge.traversal;
    const ascending = traversal.kind === 'level' || traversal.toHeight > traversal.fromHeight;
    const a = ascending ? from : to;
    const b = ascending ? to : from;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / length;
    const dz = (b.z - a.z) / length;
    const steps = traversal.kind === 'stairs' ? traversal.steps : 1;
    for (let step = 0; step < steps; step++) {
      const height =
        0.045 +
        (traversal.kind === 'level'
          ? traversal.height
          : Math.min(traversal.fromHeight, traversal.toHeight) +
            (Math.abs(traversal.toHeight - traversal.fromHeight) * (step + 1)) / steps);
      const inset = 0.00002;
      const half = edge.width / 2 - inset;
      const start = (length * step) / steps + inset;
      const end = (length * (step + 1)) / steps - inset;
      if (end <= start) continue;
      const ring: [number, number][] = [
        [start, -half],
        [end, -half],
        [end, half],
        [start, half],
      ].map(([along = 0, across = 0]) => [a.x + dx * along - dz * across, a.z + dz * along + dx * across]);
      const first = ring[0];
      if (!first) throw new Error('Missing route corner');
      ring.push(first);
      const covering = triangles.filter((t) => Math.abs(t.height - height) < 1e-5).map((t) => t.polygon);
      const uncovered = area(polygonClipping.difference([ring], ...covering));
      if (uncovered > 1e-8) missing.push({ edge: edge.id, height, area: uncovered });
    }
  }
  return missing;
}

function reachable(graph: PathGraph, start: string): Set<string> {
  const seen = new Set<string>(),
    queue = [start];
  for (const id of queue) {
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of graph.edges) {
      if (edge.from === id) queue.push(edge.to);
      else if (edge.to === id) queue.push(edge.from);
    }
  }
  return seen;
}

describe('pedestrian spatial graph', () => {
  it('keeps quantized pavement on the exact hex boundary', () => {
    const fixture = fixtures.find((f) => f.name.startsWith('B-'));
    const tile = fixture?.snapshot.tiles[0];
    if (!fixture || !tile) throw new Error('Missing five-house fixture');
    const graph = plan(
      { ...tile, seed: fixture.snapshot.seed, region: fixture.snapshot.region },
      open,
    ).pedestrian;
    const builder = new Builder(false);
    pave(builder, graph);
    const geometry = builder.finish();
    const p = geometry.getAttribute('position');
    const surfaces = geometry.getAttribute('surface');
    const normals = geometry.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      if (surfaces.getX(i) !== Surface.paving || normals.getY(i) < 0.9) continue;
      for (let side = 0; side < 6; side++) {
        const angle = ((30 + side * 60) * Math.PI) / 180;
        expect(p.getX(i) * Math.cos(angle) + p.getZ(i) * Math.sin(angle)).toBeLessThanOrEqual(
          INRADIUS + 1e-7,
        );
      }
    }
    geometry.dispose();
  });

  it('routes around a full-width water obstacle with explicit angular junctions', () => {
    const obstacle = [
      { x: -0.3, z: -0.3 },
      { x: 0.3, z: -0.3 },
      { x: 0.3, z: 0.3 },
      { x: -0.3, z: 0.3 },
    ];
    const graph = new PedestrianPlanner(bare, [{ kind: 'bank', polygon: obstacle }]).finish(open);
    expect(graph.failures).toEqual([]);
    expect(graph.edges.filter((e) => e.interior).length).toBeGreaterThan(1);
    const builder = new Builder(false);
    pave(builder, graph);
    const geometry = builder.finish();
    const triangles = topPaving([{ geometry, matrix: new THREE.Matrix4() }]);
    expect(uncoveredRoutes(graph, triangles)).toEqual([]);
    const blocked: Polygon = [obstacle.map((p): [number, number] => [p.x, p.z])];
    for (const triangle of triangles)
      expect(area(polygonClipping.intersection(triangle.polygon, blocked))).toBeLessThan(1e-9);
    geometry.dispose();
    const ports = graph.nodes.filter((n) => n.kind === 'crossing');
    const first = ports[0];
    if (!first) throw new Error('Missing obstacle fixture crossing');
    for (const node of ports) expect(reachable(graph, first.id).has(node.id)).toBe(true);
  });

  it('keeps an unserved open reservation unpaved and adds only its landing when joined', () => {
    const site: TileSite = {
      ...bare,
      edges: ['path', 'nature', 'nature', 'nature', 'nature', 'nature'],
      paths: [1, 0, 0, 0, 0, 0],
    };
    const unused = plan(site, open).pedestrian;
    expect(unused.boundaries).toHaveLength(1);
    expect(unused.edges).toEqual([]);
    expect(pavement(unused)).toEqual([]);
    const joined = plan(site, [{ meet: 'match', rise: 0 }, ...open.slice(1)]).pedestrian;
    expect(joined.edges).toHaveLength(1);
    expect(joined.edges[0]?.purpose.kind).toBe('boundary');
    for (const node of joined.nodes)
      expect(Math.hypot(node.at.x, node.at.z)).toBeGreaterThanOrEqual(INRADIUS - 0.8 - 1e-9);
  });

  it.each(fixtures)('connects real front anchors and declared crossings in $name', ({ snapshot }) => {
    const kit = new TileKit();
    for (const tile of snapshot.tiles) {
      const site = { ...tile, seed: snapshot.seed, region: snapshot.region };
      const layout = kit.plan(site, sidesOf(tile, snapshot.tiles)),
        graph = layout.pedestrian;
      expect(
        graph.failures.filter((f) => f.group !== null),
        `${tile.q},${tile.r}`,
      ).toEqual([]);
      for (const edge of graph.edges) {
        expect(graph.adjacency[edge.from]).toContain(edge.id);
        expect(graph.adjacency[edge.to]).toContain(edge.id);
        const from = graph.nodes.find((n) => n.id === edge.from),
          to = graph.nodes.find((n) => n.id === edge.to);
        expect(from?.group).toBe(edge.group);
        expect(to?.group).toBe(edge.group);
        expect(edge.width).toBe(WIDTH[edge.class]);
        expect(edge.purpose.kind).toBeTruthy();
        if (edge.class === 'secondary') {
          expect(edge.purpose.kind).toBe('entrances');
          if (edge.purpose.kind === 'entrances') expect(edge.purpose.doors.length).toBeGreaterThanOrEqual(2);
        }
      }
      for (const node of graph.nodes) {
        const degree = graph.adjacency[node.id]?.length ?? 0;
        if (degree === 1) expect(['crossing', 'door', 'destination']).toContain(node.kind);
        if (node.kind === 'destination') {
          const connected = reachable(graph, node.id);
          expect(graph.nodes.some((n) => n.kind === 'crossing' && connected.has(n.id))).toBe(true);
        }
      }
      for (const home of layout.homes) {
        const door = graph.nodes.find((n) => n.kind === 'door' && n.side === home.side);
        if (!door) throw new Error('Missing physical door node');
        expect(door.at).toEqual(home.door);
        if (home.group === null) {
          expect(home.connected).toBe(false);
          expect(graph.adjacency[door.id]).toEqual([]);
          expect(graph.failures.some((f) => f.side === home.side && f.group === null)).toBe(true);
          continue;
        }
        const reached = reachable(graph, door.id);
        for (const crossing of graph.nodes.filter((n) => n.kind === 'crossing' && n.group === home.group))
          expect(reached.has(crossing.id)).toBe(true);
        const exitEdge = graph.edges.find((e) => e.from === door.id || e.to === door.id);
        if (!exitEdge) throw new Error('Missing door exit');
        const [a, b] = edgePoints(graph, exitEdge),
          d = { x: b.x - a.x, z: b.z - a.z };
        expect(Math.hypot(d.x, d.z)).toBeGreaterThanOrEqual(0.16);
        expect(
          (d.x * home.doorAnchor.heading.x + d.z * home.doorAnchor.heading.z) / Math.hypot(d.x, d.z),
        ).toBeCloseTo(1, 8);
        if (home.y > 0.08) expect(exitEdge.traversal.kind).toBe('stairs');
      }
      const sheets = pavement(graph);
      for (let i = 0; i < sheets.length; i++) {
        const a = sheets[i];
        if (!a) continue;
        if (a.paving.length && a.coping.length)
          expect(area(polygonClipping.intersection(a.paving, a.coping))).toBeLessThan(1e-7);
        for (const b of sheets.slice(i + 1))
          if (a.paving.length && b.paving.length)
            expect(area(polygonClipping.intersection(a.paving, b.paving))).toBeLessThan(1e-7);
      }
    }
    kit.dispose();
  });

  it('keeps intrinsic routes, house transforms, and door branches identical across neighbor changes', () => {
    const fixture = fixtures.find((f) => f.name.startsWith('B-'));
    const tile = fixture?.snapshot.tiles[0];
    if (!fixture || !tile) throw new Error('Missing five-house fixture');
    const site = { ...tile, seed: fixture.snapshot.seed, region: fixture.snapshot.region };
    const stable = (sides: typeof open) => {
      const p = plan(site, sides);
      return {
        homes: p.homes.map(({ at, turn, scale, doorAnchor, access }) => ({
          at,
          turn,
          scale,
          doorAnchor,
          access,
        })),
        nodes: p.pedestrian.nodes.filter((n) => n.kind !== 'crossing' || n.location !== 'boundary'),
        edges: p.pedestrian.edges.filter((e) => e.interior),
      };
    };
    const before = stable(open);
    for (let side = 0; side < 6; side++) {
      for (const state of [
        { meet: 'match', rise: 0 },
        { meet: 'match', rise: 1 },
        { meet: 'steep', rise: 2 },
        { meet: 'differ', rise: 0 },
      ] as const) {
        const sides = open.map((s, i) => (i === side ? state : s));
        const p = plan(site, sides);
        expect(
          p.homes.map(({ at, turn, scale, doorAnchor, access }) => ({ at, turn, scale, doorAnchor, access })),
        ).toEqual(before.homes);
        expect(p.pedestrian.nodes.filter((n) => n.kind !== 'crossing' || n.location !== 'boundary')).toEqual(
          before.nodes,
        );
        expect(p.pedestrian.edges.filter((e) => e.interior)).toEqual(before.edges);
      }
    }
    expect(before.edges.some((e) => e.class === 'secondary')).toBe(true);
  });

  it.each(fixtures)(
    'preserves full-width pavement at declared heights for every uphill port in $name',
    ({ snapshot }) => {
      const kit = new TileKit();
      for (const tile of snapshot.tiles) {
        const site = { ...tile, seed: snapshot.seed, region: snapshot.region };
        const before = kit.plan(site, open);
        for (const [side, group] of tile.paths.entries()) {
          if (!group) continue;
          const sides = open.map((state, i) => (i === side ? { meet: 'match' as const, rise: 1 } : state));
          const after = kit.plan(site, sides);
          expect(after.homes).toEqual(before.homes);
          expect(after.pedestrian.edges.filter((e) => e.interior)).toEqual(
            before.pedestrian.edges.filter((e) => e.interior),
          );
          expect(
            after.pedestrian.nodes.filter((n) => n.kind !== 'crossing' || n.location !== 'boundary'),
          ).toEqual(
            before.pedestrian.nodes.filter((n) => n.kind !== 'crossing' || n.location !== 'boundary'),
          );
          expect(after.pedestrian.failures.filter((f) => f.group !== null)).toEqual([]);
          const triangles = topPaving(kit.compose(site, sides));
          expect(projectedOverlap(triangles)).toBeLessThan(1e-7);
          expect(uncoveredRoutes(after.pedestrian, triangles), `${tile.q},${tile.r} side ${side}`).toEqual(
            [],
          );
        }
      }
      kit.dispose();
    },
  );

  it('implements the seed-3 Cartagena stair tile with pavement at every declared route height', () => {
    const snapshot = realCore(3).command({ type: 'autoplay', count: 39 }).snapshot;
    const tile = snapshot.tiles.find((t) => t.q === 4 && t.r === -4);
    if (!tile) throw new Error('Missing seed-3 stair fixture');
    const kit = new TileKit();
    const site = siteOf(tile, snapshot.region);
    const sides = sidesOf(tile, snapshot.tiles);
    expect(sides[1]).toEqual({ meet: 'match', rise: 1 });
    const layout = kit.plan(site, sides);
    expect(layout.homes).toHaveLength(4);
    expect(layout.homes.every((h) => h.connected)).toBe(true);
    expect(layout.pedestrian.failures).toEqual([]);
    expect(uncoveredRoutes(layout.pedestrian, topPaving(kit.compose(site, sides)))).toEqual([]);
    kit.dispose();
  });

  it.each([1, 2, 3])('covers every stair-bearing tile in real seed %i at its declared heights', (seed) => {
    const snapshot = realCore(seed).command({ type: 'autoplay', count: 39 }).snapshot;
    const kit = new TileKit();
    let inspected = 0;
    for (const tile of snapshot.tiles) {
      const sides = sidesOf(tile, snapshot.tiles);
      if (!sides.some((state, i) => tile.paths[i] && state.meet === 'match' && state.rise === 1)) continue;
      const site = siteOf(tile, snapshot.region);
      const layout = kit.plan(site, sides);
      expect(
        layout.pedestrian.failures.filter((f) => f.group !== null),
        `${tile.q},${tile.r}`,
      ).toEqual([]);
      const triangles = topPaving(kit.compose(site, sides));
      expect(projectedOverlap(triangles)).toBeLessThan(1e-7);
      expect(uncoveredRoutes(layout.pedestrian, triangles), `${tile.q},${tile.r}`).toEqual([]);
      inspected++;
    }
    expect(inspected).toBeGreaterThan(0);
    kit.dispose();
  });

  it('gives the lower tile one whole stair flight with an exact shared upper seam', () => {
    for (let side = 0; side < 6; side++) {
      const back = (side + 3) % 6,
        d = DIRECTIONS[side];
      if (!d) continue;
      const lowerSite = {
        ...bare,
        edges: bare.edges.map((_, i) => (i === side ? ('path' as const) : ('nature' as const))),
        paths: bare.paths.map((_, i) => (i === side ? 1 : 0)),
      };
      const upperSite = {
        ...lowerSite,
        edges: lowerSite.edges.map((_, i) => (i === back ? ('path' as const) : ('nature' as const))),
        paths: lowerSite.paths.map((_, i) => (i === back ? 1 : 0)),
        elevation: 1,
      };
      const lower = plan(
        lowerSite,
        open.map((s, i) => (i === side ? { meet: 'match', rise: 1 } : s)),
      ).pedestrian;
      const upper = plan(
        upperSite,
        open.map((s, i) => (i === back ? { meet: 'match', rise: -1 } : s)),
      ).pedestrian;
      const stair = lower.edges.filter((e) => e.traversal.kind === 'stairs');
      expect(stair).toHaveLength(1);
      expect(upper.edges.every((e) => e.traversal.kind === 'level')).toBe(true);
      const a = lower.nodes.find((n) => n.kind === 'crossing' && n.location === 'boundary');
      const b = upper.nodes.find((n) => n.kind === 'crossing' && n.location === 'boundary');
      if (!a || !b) throw new Error('Missing stair endpoints');
      const offset = center(d.q, d.r);
      expect(a.at.x).toBeCloseTo(b.at.x + offset.x, 9);
      expect(a.at.z).toBeCloseTo(b.at.z + offset.z, 9);
      expect(a.height).toBeCloseTo(b.height + LEVEL, 9);
      expect(lower.boundaries[0]?.opening).toBe(upper.boundaries[0]?.opening);
    }
  });

  it('triangulates the union once instead of stacking independent paving at junctions', () => {
    const graph = plan(
      { ...bare, edges: ['path', 'path', 'path', 'path', 'nature', 'nature'], paths: [1, 1, 1, 1, 0, 0] },
      open,
    ).pedestrian;
    const builder = new Builder(false);
    pave(builder, graph);
    const built = builder.finish();
    const geometry = built.toNonIndexed();
    built.dispose();
    const positions = geometry.getAttribute('position'),
      surface = geometry.getAttribute('surface');
    let triangleArea = 0;
    for (let i = 0; i < positions.count; i += 3) {
      if (surface.getX(i) !== Surface.paving) continue;
      const a = new THREE.Vector3().fromBufferAttribute(positions, i),
        b = new THREE.Vector3().fromBufferAttribute(positions, i + 1),
        c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
      triangleArea += Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
    }
    expect(triangleArea).toBeCloseTo(
      pavement(graph).reduce((sum, sheet) => sum + area(sheet.paving), 0),
      6,
    );
    geometry.dispose();
  });
});
