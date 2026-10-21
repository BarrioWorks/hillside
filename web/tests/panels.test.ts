import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '../src/controller';
import {
  type Command,
  type CorePort,
  type GameResult,
  type Outcome,
  type Snapshot,
  snapshotSchema,
} from '../src/domain';
import { Persistence } from '../src/persistence';
import { UI } from '../src/ui';
import { realCore, validMoves } from './core-fixture';

const BEST_KEY = 'barrio.best.classic-2';
const number = (value: number) => value.toLocaleString('en-US');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  vi.useRealTimers();
});

/** A controller and its interface, with the actions main.ts wires for the victory panel. */
function mount(core: CorePort) {
  const controller = new Controller(core, new Persistence(localStorage));
  let ui: UI | null = null;
  const actions: string[] = [];
  ui = new UI(controller, (action) => {
    actions.push(action);
    if (action === 'continue') ui?.hideVictory();
    if (action === 'results') ui?.showResults();
    if (action === 'view') ui?.hideResults();
    if (action === 'finish') {
      ui?.hideVictory();
      controller.execute({ type: 'finish' });
    }
  });
  return { controller, ui, actions };
}
const $ = <T extends Element = HTMLElement>(selector: string) => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
};
const cards = () => [...document.querySelectorAll<HTMLLIElement>('#quest-list li.quest[data-id]')];
const click = (selector: string) => $<HTMLButtonElement>(selector).click();
const statRows = () =>
  Object.fromEntries(
    [...document.querySelectorAll('#results-stats div')].map((row) => [
      row.querySelector('dt')?.textContent,
      row.querySelector('dd')?.textContent,
    ]),
  );

describe('the quest panel', () => {
  it('shows the three starting quests with their progress and rewards', () => {
    const core = realCore(2026);
    mount(core);
    const quests = core.snapshot().quests.current;
    expect(cards().map((card) => card.dataset.id)).toEqual([
      'residential-small',
      'nature-small',
      'water-small',
    ]);
    for (const [index, card] of cards().entries()) {
      const quest = quests[index];
      if (!quest) throw new Error('Three quests at the start.');
      expect(card.classList.contains(quest.family)).toBe(true);
      expect(card.classList.contains(quest.state)).toBe(true);
      // A quest the deck cannot supply is set aside; seed 2026 starts with too few streams for water.
      expect(card.textContent).toContain(
        quest.state === 'active' ? `${quest.progress} / ${quest.target}` : 'Out of reach for now',
      );
      expect(card.textContent).toContain('+150 · +3 tiles');
      expect(card.textContent).toContain('Small');
      const bar = card.querySelector('[role="progressbar"]');
      expect(bar?.getAttribute('aria-valuenow')).toBe(String(quest.progress));
      expect(bar?.getAttribute('aria-valuemax')).toBe(String(quest.target));
    }
    expect(quests.filter((quest) => quest.state === 'active').length).toBeGreaterThanOrEqual(2);
  });

  it('marks a quest whose progress rose, and briefly shows a completed quest before its successor', () => {
    vi.useFakeTimers();
    const core = realCore(1);
    const { controller } = mount(core);
    let advancedSeen = false;
    for (let step = 0; step < 40; step++) {
      const before = controller.snapshot;
      const moves = validMoves(core, before);
      const completing = moves.find((move) => move.preview.completes.some((quest) => quest.tier === 'small'));
      const move = completing ?? moves.find((move) => move.preview.completes.length === 0) ?? moves[0];
      if (!move) throw new Error('No valid move.');
      expect(controller.execute({ type: 'place', q: move.q, r: move.r, rotation: move.rotation })).toBe(true);
      const after = controller.snapshot;
      if (!completing) {
        for (const quest of after.quests.current) {
          const was = before.quests.current.find((other) => other.id === quest.id);
          const card = $(`#quest-list li[data-id="${quest.id}"]`);
          const rose = !!was && quest.progress > was.progress;
          expect(card.classList.contains('advanced'), quest.id).toBe(rose);
          advancedSeen ||= rose;
        }
        vi.advanceTimersByTime(2000);
        continue;
      }
      const done = completing.preview.completes.find(
        (quest) => quest.tier === 'small',
      ) as (typeof after.quests.history)[number];
      // The completed quest shows in its place, marked done.
      const shown = $(`#quest-list li[data-id="${done.id}"]`);
      expect(shown.classList.contains('done')).toBe(true);
      expect(shown.textContent).toContain('Complete');
      expect(cards()).toHaveLength(3);
      expect(document.querySelector(`#quest-list li[data-id="${done.family}-medium"]`)).toBeNull();
      expect($('#status').textContent).toContain('Quest complete: +150 and +3 tiles.');
      expect($('#score').textContent).toBe(number(after.score));
      expect(after.score - before.score).toBe(
        completing.preview.points.total + (after.last?.questPoints ?? Number.NaN),
      );
      // Then its successor takes over.
      vi.advanceTimersByTime(1500);
      expect(document.querySelector('#quest-list li.done')).toBeNull();
      const next = after.quests.current.find((quest) => quest.family === done.family);
      expect(next?.id).toBe(`${done.family}-medium`);
      const card = $(`#quest-list li[data-id="${done.family}-medium"]`);
      expect(card.textContent).toContain(`${Math.min(next?.progress ?? 0, 12)} / ${next?.target}`);
      expect(card.textContent).toContain('+350 · +3 tiles');
      expect(card.textContent).toContain('Medium');
      expect(advancedSeen || step === 0).toBe(true);
      return;
    }
    throw new Error('No placement completed a small quest.');
  });

  it('shows a quest set aside as out of reach', () => {
    const core = scriptedCore();
    const snapshot = core.snapshot();
    const water = snapshot.quests.current[2];
    if (!water) throw new Error('A water quest at the start.');
    core.set({
      quests: {
        ...snapshot.quests,
        current: [...snapshot.quests.current.slice(0, 2), { ...water, state: 'outOfReach' }],
      },
    });
    mount(core);
    const card = $(`#quest-list li[data-id="${water.id}"]`);
    expect(card.classList.contains('outOfReach')).toBe(true);
    expect(card.textContent).toContain('Out of reach for now');
  });

  it('says so once every quest is complete', () => {
    const core = scriptedCore();
    core.set({ quests: { current: [], history: [] } });
    mount(core);
    expect(cards()).toEqual([]);
    expect($('#quest-list').textContent).toBe('Every quest is complete.');
  });
});

