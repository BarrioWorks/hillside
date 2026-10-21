# Visual research ledger

Initial version, 2026-10-21. One entry per research technique planned for the visual overhaul. Analysis and rationale are in [visual-reference-analysis.md](visual-reference-analysis.md). The earlier engineering ledger is [research-ledger.md](research-ledger.md).

Every source below was opened or resolved during this research. DOIs were resolved through the Crossref API. The implementer fills in the TBD fields after implementation and measurement. A Result must state what was measured or compared, not what was intended.

## 1. Shape grammar facade splits

- **Source.** Müller, Wonka, Haegler, Ulmer, Van Gool. "Procedural Modeling of Buildings." ACM Transactions on Graphics 25(3), 2006. <https://doi.org/10.1145/1141911.1141931>. Author copy read: <https://peterwonka.net/Publications/pdfs/2006.SG.Mueller.ProceduralModelingOfBuildings.final.pdf>. The paper builds a mass model first, then splits facades with rules such as `Subdiv("Y",3.5,0.3,3,3,3){ floor | ledge | floor | floor | floor }`, `Repeat("X",2){ B }`, and `Comp("faces"){ A }`, with relative sizes written as `1r`.
- **Application in Barrio Builder.** Replace hand-placed boxes in `architecture()` (`web/src/render/models.ts`) with staged functions: mass, storey split at 0.8 with 0.06 slab bands, facade split into bays, then openings, grilles, and roof items. Material per storey follows the brick and plaster rule in the analysis document. No grammar interpreter.
- **Implementation reference.** TBD: implementer fills in
- **Before/after evidence.** TBD
- **Result.** TBD

## 2. Boundary and edge extraction for parapets and party walls

