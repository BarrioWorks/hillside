import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Tile } from '../src/domain';
import { fillGeometry, groundGeometry, rimGeometry } from '../src/render/ground';
import { center, corner, DIRECTIONS, edgeAngle, HEX, hexAt, key, LEVEL, SKIRT } from '../src/render/hex';
import { Surface } from '../src/render/palette';
import { COPING, PATH_WIDTH } from '../src/render/tiles';
import { realCore } from './core-fixture';

interface Triangle {
  points: [number, number, number][];
  normal: [number, number, number];
  surface: number;
  centroid: { x: number; y: number; z: number };
}

function triangles(geometry: THREE.BufferGeometry): Triangle[] {
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal'),
    surface = geometry.getAttribute('surface');
  const out: Triangle[] = [];
  for (let i = 0; i < position.count; i += 3) {
    const points = [0, 1, 2].map((k) => [
      position.getX(i + k),
      position.getY(i + k),
      position.getZ(i + k),
    ]) as [number, number, number][];
    const centroid = { x: 0, y: 0, z: 0 };
    for (const [x, y, z] of points) {
      centroid.x += x / 3;
      centroid.y += y / 3;
      centroid.z += z / 3;
    }
    out.push({
      points,
      normal: [normal.getX(i), normal.getY(i), normal.getZ(i)],
      surface: surface.getX(i),
      centroid,
    });
  }
  return out;
}

const isTop = (t: Triangle) => t.normal[1] === 1 && t.surface === Surface.grass;
const owner = (t: Triangle) => hexAt(t.centroid.x, t.centroid.z);
const tileAt = (tiles: readonly Tile[], q: number, r: number) =>
  tiles.find((tile) => tile.q === q && tile.r === r);

/** Side triangles facing out of `tile` across `side`, close to that edge. */
function wall(all: Triangle[], tile: Tile, side: number): Triangle[] {
  const c = center(tile.q, tile.r);
  const a = corner(side),
    b = corner(side + 1);
  const mid = { x: c.x + (a.x + b.x) / 2, z: c.z + (a.z + b.z) / 2 };
  const angle = edgeAngle(side);
  return all.filter(
    (t) =>
      Math.abs(t.normal[0] - Math.cos(angle)) < 1e-6 &&
      Math.abs(t.normal[2] - Math.sin(angle)) < 1e-6 &&
      Math.hypot(t.centroid.x - mid.x, t.centroid.z - mid.z) < HEX * 0.6,
  );
}

/** Pairs of placed tiles across `side`, filtered by the elevation step from `tile` down to `other`. */
function pairs(tiles: readonly Tile[], drop: (step: number) => boolean) {
  const out: { tile: Tile; other: Tile; side: number }[] = [];
  for (const tile of tiles)
    DIRECTIONS.forEach((d, side) => {
      const other = tileAt(tiles, tile.q + d.q, tile.r + d.r);
      if (other && drop(tile.elevation - other.elevation)) out.push({ tile, other, side });
    });
  return out;
}

