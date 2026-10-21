import { describe, expect, it } from 'vitest';
import type { CorePort, Meet, Points, Snapshot, Tile } from '../src/domain';
import { DIRECTIONS, key } from '../src/render/hex';
import { realCore, validMoves, withoutRevision } from './core-fixture';

const DECK = 30;
const SEEDS = [1, 2, 3, 7, 2026];

/** The meeting rule from `tile.rs`: water only meets water; paths a cliff apart are steep. */
function expectedMeet(own: string, other: string, rise: number): Meet {
  if (own === 'water' && other === 'water') return 'match';
  if (own === 'water' || other === 'water') return 'blocked';
  if (own === 'path' && other === 'path' && rise >= 2) return 'steep';
  return own === other ? 'match' : 'differ';
}

/** Plays a whole run by hand, taking the best-scoring placement each turn, and records every award. */
function playToTheEnd(seed: number) {
  const core = realCore(seed);
  const awards: { preview: Points; awarded: Points; questPoints: number; before: number; after: number }[] =
    [];
  let snapshot = core.snapshot();
  while (!snapshot.finished) {
    const moves = validMoves(core, snapshot);
    if (moves.length === 0) throw new Error(`seed ${seed}: the tile in hand fits nowhere`);
    const best = moves.reduce((a, b) => (b.preview.points.total > a.preview.points.total ? b : a));
    const result = core.command({ type: 'place', q: best.q, r: best.r, rotation: best.rotation });
    expect(result.ok, result.message).toBe(true);
    expect(result.snapshot.last?.q).toBe(best.q);
    expect(result.snapshot.last?.r).toBe(best.r);
    const placed = result.snapshot.tiles.find((tile) => tile.q === best.q && tile.r === best.r) as Tile;
    // Right after placement, the tile meets its neighbors exactly as the preview said.
    expect(placed.meets).toEqual(best.preview.sides.map((side) => side.meet));
    expect(placed.elevation).toBe(best.preview.elevation);
    awards.push({
      preview: best.preview.points,
      awarded: result.snapshot.last?.points as Points,
      questPoints: result.snapshot.last?.questPoints ?? NaN,
      before: snapshot.score,
      after: result.snapshot.score,
    });
    snapshot = result.snapshot;
  }
  return { core, snapshot, awards };
}

describe('classic runs against the real Rust core', () => {
  const runs = SEEDS.map((seed) => ({ seed, ...playToTheEnd(seed) }));

  it.each(runs)(
    'seed $seed awards exactly the previewed points on every placement',
    ({ awards, snapshot }) => {
      expect(awards).toHaveLength(DECK + snapshot.rewards - snapshot.discarded);
      for (const [index, { preview, awarded, questPoints, before, after }] of awards.entries()) {
        // Quest points come on top of the previewed placement points, never instead of them.
        expect(after - before, `placement ${index + 1}`).toBe(preview.total + questPoints);
        expect(awarded, `placement ${index + 1}`).toEqual(preview);
        expect(preview.total).toBe(
          preview.base + preview.matchPoints + (preview.perfect ? preview.perfectBonus : 0),
        );
        expect(preview.base).toBe(10);
        expect(preview.matchPoints).toBe(20 * preview.matches);
        expect(preview.perfectBonus).toBe(preview.perfect ? 60 : 0);
        // Perfect means six neighbors, all six matching.
        if (preview.perfect) expect(preview.matches).toBe(6);
      }
    },
  );

  it.each(runs)('seed $seed scores the sum of all awards and quest rewards', ({ snapshot, awards }) => {
    expect(snapshot.score).toBe(
      awards.reduce((sum, { awarded, questPoints }) => sum + awarded.total + questPoints, 0),
    );
    expect(snapshot.placements).toBe(awards.length);
  });

  it.each(runs)('seed $seed never breaks a meeting rule', ({ snapshot }) => {
    const byKey = new Map<string, Tile>(snapshot.tiles.map((tile) => [key(tile.q, tile.r), tile]));
    expect(byKey.size).toBe(snapshot.tiles.length);
    for (const tile of snapshot.tiles)
      DIRECTIONS.forEach((d, side) => {
        const other = byKey.get(key(tile.q + d.q, tile.r + d.r));
        const where = `${tile.q},${tile.r} side ${side}`;
        if (!other) {
          expect(tile.meets[side], where).toBe('open');
          return;
        }
        const meet = expectedMeet(
          tile.edges[side] as string,
          other.edges[(side + 3) % 6] as string,
          Math.abs(tile.elevation - other.elevation),
        );
        expect(meet, where).not.toBe('blocked');
        expect(tile.meets[side], where).toBe(meet);
        expect(other.meets[(side + 3) % 6], where).toBe(meet);
      });
  });

  it.each(runs)('seed $seed offers only open hexes beside the neighborhood', ({ snapshot }) => {
    const occupied = new Set(snapshot.tiles.map((tile) => key(tile.q, tile.r)));
    expect(new Set(snapshot.frontier.map((ground) => key(ground.q, ground.r))).size).toBe(
      snapshot.frontier.length,
    );
    for (const ground of snapshot.frontier) {
      expect(occupied.has(key(ground.q, ground.r))).toBe(false);
      expect(DIRECTIONS.some((d) => occupied.has(key(ground.q + d.q, ground.r + d.r)))).toBe(true);
    }
    expect(snapshot.stats.tiles).toBe(snapshot.tiles.length);
    expect(snapshot.stats.homesConnected).toBeLessThanOrEqual(snapshot.stats.homes);
  });
});

