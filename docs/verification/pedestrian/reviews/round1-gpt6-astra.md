# Pedestrian replacement review

Reviewed the requested scoped diff, current source, pedestrian architecture/workflow/open issues, and the poteto-mode and interrogate review guidance. No repository files were edited and no agents were delegated. All files in `/tmp/barrio-pedestrian-review-files.json` still matched their supplied SHA-256 hashes when checked after the probes. The unrelated environment changes and preexisting atmosphere failure are excluded.

## Findings

### 1. [critical] Uphill expansion cuts through already planned entrance and primary pavement

**Location:** `web/src/render/pedestrian.ts:352-355`, `web/src/render/pedestrian.ts:889-896`. Related boundary conversion at `web/src/render/pedestrian.ts:780-783`.

**Finding:** Boundary reservations exclude other groups, but permit the same group's interior routes to enter the future stair footprint. Buildings reserve that footprint through `roomFor`, but their entrance routes do not. When an uphill neighbor arrives, `withBoundaries` converts the adapter to stairs and `pavement` subtracts the full stair footprint from every level sheet. Previously valid level edges consequently lose pavement or run into the side of a raised tread. Their graph traversal still says level at height zero, and no route failure is reported. Reserving only buildings does not establish the promised stable physical interior.

**Evidence:** A targeted probe loaded the actual TypeScript modules through Vite SSR, planned each frozen fixture tile with one path side changed to `{ meet: 'match', rise: 1 }`, called the production `pave`, extracted its upward `Surface.paving` triangles, and ran the existing independent `pavementCoverage`. Nine of 43 cases had missing required pavement samples. Examples:

- Frozen B, tile `(0,0)`, side 0 uphill. Entrance edges `edge:11` and `edge:12`, serving door side 5, lose width near their shared landing. The missing samples include `(1.0154690804, 0.2373330063)` at `edge:11`, `t=0.999`, lateral offset `-0.11999`.
- Frozen E, tile `(-2,0)`, side 0 uphill. Door side 1's threshold `edge:0` loses even its **centerline** sample at `t=0.75`, `(0.6652192608, 0.7531109060)`. The graph reports no failures. The same level threshold proceeds into the new stair footprint.
- Other failing E cases were `(-1,0)/side4`, `(2,-1)/side1`, `(-2,1)/side2`, `(-2,1)/side3`, `(1,-2)/side3`, and `(2,-2)/side1` and `/side2`.

The current expansion test compares house transforms and graph nodes/edges, so it accepts precisely this failure: those objects remain unchanged while the mesh no longer implements them.

**Suggestion:** Reserve future stair corridors against same-group level routes as well, with an explicit usable landing and permitted approach at the inner endpoint. Validate the full buffered incoming geometry against that reservation. Keep the intrinsic plan valid for every adapter state; do not fix this by rerouting the interior when neighbors arrive. Extend the expansion check to actual mesh coverage at each edge's declared height, including stair/level junctions.

### 2. [critical] The chapel fabricates service for a null rule entrance

**Location:** `web/src/render/tiles.ts:538-539`. The validation bypass is `tools/pedestrian-verify.mjs:102`.

**Finding:** The landmark branch replaces the chapel door's null Rust entrance assignment with the first positive path group. `connectDoor` then creates its physical entrance and `HomePlan.connected` becomes true. This contradicts the explicit requirement that a door with a null rule assignment remain unserved. Declaring its forecourt public does not make the doorway's rule assignment non-null.

**Evidence:** The real chapel template is `PHPNPN`, with paths `[1,0,1,0,1,0]` and entrances `[null,1,null,null,null,null]`. Rust's `entrances` function returns `None` for every non-`Homes` side (`crates/barrio-core/src/tile.rs:168-172`). `plan` places the chapel at the first nature side, side 3. A direct current-source probe returned `{side:3, group:1, public:true, connected:true}`, a group-1 door node, and no failures, despite `site.entrances[3] === null`.

The capture validator takes `h.group` before the fixture's authoritative assignment, so it would also accept this fabricated connection. None of the five frozen scenes includes a chapel.

