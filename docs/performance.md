# Performance validation

## Acceptance status

The hardware targets are not measured. Those targets are 60 FPS on a hardware desktop and 30 FPS on a physical mid-range mobile device. This host has no GPU. Every number below comes from SwiftShader, a CPU software rasterizer. Its costs do not scale like a GPU's, so these results support A/B comparison on the same host only. They do not predict device frame rates.

## Environment

- Chromium 134.0.6998.35, headless, with SwiftShader forced through ANGLE (`--use-angle=swiftshader`).
- Viewport 1440 × 900 at pixel ratio 1.
- Host: AMD EPYC 7B13, 8 vCPU, Linux 7.0.0-34-generic.
- Workload: the production benchmark scene. `tools/benchmark.mjs` generates the deterministic stress neighborhood and imports 500 evenly distributed structures through the real file input. It then warms up for 3 seconds and records five 8-second runs with continuous rendering.
- Contention: another agent compiled Rust on the same host during the A/B runs. The 1-minute load average at the start of each run file was 4.24 to 10.62 (`host.loadAverageAtStart` in `docs/benchmarks/ab/*.json`). Most runs started between 7.5 and 10.

## Method: render cost

Frame intervals on SwiftShader include browser scheduling and idle time. The redesign therefore measures render cost directly. With `?profile`, `World.frame()` in `web/src/render/world.ts` times `renderer.render()` followed by a synchronous 1-pixel `gl.readPixels`. In this Chrome build, `gl.finish()` returned in 1 to 2 ms and did not wait for the frame. The readback forces the frame to complete. `metrics().renderMs` reports the median over the sampled frames. The readback stalls the pipeline, so `renderMs` measures cost per frame, not achievable throughput.

For the baseline, the prototype build (commit 95b9f82) was patched with the identical probe in a temporary worktree. The baseline and low-tier runs were interleaved: low 1 at 06:33, baseline 1 at 06:34, low 2 at 06:36, baseline 2 at 06:38 UTC (`recordedAt` in each file). The high-tier runs were recorded earlier, at 06:07 and 06:10, before the arithmetic-hash change in commit 6fbc65a. All A/B runs predate commit f51038b (parked motorcycles, varied water tanks), whose cost is not measured.

## A/B results, 500-structure scene

Per-run median `renderMs`, five runs per file, rounded to the millisecond.

| Build | File 1 | File 2 | Median of 10 | Triangles | Draws |
| --- | --- | --- | --- | --- | --- |
| Prototype | 1356, 1009, 976, 982, 1022 | 986, 1006, 1019, 1032, 908 | 1007 | 475,469 | 25 |
| Redesign, low tier | 1299, 1161, 1311, 1256, 1306 | 1415, 1397, 1343, 1324, 1315 | 1313 | 620,089 | 62 |
| Redesign, patterns on | 2093, 2285, 2061, 2019, 1917 | 2051, 2049, 2013, 2081, 1996 | 2050 | 620,089 | 62 |
| Redesign, high tier, after hash change | 1932, 1824, 1802, 1799, 1757 | 1722, 1824, 1828, 1800, 1801 | 1801 | 620,039 | 62 |
| Redesign, low tier, final build | 1209, 1418, 1283, 1238, 1277 | | 1277 | see file | 62 |

Sources: `docs/benchmarks/ab/baseline-run1.json`, `baseline-run2.json`, `redesign-low-run1.json`, `redesign-low-run2.json`, `redesign-high-run1.json`, `redesign-high-run2.json`, `redesign-high-hashfix-run1.json`, `redesign-high-hashfix-run2.json`, and `docs/benchmarks/software-renderer-redesign.json` (final build, after commit f51038b, so it includes motorcycles and varied tanks). The hash-change runs used `BARRIO_QUALITY=high` and were not interleaved with a baseline run; their start load averages were 4.3 and 8.1.

