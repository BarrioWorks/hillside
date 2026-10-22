import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type Edge, REGIONS, type Region } from '../src/domain';
import { center, edgeAngle, HEX, INRADIUS } from '../src/render/hex';
import {
  BLOOMS,
  BROADLEAVES,
  type Broadleaf,
  broadleaf,
  flowering,
  type Plant,
  plantKey,
  VARIANTS,
} from '../src/render/models';
import { Surface } from '../src/render/palette';
import {
  COPING,
  clearance,
  insideFootprint,
  PATH_WIDTH,
  type Part,
  plan,
  type SideState,
  TileKit,
  type TileSite,
} from '../src/render/tiles';
import { plantAt, plants } from '../src/render/vegetation';
import { realCore, sidesOf, siteOf } from './core-fixture';

type Point = { x: number; z: number };
const VEGETATION = /^(tree|palm|shrub|ground|rock)\//;
const OLD_FOREST_TRIANGLES = 6902;
const OPEN: (SideState | undefined)[] = Array.from({ length: 6 }, () => undefined);
const LEVEL_RING: SideState[] = Array.from({ length: 6 }, () => ({ meet: 'match', rise: 0 }));

function forest(q: number, r: number, overrides: Partial<TileSite> = {}): TileSite {
  return {
    q,
    r,
    kind: 'monte',
    edges: Array.from({ length: 6 }, (): Edge => 'nature'),
    paths: [0, 0, 0, 0, 0, 0],
    entrances: [null, null, null, null, null, null],
    variation: 0,
    elevation: 0,
    region: 'salento',
    seed: 77,
    ...overrides,
  };
}
function vertices(geometry: THREE.BufferGeometry, matrix = new THREE.Matrix4()): THREE.Vector3[] {
  const p = geometry.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(matrix),
  );
}
function shape(geometry: THREE.BufferGeometry) {
  const surface = geometry.getAttribute('surface');
  const all = vertices(geometry);
  const crown = all.filter((_, i) => surface.getX(i) === Surface.foliage);
  const height = Math.max(...all.map((v) => v.y));
  const radius = Math.max(...all.map((v) => Math.hypot(v.x, v.z)));
  const base = Math.min(...crown.map((v) => v.y));
  const mean = crown.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(crown.length);
  // Share of the crown's extent that its foliage covers from above: low for open, puffy crowns.
  const cells = new Set<string>();
  const index = geometry.index?.array ?? [];
  const step = 0.03;
  const edge = (p: Point, q: THREE.Vector3, r: THREE.Vector3) =>
    (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  for (let t = 0; t < index.length; t += 3) {
    if (surface.getX(index[t] as number) !== Surface.foliage) continue;
    const [a, b, c] = [0, 1, 2].map((k) => all[index[t + k] as number] as THREE.Vector3) as [
      THREE.Vector3,
      THREE.Vector3,
      THREE.Vector3,
    ];
    for (let i = Math.floor(Math.min(a.x, b.x, c.x) / step); i <= Math.max(a.x, b.x, c.x) / step; i++)
      for (let j = Math.floor(Math.min(a.z, b.z, c.z) / step); j <= Math.max(a.z, b.z, c.z) / step; j++) {
        const p = { x: (i + 0.5) * step, z: (j + 0.5) * step };
        const d = [edge(p, a, b), edge(p, b, c), edge(p, c, a)];
        if (d.every((x) => x >= 0) || d.every((x) => x <= 0)) cells.add(`${i},${j}`);
      }
  }
  const fill = (cells.size * step * step) / (Math.PI * radius * radius);
  return {
    height,
    radius,
    base,
    slender: height / radius,
    offset: Math.hypot(mean.x, mean.z) / radius,
    fill,
  };
}
const keyOf = (kit: TileKit, geometry: THREE.BufferGeometry) =>
  [...(kit as unknown as { cache: Map<string, THREE.BufferGeometry> }).cache].find(
    ([, g]) => g === geometry,
  )?.[0] ?? '';
const trianglesOf = (parts: Part[]) =>
  parts.reduce(
    (sum, part) => sum + (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3,
    0,
  );

describe('tree family library', () => {
  const models = [
    ...BROADLEAVES.flatMap((family) =>
      VARIANTS.map((v) => [`${family}/${v}`, broadleaf(family, v)] as const),
    ),
    ...BLOOMS.flatMap((bloom) =>
      VARIANTS.map((v) => [`flowering/${bloom}/${v}`, flowering(bloom, v)] as const),
    ),
  ];

  it('builds finite, nondegenerate, bounded crowns with unit normals', () => {
    for (const [name, geometry] of models) {
      const p = geometry.getAttribute('position');
      const n = geometry.getAttribute('normal');
      const index = geometry.index?.array ?? [];
      expect(Array.from(p.array).every(Number.isFinite), name).toBe(true);
      for (let i = 0; i < n.count; i++)
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)), name).toBeCloseTo(1, 3);
      for (let t = 0; t < index.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) =>
          new THREE.Vector3().fromBufferAttribute(p, index[t + k] as number),
        ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
        expect(
          new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).length(),
          name,
        ).toBeGreaterThan(1e-8);
      }
      const { height, radius } = shape(geometry);
      expect(height, name).toBeGreaterThan(1);
      expect(height, name).toBeLessThan(2.2);
      expect(radius, name).toBeLessThan(0.8);
      expect(Math.min(...vertices(geometry).map((v) => v.y)), name).toBeGreaterThanOrEqual(-0.01);
      expect(index.length / 3, name).toBeLessThan(500);
    }
  });

  it('gives each family its own silhouette', () => {
    const mean = (family: Broadleaf | 'flowering') => {
      const shapes = VARIANTS.map((v) =>
        shape(family === 'flowering' ? flowering('gold', v) : broadleaf(family, v)),
      );
      const avg = (pick: (s: ReturnType<typeof shape>) => number) =>
        shapes.reduce((sum, s) => sum + pick(s), 0) / shapes.length;
      return {
        height: avg((s) => s.height),
        radius: avg((s) => s.radius),
        slender: avg((s) => s.slender),
        offset: avg((s) => s.offset),
        fill: avg((s) => s.fill),
        base: avg((s) => s.base),
      };
    };
    const rounded = mean('rounded'),
      spreading = mean('spreading'),
      andean = mean('andean'),
      woodland = mean('woodland'),
      accent = mean('flowering');
    // Compact: the shortest tree with a low crown on a short trunk.
    for (const other of [spreading, andean, woodland, accent])
      expect(rounded.height).toBeLessThan(other.height);
    expect(rounded.base).toBeLessThan(0.8);
    // Broad: the widest and flattest broadleaf.
    for (const other of [rounded, andean, woodland])
      expect(spreading.radius).toBeGreaterThan(other.radius + 0.1);
    for (const other of [rounded, andean, woodland, accent])
      expect(spreading.slender).toBeLessThan(other.slender);
    // Mountain crown: much taller than wide.
    for (const other of [rounded, spreading, woodland, accent])
      expect(andean.slender).toBeGreaterThan(other.slender * 1.4);
    // Woodland: its crown mass sits off the trunk.
    for (const other of [rounded, spreading, andean, accent])
      expect(woodland.offset).toBeGreaterThan(other.offset);
    // Accent: separate puffs leave most of its extent open from above.
    for (const other of [rounded, spreading, andean, woodland]) expect(accent.fill).toBeLessThan(other.fill);
  });

  it('keeps leaves green and blossoms in non-green value groups, lighter on top', () => {
    const groups = (geometry: THREE.BufferGeometry) => {
      const surface = geometry.getAttribute('surface');
      const color = geometry.getAttribute('color');
      const p = geometry.getAttribute('position');
      const foliage = Array.from({ length: p.count }, (_, i) => i).filter(
        (i) => surface.getX(i) === Surface.foliage,
      );
      const green = foliage.filter((i) => color.getY(i) > color.getX(i) && color.getY(i) > color.getZ(i));
      const ys = foliage.map((i) => p.getY(i));
      const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
      const luma = (i: number) => color.getX(i) * 0.2126 + color.getY(i) * 0.7152 + color.getZ(i) * 0.0722;
      const average = (list: number[]) => list.reduce((sum, i) => sum + luma(i), 0) / list.length;
      return {
        green: green.length / foliage.length,
        upper: average(foliage.filter((i) => p.getY(i) > mid)),
        lower: average(foliage.filter((i) => p.getY(i) <= mid)),
      };
    };
    for (const family of BROADLEAVES)
      for (const v of VARIANTS) {
        const g = groups(broadleaf(family, v));
        expect(g.green, family).toBe(1);
        expect(g.upper, family).toBeGreaterThan(g.lower);
      }
    for (const bloom of BLOOMS) expect(groups(flowering(bloom, 0)).green).toBeLessThan(0.3);
  });

  it('rebuilds identical geometry for the same family and variant', () => {
    for (const family of BROADLEAVES) {
      const a = broadleaf(family, 1),
        b = broadleaf(family, 1);
      for (const name of ['position', 'normal', 'color'])
        expect(Array.from(b.getAttribute(name).array)).toEqual(Array.from(a.getAttribute(name).array));
      expect(Array.from(broadleaf(family, 0).getAttribute('position').array)).not.toEqual(
        Array.from(a.getAttribute('position').array),
      );
    }
  });
});

