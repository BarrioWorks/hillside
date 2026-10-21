import { describe, expect, it } from 'vitest';
import type { Edge, Preview, Quest } from '../src/domain';
import { tileSvg } from '../src/tileArt';
import { previewLines, questGoal, questReward } from '../src/ui';
import { realCore, validMoves } from './core-fixture';

function preview(overrides: Partial<Preview> = {}): Preview {
  return {
    valid: true,
    reason: '+50',
    elevation: 0,
    sides: [],
    neighbors: 2,
    matches: 2,
    perfect: false,
    points: { base: 10, matches: 2, matchPoints: 40, perfect: false, perfectBonus: 0, total: 50 },
    paths: { joined: 0, open: 0, ended: 0, steep: 0, stairs: 0, homesGained: 0 },
    validRotations: [0],
    variation: 0,
    completes: [],
    ...overrides,
  };
}

describe('preview chip lines', () => {
  it('shows base, matches and total for a valid placement', () => {
    const { headline, details } = previewLines(preview());
    expect(headline).toBe('+50');
    expect(details[0]).toBe('Base 10 · 2 matching edges +40');
    expect(details.some((line) => /steep/.test(line))).toBe(false);
  });

  it('says so when a placement is perfect', () => {
    const { headline, details } = previewLines(
      preview({
        perfect: true,
        matches: 6,
        neighbors: 6,
        points: { base: 10, matches: 6, matchPoints: 120, perfect: true, perfectBonus: 60, total: 190 },
      }),
    );
    expect(headline).toBe('+190 · Perfect placement');
    expect(details[0]).toBe('Base 10 · 6 matching edges +120 · Perfect +60');
  });

  it('gives the reason and a rotation hint for an invalid placement', () => {
    const reason = 'Water must flow into water.';
    const some = previewLines(preview({ valid: false, reason, validRotations: [2, 4] }));
    expect(some.headline).toBe('Cannot place here');
    expect(some.details).toEqual([reason, '2 other rotations fit here. Press R to turn the tile.']);
    const one = previewLines(preview({ valid: false, reason, validRotations: [3] }));
    expect(one.details[1]).toBe('1 other rotation fits here. Press R to turn the tile.');
    const none = previewLines(preview({ valid: false, reason, validRotations: [] }));
    expect(none.details).toEqual([reason, 'No rotation of this tile fits this spot.']);
  });

  it('warns about paths too steep to join', () => {
    const paths = { joined: 1, open: 1, ended: 0, steep: 2, stairs: 1, homesGained: 1 };
    const { details } = previewLines(preview({ paths }));
    expect(details).toContain('1 path joins · 1 open · 1 stair built');
    expect(details).toContain('2 paths too steep to join: two terraces apart');
    expect(details).toContain('+1 home on the main walk');
    const one = previewLines(preview({ paths: { ...paths, steep: 1 } }));
    expect(one.details).toContain('1 path too steep to join: two terraces apart');
  });

  it('lists each quest the placement would complete, with its reward', () => {
    const quest = (family: Quest['family'], target: number, points: number, tiles: number): Quest => ({
      id: `${family}-small`,
      family,
      tier: 'small',
      target,
      points,
      tiles,
      progress: target,
      state: 'completed',
      completedAt: 4,
    });
    const none = previewLines(preview());
    expect(none.details.some((line) => line.startsWith('Completes'))).toBe(false);
    const { headline, details } = previewLines(
      preview({ completes: [quest('nature', 5, 150, 2), quest('water', 8, 350, 3)] }),
    );
    // The headline stays the placement's own points; quest points are listed separately.
    expect(headline).toBe('+50');
    expect(details.slice(-2)).toEqual([
      'Completes “Grow a nature area of 5 tiles”: +150 · +2 tiles',
      'Completes “Run a stream 8 tiles long”: +350 · +3 tiles',
    ]);
    // An invalid placement completes nothing and says nothing about quests.
    const invalid = previewLines(preview({ valid: false, completes: [quest('water', 4, 150, 2)] }));
    expect(invalid.details.some((line) => line.startsWith('Completes'))).toBe(false);
  });

  it('describes real core previews', () => {
    const core = realCore(4);
    const [move] = validMoves(core);
    if (!move) throw new Error('No valid move');
    const valid = previewLines(move.preview);
    expect(valid.headline).toMatch(new RegExp(`^\\+${move.preview.points.total}`));
    expect(valid.details[0]).toContain(`Base ${move.preview.points.base}`);
    const far = core.preview(30, 30, 0);
    expect(far.valid).toBe(false);
    expect(previewLines(far).details[0]).toBe(far.reason);
  });
});

describe('quest wording', () => {
  it('states each family goal with its target', () => {
    expect(questGoal({ family: 'residential', target: 5 })).toBe('Connect 5 homes on one walk');
    expect(questGoal({ family: 'nature', target: 12 })).toBe('Grow a nature area of 12 tiles');
    expect(questGoal({ family: 'water', target: 15 })).toBe('Run a stream 15 tiles long');
  });

  it('states the reward in points and tiles', () => {
    expect(questReward({ points: 150, tiles: 2 })).toBe('+150 · +2 tiles');
    expect(questReward({ points: 750, tiles: 5 })).toBe('+750 · +5 tiles');
    expect(questReward({ points: 10, tiles: 1 })).toBe('+10 · +1 tile');
  });

  it('words every quest the real core starts with', () => {
    const quests = realCore(5).snapshot().quests.current;
    expect(quests.map((quest) => `${questGoal(quest)} (${questReward(quest)})`)).toEqual([
      'Connect 5 homes on one walk (+150 · +3 tiles)',
      'Grow a nature area of 5 tiles (+150 · +3 tiles)',
      'Run a stream 3 tiles long (+150 · +3 tiles)',
    ]);
  });
});

describe('tile art', () => {
  it('draws one sector per edge and one stroke per separate walk', () => {
    const edges: Edge[] = ['path', 'homes', 'nature', 'path', 'water', 'nature'];
    const strokes = (paths: number[]) =>
      (tileSvg('sendero', edges, paths, 60).match(/stroke-width="10"/g) ?? []).length;
    const svg = tileSvg('sendero', edges, [1, 0, 0, 1, 0, 0], 60);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="60"');
    // One curve for the joined walk and one stream lead.
    expect(strokes([1, 0, 0, 1, 0, 0])).toBe(2);
    // Two groups: two separate doorstep leads plus the stream.
    expect(strokes([1, 0, 0, 2, 0, 0])).toBe(3);
  });
});
