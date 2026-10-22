# Independent pedestrian review

The intent is a stable physical route graph and purposeful pavement that serve actual doorways, remain clear of obstacles, and extend across terraced tile boundaries.

## Reviewers

GPT-6-Astra and GPT-6.1-Sol completed independent read-only reviews with production geometry probes. Opus 5.5 and Fable 5.1 failed on API rate limits. One fresh retry per Claude seat failed identically. Those seats and the cross-family trail review remain blocked. No merge or shipping verdict is claimed.

## Accepted findings

1. Both available reviewers reproduced same-group routes entering future stair reservations. Adding an uphill neighbor removes level pavement beneath still-level graph edges. Frozen fixture B and actual seed 3 tile `(4,-4)` reproduce the defect. The reservation contract must protect flights against all intrinsic routes and thresholds. Correction is complete. Both available reviewers reran the original reproduction and supplementary production geometry probes without finding a remaining production defect.
2. The coverage checker accepted treads at a higher elevation as coverage for a missing level route. It now requires the declared edge height and checks continuous per-edge or per-tread strip coverage. An instrument regression reproduced the false pass before the correction and now passes.
3. The scene checker accepted an empty report for the entire twenty-tile fixture. It now requires exact unique tile coordinates, every expected home or landmark doorway, and complete graph and mesh check fields. Inventory regressions reject missing tiles, duplicate tiles, missing homes, and absent geometry.

## Dismissed finding

The chapel's public doorway connection is intentional. The initial implementation brief explicitly requires the chapel front door to reach its forecourt without adding a Rust home-scoring assignment. A chapel is a public destination rather than an ordinary rule-owned home. The fixture's `entrances` array is unchanged. Validation now derives each doorway role from the fixture, permits only the explicit chapel landmark exception, and rejects fabricated service for ordinary homes with null assignments.

## Comment review

GPT-6.1-Sol reviewed newly added comments. Six redundant comments were removed. No comments were restored. The proposed private `insert` extraction was declined because it would add a one-caller layer without changing the route-attachment contract. No constraint comments, suppressions, or unenforced encoding requests remain.

## Final correction review

Both available reviewers independently reproduced a remaining acceptance false pass when graph and mesh evidence were erased from path-only tiles `(2,0)` or `(0,-2)`. The checker now derives crossing and boundary inventory from the fixture, requires matched and served adapters and multiport interior routes, and rejects missing matched peers. Full-verifier regressions reject both original omissions while accepting the control. A final targeted independent review ran sixteen probes: three valid cases passed, and thirteen mutations failed for the intended reason. It found no remaining warning or false rejection. The reports are retained under `reviews/`.

## Current verdict

No unresolved production or acceptance-tool defect remains from the available independent reviews. The final five rendered scenes, 43 frozen uphill expansions and 20 actual stair tiles pass. All required screenshot views and reports are saved. The full sequential suite remains non-green: 250 tests pass, the preexisting atmosphere assertion fails, and an `onTaskUpdate` RPC timeout recurs. Three null-rule homes remain explicitly unserved. Both configured Claude seats and the cross-family trail review remain blocked by API rate limits. This is not a full-panel or shipping approval.
