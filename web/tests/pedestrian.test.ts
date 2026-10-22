import { describe, expect, it } from 'vitest';
import type { TileSite } from '../src/render/tiles';
import { footprintDistance, PATH_WIDTH, plan, segmentsDistance } from '../src/render/tiles';
import { realCore, sidesOf, siteOf } from './core-fixture';

const open = Array.from({ length: 6 }, () => ({ meet: 'open', rise: 0 }) as const);
const stableSite: TileSite = {
  q: 0,
  r: 0,
  kind: 'casas',
  region: 'medellin',
  variation: 0,
  elevation: 0,
  edges: ['path', 'path', 'homes', 'homes', 'nature', 'homes'],
  paths: [1, 1, 0, 0, 0, 0],
  entrances: [null, null, 1, 1, null, 1],
};

describe('planned pedestrian access', () => {
  it('preserves existing building transforms when an uphill neighbor arrives', () => {
    const before = plan(stableSite, open);
    const after = plan(stableSite, [{ meet: 'match', rise: 1 }, ...open.slice(1)]);
    const transforms = (p: ReturnType<typeof plan>) =>
      p.homes.map(({ side, at, turn, scale, door }) => ({ side, at, turn, scale, door }));
    expect(transforms(after)).toEqual(transforms(before));
  });

  it('keeps all generated pedestrian pavement clear of buildings in real settlements', () => {
    for (const seed of [2, 3, 909352]) {
      const snapshot = realCore(seed).command({ type: 'autoplay', count: 19 }).snapshot;
      for (const tile of snapshot.tiles) {
        const p = plan(siteOf(tile, snapshot.region), sidesOf(tile, snapshot.tiles));
        for (const walk of p.walks)
          for (const curve of walk.curves)
            for (let i = 1; i < curve.length; i++) {
              const a = curve[i - 1];
              const b = curve[i];
              if (!a || !b) continue;
              for (const home of p.homes)
                expect(footprintDistance(home.footprint, a, b)).toBeGreaterThanOrEqual(PATH_WIDTH / 2 - 1e-6);
            }
        for (const home of p.homes) {
          if (!home.access) continue;
          expect(home.access[0]).toEqual(home.door);
          for (let i = 1; i < home.access.length; i++) {
            const a = home.access[i - 1];
            const b = home.access[i];
            if (!a || !b) continue;
            for (const other of p.homes)
              if (other !== home)
                expect(footprintDistance(other.footprint, a, b)).toBeGreaterThanOrEqual(0.1);
          }
        }
      }
    }
  });

  it('does not route a path into the end pond of a water tile', () => {
    const where: TileSite = {
      ...stableSite,
      kind: 'quebrada',
      edges: ['water', 'nature', 'nature', 'water', 'nature', 'path'],
      paths: [0, 0, 0, 0, 0, 1],
      entrances: [null, null, null, null, null, null],
    };
    const p = plan(where, open);
    const stream = [
      { x: 1.5, z: Math.sqrt(3) / 2 },
      { x: -1.5, z: -Math.sqrt(3) / 2 },
    ];
    const [a, b] = stream;
    if (!a || !b) throw new Error('Missing fixed stream endpoints');
    for (const walk of p.walks)
      for (const curve of walk.curves)
        for (let i = 1; i < curve.length; i++) {
          const c = curve[i - 1];
          const d = curve[i];
          if (c && d) expect(segmentsDistance(a, b, c, d)).toBeGreaterThanOrEqual((PATH_WIDTH + 0.62) / 2);
        }
  });
});
