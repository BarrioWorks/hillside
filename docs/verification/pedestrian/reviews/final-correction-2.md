# Final pedestrian correction review

One warning remains in the verification tools. I found no remaining production geometry defect in the stair correction within the reviewed cases. This is not a shipping verdict. Final screenshots and the unavailable Claude review seats remain outside this review's acceptance.

## [warning] Empty graph and mesh evidence still passes for required path-only tiles

Locations are `tools/pedestrian-inventory.mjs:58-65`, `tools/pedestrian-verify.mjs:179-184`, and `tools/pedestrian-verify.mjs:214-216`.

The inventory correction requires each tile record and home record, but only checks that graph arrays exist. It does not derive required crossing nodes or boundary records from the fixture's path sides and groups. Seam validation iterates reported boundaries and silently skips a missing peer. Logical connectivity also iterates reported active nodes. A required tile can therefore retain its coordinate record while losing its entire physical graph and all pavement without failing acceptance.

I reproduced this against reports generated from the current production `TileKit.plan` and `TileKit.compose`, with the same home fields and geometry instruments as capture. I executed the actual `tools/pedestrian-verify.mjs` body with in-memory reads and writes. No repository report was changed. The unmodified reports passed first.

Then I changed only the E-settlement record for tile `(2, 0)`. That sendero has path sides 1 and 4 in local group 1. Side 4 matches an occupied neighbor. I preserved its coordinate and empty home inventory, replaced its pedestrian graph with the following object, and set every geometry scalar to zero with empty gap arrays.

```js
{
  nodes: [], edges: [], walkable: [], blocked: [],
  boundaries: [], failures: [], adjacency: {}
}
```

The actual verifier still returned overall `passed: true`. E reported 20 tiles, 34 reached doors, 37 doors, and no errors. Repeating the same mutation for `(0, -2)` also passed. That sendero has two distinct path groups, each with a matched boundary, so the hole also affects required adapters on independent components.

The probe results are in `/tmp/barrio-pedestrian-final-review-2-inventory-probe.json`. Its first result is the passing control. Its next two results contain the passing mutations. Earlier probes using historical final reports failed because those reports predate the required public-role field. I discarded those as evidence and regenerated reports from current source before the decisive probe.

Require fixture-derived interior crossings and boundary records for every positive path side. Require their groups to match the fixture. Derive required matched adapters from the fixture, and reject a missing matched peer instead of continuing. Add a regression that keeps all tile records but empties a required path-only tile's graph and mesh. Do not require nonzero paving indiscriminately, because a single unused open port intentionally has no paving.

This is a verification false pass. I did not observe the current renderer producing the empty graph in these cases.

## Stair correction assessment

The prior production defect appears corrected. `pedestrian.ts:411-415` checks every flight regardless of group. `route` validates the explicit lower approach before inserting it at `pedestrian.ts:476-488`. Raised entrance flights join the same reservation list. Building siting reserves the inset boundary approach. The intrinsic cache excludes neighbor state, and boundary adaptation leaves intrinsic graph nodes, routes, and houses intact.

The height-aware coverage instrument requires the declared level height or each individual tread height. Its continuous strip-area check closes the prior sparse-sampling gap. Analytical stair-cut and hex-plane restoration occurs before triangulation. Coping subtraction uses the restored coordinates. I found no graph-height mutation or route-width clipping used to conceal the old failure.

I read the supplied expansion artifact. It records all 43 frozen uphill ports and all 20 actual lower-owned stair tiles passing, including the original seed-3 tile `(4, -4)`.

I independently ran 35 additional production composition cases. Sixteen frozen tiles received all their path adapters uphill simultaneously. Nineteen cases covered actual lower-owned stair tiles and start tiles from seeds 4 through 8 after 39 placements. Every case passed height-aware continuous coverage, terrain contact, building clearance, water and bank intrusion, hex bounds, and projected overlap checks. The largest projected pairwise overlap was approximately `2.73417e-8`, below the existing `1e-6` gate. Results are in `/tmp/barrio-pedestrian-final-review-2-probe.json`. These checks did not rerun the full unit suite or browser capture.

The owner's final affected-suite log at `/tmp/barrio-pedestrian-stair-fix-tests.log` records 51 passing tests across tiles, pedestrian network, pedestrian access, debug, and water. I read that log rather than rerunning it. The broader historical sequential log records the known atmosphere failure without the earlier worker RPC timeout.

## Audit and integrity

I inspected `.audit/pedestrian.tsv` against the cited artifacts and the provided history. The baseline overlap claim matches the actual B report's `0.6530061521686427`. Iteration 1 records all required doors served and three null-assigned homes unserved. The boundary log supports its 32-test claim. The later sequential unit log supports 241 passing tests and the known atmosphere failure. The trail records unavailable reviewers and does not claim shipping approval. I found no separate unsupported audit claim. The last row's completeness claim should remain scoped to tile and home inventory until the warning above is fixed.

The chapel public-door exception matches the clarified contract. I did not repeat the dismissed rule-assignment finding. Ordinary homes still use their exact entrance group, and null ordinary homes retain an isolated group-0 door with a diagnostic. No Rust source diff was present.

All 21 source, test, package, and tool files matched `/tmp/barrio-pedestrian-final-review-files.json` at both the start and end of this review. The detailed check is in `/tmp/barrio-pedestrian-final-review-2-end-hashes.json`. Historical final screenshots and reports were not treated as evidence for the corrected source.

I read poteto-mode, the three requested interrogate references, TypeScript best practices, Type System Discipline, unslop, and technical-writing. Type System Discipline directed the check of graph variants and ordinary versus public door roles. No additional type or structural blocker survived the concrete-reproduction bar. No source files were edited and no agents were delegated.
