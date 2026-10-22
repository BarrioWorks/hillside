# Planned pedestrian network

## Problem

The rule graph already exists in Rust. The missing model is a physical pedestrian graph that connects real entrance anchors through dry walkable space. Quadratic road curves and overlapping pavement ribbons currently hide that missing model.

## Caller contract

`TileKit.plan(site, sides)` returns one layout for buildings, the pedestrian graph, walkable and blocked regions, and routing failures. `TileKit.compose` derives pavement from that plan. Debug and validation consume the same graph. Existing environment placement consumes the final route clearance.

## Shape

The plan contains nodes with positions and explicit roles, edges with `primary`, `secondary`, or `entrance` categories, actual door headings and heights, and boundary connectors. Every edge records its purpose. Stair traversal is distinct from level pavement. The graph is authoritative for spatial connectivity. The Rust graph remains authoritative for gameplay membership.

Interior planning depends on the tile specification, seed, region, model metadata, and elevation. It reserves every boundary approach before placing buildings. Occupied neighbors can change only boundary adapters within those reservations. A matching crossing has one shared midpoint and width. The lower tile owns a one-level stair flight.

Use deterministic, width-aware routing with distance, incoming turn, obstacle clearance, terrain, stair, and reuse costs. Connect terminals to a growing group tree. Split at the first network contact. Shared nonprimary segments are secondary paths. Unique short door tails are entrance paths. Every remaining leaf is a door, crossing, or explicit public destination.

Generate each level pavement sheet by polygon union and triangulate it once. Use the existing palette. Stair treads replace their level footprints. Pedestrian smoothing is removed. Water can retain its existing curves.

## Synthesis decision

The base is candidate 1, narrowed to preserve the existing bounded house candidate search in its current owner. Candidate 2 strengthens the shared-edge classification contract and the distinction between dry terrace routing and discrete stairs. Candidate 3 retains quadratic primary curves and neighbor-dependent interior endpoints, so it does not resolve the reproduced defects. Candidate 4 derives geometry classes from changing network rank and lacks meaningful obstacle-aware route search. Those choices are rejected.

A global navigation mesh was considered. Its recomputation and route-freezing state are unnecessary for the existing flat terrace tiles. Fixed boundary reservations give the local graph a smaller interface and a reconstructible stability guarantee.

## Tradeoffs

Local trees preserve established routes and remain deterministic. They do not promise the globally shortest settlement network. Terrain inside each tile is flat in the existing renderer. Grade and retaining costs therefore apply at explicit terrace transitions. This work does not add a fictional heightfield.

## Implementation reconciliation

The independent Opus cross-judge preferred candidate 3 with fixed-port and swept-clearance grafts from candidates 1 and 2. The lead accepted those grafts but rejected its recommendation to retain quadratic primary curves, because the user explicitly requires replacing that approach. Polygon union remains the selected geometry strategy because clean shared boundaries need a directly testable single surface. Reuse the existing five captured scenes. Implementation is integrated. Public category names must match the task. Any retained compatibility query must derive from the graph, with no second path generator.

The service group on a placed building is physical metadata. Ordinary homes must match their exact Rust `entrances[side]` assignment, including null. The chapel landmark is explicitly public. Its door and forecourt attach to an existing local path group without changing Rust home statistics or the snapshot's entrance array. Validation derives that exception from the tile kind and landmark side rather than trusting a reported `public` flag.

The review correction completes the original reservation contract. Future boundary flights and existing raised door thresholds exclude intrinsic routes of every group. Stable inset docking points provide normal approaches to the lower landings. The planner checks full flat-ended path strips against obstacles when a capsule-distance test would be overly conservative. Buildings reserve those approaches before placement. No neighbor state moves the interior plan.

After fixed-grid polygon operations, analytical hex crossing profiles and stair-cut boundaries are restored before triangulation. Coping is subtracted after that restoration so it shares the corrected paving boundary. Root's independent gate now passes all 43 frozen uphill expansions and 20 actual lower-owned stair tiles with continuous route coverage at each declared height. No public graph contract changed. Both available independent reviewers found no remaining production defect in their correction probes. Final A–E image capture and spatial validation pass. Their shared acceptance-inventory warning is corrected and independently confirmed with sixteen verifier probes.
