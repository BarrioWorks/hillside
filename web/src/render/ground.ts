import * as THREE from 'three';
import type { Edge, Kind, Region, Tile } from '../domain';
import type { GroundField } from './environment';
import { center, corner, DIRECTIONS, HEX as HEX_RADIUS, key, LEVEL, SKIRT } from './hex';
import { PALETTE, Surface, type SurfaceId } from './palette';
import { type Boundary, boundary } from './pedestrian';

/** Ground tone per tile kind; neighbors at the same level blend toward each other at shared corners. */
const GROUND: Record<Kind, string> = {
  casas: PALETTE.meadow,
  tienda: PALETTE.meadow,
  plaza: PALETTE.meadow,
  capilla: PALETTE.meadow,
  parque: PALETTE.meadow,
  monte: PALETTE.forestFloor,
  quebrada: PALETTE.meadow,
  sendero: PALETTE.meadow,
  inicio: PALETTE.meadow,
};
/**
 * Each region shifts the meadow a little: greener coffee country in Salento, a sun-bleached coast in
 * Cartagena, the cooler Sabana in Bogotá. Shifts stay small so the shared palette still holds.
 */
const REGION_MEADOW: Record<Region, string> = {
  medellin: PALETTE.meadow,
  salento: '#8fa87b',
  cartagena: '#a0a87f',
  bogota: '#8c9b7b',
};
/** The solid core of each hex keeps its own tone; the outer band blends into its neighbors. */
const CORE = 0.5;
const hard = (edge: Edge | undefined) => edge === 'path' || edge === 'homes';

class Triangles {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly color: number[] = [];
  readonly surface: number[] = [];
  private readonly ab = new THREE.Vector3();
  private readonly ac = new THREE.Vector3();
  private readonly n = new THREE.Vector3();

  /** Adds a triangle whose winding faces `facing`. */
  add(points: THREE.Vector3[], colors: THREE.Color[], surface: SurfaceId, facing: THREE.Vector3): void {
    let [a, b, c] = points as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    let [ca, cb, cc] = colors as [THREE.Color, THREE.Color, THREE.Color];
    this.n.crossVectors(this.ab.subVectors(b, a), this.ac.subVectors(c, a));
    if (this.n.dot(facing) < 0) {
      [b, c] = [c, b];
      [cb, cc] = [cc, cb];
    }
    for (const [p, color] of [
      [a, ca],
      [b, cb],
      [c, cc],
    ] as const) {
      this.position.push(p.x, p.y, p.z);
      this.normal.push(facing.x, facing.y, facing.z);
      this.color.push(color.r, color.g, color.b);
      this.surface.push(surface);
    }
  }

