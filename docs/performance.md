# Performance validation

## Acceptance status

The playable vertical slice passes its functional checks. Performance acceptance remains open. The 60 FPS desktop and 30 FPS physical mobile targets have not been measured on suitable hardware. The software-rendered stress workload is below both targets.

## Production browser measurement

Measured 2026-10-20T22:23:10.898Z using Chromium 134.0.6998.35, explicit SwiftShader through ANGLE, Linux 7.0.0-34-generic, AMD EPYC 7B13, eight advertised logical CPUs, and a 1440 × 900 viewport at pixel ratio 1. Host load average at start was [0.9, 1.91, 2.75]. No parallel builds or regression tests ran during sampling.

The production harness generates a deterministic 1,024-structure neighborhood, imports 500 evenly distributed structures through the real file input, warms for three seconds, and takes five eight-second samples. It asserts the actual structure count, visible document, nonzero rendered frames, loaded GLB, and zero request or page errors. Continuous rendering prevents idle callbacks from being counted as rendered frames.

| Run | Rendered frames | Actual FPS | Draw calls | Triangles |
| --- | --- | --- | --- | --- |
| 1 | 19 | 2.372 | 25 | 475,469 |
| 2 | 9 | 1.124 | 25 | 475,469 |
| 3 | 9 | 1.124 | 25 | 475,469 |
| 4 | 8 | 0.999 | 25 | 475,469 |
| 5 | 9 | 1.124 | 25 | 475,469 |

Median throughput is **1.124 FPS**, with a range of 0.999 to 2.372 FPS across five runs. Reported animation-frame intervals include scheduling and software rasterization. Early interval samples can precede sustained rendering, so throughput uses actual rendered frames divided by host elapsed time. Software rasterization is an inferred limiter, not a hardware GPU profile.

The renderer holds 18 active structure batches, 24 geometry resources, and two texture resources throughout sampling. It submits 25 draws and 475,469 triangles. Initial stress-scene readiness took 1232.5 ms, including navigation, assets, and the 1,024-structure scene. Import and reconciliation of the 500-structure save took 73.4 ms end to end. These single startup observations are not percentile latency estimates. The run recorded zero page or request errors.

[Raw results](benchmarks/software-renderer.json) include exact build asset names, browser renderer, environment, all samples, and runtime counters. Reproduce with a production preview on port 4173 and `npm run benchmark`. `BARRIO_URL` and `BARRIO_BROWSER_PATH` select another local preview and installed browser.

## Adopted rendering changes

The initial scene submitted 505 draws. Shared-resource instancing now submits 25 for the same 500-structure workload while preserving visible child details and logical picking IDs. The original run was contended by a build and browser tests. Its [raw diagnostic](benchmarks/software-renderer-before-contended.json) is preserved, but its timing cannot establish a comparative speedup.

Edits reconcile by stable ID and update affected instance matrices. The renderer caches shadows and skips idle draws. Nine batching unit tests exercise instance picking, movement, removal, reflected transforms, and shared resources. Production browser tests exercise roof picking after batching.

## Rust core and resource observations

The same release WASM benchmark command generated and serialized 1,024 structures in a median 3.844 ms across five fresh games after warmup. The range was 1.838 to 5.621 ms, with zero failures. JavaScript command creation and response parsing stay outside the timed region. This [Node 24 WASM measurement](benchmarks/core-wasm.json) excludes browser scheduling and rendering and cannot establish gameplay frame rate. Reproduce with `npm run benchmark:core`.

Six actual add/remove cycles in the collaborative Chromium 154 browser retained 35 geometries, four textures, and 29 allocated batches after every removal. The [resource observations](benchmarks/edit-resource-proxies.json) show bounded counters for this short edit sequence. They do not measure GPU bytes or establish long-duration memory stability.

## Remaining acceptance work

Measure a representative hardware desktop and physical mid-range mobile device, record GPU and browser, and repeat the same workload. Profile frame costs before choosing further rendering changes. Validate prolonged editing and physical touch behavior. Mobile viewport emulation and SwiftShader are insufficient evidence for these device targets.
