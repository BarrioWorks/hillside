import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import * as THREE from 'three';
import type { Builder } from './builder';
import type { DoorAnchor } from './building-door';
import { corner, edgeAngle, facing, INRADIUS, LEVEL } from './hex';
import { Surface } from './palette';
import type { Point, SideState, TileSite } from './tiles';

export const WIDTH = { primary: 0.56, secondary: 0.34, entrance: 0.24 } as const;
export const COPING = 0.08;
export const STAIR_RUN = 0.8;
const LIFT = 0.045;
const GAP = 0.025;
export type PathClass = keyof typeof WIDTH;
type NodeId = `node:${number}`;
type EdgeId = `edge:${number}`;
export type PathNode = Readonly<{ id: NodeId; at: Point; height: number; group: number }> &
  (
    | { kind: 'crossing'; side: number; normal: Point; location: 'interior' | 'boundary' }
    | { kind: 'door'; side: number; anchor: DoorAnchor; public: boolean }
    | { kind: 'junction' | 'landing' }
    | { kind: 'destination'; name: string; area: readonly Point[] }
  );
export type PathPurpose =
  | { kind: 'crossings'; sides: readonly number[] }
  | { kind: 'entrances'; doors: readonly number[]; threshold: boolean }
  | { kind: 'public'; name: string }
  | { kind: 'boundary'; side: number };
export type Traversal =
  | { kind: 'level'; height: number }
  | { kind: 'stairs'; fromHeight: number; toHeight: number; steps: number };
export interface PathEdge {
  readonly id: EdgeId;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly group: number;
  readonly class: PathClass;
  readonly width: number;
  readonly purpose: PathPurpose;
  readonly traversal: Traversal;
  readonly interior: boolean;
}
export type BlockedRegion =
  | { kind: 'building'; side: number; polygon: readonly Point[] }
  | { kind: 'water' | 'bank'; polygon: readonly Point[] };
export interface Boundary {
  readonly side: number;
  readonly group: number;
  readonly inner: Point;
  readonly seam: Point;
  readonly normal: Point;
  readonly end: Point;
  readonly kind: 'open' | 'level' | 'stairs' | 'stop' | 'cliff';
  readonly rise: number;
  readonly opening: number;
}
export interface RouteFailure {
  readonly group: number | null;
  readonly at: Point;
  readonly reason: string;
  readonly side: number | null;
}
export interface PathGraph {
  readonly nodes: readonly PathNode[];
  readonly edges: readonly PathEdge[];
  readonly adjacency: Readonly<Record<NodeId, readonly EdgeId[]>>;
  readonly walkable: readonly Point[];
  readonly blocked: readonly BlockedRegion[];
  readonly boundaries: readonly Boundary[];
  readonly failures: readonly RouteFailure[];
}
export const anchor = (side: number, d = INRADIUS): Point => ({
  x: Math.cos(edgeAngle(side)) * d,
  z: Math.sin(edgeAngle(side)) * d,
});
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z);
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});
const cross = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
export function nearest(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  return lerp(
    a,
    b,
    Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1))),
  );
}
export const segmentDistance = (p: Point, a: Point, b: Point): number => distance(p, nearest(p, a, b));
export function segmentsDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(
    segmentDistance(a, c, d),
    segmentDistance(b, c, d),
    segmentDistance(c, a, b),
    segmentDistance(d, a, b),
  );
}
export function insideFootprint(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if (!a || !b) continue;
    if (segmentDistance(p, a, b) < 1e-9) return true;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
export function footprintDistance(polygon: readonly Point[], a: Point, b: Point): number {
  if (insideFootprint(a, polygon) || insideFootprint(b, polygon)) return 0;
  let best = Infinity;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    if (q) best = Math.min(best, segmentsDistance(p, q, a, b));
  });
  return best;
}
export function boundary(side: number, group: number, state: SideState | undefined): Boundary {
  const rise = state?.rise ?? 0;
  const kind =
    !state || state.meet === 'open'
      ? 'open'
      : state.meet === 'steep' || Math.abs(rise) > 1
        ? 'cliff'
        : state.meet !== 'match'
          ? 'stop'
          : rise === 1
            ? 'stairs'
            : 'level';
  return {
    side,
    group,
    inner: anchor(side, INRADIUS - STAIR_RUN),
    seam: anchor(side),
    normal: anchor(side, 1),
    end: anchor(side, INRADIUS - (kind === 'stop' ? 0.45 : kind === 'cliff' ? 0.38 : 0)),
    kind,
    rise,
    opening: state?.meet === 'match' && Math.abs(rise) === 1 ? WIDTH.primary + COPING : 0,
  };
}

export function edgePoints(graph: Pick<PathGraph, 'nodes'>, edge: PathEdge): readonly [Point, Point] {
  const from = graph.nodes.find((n) => n.id === edge.from),
    to = graph.nodes.find((n) => n.id === edge.to);
  if (!from || !to) throw new Error(`Missing pedestrian endpoint ${edge.id}`);
  return [from.at, to.at];
}
export function pavementClearance(graph: PathGraph, p: Point): number {
  return Math.min(
    Infinity,
    ...graph.nodes.flatMap((n) =>
      n.kind === 'destination' ? [footprintDistance(n.area, p, p) - COPING / 2] : [],
    ),
    ...graph.edges.map((e) => {
      const [a, b] = edgePoints(graph, e);
      return segmentDistance(p, a, b) - (e.width + COPING) / 2;
    }),
  );
}

