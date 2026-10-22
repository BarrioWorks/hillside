# Independent final correction review

One warning remains in the acceptance tooling. No remaining critical implementation defect was reproduced. The previous same-group stair conflict is corrected in the cases inspected, including the original seed-3 tile. This is a source and geometry review, not final screenshot or shipping acceptance.

## Finding 1. [warning] Empty physical evidence for a path-only tile still passes the acceptance gate

Locations are `tools/pedestrian-inventory.mjs:62-65`, `tools/pedestrian-verify.mjs:155-160`, `tools/pedestrian-verify.mjs:179-184`, and `tools/pedestrian-verify.mjs:214-216`.

The new inventory check requires tile records and home records, but accepts empty graph arrays and zero-valued geometry for an expected tile. Subsequent crossing connectivity checks derive their inventory from the reported nodes. Seam validation silently skips a missing peer boundary. Consequently, a path-only tile can lose its whole physical network without failing the gate. A legitimate single open, unused path reservation can remain unpaved, but that exception does not cover the reproduced tiles.

I ran the actual current verifier with injected in-memory file I/O. First I generated fresh A–E reports from current `TileKit.plan()` and `TileKit.compose()` through Vite SSR. Extraction and measurements used the current `pavingTriangles`, `inspectTriangles`, `intersectionArea`, `pavementCoverage`, and `terrainContactGaps`, with the same report shape as `pedestrian-capture.mjs`. The unmodified reports passed every scene. I then independently replaced only one E tile's graph and geometry as follows, retaining all 20 tile records and all home records.

```js
const r = reports.find(r => r.q === 2 && r.r === 0);
r.pedestrian = {
  nodes: [], edges: [], walkable: [], blocked: [],
  boundaries: [], failures: [], adjacency: {},
};
for (const field of Object.keys(r.geometry)) {
  r.geometry[field] = Array.isArray(r.geometry[field]) ? [] : 0;
}
```

Observed output from the actual verifier was `passed: true`, with `errors: []` for every scene. Repeating from unmodified reports for tile `(0,-2)` produced the same false pass.

The independent frozen fixture identifies `(2,0)` as `sendero`, paths `[0,1,0,0,1,0]`, with side 4 matched. Its two group-1 crossings require a local connection. Tile `(0,-2)` is `sendero`, paths `[1,0,0,2,0,0]`, with sides 0 and 3 both matched. Its matched adapters are required even though its two groups remain separate. Both tiles have no homes, so doorway inventory cannot detect their missing paths.

To reproduce without modifying artifacts, strip only the verifier's import declarations, evaluate its body with the real `assert`, `inventoryErrors`, and `sceneNames`, intercept reads of `E-settlement-report.json` to apply the mutation above, and intercept `writeFile` to inspect the resulting validation object. Use fresh reports or newly regenerated final captures. The older final captures lacked the new public-role metadata during this review and are not a valid baseline for this mutation experiment. My execution generated fresh reports in memory before running both control and mutated cases.

Require the exact fixture-derived crossing and boundary inventory, including side and group, before inspecting graph connectivity. Require matched adapters and the necessary local crossing connections; reject missing matched peers rather than skipping them. Preserve the intentional unpaved single-open-port case. Add a full-verifier regression with an existing path-only tile record whose graph and geometry are emptied. Merely asserting that graph fields are arrays does not close this gap.

This is a verification false pass, not evidence that the current planner actually drops these two tiles.

## Correction verification

- Read the requested poteto-mode skill and all three interrogate references. Applied the TypeScript guidance and its Type System Discipline principle by tracing the level/stairs traversal variants through routing, mesh realization, and height validation. No edits or delegation were performed, apart from this requested report.
- Read current planner, tile integration, door metadata, world reconciliation and ground openings, behavioral tests, capture, geometry, inventory, expansion, and acceptance tooling. No separate actionable code-quality blocker survived the concrete-benefit bar.
- Directly reran the original real seed-3 `(4,-4)` reproduction after 39 autoplay placements. Current composed output has four connected homes, no graph failures, no width/height coverage gaps, no terrain-height errors, 42 top paving triangles, zero projected overlap, zero footprint intrusion, and zero outside vertices.
- Independently probed 25 frozen tiles with every path port uphill simultaneously. All passed current continuous height-aware coverage, terrain contact, overlap, obstacle, and hex-footprint checks.
- Independently probed 20 selected tiles from real seeds 4–8 after 39 placements. Selection included all lower-owned stair-bearing tiles plus start and chapel tiles. All passed the same checks. These 45 cases supplement the supplied 43 frozen single-port expansions and 20 real seed-1/2/3 cases.
- Generated fresh composed A–E reports in memory and ran the actual acceptance verifier. The unmodified control passed. The new warning above concerns the two subsequent omission mutations.
- Flight reservations now apply to every group. Normal inset approaches keep intrinsic strips outside stair cuts. Raised door flights reject earlier intersecting edges and reserve their footprint against later routes. No neighbor-dependent intrinsic reroute or graph-height mutation was found.
- The height-aware checker rejects the previous elevated-tread substitution. Continuous strip-area coverage is paired with independent overlap checks, and the unit regression uses polygon difference. The chapel exception follows the clarified public-destination contract; no violation is asserted for its null Rust home assignment.
- All 21 paths in `/tmp/barrio-pedestrian-final-review-files.json` matched their recorded SHA-256 hashes both at initial probe and final check. The current source, not the older dirty-baseline diff, was reviewed.

## Audit trail and limits

No additional unsupported substantive claim was established in `.audit/pedestrian.tsv`. The placeholder timestamp is explicitly corrected by a later row. The recorded B overlap of 0.6530 agrees with the baseline report's 0.6530061521686427. The iteration-1 artifact says it passed; that historical statement does not prove the corrected implementation. The cited boundary-check log exists. The five named unrelated tracked diffs still match the initial patch, including the screenshot's recorded blob IDs. The 43/20 expansion artifact reports success and matches the correction response. The final row's instrument count is consistent with seven geometry tests and three inventory tests; I did not rerun those already-reported passing tests.

The trail's claim that reports contain the whole fixture should not be extended to complete physical-network evidence until finding 1 is fixed. Tile/home inventory is now enforced, but required crossing inventory is not.

No full-suite rerun, browser recapture, or visual acceptance was performed. Final captures were explicitly pending in the supplied brief. The known atmosphere failure, unavailable Claude seats, and earlier parallel timeout were not reclassified as new defects. No shipping verdict is claimed.
