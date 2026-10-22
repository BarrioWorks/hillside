## Findings

### 1. [critical] Stair adapters cut through served entrance routes

**Location**: `web/src/render/pedestrian.ts:352`, `web/src/render/pedestrian.ts:358`, and `web/src/render/pedestrian.ts:912`.

**Finding**: Boundary approaches reserve space against buildings and other groups, but the intrinsic router may put routes from the same group inside the future stair flight. `valid()` skips same-group reservations and edges. When an uphill match arrives, `withBoundaries()` changes that approach into stairs. `pavement()` then subtracts the entire flight footprint, including coping width, from every level sheet. The treads replace only the stair width and have a different elevation. Existing entrance branches therefore lose pavement or meet the side of a raised tread, although their edges still declare level traversal and their homes remain marked connected.

**Evidence / reproduction**:

1. Load the existing `realCore`, `siteOf`, and `sidesOf` helpers from `web/tests/core-fixture.ts`.
2. Obtain `realCore(3).command({ type: 'autoplay', count: 39 }).snapshot` and select tile `(4, -4)`. This is an actual Cartagena `casas` tile, variation 9. Side 1 matches a neighbor one level higher.
3. Call `TileKit.plan()` and `TileKit.compose()` with that tile and its actual `sidesOf()` result. Extract upward `Surface.paving` triangles through the part matrices, as the capture harness does.
4. The plan has no failures and marks all four homes connected. The side-2 door uses level edges `edge:5` and `edge:6`. The existing `pavementCoverage()` reports a missing centerline sample on `edge:5`, at `t=0.75`, point `(-0.3196035461, 0.9526522319)`. At `edge:6`, `t=0.001`, point `(-0.2596326338, 0.9840778293)`, the only covering paving is the first stair tread at `y=0.1650000066`. That edge requires level pavement at `y=0.045`. Its landing node still has height zero.

The expansion requirement also fails directly on frozen fixture `B-five-houses`. Keep its intrinsic site unchanged and set side 0 to `{ meet: 'match', rise: 1 }`, with other sides open. `pavementCoverage()` finds missing width samples on entrance edges 11 and 12. A bounded probe of the 43 path ports in the frozen scenes found nine uphill adapter configurations with coverage gaps. A separate probe of actual stair-bearing tiles from seeds 1, 2, and 3 after 39 autoplay placements found five affected tiles among 21 inspected. No full suite was rerun.

**Suggestion**: Reserve stair-capable approaches against intrinsic routes of every group, including their threshold segments, before accepting house placements or routes. Permit attachment through the declared lower landing only. Treat existing stair thresholds as physical height transitions during later routing as well. Keep interior routes outside those footprints so adding an adapter cannot cut them. Add the real seed-3 case and the five-house expansion case as rendered-geometry regressions.

### 2. [warning] The independent gate accepts pavement at the wrong route height

**Location**: `tools/pedestrian-geometry.mjs:39` and `tools/pedestrian-geometry.mjs:63`.

**Finding**: `pavementCoverage()` tests only horizontal containment, so a stair tread can satisfy coverage for a level edge below it. `terrainContactGaps()` validates each existing triangle against any stair footprint covering its centroid. It does not establish that each graph edge has a surface at its own declared height. The two checks therefore do not jointly prove physical graph realization.

**Evidence / reproduction**: A direct probe supplied two coincident edges from `(0, 0)` to `(1, 0)`, both width `0.2`. One declares level height zero. The other declares three stairs from height zero to `0.6`. Supply only the six upward tread triangles, with x intervals `[0, 1/3]`, `[1/3, 2/3]`, and `[2/3, 1]`, z bounds `[-0.1, 0.1]`, and heights `0.245`, `0.445`, and `0.645`. Both functions return `[]`, although the entire required level surface is absent.

The actual seed-3 case above also demonstrates the blind spot. The elevated surface over level `edge:6` satisfies horizontal coverage, and `terrainContactGaps()` returns no errors for the whole tile. The current gate catches that tile only because another edge independently has an uncovered sample. Correcting that separate hole would leave the wrong-height route undetected.

**Suggestion**: Associate coverage with the edge's traversal and expected surface height. Validate level-width polygons against level paving at the declared elevation, and validate each stair tread against its own interval and height. Add an instrument test where correct treads cover a missing level path and require rejection. Prefer polygon coverage differences when proving continuous full-width coverage, since a few point samples can also miss narrow cuts.

## Review scope and verification

Read the requested poteto-mode guidance, all three interrogate references, the pedestrian architecture/workflow/open-issues documents, the scoped diff, implementation, integrations, tests, and capture/validation tools. Checked graph purpose, grouping, pruning, deterministic planning, door transforms, stair ownership, clipping, triangulation, and cache boundaries. No separate actionable code-quality finding survived the concrete-benefit bar.

The targeted probes used Vite SSR to execute the existing modules and Rust WASM core. The decisive seed-3 reproduction inspected `TileKit.compose()` output, including part transforms. No repository files were edited and no agents were delegated. At the final hash check, 16 of the 18 files matched `/tmp/barrio-pedestrian-review-files.json`. Another worker had changed `pedestrian.ts` and `pedestrian-network.test.ts` during review. I inspected those deltas. They add exact hex-boundary resnapping and its regression test, and do not alter either finding. Current hashes are `284c3fc24eacbf191baf791e83c0123ce564a932df1f07150c35b9172078583e` and `8c68aa01153ddcc5bdca60490361c7c15921e7eafa62bc297ac5de71e0e9b0dc`, respectively.

The preexisting atmosphere failure and unrelated environment diffs are excluded from these findings. Frozen A through E passing their preliminary gate does not cover the reproduced expansion and actual-settlement cases.