type NodeSpec = PathNode extends infer N ? (N extends PathNode ? Omit<N, 'id'> : never) : never;
type Target = { at: Point; node: NodeId | null; edge: EdgeId | null; cost: number; landing?: Point };
interface FlightReservation {
  lower: Point;
  upper: Point;
  width: number;
  group: number;
}
const dock = (flight: FlightReservation, width: number, fraction = 1): Point => {
  const length = distance(flight.lower, flight.upper);
  const run = ((width + COPING) / 2 + GAP) * fraction;
  return {
    x: flight.lower.x + ((flight.lower.x - flight.upper.x) * run) / length,
    z: flight.lower.z + ((flight.lower.z - flight.upper.z) * run) / length,
  };
};
function overlaps(a: readonly Point[], b: readonly Point[]): boolean {
  for (const polygon of [a, b]) {
    for (const [i, p] of polygon.entries()) {
      const q = polygon[(i + 1) % polygon.length];
      if (!q) continue;
      const axis = { x: p.z - q.z, z: q.x - p.x };
      const project = (v: Point) => v.x * axis.x + v.z * axis.z;
      const pa = a.map(project),
        pb = b.map(project);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9)
        return false;
    }
  }
  return true;
}
interface Route {
  points: Point[];
  target: Target;
}

export class PedestrianPlanner {
  readonly nodes: PathNode[] = [];
  readonly edges: PathEdge[] = [];
  readonly blocked: BlockedRegion[];
  readonly failures: RouteFailure[] = [];
  readonly reservations: Boundary[];
  private readonly flights: FlightReservation[];
  private nextEdge = 0;
  private nextNode = 0;
  private readonly root = new Map<number, NodeId>();
  constructor(
    readonly site: Pick<TileSite, 'edges' | 'paths' | 'kind'>,
    blocked: readonly BlockedRegion[],
  ) {
    this.blocked = [...blocked];
    this.reservations = site.paths.flatMap((group, side) =>
      group && site.edges[side] === 'path' ? [boundary(side, group, undefined)] : [],
    );
    this.flights = this.reservations.map((port) => ({
      lower: port.inner,
      upper: port.seam,
      width: WIDTH.primary,
      group: port.group,
    }));
    for (const port of this.reservations) {
      this.node({
        kind: 'crossing',
        at: port.inner,
        height: 0,
        group: port.group,
        side: port.side,
        normal: port.normal,
        location: 'interior',
      });
    }
    for (const port of this.reservations) {
      const node = this.nodes.find((n) => n.kind === 'crossing' && n.side === port.side);
      if (!node) continue;
      if (!this.root.has(port.group)) {
        this.root.set(port.group, node.id);
        continue;
      }
      const route = this.route(port.inner, port.group, WIDTH.primary, port.normal, node.id);
      if (route)
        this.insert(node.id, route, 'primary', {
          kind: 'crossings',
          sides: this.reservations.filter((p) => p.group === port.group).map((p) => p.side),
        });
      else
        this.failures.push({
          group: port.group,
          side: port.side,
          at: port.inner,
          reason: 'No dry full-width connection between crossings',
        });
    }
    if (site.kind === 'plaza') {
      const group = this.reservations[0]?.group;
      const at = { x: 0, z: 0 };
      if (group && this.valid(at, at, WIDTH.primary, group)) {
        const route = this.route(at, group, WIDTH.primary, { x: 1, z: 0 });
        if (route) {
          const node = this.node({
            kind: 'destination',
            name: 'plaza',
            area: strip({ x: -0.3, z: 0 }, { x: 0.3, z: 0 }, 0.8),
            at,
            height: 0,
            group,
          });
          this.insert(node.id, route, 'primary', { kind: 'public', name: 'plaza' });
        }
      }
    }
  }
  private node(spec: NodeSpec): PathNode {
    const node: PathNode = { ...spec, id: `node:${this.nextNode++}` };
    this.nodes.push(node);
    return node;
  }
  private edge(
    from: NodeId,
    to: NodeId,
    group: number,
    pathClass: PathClass,
    purpose: PathPurpose,
    traversal: Traversal = { kind: 'level', height: 0 },
    interior = true,
  ): PathEdge {
    const edge: PathEdge = {
      id: `edge:${this.nextEdge++}`,
      from,
      to,
      group,
      class: pathClass,
      width: WIDTH[pathClass],
      purpose,
      traversal,
      interior,
    };
    this.edges.push(edge);
    return edge;
  }
  private point(id: NodeId): Point {
    const p = this.nodes.find((n) => n.id === id);
    if (!p) throw new Error(`Missing pedestrian node ${id}`);
    return p.at;
  }
  nearest(group: number, p: Point): Point | null {
    const targets = this.targets(group, p);
    targets.sort((a, b) => distance(p, a.at) - distance(p, b.at));
    return targets[0]?.at ?? null;
  }
  private targets(group: number, from: Point, except?: NodeId): Target[] {
    const result: Target[] = [];
    for (const node of this.nodes) {
      if (node.group !== group || node.id === except || node.kind === 'door' || node.kind === 'landing')
        continue;
      if (
        node.kind === 'crossing' &&
        node.id !== this.root.get(group) &&
        !this.edges.some((e) => e.from === node.id || e.to === node.id)
      )
        continue;
      const flight = this.flights.find((f) => distance(f.lower, node.at) < 1e-8);
      result.push({
        at: flight ? this.approach(flight, WIDTH.primary) : node.at,
        node: node.id,
        edge: null,
        cost: this.reuseCost(node.id),
        ...(flight ? { landing: node.at } : {}),
      });
    }
    for (const edge of this.edges) {
      if (
        edge.group !== group ||
        edge.traversal.kind !== 'level' ||
        (edge.purpose.kind === 'entrances' && edge.purpose.threshold)
      )
        continue;
      const a = this.point(edge.from),
        b = this.point(edge.to);
      const at = nearest(from, a, b);
      if (distance(at, a) < 0.001 || distance(at, b) < 0.001) continue;
      result.push({
        at,
        node: null,
        edge: edge.id,
        cost:
          edge.class === 'primary'
            ? 0
            : Math.min(
                this.reuseCost(edge.from) + distance(at, a) * 0.25,
                this.reuseCost(edge.to) + distance(at, b) * 0.25,
              ),
      });
    }
    return result;
  }
  private reuseCost(start: NodeId): number {
    const queue = [{ id: start, cost: 0 }],
      seen = new Set<NodeId>();
    for (let i = 0; i < queue.length; i++) {
      const next = queue[i];
      if (!next || seen.has(next.id)) continue;
      seen.add(next.id);
      if (next.id === this.root.get(this.nodes.find((n) => n.id === next.id)?.group ?? 0)) return next.cost;
      for (const edge of this.edges)
        if (edge.from === next.id || edge.to === next.id) {
          if (edge.class === 'primary') return next.cost;
          queue.push({
            id: edge.from === next.id ? edge.to : edge.from,
            cost: next.cost + distance(this.point(edge.from), this.point(edge.to)) * 0.25,
          });
        }
    }
    return 0;
  }
  valid(a: Point, b: Point, width: number, group: number): boolean {
    const half = (width + COPING) / 2;
    for (let side = 0; side < 6; side++) {
      const n = anchor(side, 1);
      if (Math.max(a.x * n.x + a.z * n.z, b.x * n.x + b.z * n.z) > INRADIUS - half - 0.006) return false;
    }
    for (const region of this.blocked) {
      if (footprintDistance(region.polygon, a, b) >= half + GAP) continue;
      if (region.kind === 'building') return false;
      const corridor = strip(a, b, width + COPING);
      if (distance(a, b) < 1e-8 || region.polygon.some((p) => insideFootprint(p, corridor))) return false;
      if (
        corridor.some((p, i) => {
          const q = corridor[(i + 1) % corridor.length];
          return q && footprintDistance(region.polygon, p, q) < GAP;
        })
      )
        return false;
    }
    for (const node of this.nodes)
      if (
        node.kind === 'destination' &&
        node.group !== group &&
        footprintDistance(node.area, a, b) < half + GAP
      )
        return false;
    for (const port of this.reservations)
      if (
        port.group !== group &&
        segmentsDistance(a, b, port.inner, port.seam) < half + (WIDTH.primary + COPING) / 2 + GAP
      )
        return false;
    for (const flight of this.flights) {
      const footprint = strip(flight.lower, flight.upper, flight.width + COPING);
      if (distance(a, b) < 1e-8) {
        if (footprintDistance(footprint, a, b) < half + GAP) return false;
      } else if (overlaps(strip(a, b, width + COPING), footprint)) return false;
    }
    for (const edge of this.edges)
      if (edge.group !== group) {
        if (
          segmentsDistance(a, b, this.point(edge.from), this.point(edge.to)) <
          half + (edge.width + COPING) / 2 + GAP
        )
          return false;
      }
    return true;
  }
  roomFor(polygon: readonly Point[]): boolean {
    for (const region of this.blocked) {
      if (
        polygon.some((p, i) => {
          const q = polygon[(i + 1) % polygon.length];
          return q && footprintDistance(region.polygon, p, q) < GAP;
        })
      )
        return false;
    }
    for (const node of this.nodes)
      if (
        node.kind === 'destination' &&
        node.area.some((p, i) => {
          const q = node.area[(i + 1) % node.area.length];
          return q && footprintDistance(polygon, p, q) < COPING / 2 + GAP;
        })
      )
        return false;
    for (const port of this.reservations)
      if (
        footprintDistance(
          polygon,
          dock(
            { lower: port.inner, upper: port.seam, width: WIDTH.primary, group: port.group },
            WIDTH.primary,
          ),
          port.seam,
        ) <
        (WIDTH.primary + COPING) / 2 + GAP
      )
        return false;
    for (const edge of this.edges) {
      const reserve = edge.class === 'primary' ? WIDTH.primary : WIDTH.secondary;
      if (
        footprintDistance(polygon, this.point(edge.from), this.point(edge.to)) <
        (reserve + COPING) / 2 + GAP
      )
        return false;
    }
    return true;
  }
  private approach(flight: FlightReservation, width: number): Point {
    for (const fraction of [1, 0.75, 0.5, 0.25]) {
      const at = dock(flight, width, fraction);
      if (this.valid(flight.lower, at, width, flight.group)) return at;
    }
    return dock(flight, width);
  }
  private route(start: Point, group: number, width: number, heading: Point, except?: NodeId): Route | null {
    const origin = start;
    const flight = this.flights.find((f) => distance(f.lower, start) < 1e-8);
    if (flight) {
      start = this.approach(flight, width);
      if (!this.valid(origin, start, width, group)) return null;
    }
    const complete = (points: Point[], target: Target): Route => ({
      points: [...(flight ? [origin] : []), ...points, ...(target.landing ? [target.landing] : [])],
      target,
    });
    const targets = this.targets(group, start, except).filter(
      (t) => !t.landing || this.valid(t.at, t.landing, width, group),
    );
    if (!targets.length) return null;
    const turnCost = (a: Point, b: Point, direction: Point) => {
      const length = distance(a, b);
      return length < 1e-8
        ? 0
        : 0.09 * (1 - (direction.x * (b.x - a.x) + direction.z * (b.z - a.z)) / length);
    };
    const travelCost = (a: Point, b: Point): number => {
      const clearance = Math.min(0.6, ...this.blocked.map((r) => footprintDistance(r.polygon, a, b)));
      const bank = Math.min(
        Infinity,
        ...this.blocked.filter((r) => r.kind === 'bank').map((r) => footprintDistance(r.polygon, a, b)),
      );
      return (
        distance(a, b) *
        (1 + 0.04 / (clearance + 0.15) + 0.03 / (bank + 0.2) + (this.site.kind === 'monte' ? 0.12 : 0))
      );
    };
    const direct = targets
      .filter((t) => this.valid(start, t.at, width, group))
      .map((t) => ({ t, score: travelCost(start, t.at) + t.cost + turnCost(start, t.at, heading) }))
      .sort((a, b) => a.score - b.score);
    const first = direct[0];
    if (first) return complete([start, first.t.at], first.t);
    const spacing = 0.12,
      span = 14,
      size = span * 2 + 1;
    const dirs = [
      { x: 1, z: 0 },
      { x: 1, z: 1 },
      { x: 0, z: 1 },
      { x: -1, z: 1 },
      { x: -1, z: 0 },
      { x: -1, z: -1 },
      { x: 0, z: -1 },
      { x: 1, z: -1 },
    ];
    type State = {
      id: number;
      at: Point;
      direction: Point;
      cost: number;
      score: number;
      previous: State | null;
    };
    const heap: State[] = [];
    const push = (s: State) => {
      heap.push(s);
      let i = heap.length - 1;
      while (i > 0) {
        const j = (i - 1) >> 1,
          p = heap[j];
        if (!p || p.score < s.score || (p.score === s.score && p.id < s.id)) break;
        heap[i] = p;
        i = j;
      }
      heap[i] = s;
    };
    const pop = (): State | undefined => {
      const first = heap[0],
        last = heap.pop();
      if (heap.length && last) {
        let i = 0;
        while (true) {
          let j = i * 2 + 1;
          if (j >= heap.length) break;
          const a = heap[j],
            b = heap[j + 1];
          if (b && a && (b.score < a.score || (b.score === a.score && b.id < a.id))) j++;
          const child = heap[j];
          if (!child || child.score > last.score || (child.score === last.score && child.id > last.id)) break;
          heap[i] = child;
          i = j;
        }
        heap[i] = last;
      }
      return first;
    };
    const heuristic = (p: Point) => Math.min(...targets.map((t) => distance(p, t.at) + t.cost));
    const costs = new Map<number, number>();
    const startX = Math.round(start.x / spacing),
      startZ = Math.round(start.z / spacing);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const x = startX + dx,
          z = startZ + dz,
          at = { x: x * spacing, z: z * spacing };
        if (Math.abs(x) > span || Math.abs(z) > span || !this.valid(start, at, width, group)) continue;
        const id = ((x + span) * size + z + span) * 8,
          cost = travelCost(start, at) + turnCost(start, at, heading);
        push({ id, at, direction: heading, cost, score: cost + heuristic(at), previous: null });
        costs.set(id, cost);
      }
    let best: { state: State; target: Target; score: number } | null = null;
    let visits = 0;
    while (heap.length && visits++ < 18000) {
      const current = pop();
      if (!current || current.cost > (costs.get(current.id) ?? Infinity)) continue;
      if (best && current.score >= best.score) break;
      for (const target of targets) {
        const score =
          current.cost +
          travelCost(current.at, target.at) +
          target.cost +
          turnCost(current.at, target.at, current.direction);
        if ((!best || score < best.score) && this.valid(current.at, target.at, width, group))
          best = { state: current, target, score };
      }
      const x = Math.round(current.at.x / spacing),
        z = Math.round(current.at.z / spacing);
      for (const [direction, d] of dirs.entries()) {
        const nx = x + d.x,
          nz = z + d.z,
          at = { x: nx * spacing, z: nz * spacing };
        if (Math.abs(nx) > span || Math.abs(nz) > span || !this.valid(current.at, at, width, group)) continue;
        const length = Math.hypot(d.x, d.z),
          unit = { x: d.x / length, z: d.z / length };
        const cost = current.cost + travelCost(current.at, at) + turnCost(current.at, at, current.direction);
        const id = ((nx + span) * size + nz + span) * 8 + direction;
        if (cost >= (costs.get(id) ?? Infinity) - 1e-9) continue;
        costs.set(id, cost);
        push({ id, at, direction: unit, cost, score: cost + heuristic(at), previous: current });
      }
    }
    if (!best) return null;
    const points: Point[] = [best.target.at];
    let state: State | null = best.state;
    while (state) {
      points.push(state.at);
      state = state.previous;
    }
    points.push(start);
    points.reverse();
    for (let i = 0; i < points.length - 2; i++)
      for (let j = points.length - 1; j > i + 1; j--) {
        const a = points[i],
          b = points[j];
        if (a && b && this.valid(a, b, width, group)) {
          points.splice(i + 1, j - i - 1);
          break;
        }
      }
    return complete(points, best.target);
  }
  private contact(target: Target): NodeId {
    if (target.node) return target.node;
    const index = this.edges.findIndex((e) => e.id === target.edge),
      edge = this.edges[index];
    if (!edge) throw new Error('Route attachment lost its graph edge');
    const node = this.node({ kind: 'junction', at: target.at, height: 0, group: edge.group });
    this.edges.splice(index, 1);
    this.edge(edge.from, node.id, edge.group, edge.class, edge.purpose, edge.traversal);
    this.edge(node.id, edge.to, edge.group, edge.class, edge.purpose, edge.traversal);
    return node.id;
  }
  private insert(start: NodeId, route: Route, pathClass: PathClass, purpose: PathPurpose): void {
    const group = this.nodes.find((n) => n.id === start)?.group ?? 0;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1],
        b = route.points[i];
      if (!a || !b) continue;
      let contact: { t: number; at: Point; edge: PathEdge } | null = null;
      for (const edge of this.edges) {
        if (
          edge.group !== group ||
          edge.traversal.kind !== 'level' ||
          (edge.purpose.kind === 'entrances' && edge.purpose.threshold)
        )
          continue;
        const c = this.point(edge.from),
          d = this.point(edge.to),
          den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den;
        const u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / den;
        if (t > 1e-6 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8 && (!contact || t < contact.t))
          contact = { t, at: lerp(a, b, t), edge };
      }
      if (contact) {
        const e = contact.edge;
        route = {
          points: [...route.points.slice(0, i), contact.at],
          target: {
            at: contact.at,
            node:
              distance(contact.at, this.point(e.from)) < 1e-6
                ? e.from
                : distance(contact.at, this.point(e.to)) < 1e-6
                  ? e.to
                  : null,
            edge: e.id,
            cost: 0,
          },
        };
        break;
      }
    }
    route.points = route.points.filter((p, i, points) => i === 0 || distance(p, points[i - 1] ?? p) > 1e-7);
    const end = this.contact(route.target);
    if (route.points.length === 1) {
      const source = this.nodes.find((n) => n.id === start),
        target = this.nodes.find((n) => n.id === end);
      if (source && target && source !== target) {
        if (source.kind === 'destination' && target.kind === 'junction')
          this.nodes[this.nodes.indexOf(target)] = { ...source, id: end };
        this.edges.forEach((edge, i) => {
          this.edges[i] = {
            ...edge,
            from: edge.from === start ? end : edge.from,
            to: edge.to === start ? end : edge.to,
          };
        });
        this.nodes.splice(this.nodes.indexOf(source), 1);
      }
      if (purpose.kind === 'entrances') this.promote(end, purpose.doors);
      return;
    }
    let from = start;
    for (let i = 1; i < route.points.length; i++) {
      const at = route.points[i];
      if (!at) continue;
      const to =
        i === route.points.length - 1 ? end : this.node({ kind: 'junction', at, height: 0, group }).id;
      if (distance(this.point(from), this.point(to)) > 1e-7) this.edge(from, to, group, pathClass, purpose);
      from = to;
    }
    if (purpose.kind === 'entrances') this.promote(end, purpose.doors);
  }
  private promote(start: NodeId, doors: readonly number[]): void {
    const seen = new Set<NodeId>();
    const visit = (id: NodeId): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      if (id === this.root.get(this.nodes.find((n) => n.id === id)?.group ?? 0)) return true;
      for (const edge of [...this.edges]) {
        if (edge.from !== id && edge.to !== id) continue;
        if (edge.class === 'primary') return true;
        if (edge.purpose.kind !== 'entrances' || edge.purpose.threshold) continue;
        if (visit(edge.from === id ? edge.to : edge.from)) {
          const uses = [...new Set([...edge.purpose.doors, ...doors])];
          const pathClass = uses.length > 1 ? 'secondary' : 'entrance';
          const index = this.edges.indexOf(edge);
          this.edges[index] = {
            ...edge,
            class: pathClass,
            width: WIDTH[pathClass],
            purpose: { ...edge.purpose, doors: uses },
          };
          return true;
        }
      }
      return false;
    };
    visit(start);
  }
  connectDoor(
    side: number,
    group: number | null,
    door: DoorAnchor,
    footprint: readonly Point[],
    isPublic = false,
  ): boolean {
    if (group === null) {
      this.blocked.push({ kind: 'building', side, polygon: footprint });
      this.node({
        kind: 'door',
        side,
        anchor: door,
        at: { x: door.x, z: door.z },
        height: door.y,
        group: 0,
        public: isPublic,
      });
      this.failures.push({ group: null, side, at: door, reason: 'No Rust entrance assignment' });
      return true;
    }
    const run = isPublic ? 0.4 : door.y > 0.08 ? Math.max(0.32, door.y * 1.5) : 0.27;
    const exit = { x: door.x + door.heading.x * run, z: door.z + door.heading.z * run };
    if (!this.valid(door, exit, WIDTH.entrance, group)) return false;
    const stairs = door.y > 0.08;
    if (
      stairs &&
      this.edges.some((edge) =>
        overlaps(
          strip(door, exit, WIDTH.entrance + COPING),
          strip(this.point(edge.from), this.point(edge.to), edge.width + COPING),
        ),
      )
    )
      return false;
    const obstacle: BlockedRegion = { kind: 'building', side, polygon: footprint };
    this.blocked.push(obstacle);
    if (isPublic && !this.valid(exit, exit, WIDTH.primary, group)) {
      this.blocked.pop();
      return false;
    }
    if (stairs) this.flights.push({ lower: exit, upper: door, width: WIDTH.entrance, group });
    const route = this.route(exit, group, WIDTH.secondary, door.heading);
    if (!route) {
      if (stairs) this.flights.pop();
      this.blocked.pop();
      return false;
    }
    const node = this.node({
      kind: 'door',
      side,
      anchor: door,
      at: { x: door.x, z: door.z },
      height: door.y,
      group,
      public: isPublic,
    });
    const landing = this.node(
      isPublic
        ? {
            kind: 'destination',
            name: 'chapel forecourt',
            at: exit,
            height: 0,
            group,
            area: strip(
              { x: exit.x - door.heading.x * 0.14, z: exit.z - door.heading.z * 0.14 },
              { x: exit.x + door.heading.x * 0.14, z: exit.z + door.heading.z * 0.14 },
              0.44,
            ),
          }
        : { kind: 'landing', at: exit, height: 0, group },
    );
    const purpose: PathPurpose = { kind: 'entrances', doors: [side], threshold: true };
    this.edge(
      node.id,
      landing.id,
      group,
      'entrance',
      purpose,
      door.y > 0.08
        ? { kind: 'stairs', fromHeight: door.y, toHeight: 0, steps: 3 }
        : { kind: 'level', height: 0 },
    );
    this.insert(landing.id, route, 'entrance', { kind: 'entrances', doors: [side], threshold: false });
    return true;
  }
  finish(sides: readonly (SideState | undefined)[]): PathGraph {
    return withBoundaries(
      {
        nodes: this.nodes,
        edges: this.edges,
        adjacency: {},
        walkable: Array.from({ length: 6 }, (_, i) => corner(i)),
        blocked: this.blocked,
        boundaries: this.reservations,
        failures: this.failures,
      },
      sides,
    );
  }
}

