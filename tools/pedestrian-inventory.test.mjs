import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { expectedHomes, inventoryErrors } from './pedestrian-inventory.mjs';
import { sceneNames } from './pedestrian-scenes.mjs';

const tile = {
  q: 0,
  r: 0,
  kind: 'casas',
  edges: ['path', 'homes', 'nature', 'nature', 'nature', 'nature'],
  paths: [1, 0, 0, 0, 0, 0],
  entrances: [null, 1, null, null, null, null],
};
const fixture = { tiles: [tile] };
const report = () => ({
  q: 0,
  r: 0,
  homes: [{ side: 1, group: 1, public: false, door: { x: 0, z: 0 }, connected: true }],
  geometry: {
    triangles: 0,
    area: 0,
    overlapArea: 0,
    blockedArea: 0,
    waterIntrusionArea: 0,
    degenerate: 0,
    outsideVertices: 0,
    coverageGaps: [],
    terrainContactGaps: [],
  },
  pedestrian: {
    nodes: ['interior', 'boundary'].map((location) => ({ kind: 'crossing', side: 0, group: 1, location })),
    edges: [],
    walkable: Array.from({ length: 6 }, () => ({ x: 0, z: 0 })),
    blocked: [],
    boundaries: [{ side: 0, group: 1 }],
    failures: [],
    adjacency: {},
  },
});
test('requires exact unique tile and home inventories', () => {
  assert.deepEqual(inventoryErrors(fixture, [report()]), []);
  assert(inventoryErrors(fixture, []).includes('Missing tile 0,0'));
  assert(inventoryErrors(fixture, [report(), report()]).includes('Duplicate tile 0,0'));
  const missing = report();
  missing.homes = [];
  assert(inventoryErrors(fixture, [missing]).includes('Missing home 0,0/1'));
});
test('rejects absent geometry and fabricated ordinary home service', () => {
  const missing = report();
  delete missing.geometry;
  assert(inventoryErrors(fixture, [missing]).some((e) => e.includes('Missing geometry field')));
  const pathless = { ...tile, entrances: [null, null, null, null, null, null] };
  assert(
    inventoryErrors({ tiles: [pathless] }, [report()]).some((e) => e.includes('service group disagrees')),
  );
});
test('models chapel access explicitly as public service without changing the rule entrance', () => {
  const chapel = {
    ...tile,
    kind: 'capilla',
    edges: ['path', 'homes', 'path', 'nature', 'path', 'nature'],
    paths: [1, 0, 1, 0, 1, 0],
  };
  assert.deepEqual(expectedHomes(chapel), [
    { side: 1, public: false, group: 1 },
    { side: 3, public: true, group: 1 },
  ]);
  assert.equal(chapel.entrances[3], null);
});

test('rejects an empty path-only tile while allowing a single unused open port', () => {
  const pathOnly = {
    ...tile,
    edges: ['path', 'nature', 'nature', 'path', 'nature', 'nature'],
    paths: [1, 0, 0, 1, 0, 0],
    entrances: Array(6).fill(null),
  };
  const empty = report();
  empty.homes = [];
  empty.pedestrian = {
    nodes: [],
    edges: [],
    boundaries: [],
    walkable: [],
    blocked: [],
    failures: [],
    adjacency: {},
  };
  const errors = inventoryErrors({ tiles: [pathOnly] }, [empty]);
  assert(errors.some((e) => e.includes('interior crossing')));
  assert(errors.some((e) => e.includes('boundary contract')));
  assert(errors.some((e) => e.includes('required primary route')));
  const single = {
    ...tile,
    edges: ['path', 'nature', 'nature', 'nature', 'nature', 'nature'],
    entrances: Array(6).fill(null),
  };
  const unused = report();
  unused.homes = [];
  assert.deepEqual(inventoryErrors({ tiles: [single] }, [unused]), []);
  single.meets = ['match'];
  assert(inventoryErrors({ tiles: [single] }, [unused]).some((e) => e.includes('required boundary adapter')));
});

test('the full verifier rejects erased path-only graph and mesh evidence', async () => {
  const source = (await readFile('tools/pedestrian-verify.mjs', 'utf8')).replace(/^import .*;\n/gm, '');
  const run = new (Object.getPrototypeOf(async () => {}).constructor)(
    'assert',
    'readFile',
    'writeFile',
    'inventoryErrors',
    'sceneNames',
    'console',
    source,
  );
  for (const erased of [null, [2, 0], [0, -2]]) {
    let result;
    const read = async (path, encoding) => {
      const content = await readFile(path, encoding);
      if (!erased || !path.endsWith('E-settlement-report.json')) return content;
      const reports = JSON.parse(content),
        row = reports.find((r) => r.q === erased[0] && r.r === erased[1]);
      assert(row, 'Frozen reproduction tile must exist');
      row.pedestrian = {
        nodes: [],
        edges: [],
        boundaries: [],
        walkable: [],
        blocked: [],
        failures: [],
        adjacency: {},
      };
      for (const field of Object.keys(row.geometry))
        row.geometry[field] = Array.isArray(row.geometry[field]) ? [] : 0;
      return JSON.stringify(reports);
    };
    const execution = run(
      assert,
      read,
      async (_path, value) => {
        result = JSON.parse(value);
      },
      inventoryErrors,
      sceneNames,
      { log() {} },
    );
    if (erased) await assert.rejects(execution, /Pedestrian rendering acceptance failed/);
    else await execution;
    assert.equal(result.passed, erased === null);
  }
});
