# Pedestrian replacement results

The replacement separates the Rust gameplay network from a deterministic physical graph, typed door anchors, walkable regions, routing, and pavement. The diagnosis was a missing spatial model: per-tile curves ignored water, neighbor-dependent endpoints moved buildings, and independent ribbons overlapped at junctions.

The integrated planner reserves stable boundary approaches before placing buildings, routes shared branches around full-width obstacles, connects aligned door thresholds, and derives narrow classified pavement from polygon union. Terrain is the existing flat terrace model, with explicit lower-owned stair adapters at elevation changes. Debug uses the same cached graph. No Rust gameplay rule or unrelated environment art was changed.

## Rendered evidence

All five frozen scenes pass the actual World-renderer acceptance gate. Each has gameplay, close-up, graph, and connectivity/mesh reports under `docs/screenshots/pedestrian/final/`. `comparison.html` compares the captured baseline and final images. Supplemental B-uphill images show the reviewed expansion case. The visible result uses angular shared routes, narrower door branches, clean joins, and stairs instead of rounded curve patches.

A serves 2/2 doors, B 5/5, C 6/6, D 6/6, and E 34/37. The remaining three E homes have null Rust entrance assignments on pathless tiles. Their door anchors and failure diagnostics remain visible, with no fabricated route. This does not satisfy a literal all-generated-buildings connectivity requirement for those three homes; it preserves existing game connectivity semantics.

The independent composed-mesh gate passes 43 future uphill ports and 20 actual stair-bearing tiles. Required strips remain covered at their declared level or tread height. Measured building and water intrusion are zero. Maximum scene projected pairwise pavement overlap is about 2.74e-8 world-square units, below the 1e-6 numerical acceptance threshold. Shared seam positions agree within floating-point precision.

## Verification limits

Build, typecheck, lint, 51 focused pedestrian tests, and 12 verification-instrument tests pass. The final full sequential run reports 250 passing tests, the baseline atmosphere assertion failure, and one Vitest `onTaskUpdate` RPC timeout. The full suite is not clean. See `final-checks.json` and the linked logs.

Both available independent reviewers found no remaining production stair defect and reproduced a path-only report omission false pass. The checker now derives crossing and boundary requirements from the frozen fixture, requires matched adapters, rejects missing peers, and rejects both reproduced graph/mesh omissions in a full-verifier fault-injection test. Independent targeted review confirms the correction with 16 probes: three valid cases pass and thirteen mutations fail as expected. Both configured Claude seats remained unavailable after one fresh retry each, so the full cross-family review is blocked.

The user-referenced screenshot was absent. Visual comparison used the captured pre-change fixtures and `docs/screenshots/classic/12-paths-joined.png`. No claim is made for comparison against an unseen image. Source hashes are recorded in `source-hashes.json`; production source matches the independently reviewed and captured revision.
