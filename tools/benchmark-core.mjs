import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform } from 'node:os';
import init, { Game } from '../web/src/wasm/barrio_core.js';

const bytes = await readFile(new URL('../web/src/wasm/barrio_core_bg.wasm', import.meta.url));
await init({ module_or_path: bytes });
const command = JSON.stringify({ type: 'benchmark' });
const warmup = new Game(2026);
assert(JSON.parse(warmup.command(command)).ok);
warmup.free();
const samples = [];
for (let run = 0; run < 5; run++) {
  const game = new Game(2026);
  const started = performance.now();
  const json = game.command(command);
  const milliseconds = performance.now() - started;
  const result = JSON.parse(json);
  assert(result.ok && result.snapshot.structures.length === 1024);
  samples.push({ run: run + 1, milliseconds, structures: result.snapshot.structures.length });
  game.free();
}
const sorted = samples.map((sample) => sample.milliseconds).sort((a, b) => a - b);
const result = {
  recordedAt: new Date().toISOString(),
  runtime: process.version,
  platform: platform(),
  cpu: cpus()[0]?.model ?? 'unknown',
  wasmSHA256: createHash('sha256').update(bytes).digest('hex'),
  method:
    'Five fresh games after one warmup. Time only the compiled WASM benchmark command and returned Rust-serialized JSON. JavaScript command creation and response parsing stay outside the timed region.',
  limitations:
    'Node WASM timing measures the same release core, not browser scheduling, scene updates, or GPU rendering. No comparative speedup is claimed.',
  medianMilliseconds: sorted[2],
  rangeMilliseconds: [sorted[0], sorted.at(-1)],
  errors: 0,
  samples,
};
await mkdir('docs/benchmarks', { recursive: true });
await writeFile('docs/benchmarks/core-wasm.json', `${JSON.stringify(result, null, 2)}\n`);
console.info(JSON.stringify(result, null, 2));
