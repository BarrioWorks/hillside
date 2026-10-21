# Barrio Builder implementation contract

The supplied master brief defines the goal. Deliver a playable browser sandbox using Rust/WASM, strict TypeScript, Vite, and Three.js. Existing files are BRAND.md and supplied PNG/WebP brand assets. There is no application or git repository yet.

## Completion checks

Open the locally running game. Place and remove houses on fixed stepped hillside terrain. Select six architecturally distinct buildings. Preview valid and invalid placements. Rotate the camera and buildings. Connect paths and elevation changes with stairs. Add props. Undo and redo. Save, reload, export, import, and start a new neighborhood. Inspect actual rendering, build, lint, and tests. Record a 500-structure benchmark with browser/GPU conditions. No backend, accounts, ML, or economic simulation.

## Data and ownership

Rust owns the catalog, deterministic terrain, placements, slopes, footprints, connectivity, command history, generation, and save validation. TypeScript owns input and UI. Three.js owns visual representation. Snapshot changes reconcile by stable placement ID; do not rebuild the terrain or whole scene on edits.

Two candidate boundaries were considered. Fine-grained WASM calls hide serialization but create more generated bindings. A JSON command/snapshot interface keeps the boundary small and testable with Rust serialization. Use the JSON boundary for this small board. Benchmark before replacing it.

Use wasm-bindgen with a `Game` class exported from `web/src/wasm/barrio_core.js`. The Rust build creates this directory. Constructor `new Game(seed: number)` generates terrain and an attractive small starter neighborhood. The Rust bridge exports these methods, each returning a JSON string:

- `snapshot()` returns Snapshot.
- `catalog()` returns BuildingDefinition[].
- `preview(kind: string, x: number, z: number, rotation: number)` returns Preview.
- `command(json: string)` returns Result.
- `save()` returns versioned save JSON.
- `load(json: string)` returns Result. Validation and replacement are atomic.

```typescript
type BuildingDefinition = {
  id: string; name: string; category: 'building' | 'path' | 'stairs' | 'prop';
  width: number; depth: number; height: number;
  description: string; color: string;
};
type Cell = { x: number; z: number; height: number };
type Structure = { id: number; kind: string; x: number; z: number; rotation: number; variation: number };
type Snapshot = {
  seed: number; width: number; depth: number; cells: Cell[];
  structures: Structure[]; canUndo: boolean; canRedo: boolean;
  connected: number; revision: number;
};
type Preview = { valid: boolean; reason: string; height: number; width: number; depth: number };
type Result = { ok: boolean; message: string; snapshot: Snapshot };
type Command =
  | { type: 'place'; kind: string; x: number; z: number; rotation: number }
  | { type: 'remove'; x: number; z: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; seed: number }
  | { type: 'benchmark' };
```

Catalog identifiers are `casa`, `tienda`, `torre`, `terraza`, `taller`, `esquina`, `path`, `stairs`, `tree`, `planter`, and `bench`. Roads use `path`. Rotation is 0, 1, 2, or 3. Cell coordinates are nonnegative. Terrain heights are integer steps, rendered at 0.55 world units per step. Horizontal cell size is 1. Use a 32 by 32 fixed terraced hillside, with several elevations and plateau areas. Buildings require flat footprints. Stairs connect one height step in their facing direction. Paths connect at equal heights. Four rotations rotate footprints. A seed controls terrain and visual variations. All messages are plain English. No duplicated placement validation in TypeScript.

## Work allocation

- Core worker owns `crates/`, root `Cargo.toml`, and Rust tests. May install wasm-pack and build WASM. No web implementation edits.
- Frontend worker owns handwritten `web/src/`, `web/tests/`, web entry files, root package.json, lockfile, frontend configs, tools/build-wasm.mjs, and frontend tests. Must render a genuine licensed GLB asset once assets arrive. Do not edit crates or research docs.
- Asset integration worker owns `tools/asset-pipeline/`, `web/public/models/`, and `docs/runtime-asset-report.md`. This ownership was transferred from the frontend worker after source acquisition to avoid a pipeline bottleneck.
- Rendering optimization worker owns `web/src/render/world.ts`, `web/src/render/batches.ts`, and `web/tests/batches.test.ts` after the first measured 500-structure run. The frontend worker retains other frontend files.
- Research worker owns `docs/open-source-research.md`, `docs/research-ledger.md`, `docs/asset-manifest.md`, and `tools/research/`. Download only selected models and licenses into `asset-sources/`. Supply asset metadata to parent; do not edit web or Rust files.
- Parent owns integration docs, architecture, audit log, verification, and final corrections after writers return. Workers use disjoint paths in this shared checkout.

## Art and experience

Full-screen orthographic diorama, warm soft sunlight, shadows, lush small props, terraced hills, and a distant atmospheric landscape. Six distinct brick/plaster Medellín-inspired buildings have flat roofs, parapets, grilles, balconies, storefronts, tanks, extensions, and terraces. Controlled terracotta, brick, coral, mustard, pastel blue, turquoise, cream architectural plaster, and concrete gray. This specific game palette supersedes the brand's prohibition for architecture only. Keep UI clean white/cool gray with cobalt accents and Nunito Sans/Fraunces. Floating compact bottom palette, minimal top toolbar, useful contextual feedback, no large permanent sidebar. Mouse/touch pointer input. Orbit, pan, zoom, ghost model, sound on explicit interaction, placement pop animation, reduced-motion support. User-facing screens should read as a polished game, never as a tech demo.

## Research and assets

Inspect actual implementation and license of mxgmn/WaveFunctionCollapse, marian42/wavefunctioncollapse, Basinity/CitySimulator, and Three.js examples. Inspect Kenney Modular Buildings, Quaternius Ultimate Textured Buildings, Kenney City Kit Commercial, and Kenney Building Kit. Import selected CC0 geometry with source license, normalize and adapt into GLB, use it in the actual renderer. Study Müller 2006 shape grammar, Farrokhi Maleki/Zhao 2024 PCG survey, simpler deterministic generation versus WFC, mixed-initiative details, and measured instancing. Record accepted ideas with code/tests; rejected ideas need concrete reasons. Research supports implementation rather than blocking it.

## Verification

Rust tests cover terrain, multi-cell footprints, slopes, stairs, connectivity, deterministic generation, versioned serialization, malformed saves, atomic loading, undo/redo, and benchmark population. Frontend tests cover selections, asset failures, input state, camera, persistence. Browser E2E opens the game, places a building, connects a path, removes/undoes, saves/reloads, and captures screenshots. Asset validator checks buffers/textures, geometry, bounds, counts, transforms, and provenance. Contact sheet uses identical camera and lighting and includes gameplay-scale 128px previews. Performance target is 60 FPS desktop, minimum 30 mobile, requiring actual measured conditions. Do not claim real-device results from software-rendered automation.