**Suggestion:** Preserve the null entrance assignment on the chapel door and emit the existing explicit unserved diagnostic. Model an independently permitted public forecourt as its own destination without silently treating the door as served. Compare every door's assigned group against the authoritative rule input in validation. Any exception for chapel door service requires an explicit change to the stated policy.

### 3. [warning] The acceptance gate passes when the entire settlement report is missing

**Location:** `tools/pedestrian-verify.mjs:24-26`, `tools/pedestrian-verify.mjs:99-100`, `tools/pedestrian-verify.mjs:217-235`.

**Finding:** The frozen fixture is used only to look up reported tiles. The gate never checks that the report contains every expected tile or required home. Tile and door totals are observations, not assertions. Missing tiles remove their routes, geometry, doors, and seam checks from consideration and can turn an incomplete capture into a passing scene.

**Evidence:** I executed the actual verifier with injected in-memory file I/O, retaining the passing iteration-1 reports for A–D and returning `[]` only for `E-settlement-report.json`. No source or report file was changed. The verifier completed successfully with overall `passed: true`; E reported `tiles: 0`, `doors: 0`, `errors: []`, and `passed: true`. It therefore accepted omission of all twenty settlement tiles, including the 34 routable doors and three explicitly unserved homes.

**Suggestion:** Before checking graph and geometry details, require the exact unique tile-coordinate set from `scenes.json`. Derive the expected home sides from each fixture's rule data, include explicitly modeled landmarks, and require the corresponding door records. Reject missing/duplicate tiles, missing homes, and missing geometry-check fields. This makes the frozen fixture an independent expectation rather than allowing the observed output to define its own test inventory.

## Verification notes

- Ran bounded source-level geometry probes and the in-memory verifier mutation above. Did not rerun the full suite or browser capture.
- The original five-scene iteration-1 validation artifact reports success.
- The final artifacts appeared during this review. At inspection time `docs/verification/pedestrian/validation.json` reported `passed: false`, with “Pavement leaves terrain” errors in B, C, D, and E. That capture gate remains unresolved; this review does not certify it as passing or attribute those artifact failures to a confirmed additional source defect.
- No separate code-quality blocker is asserted merely for the planner's size or its single spatial owner. The concrete structural problem is the incomplete boundary-reservation contract in finding 1.

## Minimal reproduction of finding 1

Run from the repository root. This loads production modules without starting a browser or changing source files.

```sh
node --input-type=module <<'JS'
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { pavementCoverage } from './tools/pedestrian-geometry.mjs';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { TileKit } = await server.ssrLoadModule('/src/render/tiles.ts');
  const { Builder } = await server.ssrLoadModule('/src/render/builder.ts');
  const { pave } = await server.ssrLoadModule('/src/render/pedestrian.ts');
  const { Surface } = await server.ssrLoadModule('/src/render/palette.ts');
  const scenes = JSON.parse(readFileSync('docs/verification/pedestrian/scenes.json'));
  const scene = scenes.find(s => s.name === 'B-five-houses');
  const kit = new TileKit();
  const site = { ...scene.snapshot.tiles[0], seed: scene.snapshot.seed, region: scene.snapshot.region };
  const sides = Array.from({ length: 6 }, (_, i) => ({
    meet: i === 0 ? 'match' : 'open', rise: i === 0 ? 1 : 0,
  }));
  const graph = kit.plan(site, sides).pedestrian;
  const builder = new Builder(false);
  pave(builder, graph);
  const geometry = builder.finish();
  const positions = geometry.getAttribute('position');
  const surfaces = geometry.getAttribute('surface');
  const normals = geometry.getAttribute('normal');
  const triangles = [];
  for (let i = 0; i < (geometry.index?.count ?? positions.count); i += 3) {
    const ids = [0, 1, 2].map(j => geometry.index ? geometry.index.getX(i + j) : i + j);
    if (!ids.every(id => surfaces.getX(id) === Surface.paving && normals.getY(id) > 0.9)) continue;
    triangles.push(ids.map(id => ({
      x: positions.getX(id), y: positions.getY(id), z: positions.getZ(id),
    })));
  }
  console.log(pavementCoverage(triangles, graph));
  geometry.dispose();
  kit.dispose();
} finally {
  await server.close();
}
JS
```
