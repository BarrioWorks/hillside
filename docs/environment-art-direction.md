# Barrio's environmental art direction

The selected direction is **B, Warm Painterly, with Neutral tone mapping**, chosen by the user after reviewing the engine comparisons. Golden-green ground, olive foliage and warm sunlight retain cool shadows and Colombian architectural contrast. All three directions remain configurable.

The initial implementation and performance study used C, Balanced Barrio, following the Milestone 1 independent review. Those historical images and measurements remain labeled accordingly; they are not Warm Painterly performance measurements. [Independent review](research/environment-m1-review.md) records that earlier technical recommendation.

## Visual contract

Build a painted Colombian miniature with related landscape colors, recognizable crowns, quiet open ground, and warm architecture. Preserve the existing building library, terrain elevations, path connectivity, placement rules, and deterministic simulation. Keep brand colors separate from landscape colors. Use original procedural work. Dorfromantik supplies a reference for visual relationships, not assets or a renderer specification.

At normal gameplay zoom, houses and infrastructure must remain distinct from the surrounding vegetation. Evaluate each candidate at the frozen overview before its close-up. Extra detail that disappears at this distance does not justify its cost.

## Evidence and research

Four parallel investigations connect references to this implementation:

- [Dorfromantik art direction](research/environment-a.md): verified developer statements, separate visual interpretation, and seven implementation recommendations.
- [Procedural vegetation](research/environment-b.md): ABOP, Parish and Müller, five silhouette recipes, bounded branching, cached geometry, and world-space composition.
- [Color and rendering](research/environment-c.md): official Three.js documentation checked against installed r180, tone mapping, color conversions, shadows, and fog.
- [Colombian ecosystems](research/environment-d.md): regional vegetation, topography, climate references, and eight implementation recommendations.

Each report records the source, observed Barrio issue, proposed technique, complexity, expected visual gain, predicted cost, and a concrete future verification. Predictions are not measured improvements.