describe('continuous terraced ground', () => {
  const opening = realCore().snapshot().tiles;
  const early = realCore(2026).command({ type: 'autoplay', count: 10 }).snapshot.tiles;
  const grown = realCore(3).command({ type: 'autoplay', count: 30 }).snapshot.tiles;

  it.each([
    ['opening', opening],
    ['grown', grown],
  ])('builds finite geometry with color and surface on every vertex (%s)', (_, tiles) => {
    const geometry = groundGeometry(tiles);
    const position = geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(0);
    expect(position.count % 3).toBe(0);
    expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
    expect(geometry.getAttribute('color').count).toBe(position.count);
    expect(geometry.getAttribute('surface').count).toBe(position.count);
    expect(geometry.getAttribute('normal').count).toBe(position.count);
  });

  it.each([
    ['opening', opening],
    ['grown', grown],
  ])('lays every tile top flat at elevation × LEVEL (%s)', (_, tiles) => {
    const all = triangles(groundGeometry(tiles));
    for (const tile of tiles) {
      const tops = all.filter((t) => isTop(t) && owner(t).q === tile.q && owner(t).r === tile.r);
      expect(tops).toHaveLength(18);
      for (const t of tops) for (const [, y] of t.points) expect(y).toBeCloseTo(tile.elevation * LEVEL, 5);
    }
  });

  it.each([
    ['early', early],
    ['grown', grown],
  ])('joins same-level neighbors at identical corners with no wall between them (%s)', (_, tiles) => {
    const all = triangles(groundGeometry(tiles));
    const level = pairs(tiles, (step) => step === 0);
    expect(level.length).toBeGreaterThan(0);
    const cornersOf = (tile: Tile) =>
      all.filter((t) => isTop(t) && owner(t).q === tile.q && owner(t).r === tile.r).flatMap((t) => t.points);
    // Float32 vertices written separately by each tile; they may differ only by rounding (~1e-16 here).
    const near = (points: [number, number, number][], x: number, y: number, z: number) =>
      points.some(
        ([px, py, pz]) => Math.abs(px - x) < 1e-6 && Math.abs(py - y) < 1e-6 && Math.abs(pz - z) < 1e-6,
      );
    for (const { tile, other, side } of level) {
      const c = center(tile.q, tile.r);
      const mine = cornersOf(tile),
        theirs = cornersOf(other);
      const y = tile.elevation * LEVEL;
      for (const i of [side, side + 1]) {
        const p = corner(i);
        expect(near(mine, c.x + p.x, y, c.z + p.z), `corner ${i} of ${tile.q},${tile.r}`).toBe(true);
        expect(near(theirs, c.x + p.x, y, c.z + p.z), `seam with ${other.q},${other.r}`).toBe(true);
      }
      expect(wall(all, tile, side)).toHaveLength(0);
      expect(wall(all, other, (side + 3) % 6)).toHaveLength(0);
    }
  });

  it.each([
    ['early', early],
    ['grown', grown],
  ])('drops a retaining wall exactly to a lower neighbor and none from the lower side (%s)', (_, tiles) => {
    const all = triangles(groundGeometry(tiles));
    const steps = pairs(tiles, (step) => step > 0);
    expect(steps.length).toBeGreaterThan(0);
    for (const { tile, other, side } of steps) {
      const faces = wall(all, tile, side);
      expect(faces.length).toBeGreaterThanOrEqual(2);
      const ys = faces.flatMap((t) => t.points.map(([, y]) => y));
      expect(Math.min(...ys)).toBeCloseTo(other.elevation * LEVEL, 5);
      expect(Math.max(...ys)).toBeGreaterThanOrEqual(tile.elevation * LEVEL - 1e-5);
      expect(wall(all, other, (side + 3) % 6)).toHaveLength(0);
    }
  });

  it.each([
    ['opening', opening],
    ['grown', grown],
  ])('takes every exposed side down to one shared base (%s)', (_, tiles) => {
    const all = triangles(groundGeometry(tiles));
    const base = Math.min(...tiles.map((tile) => tile.elevation)) * LEVEL - SKIRT;
    let exposed = 0;
    for (const tile of tiles)
      DIRECTIONS.forEach((d, side) => {
        if (tileAt(tiles, tile.q + d.q, tile.r + d.r)) return;
        exposed++;
        const ys = wall(all, tile, side).flatMap((t) => t.points.map(([, y]) => y));
        expect(Math.min(...ys)).toBeCloseTo(base, 5);
        expect(Math.max(...ys)).toBeCloseTo(tile.elevation * LEVEL + 0.01, 5);
      });
    expect(exposed).toBeGreaterThan(0);
    expect(Math.min(...all.flatMap((t) => t.points.map(([, y]) => y)))).toBeCloseTo(base, 5);
  });
});

it('leaves both coping faces open across every matched staircase', () => {
  let seams = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const { tiles } = realCore(seed).command({ type: 'autoplay', count: 40 }).snapshot;
    const all = triangles(groundGeometry(tiles));
    for (const { tile, other, side } of pairs(tiles, (step) => step === 1)) {
      if (
        tile.edges[side] !== 'path' ||
        other.edges[(side + 3) % 6] !== 'path' ||
        tile.meets[side] !== 'match'
      )
        continue;
      const c = center(tile.q, tile.r),
        angle = edgeAngle(side);
      const normal = { x: Math.cos(angle), z: Math.sin(angle) };
      const mid = {
        x: c.x + (normal.x * HEX * Math.sqrt(3)) / 2,
        z: c.z + (normal.z * HEX * Math.sqrt(3)) / 2,
      };
      const top = tile.elevation * LEVEL;
      for (const triangle of all) {
        if (triangle.surface !== Surface.concrete || !triangle.points.some(([, y]) => y > top + 0.045))
          continue;
        const projected = triangle.points.map(([x, , z]) => ({
          normal: (x - mid.x) * normal.x + (z - mid.z) * normal.z,
          along: -(x - mid.x) * normal.z + (z - mid.z) * normal.x,
        }));
        if (!projected.every((p) => p.normal >= -0.101 && p.normal <= 0.041)) continue;
        const left = Math.min(...projected.map((p) => p.along)),
          right = Math.max(...projected.map((p) => p.along));
        expect(
          left >= (PATH_WIDTH + COPING) / 2 - 1e-5 || right <= -(PATH_WIDTH + COPING) / 2 + 1e-5,
          `${seed} stair ${tile.q},${tile.r}/${side}`,
        ).toBe(true);
      }
      seams++;
    }
  }
  expect(seams).toBeGreaterThan(0);
});

