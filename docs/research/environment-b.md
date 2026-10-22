# Procedural miniature trees for Barrio

Research dated 2026-10-21. Scope is original painterly Colombian environments with Dorfromantik-inspired miniature readability. Preserve existing buildings and gameplay. This document proposes changes only. Rendering code, tests, and screenshots were not changed or executed.

throughput checkpoint: n/a, read-only investigation

Recommend five bounded silhouette recipes, shallow branch hierarchies, and overlapping crown lobes. Keep whole-tree cached geometry and the existing instancing system. Add stable candidate identities before increasing randomness. Expected visual gains and costs below are interpretations, not measured results.

## Primary evidence

- [The Algorithmic Beauty of Plants, Prusinkiewicz and Lindenmayer](https://algorithmicbotany.org/papers/abop/abop.pdf), printed pp. 24-30, 40-41, 51-57. Bracketed turtle interpretation saves and restores branch state. Stochastic productions can vary topology as well as geometry. Parametric modules carry numeric values. The tree chapter describes contraction ratios and branching angles. Figure 2.6 demonstrates separate main and lateral axes. These are source facts. A depth-limited direct recursion for Barrio is an adaptation, not a requirement of the book. The full PDF was downloaded and relevant pages read through text extraction after the web reader rejected its size. [Chapter 1 is also available separately](https://algorithmicbotany.org/papers/abop/abop-ch1.pdf).
- [Procedural Modeling of Cities, Parish and Müller, 2001](https://people.eecs.berkeley.edu/~sequin/CS285/PAPERS/Parish_Muller01.pdf), sections 2 and 3.1, PDF pp. 2-3. The system uses geographical and sociostatistical input maps. It separates proposed successors, global parameter goals, and local constraint adjustment or rejection. Applying that separation to vegetation is my interpretation. This paper does not prescribe tree placement, painterly lobes, or Colombian vegetation.
- [Three.js InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html). Shared geometry and material with different transforms reduce draw calls. Matrix and color updates require their corresponding update flags. Instance bounds may need recomputation after transformations. Installed Three.js is 0.180.0, confirmed in `node_modules/three/package.json`; its `src/objects/InstancedMesh.js` was also inspected.

## What Barrio currently does

- `web/src/render/models.ts:5` builds one generic tree recipe. It has a straight cylinder, one side branch, and four or five similarly sized icosahedral lobes around nearly the same height. Variation mostly changes dimensions, lobe offsets, and color. The inference is that forests repeat a rounded crown silhouette.
- `web/src/render/tiles.ts:960` draws a value in 0..15, reduces it modulo 10, then maps 9 to tree variation 14. The effective generic tree inputs are 0..8 and 14. Thus the yellow bloom inputs 10..12 in `models.ts:8` are unreachable through this placement path. This is a static code finding, not a rendered reproduction.
- `web/src/render/tiles.ts:396` already has tall wax and leaning coconut palm recipes. They use seven straight foliage bars. `compose()` selects them for Salento and Cartagena starting tiles. Regional palm context already exists; extend it carefully rather than replacing it.
- `web/src/render/tiles.ts:882` seeds a deterministic sequential generator from axial coordinates and tile variation. Branches in composition consume that stream differently. Determinism already exists for identical inputs; independence from unrelated decoration changes does not follow from it.
- `decorate()` at `tiles.ts:933` calculates a full horizontal geometry radius and rejects path, hub, and home-access conflicts. Wider crowns can disappear more often under this conservative rule. The existing clearance contract includes crowns and must remain intact.
- `web/src/render/material.ts:20` applies instance and model transforms before sampling world-space patterns. Its foliage path already mixes noise and upward-facing warmth. Geometry colors come from `Builder.add()`. `Builder.blob()` at `builder.ts:124` uses an icosahedron with configurable detail.
- `TileKit.cached()` at `tiles.ts:832` and `StructureBatches.batchFor()` at `batches.ts:107` already share geometry and group meshes by geometry/material/render state. Batches have capacity 1024. There is no need for a second vegetation renderer.

## Applied recommendations

Every entry links its source and states implementation complexity, expected visual gain, estimated runtime cost, and a future verification check. Nothing in this section has been implemented.

### 1. Five silhouette families

Use [ABOP's parametric tree architecture](https://algorithmicbotany.org/papers/abop/abop.pdf), especially pp. 51-57, to guide five original recipes. Barrio's observed problem is the single generic crown recipe described above. Use explicit family names rather than overloading numeric variation with blossom state. Suggested data is a family, a bounded geometry variant, and a separate palette choice.

1. Rounded broadleaf. Use a short forked trunk and five to seven lobes in two unequal tiers. This is the common park and hillside tree.
2. Spreading umbrella. Use a low fork, three outward limbs, and five to seven flattened lobes. Keep a broad upper outline and visible gaps beneath it. Use sparingly where path clearance allows.
3. Upright Andean crown. Use a main axis, ascending side limbs, and four to six narrower lobes at staggered heights. This gives uphill forest groups vertical rhythm without a generic conifer silhouette.
4. Flowering open crown. Use a visible bifurcation and four to six separated lobes. Choose yellow or coral as a palette state, with some retained green. It must differ in outline from the rounded family even when rendered in black.
5. Palm. Preserve the existing wax and coconut subtypes within one family. Use a slender trunk and six to eight broad tapered fronds, each with two short segments to suggest an arch. Preserve the taller wax-palm proportions and coconut lean.

These regional associations are art-direction proposals, not botanical identifications established by the cited sources. Use Barrio's existing regional cues as context. All outlines and palettes should be authored for this game; neither research source establishes Dorfromantik's implementation.

Complexity is medium, confined to vegetation recipes and selection. Expected gain is identifiable miniature silhouettes and regional rhythm. Runtime cost is a bounded increase in cached vertices and geometry variants, with no per-frame growth simulation. Start with two variants per family, including both palm subtypes, rather than unique meshes per tree.

Verification is a future black-silhouette screenshot of all five families at the actual overview zoom, plus colored Salento and Cartagena opening shots. Require every family to remain distinguishable without color. Add a family-reachability check so yellow and coral options both occur. Re-run existing path-clearance tests with every family and variant.

### 2. Shallow hierarchy before extra surface detail

Adapt [ABOP's bracketed branching and Figure 2.6](https://algorithmicbotany.org/papers/abop/abop.pdf). Barrio currently has only one side branch supporting a largely independent crown. Build branch records with a parent, endpoint, direction, length, radius, and remaining depth. Emit a trunk, primary limbs, and at most one secondary split per primary limb. Attach lobes to endpoints. Cap the result at 12 woody segments per broadleaf tree.

Use shorter, thinner children and family-specific inclination and spread. A starting length ratio of 0.6-0.75 and radius ratio near 0.7 are tuning proposals. Branches are geometry built once per cached variant; do not implement an L-system string interpreter or annual growth model for this task. Existing `Builder.bar()` can prove the hierarchy first. Tapered six-sided segments are a later option if exposed limbs need refinement.

Complexity is medium. Expected gain is believable support under a crown, asymmetric gaps, and consistent family structure. Build cost is O(S) for S capped segments per cached variant; render cost grows with visible triangles, including shadow rendering. No frame-time recursive work is needed.

Verification is a future close crop of one rounded and one flowering tree with exposed forks, followed by an overview screenshot proving branches do not become visual noise. A geometry test should assert finite positions, bounded segment counts, and reproducible output for the same family and variant.

### 3. Painterly lobe clusters with broad value groups

Use [ABOP's distinction between structural and geometric variation](https://algorithmicbotany.org/papers/abop/abop.pdf), pp. 28-30, as motivation. Overlapping lobes and paint treatment are my adaptation. Barrio already has lobes and world-space foliage noise; the gap is their near-uniform scale, height, and alternating color assignment.

Vary lobe size and orientation within each family envelope. Place larger interior masses and smaller offset terminal masses, with a few visible gaps. Choose shadow, body, and warm top colors by lobe position and role instead of index parity. Keep the existing world-space foliage treatment subtle. Begin with geometry and vertex-color changes that need no shader changes. Retain detail 1 for close silhouettes; evaluate detail 0 only where angular crowns still read well at overview scale.

Complexity is low to medium. Expected gain is broad painted light and shadow masses rather than a ring of equal balls. Estimated cost is proportional to lobe count. Detail 0 has 20 input triangles per icosahedron and detail 1 has 80 in installed Three.js, before Builder's face removal. More overlapping lobes also increase shading and shadow work; instancing does not remove those costs.

Verification is a future paired screenshot at overview and closest supported zoom under identical lighting. Inspect low quality too, since procedural patterns are disabled there. Broad value groups and family identity must survive without micro-noise. Record triangle counts before accepting extra lobes.

### 4. Stable world-space candidate placement and color

Adapt [Parish and Müller's global goals and local constraints](https://people.eecs.berkeley.edu/~sequin/CS285/PAPERS/Parish_Muller01.pdf), section 3.1. Barrio's current placement is deterministic but consumes one shared stream and repeats sector layouts. Keep the existing terrain/path layout authoritative.

First retain the existing bounded sector candidates, but give each a stable identity derived from axial q/r, sector, and candidate slot. Use separate integer hash channels for acceptance, family, geometry variant, yaw, scale, and palette. An unrelated bench decision must not consume a tree's random value. Compute world XZ using `center(q,r)` plus the candidate's tile-local position. Sample a coarse seeded world-space value field to bias density and palette across adjacent tiles. Coordinate hashing provides reproducible variation; interpolated coarse values provide spatial continuity. They solve different problems.

Use regional family weights as global goals and existing `decorate()` clearance as local rejection. Bound candidate count; never retry until a desired number fits. Keep the board seed explicit if seed-specific visual fields are needed, because current compose seeding uses coordinates and variation. Avoid a global sequential placement pass whose output depends on board iteration order. Optional pairwise spacing must use stable priorities and canonical candidate IDs across tile boundaries, or be deferred.

Complexity is medium. Expected gain is coherent groves and palette patches with stable local variation. Cost is O(CW) for C bounded candidates and W local walk/access constraints, plus constant field samples. Rejecting candidates does not add rendered cost. Retain the current conservative full-crown clearance until a separate visual decision changes that contract.

Verification is a future seam screenshot across neighboring nature tiles, plus deterministic placement tests. Compare the same candidate identities after recomposition, reversed tile iteration, and adding a neighbor that does not change local constraints. Positions, yaw, family, and colors should match. Changed constraints may legitimately remove a candidate. Compare fixed-seed reloads with identical camera and quality; hash geometry attributes and transforms as the stronger determinism assertion, since pixels can vary across GPUs.

### 5. Keep whole-tree sharing and existing instancing

Follow the [Three.js InstancedMesh contract](https://threejs.org/docs/pages/InstancedMesh.html). Barrio already does this correctly at a useful granularity. The risk is losing sharing by creating a seeded geometry per placement or a new material for every palette.

Cache a small family/variant catalog. Merge trunk, limbs, and lobes into one geometry per variant through Builder. Use the existing shared material, vertex colors, instance transforms, and world-space color field. A palette baked into vertex colors creates another geometry variant and must be counted in the catalog budget. Whole-tree `instanceColor` would tint trunks too, and `StructureBatches` currently has no per-instance color lifecycle. Avoid adding it in the first pass. Separate lobe instances are an alternative only if measured reuse savings justify their extra slots and bookkeeping.

Complexity is low for catalog reuse and medium if batch colors are added later. Expected gain is richer forests without an individual draw per tree. Estimated memory grows with bounded catalog geometry plus instance transforms. Draw batches grow with distinct geometry/render-state combinations and capacity spills, not every tree. More geometry still means more vertex and shadow work. Keep transforms positive-scaled to fit the existing reflection handling.

Verification is the existing `web/tests/batches.test.ts` geometry-preservation and sharing checks, plus a future repeated-tree scene whose batch count remains stable until capacity is exceeded. Exercise remove/reinsert and camera-edge culling. Inspect `metrics()` fields `batchCount`, `allocatedBatchCount`, `cachedGeometries`, `drawCalls`, and `triangles` at 10 and 30 placements. Require cache reuse after reload cycles rather than claiming that instancing alone proves performance.

## Delivery and checks for the implementing agent

Implement stable identities and the family catalog first, then hierarchy and lobe paint grouping. Keep building generation, architecture geometry, road topology, and Rust gameplay outside this change. Validate silhouettes before increasing tree density or shader cost.

Existing verification entry points are `web/tests/tiles.test.ts`, `web/tests/batches.test.ts`, `web/tests/game.spec.ts`, `tools/capture.mjs`, and `tools/benchmark.mjs`. The clearance test at `tiles.test.ts:691` checks tree crowns and decorations against walks and home access. Preserve its `tree/`, `palm/`, and other decoration cache-prefix recognition when introducing family keys.

With the existing dev server running, `node tools/capture.mjs docs/screenshots/environment-trees 01-start-medellin,02-start-salento,03-start-bogota,04-start-cartagena,10-thirty-tiles,17-mobile` captures established scenarios and sidecar metrics. These existing shots do not guarantee all new families appear, so the implementing agent also needs an explicit family gallery or fixture. Suggested new evidence names are `trees-five-silhouettes.png`, `trees-close-forks.png`, and `trees-nature-seam.png`. They are proposed artifacts and do not exist as a result of this research.

Run targeted tests with `npm test -- web/tests/tiles.test.ts web/tests/batches.test.ts` and then the project's required checks. Compare performance only under the same seed, camera, quality, browser, and viewport. `tools/benchmark.mjs` defaults to software rendering and low quality, so its results do not establish mobile GPU performance. No timing estimate in this document is a benchmark result.

The Prove It Works principle shaped this research by checking recommendations against actual source and by labeling future verification separately from executed evidence. The Type System Discipline principle shaped the suggestion to separate explicit family identity from palette and numeric variation. Final research verification consists of reading this artifact and checking the diff. No new tests are warranted for this documentation-only deliverable.