  quad(
    corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
    colors: [THREE.Color, THREE.Color, THREE.Color, THREE.Color],
    surface: SurfaceId,
    facing: THREE.Vector3,
  ): void {
    this.add([corners[0], corners[1], corners[2]], [colors[0], colors[1], colors[2]], surface, facing);
    this.add([corners[0], corners[2], corners[3]], [colors[0], colors[2], colors[3]], surface, facing);
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    geometry.setAttribute('surface', new THREE.Float32BufferAttribute(this.surface, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Stable per-hex jitter in [0, 1). */
function jitter(q: number, r: number, salt: number): number {
  let h = Math.imul(q, 0x27d4eb2d) ^ Math.imul(r, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Grass color at a ground vertex, given the same-level tiles meeting there and a shade multiplier. Shared
 * positions get the same tiles, so both strategies agree across tile boundaries.
 */
type GroundTone = (point: THREE.Vector3, tiles: readonly Tile[], shade: number) => THREE.Color;

/** Per-kind tone with a slight per-tile jitter, averaged at shared corners. */
function legacyTone(region: Region): GroundTone {
  const meadow = new THREE.Color(REGION_MEADOW[region]);
  const shift = meadow.clone().sub(new THREE.Color(PALETTE.meadow));
  const tone = new Map<Kind, THREE.Color>(
    Object.entries(GROUND).map(([kind, hex]) => [kind as Kind, new THREE.Color(hex).add(shift)]),
  );
  const tileTone = (tile: Tile) =>
    (tone.get(tile.kind) as THREE.Color).clone().multiplyScalar(0.985 + jitter(tile.q, tile.r, 1) * 0.03);
  return (_, tiles, shade) => {
    const color = new THREE.Color(0, 0, 0);
    for (const tile of tiles) color.add(tileTone(tile));
    return color.multiplyScalar(shade / tiles.length);
  };
}

/**
 * World-space patch field. Forest floor spreads from forest tile centers as one soft mass rather than following
 * which tiles meet at a vertex, which outlined each forest hex.
 */
function fieldTone(field: GroundField, tiles: readonly Tile[]): GroundTone {
  const forests = tiles.filter((tile) => tile.kind === 'monte').map((tile) => center(tile.q, tile.r));
  return (point, _, shade) =>
    field.color(point.x, point.z, field.forestCover(point.x, point.z, forests)).multiplyScalar(shade);
}

/**
 * One continuous ground mesh for all placed tiles: blended hex tops, retaining walls where a tile stands
 * above its neighbor, and earthen sides down to a shared base wherever the neighborhood ends.
 */
export function groundGeometry(
  tiles: readonly Tile[],
  region: Region = 'medellin',
  field?: GroundField,
  pedestrianBoundaries?: ReadonlyMap<string, readonly Boundary[]>,
): THREE.BufferGeometry {
  const byKey = new Map(tiles.map((tile) => [key(tile.q, tile.r), tile]));
  const out = new Triangles();
  const up = new THREE.Vector3(0, 1, 0);
  const tone = field ? fieldTone(field, tiles) : legacyTone(region);
  const stone = new THREE.Color(PALETTE.retaining);
  const coping = new THREE.Color(PALETTE.coping);
  const soilTop = new THREE.Color(PALETTE.skirtTop),
    soilMid = new THREE.Color(PALETTE.skirtMid),
    soilDeep = new THREE.Color(PALETTE.skirtDeep);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Every exposed side reaches the same base, a fixed depth below the lowest tile.
  const base = Math.min(...tiles.map((tile) => tile.elevation)) * LEVEL - SKIRT;

  for (const tile of tiles) {
    const { x, z } = center(tile.q, tile.r);
    const y = tile.elevation * LEVEL;
    const self = [tile];
    const near = DIRECTIONS.map((d) => byKey.get(key(tile.q + d.q, tile.r + d.r)));
    const higher = near.map((other) => !!other && other.elevation > tile.elevation);
    // Corner i is shared with the neighbors across edges i - 1 and i.
    const cornerTiles = (i: number): Tile[] => [
      tile,
      ...[(i + 5) % 6, i].flatMap((side) => {
        const other = near[side];
        return other && other.elevation === tile.elevation ? [other] : [];
      }),
    ];
    const middle = v(x, y, z);
    const own = tone(middle, self, 1);
    const inner = Array.from({ length: 6 }, (_, i) => {
      const c = corner(i);
      return v(x + c.x * CORE, y, z + c.z * CORE);
    });
    const outer = Array.from({ length: 6 }, (_, i) => {
      const c = corner(i);
      return v(x + c.x, y, z + c.z);
    });
    const innerTone = inner.map((p, i) => tone(p, self, higher[(i + 5) % 6] || higher[i] ? 0.93 : 1));
    const outerTone = outer.map((p, i) =>
      tone(p, cornerTiles(i), higher[(i + 5) % 6] || higher[i] ? 0.8 : 1),
    );
    type Quad = readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const lipTones = (
      [p0, p1, p2, p3]: Quad,
      shade: number,
    ): [THREE.Color, THREE.Color, THREE.Color, THREE.Color] => [
      tone(p0, self, shade),
      tone(p1, self, shade),
      tone(p2, self, shade),
      tone(p3, self, shade),
    ];
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      out.add(
        [middle, inner[i] as THREE.Vector3, inner[j] as THREE.Vector3],
        [own, innerTone[i] as THREE.Color, innerTone[j] as THREE.Color],
        Surface.grass,
        up,
      );
      out.quad(
        [inner[i], outer[i], outer[j], inner[j]] as [
          THREE.Vector3,
          THREE.Vector3,
          THREE.Vector3,
          THREE.Vector3,
        ],
        [innerTone[i], outerTone[i], outerTone[j], innerTone[j]] as [
          THREE.Color,
          THREE.Color,
          THREE.Color,
          THREE.Color,
        ],
        Surface.grass,
        up,
      );
    }

    // Sides: edge i runs from corner i to corner i + 1.
    for (let side = 0; side < 6; side++) {
      const other = near[side];
      if (other && other.elevation >= tile.elevation) continue;
      const a = corner(side),
        b = corner(side + 1);
      const angle = ((30 + 60 * side) * Math.PI) / 180;
      const facing = v(Math.cos(angle), 0, Math.sin(angle));
      const bottom = other ? other.elevation * LEVEL : base;
      const top = (p: { x: number; z: number }, height: number, out = 0) =>
        v(x + p.x + facing.x * out, height, z + p.z + facing.z * out);
      if (other) {
        // Terraces meeting at house fronts or paths get masonry; gardens meet with a planted earth bank.
        const masonry = hard(tile.edges[side]) || hard(other.edges[(side + 3) % 6]);
        const face = masonry
          ? stone.clone().multiplyScalar(0.94 + jitter(tile.q, tile.r, side + 3) * 0.08)
          : soilMid;
        const surface = masonry ? Surface.stone : Surface.soil;
        out.quad(
          [top(a, bottom), top(b, bottom), top(b, y), top(a, y)],
          [face.clone().multiplyScalar(0.8), face.clone().multiplyScalar(0.8), face, face],
          surface,
          facing,
        );
        if (masonry) {
          const lip = y + 0.05;
          const contract =
            pedestrianBoundaries?.get(key(tile.q, tile.r))?.find((p) => p.side === side) ??
            (tile.edges[side] === 'path'
              ? boundary(side, tile.paths[side] ?? 0, {
                  meet: tile.meets[side] ?? 'open',
                  rise: other.elevation - tile.elevation,
                })
              : undefined);
          const stairs = (contract?.opening ?? 0) > 0;
          const gap = (contract?.opening ?? 0) / (2 * Math.hypot(b.x - a.x, b.z - a.z));
          const spans = stairs
            ? [
                [0, 0.5 - gap],
                [0.5 + gap, 1],
              ]
            : [[0, 1]];
          for (const [from, to] of spans as [number, number][]) {
            const left = { x: a.x + (b.x - a.x) * from, z: a.z + (b.z - a.z) * from };
            const right = { x: a.x + (b.x - a.x) * to, z: a.z + (b.z - a.z) * to };
            out.quad(
              [top(left, lip, 0.04), top(right, lip, 0.04), top(right, lip, -0.1), top(left, lip, -0.1)],
              [coping, coping, coping, coping],
              Surface.concrete,
              up,
            );
            out.quad(
              [
                top(left, y - 0.05, 0.04),
                top(right, y - 0.05, 0.04),
                top(right, lip, 0.04),
                top(left, lip, 0.04),
              ],
              [coping, coping, coping, coping],
              Surface.concrete,
              facing,
            );
          }
        } else {
          const points = [
            top(a, y - 0.1, 0.03),
            top(b, y - 0.1, 0.03),
            top(b, y + 0.01, 0.03),
            top(a, y + 0.01, 0.03),
          ] as const;
          out.quad([...points], lipTones(points, 0.86), Surface.grass, facing);
        }
        continue;
      }
      // The edge of the neighborhood: a grass lip over earth that darkens toward the shared base.
      const points = [
        top(a, y - 0.09, 0.03),
        top(b, y - 0.09, 0.03),
        top(b, y + 0.01, 0.03),
        top(a, y + 0.01, 0.03),
      ] as const;
      out.quad([...points], lipTones(points, 0.85), Surface.grass, facing);
      const split = Math.max(bottom, y - 0.09 - (y - 0.09 - bottom) * 0.45);
      out.quad(
        [top(a, split), top(b, split), top(b, y - 0.09), top(a, y - 0.09)],
        [soilMid, soilMid, soilTop, soilTop],
        Surface.soil,
        facing,
      );
      out.quad(
        [top(a, bottom), top(b, bottom), top(b, split), top(a, split)],
        [soilDeep, soilDeep, soilMid, soilMid],
        Surface.soil,
        facing,
      );
    }
  }
  return out.geometry();
}

/**
 * Flat hexagonal rims for placement spots: a band `width` wide just inside each cell's edge, lying on the
 * cell's ground. Dashed rims leave gaps along every edge, so blocked spots differ by shape, not only color.
 */
export function rimGeometry(
  cells: readonly { q: number; r: number; elevation: number }[],
  { inset = 0.9, width = 0.09, dashed = false, lift = 0.03 } = {},
): THREE.BufferGeometry {
  const positions: number[] = [];
  const outer = HEX_RADIUS * inset;
  const inner = outer - width;
  const pieces = dashed
    ? [
        [0.08, 0.36],
        [0.64, 0.92],
      ]
    : [[0, 1]];
  for (const cell of cells) {
    const { x, z } = center(cell.q, cell.r);
    const y = cell.elevation * LEVEL + lift;
    for (let i = 0; i < 6; i++) {
      const a = corner(i, outer),
        b = corner(i + 1, outer);
      const c = corner(i, inner),
        d = corner(i + 1, inner);
      for (const [from, to] of pieces as [number, number][]) {
        const p = (u: { x: number; z: number }, v: { x: number; z: number }, t: number) => [
          x + u.x + (v.x - u.x) * t,
          y,
          z + u.z + (v.z - u.z) * t,
        ];
        const [o0, o1, i0, i1] = [p(a, b, from), p(a, b, to), p(c, d, from), p(c, d, to)];
        positions.push(...o0, ...i0, ...o1, ...o1, ...i0, ...i1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Translucent hex fills for placement spots, slightly inside their rims. */
export function fillGeometry(cells: readonly { q: number; r: number; elevation: number }[], inset = 0.88) {
  const positions: number[] = [];
  for (const cell of cells) {
    const { x, z } = center(cell.q, cell.r);
    const y = cell.elevation * LEVEL + 0.02;
    for (let i = 0; i < 6; i++) {
      const a = corner(i, HEX_RADIUS * inset),
        b = corner(i + 1, HEX_RADIUS * inset);
      positions.push(x, y, z, x + b.x, y, z + b.z, x + a.x, y, z + a.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A flat hexagon centered on the origin, for picking discs, previews, and highlights. */
export function hexagon(radius: number, thickness = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const c = corner(i, radius);
    // Shape space is XY; rotating -90° about X maps shape Y onto world -Z, so negate here.
    if (i === 0) shape.moveTo(c.x, -c.z);
    else shape.lineTo(c.x, -c.z);
  }
  shape.closePath();
  const geometry =
    thickness > 0
      ? new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
      : new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
