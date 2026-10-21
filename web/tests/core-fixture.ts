import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { wrapGame } from '../src/core';
import { Game, initSync } from '../src/wasm/barrio_core';

initSync({
  module: readFileSync(
    resolve(
      process.cwd(),
      process.cwd().endsWith('/web') ? 'src/wasm/barrio_core_bg.wasm' : 'web/src/wasm/barrio_core_bg.wasm',
    ),
  ),
});
export function realCore(seed = 2026) {
  return wrapGame(new Game(seed));
}
