import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const candidates = [process.env.WASM_PACK, resolve(homedir(), '.cargo/bin/wasm-pack'), 'wasm-pack'].filter(
  Boolean,
);
let executable;
for (const candidate of candidates) {
  const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (result.status === 0) {
    executable = candidate;
    break;
  }
}
if (!executable)
  throw new Error('wasm-pack is required. Install with cargo install wasm-pack, or set WASM_PACK.');
const crate = ['crates/barrio-core', 'crates/barrio_core'].find((path) => existsSync(`${path}/Cargo.toml`));
if (!crate) throw new Error('The Rust game crate is missing. Expected crates/barrio-core/Cargo.toml.');
const result = spawnSync(
  executable,
  [
    'build',
    crate,
    '--target',
    'web',
    '--out-dir',
    resolve('web/src/wasm'),
    '--out-name',
    'barrio_core',
    '--release',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, PATH: `${resolve(homedir(), '.cargo/bin')}:${process.env.PATH ?? ''}` },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
