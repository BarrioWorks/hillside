import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import {
  inspectTriangles,
  pavementCoverage,
  pavingTriangles,
  terrainContactGaps,
} from './pedestrian-geometry.mjs';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const results = [];
try {
  const { TileKit } = await server.ssrLoadModule('/src/render/tiles.ts');
  const { Surface } = await server.ssrLoadModule('/src/render/palette.ts');
  const { realCore, sidesOf } = await server.ssrLoadModule('/tests/core-fixture.ts');
  const { snapshotSchema } = await server.ssrLoadModule('/src/domain.ts');
  const scenes = JSON.parse(await readFile('docs/verification/pedestrian/scenes.json', 'utf8'));
  const kit = new TileKit();
  const stable = (p) =>
    JSON.stringify({
      homes: p.homes.map(({ at, turn, scale, doorAnchor, group, public: isPublic }) => ({
        at,
        turn,
        scale,
        doorAnchor,
        group,
        public: isPublic,
      })),
      nodes: p.pedestrian.nodes.filter((n) => n.kind !== 'crossing' || n.location !== 'boundary'),
      edges: p.pedestrian.edges.filter((e) => e.interior),
    });
  const check = (name, site, sides, before) => {
    try {
      const p = kit.plan(site, sides),
        triangles = pavingTriangles(kit.compose(site, sides), Surface.paving);
      const geometry = inspectTriangles(
        triangles,
        p.homes.map((h) => h.footprint),
      );
      const coverage = pavementCoverage(triangles, p.pedestrian),
        height = terrainContactGaps(triangles, p.pedestrian);
      const errors = [];
      if (before !== null && stable(p) !== before) errors.push('Intrinsic graph or buildings changed');
      if (p.pedestrian.failures.some((f) => f.group !== null)) errors.push('Required route failed');
      if (coverage.length) errors.push('Declared route has missing width or height coverage');
      if (height.length) errors.push('Pavement has wrong terrain or stair height');
      if (geometry.outsideVertices) errors.push('Pavement leaves hex');
      if (geometry.overlapArea > 1e-6) errors.push('Overlapping pavement faces');
      if (geometry.blockedArea > 1e-6) errors.push('Pavement enters building footprint');
      results.push({
        name,
        tile: [site.q, site.r],
        errors,
        coverage,
        height,
        geometry,
        passed: errors.length === 0,
      });
    } catch (error) {
      results.push({ name, tile: [site.q, site.r], errors: [String(error)], passed: false });
    }
  };
  let expectedExpansionCases = 0;
  for (const scene of scenes) {
    const snapshot = snapshotSchema.parse(scene.snapshot);
    for (const tile of snapshot.tiles) {
      const site = { ...tile, region: snapshot.region, seed: snapshot.seed },
        open = Array.from({ length: 6 }, () => ({ meet: 'open', rise: 0 }));
      const before = stable(kit.plan(site, open));
      for (let side = 0; side < 6; side++)
        if (tile.edges[side] === 'path') {
          expectedExpansionCases++;
          check(
            `${scene.name}/uphill-${side}`,
            site,
            open.map((s, i) => (i === side ? { meet: 'match', rise: 1 } : s)),
            before,
          );
        }
    }
  }
  assert.equal(results.length, expectedExpansionCases);
  let expectedActualCases = 0;
  for (const seed of [1, 2, 3]) {
    const snapshot = realCore(seed).command({ type: 'autoplay', count: 39 }).snapshot;
    for (const tile of snapshot.tiles) {
      const sides = sidesOf(tile, snapshot.tiles);
      if (!sides.some((s, i) => tile.edges[i] === 'path' && s.meet === 'match' && s.rise === 1)) continue;
      expectedActualCases++;
      check(`seed-${seed}/actual`, { ...tile, region: snapshot.region, seed: snapshot.seed }, sides, null);
    }
  }
  assert(expectedActualCases > 0, 'Actual stair cohort cannot be empty');
  assert.equal(results.length, expectedExpansionCases + expectedActualCases);
  const passed = results.every((r) => r.passed);
  await writeFile(
    'docs/verification/pedestrian/expansion-validation.json',
    JSON.stringify({ passed, expectedExpansionCases, expectedActualCases, results }, null, 2),
  );
  kit.dispose();
  console.log(
    `${passed ? 'PASS' : 'FAIL'} ${expectedExpansionCases} uphill expansions and ${expectedActualCases} actual stair-bearing tiles`,
  );
  assert(passed, 'Height-aware expansion validation failed; inspect expansion-validation.json');
} finally {
  await server.close();
}
