# Barrio Builder architecture

## Runtime

The browser runs the game. Vite serves the development application and builds static production files. Rust compiles to WebAssembly through wasm-bindgen. Three.js renders the neighborhood. No single-player network service is required.

The workspace began with the organizational brand guide and two supplied artwork files. There was no application, package manager setup, Rust crate, test harness, or existing source-control repository to preserve.

## Domain boundary

The domain is a terraced grid, a catalog, placed structures, and undoable commands. Each structure has a stable ID, catalog kind, cell origin, quarter-turn orientation, and seeded variation. A versioned save describes the reproducible neighborhood.

Rust owns terrain heights, footprints, placement validation, connections, generation, history, and save validation. It returns a catalog and snapshots through a small JSON interface. TypeScript sends commands and uses Rust's preview result to show valid and invalid placements. Rendering never decides whether a placement is legal.

The exact contract is in [implementation-contract.md](implementation-contract.md). A snapshot includes its revision and undo/redo availability. Failed commands return the unchanged snapshot and a plain-language refusal. Save loading validates a candidate before replacing the active neighborhood.

## Rendering and interaction

Three.js uses an orthographic camera. Pointer raycasting maps a visible terrain cell to integer coordinates. The preview model comes from the same generator as placed buildings. Camera gestures must not trigger placement when the pointer is released.

Render modules in `web/src/render/`:

- `world.ts`: `World` owns the renderer, camera, controls, reconciliation, picking, ghost and remove previews, placement animation, quality tiers, and metrics.
- `palette.ts`: the named sRGB palette and the surface ids written to a vertex attribute.
- `builder.ts`: `Builder` merges colored, surface-tagged primitives into one indexed geometry. It bakes base occlusion and drops downward faces.
- `architecture.ts`: the shape grammar for the six building kinds. Mass, storeys, bays, openings, and roof slots.
- `models.ts`: `ModelLibrary` caches geometry by kind and one of 16 variants. Streets are also keyed by their four-side context. It also builds streets, stairs, trees, planters, and benches.
- `material.ts`: one shared `MeshStandardMaterial` patched with `onBeforeCompile`. The surface id selects brick, stone, paving, mural, and noise patterns, plus roughness, metalness, and evening window glow.
- `terrain.ts`: terraces, retaining walls with coping, terrace occlusion, the diorama slab, the margin vegetation, and the invisible pick grid.
- `decor.ts`: derived details. Grass tufts and flowers on free cells, utility poles along streets, cables to nearby homes, and parked motorcycles on street cells next to buildings.
- `lighting.ts`: sun, hemisphere light, sky gradient, and fog for the three presets.
- `batches.ts`: `StructureBatches` packs placements into `InstancedMesh` batches.
- `thumbnails.ts`: palette and contact-sheet thumbnails.

There are no runtime model files. Every building is generated in TypeScript from its kind and saved variation.

The renderer retains terrain and scenery between commands. Structures reconcile by stable ID. A placement rebuilds only when its signature changes. The signature covers kind, cell, rotation, variation, height, and street context. Decor is recomputed from the snapshot after each reconcile.

`StructureBatches` groups matching geometry into instanced draws. Each placement retains a logical transform and stable ID. Per-batch slots map raycast instances back to those IDs. Removal swaps the last active slot into the gap, and only changed matrices are uploaded. The 500-structure benchmark scene submits 62 draws (`docs/benchmarks/ab/`).

The renderer draws only on change. Shadow maps have auto-update disabled. Edits, lighting changes, and animation completion invalidate them. Software renderers automatically use the low tier: pixel ratio 1, 1024px PCF shadows, and no procedural patterns. Hardware uses the high tier: pixel ratio up to 2, 2048px soft shadows, and patterns. The `quality` query parameter overrides automatic selection. `?profile` adds a per-frame render-cost probe (see [performance.md](performance.md)).

Benchmark mode forces continuous rendering. Its frame throughput therefore counts actual rendered frames rather than idle animation-loop callbacks. Static idle metrics must not be interpreted as sustained gameplay FPS.

The interface is a floating palette, a top toolbar with a lighting popover, and a view toolbar. The whole interface can be hidden. Browser-local persistence provides a neighborhood without accounts. Portable files provide explicit export and import. Web Audio begins after a player interaction and can be muted.

## Terrain versions

Rust generates terrain by a named generator stored in each save. `hillside-v2` (contour terraces from quantized smooth noise, with neighbors limited to one step) is the default. `hillside-v1` (straight bands) remains so older saves load unchanged. See `Generator` in `crates/barrio-core/src/terrain.rs`.

## Alternatives considered

A fine-grained WASM interface could expose terrain and structure handles directly. That adds binding types and more ownership transitions. The initial JSON command and snapshot interface keeps validation, persistence, and native tests aligned for a small board.

A full WFC solver could propagate tile constraints across the map. Fixed terraces and direct player placement need local deterministic rules first. The research ledger records which techniques actually enter the implementation and which remain unnecessary.

An ECS, physics engine, backend, and cloud save system add no required capability to the first sandbox. They are outside the initial implementation.

## Asset boundary

The runtime loads no imported geometry. The prototype's Kenney GLB models, the asset build and validation pipeline, and the GLB loader were removed in commit 60d2805. The Kenney sources stay in `asset-sources/` with their licenses and provenance ([asset-manifest.md](asset-manifest.md)). Any future imported asset must again carry its original license, author, source, and modification record. The `/?contact-sheet` page renders the procedural catalog under shared lighting for visual review.

## Verification

Native Rust tests exercise rules and persistence without the renderer. Frontend tests exercise interaction state and integration boundaries. Browser tests exercise placement, path creation, undo, and save/reload through the running application. Screenshots support visual checks rather than substituting for playable behavior.

Performance results belong in [performance.md](performance.md), including browser, renderer, viewport, workload, sample count, and limitations. A software-rendered browser is not evidence of a physical desktop or phone meeting its frame-rate target.
