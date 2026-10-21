# Verification record

The final production build was served locally on port 4174. No backend or hosted deployment is involved.

## Completed checks

| Check | Result |
| --- | --- |
| Rust formatting | Passed `cargo fmt --all -- --check`. |
| Rust lint | Passed strict Clippy for all workspace targets. |
| Rust behavior | Passed 18 native tests. |
| Compiled WASM | Passed `node tools/verify-wasm.mjs` against the generated release bindings. |
| TypeScript | Passed strict type checking. |
| Frontend lint and formatting | Passed Biome across the configured source and tool files. |
| Frontend behavior | Passed 23 Vitest tests, including nine real Three.js batching tests. |
| Runtime assets | All five normalized GLBs passed geometry, texture, transform, bounds, budget, and provenance checks. |
| Production build | Passed `npm run build`. |
| Browser regression | Nine production Playwright tests passed in 54.6 seconds after instancing and the Save accessibility correction, including both screenshot comparisons. |
| Manual browser loop | House placement, adjacent path, removal, undo, redo, save, and load passed through live controls. |
| Responsive controls | No horizontal overflow or visible buttons below 44px at 390px width. |
| Contact sheet | Eleven objects rendered at both 128px and 512px under identical lighting. |

The browser tests use installed Chromium 134.0.6998.35 with SwiftShader. The matching new Playwright browser download returned HTTP 403 AccessDenied. `BARRIO_BROWSER_PATH` selects the installed executable without changing the default browser-install workflow for contributors.

The collaborative browser uses Chromium 154 with SwiftShader. Desktop layout was inspected at 1440 by 900 CSS pixels, exported by the preview tool as a downscaled 1280 by 800 PNG. Mobile layout was inspected at 390 by 844 CSS pixels, exported at device-pixel ratio 2. The separate regression goldens use their test viewport dimensions.

## Independent review

The first independent core review found allocator exhaustion through a crafted save. The correction reserves IDs across the current world, undo, and redo, then finds an available range after wraparound. Fresh independent re-review passed 72 compiled-WASM boundary and recovery combinations. The final source has 18 Rust tests.

The final independent review is recorded in `final-review.md`. Its ship verdict covers the two returned findings. The reset-cancellation claim was dismissed after browser reproductions preserved edits and autosave. The mobile Save name was corrected and its regression passed. This is not a full accessibility certification. The mechanical design detector found only Fraunces usage, which is explicitly required by the supplied brand guide. The chosen font remains in place.

## Evidence

- `source-sha256.txt` records the checked source and model-manifest fingerprint.
- `e2e-result.json` preserves the browser runner's final passed status.
- `../screenshots/desktop.png` and `../screenshots/mobile.png` show the final game.
- `../screenshots/contact-sheet-full.png` shows the full catalog.
- `../../web/tests/game.spec.ts-snapshots/` holds the passing desktop and mobile comparison baselines.
- `../benchmarks/` holds measured performance data and host load conditions.

## Limits

Software-rendered automation does not prove the physical desktop 60 FPS or mobile 30 FPS targets. The initial contended run is preserved as a diagnostic. The isolated production run is reported in `../performance.md`. Long-duration hardware memory profiling and physical touch-device validation remain outside the evidence collected here.

The build emits upstream Zod annotation warnings and Vite's large-chunk advisory. These do not fail the production build. The JavaScript bundle is approximately 195 KB compressed, alongside the approximately 64 KB compressed Rust core and local assets/fonts.
