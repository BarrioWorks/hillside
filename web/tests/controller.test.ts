import { beforeEach, describe, expect, it } from 'vitest';
import { Controller } from '../src/controller';
import { AUTOSAVE_KEY, type Best, bestKey, LEGACY_KEYS, Persistence, SAVE_KEY } from '../src/persistence';
import { realCore, withoutRevision } from './core-fixture';

const SQUARE = JSON.stringify({
  version: 1,
  seed: 7,
  structures: [{ id: 1, kind: 'casa', x: 3, z: 4, rotation: 0 }],
});
const FREE = JSON.stringify({
  version: 2,
  generator: 'hex-hillside-v1',
  seed: 7,
  draws: 3,
  tiles: [{ q: 0, r: 0, kind: 'casas', rotation: 0 }],
});

function start(seed = 2026) {
  return new Controller(realCore(seed), new Persistence(localStorage));
}
/** The first frontier hex and rotation where the tile in hand fits (valid) or does not fit (invalid). */
function spot(controller: Controller, valid: boolean) {
  for (const ground of controller.snapshot.frontier)
    for (let rotation = 0; rotation < 6; rotation++)
      if (controller.core.preview(ground.q, ground.r, rotation).valid === valid)
        return { q: ground.q, r: ground.r, rotation };
  throw new Error(`No ${valid ? 'valid' : 'invalid'} frontier placement in fixture.`);
}
function turnTo(controller: Controller, rotation: number) {
  while (controller.rotation !== rotation) controller.rotate();
}
function place(controller: Controller) {
  const { q, r, rotation } = spot(controller, true);
  turnTo(controller, rotation);
  controller.point({ q, r });
  expect(controller.place()).toBe(true);
}

beforeEach(() => localStorage.clear());