On this host, the low tier costs about 1.30 times the prototype per frame (1313 / 1007 ms). With patterns on, the cost is about 2.04 times (2050 / 1007 ms). The pattern runs record `graphics.quality` as `low` because patterns were not yet tied to the quality tier when they ran. They used the low tier's 1024 px PCF shadows with the pattern shader compiled in. Measured throughput with the probe active was 0.77 to 1.13 FPS for the prototype, 0.71 to 0.86 FPS for the low tier, and 0.44 to 0.51 FPS with patterns (`runs[].framesPerSecond`).

Quality tiers (`World` constructor in `web/src/render/world.ts`):

- **Low.** Selected automatically when the WebGL renderer string matches SwiftShader, llvmpipe, or "software", or with `?quality=low`. Pixel ratio 1, `PCFShadowMap` at 1024 px, and no procedural micro-patterns (`setPatterns(false)` in `material.ts`).
- **High.** Default on hardware, or `?quality=high`. Pixel ratio up to 2, `PCFSoftShadowMap` at 2048 px, and brick, stone, paving, and mural patterns.

## Limiter investigation

`tools/profile-layers.mjs` attributes render cost on the 1,023-structure stress scene by changing one layer at a time. It ran two interleaved rounds on the production build at 1440 × 900 with a start load average of about 7 to 9. Raw results: `docs/benchmarks/limiter.json`.

| Configuration | Round 1 ms | Round 2 ms |
| --- | --- | --- |
| High tier, patterns on | 3157 | 3222 |
| Low tier, patterns off | 1946 | 2053 |
| High tier, structures hidden | 377 | 383 |
| High tier, all lit materials swapped to unlit | 930 | 807 |

Two earlier exploratory single runs, not committed, pointed the same way. `MeshLambertMaterial` measured 3363 and 3625 ms against 3569 and 3453 ms for `MeshStandardMaterial`, so the lighting model itself is not the cost. At a quarter viewport (720 × 450) the prototype measured 543 to 619 ms and the untrimmed redesign 1045 to 1758 ms.

Conclusion: on SwiftShader, lit shading (lights, shadow sampling, fog) and the pattern shader dominate. Structures carry almost all of the cost (about 380 ms remains with them hidden). Triangle count alone did not move render time: trimming from 792,752 to 620,089 triangles left render cost unchanged within run-to-run noise. This may not transfer to GPUs, where vertex and fragment costs balance differently. The pattern shader is therefore a high-tier feature, and software renderers fall back to the low tier automatically.

## Geometry trimming

Average triangles per model over its variants. The "after" column is printed by the unit test `keeps every building variant within its triangle budget` in `web/tests/models.test.ts`, which also fails any variant above 3,600 triangles. The prototype column comes from running the same count against commit 95b9f82 (three variants each, procedural meshes only; the prototype also attached GLB awnings to two kinds). The "before trimming" column is an implementation measurement from the redesign before commit 6fbc65a and has no committed raw file.

| Kind | Prototype | Redesign before trimming | Redesign after |
| --- | --- | --- | --- |
| casa | 617 | 1486 | 1136 |
| tienda | 497 | 1709 | 1365 |
| torre | 2337 | 3099 | 2450 |
| terraza | 825 | 3794 | 2741 |
| taller | 449 | 948 | 780 |
| esquina | 1025 | 3300 | 2610 |
| path | 120 | | 60 |
| stairs | 192 | | 198 |
| tree | 292 | | 315 |

Changes, all in commit 6fbc65a:

- Geometry is indexed with `mergeVertices` in `Builder.finish()` (`web/src/render/builder.ts`).
- Downward faces are removed (`keepUpward()`). The camera clamps the polar angle to at most 1.2 rad (`controls.maxPolarAngle`), so those faces are always back-facing.
- Balconies use a solid parapet with a light rail, and roof rails use fewer posts (`balcony()` and `roof()` in `architecture.ts`).
- Window grilles appear only on ground floors.

## Resource leak fixed