export function withBoundaries(core: PathGraph, sides: readonly (SideState | undefined)[]): PathGraph {
  const nodes = core.nodes.filter((n) => n.kind !== 'crossing' || n.location !== 'boundary');
  const edges = core.edges.filter((e) => e.interior);
  let nextNode = Math.max(-1, ...nodes.map((n) => Number(n.id.slice(5)))) + 1;
  const nextEdge = Math.max(-1, ...edges.map((e) => Number(e.id.slice(5)))) + 1;
  const boundaries = core.boundaries.map((p) => boundary(p.side, p.group, sides[p.side]));
  for (const port of boundaries) {
    const from = nodes.find(
      (n) => n.kind === 'crossing' && n.side === port.side && n.location === 'interior',
    );
    if (!from) continue;
    const to: PathNode = {
      id: `node:${nextNode++}`,
      kind: 'crossing',
      side: port.side,
      location: 'boundary',
      normal: port.normal,
      at: port.end,
      height: port.kind === 'stairs' ? LEVEL : 0,
      group: port.group,
    };
    nodes.push(to);
    const serves = edges.some((e) => e.group === port.group) || sides[port.side]?.meet === 'match';
    if (!serves) continue;
    edges.push({
      id: `edge:${nextEdge + port.side}`,
      from: from.id,
      to: to.id,
      group: port.group,
      class: 'primary',
      width: WIDTH.primary,
      purpose: { kind: 'boundary', side: port.side },
      interior: false,
      traversal:
        port.kind === 'stairs'
          ? { kind: 'stairs', fromHeight: 0, toHeight: LEVEL, steps: 5 }
          : { kind: 'level', height: 0 },
    });
  }
  const adjacency: Record<NodeId, EdgeId[]> = {};
  for (const n of nodes) adjacency[n.id] = [];
  for (const e of edges) {
    adjacency[e.from]?.push(e.id);
    adjacency[e.to]?.push(e.id);
  }
  return { ...core, nodes, edges, adjacency, boundaries };
}