/** Plays the best move until some frontier spot refuses the tile in hand because of water. */
function findWaterRefusal(core: CorePort) {
  for (let step = 0; step < DECK; step++) {
    const snapshot = core.snapshot();
    if (snapshot.finished) return null;
    for (const spot of snapshot.frontier)
      for (let rotation = 0; rotation < 6; rotation++) {
        const preview = core.preview(spot.q, spot.r, rotation);
        if (!preview.valid && preview.sides.some((side) => side.meet === 'blocked'))
          return { snapshot, q: spot.q, r: spot.r, rotation, preview };
      }
    const moves = validMoves(core, snapshot);
    const move = moves[step % moves.length];
    if (!move) return null;
    core.command({ type: 'place', q: move.q, r: move.r, rotation: move.rotation });
  }
  return null;
}

describe('water continuity end to end', () => {
  it('refuses a placement that would block a stream, explains why, and changes nothing', () => {
    let found: ReturnType<typeof findWaterRefusal> = null;
    let core: CorePort = realCore();
    for (let seed = 1; seed <= 40 && !found; seed++) {
      core = realCore(seed);
      found = findWaterRefusal(core);
    }
    if (!found) throw new Error('No seed produced a stream that refuses the tile in hand.');
    const { snapshot, q, r, rotation, preview } = found;
    expect(preview.valid).toBe(false);
    expect(preview.reason).toMatch(/water|stream/i);
    // The blocked side really does put water against land, one way or the other.
    for (const side of preview.sides.filter((s) => s.meet === 'blocked')) {
      expect(side.neighbor).not.toBeNull();
      expect([side.edge, side.neighbor].filter((edge) => edge === 'water')).toHaveLength(1);
    }
    const save = core.save();
    const result = core.command({ type: 'place', q, r, rotation });
    expect(result.ok).toBe(false);
    expect(result.message).toBe(preview.reason);
    expect(result.snapshot).toEqual(snapshot);
    expect(core.snapshot()).toEqual(snapshot);
    expect(core.save()).toBe(save);
  });
});

