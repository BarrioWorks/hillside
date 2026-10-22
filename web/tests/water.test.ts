import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Tile } from '../src/domain';
import { center, DIRECTIONS, edgeAngle, INRADIUS, key, LEVEL } from '../src/render/hex';
import { Surface } from '../src/render/palette';
import { type SideState, TileKit } from '../src/render/tiles';
import { realCore } from './core-fixture';

function waterPoints(
  tile: Tile,
  region: Parameters<TileKit['compose']>[0]['region'],
  tiles: Map<string, Tile>,
  kit: TileKit,
): THREE.Vector3[] {
  const sides: SideState[] = DIRECTIONS.map((d, side) => {
    const other = tiles.get(key(tile.q + d.q, tile.r + d.r));
    return { meet: tile.meets[side] ?? 'open', rise: other ? other.elevation - tile.elevation : 0 };
  });
  const c = center(tile.q, tile.r);
  const points: THREE.Vector3[] = [];
  for (const part of kit.compose({ ...tile, region }, sides)) {
    const surface = part.geometry.getAttribute('surface');
    const position = part.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++)
      if (surface.getX(i) === Surface.water)
        points.push(
          new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i))
            .applyMatrix4(part.matrix)
            .add(new THREE.Vector3(c.x, tile.elevation * LEVEL, c.z)),
        );
  }
  return points;
}

function seam(points: readonly THREE.Vector3[], tile: Tile, side: number): string[] {
  const c = center(tile.q, tile.r),
    angle = edgeAngle(side);
  const onEdge = points.filter(
    (p) => Math.abs((p.x - c.x) * Math.cos(angle) + (p.z - c.z) * Math.sin(angle) - INRADIUS) < 1e-5,
  );
  return [
    ...new Set(onEdge.map((p) => [p.x, p.y, p.z].map((v) => Math.round(v * 1e4) / 1e4).join(','))),
  ].sort();
}

describe('river continuity in actual composed boards', () => {
  it('joins channel endpoints at equal width and elevation across matched water edges', () => {
    const kit = new TileKit();
    let checked = 0;
    for (const seed of [909352, 2, 1, 3, 4, 2026]) {
      const snapshot = realCore(seed).command({ type: 'autoplay', count: 45 }).snapshot;
      const tiles = new Map(snapshot.tiles.map((t) => [key(t.q, t.r), t]));
      const points = new Map(
        snapshot.tiles
          .filter((t) => t.edges.includes('water'))
          .map((t) => [key(t.q, t.r), waterPoints(t, snapshot.region, tiles, kit)]),
      );
      for (const tile of snapshot.tiles)
        for (const [side, d] of DIRECTIONS.entries()) {
          if (tile.edges[side] !== 'water' || tile.meets[side] !== 'match') continue;
          const other = tiles.get(key(tile.q + d.q, tile.r + d.r));
          if (!other || other.elevation !== tile.elevation || other.edges[(side + 3) % 6] !== 'water')
            continue;
          const a = seam(points.get(key(tile.q, tile.r)) ?? [], tile, side);
          const b = seam(points.get(key(other.q, other.r)) ?? [], other, (side + 3) % 6);
          expect(
            a.length,
            `seed ${seed}: channel missing at ${key(tile.q, tile.r)} side ${side}`,
          ).toBeGreaterThanOrEqual(2);
          expect(a, `seed ${seed}: water seam ${key(tile.q, tile.r)} / ${key(other.q, other.r)}`).toEqual(b);
          checked++;
        }
    }
    expect(checked).toBeGreaterThan(0);
    kit.dispose();
  });
});
