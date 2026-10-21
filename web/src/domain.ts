import { z } from 'zod';

const integer = z.number().int();
export const definitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(['building', 'path', 'stairs', 'prop']),
  width: integer.positive(),
  depth: integer.positive(),
  height: z.number(),
  description: z.string(),
  color: z.string(),
});
export type BuildingDefinition = z.infer<typeof definitionSchema>;
export const structureSchema = z.object({
  id: integer,
  kind: z.string(),
  x: integer,
  z: integer,
  rotation: integer.min(0).max(3),
  variation: integer,
});
export type Structure = z.infer<typeof structureSchema>;
export const snapshotSchema = z.object({
  seed: integer,
  width: integer.positive(),
  depth: integer.positive(),
  cells: z.array(z.object({ x: integer, z: integer, height: integer })),
  structures: z.array(structureSchema),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  connected: integer,
  revision: integer,
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const previewSchema = z.object({
  valid: z.boolean(),
  reason: z.string(),
  height: z.number(),
  width: z.number(),
  depth: z.number(),
});
export type Preview = z.infer<typeof previewSchema>;
export const resultSchema = z.object({ ok: z.boolean(), message: z.string(), snapshot: snapshotSchema });
export type GameResult = z.infer<typeof resultSchema>;
export type Command =
  | { type: 'place'; kind: string; x: number; z: number; rotation: number }
  | { type: 'remove'; x: number; z: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; seed: number }
  | { type: 'benchmark' };
export type Tool = { type: 'place'; kind: string } | { type: 'remove' } | { type: 'navigate' };
export interface CorePort {
  snapshot(): Snapshot;
  catalog(): BuildingDefinition[];
  preview(kind: string, x: number, z: number, rotation: number): Preview;
  command(command: Command): GameResult;
  save(): string;
  load(json: string): GameResult;
}
export type CellPoint = { x: number; z: number };