describe('playing Classic against the real Rust rules', () => {
  it('turns the tile in hand around six sides in both directions', () => {
    const controller = start();
    const seen = Array.from({ length: 7 }, () => {
      controller.rotate(1);
      return controller.rotation;
    });
    expect(seen).toEqual([1, 2, 3, 4, 5, 0, 1]);
    controller.rotate(-1);
    controller.rotate(-1);
    expect(controller.rotation).toBe(5);
    controller.rotate();
    expect(controller.rotation).toBe(0);
  });

  it('refreshes the preview when the tile turns', () => {
    const controller = start(3);
    const hex = controller.snapshot.frontier[0] as { q: number; r: number };
    controller.point(hex);
    for (let rotation = 0; rotation < 6; rotation++) {
      expect(controller.rotation).toBe(rotation);
      expect(controller.preview).toEqual(controller.core.preview(hex.q, hex.r, rotation));
      expect(controller.preview?.valid).toBe(controller.preview?.validRotations.includes(rotation));
      controller.rotate();
    }
  });

  it('previews a frontier hex and places the tile in hand there for the previewed points', () => {
    const controller = start();
    const before = controller.snapshot;
    const { q, r, rotation } = spot(controller, true);
    turnTo(controller, rotation);
    controller.point({ q, r });
    const preview = controller.preview;
    expect(preview).toEqual(controller.core.preview(q, r, rotation));
    expect(preview?.valid).toBe(true);
    expect(controller.place()).toBe(true);
    const after = controller.snapshot;
    expect(after.tiles).toHaveLength(before.tiles.length + 1);
    expect(after.tiles.find((tile) => tile.q === q && tile.r === r)?.kind).toBe(before.current?.kind);
    expect(after.score).toBe(before.score + (preview?.points.total ?? NaN));
    expect(after.last?.points).toEqual(preview?.points);
    expect(after.remaining).toBe(before.remaining - 1);
    expect(after.placements).toBe(1);
    expect(after.current).toEqual(before.upcoming[0]);
    expect(after.frontier.some((ground) => ground.q === q && ground.r === r)).toBe(false);
    expect(controller.message).toMatch(/^\+/);
    // The hex is now occupied, so it no longer previews.
    expect(controller.preview).toBeNull();
  });

  it('gives no preview off the frontier and refuses to place there', () => {
    const controller = start();
    const before = controller.snapshot;
    for (const hex of [
      { q: 0, r: 0 },
      { q: 9, r: 9 },
      { q: 40, r: 0 },
    ]) {
      controller.point(hex);
      expect(controller.preview).toBeNull();
      expect(controller.place()).toBe(false);
    }
    controller.point(null);
    expect(controller.place()).toBe(false);
    expect(controller.snapshot).toBe(before);
  });

  it("refuses an invalid placement with Rust's reason and leaves the run unchanged", () => {
    const controller = start();
    place(controller);
    // Only water refuses a frontier spot; play on until a stream or a stream tile makes one.
    const refusal = () => {
      try {
        return spot(controller, false);
      } catch {
        return null;
      }
    };
    for (let step = 0; step < 28 && !refusal(); step++) place(controller);
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    const before = controller.snapshot;
    const { q, r, rotation } = refusal() ?? spot(controller, false);
    turnTo(controller, rotation);
    controller.point({ q, r });
    const reason = controller.preview?.reason;
    expect(controller.preview?.valid).toBe(false);
    expect(reason).toMatch(/\w/);
    expect(controller.place()).toBe(false);
    expect(controller.message).toBe(reason);
    expect(controller.snapshot).toBe(before);
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBe(saved);
  });

  it('skips once per run through the controller: back of the deck, no points, same deck size', () => {
    const controller = start(3);
    place(controller);
    const before = controller.snapshot;
    expect(before.canSkip).toBe(true);
    expect(controller.skip()).toBe(true);
    const after = controller.snapshot;
    expect(after.current).toEqual(before.upcoming[0]);
    expect(after.remaining).toBe(before.remaining);
    expect(after.score).toBe(before.score);
    expect(after.tiles).toEqual(before.tiles);
    expect(after.skipUsed).toBe(true);
    expect(after.canSkip).toBe(false);
    expect(JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? '{}').actions).toHaveLength(2);
    expect(controller.skip()).toBe(false);
    expect(controller.message).toMatch(/already/);
    expect(controller.snapshot).toBe(after);
  });

  it('ends the run when the deck is empty and refuses to place more', () => {
    const controller = start(9);
    expect(controller.execute({ type: 'autoplay', count: 400 })).toBe(true);
    const done = controller.snapshot;
    expect(done.finished).toBe(true);
    expect(done.remaining).toBe(0);
    expect(done.current).toBeNull();
    expect(done.end).toBe('deckEmpty');
    expect(done.placements).toBe(30 + done.rewards - done.discarded);
    expect(done.tiles).toHaveLength(done.placements + 1);
    controller.point(done.frontier[0] ?? null);
    expect(controller.place()).toBe(false);
    expect(controller.skip()).toBe(false);
    expect(controller.snapshot).toBe(done);
  });

  it('autosaves a version 3 run and restores it on restart', () => {
    const controller = start();
    place(controller);
    controller.skip();
    place(controller);
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    expect(AUTOSAVE_KEY).toBe('barrio.autosave.v3');
    expect(JSON.parse(saved ?? '{}')).toMatchObject({ version: 3, seed: 2026 });
    const restarted = start(1);
    expect(withoutRevision(restarted.snapshot)).toEqual(withoutRevision(controller.snapshot));
    expect(restarted.message).toBe('Welcome back to your neighborhood.');
    expect(restarted.legacy).toBe(false);
  });

  it('saves and loads explicitly under its own key', () => {
    const controller = start();
    place(controller);
    controller.save();
    const expected = controller.snapshot;
    expect(SAVE_KEY).toBe('barrio.saved.v3');
    expect(localStorage.getItem(SAVE_KEY)).toBe(controller.core.save());
    place(controller);
    controller.execute({ type: 'newGame', seed: 42 });
    expect(controller.snapshot.seed).toBe(42);
    controller.loadSaved();
    expect(withoutRevision(controller.snapshot)).toEqual(withoutRevision(expected));
  });

  it('asks to save first when nothing has been saved', () => {
    const controller = start();
    const before = controller.snapshot;
    controller.loadSaved();
    expect(controller.message).toContain('Save first');
    expect(controller.snapshot).toBe(before);
  });

  it('starts a new game that matches a fresh core of that seed', () => {
    const controller = start();
    place(controller);
    expect(controller.execute({ type: 'newGame', seed: 7 })).toBe(true);
    expect(withoutRevision(controller.snapshot)).toEqual(withoutRevision(realCore(7).snapshot()));
    expect(controller.snapshot.score).toBe(0);
    expect(controller.snapshot.remaining).toBe(30);
  });

  it('rejects malformed imports atomically', () => {
    const controller = start();
    place(controller);
    const before = controller.snapshot;
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    for (const json of [
      'not JSON',
      '{"version":999,"tiles":[]}',
      '{"version":3}',
      '{"version":3,"rules":"classic-0","seed":4,"actions":[]}',
      '{"version":3,"rules":"classic-2","seed":4,"actions":[{"type":"place","q":9,"r":9,"rotation":0}]}',
    ]) {
      expect(controller.load(json)).toBe(false);
      expect(controller.snapshot).toBe(before);
      expect(controller.message).not.toBe('');
    }
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBe(saved);
  });

  it('keeps playing and exposes recovery when storage fails', () => {
    const unavailable = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    const controller = new Controller(realCore(), new Persistence(unavailable));
    place(controller);
    expect(controller.persistenceWarning).toContain('Export');
  });
});

