# Pedestrian replacement verification

The current renderer has tile-local quadratic Bézier roads, independent entrance ribbons, and overlapping junction discs. The Rust network is a gameplay connectivity graph. It is not a physical route graph. Physical entrance positions exist on generated models, but lack typed heading and height metadata.

## Completion predicate

All five fixed scenes render through the actual World renderer with no page errors. Every routable building entrance reaches its declared pedestrian component. Every paved edge has a crossing, building, or public-space purpose. Width-aware route validation rejects water, footprint, and world-boundary crossings. Primary interior anchors and building transforms remain unchanged when neighbors arrive. Rendered junctions contain no overlapping coplanar pavement faces. Stair connections agree with terrain retaining openings. Gameplay and close-up images visibly use restrained angular paths.

The user's referenced screenshot was not attached to this conversation. The existing `docs/screenshots/classic/12-paths-joined.png` and fifteen new baseline images are the available visual evidence.

## Work units

1. Capture fixed A through E scenes, including the existing twenty-tile seed 909352 settlement, before changing the planner.
2. Compare independent architecture candidates against route validity, stable expansion, geometry ownership, implementation size, and reproducible visual verification.
3. Replace the tile planner with explicit spatial data, graph routing, and purpose-bearing path categories. Preserve existing environment edits and Rust gameplay semantics.
4. Build pavement from the graph and add graph, obstacle, crossing, entrance, and failure debug layers.
5. Run behavioral checks against real tile templates, fixed rendered scenes, and expansion changes. Inspect gameplay and close-up images against the baseline.
6. Independently review the implementation and audit trail. Fix concrete findings, rerun affected checks, and report remaining limits.

## Throughput checkpoint

The main unknowns are obstacle clearance at the small tile scale, stability of stair reservations, and pavement intersection ownership. Establish those contracts before splitting implementation. Use one planner owner and one capture/verification owner. Keep the existing dirty checkout intact. The gate is visual and spatial correctness, not the number of tests or generated screenshots.

## Geometry instrument

`tools/pedestrian-geometry.mjs` intersects the actual composed `Surface.paving` triangles in the horizontal plane. `overlapArea` is the sum of pairwise intersections, not the union area of multiply covered regions. It detects duplicate sheets even when tiny vertical offsets conceal z-fighting. Zero is the acceptance target. `blockedArea` intersects paving triangles with ground-floor building footprints. Fixtures test the instrument with coincident triangles and adjacent triangles. Stair risers are excluded from horizontal pavement checks.

The final mesh check also samples the center and both width boundaries of every graph edge. It compares upward-facing pavement triangles with flat terrace height or the declared stair treads. The graph check validates adjacency, facade alignment, useful leaf roles, local acyclicity, matching seam positions and heights, and agreement with Rust network components. Null-rule homes are listed separately. They cannot be declared served by a physical graph edge without changing game connectivity rules.

## Reproduce

Run `npm run dev -- --port 5174`, then `BARRIO_BROWSER_PATH=/path/to/chromium npm run paths:verify`. The browser path is optional when Playwright's browser is installed. `BARRIO_URL` overrides the dev URL. `npm run paths:gallery` creates the visual comparison after verification. The historical baseline is protected against overwrite.

A through D are explicit renderer fixtures. E freezes twenty tiles from the real core's seed 909352 replay. All five use the saved Medellín region, complete tile specifications, and cameras in `scenes.json`; a seed alone is not a complete fixture. Capture drives the actual `World` renderer and its normal composition, lighting, batching, and debug paths.

The expansion gate uses the same production tile composition, tests all 43 frozen path ports as future uphill joins, and checks actual lower-owned stair tiles from seeds 1, 2, and 3 after 39 placements. It compares stable interior data and the full required pavement strip at each declared level or tread height. It runs before screenshot capture. Its complete case inventory and results are stored in `expansion-validation.json`.