Toukana identifies Romantic art, Impressionism, and board games as influences in its [developer interview](https://news.pegasus.de/en/interview-dorfromantik-the-board-game-authors-and-toukana-interactive/). Its [published visual development](https://toukana.itch.io/dorfromantik-prototype/devlog/199581/devlogromantik-3-how-things-have-evolved) provides original reference images. Our interpretation is that large color groups, restrained surface detail, and deliberate silhouette variation carry the miniature effect. These observations do not establish a particular procedural algorithm.

Colombia determines the environmental forms. [UNESCO's Coffee Cultural Landscape](https://whc.unesco.org/en/list/1121) supports cultivated green patchwork in Salento. [Medellín's environmental secretariat](https://www.medellin.gov.co/es/?p=498850) supports selective yellow and pink flowering accents. [Bogotá's botanical garden](https://jbb.gov.co/las-nineras-de-las-plantas-nativas-del-vivero-las-mercedes/) supports varied native Andean trees and shrubs. [Cartagena's botanical garden](https://data.jbgp.org.co/es/permanent-plots) documents tropical dry forest with trees, shrubs, and a smaller palm component. Do not substitute European autumn forests for these environments.

## Renderer audit

The baseline checkout is `af6f20504692321002930aec416ab266ba86eebb`. Its installed Three.js revision is 180.

| Component | Baseline finding | Decision |
|---|---|---|
| Working color | `THREE.Color` converts authored sRGB hex colors to Linear-sRGB. `Builder` writes those linear components into vertex attributes. | Preserve this conversion. Do not apply a second gamma correction. |
| Output | `renderer.outputColorSpace = THREE.SRGBColorSpace`. | Preserve explicit sRGB output. |
| Tone mapping | Neutral, with afternoon exposure 1.0. | Compare Neutral, AgX, and ACES at exposure 1.0 before selecting. |
| Sky texture | Canvas gradient tagged `SRGBColorSpace`. | Preserve correct tagging. |
| Materials | Shared `MeshStandardMaterial`, semantic surface attribute, vertex colors, procedural detail. | Extend the existing system. Do not create a material for every tree. |
| Illumination | One directional sun and hemisphere fill. No environment map or screen-space AO. | Keep one principal sun and cheap ambient fill. Retain baked ground contact darkening. |
| Shadows | 1024 PCF on low, 2048 PCFSoft on high. Updates occur on demand. | Preserve demand rendering. Radius does not soften PCFSoft in r180. |
| Fog | Linear fog 60–140, matching the horizon. | Record it with the camera. Later atmosphere work must address camera-relative depth. |
| Quality | Low tier disables procedural micro-patterns. | Broad landscape color must survive without micro-patterns. |
| Terrain | Continuous merged tops, same-height color blending, fixed playable geometry. | Add world-space color variation without displacement. |
| Vegetation | Cached tree geometry and existing instancing; later forests share rounded crowns. | Preserve batching. Replace silhouettes in Milestone 2. |

These findings follow the [Three.js color-management contract](https://threejs.org/manual/pages/color-management.html), installed source, and the [r180 tone-mapping implementation](https://github.com/mrdoob/three.js/blob/r180/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js). OKLCH CSS strings are not supported by `THREE.Color` in this version. Perceptual palette calculations must convert explicitly to linear RGB or authored sRGB values.

## Fixed scenes

[The scene manifest](screenshots/environment/scenes.json) freezes actual gameplay tile data and orthographic camera transforms. It contains Salento seed `909352` and Medellín seed `2`, each after 29 placements, for 30 total tiles. Both scenes contain residential buildings, woodland, isolated vegetation, river tiles, paths, stairs, and multiple elevations.

Each region has an overview and a river/vegetation close-up. Captures use 1440 × 900 pixels, device pixel ratio 1, high quality, afternoon lighting, and reduced motion. Baseline screenshots were captured before rendering changes. Candidate capture rejects tile-composition drift and restores the saved camera position, quaternion, target, zoom, and projection.

| Scene | Baseline screenshot | Composition |
|---|---|---|
| Salento overview | [Runtime image](screenshots/environment/baseline/909352-overview-legacy.png) | 30 tiles, 6 woodland, 3 river, 2 elevation levels |
| Salento close-up | [Runtime image](screenshots/environment/baseline/909352-closeup-legacy.png) | Same board; riverbank, canopy, shrubs, homes for scale |
| Medellín overview | [Runtime image](screenshots/environment/baseline/2-overview-legacy.png) | 30 tiles, 7 woodland, 3 river, 4 elevation levels |
| Medellín close-up | [Runtime image](screenshots/environment/baseline/2-closeup-legacy.png) | Same board; river, stairs, tall homes, woodland |

Adjacent JSON files record camera, seed, region, lighting, output settings, average and p95 frame times, sample count, draw calls, triangles, geometry count, material count, and geometry-buffer bytes. WebGL does not expose total GPU allocation. Buffer-byte estimates exclude driver overhead, textures, shadow maps, and instance buffers.

The captures use ANGLE SwiftShader software rasterization. The short capture samples are diagnostic records, not stable performance estimates. The separate alternating benchmark warms each scene, samples fixed frame counts, and repeats each configuration five times. Hardware GPU performance remains unmeasured.

## Candidate contract

| Candidate | Landscape | Light and relationship | Main review risk |
|---|---|---|---|
| A — Cool Painterly | Sage and blue-green foliage, muted olive meadow, blue-green water | Neutral daylight with cool shadows | Foliage may lose separation from turquoise facades. |
| B — Warm Painterly | Golden-green ground, olive canopy, restrained warm accents | Gentle afternoon warmth with cool fill | Yellow-green light may flatten warm architecture. |
| C — Balanced Barrio | Cool landscape foundation, controlled foliage accents, turquoise water | Warm buildings against balanced sun and fill | Must retain enough chroma to avoid a uniformly pastel scene. |

The Milestone 1 candidates use identical geometry and layout. They were inspected together before the tree overhaul. C was selected using building visibility, canopy readability, broad ground patches, river distinction, shadow detail, atmosphere, and placement readability. A and B remain comparison options.

## Applied research ledger

| Finding and source | Observed problem | Milestone 1 technique | Complexity | Expected gain | Runtime cost | Evidence |
|---|---|---|---|---|---|---|
| Three.js linear color contract, research C | Risk of compensating palette defects through double conversion or material exposure | Preserve sRGB output and single linear conversion; centralize environment configuration | Low | Reliable authored color relationships | No extra pass | Color audit and identical tone-mapping captures |
| Toukana visual development, research A | Narrow tile-based grass variation | Low-frequency world-space terrain color, unchanged geometry | Medium | Broad painted patches visible at overview | Build-time color evaluation; no extra triangles | Fixed-seed overview and shared-edge tests |
| Color harmony and OKLCH, research C | Uncoordinated local changes and RGB channel offsets | Authored region/direction ramps with bounded perceptual interpolation | Medium | Related greens with deliberate lightness/chroma | Bounded palette work outside the frame loop | Config/range/determinism tests |
| Colombia references, research D | Small regional meadow shifts | One region registry for terrain, foliage, water, and light | Medium | Regional color relationships | Configuration and uniform updates | Salento/Medellín candidates, all-region config tests |
| Existing instancing and surface tags, research B/C | Cached geometry makes per-object material changes costly | Shared semantic environment treatment | Medium | Cohesive canopy/water without building repaint | No new render pass or per-tree material | Draw-call/geometry comparisons |

## Reproduce

Start Vite with `npm run dev`. Set `BARRIO_URL` to its printed URL. Set `BARRIO_BROWSER_PATH` when the local Playwright browser is not its default executable.

```sh
BARRIO_URL=http://localhost:4174 npm run art:capture
BARRIO_URL=http://localhost:4174 npm run art:verify
BARRIO_REVIEW_STAGE=final npm run art:review
npm run art:gallery
npm run typecheck
npm run lint
npm test -- --maxWorkers=1 --no-file-parallelism
BARRIO_URL=http://localhost:4174 npm run test:e2e
BARRIO_URL=http://localhost:4174 BARRIO_BEFORE_URL=http://localhost:4175 BARRIO_BENCHMARK_STAGE=final npm run art:benchmark
```

The capture default writes the final folder; the gallery uses the development server at port 5174. The paired final benchmark requires an independently served frozen original build at BARRIO_BEFORE_URL; it refuses to compare current palette-only legacy against current trees. [Original-control asset fingerprints](verification/environment/m1-build.json) and [final fingerprints](verification/environment/final-build.json) identify both builds. The baseline mode belongs to the pre-change checkout. Do not overwrite historical baseline screenshots with later code. The checked-in scene manifest is the comparison authority.

## Implemented vegetation and composition

The five families are compact rounded, broad spreading, tall Andean, irregular woodland, and flowering accent. Each has three reusable geometry variants. Wax and coconut palms are regional additions. The [actual engine gallery](screenshots/environment/gallery/tree-families-color.png) and its [monochrome view](screenshots/environment/gallery/tree-families-monochrome.png) isolate silhouette differences; the fixed-camera board captures remain the evidence for gameplay appearance.

`models.ts` builds connected trunks and limbs with irregular, softly faceted crown lobes. Crown tones follow height and sky-facing orientation. Green crowns receive related world-space sage, deep, middle and olive color families; blossoms retain their authored gold or pink. No photographic textures or external assets are used.

`vegetation.ts` samples a seeded world grid with unique hex ownership. Broad density fields create cores, clearings, and isolated trees. Stable cell identities select family, variant, size and orientation. Dense cores permit bounded canopy overlap. Placement order does not change candidates. `tiles.ts` rejects trunks and props against building footprints including roof overhangs, walking/access areas, and waterways. Crowns cross edges only onto compatible occupied nature neighbors at equal or lower elevation. Cached models feed the existing instancing system.

Salento combines woodland with wax palms; Medellín uses varied broadleaf trees and localized flowering accents; Bogotá favors Andean crowns and shrubs without flowering accents; Cartagena uses spreading dry-forest forms and coconut palms. Regional proportions are artistic ecological approximations, not botanical species simulations.

## Water, atmosphere and integration

Warm Painterly with Neutral is the default. `?environment=cool|warm|balanced` retains the comparison directions; `?toneMapping=neutral|agx|aces` independently selects the mapper. `?environment=legacy` restores the original palette and fixed fog, but uses the new vegetation geometry. The frozen M1 build, not that query on current code, is the authoritative original-geometry performance control.

Water has a darker outer ribbon and lighter inset body, preserving outer widths and endpoint positions. World-space shading gives restrained turquoise variation; falls use the pale edge tone. No animation or simulation is introduced, so reduced motion and demand rendering remain intact. Riverbanks sample the seeded meadow field. Forest floor darkening spreads through soft warped discs that merge across compatible tiles rather than painting entire hexagons.

One directional sun and hemisphere fill remain. Regional colors apply to afternoon, daylight and evening through the same configuration. Fog is fitted to board depth in camera space; the near half remains clear and the far edge receives a bounded regional haze. Shadows retain the existing quality tiers and demand updates. Shared ghost materials receive the same environmental grading as placed tiles while retaining valid/invalid opacity and markers. Architecture meshes and the brand palette are unchanged.

| Applied finding | Source | Implementation | Complexity / runtime cost | Verification |
|---|---|---|---|---|
| Hierarchical botanical forms and bounded variation | Research B, ABOP | Five intentional trunk/crown grammars, three cached variants each | Medium; shared geometry, existing instancing | Silhouette gallery, finite/unit-normal/nondegenerate geometry tests |
| Clustered composition and regional ecology | Research A/B/D | Seeded world density, family groves, region weights and occupied-neighbor masks | Medium; placement-time sampling | Order independence, ownership, regional reachability and clearance tests |
| Coordinated canopy lightness and hue | Research C | Height-oriented vertex tones plus seeded regional families | Medium; shared shader, no extra pass | Canopy ramp/share tests and close-ups |
| Calm miniature water | Research A/C visual analysis | Nested color ribbons and broad world shading | Low; a second shallow ribbon, no reflection pass | River endpoint continuity tests and close-ups |
| Atmospheric depth without hiding the board | Research C/D | Regional sky/fill and camera-space board fog | Medium; uniform updates, no postprocessing | Fog invariance tests and regional preset captures |

## Milestone 1 verification

All 198 tests pass, including 23 new environment tests. [Test output](verification/environment/tests-m1.txt) records the complete run. All 16 scene/candidate comparisons preserve tile composition, draw calls, triangles, geometry counts, material counts, and geometry-buffer bytes. Re-rendered legacy controls have zero changed pixels in all four frozen views. [Comparison record](verification/environment/m1-comparison.json) records these checks. A deliberately corrupted manifest changed the first tile coordinate from 0 to 999; the capture command rejected it with `AssertionError: scene composition drift`.

The three tone-mapping folders contain identical-camera Neutral, AgX, and ACES renders at exposure 1.0. Neutral preserves the warm/cool relationship and placement outlines. AgX visibly compresses color contrast in these scenes. ACES adds contrast without a demonstrated benefit, so no global tone-mapper replacement is justified. These are visual judgments, not performance measurements.

## Milestone 1 performance

The [alternating benchmark](benchmarks/environment-m1.json) completes five runs per configuration, with four warm-up frames and at least 20 sampled frames per run. It tests ten-tile boards and developed runs: 43 tiles in Salento and 59 in Medellín. Actual tile counts follow the existing game's completion rules. All runs render nonzero geometry, preserve gameplay composition, and report no browser errors.

| Region and board | Legacy median frame time, median of five runs | Balanced median frame time, median of five runs | Run-median ranges, legacy / Balanced | Draw calls / triangles, both |
|---|---|---|---|---|
| Salento, 10 tiles | 250.0 ms | 216.7 ms | 216.7–250.1 / 183.3–250.0 ms | 59 / 38,286 |
| Salento, 43 tiles | 433.4 ms | 450.0 ms | 416.5–483.2 / 433.3–450.0 ms | 152 / 170,100 |
| Medellín, 10 tiles | 199.9 ms | 200.0 ms | 183.4–200.0 / 183.3–200.1 ms | 72 / 34,852 |
| Medellín, 59 tiles | 483.2 ms | 516.6 ms | 433.3–533.3 / 450.0–550.0 ms | 188 / 196,858 |

Timing verdict: inconclusive. Run ranges overlap, and SwiftShader software rasterization with explicit GPU synchronization limits the measurement. The table does not establish a hardware GPU frame rate or a speedup. Geometry and draw-call counts are unchanged in M1. Per-run averages, p95 values, render times, samples, adapter details, and errors are retained in the JSON. Final geometry and shading changes require a fresh measurement against this record.

## Final verification and visual evidence

The final comparison contains all three candidates in the same four frozen Salento/Medellín scenes. [Interactive comparison](screenshots/environment/review-final.html), [comparison assertions](verification/environment/final-comparison.json), and adjacent full-resolution PNG/JSON files record the exact cameras and composition. The final and baseline scenes compare equal; images come from the running production build. The diagnostic tree gallery is additional evidence, not a replacement for gameplay captures.

The [runtime audit](verification/environment/runtime.json) covers four regions, ten-tile and developed boards, and both quality tiers: 16 cases and 24 screenshots including daylight/evening developed views. All surface geometry has finite coordinates, unit normals, supported surface tags, and nondegenerate triangles. High/low quality produces identical geometry fingerprints. No browser or shader errors occurred. Static boards remain idle rather than continuously rendering. Vertex and index buffer bytes are estimates; total GPU memory remains unavailable through WebGL.

An actual new-game replay uses seeds 909352 and 3384, which share the same starter tile: changing seed changes placed vegetation, and returning to 909352 reproduces its exact geometry hash. This checks the world reconciliation/cache integration rather than only a pure generator.

The [final technical checks](verification/environment/check-final.txt) pass typecheck, lint, and all 228 tests in 15 files. The suite was run with one worker to avoid the worker-RPC timeouts observed under contention; failing diagnostic logs are retained rather than suppressed.

The [gameplay browser run](verification/environment/e2e-final.txt) passes all ten tests; the [visual regression rerun](verification/environment/visual-regression-final.txt) passes both inspected baselines. Hover, invalid placement, and hillside stairs have additional [runtime captures](screenshots/environment/gameplay). The developed screenshot golden changes intentionally; the original visual evidence remains in the baseline folder.

A targeted developed-board test also projects overhanging crowns into neighboring tile coordinates and checks neighboring walks and building footprints across all four regions. It passes with actual overhangs observed. This increases coverage beyond owning-tile clearance; finite seed sweeps do not establish every possible procedural board.

[Independent final review](research/environment-final-review.md) found no demonstrated gameplay/determinism blocker. Its diagnostic buffer-accounting issue is corrected by including indices in both bytes and fingerprints. It correctly distinguishes root separation from actual crown-overlap percentage: the dense-core adjustment reduces a spacing threshold by at most 25%, not a measured crown-overlap bound. Bank colors follow the meadow field, while forest-floor darkening applies only to terrain; this can leave a lighter river margin next to forest.

The design detector reports no findings. DESIGN.md records the new environmental direction; its pre-existing generated .impeccable sidecar is stale and was not regenerated as part of rendering work.

## Deliberate limits

The existing shadow tiers and geometry batching remain. No SSAO, reflection pass, leaf textures, heavyweight dependency, water animation, or distance LOD was added: the reviewed scene does not justify those costs. Contact darkening remains the existing baked geometry/material treatment. Rivers retain their existing topology and gameplay continuity; equal-height endpoint tests supplement visual checks, not a claim that every cascade or pond configuration has been exhaustively proved.

The forest-floor sampler currently visits every forest center for every ground sample during reconciliation. Final paired measurements record autoplay work and last reconciliation time as well as steady frames. Larger worlds beyond the tested game runs may warrant spatial indexing. Hardware-GPU frame-rate acceptance remains separate from this software-rendering evidence.

## Final performance comparison

The [final paired benchmark](benchmarks/environment-final.json) contains 40 runs: five per build, region and board size, alternating order, four warm-up frames and at least 20 sampled frames per run. Original and final builds have identical cameras, resolution, quality, exposure and gameplay composition. Raw completed runs are also saved in [JSONL](benchmarks/environment-final-runs.jsonl). Completed comparison groups were resumed after process interruptions; asset URLs were checked across runs.

Values below are the median of five run means and five run p95 values, in milliseconds. The renderer is ANGLE SwiftShader; profiling synchronizes GPU work. These are software-rendering measurements, not a hardware frame-rate target.

| Region / actual tiles | Original mean / p95 | Final mean / p95 | Original / final draw calls | Original / final triangles |
|---|---|---|---|---|
| Salento, 10 | 174.6 / 183.4 | 151.6 / 166.7 | 59 / 63 | 38,286 / 30,665 |
| Salento, 43 | 388.1 / 466.7 | 399.2 / 433.4 | 152 / 161 | 170,100 / 147,932 |
| Medellín, 10 | 165.9 / 183.3 | 175.4 / 200.0 | 72 / 66 | 34,852 / 31,144 |
| Medellín, 59 | 409.5 / 483.3 | 387.3 / 433.4 | 188 / 198 | 196,858 / 166,538 |

Run-median ranges: Salento 10: original 150.1–183.2, final 133.3–200.0 ms; Salento 43: original 316.7–450.0, final 333.3–400.1 ms; Medellín 10: original 150.0–183.3, final 166.6–183.3 ms; Medellín 59: original 383.2–433.3, final 350.0–433.4 ms.

Timing verdict: **inconclusive**. Every pair overlaps in run-median range, and shared-host software rasterization limits the result. No consistent speedup or hardware GPU frame rate is established. Geometry counts fall approximately 11–20%; draw-call changes range from about −8% to +7%. The visual gain comes with bounded resource changes rather than an assumed instancing speedup.

Autoplay command wall time includes core work and one reconciliation. Last-rebuild metrics include geometry, instancing, ground regeneration and scene bookkeeping. They are median-of-five values, not isolated forest-floor timings. Small Salento rebuild time rises by about 65 ms and developed Medellín by about 85 ms on this host; developed Salento is effectively unchanged. This does not justify calling all interaction performance improved.


| Region / tiles | Original autoplay / last rebuild | Final autoplay / last rebuild |
|---|---|---|
| Salento, 10 | 286.6 / 264.7 ms | 347.3 / 329.6 ms |
| Salento, 43 | 717.1 / 669.4 ms | 712.7 / 668.1 ms |
| Medellín, 10 | 277.7 / 253.1 ms | 303.7 / 287.1 ms |
| Medellín, 59 | 719.3 / 658.6 ms | 798.6 / 743.6 ms |

Hardware-GPU acceptance remains outstanding. The current tested resource budget is bounded, all static scenes stop rendering, and no expensive pass was added. Very large future worlds should replace the forest-center scan with a spatial index and remeasure reconciliation before increasing the supported board size.

## User selection: Warm Painterly

The user chose Warm Painterly after the comparison. It is now the default, including unknown-query fallback, with Neutral tone mapping unchanged. Explicit cool and balanced query options remain available. The running production preview reports candidate warm, Neutral and exposure 1.0. The follow-up environment suite passes all 31 tests, the production build passes typecheck/build, and the two updated screenshot baselines are inspected and rerun. [Build fingerprints](verification/environment/warm-default-build.json), [unit checks](verification/environment/warm-default-tests.txt), and [visual checks](verification/environment/warm-default-visual-tests.txt) record this follow-up. The earlier 228-test/16-case/40-run records describe the preceding Balanced default; their historical palette labels are preserved.