describe('the milestone bar', () => {
  it('points at the next milestone and fills toward it', () => {
    const core = scriptedCore();
    core.set({ score: 500, milestone: null, nextMilestone: { name: 'Settlement', score: 1000 } });
    mount(core);
    expect($('#milestone-text').textContent).toBe('Next: Settlement at 1,000');
    expect($('#milestone-fill').style.width).toBe('50%');
  });

  it('measures from the last milestone reached', () => {
    const core = scriptedCore();
    core.set({ score: 2000, milestone: 'Settlement', nextMilestone: { name: 'Community', score: 3000 } });
    mount(core);
    expect($('#milestone-text').textContent).toBe('Settlement · Next: Community at 3,000');
    expect($('#milestone-fill').style.width).toBe('50%');
  });
});

/**
 * A core that plays real placements' shape but reaches victory on its first placement, because a greedy
 * player rarely reaches 6,000. Finish follows the Rust rules: refused before victory, then ends the run.
 */
function scriptedCore(seed = 2026) {
  const real = realCore(seed);
  real.command({ type: 'autoplay', count: 8 });
  let snapshot = real.snapshot();
  const base = snapshot.last as Outcome;
  const result = (ok: boolean, message: string): GameResult => ({ ok, message, snapshot });
  const step = (changes: Partial<Snapshot>) => {
    snapshot = snapshotSchema.parse({ ...snapshot, ...changes, revision: snapshot.revision + 1 });
  };
  return {
    set(changes: Partial<Snapshot>) {
      snapshot = snapshotSchema.parse({ ...snapshot, ...changes });
    },
    snapshot: () => snapshot,
    preview: (q: number, r: number, rotation: number) => real.preview(q, r, rotation),
    save: () => JSON.stringify({ version: 3, rules: 'classic-2', seed, actions: [] }),
    load: (json: string) => real.load(json),
    restore: (json: string) => real.restore(json),
    command(command: Command): GameResult {
      if (snapshot.finished) return result(false, 'This run is already over.');
      if (command.type === 'finish') {
        if (!snapshot.victory)
          return result(false, 'A run can be finished early only after reaching 6000 points.');
        step({ finished: true, end: 'finished', canSkip: false, recovery: null });
        return result(true, 'Run finished. Here is your neighborhood.');
      }
      if (command.type !== 'place') return result(false, 'Not scripted.');
      const victory = !snapshot.victory;
      const points = base.points;
      step({
        score: victory ? 6040 : snapshot.score + points.total,
        placements: snapshot.placements + 1,
        remaining: snapshot.remaining - 1,
        victory: true,
        victoryAt: victory ? snapshot.placements + 1 : snapshot.victoryAt,
        milestone: 'Thriving Barrio',
        nextMilestone: null,
        last: {
          ...base,
          completed: [],
          questPoints: 0,
          milestone: victory ? 'Thriving Barrio' : null,
          victory,
        },
      });
      return result(
        true,
        victory ? `+${points.total} Thriving Barrio! You reached victory.` : `+${points.total}`,
      );
    },
  } satisfies CorePort & { set(changes: Partial<Snapshot>): void };
}

