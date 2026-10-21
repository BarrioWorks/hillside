# Visual redesign report

The visual overhaul ran from the prototype baseline (commit 95b9f82) through commit 935c8ba on 2026-10-21. It replaced the pastel blocks and flat bands of terraces with a Medellín hillside diorama. Research and the planned techniques are in [visual-reference-analysis.md](visual-reference-analysis.md). The outcome of each technique is in [visual-research-ledger.md](visual-research-ledger.md). Measurements are in [performance.md](performance.md).

## What changed

**Rendering.** One shared `MeshStandardMaterial` now covers all opaque world geometry. A per-vertex surface id selects procedural brick, stone, paving, mural, and noise patterns in the shader (`web/src/render/material.ts`). Patterns fade by screen-space derivative to avoid moiré. Tone mapping changed from ACES at exposure 1.15 to Neutral at 1.0 to 1.05. Low and high quality tiers exist, and software renderers select the low tier automatically. A `?profile` render-cost probe supports A/B measurement.

**Materials and palette.** `web/src/render/palette.ts` defines 13 researched colors, 3 neutrals, and material colors. Street facades are painted. Upper floors and side and back walls are mostly exposed brick, set by per-variant finish rules in `architecture.ts`.

**Buildings.** The prototype's hand-placed boxes and GLB details are gone. A shape grammar (`web/src/render/architecture.ts`) builds each of the six kinds in 16 variants. Each building stacks storeys with slab bands and splits facades into bays. The bays become windows, doors, shops, shutters, and balconies. Most variants cantilever the upper floor over the street. Roofs place black or blue water tanks, plants, laundry lines, dishes, sheds, and rebar stubs into non-overlapping slots.

**Terrain.** Rust generates contour terraces (`hillside-v2`) from quantized smooth noise, with neighbors limited to one step. Version 1 saves keep straight bands. Each terrace edge has a stone retaining wall and a concrete coping. Grass darkens at the foot of each wall.

**Environment.** The board is a floating diorama slab with soil sides and a tree and shrub fringe. The prototype's ground plane and tree field were removed. `decor.ts` adds grass tufts and flowers on free cells, utility poles along streets with sagging cables to nearby homes, and parked motorcycles on street cells next to buildings (commit f51038b). Streets get curbs, railings at drops, and occasional lamps. Three lighting presets each set the sun, sky, gradient background, and fog. Evening lights windows.

**UI.** The interface moved from cool white with cobalt to warm cream with a terracotta accent (`web/src/style.css`, commit 3a1fc8c). The palette uses icon tabs and compact 64px rendered model cards. New controls are a lighting popover, view-rotate buttons, a hide-interface button, and a count chip.

**Interaction.** `Q` and `E` rotate the view a quarter turn. `H` hides the interface. The remove tool highlights its target with a coral volume. The valid ghost is warm off-white, and the invalid ghost is a muted coral. The zoom range widened to 0.55 to 6, so close-ups are possible.

**Motion and sound.** Placement drops and settles in 280 ms, with a pooled landing ring. Removal shrinks in 170 ms. Bulk edits of more than 4 structures appear at once. Sound changed to synthesized foley: a triangle tone and a filtered noise click with ±8% pitch jitter.

## Before and after

Each image shows the prototype on the left and the redesign on the right, from the same camera.

