import { describe, expect, it } from 'vitest';
import { type Edges, type HandTile, rotateEdges, rotateSides, type Tile } from '../src/domain';
import {
  center,
  corner,
  DIRECTIONS,
  edgeAngle,
  HEX,
  hexAt,
  INRADIUS,
  key,
  neighbor,
} from '../src/render/hex';
import { realCore, validMoves } from './core-fixture';

function disc(radius: number) {
  const hexes: { q: number; r: number }[] = [];
  for (let q = -radius; q <= radius; q++)
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++)
      hexes.push({ q, r });
  return hexes;
}

describe('hex layout', () => {
  it('finds the hex under every center and just inside every corner', () => {
    for (const hex of disc(8)) {
      const c = center(hex.q, hex.r);
      expect(hexAt(c.x, c.z)).toEqual(hex);
      for (let i = 0; i < 6; i++) {
        const p = corner(i, HEX * 0.9);
        expect(hexAt(c.x + p.x, c.z + p.z)).toEqual(hex);
      }
    }
  });

  it('puts each neighbor across edge i at twice the inradius along edgeAngle(i)', () => {
    for (const hex of disc(3))
      for (let side = 0; side < 6; side++) {
        const a = center(hex.q, hex.r);
        const n = neighbor(hex, side);
        expect(n).toEqual({ q: hex.q + (DIRECTIONS[side]?.q ?? 0), r: hex.r + (DIRECTIONS[side]?.r ?? 0) });
        const b = center(n.q, n.r);
        expect(b.x - a.x).toBeCloseTo(Math.cos(edgeAngle(side)) * 2 * INRADIUS, 9);
        expect(b.z - a.z).toBeCloseTo(Math.sin(edgeAngle(side)) * 2 * INRADIUS, 9);
      }
  });

  it('spans edge i between corners i and i + 1, at the inradius', () => {
    for (let side = 0; side < 6; side++) {
      const a = corner(side),
        b = corner(side + 1);
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      expect(Math.hypot(a.x, a.z)).toBeCloseTo(HEX, 9);
      expect(Math.hypot(mid.x, mid.z)).toBeCloseTo(INRADIUS, 9);
      expect(Math.atan2(mid.z, mid.x)).toBeCloseTo(
        Math.atan2(Math.sin(edgeAngle(side)), Math.cos(edgeAngle(side))),
        9,
      );
    }
  });

  it('lists the six neighbor directions in edge order, each the opposite of side + 3', () => {
    expect(DIRECTIONS).toHaveLength(6);
    expect(new Set(DIRECTIONS.map((d) => key(d.q, d.r))).size).toBe(6);
    for (let side = 0; side < 6; side++) {
      const d = DIRECTIONS[side] as { q: number; r: number };
      const back = DIRECTIONS[(side + 3) % 6] as { q: number; r: number };
      expect({ q: d.q + back.q, r: d.r + back.r }).toEqual({ q: 0, r: 0 });
      // Every neighbor is one step away in cube distance.
      expect(Math.max(Math.abs(d.q), Math.abs(d.r), Math.abs(-d.q - d.r))).toBe(1);
      for (const hex of disc(2)) expect(neighbor(neighbor(hex, side), side + 3)).toEqual(hex);
    }
    expect(neighbor({ q: 0, r: 0 }, -1)).toEqual(neighbor({ q: 0, r: 0 }, 5));
  });

  it('rotates per-side data like the Rust core: side i moves to i + rotation', () => {
    const original = [0, 1, 2, 3, 4, 5];
    expect(rotateSides(original, 1)).toEqual([5, 0, 1, 2, 3, 4]);
    expect(rotateSides(original, 2)).toEqual([4, 5, 0, 1, 2, 3]);
    for (let rotation = 0; rotation < 12; rotation++) {
      const rotated = rotateSides(original, rotation);
      for (let side = 0; side < 6; side++) expect(rotated[(side + rotation) % 6]).toBe(original[side]);
      expect(rotateSides(rotated, 6 - (rotation % 6))).toEqual(original);
    }
  });

  it('rotates edges like the Rust core: result[(side + rotation) % 6] is the original side', () => {
    // The pattern from tile.rs `rotation_moves_each_edge_one_side_per_step`.
    const original: Edges = ['path', 'homes', 'nature', 'nature', 'nature', 'water'];
    const once = rotateEdges(original, 1);
    expect(once[1]).toBe('path');
    expect(once[0]).toBe('water');
    for (let rotation = 0; rotation < 12; rotation++) {
      const rotated = rotateEdges(original, rotation);
      for (let side = 0; side < 6; side++) expect(rotated[(side + rotation) % 6]).toBe(original[side]);
    }
    expect(rotateEdges(original, 6)).toEqual(original);
  });

  it('agrees with the Rust core on edges, paths and entrances of every placed tile', () => {
    const core = realCore(5);
    let checked = 0;
    for (let step = 0; step < 12; step++) {
      const before = core.snapshot();
      const hand = before.current as HandTile;
      const move = validMoves(core, before)[step * 7] ?? validMoves(core, before)[0];
      if (!move) throw new Error('No valid move');
      const after = core.command({ type: 'place', q: move.q, r: move.r, rotation: move.rotation }).snapshot;
      const placed = after.tiles.find((tile) => tile.q === move.q && tile.r === move.r) as Tile;
      expect(placed.kind).toBe(hand.kind);
      expect(placed.rotation).toBe(move.rotation);
      expect(placed.edges).toEqual(rotateEdges(hand.edges, move.rotation));
      expect(placed.paths).toEqual(rotateSides(hand.paths, move.rotation));
      expect(placed.entrances).toEqual(rotateSides(hand.entrances, move.rotation));
      // Every placed tile sits on one of the six neighbors of an earlier tile.
      expect(
        DIRECTIONS.some((d) => before.tiles.some((t) => t.q === move.q + d.q && t.r === move.r + d.r)),
      ).toBe(true);
      checked++;
    }
    expect(checked).toBe(12);
  });
});
