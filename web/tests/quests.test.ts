import { describe, expect, it } from 'vitest';
import type { CorePort, HandTile, Preview, Quest, Snapshot, Stats } from '../src/domain';
import { type Move, realCore, validMoves, withoutRevision } from './core-fixture';

const DECK = 30;
const CAP = 60;
const SEEDS = [1, 2, 3, 7, 12, 2026];
const LADDER = {
  residential: [5, 12, 25],
  nature: [5, 12, 25],
  water: [3, 5, 8],
} as const;
const REWARDS = [
  { points: 150, tiles: 3 },
  { points: 350, tiles: 3 },
  { points: 750, tiles: 5 },
] as const;
const TIERS = ['small', 'medium', 'large'] as const;
const FAMILIES = ['residential', 'nature', 'water'] as const;

/** What each quest family measures, from the snapshot's stats. */
function measure(family: Quest['family'], stats: Stats): number {
  if (family === 'residential') return stats.homesConnected;
  return family === 'nature' ? stats.largestNature : stats.largestWater;
}
const questPoints = (quests: readonly Quest[]) => quests.reduce((sum, quest) => sum + quest.points, 0);
const ids = (quests: readonly Quest[]) => quests.map((quest) => quest.id);

type Choice = (moves: (Move & { preview: Preview })[], step: number) => Move & { preview: Preview };
/** Prefers moves that complete quests, then the most placement points. */
const questGreedy: Choice = (moves) =>
  moves.reduce((a, b) =>
    b.preview.points.total + questPoints(b.preview.completes) >
    a.preview.points.total + questPoints(a.preview.completes)
      ? b
      : a,
  );
/** A plainer player: the first valid move it finds. */
const firstValid: Choice = (moves) => moves[0] as Move & { preview: Preview };

interface Step {
  before: Snapshot;
  after: Snapshot;
  move: Move & { preview: Preview };
  hand: HandTile;
}

/** Plays a whole run by placement, recording each step. */
function playRun(seed: number, choose: Choice = questGreedy) {
  const core = realCore(seed);
  const steps: Step[] = [];
  let snapshot = core.snapshot();
  const start = snapshot;
  while (!snapshot.finished) {
    const moves = validMoves(core, snapshot);
    if (moves.length === 0) throw new Error(`seed ${seed}: the tile in hand fits nowhere`);
    const move = choose(moves, steps.length);
    const result = core.command({ type: 'place', q: move.q, r: move.r, rotation: move.rotation });
    expect(result.ok, result.message).toBe(true);
    steps.push({ before: snapshot, after: result.snapshot, move, hand: snapshot.current as HandTile });
    snapshot = result.snapshot;
  }
  return { seed, core, start, steps, end: snapshot };
}

