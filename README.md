# Barrio Builder

A relaxing tile-placement game about growing a Colombian hillside neighborhood one hexagon at a time. Each tile carries homes, paths, gardens, or a stream. Fit its six edges to the neighborhood, join paths with stairs across terraces, and watch an irregular little island grow.

The browser runs the complete game. Rust/WebAssembly owns the deterministic hex terrain, tile supply, placement rules, path networks, history, and save validation. Three.js renders the world. There is no account system or game server.

The game is being redesigned in phases; [the strategy redesign](docs/strategy-redesign.md) records the research, decisions, and progress. Phase 1, the hexagonal foundation, is complete. Resources, objectives, and a finite tile supply come in Phase 2.

## Run locally

Requirements are Node.js 22.12 or newer, npm, a stable Rust toolchain, and wasm-pack.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
npm ci
npm run build:wasm
npm run dev
```

Open <http://localhost:5173>. A WebGL-capable browser is required.

`npm run dev` serves the existing generated WASM files. After changing the Rust core, run `npm run build:wasm` again.

## Play

Barrio Classic is a seeded run. It starts with one settlement in a Colombian region (Medellín, Salento, Cartagena or Bogotá) and a deck of 30 tiles. The bottom tray shows the tile in hand, the next two, and the tiles left.

- **Placing:** outlined spots beside the neighborhood show where the tile in hand fits; dashed rims mark spots where it fits in no rotation. Point at a spot to see the tile in place and its points, then click to place it. On touch screens, tap to preview and tap again to place.
- **Scoring:** every tile scores 10, plus 20 for each edge that matches its neighbor. Filling a spot whose six edges all match adds 60.
- **Water:** streams must meet streams, and land may not touch water. A stream may end at an empty spot.
- **Paths:** matching path edges join walks, with stairs across one terrace. Two terraces is too steep, so the path stops at a railing. A home counts once a path reaches its door.
- **Skip:** once per run, the tile in hand can go to the back of the deck.
- **Quests:** three quests ask for homes on one walk, a large nature area, and a long stream. Each completed quest pays points and adds tiles to the deck, and the next, larger quest of its kind takes its place.
- **Victory:** milestones come at 1,000, 3,000, and 6,000 points. Reaching 6,000 is victory: keep building, or finish and see the results.
- **End:** the run ends when the deck is empty. Personal bests are kept on this device. There is no undo.
- **Keys:** `R` turns the tile, `Shift R` turns it back, `S` skips. With the canvas focused, the arrow keys move between open spots and `Enter` places. `Q` and `E` turn the view, `H` hides the interface, `?` opens help, and `Ctrl S` saves (`Command S` on macOS).
- **Camera:** drag to orbit, right-drag to pan, scroll to zoom. The house button frames the neighborhood.
- **Menu:** the sun button changes the lighting. The neighborhood menu loads, exports and imports runs, mutes sound, and starts a new game.

Add `?seed=<number>` to play a specific run without touching your autosave, and `&autoplay=<count>` to let the built-in greedy player place tiles. The rules are specified in [Classic gameplay](docs/classic-gameplay.md).

## Graphics quality

Two quality tiers exist. Software renderers (SwiftShader, llvmpipe) automatically use the low tier. The low tier uses pixel ratio 1, 1024 px PCF shadows, and no procedural brick, stone, or paving patterns. The high tier uses pixel ratio up to 2, 2048 px soft shadows, and the patterns. Add `?quality=low` or `?quality=high` to the URL to choose a tier explicitly.

## Build and verify

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run check
npm run build
node tools/verify-wasm.mjs
npx playwright install chromium
npm run test:e2e
```

The production build is written to `dist/`. Run `npm run preview` to inspect it locally.

## Benchmark and screenshots