describe('the deck', () => {
  it('skips once per run: the tile goes to the back, no points, the deck keeps its size', () => {
    const core = realCore(3);
    core.command({ type: 'autoplay', count: 2 });
    const before = core.snapshot();
    expect(before.canSkip).toBe(true);
    expect(before.skipUsed).toBe(false);
    const skipped = before.current;
    const result = core.command({ type: 'skip' });
    expect(result.ok, result.message).toBe(true);
    const after = result.snapshot;
    expect(after.current).toEqual(before.upcoming[0]);
    expect(after.upcoming[0]).toEqual(before.upcoming[1]);
    expect(after.remaining).toBe(before.remaining);
    expect(after.score).toBe(before.score);
    expect(after.placements).toBe(before.placements);
    expect(after.tiles).toEqual(before.tiles);
    expect(after.canSkip).toBe(false);
    expect(after.skipUsed).toBe(true);
    const again = core.command({ type: 'skip' });
    expect(again.ok).toBe(false);
    expect(withoutRevision(core.snapshot())).toEqual(withoutRevision(after));
    // Reward tiles earned after the skip go behind the skipped tile, so it comes back into hand once only
    // those are left behind it (unless a recovery reordered the deck).
    let behind = 0;
    let state = after;
    while (state.remaining > behind + 1) {
      state = core.command({ type: 'autoplay', count: 1 }).snapshot;
      behind += (state.last?.completed ?? []).reduce((sum, done) => sum + done.tilesAdded, 0);
    }
    expect(state.recoveries).toBe(0);
    expect(state.remaining).toBe(behind + 1);
    expect(state.current).toEqual(skipped);
  });

  it('finishes the run when the deck is empty and refuses more tiles', () => {
    const core = realCore(2026);
    const fresh = core.snapshot();
    expect(fresh.tiles).toHaveLength(1);
    expect(fresh.tiles[0]?.kind).toBe('inicio');
    expect(fresh.tiles[0]).toMatchObject({ q: 0, r: 0 });
    expect(fresh.remaining).toBe(DECK);
    expect(fresh.upcoming).toHaveLength(2);
    expect(fresh.finished).toBe(false);
    const result = core.command({ type: 'autoplay', count: 400 });
    expect(result.ok, result.message).toBe(true);
    const done = result.snapshot;
    expect(done.finished).toBe(true);
    expect(done.remaining).toBe(0);
    expect(done.current).toBeNull();
    expect(done.upcoming).toEqual([]);
    expect(done.end).toBe('deckEmpty');
    expect(done.placements).toBe(DECK + done.rewards - done.discarded);
    expect(done.tiles).toHaveLength(done.placements + 1);
    expect(done.canSkip).toBe(false);
    const spot = done.frontier[0] as { q: number; r: number };
    for (let rotation = 0; rotation < 6; rotation++)
      expect(core.preview(spot.q, spot.r, rotation).valid).toBe(false);
    expect(core.command({ type: 'place', q: spot.q, r: spot.r, rotation: 0 }).ok).toBe(false);
    expect(core.command({ type: 'autoplay', count: 1 }).ok).toBe(false);
    expect(core.command({ type: 'skip' }).ok).toBe(false);
    expect(core.command({ type: 'finish' }).ok).toBe(false);
    expect(withoutRevision(core.snapshot())).toEqual(withoutRevision(done));
  });
});

describe('saves and seeds', () => {
  function play(seed: number): CorePort {
    const core = realCore(seed);
    core.command({ type: 'autoplay', count: 4 });
    core.command({ type: 'skip' });
    core.command({ type: 'autoplay', count: 9 });
    return core;
  }

  it('saves a version 3 run that loads into another game as the identical state', () => {
    const core = play(77);
    const save = core.save();
    const parsed = JSON.parse(save) as { version: number; rules: string; seed: number; actions: unknown[] };
    expect(parsed.version).toBe(3);
    expect(parsed.rules).toBe(core.snapshot().rules);
    expect(parsed.seed).toBe(77);
    expect(parsed.actions).toHaveLength(14);
    const other = realCore(1);
    const result = other.load(save);
    expect(result.ok, result.message).toBe(true);
    expect(withoutRevision(result.snapshot)).toEqual(withoutRevision(core.snapshot()));
    expect(withoutRevision(other.snapshot())).toEqual(withoutRevision(core.snapshot()));
    expect(other.save()).toBe(save);
    // The restored run keeps playing exactly like the original.
    const next = (game: CorePort) => withoutRevision(game.command({ type: 'autoplay', count: 5 }).snapshot);
    expect(next(other)).toEqual(next(core));
  });

  it('replays the same seed to the same run, and a different seed to a different one', () => {
    const a: Snapshot = play(31).snapshot();
    const b: Snapshot = play(31).snapshot();
    expect(withoutRevision(b)).toEqual(withoutRevision(a));
    expect(realCore(31).snapshot()).toEqual(realCore(31).snapshot());
    expect(withoutRevision(play(32).snapshot())).not.toEqual(withoutRevision(a));
  });

  it('starts a new game that matches a fresh core of that seed', () => {
    const core = play(5);
    const result = core.command({ type: 'newGame', seed: 12 });
    expect(result.ok, result.message).toBe(true);
    expect(withoutRevision(result.snapshot)).toEqual(withoutRevision(realCore(12).snapshot()));
  });
});