describe('world-space vegetation', () => {
  const tally = (region: Region) => {
    const counts = new Map<string, number>();
    for (let q = -12; q <= 12; q++)
      for (let r = -12; r <= 12; r++)
        for (const candidate of plants({ q, r, kind: 'monte', region, seed: 11 })) {
          const plant: Plant = candidate.item;
          const name =
            plant.kind === 'tree'
              ? plant.family
              : plant.kind === 'flowering'
                ? `flowering/${plant.bloom}`
                : plant.kind === 'palm'
                  ? `palm/${plant.palm}`
                  : 'shrub';
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
    return counts;
  };

  it('reaches each region’s families with regional weights', () => {
    const medellin = tally('medellin'),
      salento = tally('salento'),
      bogota = tally('bogota'),
      cartagena = tally('cartagena');
    const total = (counts: Map<string, number>) => [...counts.values()].reduce((a, b) => a + b, 0);
    const share = (counts: Map<string, number>, name: string) => (counts.get(name) ?? 0) / total(counts);
    for (const family of [...BROADLEAVES, 'flowering/gold', 'flowering/pink', 'shrub'])
      expect(medellin.get(family), `medellin ${family}`).toBeGreaterThan(0);
    for (const counts of [medellin, bogota])
      expect([...counts.keys()].some((k) => k.startsWith('palm'))).toBe(false);
    expect(salento.get('palm/wax')).toBeGreaterThan(0);
    expect(salento.get('palm/coconut')).toBeUndefined();
    expect(cartagena.get('palm/coconut')).toBeGreaterThan(0);
    expect(cartagena.get('andean')).toBeUndefined();
    expect(share(cartagena, 'spreading')).toBeGreaterThan(share(cartagena, 'rounded'));
    expect(share(bogota, 'andean')).toBeGreaterThan(share(bogota, 'woodland'));
    expect([...bogota.keys()].some((k) => k.startsWith('flowering'))).toBe(false);
    expect(share(bogota, 'shrub')).toBeGreaterThan(share(medellin, 'shrub'));
    for (const counts of [medellin, salento, cartagena]) {
      const accents = share(counts, 'flowering/gold') + share(counts, 'flowering/pink');
      expect(accents).toBeGreaterThan(0);
      expect(accents).toBeLessThan(0.15);
    }
  });

  it('clusters flowering accents and families in space rather than scattering them', () => {
    // Neighboring accent trees are far more likely to be accents than a random tree is.
    const grid: [number, number, Plant][] = [];
    for (let i = 0; i < 80; i++)
      for (let j = 0; j < 80; j++) grid.push([i, j, plantAt(i * 0.6, j * 0.6, i * 1000 + j, 'medellin', 5)]);
    const accent = new Set(grid.filter(([, , p]) => p.kind === 'flowering').map(([i, j]) => `${i},${j}`));
    const base = accent.size / grid.length;
    let near = 0,
      checked = 0;
    for (const cell of accent) {
      const [i, j] = cell.split(',').map(Number) as [number, number];
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
        [2, 0],
        [0, 2],
      ] as const) {
        checked++;
        if (accent.has(`${i + di},${j + dj}`)) near++;
      }
    }
    expect(near / checked).toBeGreaterThan(base * 2);
  });

  it('places the same candidates for the same world, and different ones for another seed', () => {
    const a = plants({ q: 2, r: -1, kind: 'monte', region: 'medellin', seed: 3 });
    expect(plants({ q: 2, r: -1, kind: 'monte', region: 'medellin', seed: 3 })).toEqual(a);
    expect(plants({ q: 2, r: -1, kind: 'monte', region: 'medellin', seed: 4 })).not.toEqual(a);
    const kitA = new TileKit(),
      kitB = new TileKit();
    const site = forest(2, -1);
    const first = kitA.compose(site, LEVEL_RING);
    // A second kit that composed other tiles first must lay out the same trees.
    for (let q = -2; q <= 2; q++) kitB.compose(forest(q, 3), OPEN);
    const second = kitB.compose({ ...site }, [...LEVEL_RING]);
    expect(second.map((p) => p.matrix.elements)).toEqual(first.map((p) => p.matrix.elements));
    expect(second.map((p) => keyOf(kitB, p.geometry))).toEqual(first.map((p) => keyOf(kitA, p.geometry)));
  });

  it('gives each world candidate one owner, so neighboring forests continue across seams', () => {
    const kit = new TileKit();
    const roots = new Map<string, THREE.Vector3[]>();
    for (let q = -2; q <= 2; q++)
      for (let r = -2; r <= 2; r++) {
        const c = center(q, r);
        roots.set(
          `${q},${r}`,
          kit
            .compose(forest(q, r), LEVEL_RING)
            .filter((p) => /^(tree|palm|shrub)\//.test(keyOf(kit, p.geometry)))
            .map((p) =>
              new THREE.Vector3().setFromMatrixPosition(p.matrix).add(new THREE.Vector3(c.x, 0, c.z)),
            ),
        );
      }
    const all = [...roots.values()].flat();
    for (const [i, a] of all.entries())
      for (const b of all.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.2);
    // A forest tile keeps trees near its shared edges; interior and seam rows read as one canopy.
    const middle = roots.get('0,0') ?? [];
    expect(middle.length).toBeGreaterThan(5);
  });

  it('never leans crowns into empty or mismatched neighbors', () => {
    const kit = new TileKit();
    for (const region of REGIONS)
      for (let q = -1; q <= 1; q++)
        for (const [label, sides] of [
          ['open', OPEN],
          ['dead ends', Array.from({ length: 6 }, () => ({ meet: 'differ', rise: 0 }) as SideState)],
          ['higher', Array.from({ length: 6 }, () => ({ meet: 'match', rise: 1 }) as SideState)],
        ] as const)
          for (const part of kit.compose(forest(q, -q, { region }), sides)) {
            if (!VEGETATION.test(keyOf(kit, part.geometry))) continue;
            for (const v of vertices(part.geometry, part.matrix))
              for (let side = 0; side < 6; side++)
                expect(
                  v.x * Math.cos(edgeAngle(side)) + v.z * Math.sin(edgeAngle(side)),
                  `${region} ${label}`,
                ).toBeLessThanOrEqual(INRADIUS);
          }
  }, 30000);

  it('keeps vegetation out of homes, walks and water on real boards, within the old forest budget', () => {
    const kit = new TileKit();
    let plantsSeen = 0,
      details = 0,
      forestMax = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { tiles, region } = realCore(seed).command({ type: 'autoplay', count: 40 }).snapshot;
      for (const tile of tiles) {
        const where = { ...siteOf(tile, region), seed };
        const sides = sidesOf(tile, tiles);
        const layout = plan(where, sides);
        const parts = kit.compose(where, sides);
        if (tile.kind === 'monte') forestMax = Math.max(forestMax, trianglesOf(parts));
        const water: THREE.Vector3[][] = [];
        for (const part of parts) {
          const surface = part.geometry.getAttribute('surface');
          const p = part.geometry.getAttribute('position');
          const index = part.geometry.index?.array ?? [];
          for (let t = 0; t < index.length; t += 3)
            if (surface.getX(index[t] as number) === Surface.water)
              water.push(
                [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, index[t + k] as number)),
              );
        }
        for (const part of parts) {
          const name = keyOf(kit, part.geometry);
          if (!VEGETATION.test(name)) continue;
          if (name.startsWith('ground/') || name.startsWith('rock/')) details++;
          else plantsSeen++;
          const label = `${seed} ${tile.kind} ${tile.q},${tile.r} ${name}`;
          for (const v of vertices(part.geometry, part.matrix)) {
            expect(clearance(layout.walks, v), label).toBeGreaterThanOrEqual((PATH_WIDTH + COPING) / 2);
            for (const home of layout.homes) expect(insideFootprint(v, home.body), label).toBe(false);
            expect(Math.hypot(v.x, v.z), label).toBeLessThanOrEqual(HEX + 0.15);
          }
          const root: Point = { x: part.matrix.elements[12] ?? 0, z: part.matrix.elements[14] ?? 0 };
          for (const [a, b, c] of water as [THREE.Vector3, THREE.Vector3, THREE.Vector3][]) {
            const side = (p: Point, q: THREE.Vector3, s: THREE.Vector3) =>
              (q.x - p.x) * (s.z - p.z) - (q.z - p.z) * (s.x - p.x);
            const d = [side(root, a, b), side(root, b, c), side(root, c, a)];
            expect(d.every((x) => x >= 0) || d.every((x) => x <= 0), `${label} stands in water`).toBe(false);
          }
        }
      }
    }
    console.info('vegetation on real boards', JSON.stringify({ plantsSeen, details, forestMax }));
    expect(plantsSeen).toBeGreaterThan(300);
    expect(details).toBeGreaterThan(100);
    expect(forestMax).toBeLessThanOrEqual(OLD_FOREST_TRIANGLES);
  }, 60000);

  it('keeps overhanging crowns clear of neighboring homes and walks on developed boards', () => {
    const kit = new TileKit();
    let overhangs = 0;
    for (const seed of [909352, 2, 3, 4]) {
      const { tiles, region } = realCore(seed).command({ type: 'autoplay', count: 59 }).snapshot;
      const entries = tiles.map((tile) => ({
        tile,
        at: center(tile.q, tile.r),
        layout: plan(siteOf(tile, region), sidesOf(tile, tiles)),
      }));
      for (const entry of entries) {
        const neighbors = entries.filter(
          (other) =>
            other !== entry && Math.hypot(other.at.x - entry.at.x, other.at.z - entry.at.z) < HEX * 2,
        );
        for (const part of kit.compose({ ...siteOf(entry.tile, region), seed }, sidesOf(entry.tile, tiles))) {
          if (!/^(tree|palm)\//.test(keyOf(kit, part.geometry))) continue;
          for (const v of vertices(part.geometry, part.matrix)) {
            if (
              [0, 1, 2, 3, 4, 5].every(
                (side) => v.x * Math.cos(edgeAngle(side)) + v.z * Math.sin(edgeAngle(side)) <= INRADIUS,
              )
            )
              continue;
            for (const neighbor of neighbors) {
              const p = { x: v.x + entry.at.x - neighbor.at.x, z: v.z + entry.at.z - neighbor.at.z };
              if (
                ![0, 1, 2, 3, 4, 5].every(
                  (side) => p.x * Math.cos(edgeAngle(side)) + p.z * Math.sin(edgeAngle(side)) <= INRADIUS,
                )
              )
                continue;
              overhangs++;
              const label = `${seed} ${entry.tile.q},${entry.tile.r} -> ${neighbor.tile.q},${neighbor.tile.r}`;
              expect(clearance(neighbor.layout.walks, p), label).toBeGreaterThanOrEqual(
                (PATH_WIDTH + COPING) / 2,
              );
              for (const home of neighbor.layout.homes)
                expect(insideFootprint(p, home.body), label).toBe(false);
            }
          }
        }
      }
    }
    expect(overhangs).toBeGreaterThan(0);
  }, 30000);

  it('reuses one cached geometry per plant key across a whole board', () => {
    const kit = new TileKit();
    const seen = new Map<string, THREE.BufferGeometry>();
    for (const seed of [1, 2, 3, 4]) {
      const { tiles, region } = realCore(seed).command({ type: 'autoplay', count: 30 }).snapshot;
      for (const tile of tiles)
        for (const part of kit.compose({ ...siteOf(tile, region), seed }, sidesOf(tile, tiles))) {
          const name = keyOf(kit, part.geometry);
          if (!name.startsWith('tree/')) continue;
          expect(seen.get(name) ?? part.geometry).toBe(part.geometry);
          seen.set(name, part.geometry);
        }
    }
    const library = BROADLEAVES.length * VARIANTS.length + BLOOMS.length * VARIANTS.length;
    expect(seen.size).toBeGreaterThan(8);
    expect(seen.size).toBeLessThanOrEqual(library);
    for (const name of seen.keys())
      expect([
        ...BROADLEAVES.flatMap((f) => VARIANTS.map((v) => plantKey({ kind: 'tree', family: f, variant: v }))),
        ...BLOOMS.flatMap((b) => VARIANTS.map((v) => plantKey({ kind: 'flowering', bloom: b, variant: v }))),
      ]).toContain(name);
  }, 30000);
});