- **Source.** Müller et al. 2006 (above), section 3.2: occlusion queries such as `tile : Shape.occ("noparent") == "none" ; window` avoid placing windows on intersecting volumes. Stålberg, Townscaper: "interesting things happen where different things meet" (<https://www.mcvuk.com/business-news/when-we-made-townscaper/>) and corner-segment tiles that re-evaluate when a neighbor changes (<https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making>). Corner-mask tile selection explained by Boris the Brave: <https://boristhebrave.com/2018/04/15/marching-cubes-tutorial/>.
- **Application in Barrio Builder.** Compute a per-placement edge mask from `Snapshot.structures` and `Snapshot.cells`: neighbor building, path or stair landing, or terrace drop on each side. Use it to suppress side windows on shared walls, render party walls as exposed brick, join parapets, face the door toward a path, and extend plinths down at terrace drops. Add the mask to the `World.reconcile()` signature and rebuild neighbors when a placement changes. Extract terrace height changes in `Terrain` to place retaining-wall faces.
- **Implementation reference.** TBD: implementer fills in
- **Before/after evidence.** TBD
- **Result.** TBD

## 3. Seeded variation

- **Source.** Farrokhi Maleki and Zhao, AIIDE 2024, section 3 on reproducibility from seed and algorithm: <https://doi.org/10.1609/aiide.v20i1.31877> (read in the prior research round, see `open-source-research.md`). Shaker, Togelius, Nelson, *Procedural Content Generation in Games*: <http://pcgbook.com/>. Stålberg on Townscaper: "It will always be slightly different, which I like very much" (MCV link above).
- **Application in Barrio Builder.** Derive a detail seed in TypeScript from `structure.id` and `snapshot.seed`. Use it for tank position and color, plant count, unfinished top, cantilever, brick versus painted upper floors, and plus or minus 3 percent wall lightness. Rust variation stays `variation % 3` for the main color. Saves stay deterministic because the inputs are saved.
- **Implementation reference.** TBD: implementer fills in
- **Before/after evidence.** TBD
- **Result.** TBD

## 4. Instanced and batched rendering

- **Source.** Three.js `InstancedMesh` documentation: <https://threejs.org/docs/pages/InstancedMesh.html>. Three.js `BatchedMesh` documentation, "Use this class if you have to render a large number of objects with the same material but with different geometries or world transformations": <https://threejs.org/docs/pages/BatchedMesh.html>. `BatchedMesh` exists in the installed r180 package (`node_modules/three/src/objects/BatchedMesh.js`).
- **Application in Barrio Builder.** `StructureBatches` already instances shared placement geometry. Neighbor masks and seeded details multiply unique geometries. Evaluate moving building geometry to one `BatchedMesh` per material, with `addGeometry` per `kind/variant/mask` and `addInstance` per placement, against the current `InstancedMesh` batches. Keep terrain and border trees on `InstancedMesh`.
- **Implementation reference.** TBD: implementer fills in
- **Before/after evidence.** TBD
- **Result.** TBD

## 5. Baked vertex ambient occlusion and contact shadows

- **Source.** Mikola Lysenko, "Ambient occlusion for Minecraft-like worlds", 0fps, 2013: <https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/>. Per-vertex AO from two side neighbors and one corner, `3 - (side1 + side2 + corner)`, with quad diagonal flipping for consistent interpolation. Optional screen-space comparison: Three.js `GTAOPass` (<https://threejs.org/docs/pages/GTAOPass.html>), which sets `PERSPECTIVE_CAMERA` from the camera type and so supports orthographic cameras in r180. N8AO, CC0, documents orthographic support: <https://github.com/N8python/n8ao>.
- **Application in Barrio Builder.** In `Shapes` (`models.ts`), darken vertex colors near building bases, under slab edges, and inside window reveals. In `Terrain`, darken soil and grass vertices at the foot of each terrace step and building footprint. Screen-space AO only on the high quality tier, and only if measured cost is acceptable.
- **Implementation reference.** TBD: implementer fills in
- **Before/after evidence.** TBD
- **Result.** TBD

## 6. Atmospheric perspective via fog

- **Source.** O'Shea, Blackburn, Ono. "Contrast as a depth cue." Vision Research 34(12), 1994: <https://doi.org/10.1016/0042-6989(94)90116-3>. Lower contrast regions were judged farther away, and the authors relate the effect to aerial perspective. Three.js `Fog` and `FogExp2`: <https://threejs.org/docs/pages/Fog.html>, <https://threejs.org/docs/pages/FogExp2.html>. Observed in `tools/research/sources/santodomingo-reference.jpg`: hill layers sample `#37454F` near and `#4C5355` far.
- **Application in Barrio Builder.** Tie `scene.fog` near and far to the board and mountain ring distances in the `World` constructor. Mix mountain instance colors in `Terrain.landscape()` toward the fog color by ring. Fade the 500 by 500 ground plane. Keep the playable board out of visible fog at all zoom levels.
- **Implementation reference.** TBD: implementer fills in
- **Before/after evidence.** TBD
- **Result.** TBD

## 7. Limited harmonious palette

- **Source.** Schloss and Palmer. "Aesthetic response to color combinations: preference, harmony, and similarity." Attention, Perception, & Psychophysics, 2010: <https://doi.org/10.3758/s13414-010-0027-0>. Stålberg on Townscaper: "a rainbow palette plus two extra greys and white" (MCV link above). Wagemans et al., "A century of Gestalt psychology in visual perception: I." Psychological Bulletin, 2012, on grouping by similarity: <https://doi.org/10.1037/a0029333>. Three.js color management: hex colors convert from sRGB, vertex colors are stored in Linear-sRGB: <https://raw.githubusercontent.com/mrdoob/three.js/r180/manual/en/color-management.html>.
- **Application in Barrio Builder.** One palette module with 13 named colors and 3 neutrals (see the analysis document). Replace constants and the `variants` record in `models.ts`, HSL values in `terrain.ts`, and world colors in `DESIGN.md`. Keep warm brick dominant and cool hues low chroma.
- **Implementation reference.** TBD: implementer fills in
- **Before/after evidence.** TBD
- **Result.** TBD

## 8. Tone mapping choice

- **Source.** Three.js r180 tone mapping constants include `ACESFilmicToneMapping`, `AgXToneMapping`, and `NeutralToneMapping`: <https://threejs.org/docs/#api/en/constants/Renderer>. Comparison example: <https://threejs.org/examples/webgl_tonemapping.html>. Khronos PBR Neutral rationale, which states ACES and AgX lose saturation and that Neutral preserves hue and saturation of base color: <https://modelviewer.dev/examples/tone-mapping> and <https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products>. The installed shader cites the same model-viewer page above `NeutralToneMapping`.
- **Application in Barrio Builder.** The `World` constructor uses `ACESFilmicToneMapping` at exposure 1.15. Compare ACES, AgX, and Neutral on the contact sheet (`/?contact-sheet`) and the default view. Pick the one that keeps palette hex values closest on screen while holding highlight detail on off-white trim. Re-tune exposure and light intensities after the switch. Apply the same choice in `thumbnails.ts`.
- **Implementation reference.** TBD: implementer fills in
- **Before/after evidence.** TBD
- **Result.** TBD

## 9. Shadow-map fitting

- **Source.** Microsoft, "Common Techniques to Improve Shadow Depth Maps": <https://learn.microsoft.com/en-us/windows/win32/dxtecharts/common-techniques-to-improve-shadow-depth-maps>. Tight orthographic fit, tight near and far planes, and moving the light projection in texel-sized increments to stop shimmering. Donnelly and Lauritzen, "Variance Shadow Maps", I3D 2006: <https://doi.org/10.1145/1111411.1111440>. Installed Three.js r180 `LightShadow.radius` documentation: "The property has no effect when the shadow map type is `PCFSoftShadowMap`".
- **Application in Barrio Builder.** In the `World` constructor, compute the shadow camera bounds from the board's corners plus the tallest structure in light space, instead of fixed plus or minus 30. Fit near and far from the same bounds. Snap the light target to whole shadow texels. Resolve the current dead setting: `sun.shadow.radius = 3` with `PCFSoftShadowMap`. Either switch to `PCFShadowMap` with a radius, or remove the radius.
- **Implementation reference.** TBD: implementer fills in
- **Before/after evidence.** TBD
- **Result.** TBD

## 10. Easing and squash for placement feedback

- **Source.** Lasseter, "Principles of traditional animation applied to 3D computer animation", SIGGRAPH 1987: <https://doi.org/10.1145/37402.37407> (squash and stretch, timing, follow-through). Robert Penner's easing equations: <http://robertpenner.com/easing/>. Curve reference: <https://easings.net/>. Pichlmair and Johansen, "Designing Game Feel: A Survey", IEEE Transactions on Games, 2022: <https://doi.org/10.1109/TG.2021.3072241>. Swink, *Game Feel*, Morgan Kaufmann, 2009, ISBN 978-0-12-374328-2: <https://shop.elsevier.com/books/game-feel/swink/978-0-12-374328-2>. Jonasson and Purho, "Juice it or lose it", 2012: <https://www.youtube.com/watch?v=Fy0aCDmgnxg>. Nijman, "The art of screenshake", INDIGO Classes 2013: <https://www.youtube.com/watch?v=AJdEqssNZ-U>. Barrio rejects screen shake, following Dorfromantik's stated limit that "no sound or animation would disrupt the calming atmosphere": <https://www.gamedeveloper.com/disciplines/sparking-joy-through-tile-placement-in-idyllic-village-builder-i-dorfromantik-i->.
- **Application in Barrio Builder.** In `World.frame()`, replace the Y-only ease-out cubic with ease-out-back on Y (peak about 1.06) and an inverse half-amount XZ squash, settling by 260 ms. Reveal detail geometry 90 to 120 ms after the mass. Add a short ground ring fade. Pair timing with `Sound.play()` in `web/src/sound.ts`. Skip all of it when `World.reducedMotion` is true.
- **Implementation reference.** TBD: implementer fills in
- **Before/after evidence.** TBD
- **Result.** TBD