- [00-starter.jpg](screenshots/compare/00-starter.jpg): The new starter is a dense block along a stair spine and three cross streets. The prototype scattered single houses on bands.
- [01-single-house.jpg](screenshots/compare/01-single-house.jpg): At zoom 6, the new casa shows slab bands, framed windows, a door, a tank, rebar stubs, and stone retaining walls with brick coursing.
- [02-six-buildings.jpg](screenshots/compare/02-six-buildings.jpg): The six kinds read as brick buildings with painted fronts on a contour terrace. The prototype showed six pastel blocks.
- [03-dense-hillside.jpg](screenshots/compare/03-dense-hillside.jpg): Retaining walls step along contours, and poles and cables link the streets to houses.
- [04-full-diorama.jpg](screenshots/compare/04-full-diorama.jpg): A bounded slab with soil sides sits against a sky gradient. It replaces the endless pale plane and tree field.
- [05-gameplay-ui.jpg](screenshots/compare/05-gameplay-ui.jpg): The cobalt-on-white controls became smaller cream controls. Placement feedback reads "Ready to build" beside a warm ghost.
- [06-reverse-angle.jpg](screenshots/compare/06-reverse-angle.jpg): From the reverse angle, the back and side walls show exposed brick.
- [07-low-angle.jpg](screenshots/compare/07-low-angle.jpg): At a low polar angle, the image shows balconies, colored street facades, stairs between terraces, and street lamps.
- [08-mobile.jpg](screenshots/compare/08-mobile.jpg): On a 390px-wide screen, the whole diorama fits above a compact palette. The prototype was cropped to a few buildings.
- [lighting-presets.jpg](screenshots/compare/lighting-presets.jpg): Warm afternoon, bright daylight, and soft evening. Evening darkens the scene and lights some windows.

More states are in `docs/screenshots/after/`: `11-placement-ghost.png` (invalid ghost in coral with its reason), `12-remove-hover.png` (remove highlight), `13-low-quality.png` (low tier, flat brick without coursing), and `14-street-detail.png` (close view of the starter: black and blue tanks, roof decks, laundry lines, balconies, and a mural side wall).

## Known gaps

- **Performance targets are unmeasured on hardware.** On SwiftShader, the low tier costs about 1.3 times the prototype per frame. The high tier, after the arithmetic-hash change, costs about 1.8 times (`docs/benchmarks/ab/`). No GPU device was tested. A final-build low-tier run that includes the motorcycles and varied tanks measured 1209 to 1418 ms per frame, in line with the earlier low-tier runs.
- **No screen-space AO.** Baked vertex occlusion and terrain corner occlusion stand in for it. GTAO and SAO were not benchmarked.
- **No continuous environmental motion, by design.** The idle scene does not animate, so the renderer can idle.
- **Facades do not adapt to building neighbors.** Only streets react to their surroundings. Buildings keep windows on walls that touch a neighbor. Doors do not turn toward an adjacent street.
- **Terraces are grid-aligned.** Contours follow the noise, but cells are square, so terrace edges step diagonally.
- **Detail does not reveal after the mass.** Placement animates the whole building at once, in 280 ms.
- **The GLB asset kit was dropped.** The prototype's Kenney GLB models were removed in favor of the procedural grammar. The sources remain in `asset-sources/` for provenance.
- **Two measurements have no committed raw data.** These are the 1,029-geometry leak count before the fix and the 40-cycle memory test. The limiter study (`docs/benchmarks/limiter.json`, `tools/profile-layers.mjs`) and triangle counts (unit test output) are now reproducible.

## Regenerating everything

1. Build: `npm ci`, `npm run build:wasm`, then `npm run dev` for screenshots, or `npm run build` and `npm run preview -- --port 4173` for benchmarks.
2. Screenshots: `BARRIO_URL=http://127.0.0.1:5173 BARRIO_BROWSER_PATH=/path/to/chrome node tools/capture.mjs docs/screenshots/after`. Add a comma-separated shot list as the second argument to capture a subset. The script uses SwiftShader and `?quality=high` unless a shot specifies `low`.
3. Before images: check out commit 2e8e4b0 in a separate worktree. That commit is the prototype plus the capture hooks. Run its dev server and its `tools/capture.mjs` into `docs/screenshots/before`.
4. Comparison images: `sh tools/compare.sh` pairs `before/` and `after/` PNGs into the captioned `compare/*.jpg` files (ImageMagick).
5. Benchmark: `BARRIO_URL=http://127.0.0.1:4173 BARRIO_BENCHMARK_OUT=docs/benchmarks/ab/<name>.json node tools/benchmark.mjs`. For an A/B, patch the prototype's `World.frame()` with the same render-plus-`readPixels` probe, and interleave the runs.