/** Finished-run scores for a few seeds, lowest first, so tests can pick a lower or higher run. */
const SCORES = [3, 9, 12, 21]
  .map((seed) => ({ seed, score: realCore(seed).command({ type: 'autoplay', count: 400 }).snapshot.score }))
  .sort((a, b) => a.score - b.score);
const LOW = SCORES[0] as { seed: number; score: number };
const HIGH = SCORES[SCORES.length - 1] as { seed: number; score: number };
const BEST_KEY = 'barrio.best.classic-2';
const storedBest = () => JSON.parse(localStorage.getItem(BEST_KEY) ?? 'null') as Best | null;
/** Plays a whole run of `seed`, as a new game in `controller` when given (as the results panel's New game does). */
function finish(seed: number, controller?: Controller) {
  if (controller) expect(controller.execute({ type: 'newGame', seed })).toBe(true);
  else controller = start(seed);
  expect(controller.execute({ type: 'autoplay', count: 400 })).toBe(true);
  expect(controller.snapshot.end).toBe('deckEmpty');
  return controller;
}

describe('personal bests', () => {
  it('has different scores to compare', () => {
    expect(HIGH.score).toBeGreaterThan(LOW.score);
    expect(bestKey('classic-2')).toBe(BEST_KEY);
  });

  it('records the best under the rules version only when the run finishes', () => {
    const controller = start(LOW.seed);
    expect(controller.execute({ type: 'autoplay', count: 10 })).toBe(true);
    expect(controller.snapshot.finished).toBe(false);
    expect(storedBest()).toBeNull();
    expect(controller.newBest).toBe(false);
    expect(controller.execute({ type: 'autoplay', count: 400 })).toBe(true);
    const done = controller.snapshot;
    expect(done.finished).toBe(true);
    expect(done.rules).toBe('classic-2');
    expect(controller.newBest).toBe(true);
    expect(controller.bestBefore).toBeNull();
    expect(storedBest()).toEqual({
      score: done.score,
      seed: done.seed,
      region: done.regionName,
      placements: done.placements,
      milestone: done.milestone,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(new Persistence(localStorage).best('classic-2')).toEqual(storedBest());
    expect(new Persistence(localStorage).best('classic-1')).toBeNull();
  });

  it('claims no record when a finished run is loaded, and shows the stored best instead', () => {
    const winner = finish(HIGH.seed);
    const record = storedBest();
    const other = finish(LOW.seed, start(HIGH.seed));
    const save = other.core.save();
    const viewer = start(HIGH.seed);
    expect(viewer.load(save)).toBe(true);
    expect(viewer.snapshot.finished).toBe(true);
    expect(viewer.newBest).toBe(false);
    expect(viewer.bestBefore).toEqual(record);
    expect(viewer.celebrate).toBe(false);
    expect(storedBest()).toEqual(record);
    expect(winner.newBest).toBe(true);
  });

  it('keeps a higher best when a later run scores less', () => {
    const controller = finish(HIGH.seed);
    const record = storedBest();
    expect(record?.score).toBe(HIGH.score);
    const lower = finish(LOW.seed, controller);
    expect(lower.newBest).toBe(false);
    expect(lower.bestBefore).toEqual(record);
    expect(storedBest()).toEqual(record);
  });

  it('replaces the best when a later run scores more, and remembers the previous one', () => {
    const controller = finish(LOW.seed);
    const record = storedBest();
    const higher = finish(HIGH.seed, controller);
    expect(higher.newBest).toBe(true);
    expect(higher.bestBefore).toEqual(record);
    expect(storedBest()?.score).toBe(HIGH.score);
    expect(storedBest()?.seed).toBe(HIGH.seed);
  });

  it('does not record a best again when a finished run is loaded or restored', () => {
    const save = finish(HIGH.seed).core.save();
    const low: Best = {
      score: 1,
      seed: 1,
      region: 'Somewhere',
      placements: 1,
      milestone: null,
      date: '2026-01-01',
    };
    localStorage.setItem(BEST_KEY, JSON.stringify(low));
    const controller = start(LOW.seed);
    expect(controller.load(save)).toBe(true);
    expect(controller.snapshot.finished).toBe(true);
    expect(controller.snapshot.score).toBe(HIGH.score);
    expect(storedBest()).toEqual(low);
    // The finished autosave restores on the next start without recording it either.
    const restored = start(LOW.seed);
    expect(restored.snapshot.finished).toBe(true);
    expect(restored.newBest).toBe(false);
    expect(storedBest()).toEqual(low);
    // Refused commands on a finished run change nothing.
    expect(restored.skip()).toBe(false);
    expect(restored.execute({ type: 'finish' })).toBe(false);
    expect(storedBest()).toEqual(low);
  });

  it('refuses to finish before victory through the controller and keeps the run', () => {
    const controller = start(7);
    place(controller);
    const before = controller.snapshot;
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    expect(controller.execute({ type: 'finish' })).toBe(false);
    expect(controller.message).toContain('6000');
    expect(controller.snapshot).toBe(before);
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBe(saved);
    expect(storedBest()).toBeNull();
  });

  it('plays on when storage fails at the end of a run', () => {
    const unavailable = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    const controller = new Controller(realCore(LOW.seed), new Persistence(unavailable));
    expect(controller.execute({ type: 'autoplay', count: 400 })).toBe(true);
    expect(controller.snapshot.finished).toBe(true);
    expect(controller.newBest).toBe(false);
  });
});

describe('neighborhoods from earlier versions', () => {
  it('lists an unreadable autosave, then the free-building (v2) keys, before the square (v1) keys', () => {
    expect(LEGACY_KEYS).toEqual([
      'barrio.autosave.unreadable',
      'barrio.autosave.v2',
      'barrio.saved.v2',
      'barrio.autosave.v1',
      'barrio.saved.v1',
    ]);
  });

  it('keeps an autosave it cannot restore aside before the next autosave replaces it', () => {
    const unreadable = JSON.stringify({ version: 3, rules: 'classic-0', seed: 7, actions: [] });
    localStorage.setItem(AUTOSAVE_KEY, unreadable);
    const controller = start();
    expect(controller.message).toContain('could not be loaded');
    expect(controller.legacy).toBe(true);
    place(controller);
    expect(localStorage.getItem('barrio.autosave.unreadable')).toBe(unreadable);
    expect(controller.legacySave()).toBe(unreadable);
    expect(JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? '{}').rules).toBe('classic-2');
  });

  it('refuses a v2 save with an explanation and leaves the run unchanged', () => {
    const controller = start();
    place(controller);
    const before = controller.snapshot;
    expect(controller.load(FREE)).toBe(false);
    expect(controller.message).toContain('free-building');
    expect(controller.snapshot).toBe(before);
    expect(controller.load(SQUARE)).toBe(false);
    expect(controller.message).toContain('square');
    expect(controller.snapshot).toBe(before);
  });

  it('never overwrites a legacy key and offers the earlier neighborhood for download', () => {
    localStorage.setItem('barrio.autosave.v2', FREE);
    localStorage.setItem('barrio.saved.v1', SQUARE);
    const controller = start();
    expect(controller.legacy).toBe(true);
    expect(controller.message).toContain('download');
    expect(controller.snapshot.tiles).toEqual(realCore().snapshot().tiles);
    place(controller);
    controller.skip();
    controller.save();
    controller.load(FREE);
    controller.execute({ type: 'newGame', seed: 3 });
    place(controller);
    expect(localStorage.getItem('barrio.autosave.v2')).toBe(FREE);
    expect(localStorage.getItem('barrio.saved.v1')).toBe(SQUARE);
    expect(localStorage.getItem('barrio.saved.v2')).toBeNull();
    expect(localStorage.getItem('barrio.autosave.v1')).toBeNull();
    expect(JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? '{}').version).toBe(3);
    expect(start().legacy).toBe(true);
  });

  it('prefers barrio.autosave.v2 when offering a legacy download', () => {
    localStorage.setItem('barrio.autosave.v1', SQUARE);
    localStorage.setItem('barrio.saved.v2', '{"version":2,"saved":true}');
    localStorage.setItem('barrio.autosave.v2', FREE);
    expect(start().legacySave()).toBe(FREE);
    localStorage.removeItem('barrio.autosave.v2');
    expect(start().legacySave()).toBe('{"version":2,"saved":true}');
    localStorage.removeItem('barrio.saved.v2');
    expect(start().legacySave()).toBe(SQUARE);
  });

  it('has no legacy save in a fresh browser', () => {
    const controller = start();
    expect(controller.legacy).toBe(false);
    expect(controller.legacySave()).toBeNull();
  });
});
