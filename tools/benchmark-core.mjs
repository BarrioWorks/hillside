import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform } from 'node:os';
import init, { Game } from '../web/src/wasm/barrio_core.js';

// Times the release WASM rules: a new run, one placement preview sweep, a placement, and a full greedy run.
const bytes = await readFile(new URL('../web/src/wasm/barrio_core_bg.wasm', import.meta.url));
await init({ module_or_path: bytes });
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const time = (work) => {
  const started = performance.now();
  const value = work();
  return [performance.now() - started, value];
};
const measures = {
  newRun: [],
  previewSweep: [],
  placement: [],
  greedyRunToEnd: [],
  snapshotFinished: [],
  saveReplay: [],
};
const warmup = new Game(1);
warmup.command(JSON.stringify({ type: 'autoplay', count: 400 }));
warmup.free();
for (let run = 0; run < 11; run++) {
  const seed = 2026 + run;
  const [opening, game] = time(() => new Game(seed));
  measures.newRun.push(opening);
  const frontier = JSON.parse(game.snapshot()).frontier;
  const [sweep, moves] = time(() =>
    frontier.flatMap((cell) =>
      [0, 1, 2, 3, 4, 5]
        .filter((rotation) => JSON.parse(game.preview(cell.q, cell.r, rotation)).valid)
        .map((rotation) => ({ ...cell, rotation })),
    ),
  );
  measures.previewSweep.push(sweep);
  const move = moves[0];
  const [placement, placed] = time(() =>
    JSON.parse(
      game.command(JSON.stringify({ type: 'place', q: move.q, r: move.r, rotation: move.rotation })),
    ),
  );
  assert(placed.ok);
  measures.placement.push(placement);
  const [growth, grown] = time(() =>
    JSON.parse(game.command(JSON.stringify({ type: 'autoplay', count: 400 }))),
  );
  assert(grown.ok && grown.snapshot.finished);
  measures.greedyRunToEnd.push(growth);
  measures.snapshotFinished.push(time(() => game.snapshot())[0]);
  const save = game.save();
  const other = new Game(1);
  measures.saveReplay.push(time(() => assert(JSON.parse(other.load(save)).ok))[0]);
  other.free();
  game.free();
}
const result = {
  recordedAt: new Date().toISOString(),
  runtime: process.version,
  platform: platform(),
  cpu: cpus()[0]?.model ?? 'unknown',
  loadAverage: loadavg().map((value) => Number(value.toFixed(2))),
  wasmSHA256: createHash('sha256').update(bytes).digest('hex'),
  method:
    'Eleven seeds after one warmup. Each run times new Game(seed) (start tile and deck), a preview of every frontier hex at all six rotations, one placement command including its JSON snapshot, greedy play to the end of the deck, one snapshot of the finished run, and loading its save (a full replay of every action through the rules). Times include Rust JSON serialization and JavaScript parsing where noted in the code.',
  limitations: 'Node WASM timing measures the release core only, not scene updates or rendering.',
  medianMilliseconds: Object.fromEntries(
    Object.entries(measures).map(([name, values]) => [name, median(values)]),
  ),
  samples: measures,
};
await mkdir('docs/benchmarks', { recursive: true });
await writeFile(
  process.env.BARRIO_CORE_OUT ?? 'docs/benchmarks/core-wasm.json',
  `${JSON.stringify(result, null, 2)}\n`,
);
console.info(JSON.stringify(result.medianMilliseconds, null, 2));