describe('placement rims', () => {
  const snapshot = realCore(3).command({ type: 'autoplay', count: 12 }).snapshot;
  const frontier = snapshot.frontier;
  const centroids = (geometry: THREE.BufferGeometry) => {
    const position = geometry.getAttribute('position');
    return Array.from({ length: position.count / 3 }, (_, t) => {
      const c = { x: 0, y: 0, z: 0 };
      for (let k = 0; k < 3; k++) {
        c.x += position.getX(t * 3 + k) / 3;
        c.y += position.getY(t * 3 + k) / 3;
        c.z += position.getZ(t * 3 + k) / 3;
      }
      return c;
    });
  };
  const count = (geometry: THREE.BufferGeometry) => geometry.getAttribute('position').count / 3;

  it('draws dashed rims with gaps, so they differ from solid rims by shape', () => {
    const one = [{ q: 0, r: 0, elevation: 0 }];
    const solid = rimGeometry(one),
      dashed = rimGeometry(one, { dashed: true });
    expect(count(solid)).toBe(6 * 2);
    expect(count(dashed)).toBe(6 * 2 * 2);
    expect(count(dashed)).not.toBe(count(solid));
    // A solid rim covers each edge's midpoint; a dashed rim leaves a gap there.
    const covers = (geometry: THREE.BufferGeometry, x: number, z: number) => {
      const p = geometry.getAttribute('position');
      for (let i = 0; i < p.count; i += 3) {
        const [ax, az, bx, bz, cx, cz] = [
          p.getX(i),
          p.getZ(i),
          p.getX(i + 1),
          p.getZ(i + 1),
          p.getX(i + 2),
          p.getZ(i + 2),
        ];
        const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
        const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
        const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
        const negative = d1 < 0 || d2 < 0 || d3 < 0,
          positive = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(negative && positive)) return true;
      }
      return false;
    };
    for (let side = 0; side < 6; side++) {
      const a = corner(side, HEX * 0.9 - 0.045),
        b = corner(side + 1, HEX * 0.9 - 0.045);
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      expect(covers(solid, mid.x, mid.z), `side ${side}`).toBe(true);
      expect(covers(dashed, mid.x, mid.z), `side ${side}`).toBe(false);
      // Both still outline the edge a quarter of the way along.
      const quarter = { x: a.x + (b.x - a.x) * 0.25, z: a.z + (b.z - a.z) * 0.25 };
      expect(covers(dashed, quarter.x, quarter.z), `side ${side}`).toBe(true);
    }
  });

  it('outlines frontier cells only, at their own height, never over a placed tile', () => {
    const open = new Set(frontier.map((spot) => key(spot.q, spot.r)));
    const taken = new Set(snapshot.tiles.map((tile) => key(tile.q, tile.r)));
    const playable = frontier.filter((spot) => spot.playable),
      blocked = frontier.filter((spot) => !spot.playable);
    expect(playable.length + blocked.length).toBe(frontier.length);
    for (const geometry of [
      rimGeometry(playable),
      rimGeometry(blocked, { dashed: true }),
      fillGeometry(frontier),
    ]) {
      for (const c of centroids(geometry)) {
        const hex = hexAt(c.x, c.z);
        expect(open.has(key(hex.q, hex.r))).toBe(true);
        expect(taken.has(key(hex.q, hex.r))).toBe(false);
        const spot = frontier.find((s) => s.q === hex.q && s.r === hex.r);
        expect(c.y).toBeGreaterThan((spot?.elevation ?? 0) * LEVEL);
        expect(c.y).toBeLessThan((spot?.elevation ?? 0) * LEVEL + 0.05);
      }
    }
    expect(count(rimGeometry(frontier))).toBe(frontier.length * 12);
    expect(count(fillGeometry(frontier))).toBe(frontier.length * 6);
    expect(count(rimGeometry([]))).toBe(0);
  });
});
