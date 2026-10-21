import { z } from 'zod';

const integer = z.number().int();
export const EDGES = ['homes', 'path', 'nature', 'water'] as const;
export const KINDS = [
  'casas',
  'tienda',
  'plaza',
  'parque',
  'capilla',
  'monte',
  'sendero',
  'quebrada',
  'inicio',
] as const;
export const FAMILIES = ['residential', 'nature', 'landscape', 'water', 'community', 'landmark'] as const;
export const REGIONS = ['medellin', 'salento', 'cartagena', 'bogota'] as const;
export const MEETS = ['open', 'match', 'differ', 'steep', 'blocked'] as const;
export const edgeSchema = z.enum(EDGES);
export type Edge = z.infer<typeof edgeSchema>;
export const kindSchema = z.enum(KINDS);
export type Kind = z.infer<typeof kindSchema>;
export const familySchema = z.enum(FAMILIES);
export type Family = z.infer<typeof familySchema>;
export const regionSchema = z.enum(REGIONS);
export type Region = z.infer<typeof regionSchema>;
export const meetSchema = z.enum(MEETS);
export type Meet = z.infer<typeof meetSchema>;
const six = <T extends z.ZodType>(item: T) => z.tuple([item, item, item, item, item, item]);
const sixEdges = six(edgeSchema);
export type Edges = z.infer<typeof sixEdges>;
/** Path group per side: sides with the same nonzero group are joined inside the tile. */
const sixGroups = six(integer.min(0).max(9));
export type Groups = z.infer<typeof sixGroups>;

/** A tile in the deck, before rotation. */
export const handTileSchema = z.object({
  kind: kindSchema,
  family: familySchema,
  edges: sixEdges,
  paths: sixGroups,
  entrances: six(integer.nullable()),
});
export type HandTile = z.infer<typeof handTileSchema>;
/** A placed tile. Per-side arrays are already rotated: index `i` faces direction `i`. */
export const tileSchema = z.object({
  q: integer,
  r: integer,
  kind: kindSchema,
  family: familySchema,
  edges: sixEdges,
  paths: sixGroups,
  entrances: six(integer.nullable()),
  networks: six(integer.nullable()),
  meets: six(meetSchema),
  rotation: integer.min(0).max(5),
  variation: integer.min(0).max(15),
  elevation: integer.min(0),
});
export type Tile = z.infer<typeof tileSchema>;
export const spotSchema = z.object({
  q: integer,
  r: integer,
  elevation: integer.min(0),
  playable: z.boolean(),
});
export type Spot = z.infer<typeof spotSchema>;
export const pointsSchema = z.object({
  base: integer,
  matches: integer,
  matchPoints: integer,
  perfect: z.boolean(),
  perfectBonus: integer,
  total: integer,
});
export type Points = z.infer<typeof pointsSchema>;
export const QUEST_FAMILIES = ['residential', 'nature', 'water'] as const;
export const questSchema = z.object({
  id: z.string(),
  family: z.enum(QUEST_FAMILIES),
  tier: z.enum(['small', 'medium', 'large']),
  target: integer,
  points: integer,
  tiles: integer,
  progress: integer,
  state: z.enum(['active', 'outOfReach', 'completed']),
  completedAt: integer.nullable(),
});
export type Quest = z.infer<typeof questSchema>;
export const completionSchema = z.object({
  quest: questSchema,
  tilesAdded: integer,
  tilesDiscarded: integer,
});
export const outcomeSchema = z.object({
  q: integer,
  r: integer,
  points: pointsSchema,
  label: z.string().nullable(),
  completed: z.array(completionSchema),
  questPoints: integer,
  milestone: z.string().nullable(),
  victory: z.boolean(),
});
export type Outcome = z.infer<typeof outcomeSchema>;
export const statsSchema = z.object({
  tiles: integer,
  homes: integer,
  homesConnected: integer,
  walks: integer,
  largestNature: integer,
  largestWater: integer,
  levels: integer,
});
export type Stats = z.infer<typeof statsSchema>;
export const snapshotSchema = z.object({
  rules: z.string(),
  seed: integer,
  region: regionSchema,
  regionName: z.string(),
  tiles: z.array(tileSchema),
  frontier: z.array(spotSchema),
  current: handTileSchema.nullable(),
  upcoming: z.array(handTileSchema),
  remaining: integer.min(0),
  canSkip: z.boolean(),
  skipUsed: z.boolean(),
  score: integer.min(0),
  placements: integer.min(0),
  finished: z.boolean(),
  end: z.enum(['deckEmpty', 'finished']).nullable(),
  milestone: z.string().nullable(),
  nextMilestone: z.object({ name: z.string(), score: integer }).nullable(),
  victory: z.boolean(),
  victoryAt: integer.nullable(),
  quests: z.object({ current: z.array(questSchema), history: z.array(questSchema) }),
  rewards: integer.min(0),
  discarded: integer.min(0),
  cap: integer.positive(),
  recoveries: integer.min(0),
  recovery: z.enum(['swapped', 'replaced']).nullable(),
  last: outcomeSchema.nullable(),
  stats: statsSchema,
  revision: integer,
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const sideSchema = z.object({
  edge: edgeSchema,
  neighbor: edgeSchema.nullable(),
  rise: integer,
  meet: meetSchema,
  stairs: z.boolean(),
});
export type Side = z.infer<typeof sideSchema>;
export const pathReportSchema = z.object({
  joined: integer,
  open: integer,
  ended: integer,
  steep: integer,
  stairs: integer,
  homesGained: integer,
});
export type PathReport = z.infer<typeof pathReportSchema>;
export const previewSchema = z.object({
  valid: z.boolean(),
  reason: z.string(),
  elevation: integer,
  sides: z.array(sideSchema),
  neighbors: integer,
  matches: integer,
  perfect: z.boolean(),
  points: pointsSchema,
  paths: pathReportSchema,
  validRotations: z.array(integer),
  variation: integer.min(0).max(15),
  completes: z.array(questSchema),
});
export type Preview = z.infer<typeof previewSchema>;
export const resultSchema = z.object({ ok: z.boolean(), message: z.string(), snapshot: snapshotSchema });
export type GameResult = z.infer<typeof resultSchema>;
export type Command =
  | { type: 'place'; q: number; r: number; rotation: number }
  | { type: 'skip' }
  | { type: 'finish' }
  | { type: 'newGame'; seed: number }
  | { type: 'autoplay'; count: number };
export interface CorePort {
  snapshot(): Snapshot;
  preview(q: number, r: number, rotation: number): Preview;
  command(command: Command): GameResult;
  save(): string;
  load(json: string): GameResult;
  /** Loads the autosave; the same replay as `load`. */
  restore(json: string): GameResult;
}
export type HexPoint = { q: number; r: number };

/** Turns per-side data into world directions, matching the Rust rule: side `i` moves to `i + rotation`. */
export function rotateSides<T>(sides: readonly T[], rotation: number): T[] {
  return sides.map((_, side) => sides[(side - (rotation % 6) + 12) % 6] as T);
}

/** Turns an unrotated tile's edges into world directions. */
export function rotateEdges(edges: Edges, rotation: number): Edges {
  return rotateSides(edges, rotation) as unknown as Edges;
}