describe('victory', () => {
  it('celebrates once when a placement reaches victory, then keeps playing on continue', () => {
    const { controller, actions } = mount(scriptedCore());
    const victory = $('#victory');
    expect(victory.hidden).toBe(true);
    expect(controller.execute({ type: 'place', q: 0, r: 0, rotation: 0 })).toBe(true);
    const reached = controller.snapshot;
    expect(reached.last?.victory).toBe(true);
    expect(victory.hidden).toBe(false);
    expect($('#victory-title').textContent).toBe('Thriving Barrio');
    expect($('#victory-text').textContent).toContain('6,040 points');
    expect($('#victory-text').textContent).toContain(`${reached.remaining} tiles left`);
    expect($('#milestone-text').textContent).toBe('Thriving Barrio · victory reached');
    expect($('#milestone-fill').style.width).toBe('100%');
    expect($('#results').hidden).toBe(true);
    // Repainting the same state keeps the panel up until the player chooses.
    controller.rotate();
    expect(victory.hidden).toBe(false);
    click('#victory [data-action="continue"]');
    expect(actions).toEqual(['continue']);
    expect(victory.hidden).toBe(true);
    // The same snapshot repainted never brings it back.
    controller.rotate();
    expect(victory.hidden).toBe(true);
    // Play continues: the next placement scores and does not celebrate again.
    expect(controller.execute({ type: 'place', q: 0, r: 0, rotation: 0 })).toBe(true);
    expect(controller.snapshot.last?.victory).toBe(false);
    expect(controller.snapshot.finished).toBe(false);
    expect(controller.snapshot.score).toBeGreaterThan(reached.score);
    expect(victory.hidden).toBe(true);
    expect($('#results').hidden).toBe(true);
    expect(localStorage.getItem(BEST_KEY)).toBeNull();
  });

  it('finishes after victory and shows the results with the reason and a new best', () => {
    const { controller } = mount(scriptedCore());
    controller.execute({ type: 'place', q: 0, r: 0, rotation: 0 });
    expect($('#victory').hidden).toBe(false);
    click('#victory [data-action="finish"]');
    const done = controller.snapshot;
    expect(done.finished).toBe(true);
    expect(done.end).toBe('finished');
    expect($('#victory').hidden).toBe(true);
    expect($('#results').hidden).toBe(false);
    expect($('#results-title').textContent).toBe('Thriving Barrio');
    expect($('#results-reason').textContent).toBe(
      `You finished after reaching victory, with ${done.remaining} tiles still in the deck.`,
    );
    expect($('#results-score').textContent).toBe('6,040');
    expect($('#results-best').textContent).toBe(
      'Your first finished run under these rules: a new personal best.',
    );
    expect(statRows()['Highest milestone']).toBe('Thriving Barrio');
    expect(JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}')).toMatchObject({
      score: 6040,
      milestone: 'Thriving Barrio',
      placements: done.placements,
    });
  });

  it('keeps a Finish run control after continuing, and a Results control after viewing the neighborhood', () => {
    const { controller } = mount(scriptedCore());
    const action = $<HTMLButtonElement>('#run-action');
    expect(action.hidden).toBe(true);
    controller.execute({ type: 'place', q: 0, r: 0, rotation: 0 });
    click('#victory [data-action="continue"]');
    expect(action.hidden).toBe(false);
    expect(action.textContent).toBe('Finish run');
    click('#run-action');
    expect(controller.snapshot.end).toBe('finished');
    expect($('#results').hidden).toBe(false);
    expect(action.hidden).toBe(true);
    click('#results [data-action="view"]');
    expect($('#results').hidden).toBe(true);
    expect(action.textContent).toBe('Results');
    click('#run-action');
    expect($('#results').hidden).toBe(false);
  });

  it('refuses to finish before victory and shows no results', () => {
    const { controller } = mount(scriptedCore());
    expect(controller.execute({ type: 'finish' })).toBe(false);
    expect(controller.message).toContain('6000');
    expect($('#results').hidden).toBe(true);
    expect($('#victory').hidden).toBe(true);
  });
});