const GRID = 100000;
const quantize = (n: number) => Math.round(n * GRID);
const snap = (multi: MultiPolygon): MultiPolygon =>
  multi.map((poly) =>
    poly.map((ring) => ring.map(([x, z]): [number, number] => [Math.round(x), Math.round(z)])),
  );
const worldPolygons = (multi: MultiPolygon, graph: PathGraph): MultiPolygon =>
  multi.map((poly) =>
    poly.map((ring) =>
      ring.map(([x, z]): [number, number] => {
        let point = { x: x / GRID, z: z / GRID };
        for (const edge of graph.edges) {
          if (edge.traversal.kind !== 'stairs') continue;
          const [a, b] = edgePoints(graph, edge);
          const length = distance(a, b);
          const normal = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
          let along = (point.x - a.x) * normal.x + (point.z - a.z) * normal.z;
          let across = -(point.x - a.x) * normal.z + (point.z - a.z) * normal.x;
          const half = (edge.width + COPING) / 2;
          if (along < -2 / GRID || along > length + 2 / GRID || Math.abs(across) > half + 2 / GRID) continue;
          if (Math.abs(along) < 2 / GRID) along = 0;
          else if (Math.abs(along - length) < 2 / GRID) along = length;
          if (Math.abs(Math.abs(across) - half) < 2 / GRID) across = Math.sign(across) * half;
          point = {
            x: a.x + normal.x * along - normal.z * across,
            z: a.z + normal.z * along + normal.x * across,
          };
        }
        for (let side = 0; side < 6; side++) {
          const normal = anchor(side, 1);
          const planeDistance = point.x * normal.x + point.z * normal.z - INRADIUS;
          if (Math.abs(planeDistance) > 2 / GRID) continue;
          let across = -normal.z * point.x + normal.x * point.z;
          for (const half of [0, WIDTH.primary / 2, (WIDTH.primary + COPING) / 2]) {
            if (Math.abs(Math.abs(across) - half) < 2 / GRID) {
              across = Math.sign(across) * half;
              break;
            }
          }
          point = {
            x: normal.x * INRADIUS - normal.z * across,
            z: normal.z * INRADIUS + normal.x * across,
          };
        }
        return [point.x, point.z];
      }),
    ),
  );
