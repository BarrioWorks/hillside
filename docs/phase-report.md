# Playable vertical slice delivery

The browser-local sandbox is implemented. Hardware performance acceptance remains open. [Run and play instructions](../README.md) describe the local launch and controls.

| Phase | Implemented behavior | Code | Evidence and remaining work |
| --- | --- | --- | --- |
| 1. Playable foundation | Rust/WASM owns terrain and placement. Three.js renders an orthographic hillside. Players place and remove buildings. | `crates/barrio-core/`, `web/src/core.ts`, `web/src/input.ts`, `web/src/render/` | Native tests, compiled WASM checks, and production gameplay tests pass. Kenney building-a loads as the off-board landmark. |
| 2. Architectural quality | Six distinct building silhouettes have controlled seeded variations, roof details, grilles, balconies, and storefronts. | `web/src/render/models.ts`, `tools/asset-pipeline/`, `web/public/models/` | Five CC0 GLBs are normalized and validated. Awning and overhang geometry appears in placeable buildings. Identical-lighting contact sheets show eleven objects at 128px and 512px. |
| 3. Neighborhood construction | Paths, directional stairs, connectivity, props, rotations, undo, redo, reset, browser saves, and portable import/export work. | `crates/barrio-core/src/world.rs`, `lib.rs`, `web/src/controller.ts`, `persistence.ts` | Eighteen Rust tests and production browser persistence/history tests pass. Imported saves are validated atomically. Allocator wraparound passed independent compiled-WASM review. |
| 4. Polish and performance | Ghost feedback, placement animation, optional sound, reduced motion, responsive controls, cached shadows, incremental updates, and structure instancing are implemented. | `web/src/render/batches.ts`, `world.ts`, `web/src/sound.ts`, `ui.ts`, `style.css` | Twenty-three frontend tests and nine production browser tests pass. The 500-structure benchmark reports 25 draws. Its software-rendered throughput is below targets. Physical desktop and mobile FPS, prolonged hardware memory profiling, and physical touch acceptance remain unverified. |

## Research decisions implemented

The source review led to explicit stair endpoints and connectivity traversal, a seeded constructive generator, hierarchical facade composition, official OrbitControls and GLTFLoader integration, and shared-resource instancing. A full WFC solver, runtime machine learning, backend service, ECS, and physics engine were rejected for this slice. [Open-source research](open-source-research.md) and the [research ledger](research-ledger.md) connect findings to code and verification.

## Assets and visual evidence

Selected Kenney City Kit Commercial geometry retains its CC0 license and source hashes. The [asset manifest](asset-manifest.md) and [runtime report](runtime-asset-report.md) identify normalization and modifications. The original source assets remain separate from the web build.

- [Desktop scene](screenshots/desktop.png).
- [Mobile scene](screenshots/mobile.png).
- [Six-building contact sheet](screenshots/building-contact-sheet.png).
- [Full catalog contact sheet](screenshots/contact-sheet-full.png).

## Verification and review

[Verification summary](verification/summary.md) records formatting, lint, type checking, native tests, actual release WASM execution, frontend tests, asset validation, production build, and browser tests. The browser suite covers placement, path connection, removal, undo, redo, save, reload, export, import, camera gestures, responsive layout, screenshot comparisons, roof picking, contact sheets, reset cancellation, and the mobile Save name.

[Final independent review](verification/final-review.md) closed the two returned UI findings. Its ship verdict is scoped to those findings and is not a whole-product accessibility certification. [Performance validation](performance.md) preserves raw benchmark conditions and distinguishes measured software rendering from physical-device targets.