describe('the results panel', () => {
  /** Finished-run scores for a few seeds, lowest first. */
  const scores = [3, 9, 12, 21]
    .map((seed) => ({ seed, score: realCore(seed).command({ type: 'autoplay', count: 400 }).snapshot.score }))
    .sort((a, b) => a.score - b.score);
  const low = scores[0] as { seed: number; score: number };
  const high = scores[scores.length - 1] as { seed: number; score: number };

  function finishRun(seed: number) {
    const mounted = mount(realCore(seed));
    expect(mounted.controller.execute({ type: 'autoplay', count: 400 })).toBe(true);
    return mounted;
  }

  it('shows the score, reason and run summary when the deck runs out', () => {
    const { controller } = finishRun(low.seed);
    const done = controller.snapshot;
    expect(done.end).toBe('deckEmpty');
    expect($('#results').hidden).toBe(false);
    expect($('#victory').hidden).toBe(true);
    expect($('#results-title').textContent).toBe('Run complete');
    expect($('#results-reason').textContent).toBe('The deck is empty: every tile has found its place.');
    expect($('#results-score').textContent).toBe(number(done.score));
    expect($('#results-best').textContent).toBe(
      'Your first finished run under these rules: a new personal best.',
    );
    const rows = statRows();
    expect(rows['Highest milestone']).toBe(done.milestone ?? 'None yet');
    expect(rows['Tiles placed']).toBe(String(done.placements));
    expect(rows['Connected homes']).toBe(`${done.stats.homesConnected} of ${done.stats.homes}`);
    expect(rows['Quests completed']).toBe(String(done.quests.history.length));
    expect(rows['Region and seed']).toBe(`${done.regionName} · ${done.seed}`);
    expect(Number(rows['Quests completed'])).toBeGreaterThan(0);
    expect($('#results [data-action="share"]').textContent).toContain('Share');
    expect($('#remaining').textContent).toBe('0 tiles left');
    expect(JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}').score).toBe(done.score);
  });

  it('shows the standing best after a lower run, without replacing it', () => {
    const first = finishRun(high.seed).controller.snapshot;
    const stored = localStorage.getItem(BEST_KEY);
    localStorage.removeItem('barrio.autosave.v3');
    document.body.innerHTML = '<div id="app"></div>';
    finishRun(low.seed);
    expect($('#results-best').textContent).toBe(
      `Personal best: ${number(first.score)} (${first.regionName}, seed ${first.seed}).`,
    );
    expect(localStorage.getItem(BEST_KEY)).toBe(stored);
  });

  it('announces a new best after a higher run, with the previous one', () => {
    const first = finishRun(low.seed).controller.snapshot;
    localStorage.removeItem('barrio.autosave.v3');
    document.body.innerHTML = '<div id="app"></div>';
    const second = finishRun(high.seed).controller.snapshot;
    expect($('#results-best').textContent).toBe(
      `New personal best. Previous best: ${number(first.score)} (${first.regionName}, seed ${first.seed}).`,
    );
    expect(JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}').score).toBe(second.score);
  });

  it('hides the results when a new game starts', () => {
    const { controller } = finishRun(low.seed);
    expect($('#results').hidden).toBe(false);
    controller.execute({ type: 'newGame', seed: 5 });
    expect($('#results').hidden).toBe(true);
  });
});