const polygon = (points: readonly Point[]): Polygon => [points.map((p) => [quantize(p.x), quantize(p.z)])];
export function strip(a: Point, b: Point, width: number): Point[] {
  const length = distance(a, b) || 1,
    dx = (-(b.z - a.z) * width) / length / 2,
    dz = ((b.x - a.x) * width) / length / 2;
  return [
    { x: a.x + dx, z: a.z + dz },
    { x: b.x + dx, z: b.z + dz },
    { x: b.x - dx, z: b.z - dz },
    { x: a.x - dx, z: a.z - dz },
  ];
}
function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z),
    lower: Point[] = [],
    upper: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2) {
      const a = lower.at(-2),
        b = lower.at(-1);
      if (a && b && cross(a, b, p) <= 0) lower.pop();
      else break;
    }
    lower.push(p);
  }
  for (const p of sorted.reverse()) {
    while (upper.length >= 2) {
      const a = upper.at(-2),
        b = upper.at(-1);
      if (a && b && cross(a, b, p) <= 0) upper.pop();
      else break;
    }
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
export interface PavementSheet {
  readonly group: number;
  readonly height: number;
  readonly paving: MultiPolygon;
  readonly coping: MultiPolygon;
}
export function pavement(graph: PathGraph): PavementSheet[] {
  const sheets: PavementSheet[] = [];
  const groups = [...new Set(graph.edges.map((e) => e.group))];
  for (const group of groups) {
    const level = graph.edges.filter((e) => e.group === group && e.traversal.kind === 'level');
    if (!level.length) continue;
    const build = (extra: number): MultiPolygon => {
      const pieces: Polygon[] = level.map((e) => {
        const [a, b] = edgePoints(graph, e);
        return polygon(strip(a, b, e.width + extra));
      });
      for (const node of graph.nodes) {
        const incident = level.filter((e) => e.from === node.id || e.to === node.id);
        if (incident.length < 2) continue;
        const corners: Point[] = [];
        for (const e of incident) {
          const other = graph.nodes.find((n) => n.id === (e.from === node.id ? e.to : e.from));
          if (!other) continue;
          const s = strip(node.at, other.at, e.width + extra);
          if (s[0] && s[3]) corners.push(s[0], s[3]);
        }
        const ring = hull(corners);
        if (ring.length >= 3) pieces.push(polygon(ring));
      }
      for (const node of graph.nodes)
        if (node.kind === 'destination' && node.group === group) {
          const ring = node.area.map((p, i) => {
            const previous = node.area[(i + node.area.length - 1) % node.area.length],
              next = node.area[(i + 1) % node.area.length];
            if (!previous || !next) return p;
            const a = distance(p, previous),
              b = distance(p, next);
            return {
              x: p.x + (((p.x - previous.x) / a) * extra) / 2 + (((p.x - next.x) / b) * extra) / 2,
              z: p.z + (((p.z - previous.z) / a) * extra) / 2 + (((p.z - next.z) / b) * extra) / 2,
            };
          });
          pieces.push(polygon(ring));
        }
      const first = pieces.shift();
      if (!first) return [];
      const union = snap(polygonClipping.union(first, ...pieces));
      const clipped = snap(polygonClipping.intersection(union, polygon(graph.walkable)));
      const blockers = graph.blocked.map((r) => polygon(r.polygon));
      const stairCuts = graph.edges
        .filter((e) => e.traversal.kind === 'stairs')
        .map((e) => {
          const [a, b] = edgePoints(graph, e);
          return polygon(strip(a, b, e.width + COPING));
        });
      return blockers.length || stairCuts.length
        ? snap(polygonClipping.difference(clipped, ...blockers, ...stairCuts))
        : clipped;
    };
    const paving = build(0),
      outer = build(COPING);
    sheets.push({
      group,
      height: 0,
      paving: worldPolygons(paving, graph),
      coping: paving.length
        ? polygonClipping.difference(worldPolygons(outer, graph), worldPolygons(paving, graph))
        : worldPolygons(outer, graph),
    });
  }
  return sheets;
}
function triangulate(polygons: MultiPolygon, y: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const poly of polygons) {
    const rings = poly.map((r) => r.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z)));
    const outer = rings.shift();
    if (!outer) continue;
    const faces = THREE.ShapeUtils.triangulateShape(outer, rings),
      points = [...outer, ...rings.flat()];
    for (const face of faces) {
      const a = points[face[0] ?? -1],
        b = points[face[1] ?? -1],
        c = points[face[2] ?? -1];
      if (!a || !b || !c) continue;
      if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0)
        positions.push(a.x, y, a.y, c.x, y, c.y, b.x, y, b.y);
      else positions.push(a.x, y, a.y, b.x, y, b.y, c.x, y, c.y);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
