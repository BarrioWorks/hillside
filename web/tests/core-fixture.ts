import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { wrapGame } from '../src/core';
import type { CorePort, Region, Snapshot, Tile } from '../src/domain';
import { DIRECTIONS, key } from '../src/render/hex';
import type { SideState, TileSite } from '../src/render/tiles';
import { Game, initSync } from '../src/wasm/barrio_core';

initSync({
  module: readFileSync(
    resolve(
      process.cwd(),
      process.cwd().endsWith('/web') ? 'src/wasm/barrio_core_bg.wasm' : 'web/src/wasm/barrio_core_bg.wasm',
    ),
  ),
});
export function realCore(seed = 2026) {
  return wrapGame(new Game(seed));
}

/** How each side of a placed tile meets its neighbor, as the world renderer computes it. */
export function sidesOf(tile: Tile, tiles: readonly Tile[]): SideState[] {
  const byKey = new Map(tiles.map((other) => [key(other.q, other.r), other]));
  return DIRECTIONS.map((d, side) => {
    const other = byKey.get(key(tile.q + d.q, tile.r + d.r));
    return { meet: tile.meets[side] ?? 'open', rise: other ? other.elevation - tile.elevation : 0 };
  });
}

/** A placed tile as the renderer dresses it. */
export function siteOf(tile: Tile, region: Region): TileSite {
  return { ...tile, region };
}

export interface Move {
  q: number;
  r: number;
  rotation: number;
}

/** Every valid placement of the tile in hand, with its preview. */
export function validMoves(core: CorePort, snapshot: Snapshot = core.snapshot()) {
  const moves: (Move & { preview: ReturnType<CorePort['preview']> })[] = [];
  for (const spot of snapshot.frontier)
    for (let rotation = 0; rotation < 6; rotation++) {
      const preview = core.preview(spot.q, spot.r, rotation);
      if (preview.valid) moves.push({ q: spot.q, r: spot.r, rotation, preview });
    }
  return moves;
}

/** Drops the revision counter, which differs between games that reached the same state differently. */
export function withoutRevision(snapshot: Snapshot): Omit<Snapshot, 'revision'> {
  const { revision: _, ...rest } = snapshot;
  return rest;
}
