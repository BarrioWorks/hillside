# Barrio Builder architecture

## Runtime

The browser runs the game. Vite serves the development application and builds static production files. Rust compiles to WebAssembly through wasm-bindgen. Three.js renders the neighborhood. No single-player network service is required.

The workspace began with the organizational brand guide and two supplied artwork files. There was no application, package manager setup, Rust crate, test harness, or existing source-control repository to preserve.

## Domain boundary

The domain is a terraced grid, a catalog, placed structures, and undoable commands. Each structure has a stable ID, catalog kind, cell origin, quarter-turn orientation, and seeded variation. A versioned save describes the reproducible neighborhood.

Rust owns terrain heights, footprints, placement validation, connections, generation, history, and save validation. It returns a catalog and snapshots through a small JSON interface. TypeScript sends commands and uses Rust's preview result to show valid and invalid placements. Rendering never decides whether a placement is legal.

The exact contract is in [implementation-contract.md](implementation-contract.md). A snapshot includes its revision and undo/redo availability. Failed commands return the unchanged snapshot and a plain-language refusal. Save loading validates a candidate before replacing the active neighborhood.

## Rendering and interaction

Three.js uses an orthographic camera. Pointer raycasting maps a visible terrain cell to integer coordinates. The preview model comes from the same architectural catalog as placed buildings. Camera gestures must not trigger placement when the pointer is released.

The renderer retains terrain and scenery between commands. Structures reconcile by stable ID so an edit only adds or removes affected visual objects. Shared geometries, materials, and structure instances reduce resource duplication.

The measured 500-structure scene initially submitted 505 draw calls. `StructureBatches` now groups matching geometry and materials, including imported child details, into instanced draws. Each placement retains a logical transform and stable ID. Per-batch slots map raycast instances back to those IDs. Removal swaps the last active slot into the gap, and only changed matrices are uploaded. Conservative bounds expand during movement and reset when a batch empties.

The renderer skips redundant idle draws and caches directional shadow maps. Placement, completed pop animation, terrain changes, and asset loading invalidate shadows. Software renderers automatically use pixel ratio 1 and a 512px shadow map. Hardware defaults allow pixel ratio 2 and a 2048px map. The explicit quality query parameter overrides automatic selection.

Benchmark mode forces continuous rendering. Its frame throughput therefore counts actual rendered frames rather than idle animation-loop callbacks. Static idle metrics must not be interpreted as sustained gameplay FPS.

The interface is a floating palette and small toolbar. Browser-local persistence provides a neighborhood without accounts. Portable files provide explicit export and import. Web Audio begins after a player interaction and can be muted.

## Alternatives considered

A fine-grained WASM interface could expose terrain and structure handles directly. That adds binding types and more ownership transitions. The initial JSON command and snapshot interface keeps validation, persistence, and native tests aligned for a small board.

A full WFC solver could propagate tile constraints across the map. Fixed terraces and direct player placement need local deterministic rules first. The research ledger records which techniques actually enter the implementation and which remain unnecessary.

An ECS, physics engine, backend, and cloud save system add no required capability to the first sandbox. They are outside the initial implementation.

## Asset boundary

Imported geometry must have its original license, author, source, and modification record. Source files remain separate from selected runtime GLBs. A validation tool checks geometry, textures, transforms, bounds, counts, and provenance. A shared lighting/camera contact sheet supports visual review at large and gameplay sizes.

## Verification

Native Rust tests exercise rules and persistence without the renderer. Frontend tests exercise interaction state and integration boundaries. Browser tests exercise placement, path creation, undo, and save/reload through the running application. Screenshots support visual checks rather than substituting for playable behavior.

Performance results belong in [performance.md](performance.md), including browser, renderer, viewport, workload, sample count, and limitations. A software-rendered browser is not evidence of a physical desktop or phone meeting its frame-rate target.