export function pave(builder: Builder, graph: PathGraph): void {
  for (const sheet of pavement(graph)) {
    if (sheet.paving.length)
      builder.add(triangulate(sheet.paving, sheet.height + LIFT), 'walkway', Surface.paving);
    if (sheet.coping.length)
      builder.add(triangulate(sheet.coping, sheet.height + 0.028), 'coping', Surface.concrete);
  }
  for (const edge of graph.edges) {
    if (edge.traversal.kind !== 'stairs') continue;
    const [from, to] = edgePoints(graph, edge),
      t = edge.traversal;
    const up = t.toHeight > t.fromHeight,
      a = up ? from : to,
      b = up ? to : from,
      low = Math.min(t.fromHeight, t.toHeight),
      high = Math.max(t.fromHeight, t.toHeight);
    const depth = distance(a, b) / t.steps,
      turn = facing(Math.atan2(b.z - a.z, b.x - a.x));
    for (let i = 0; i < t.steps; i++) {
      const at = lerp(a, b, (i + 0.5) / t.steps),
        height = low + ((high - low) * (i + 1)) / t.steps;
      builder.block(edge.width, height - low + LIFT, depth, at.x, low, at.z, 'walkway', Surface.paving, turn);
    }
  }
  for (const port of graph.boundaries) {
    if (port.kind !== 'stop' && port.kind !== 'cliff') continue;
    const at = { x: port.end.x + port.normal.x * 0.08, z: port.end.z + port.normal.z * 0.08 };
    const turn = facing(edgeAngle(port.side));
    if (port.kind === 'stop') {
      builder.block(0.5, 0.18, 0.16, at.x, 0, at.z, 'terracotta', Surface.plaster, turn);
      builder.blob(0.13, at.x, 0.26, at.z, 'leaf', Surface.foliage, 0.8, 0);
    } else {
      const lateral = { x: -port.normal.z, z: port.normal.x };
      const point = (d: number, y: number) =>
        new THREE.Vector3(at.x + lateral.x * d, y, at.z + lateral.z * d);
      builder.bar(point(-0.34, 0.42), point(0.34, 0.42), 0.035, 'metal', Surface.metal);
      for (const d of [-0.34, 0, 0.34])
        builder.bar(point(d, 0.1), point(d, 0.42), 0.03, 'metal', Surface.metal);
    }
  }
}
