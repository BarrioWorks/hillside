# Visual reference analysis

Research date 2026-10-21, written before implementation. Each technique now carries an **Implemented:** line describing what shipped at commit 935c8ba. This document informs the visual overhaul of the renderer in `web/src/render/` and the interface in `web/src/ui.ts`. Its research entries are tracked in [visual-research-ledger.md](visual-research-ledger.md).

Evidence labels:

- **Documented** means a developer, publisher, paper, or official documentation states it. The source URL is given.
- **Observed** means it is inferred from play, trailers, or screenshots. No primary source was found. Treat it as a hypothesis.
- **Brief** means the development brief requests it. No source in this document establishes its prevalence.

Current renderer facts that the recommendations refer to:

- `web/src/render/models.ts`: `Shapes` merges box, cylinder, and icosahedron primitives with per-vertex colors. `architecture(def, variation)` builds six building types. `prop(def)` builds path, stairs, tree, planter, and bench. `ModelLibrary.create(kind, variation)` returns one mesh per placement, keyed only by kind and `variation % 3`. One `MeshStandardMaterial` with `vertexColors` and roughness 0.9 is shared.
- `web/src/render/terrain.ts`: `Terrain` builds instanced soil columns and a 0.09 thick surface slab per cell, a 500 by 500 ground plane at y = -1.3, 16 instanced cone mountains, and 180 instanced border trees. `STEP = 0.55`.
- `web/src/render/world.ts`: the `World` constructor sets `ACESFilmicToneMapping` at exposure 1.15, `PCFSoftShadowMap`, one `DirectionalLight` with a 60 by 60 unit shadow camera, `HemisphereLight`, and `Fog('#d9e6e2', 60, 150)`. `reconcile()` rebuilds a placement when its signature (kind, cell, rotation, variation, height) changes. `frame()` animates new placements by scaling Y with an ease-out cubic from 0.35 to 1 over 240 ms. `showGhost()` draws a flat blue or red transparent copy plus a cell marker.
- `web/src/render/batches.ts`: `StructureBatches` packs placement meshes into `InstancedMesh` batches by geometry.
- `web/src/ui.ts`: `UI` builds the DOM shell, palette, and `#placement-feedback`.

Two defects found during this review:

1. `world.ts` sets `sun.shadow.radius = 3` while using `PCFSoftShadowMap`. The installed Three.js r180 source (`node_modules/three/src/lights/LightShadow.js`) states: "The property has no effect when the shadow map type is `PCFSoftShadowMap`". The radius setting currently does nothing.
2. `bricks()` in `models.ts` emits one box per brick course segment. On the 3.25 tall `torre` it emits about 28 rows of boxes. This is triangle-heavy for a detail that is two to three pixels tall at default zoom.

## Townscaper

Sources: Steam page <https://store.steampowered.com/app/1291340/Townscaper/>. Talk "Organic Towns from Square Tiles", IndieCade Europe 2019, <https://www.youtube.com/watch?v=1hqt8JkYRdI>. Game Developer, "How Townscaper works" <https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making>. MCV/Develop interview <https://www.mcvuk.com/business-news/when-we-made-townscaper/>. Stålberg grid tweet, summarized by Boris the Brave <https://boristhebrave.com/docs/sylves/1/articles/tutorials/townscaper.html>.

### T1. Context-selected modules

