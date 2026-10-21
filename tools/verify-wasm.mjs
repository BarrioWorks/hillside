import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Smoke-tests the built WASM module against the Classic contract, outside the browser.
const { default: init, Game } = await import('../web/src/wasm/barrio_core.js');
const bytes = await readFile(new URL('../web/src/wasm/barrio_core_bg.wasm', import.meta.url));
await init({ module_or_path: bytes });

const game = new Game(13013);
const snapshot = () => JSON.parse(game.snapshot());
const command = (value) => JSON.parse(game.command(JSON.stringify(value)));
const start = snapshot();
assert.equal(start.rules, 'classic-2');
assert.equal(start.tiles.length, 1, 'A run starts with one tile.');
assert.equal(start.tiles[0].kind, 'inicio');
assert.equal(start.frontier.length, 6);
assert.equal(start.remaining, 30);
assert.equal(start.upcoming.length, 2);
assert.equal(start.score, 0);

const spot = start.frontier
  .flatMap((cell) => [0, 1, 2, 3, 4, 5].map((rotation) => ({ ...cell, rotation })))
  .find((move) => JSON.parse(game.preview(move.q, move.r, move.rotation)).valid);
assert(spot, 'The first tile has somewhere to go.');
const expected = JSON.parse(game.preview(spot.q, spot.r, spot.rotation)).points.total;
const placed = command({ type: 'place', q: spot.q, r: spot.r, rotation: spot.rotation });
assert(placed.ok, placed.message);
assert.equal(snapshot().score, expected, 'The award equals the preview.');
assert.equal(snapshot().remaining, 29);
const afterPlacement = game.save();
assert.equal(JSON.parse(afterPlacement).version, 3);

const duplicate = command({ type: 'place', q: spot.q, r: spot.r, rotation: spot.rotation });
assert.equal(duplicate.ok, false, 'An occupied hex refuses a second tile.');
assert.equal(game.save(), afterPlacement, 'A refused placement leaves the save unchanged.');
assert.equal(command({ type: 'undo' }).ok, false, 'Classic has no undo.');

const restored = new Game(999);
assert(JSON.parse(restored.load(afterPlacement)).ok);
assert.deepEqual(JSON.parse(restored.snapshot()).tiles, snapshot().tiles);
const beforeBadLoad = restored.save();
assert.equal(JSON.parse(restored.load('{"version":999,"tiles":[]}')).ok, false);
assert.equal(restored.save(), beforeBadLoad, 'A malformed save does not replace the active run.');
for (const [legacy, words] of [
  ['{"version":1,"terrainId":"hillside-v2","seed":1}', /square/],
  ['{"version":2,"generator":"hex-hillside-v1","seed":1,"draws":0,"tiles":[]}', /free-building/],
]) {
  const result = JSON.parse(restored.load(legacy));
  assert.equal(result.ok, false);
  assert.match(result.message, words);
  assert.equal(restored.save(), beforeBadLoad, 'An older save does not replace the active run.');
}

assert(command({ type: 'skip' }).ok);
assert(command({ type: 'autoplay', count: 400 }).ok);
const finished = snapshot();
assert.equal(finished.finished, true, 'Autoplay plays the deck to the end.');
assert.equal(finished.remaining, 0);
const clone = new Game(1);
assert(JSON.parse(clone.load(game.save())).ok, 'Finished runs remain valid portable saves.');
assert.deepEqual(JSON.parse(clone.snapshot()).tiles, finished.tiles);
assert.equal(JSON.parse(clone.snapshot()).score, finished.score);
console.info(`WASM contract verified: ${bytes.byteLength} bytes, final score ${finished.score}.`);
