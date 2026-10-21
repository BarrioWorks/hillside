import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { default: init, Game } = await import('../web/src/wasm/barrio_core.js');
const bytes = await readFile(new URL('../web/src/wasm/barrio_core_bg.wasm', import.meta.url));
await init({ module_or_path: bytes });

const game = new Game(13013);
const snapshot = () => JSON.parse(game.snapshot());
const command = (value) => JSON.parse(game.command(JSON.stringify(value)));
const catalog = JSON.parse(game.catalog());
assert.equal(catalog.filter((item) => item.category === 'building').length, 6);
assert.equal(snapshot().cells.length, snapshot().width * snapshot().depth);
assert(new Set(snapshot().cells.map((cell) => cell.height)).size > 2);

const start = snapshot();
const location = start.cells.find((cell) => JSON.parse(game.preview('casa', cell.x, cell.z, 0)).valid);
assert(location, 'The generated map has space for another house.');
const placed = command({ type: 'place', kind: 'casa', x: location.x, z: location.z, rotation: 0 });
assert(placed.ok, placed.message);
assert.equal(snapshot().structures.length, start.structures.length + 1);
const afterPlacement = game.save();
assert.equal(JSON.parse(afterPlacement).terrainId, 'hillside-v1');

const duplicate = command({ type: 'place', kind: 'casa', x: location.x, z: location.z, rotation: 0 });
assert.equal(duplicate.ok, false, 'Occupied terrain refuses a second structure.');
assert.equal(game.save(), afterPlacement, 'A refused placement leaves the save unchanged.');

assert(command({ type: 'undo' }).ok);
assert.deepEqual(snapshot().structures, start.structures);
assert(command({ type: 'redo' }).ok);
assert.equal(game.save(), afterPlacement);

const restored = new Game(999);
assert(JSON.parse(restored.load(afterPlacement)).ok);
assert.deepEqual(JSON.parse(restored.snapshot()).structures, snapshot().structures);
assert.deepEqual(JSON.parse(restored.snapshot()).cells, snapshot().cells);
const beforeBadLoad = restored.save();
assert.equal(JSON.parse(restored.load('{"version":999,"structures":[]}')).ok, false);
assert.equal(restored.save(), beforeBadLoad, 'A malformed save does not replace the active game.');
const foreignTerrain = { ...JSON.parse(afterPlacement), terrainId: 'unknown-terrain' };
assert.equal(JSON.parse(restored.load(JSON.stringify(foreignTerrain))).ok, false);
assert.equal(restored.save(), beforeBadLoad, 'An unknown terrain does not replace the active game.');

assert(command({ type: 'remove', x: location.x, z: location.z }).ok);
assert.equal(snapshot().structures.length, start.structures.length);
assert(command({ type: 'undo' }).ok);
assert.equal(game.save(), afterPlacement);

assert(command({ type: 'benchmark' }).ok);
assert(snapshot().structures.length >= 500, 'The benchmark populates actual core structures.');
const benchmark = snapshot();
assert.equal(new Set(benchmark.structures.map((item) => item.id)).size, benchmark.structures.length);
const clone = new Game(1);
assert(JSON.parse(clone.load(game.save())).ok, 'Benchmark neighborhoods remain valid portable saves.');
assert.deepEqual(JSON.parse(clone.snapshot()).structures, benchmark.structures);

for (const current of [game, restored, clone]) current.free();
console.info(
  'WASM integration passed: catalog, terrain, placement, refusal, history, atomic load, removal, and 500 structures.',
);