- **What.** Documented. The talk description says the game generates towns "through a mix of Marching Cubes and Wave Function Collapse". Game Developer reports that tiles are "corner segments", that adding or removing a block forces neighbors to re-evaluate, and that garden modules only appear where enclosed by walls.
- **Why it works.** The player places coarse intent. The system adds the correct local detail. Neighbor-dependent detail makes clusters read as one built mass, which supports Gestalt grouping by connectedness and similarity (Wagemans et al. 2012, <https://doi.org/10.1037/a0029333>).
- **Fit.** Partial. A WFC solver is rejected for this project (see `docs/open-source-research.md`). A deterministic neighbor mask gives the useful part: shared party walls, suppressed side windows, and joined parapets.
- **Three.js.** Compute a 4-bit mask per placement from `Snapshot.structures` (occupied N, E, S, W cells at the same terrace height). Key cached geometry by `kind/variant/mask`. Build with the existing `Shapes` merge.
- **Barrio systems.** `ModelLibrary.create()` and its `geometries` map key in `models.ts`. `architecture()` takes the mask. `World.reconcile()` must add the mask to `signature` and rebuild the four neighbors of any changed placement.
- **Implemented:** No, for buildings. A 4-side context (`link`, `open`, `drop`, `rise`) is computed for street pieces only in `World.context()` (`web/src/render/world.ts`) and keys path geometry in `ModelLibrary.geometry()`. Building masks were skipped to avoid multiplying 16 cached variants per kind by up to 16 masks and rebuilding neighbors on every edit.

### T2. Detail where things meet

- **What.** Documented. Stålberg: "One of my core aesthetic ideas is that interesting things happen where different things meet" and "Where you want to put the details is where the wall meets the floor" (MCV interview).
- **Why it works.** Boundaries carry occlusion, shadow, and material change. They are where the eye reads contact and scale. Floating boxes without base detail read as toys placed on a table.
- **Fit.** Yes. Terrace edges, building bases, slab edges, and roof edges are the Barrio boundaries.
- **Three.js.** Add base plinths, slab-edge bands, parapet caps, and terrace retaining-wall faces as merged boxes with vertex colors. Darken the bottom 0.1 to 0.15 units of each wall in vertex color (contact shadow).
- **Barrio systems.** `architecture()` adds a plinth and slab bands per storey. `Terrain` constructor in `terrain.ts` adds retaining-wall faces where neighboring cell heights differ by one `STEP`.
- **Implemented:** Yes. Slab bands, plinths, lintels, sills, roof coping, and parapet caps in `mass()` and `roof()` (`web/src/render/architecture.ts`). Stone retaining walls with a concrete coping on every terrace edge in the `Terrain` constructor (`web/src/render/terrain.ts`). Baked base darkening in `Builder.finish()` (`web/src/render/builder.ts`).

### T3. Small fixed palette

- **What.** Documented. Stålberg: "It's a rainbow palette plus two extra greys and white basically" (MCV interview). The Steam page says "Pick colors from the palette".
- **Why it works.** Few hues at controlled lightness keep any combination harmonious. Schloss and Palmer report that pair harmony rises with hue similarity and lightness contrast (<https://doi.org/10.3758/s13414-010-0027-0>).
- **Fit.** Yes. Barrio already uses three variants per type. Draw all of them from one named palette (see "Medellín palette" below).
- **Three.js.** One `palette.ts` module of sRGB hex strings. `new THREE.Color(hex)` converts sRGB to the Linear-sRGB working space when `ColorManagement` is enabled, which matches the manual's rule that vertex colors are stored in Linear-sRGB (<https://raw.githubusercontent.com/mrdoob/three.js/r180/manual/en/color-management.html>). The existing `Shapes.add()` path is therefore correct. Keep it.
- **Barrio systems.** Replace the local constants and the `variants` record in `models.ts`. Replace hard-coded HSL in `Terrain` and `landscape()`. Keep `DESIGN.md` world colors in sync.
- **Implemented:** Yes. `web/src/render/palette.ts` (`PALETTE`, `PLASTER`, `TRIM`). `DESIGN.md` world tokens match it.

### T4. Irregular grid

- **What.** Documented. Stålberg's 2019 tweet: "Fairly even irregular quads grid in a hex". Steps: triangles in a hexagon, random pair merge, quad subdivision, relaxation. Stålberg: "the bigger shapes you get from the organic nature of the grid breaks up the repetition of the tiling" (MCV).
- **Why it works.** Irregular cells break visual repetition while each module stays a quad.
- **Fit.** No for the grid. Rust owns an integer 32 by 32 board and its placement rules. Partial for the goal. Break repetition with small seeded offsets on non-structural parts (tank position, setback of upper storey, planter count).
- **Three.js.** Hash `(structure.id, seed)` into a deterministic PRNG in TypeScript. Do not add a new Rust field.
- **Barrio systems.** `ModelLibrary.create()` receives a detail seed. `World.reconcile()` passes `structure.id`.
- **Implemented:** Yes, as seeded variation, not as an irregular grid. Rust stores a 16-way variation per placement; `style()` in `architecture.ts` derives finish, colors, cantilever, and roof additions from it.

### T5. Mass first, detail after

- **What.** Documented. Game Developer: a block appears first and its detail fills in after, and "the decoration of a tile is separate from when it is generated".
- **Why it works.** Two beats give a cause and an effect. The player sees the volume they asked for, then the city's response.
- **Fit.** Yes, within 300 ms total. Townscaper's delay is a compute cost. Ours is a deliberate stagger.
- **Three.js.** Build two geometries per variant: mass and detail. Animate mass scale first, then reveal detail 90 to 120 ms later. With `StructureBatches`, add the detail mesh as a child, matching how `create()` already adds the awning wrapper.
- **Barrio systems.** `architecture()` returns `{ mass, detail }`. `World.frame()` handles two phases. `StructureBatches.update()` is already called per animated placement.
- **Implemented:** No. Placement animates the whole mass as one drop-and-settle (`World.animate()`); there is no separate detail geometry.

## Dorfromantik

Sources: Steam page <https://store.steampowered.com/app/1455840/Dorfromantik/>. Game Developer interview with Timo Falcke <https://www.gamedeveloper.com/disciplines/sparking-joy-through-tile-placement-in-idyllic-village-builder-i-dorfromantik-i->. GameBusiness.jp interview with Luca Langenberg <https://www.gamebusiness.jp/article/2022/05/18/20112.html>. No developer source on lighting, palette values, or shaders was found.

### D1. Idealized, harmonic landscape

- **What.** Documented. The team aimed "to not create a realistic interpretation, but an ideal and harmonic interpretation of the real-world landscapes" (Game Developer). Luca Langenberg cites Impressionist landscape painting and wooden toys (GameBusiness.jp). The Steam page says "handpainted boardgame feel".
- **Why it works.** Removing noise, grime, and high-frequency texture leaves color masses that read at small scale.
- **Fit.** Yes. Medellín is the subject, but the rendering is a calm miniature. Show construction honestly (brick, slabs, tanks) without dirt, trash, or decay textures.
- **Three.js.** Untextured vertex colors with low-frequency per-cell and per-building color jitter (plus or minus 3 percent lightness, never hue). No normal maps.
- **Barrio systems.** `Terrain` already jitters lightness. Apply the same small jitter to building wall colors in `architecture()`.
- **Implemented:** Yes. Untextured vertex colors with procedural micro-patterns (brick, stone, paving) in one shared material (`web/src/render/material.ts`). The planned per-building lightness jitter was not added.

### D2. Most frequent action gets the most polish

- **What.** Documented. "the interaction the player does the most has to feel as satisfying as possible" and "Tiny animations and sound effects are great ways to give the player's actions more impact" (Game Developer).
- **Why it works.** Placement happens hundreds of times per session. Feedback quality on that action dominates perceived feel. Pichlmair and Johansen describe juicing as amplification that "provides clarity of feedback by communicating the importance of game events" (<https://doi.org/10.1109/TG.2021.3072241>).
- **Fit.** Yes.
- **Three.js.** Replace the Y-only ease-out cubic with a short squash-and-settle: scale Y overshoot to about 1.06 with ease-out-back, scale XZ inverse by half the amount, settle to 1 by 260 ms. Add a ground dust ring (one instanced flat ring, opacity fade). Pair with `Sound.play()`.
- **Barrio systems.** `World.frame()` placement animation. `World.reconcile()` sets `born`. `web/src/sound.ts`.
- **Implemented:** Yes. Drop-and-settle squash over 280 ms, a pooled landing ring, and synthesized foley (`World.animate()`, `World.ring()`, `web/src/sound.ts`).

### D3. Calm feedback limits

- **What.** Documented. "no sound or animation would disrupt the calming atmosphere of Dorfromantik" (Game Developer).
- **Why it works.** Juice must match tone. Nijman's "The art of screenshake" (INDIGO Classes 2013, <https://www.youtube.com/watch?v=AJdEqssNZ-U>) and Jonasson and Purho's "Juice it or lose it" (2012, <https://www.youtube.com/watch?v=Fy0aCDmgnxg>) show amplification for action games. Barrio takes their timing and layering lessons and rejects screen shake, flashes, and particle bursts.
- **Fit.** Yes. No camera shake. Every effect under 300 ms. Honor `prefers-reduced-motion`, which `World.reducedMotion` already reads.
- **Three.js.** No change in technique. This is a constraint on D2 and T5.
- **Barrio systems.** `World.frame()`, `World.reducedMotion`.
- **Implemented:** Yes. No shake or particles. `prefers-reduced-motion` disables placement, removal, ring, zoom, and orbit easing. Placement motion is 280 ms, within the 300 ms limit stated here; the ring fades over 520 ms.

### D4. Preview that shows fit before commit

- **What.** Observed. Dorfromantik's hover preview marks which tile edges match neighbors. The Steam page states that points depend on fit with neighbors.
- **Why it works.** The player learns the rules from the preview, not from failure.
- **Fit.** Partial. Barrio rules are validity, not scoring. Stairs need a landing and paths connect. Show those relations on the ghost.
- **Three.js.** Draw short edge bars on the marker (four thin boxes or a `LineSegments` with `LineBasicMaterial`) colored per side: connected, open, blocked. Add an arrow on the stairs ghost toward the uphill landing. The current `Preview` only has `valid`, `reason`, `height`, `width`, `depth`. Per-edge data can be computed in TypeScript from `Snapshot` for display only. Rust stays the authority on validity.
- **Barrio systems.** `World.showGhost()` and `marker`. `previewSchema` in `web/src/domain.ts` if Rust later exposes edges. `#placement-feedback` in `UI`.
- **Implemented:** Partly. The ghost is warm off-white when valid and coral when invalid, with a footprint marker and outline (`World.showGhost()`). The remove tool shows a coral volume and edge box around the target. Per-edge fit bars and the stair arrow were not implemented.

### D5. The board as a physical object

- **What.** Observed. Tiles are thick slabs with visible earth sides. The world ends in an edge rather than continuing forever.
- **Why it works.** A bounded diorama reads as a toy that can be held. It frames the play area and explains where building stops.
- **Fit.** Yes. Barrio already has a 32 by 32 terraced block with soil columns.
- **Three.js.** Give soil columns two vertex-colored strata (topsoil band 0.12 under the grass, darker earth below). Add a 0.04 grass lip overhang. Fade the 500 by 500 ground plane into fog rather than presenting it as a second floor.
- **Barrio systems.** `Terrain` constructor (`soil`, `pickable`) and `landscape()` ground plane in `terrain.ts`. Fog in the `World` constructor.
- **Implemented:** Yes. The board is a floating slab: grass top, soil sides, dark base, and a vegetation fringe on the 3-cell margin (`Terrain` constructor and `Terrain.margin()`). The ground plane and mountain ring were removed. Soil strata use a shader banding on the soil surface rather than a separate topsoil band.

## Tiny Glade

Sources: Steam page <https://store.steampowered.com/app/2198150/Tiny_Glade/>. 80.lv interview <https://80.lv/articles/exclusive-tiny-glade-developers-discuss-bevy-proceduralism-publishers-cozy-games/>. 80.lv procedural windows <https://80.lv/articles/procedural-windows-in-pounce-light-s-tiny-glade-get-an-upgrade>. Graphics Programming Conference 2024 talk "Rendering Tiny Glades With Entirely Too Much Ray Marching" <https://www.youtube.com/watch?v=jusWW2pPnA0>.

### G1. Architecture that adapts to the player's action

- **What.** Documented. Steam: "Draw a path through a building? A door pops up! Raise the building? Columns and beams line up to support it." 80.lv: each element has "a pipeline that supports creation, assembly, morphing, or deforming."
- **Why it works.** The world appears to understand intent. The player gets a plausible result without specifying details.
- **Fit.** Yes. Two direct uses. A building's door faces an adjacent path or stair landing. A building at a terrace edge extends its plinth down to the lower terrace so it does not overhang air.
- **Three.js.** Same neighbor mask as T1, extended with "path at side" bits and "drop at side" bits computed from `Snapshot.cells`. Door position becomes a parameter of `architecture()`.
- **Barrio systems.** `architecture()`, `ModelLibrary.create()`, `World.reconcile()` signature. `heightAt()` in `terrain.ts`.
- **Implemented:** Partly. Streets adapt: curbs on open sides, railings at drops, lamps on some pieces (`path()` in `web/src/render/models.ts`). Buildings do not move doors or extend plinths toward neighbors.

### G2. Nothing the player makes looks wrong

- **What.** Documented. Steam: "There are no wrong answers or failure states" and "whatever you make will look cozy out of the box".
- **Why it works.** Aesthetic safety lets the player experiment.
- **Fit.** Partial. Barrio has real invalid placements. Every valid placement must look good next to any neighbor. Invalid feedback should inform, not alarm.
- **Three.js.** Change the invalid ghost from saturated red `#b42336` at opacity 0.53 to a desaturated warm gray-red with a dashed marker outline. Keep the reason text.
- **Barrio systems.** `World.showGhost()` and `ghostMaterial`. `UI` placement feedback text.
- **Implemented:** Yes, for preview color: invalid is desaturated coral at opacity 0.4 instead of saturated red at 0.53; reason text remains. No dashed outline.

### G3. Weathering driven by distance to openings

- **What.** Documented. 80.lv: the window system "uses a single float vertex attribute to encode signed distance to windows" and applies uneven damage to nearby plaster.
- **Why it works.** Wear concentrates where it would occur physically. It looks authored, not random.
- **Fit.** Yes, and it maps onto Medellín construction. Plaster (pañete) is often partial. Exposed brick shows around openings, at the base, and on upper floors.
- **Three.js.** Cheapest option: place a few seeded brick-colored patch boxes 0.004 proud of the plaster next to window frames and corners. Richer option: add a `float` attribute for distance to the nearest opening and threshold it in `material.onBeforeCompile` to mix plaster and brick vertex colors.
- **Barrio systems.** `windowFront()` and `architecture()` in `models.ts`. `ModelLibrary.material`.
- **Implemented:** Yes, by rule, not by distance field. Finish rules in `style()` and `wallFor()` paint the street facade and leave upper floors and side or back walls as exposed brick. No signed-distance weathering.

### G4. Stable shadows and soft lighting

- **What.** Documented. The GPC talk description lists "real-time global illumination", "tilt-shift DoF", and "stable shadows with continuous time of day", running on "10 year old hardware".
- **Why it works.** Shadow stability matters more than shadow sharpness for calm viewing. Shimmering edges during orbit are distracting.
- **Fit.** Partial. Real-time GI and tilt-shift are out of scope for the WebGL budget. Stable, well-fitted sun shadows and soft hemisphere fill are in scope.
- **Three.js.** Fit the orthographic shadow camera to the board bounds in light space and snap its center to whole shadow texels (technique documented by Microsoft, <https://learn.microsoft.com/en-us/windows/win32/dxtecharts/common-techniques-to-improve-shadow-depth-maps>). Either switch to `PCFShadowMap` so `shadow.radius` takes effect, or keep `PCFSoftShadowMap` and remove the dead `radius`. Optional ambient occlusion: `GTAOPass` supports orthographic cameras (its shader defines `PERSPECTIVE_CAMERA` from `camera.isPerspectiveCamera`). `N8AO` is CC0 and documents orthographic support (<https://github.com/N8python/n8ao>). Measure before adopting either.
- **Barrio systems.** Sun setup in the `World` constructor. `World.graphics` quality gate.
- **Implemented:** Yes. Fitted fixed shadow frustum, dead `radius` removed, PCF on the low tier and PCF soft on the high tier (`Lighting` constructor, `World` constructor). No screen-space AO.

### G5. Visible assembly

- **What.** Documented. Steam: "watch the game carefully assemble every brick, pebble and plank". 80.lv: the rearranging walls were "tangibly pleasant to watch".
- **Why it works.** Construction becomes a reward rather than a state change.
- **Fit.** Partial. Full brick assembly is too slow and too costly for hundreds of placements. Storey-by-storey rise fits a vertical barrio and its incremental building culture.
- **Three.js.** Split the mass geometry by storey. Reveal storeys with 40 ms offsets inside the 260 ms budget. Use one `InstancedMesh` matrix update per storey part.
- **Barrio systems.** `architecture()` output grouping. `World.frame()`. `StructureBatches.add()` per part.
- **Implemented:** No. No storey-by-storey reveal.

## Barrio Builder's own identity

### Sources used for the vocabulary

- Swisscontact, "Caracterización del sistema constructivo... viviendas populares... Bogotá" (Valbuena Porras and Mena Serna), <https://www.swisscontact.org/_Resources/Persistent/a/7/d/5/a7d5abb5d0a78b332944290f57a68eef68015770/Caracterizacion_del_sistema_constructivo_de_vivienda_informal_en_Bogota.pdf>. Documented for Bogotá, not Medellín: 70 percent of informal lots use horizontally perforated clay block (bloque de perforación horizontal). This is the hollow clay unit the brief calls ladrillo farol. The source does not use that name. 42 percent use the last concrete slab as a provisional roof so the house can grow upward. Cantilevers (voladizos) occur in 20 percent. Each floor is often built "como si se tratara de una estructura donde solo se apilan los nuevos pisos sobre el anterior".
- El Colombiano, 2022-09-04, Medellín hillsides, <https://www.elcolombiano.com/antioquia/en-laderas-de-medellin-buscan-soluciones-para-reducir-riesgos-por-emergencias-JL18571668>: "esa mole de cemento color ladrillo que se empina hasta los confines de las montañas" and "que quede el cielo para hacer otro piso y hágale de ahí para arriba".
- El Colombiano, 2017-03-08, "Medellín es una ciudad anaranjada", <https://www.elcolombiano.com/tendencias/medellin-es-una-ciudad-anaranjada-DE6107140>: exposed brick gave the city its orange tone. Architect Guillermo Molina (UPB) notes many colors now coexist.
- CNES Géoimage, Medellín, <https://cnes.fr/geoimage/colombia-medellin-modernizacion-de-una-metropoli-andina>: informal housing is mostly "ladrillo y chapa" (brick and sheet metal).
- Brick module: a UFPS study of blocks made in Ocaña, Norte de Santander, calls the H-10 block (10 wide by 20 tall by 30 long, in cm) "el producto más fabricado" by the region's producers (<https://revistas.ufps.edu.co/index.php/ingenio/article/download/2075/2025/36010>). This is regional evidence. It is used here only for proportion.
- Reference photos in `tools/research/sources/` (observed): painted stair risers and retaining walls, black steel posts, and dense planting in Comuna 13. Painted brick wall, grille, and a patch of exposed brick in Manrique. Dense low-rise brick roofscape, flat slabs, and layered blue-green hills in Santo Domingo.
- Water tanks, rebar stubs, and painted ground floors are brief items. They match the provisional-slab finding above but are not separately sourced here.

### Scale

One cell is 1 unit. A storey is 0.8 units. A terrace step is 0.55 units. At 0.8 per storey, 1 unit corresponds to roughly 3 m, so real dimensions scale by about 0.32. Exact real-world scale is not a goal. Proportion between parts is.

### Rules

Implemented with one change of scale: `STOREY` is 0.68 units and slabs are 0.07 (`web/src/render/architecture.ts`), not 0.8 and 0.06. Rules 2, 3, 5, 6, 7, 9, 10, 13 shipped in `architecture.ts` and `terrain.ts`. Rule 4 shipped as a shader pattern (`bbBond()` in `material.ts`). Rule 8 shipped as the volado in `building()` on two of three variants of casa and tienda. Rule 11 shipped with alternating off-white and stone treads and a mustard rail rather than colored risers. Rule 12 shipped as a procedural color-block mural surface on one side wall (`Surface.mural`). Rule 14 was dropped with the mountains.

1. **Storey grid.** Residential heights are whole storeys plus one slab: `h = n * 0.8 + 0.05`. Casa n = 2 (1.65), esquina n = 3 (2.45), torre n = 4 (3.25). These match the current catalog. Terraza is n = 2 (1.65) plus a 0.2 pergola (1.85). Tienda is one tall commercial floor of 1.0 plus a 0.35 parapet and sign band (1.35). Taller is one double-height workshop floor of 1.2 plus a 0.25 roof structure (1.45). Interior floor lines follow 0.8 even when the total does not.
2. **Slab bands.** Each floor line shows a concrete slab edge 0.06 tall, projecting 0.025 beyond the wall, in warm concrete. This is the strongest single cue for stacked, incremental construction.
3. **Brick and plaster by floor.** Ground floor: plastered and painted on 85 percent of buildings. Second floor: painted on 50 percent, exposed brick otherwise. Third floor and above: exposed brick on 80 percent. Side walls facing a neighbor or a drop (party walls, culatas) are always exposed brick unless a mural block is assigned. Choose per building with the detail seed from T4.
4. **Brick rendering.** Courses at 0.08 pitch (10 per storey), blocks 0.13 long with half-bond offset, mortar lines 0.008 wide. Render courses as a world-space Y pattern in the shader, or as color only below zoom 1.5. Do not emit one box per brick row as `bricks()` does now.
5. **Plinth.** Every painted ground floor has a plinth 0.28 tall in a darker value of the wall color (about 15 L* lower) or in exposed brick.
6. **Openings.** Windows 0.24 wide by 0.30 tall, sill 0.28 above floor, off-white frame 0.035, dark glass. Doors 0.24 by 0.56, painted sheet metal in an accent color. Wall-to-opening ratio about 15 to 20 percent per facade (observed). Ground-floor windows always have a grille of 3 vertical bars. Upper windows get grilles on 40 percent.
7. **Upper growth.** One in three buildings of two or more storeys ends with an unfinished top: a bare slab with four rebar stubs 0.18 tall and 0.012 thick at the column corners, plus optionally one partial brick wall 0.4 tall. Others end with a parapet 0.2 tall and 0.06 thick.
8. **Cantilevers.** One in five upper floors projects 0.12 to 0.18 over the street side as a closed room or a balcony with a metal railing 0.28 tall.
9. **Roof life.** Each roof carries one water tank: cylinder radius 0.13, height 0.28, black `#24282b` or blue `#2f5f8f`, on a 0.06 concrete pad. Add one or two of: potted plants, a laundry line, a sheet-metal canopy over 30 to 50 percent of the slab. Sheet metal is warm concrete gray or faded turquoise.
10. **Terraces.** Every height change of one `STEP` (0.55) shows a retaining wall face in warm concrete, with a 0.04 cap. Since a storey (0.8) exceeds a step (0.55), a building on a lower terrace rises above its uphill neighbor's ground. Keep that offset visible. It is the hillside signature.
11. **Public stairs.** Stair risers alternate two or three palette colors (coral, turquoise, mustard), as in the Comuna 13 photo. Treads stay warm concrete. Railings black metal.
12. **Murals.** Murals are abstract color-block panels on retaining walls and blank party walls only. Never copy a real mural or its imagery.
13. **Value structure.** Walls sit between L* 42 and 74. Off-white and cream are trim only, never more than 20 percent of a facade. Window dark (L* 20) is the darkest building value. This keeps silhouettes readable against the light sky and lets shadows read.
14. **Atmosphere.** Distant mountains use dusty blue and weathered teal mixed toward the fog color. Lower contrast with distance is a depth cue (O'Shea, Blackburn and Ono 1994, <https://doi.org/10.1016/0042-6989(94)90116-3>). The Santo Domingo photo shows the same layered blue-green recession (observed).

### Avoid

- Pitched red clay-tile roofs and colonial balconies. They signal a different typology.
- Palm trees on every corner and beach or Caribbean pastel uniformity.
- Sombreros, flags, coffee icons, or other national clichés.
- Every wall a different saturated rainbow color. Most upper mass is brick.
- Grime, trash, broken glass, or decay textures. Unfinished is not the same as derelict.
- Wooden shutters and decorative timber. The vocabulary is brick, concrete, steel, and paint.
- Copying the reference photos, the Metrocable livery, or any specific mural.

## Medellín palette

All values are sRGB hex. Feed them through `new THREE.Color(hex)` so they convert to Linear-sRGB. Photo samples were taken from `tools/research/sources/` with ImageMagick area averages. Photo samples include shade and JPEG desaturation, so lit albedo values are lighter and more saturated than the raw samples.

| Name | Hex | L* | Use | Informed by |
| --- | --- | --- | --- | --- |
| terracotta | `#B5603F` | 50 | Exposed brick, main upper-floor mass | Manrique brick face samples `#896353`, `#8D6352` (shaded) |
| burnt orange | `#C9733A` | 57 | Brick variation, sunlit brick | El Colombiano "ciudad anaranjada" |
| muted coral | `#E0806E` | 64 | Painted ground floors, stair risers | Comuna 13 painted riser `#F36C75` |
| brick red | `#9E4A35` | 42 | Darker brick, plinths, grille paint | Darker brick courses in Santo Domingo roofscape |
| warm ochre | `#C99A52` | 67 | Painted walls | Comuna 13 painted wall `#CAA189` |
| mustard | `#D9AE3F` | 73 | Accent walls, doors, stair risers | Brief, Comuna 13 painted surfaces (observed) |
| cream | `#EADFC4` | 89 | Trim, light painted walls | Brief |
| off-white | `#F1EDE3` | 94 | Window frames, parapet caps | Brief |
| turquoise | `#4FB3BF` | 68 | Painted walls, doors, stair risers | Comuna 13 painted riser `#72D9EC` |
| weathered teal | `#5F8F88` | 56 | Painted walls, sheet metal, far hills | Comuna 13 painted riser `#899D98` |
| dusty blue | `#6F8FB5` | 58 | Painted walls, distant mountains | Manrique painted wall `#5E89B3` |
| muted green | `#7E9A5A` | 60 | Painted walls, grass, planting | Comuna 13 foliage `#71922E` |
| warm concrete gray | `#A9A398` | 67 | Slabs, retaining walls, stairs, columns | Manrique sidewalk `#A6A29C` |

Accent and trim neutrals:

| Name | Hex | L* | Use |
| --- | --- | --- | --- |
| window dark | `#2B3236` | 20 | Glass, open doorways. Comuna 13 steel posts sample `#333D48` |
| metal | `#4A5157` | 34 | Grilles, railings, rebar, tank lids |
| mortar | `#CFC6B4` | 80 | Brick mortar lines, plaster patches |

Hue structure: the warm group spans CIELAB hue 36 to 94 degrees. The cool accents span 185 to 267 degrees. Cool colors stay at chroma 18 to 30 so the warm brick dominates. Mustard (chroma 60) is the most saturated value and is an accent, not a wall default.

## Highest-impact techniques to implement

1. **Controlled palette with value rules** (Townscaper T3, Dorfromantik D1). Replace scattered colors in `models.ts` and `terrain.ts` with the palette above. Switch tone mapping from ACES to `NeutralToneMapping` or `AgXToneMapping` and compare. The Khronos PBR Neutral page states ACES and AgX lose saturation and that Neutral aims to keep base color hue and saturation (<https://modelviewer.dev/examples/tone-mapping>).
2. **Storey grammar with slab bands and brick/plaster by floor** (Müller 2006, Tiny Glade G3). Rebuild `architecture()` as mass, then storey split, then facade split, then openings.
3. **Neighbor-aware party walls, parapets, and doors** (Townscaper T1, T2, Tiny Glade G1). Mask in `World.reconcile()` signature, geometry keyed by mask in `ModelLibrary`.
4. **Terrace retaining walls and base contact detail** (Townscaper T2, Dorfromantik D5). New faces in `Terrain`. Vertex-color darkening at wall bases.
5. **Baked vertex ambient occlusion** (Townscaper and Dorfromantik soft look, observed). Per-vertex darkening in `Shapes.finish()` from height above base and proximity to slabs. Optional `GTAOPass` or N8AO on the high quality tier only.
6. **Squash-and-settle placement with staggered detail** (Dorfromantik D2, D3, Townscaper T5, Tiny Glade G5). `World.frame()`. No shake.
7. **Fitted, stable sun shadows** (Tiny Glade G4). Fit the frustum to the board, snap to texels, and fix the ineffective `radius` in the `World` constructor.
8. **Atmospheric perspective** (Dorfromantik D1, D5). Tighter fog tied to board distance, mountain colors mixed toward fog, ground plane faded. `World` fog and `Terrain.landscape()`.
9. **Seeded detail variation** (Townscaper T4). Tank, plants, unfinished top, cantilever from a hash of `structure.id` and seed in `ModelLibrary.create()`.
10. **Fit-aware ghost preview** (Dorfromantik D4, Tiny Glade G2). Edge bars, stair direction arrow, and a calmer invalid state in `World.showGhost()` and `UI`.

## What shipped

Mapping of the ranked list above to commits and files. Commits are on `main` after the prototype baseline 95b9f82. Details and evidence are in [visual-research-ledger.md](visual-research-ledger.md).

| Rank | Technique | Status | Commits | Files |
| --- | --- | --- | --- | --- |
| 1 | Palette with value rules, Neutral tone mapping | Shipped | 46ae3cd, dbf3916 | `web/src/render/palette.ts`, `world.ts`, `thumbnails.ts`, `lighting.ts` |
| 2 | Storey grammar, slab bands, brick and plaster by floor | Shipped | 46ae3cd, dbf3916, 60d2805, 8d72bbe, 6fbc65a | `web/src/render/architecture.ts`, `builder.ts`, `material.ts` |
| 3 | Neighbor-aware party walls, parapets, doors | Streets only; buildings use finish rules | 46ae3cd | `web/src/render/world.ts` (`context()`), `models.ts` (`path()`), `architecture.ts` (`wallFor()`) |
| 4 | Terrace retaining walls and base contact | Shipped | 46ae3cd, 60d2805 | `web/src/render/terrain.ts`, `builder.ts`, `crates/barrio-core/src/terrain.rs` |
| 5 | Baked vertex AO | Shipped; screen-space AO not adopted | 46ae3cd | `web/src/render/builder.ts` (`finish()`), `terrain.ts` |
| 6 | Squash-and-settle placement | Shipped without staggered detail | 46ae3cd, 3050177 | `web/src/render/world.ts` (`animate()`, `ring()`), `web/src/sound.ts` |
| 7 | Fitted, stable sun shadows | Shipped without texel snapping | 46ae3cd | `web/src/render/lighting.ts`, `world.ts` |
| 8 | Atmospheric perspective | Replaced by diorama framing and sky gradient | 46ae3cd | `web/src/render/lighting.ts`, `terrain.ts` |
| 9 | Seeded detail variation | Shipped, 16 variants per kind | 46ae3cd | `crates/barrio-core/src/world.rs`, `web/src/render/architecture.ts`, `models.ts` |
| 10 | Fit-aware ghost preview | Calmer colors and remove highlight; no edge bars | 46ae3cd, 57b4a79 | `web/src/render/world.ts` (`showGhost()`) |

Work outside the ranked list: contour terrain v2 (`crates/barrio-core/src/terrain.rs`, 46ae3cd), environmental decor with grass, flowers, poles, and cables (`web/src/render/decor.ts`, 46ae3cd) and parked motorcycles (f51038b), three lighting presets (`web/src/render/lighting.ts`, 46ae3cd, dbf3916), the warm floating interface (`web/src/style.css`, `web/src/ui.ts`, 3a1fc8c), removal of runtime GLB models and the asset pipeline (60d2805), the pattern quality tier and render-cost probe (6fbc65a), and the capture harness (`tools/capture.mjs`, 2e8e4b0).
