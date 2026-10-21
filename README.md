# Barrio Builder

A relaxing browser sandbox for building a miniature Medellín-inspired hillside neighborhood. Place homes, shops, paths, stairs, and plants. Rotate the view, undo changes, and keep your neighborhood on your own device.

The browser runs the complete game. Rust/WebAssembly owns the deterministic terrain, placement rules, connectivity, history, and save validation. Three.js renders the world. There is no account system or game server.

## Run locally

Requirements are Node.js 22.12 or newer, npm, a stable Rust toolchain, and wasm-pack.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
npm ci
npm run build:wasm
npm run assets:build
npm run dev
```

Open <http://localhost:5173>. A WebGL-capable browser is required.

`npm run dev` serves the existing generated WASM files. After changing the Rust core, run `npm run build:wasm` again.

## Play

Choose a building, connection, or prop from the bottom palette and click an open terrace. A transparent preview explains whether the placement is valid. Buildings need flat ground. Stairs face one step uphill, with a level landing behind them.

- Drag to orbit, right-drag to pan, and scroll to zoom.
- On touch screens, use two fingers to pan and pinch to zoom.
- Press `R` to rotate a placement, `X` to remove, and `Esc` to explore without building.
- Press `Ctrl Z` to undo, `Ctrl Shift Z` to redo, and `Ctrl S` to save. macOS uses `Command`.
- The neighborhood menu provides load, export, import, and a new neighborhood.

Open `/?contact-sheet` to inspect the collection under identical lighting at 128px and 512px. Software renderers automatically use reduced graphics settings. `?quality=low` or `?quality=high` selects the quality explicitly.

## Build and verify

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run check
npm run assets:build
npm run assets:validate
npm run build
node tools/verify-wasm.mjs
npx playwright install chromium
npm run test:e2e
```

The production build is written to `dist/`. Run `npm run preview` to inspect it locally.

To measure the production benchmark, start `npm run preview -- --port 4173`, then run `node tools/benchmark.mjs` in another terminal. It creates a deterministic scene with over 500 structures and records five runs in `docs/benchmarks/software-renderer.json`. The script explicitly uses software rendering so its environment remains clear. It does not establish hardware device targets.

## Save files

Neighborhoods stay in browser-local storage. Export a JSON file to keep a portable copy or move a neighborhood between browsers. Import validates the file before changing the current neighborhood. Browser storage can be cleared by the browser or operating system, so keep an exported copy of important creations.

## Project structure

- `crates/barrio-core/` contains deterministic rules, terrain, save validation, and native Rust tests.
- `web/src/` contains interaction, the WASM boundary, rendering, sound, persistence, and UI.
- `web/public/models/` contains selected runtime models.
- `asset-sources/` contains selected original source models, licenses, and provenance.
- `tools/asset-pipeline/` builds and validates selected assets.
- `tools/verify-wasm.mjs` verifies the real compiled Rust core through its JavaScript bindings.
- `docs/` records architecture, research, provenance, decisions, and measured performance.

## Design and sources

[BRAND.md](BRAND.md) defines the Barrio organization identity. [DESIGN.md](DESIGN.md) records this game's visual direction. The game-specific architecture palette comes from the supplied development brief.

Read [architecture](docs/architecture.md), [implementation contracts](docs/implementation-contract.md), [open-source research](docs/open-source-research.md), [research ledger](docs/research-ledger.md), and [asset provenance](docs/asset-manifest.md) before extending the system. Imported asset licenses are separate from the game's own source code.

The runtime includes Kenney's CC0 notice under `models/License.txt` and the Three.js, Zod, Fraunces, and Nunito Sans notices under `licenses/`. Reference photographs and upstream research excerpts stay outside the web build.

Barrio Builder source code uses the [MIT license](LICENSE), matching the Rust crate's license declaration. Third-party models and fonts retain their own licenses.

[Performance notes](docs/performance.md) distinguish measured results from the desktop and mobile targets. A software-rendered test browser cannot establish physical-device performance.