Placement rings created one mesh and one geometry per landing. A bulk load therefore created 1,029 GPU geometries (implementation measurement). Commit 3050177 fixed this in two ways. A pool of 6 ring meshes now shares one `RingGeometry` (`World.ring()`). Only edits of 4 or fewer structures animate (`ANIMATED_EDIT_LIMIT`). After the fix:

- The 500-structure scene holds 91 geometries and 2 textures during sampling (`runs[].metrics.geometries` in `docs/benchmarks/ab/redesign-low-run1.json`). The prototype held 24 geometries.
- The benchmark's memory check places and removes 20 casas per cycle. It holds 95 geometries after cycle 1 and after cycle 10 in all four redesign A/B files, and 96 after cycle 1 and cycle 10 in the final-build file (`memory` in `docs/benchmarks/software-renderer-redesign.json`).
- A 40-cycle place-and-remove test held 86 geometries at every 5-cycle check (implementation measurement).

These counters do not measure GPU bytes.

## Import time

`World.reconcile()` records its own duration as `metrics().reconcileMs`. Reconciling the imported 500-structure save took 26.8 ms in the final-build benchmark (`runs[0].metrics.reconcileMs` in `docs/benchmarks/software-renderer-redesign.json`).

The benchmark's `importMilliseconds` is wall time from `setInputFiles` until the snapshot reports 500 structures. With `?profile`, benchmark mode renders continuously and each frame stalls on the readback for about 1.3 s, so this wall time mostly counts profiled frames: 23.1 s in the final-build file and 3.3 to 20.0 s in the interleaved A/B files for both builds. Without the probe, the pattern-run files recorded 79.6 and 91.0 ms, and the prototype's earlier uncontended measurement was 73.4 ms (`docs/benchmarks/software-renderer.json`).

## On-demand rendering

The renderer draws only when something changes. `World.frame()` renders when `needsRender` is set, when the camera moves, or while an animation runs. An idle scene has no continuous animation by design. Shadow maps have `autoUpdate = false` and re-render only through `invalidateShadows()`, which runs on edits, lighting changes, and animation completion. Benchmark mode forces continuous rendering so throughput counts real frames.

## Measuring on real devices

1. `npm ci && npm run build`
2. `npm run preview -- --port 4173`, and note the URL.
3. Hardware desktop: open `http://<host>:4173/?benchmark&profile` in Chrome. `tools/benchmark.mjs` forces SwiftShader through its launch flags. For hardware numbers, remove `--use-angle=swiftshader` and `--enable-unsafe-swiftshader` from the `chromium.launch` args, or point `BARRIO_BROWSER_PATH` at a headed Chrome with GPU access. Then run `BARRIO_URL=http://127.0.0.1:4173 BARRIO_BENCHMARK_OUT=docs/benchmarks/<device>.json node tools/benchmark.mjs`.
4. Read `runs[].metrics.renderMs` (render cost), `runs[].framesPerSecond` (throughput with the probe active), `quality.renderer` (confirm a hardware GPU string), and `quality.quality` (confirm the tier). For throughput without the probe's stall, load `/?benchmark` without `profile` and read `framesPerSecond`.
5. Physical mobile: serve the preview on the LAN and open `/?benchmark&profile` on the device. Read `window.__barrio.metrics()` through remote debugging (Chrome `chrome://inspect` or Safari Web Inspector) after a few seconds. Record the device model, browser version, and GPU.

Record the device, GPU, browser, quality tier, viewport, and pixel ratio with every result.

## Rust core

The release WASM benchmark generated and serialized 1,024 structures in a median of 3.844 ms across five fresh games (`docs/benchmarks/core-wasm.json`, prototype era). It excludes rendering. Reproduce with `npm run benchmark:core`.

## Historical files

`docs/benchmarks/software-renderer.json` and `software-renderer-before-contended.json` record the prototype's frame-throughput benchmark. That benchmark had no render-cost probe and a different method. Do not compare them directly with the A/B files.
