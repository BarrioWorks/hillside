# Barrio Builder

A relaxing browser sandbox for building a miniature Medellín-inspired hillside neighborhood. Place homes, shops, streets, stairs, and plants on contour terraces. Change the light, rotate the view, undo changes, and keep your neighborhood on your own device.

The browser runs the complete game. Rust/WebAssembly owns the deterministic terrain, placement rules, connectivity, history, and save validation. Three.js renders the world. There is no account system or game server.

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

Choose a building, connection, or prop from the bottom palette and click an open terrace. A translucent preview shows whether the placement is valid, and a short note explains why when it is not. Buildings need flat ground. Stairs face one step uphill, with a level landing behind them.

- Drag to orbit, right-drag to pan, and scroll to zoom. On touch screens, use two fingers to pan and pinch to zoom.
- `Q` and `E` rotate the view a quarter turn. The camera buttons on the right do the same.
- `R` rotates a placement. `X` selects the remove tool, which highlights the structure it would take away. `Esc` returns to exploring.
- `H` hides the interface for a clean view. `?` opens the help panel.
- `Ctrl Z` undoes, `Ctrl Shift Z` redoes, and `Ctrl S` saves. macOS uses `Command`.
- The sun button opens the lighting presets: warm afternoon, bright daylight, and soft evening.
- The neighborhood menu provides load, export, import, mute, and a new neighborhood.

Open `/?contact-sheet` to inspect the building collection under identical lighting.

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

Start `npm run preview -- --port 4173`, then run `node tools/benchmark.mjs` in another terminal. It imports a deterministic 500-structure scene and records five runs of render cost and throughput. Set `BARRIO_BENCHMARK_OUT` to choose the output file. The script forces SwiftShader software rendering, so its numbers do not establish desktop or mobile targets. [Performance notes](docs/performance.md) describe the method, the A/B results against the prototype, and the steps to measure on real devices.

`tools/capture.mjs` renders the documentation screenshots from fixed scenes and camera views:

```sh
BARRIO_URL=http://127.0.0.1:5173 BARRIO_BROWSER_PATH=/path/to/chrome node tools/capture.mjs <outdir> [shot,shot]
```

The optional second argument limits the run to named shots, for example `03-dense-hillside,09-evening`. Each shot writes a PNG and a JSON file of renderer metrics.

## Save files

Neighborhoods stay in browser-local storage. Export a JSON file to keep a portable copy or move a neighborhood between browsers. Import validates the file before changing the current neighborhood. Browser storage can be cleared by the browser or operating system, so keep an exported copy of important creations.

New neighborhoods use contour terrain (`hillside-v2`). Saves made with the original straight terraces (`hillside-v1`) still load with their original terrain.

## Project structure

- `crates/barrio-core/` contains deterministic rules, terrain generators, save validation, and native Rust tests.
- `web/src/` contains interaction, the WASM boundary, rendering, sound, persistence, and UI.
- `web/src/render/` generates every building procedurally from a shape grammar (`architecture.ts`), with one shared procedural material (`material.ts`) and palette (`palette.ts`).
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
