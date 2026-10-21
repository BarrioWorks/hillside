import { z } from 'zod';
import {
  type Command,
  type CorePort,
  definitionSchema,
  previewSchema,
  resultSchema,
  snapshotSchema,
} from './domain';
import init, { Game } from './wasm/barrio_core';
export async function createCore(seed: number): Promise<CorePort> {
  await init();
  return wrapGame(new Game(seed));
}
export function wrapGame(game: Game): CorePort {
  return {
    snapshot: () => snapshotSchema.parse(JSON.parse(game.snapshot())),
    catalog: () => z.array(definitionSchema).parse(JSON.parse(game.catalog())),
    preview: (kind, x, z, rotation) => previewSchema.parse(JSON.parse(game.preview(kind, x, z, rotation))),
    command: (command: Command) => resultSchema.parse(JSON.parse(game.command(JSON.stringify(command)))),
    save: () => game.save(),
    load: (json) => resultSchema.parse(JSON.parse(game.load(json))),
  };
}