describe('quests against the real Rust core', () => {
  const runs = SEEDS.map((seed) => playRun(seed));

  it('starts every run with the three small quests, measured from the starting board', () => {
    for (const { start } of runs) {
      expect(ids(start.quests.current)).toEqual(['residential-small', 'nature-small', 'water-small']);
      expect(start.quests.history).toEqual([]);
      for (const quest of start.quests.current) {
        expect(quest.progress).toBe(measure(quest.family, start.stats));
        expect(quest.target).toBe(LADDER[quest.family][0]);
        expect(quest).toMatchObject({ ...REWARDS[0], tier: 'small', completedAt: null });
      }
      expect(start).toMatchObject({ rewards: 0, discarded: 0, cap: CAP, end: null, victory: false });
      expect(start.milestone).toBeNull();
      expect(start.nextMilestone).toEqual({ name: 'Settlement', score: 1000 });
    }
  });

  it.each(runs)(
    'seed $seed pays each quest once and scores placements plus quest points',
    ({ steps, end }) => {
      const history = ids(end.quests.history);
      expect(history.length).toBeGreaterThan(0);
      expect(new Set(history).size).toBe(history.length);
      const paid = steps.flatMap(({ after }) => ids(after.last?.completed.map((done) => done.quest) ?? []));
      expect(paid).toEqual(history);
      const placementPoints = steps.reduce((sum, { move }) => sum + move.preview.points.total, 0);
      expect(end.score).toBe(placementPoints + questPoints(end.quests.history));
      expect(end.rewards).toBe(end.quests.history.reduce((sum, quest) => sum + quest.tiles, 0));
      expect(end.placements).toBe(DECK + end.rewards - end.discarded);
      expect(end.placements).toBe(steps.length);
      expect(end.end).toBe('deckEmpty');
      expect(end.remaining).toBe(0);
      // A finite ladder: never more than nine quests or thirty reward tiles.
      expect(history.length).toBeLessThanOrEqual(9);
      expect(end.rewards).toBeLessThanOrEqual(30);
    },
  );

  it.each(runs)('seed $seed previews exactly the quests each placement completes', ({ steps }) => {
    for (const [index, { after, move }] of steps.entries()) {
      const last = after.last;
      if (!last) throw new Error('A placement records its outcome.');
      expect(
        last.completed.map((done) => done.quest),
        `placement ${index + 1}`,
      ).toEqual(move.preview.completes);
      expect(last.questPoints).toBe(questPoints(move.preview.completes));
      expect(after.score - (steps[index - 1]?.after.score ?? 0)).toBe(
        move.preview.points.total + last.questPoints,
      );
    }
  });

  it.each(runs)(
    'seed $seed completes a quest only on a placement that raised it to its target',
    ({ steps }) => {
      for (const [index, { before, after }] of steps.entries()) {
        const where = `placement ${index + 1}`;
        const completed = ids(after.last?.completed.map((done) => done.quest) ?? []);
        const expected = before.quests.current
          .filter((quest) => {
            const was = measure(quest.family, before.stats);
            const now = measure(quest.family, after.stats);
            return quest.state === 'active' && now > was && now >= quest.target;
          })
          .map((quest) => quest.id);
        expect(completed, where).toEqual(expected);
        // At most one rung per family per placement.
        const families = after.last?.completed.map((done) => done.quest.family) ?? [];
        expect(new Set(families).size, where).toBe(families.length);
        for (const { quest, tilesAdded, tilesDiscarded } of after.last?.completed ?? []) {
          expect(quest.state, where).toBe('completed');
          expect(quest.completedAt, where).toBe(after.placements);
          expect(tilesAdded + tilesDiscarded, where).toBe(quest.tiles);
          expect(quest.progress, where).toBeGreaterThanOrEqual(quest.target);
        }
        // Every quest in play tracks its measure on the board as it stands now.
        for (const quest of after.quests.current) {
          expect(quest.progress, `${where} ${quest.id}`).toBe(measure(quest.family, after.stats));
          expect(quest.state, `${where} ${quest.id}`).not.toBe('completed');
          expect(quest.completedAt).toBeNull();
        }
      }
    },
  );

  it.each(runs)('seed $seed climbs each family small, medium, large with the ladder rewards', ({ end }) => {
    for (const family of FAMILIES) {
      const done = end.quests.history.filter((quest) => quest.family === family);
      expect(done.map((quest) => quest.tier)).toEqual(TIERS.slice(0, done.length));
      for (const [tier, quest] of done.entries()) {
        expect(quest.id).toBe(`${family}-${TIERS[tier]}`);
        expect(quest.target).toBe(LADDER[family][tier]);
        expect(quest).toMatchObject(REWARDS[tier] as object);
      }
      const current = end.quests.current.filter((quest) => quest.family === family);
      if (done.length === 3) expect(current).toEqual([]);
      else {
        expect(current).toHaveLength(1);
        expect(current[0]?.tier).toBe(TIERS[done.length]);
        expect(current[0]?.target).toBe(LADDER[family][done.length]);
      }
    }
    // Current quests stay in family order.
    const order = end.quests.current.map((quest) => FAMILIES.indexOf(quest.family));
    expect(order).toEqual([...order].sort());
  });

  it('replaces a completed small quest with the medium rung, measured from the new board', () => {
    let checked = 0;
    for (const { steps } of runs)
      for (const { after } of steps)
        for (const { quest } of after.last?.completed ?? []) {
          if (quest.tier !== 'small') continue;
          const next = after.quests.current.find((other) => other.family === quest.family);
          expect(next?.id).toBe(`${quest.family}-medium`);
          expect(next?.progress).toBe(measure(quest.family, after.stats));
          expect(next?.state).not.toBe('completed');
          expect(after.quests.history.some((done) => done.id === quest.id)).toBe(true);
          checked++;
        }
    expect(checked).toBeGreaterThanOrEqual(SEEDS.length);
  });

  it.each(runs)('seed $seed adds reward tiles to the back and keeps the deck order', ({ steps }) => {
    for (const [index, { before, after }] of steps.entries()) {
      const added = (after.last?.completed ?? []).reduce((sum, done) => sum + done.tilesAdded, 0);
      const where = `placement ${index + 1}`;
      expect(after.remaining, where).toBe(before.remaining - 1 + added);
      expect(after.remaining, where).toBeLessThanOrEqual(CAP);
      expect(after.rewards - before.rewards, where).toBe(
        (after.last?.completed ?? []).reduce((sum, done) => sum + done.quest.tiles, 0),
      );
      if (after.recovery) continue;
      // The tiles that were behind the placed one still lead the deck, in the same order.
      const shown = [after.current, ...after.upcoming];
      expect(shown.slice(0, before.upcoming.length), where).toEqual(before.upcoming);
    }
  });

  it('draws the same reward tiles in the same order, behind the starting deck, whatever the play', () => {
    let compared = 0;
    for (const a of runs) {
      const b = playRun(a.seed, firstValid);
      if (a.end.recoveries || b.end.recoveries) continue;
      const handsA = a.steps.map((step) => step.hand);
      const handsB = b.steps.map((step) => step.hand);
      // Without a skip or a recovery, the first thirty tiles are the starting deck, in order.
      expect(handsA.slice(0, DECK)).toEqual(handsB.slice(0, DECK));
      // After it come the reward tiles, from one seeded stream, however many each run earned.
      const shared = Math.min(handsA.length, handsB.length);
      expect(handsA.slice(DECK, shared)).toEqual(handsB.slice(DECK, shared));
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(2);
  });

  it('reports each milestone once, in order, and keeps the next one in view', () => {
    for (const { steps, end } of runs) {
      const reached = steps.flatMap(({ after }) => (after.last?.milestone ? [after.last.milestone] : []));
      const names = ['Settlement', 'Community', 'Thriving Barrio'];
      expect(reached).toEqual(names.slice(0, reached.length));
      expect(end.milestone).toBe(reached.at(-1) ?? null);
      for (const { after } of steps) {
        const index = after.score >= 6000 ? 3 : after.score >= 3000 ? 2 : after.score >= 1000 ? 1 : 0;
        expect(after.milestone).toBe(names[index - 1] ?? null);
        expect(after.nextMilestone?.name ?? null).toBe(names[index] ?? null);
        expect(after.victory).toBe(after.score >= 6000);
      }
    }
  });
});

describe('finishing a run', () => {
  it('refuses to finish before victory, says why, and changes nothing', () => {
    const core = realCore(7);
    for (const count of [0, 10]) {
      if (count) core.command({ type: 'autoplay', count });
      const before = core.snapshot();
      const save = core.save();
      expect(before.victory).toBe(false);
      const result = core.command({ type: 'finish' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/6000|6,000/);
      expect(result.snapshot).toEqual(before);
      expect(core.snapshot()).toEqual(before);
      expect(core.save()).toBe(save);
    }
  });

  it('refuses a save that finishes before victory', () => {
    const core = realCore(7);
    core.command({ type: 'autoplay', count: 3 });
    const save = JSON.parse(core.save()) as { actions: unknown[] };
    save.actions.push({ type: 'finish' });
    const other = realCore(1);
    const before = other.snapshot();
    const result = other.load(JSON.stringify(save));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('move 4');
    expect(other.snapshot()).toEqual(before);
  });
});

describe('scoring exploits', () => {
  function finishedRun(seed = 2) {
    const core = realCore(seed);
    const done = core.command({ type: 'autoplay', count: 400 }).snapshot;
    expect(done.finished).toBe(true);
    return { core, done, save: core.save() };
  }

  it('replays the same save to the same score and quests, every time', () => {
    const { done, save } = finishedRun();
    const first = realCore(1).load(save);
    const second = realCore(9).load(save);
    expect(first.ok && second.ok).toBe(true);
    expect(withoutRevision(first.snapshot)).toEqual(withoutRevision(second.snapshot));
    expect(withoutRevision(first.snapshot)).toEqual(withoutRevision(done));
    // Loading twice into the same game does not pay twice.
    const core = realCore(1);
    core.load(save);
    const again = core.load(save);
    expect(again.snapshot.score).toBe(done.score);
    expect(again.snapshot.quests).toEqual(done.quests);
    expect(again.snapshot.rewards).toBe(done.rewards);
  });

  it('keeps a loaded finished run finished: nothing more can be placed, skipped or paid', () => {
    const { done, save } = finishedRun();
    const core = realCore(4);
    expect(core.load(save).ok).toBe(true);
    const spot = done.frontier[0] as { q: number; r: number };
    for (const command of [
      { type: 'place', q: spot.q, r: spot.r, rotation: 0 },
      { type: 'skip' },
      { type: 'finish' },
      { type: 'autoplay', count: 5 },
    ] as const)
      expect(core.command(command).ok).toBe(false);
    expect(withoutRevision(core.snapshot())).toEqual(withoutRevision(done));
    // A save padded with more moves after the end is refused.
    const padded = JSON.parse(save) as { actions: unknown[] };
    padded.actions.push({ type: 'place', q: spot.q, r: spot.r, rotation: 0 });
    expect(realCore(4).load(JSON.stringify(padded)).ok).toBe(false);
  });

  it('never changes the score or quests on a refused placement', () => {
    const core: CorePort = realCore(12);
    for (let step = 0; step < 12; step++) {
      const before = core.snapshot();
      const occupied = before.tiles[before.tiles.length - 1] as { q: number; r: number };
      const refused = [
        { q: occupied.q, r: occupied.r, rotation: 0 },
        { q: 40, r: 40, rotation: 0 },
        { q: before.frontier[0]?.q ?? 0, r: before.frontier[0]?.r ?? 0, rotation: 9 },
      ];
      for (const spot of before.frontier)
        for (let rotation = 0; rotation < 6; rotation++)
          if (!core.preview(spot.q, spot.r, rotation).valid) refused.push({ q: spot.q, r: spot.r, rotation });
      for (const move of refused) {
        const result = core.command({ type: 'place', ...move });
        expect(result.ok).toBe(false);
        expect(result.snapshot.score).toBe(before.score);
        expect(result.snapshot.quests).toEqual(before.quests);
        expect(result.snapshot.rewards).toBe(before.rewards);
        expect(result.snapshot.remaining).toBe(before.remaining);
      }
      expect(core.snapshot()).toEqual(before);
      core.command({ type: 'autoplay', count: 1 });
    }
  });
});