Start a server, then run `node tools/benchmark.mjs`. It measures the one-tile opening and runs grown by 10, 20, and 30 placements: render cost per frame, draw calls, triangles, renderer memory, scene build time, placement latency, and renderer memory after ten regrown runs. Set `BARRIO_QUALITY` to `low` or `high` and `BARRIO_BENCHMARK_OUT` to choose the output file. `node tools/benchmark-core.mjs` times the release WASM rules on their own. `cargo run --release --bin simulate -- --seeds 1000 --out docs/benchmarks/classic-balance.json` plays 1,000 seeded runs with each of five computer players through the real rules and reports scores, quests, run length, and victory rates (see [Classic gameplay, Balance](docs/classic-gameplay.md#45-balance)). The scripts force SwiftShader software rendering, so their numbers do not establish desktop or mobile targets. [Performance notes](docs/performance.md) describe the method.

`tools/capture.mjs` renders the documentation screenshots in the real engine. They cover the four regional starts, hover and invalid previews, 10- and 30-tile neighborhoods, and the path evidence shots. Path shots search seeded runs for the situation they show: two joined homes tiles, a three-way crossing, hillside stairs, and two walks before and after joining.

```sh
BARRIO_URL=http://127.0.0.1:5173 BARRIO_BROWSER_PATH=/path/to/chrome node tools/capture.mjs <outdir> [shot,shot]
```

The optional second argument limits the run to named shots, for example `06-hover-preview,14-hillside-stairs`. Each shot writes a PNG and a JSON file of renderer metrics.

## Save files

Runs stay in browser-local storage. Export a JSON file to keep a portable copy or move a run between browsers. Browser storage can be cleared by the browser or operating system, so keep an exported copy of runs that matter.

Runs are saved as version 3 files: the seed, the rules version (`classic-2`), and the list of placements and skips. Loading replays every action through the rules, so a file restores the exact run or is refused without changing the current one.

Earlier saves (the square sandbox, version 1, and free hex building, version 2) cannot be played in Classic. Loading one explains why and changes nothing. If this browser still holds one, or an autosave this version could not read, the menu offers to download it.

## Project structure

- `crates/barrio-core/` contains the hex grid, tile edges and placement rules, the seeded hillside and tile supply, path networks, save validation, and native Rust tests.
- `web/src/` contains interaction, the WASM boundary, rendering, sound, persistence, and UI.
- `web/src/render/` builds the hex ground (`ground.ts`), lays out each tile's houses, paths, stairs, streams, and trees (`tiles.ts`), and generates every building procedurally from a shape grammar (`architecture.ts`), with one shared procedural material (`material.ts`) and palette (`palette.ts`).
- `asset-sources/` keeps the Kenney source models used by the prototype, with licenses and provenance. The runtime no longer loads GLB models, and the asset build pipeline was removed.
- `tools/` contains the WASM build, benchmarks, WASM verification, and the screenshot capture tool.
- `docs/` records architecture, research, decisions, and measured performance.

## Visual redesign

The world was redesigned around a Medellín hillside. Painted street facades sit over exposed brick, with concrete slab bands, cantilevered upper floors, water tanks, and cables. Stone retaining walls hold contour terraces. [Visual redesign report](docs/visual-redesign.md) summarizes the changes and known gaps. [Before and after comparisons](docs/screenshots/compare/) show each view next to the prototype. Research and its outcome are in the [visual reference analysis](docs/visual-reference-analysis.md) and the [visual research ledger](docs/visual-research-ledger.md).

## Design and sources

[BRAND.md](BRAND.md) defines the Barrio organization identity. [DESIGN.md](DESIGN.md) records this game's visual direction and tokens.

Read [architecture](docs/architecture.md), [implementation contracts](docs/implementation-contract.md), [open-source research](docs/open-source-research.md), and the [research ledger](docs/research-ledger.md) before extending the system. [Asset provenance](docs/asset-manifest.md) records the Kenney sources kept in `asset-sources/`.

The runtime includes the Three.js, Zod, Fraunces, and Nunito Sans notices under `licenses/`. Reference photographs and upstream research excerpts stay outside the web build.

Barrio Builder source code uses the [MIT license](LICENSE), matching the Rust crate's license declaration. Fonts and archived source models retain their own licenses.
