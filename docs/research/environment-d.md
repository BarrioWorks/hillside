# Colombian miniature environments

Research completed 2026-10-21. This is an implementation brief, not an implemented visual change. Only this findings file was written. No rendering code, buildings, terrain rules, or assets were changed. No further agents were spawned.

Throughput checkpoint: n/a, read-only investigation.

## Recommendation

Give each region a persistent vegetation vocabulary, then distinguish its ground and atmosphere. Keep the existing miniature scale, orthographic camera, merged ground, and instanced props. Interpret Dorfromantik through readable clusters and quiet color masses. Make original Colombian shapes and compositions rather than copying its assets or substituting European autumn woods.

The geographical statements below are sourced facts. Model proportions, colors, distribution rules, complexity, expected visual gains, and runtime costs are design interpretations or estimates. They are not measured results. Verification entries describe future acceptance checks, not checks passed during this research.

## What Barrio currently does

- [Region shapes](../../crates/barrio-core/src/region.rs) already distinguish steep Medellín, rolling Salento, low Cartagena, and the rising Bogotá plain. [Terrain generation](../../crates/barrio-core/src/terrain.rs) is deterministic. Preserve its elevations because paths, stairs, and placement use them.
- [Tile composition](../../web/src/render/tiles.ts), around lines 960 to 1042, uses regional palms only when `kind === 'inicio'`. Later `monte` tiles in all regions call the same `treeAt`. [The tree model](../../web/src/render/models.ts) uses four or five rounded canopy blobs. There is no conifer generator in this inspected path.
- `treeAt` reduces variants modulo ten and maps nine to fourteen. Its calls therefore reach the coral bloom but never the mustard bloom branch in `tree`. This is a source-level observation, not a screenshot diagnosis.
- [Ground](../../web/src/render/ground.ts) changes the meadow color slightly by region. Most kinds share one grass treatment. [Materials](../../web/src/render/material.ts) already add foliage noise, meadow variation, and water detail. The low tier disables these patterns.
- [Lighting](../../web/src/render/lighting.ts) changes regional sky colors only in `afternoon`. Daylight and evening share their colors. Fog uses the same near and far distances for every region. The inspected renderer has no distant mountain geometry.
- [The committed developed screenshot](../../web/tests/game.spec.ts-snapshots/developed-linux.png), visually inspected, shows repeated rounded green crowns, occasional coral crowns, exposed terrace walls, and a plain sky gradient. It is a historical image, not a fresh capture of this checkout.
- [StructureBatches](../../web/src/render/batches.ts) batches by geometry identity and material. [TileKit](../../web/src/render/tiles.ts) caches geometries. Preserve both mechanisms when adding species.

## Regional evidence

### Salento and the coffee region

UNESCO describes small coffee plots in mountainous high forest, with settlements on relatively flat hilltops above sloping fields. This supports a cultivated patchwork rather than a uniform meadow. Its page contains an inconsistent slope conversion, so this brief does not repeat its numerical slope claim. [UNESCO, Coffee Cultural Landscape](https://whc.unesco.org/en/list/1121).

Parques Nacionales places wax palms, including *Ceroxylon quindiuense*, in high Andean or cloud forests. It distinguishes these forests from páramo and the volcanic summits. A coffee neighborhood, Cocora-like palm setting, and alpine park are related regional references, not interchangeable habitats. [Parques Nacionales, Los Nevados, Flora and Clima](https://www.parquesnacionales.gov.co/nuestros-parques/parque-nacional-natural-los-nevados/).

A primary study examines guadua-dominated forest patches across six coffee-region localities. This supports guadua as another regional form without implying it occupies every hillside. [Ospina Montealegre and Cardona, Universidad del Cauca journal](https://revistas.unicauca.edu.co/index.php/biotecnologia/article/view/610).

### Medellín and the Aburrá valley

The metropolitan authority describes steep sides around a narrow alluvial valley floor. Its air-management documents also discuss cloudiness and atmospheric confinement. These support enclosing ridges and depth separation, not permanent brown smog. Full PDF retrieval returned 403 during this session. These facts were available in the primary-domain search excerpts. [AMVA, PIGECA, Características topográficas](https://www.metropol.gov.co/ambiental/calidad-del-aire/documents/pigeca/pigeca-aprobado-dic-2017.pdf), [AMVA, atmospheric scenario](https://www.metropol.gov.co/ambiental/calidad-del-aire/Biblioteca-aire/Estudios-calidad-del-aire/Escenario-contaminacion-atmosferica.pdf).

Medellín's environmental secretariat documents yellow and pink guayacanes and explains that yellow flowering is brief and climate dependent. Flowering is a selective accent, not evidence for orange autumn foliage across the whole canopy. [Alcaldía de Medellín, Guayacanes, búcaros y cámbulos](https://www.medellin.gov.co/es/?p=498850).

### Bogotá and the Eastern Hills

The environmental authority describes the Eastern Hills' elevation gradient and their water sources. The botanical garden documents native trees and shrubs used in the Sabana's restoration, including encenillo, gaque, and several tunos. These support mixed Andean crowns and shrub layers. They do not justify filling every urban tile with high páramo frailejones. [Secretaría de Ambiente, Cerros Orientales](https://www.ambientebogota.gov.co/es/cerros-orientales1), [Jardín Botánico de Bogotá, Las Mercedes](https://jbb.gov.co/las-nineras-de-las-plantas-nativas-del-vivero-las-mercedes/).

Bogotá's health authority describes a cold mountain climate with urban climatic variation. Full PDF retrieval was not attempted here. This fact was read in the primary-domain search excerpt. A cool, diffuse lighting option is an artistic interpretation, not a claim that Bogotá is always overcast. [Secretaría Distrital de Salud, ASIS Bogotá 2023](https://www.minsalud.gov.co/sites/rid/Lists/BibliotecaDigital/RIDE/VS/ED/PSP/asis-bogota-2023.pdf).

### Cartagena and the Caribbean coast

The Cartagena botanical garden's own permanent-plot census documents tropical dry forest near Cartagena, dominated by trees and shrubs with a smaller palm component. This is evidence against making all coastal vegetation coconut palms. It is one forest plot, not a citywide species-frequency estimate. [Jardín Botánico de Cartagena, Parcelas permanentes](https://data.jbgp.org.co/es/permanent-plots).

EPA Cartagena's press archive describes the shallow Ciénaga de la Virgen and red, black, and white mangroves at its water-land boundary. This supports a lagoon-edge motif, distinct from an inland dry-forest patch. The archive uses some misspelled scientific names, which this brief does not reproduce. [EPA Cartagena, Ciénaga de la Virgen](https://epacartagenaambienteurbano.wordpress.com/tag/cienaga-de-la-virgen/).

IDEAM's historical Rafael Núñez station table shows warm monthly means and a marked difference between dry and wetter months. It supports a sunny coastal treatment and optional seasonal dryness. The page is dated 2000 and is not a current climate-normal estimate. [IDEAM, Cartagena monthly values](https://bart.ideam.gov.co/cliciu/cartage/tabla.htm).

## Applied recommendations for Barrio

Here, "applied" means tailored to the inspected source. None has been implemented. Low complexity means existing parameters or selection logic. Medium means a new prop family or decoration placement. High means a new renderer subsystem.

### 1. Carry Salento vegetation beyond the starter

Source basis is [Los Nevados](https://www.parquesnacionales.gov.co/nuestros-parques/parque-nacional-natural-los-nevados/) and the [guadua study](https://revistas.unicauca.edu.co/index.php/biotecnologia/article/view/610). The observed problem is the `inicio` restriction in `tiles.ts`. Select occasional tall, pale, straight wax palms on suitable nature sectors throughout Salento. Add a compact guadua clump with narrow stems and grouped leafy tips as an alternative to the round tree. Use the existing `decorate` clearance checks.

Complexity is medium. Expected visual gain is high because silhouettes identify the region after expansion. Runtime cost is additional cached geometry families and batches, plus their triangles and shadows. Replace some existing trees rather than adding to every sector.

Verify with seed 1 at the starter and after 30 autoplay placements. Capture a forest close-up and a normal play view. Confirm palms occur outside the starter, guadua reads as a clump, and existing walk-clearance and tile-bound tests still pass.

### 2. Show coffee cultivation as small patches

Source basis is [UNESCO](https://whc.unesco.org/en/list/1121). The observed problem is uniform meadow ground and generic shrubs. On selected free Salento nature sectors, arrange low dark-green shrub forms in short curved rows. Leave gaps and neighboring forest patches. Use shared row-piece geometries and a restrained ground color beneath them. This is a stylized crop cue, not a botanical model or new productive tile type.

Complexity is medium. Expected visual gain is high at neighborhood scale. Runtime cost is a bounded set of row instances and geometry variants. No extra material or animated crop simulation is needed.

Verify a seed-1 developed screenshot at normal zoom and mobile width. Rows must remain readable without resembling path ribbons. Extend decoration-clearance coverage to the new crop parts. Confirm elevations and playable edges remain identical.

### 3. Give Medellín broad green crowns and selective flowering

Source basis is [Medellín's environmental secretariat](https://www.medellin.gov.co/es/?p=498850). The observed problem is one crown family and the unreachable yellow bloom selection. Keep green broadleaf crowns dominant. Select bounded yellow and pink guayacán-inspired variants explicitly, with broader, irregular canopy masses. Treat bloom as a seeded visual choice, not a real-time calendar event.

Complexity is low to medium. Expected visual gain is medium to high. Runtime cost can stay close to the existing tree count and geometry budget if variants reuse comparable blob counts. Extra unique geometries can still create extra batches.

Verify seed 2 developed in afternoon and daylight. Yellow and pink accents should appear among green trees without making the forest an autumn palette. Check cached geometry reuse and compare independently composed instances of each selected variant.

### 4. Give Bogotá an Andean tree and shrub mixture

Source basis is [the botanical garden's native restoration list](https://jbb.gov.co/las-nineras-de-las-plantas-nativas-del-vivero-las-mercedes/) and [Eastern Hills ecology](https://www.ambientebogota.gov.co/es/cerros-orientales1). The observed problem is the same generic forest tree after a starter distinguished partly by a bench. Use compact, irregular encenillo-inspired crowns and lower dense shrubs with restrained deep green, olive, and cool green variation. Species names guide abstraction, not botanical-identification claims.

Complexity is medium. Expected visual gain is high in forest patches. Runtime cost is a few shared crown and shrub geometries. Substitute these for existing parts. Retain the current building models.

Verify seed 4 developed at normal and close zoom. The region should differ through vegetation even with buildings out of frame. Run the bounds and path-occlusion tests with the new decoration names included in their classifier.

### 5. Separate Cartagena's dry ground from its lagoon edge

Source basis is the [botanical garden census](https://data.jbgp.org.co/es/permanent-plots) and [EPA's mangrove account](https://epacartagenaambienteurbano.wordpress.com/tag/cienaga-de-la-virgen/). The observed problems are starter-only coconut palms, generic upland forest, and identical water dressing. Use scattered palms among broadleaf trees on dry land. Place low mangrove-inspired crowns with a few visible supporting roots only beside existing low, flat water sectors. Keep water ribbons and edge endpoints intact. Such sectors are a visual approximation of lagoon habitat, not inferred salinity data.

Complexity is medium. Expected visual gain is high. Runtime cost is new cached tree and root geometry. Avoid transparent leaf planes, water reflections, and extra water passes. If mangrove eligibility needs inputs absent from `TileSite`, pass renderer context explicitly rather than changing core rules.

Verify seed 3 developed with a water close-up. Roots must meet the bank without filling the channel. Check no mangroves appear on dry sectors and no coastal treatment alters water seams, falls, paths, or legal placements.

### 6. Make ground color masses carry the region

Source basis is [UNESCO's cultivation mosaic](https://whc.unesco.org/en/list/1121), [Bogotá's ecological variation](https://www.ambientebogota.gov.co/es/cerros-orientales1), and [Cartagena's dry forest](https://data.jbgp.org.co/es/permanent-plots). The observed problem is small regional meadow shifts over one shared treatment. Use large restrained color patches. Give Salento deeper cultivated greens, Bogotá cooler grass and dark shrub patches, Medellín green slopes with exposed earth, and Cartagena dry grass beside darker wet banks. These exact colors are art direction.

Complexity is low to medium. Expected visual gain is high across the screen. Runtime cost can be negligible in draw calls if colors are baked into existing ground vertices. Shared boundaries must sample the same color field. Keep the flat tile tops and seam positions unchanged.

Verify four developed views with vegetation hidden for diagnosis, then visible for acceptance. Repeat on low quality, where shader patterns are disabled. Ground seam, flat-top, and retaining-wall tests must continue to pass.

### 7. Distinguish atmosphere without obscuring the board

Source basis is [Los Nevados' cloud forest](https://www.parquesnacionales.gov.co/nuestros-parques/parque-nacional-natural-los-nevados/), [Aburrá's atmospheric setting](https://www.metropol.gov.co/ambiental/calidad-del-aire/Biblioteca-aire/Estudios-calidad-del-aire/Escenario-contaminacion-atmosferica.pdf), [Bogotá's mountain climate](https://www.minsalud.gov.co/sites/rid/Lists/BibliotecaDigital/RIDE/VS/ED/PSP/asis-bogota-2023.pdf), and [IDEAM Cartagena](https://bart.ideam.gov.co/cliciu/cartage/tabla.htm). The observed problems are afternoon-only regional sky shifts and fixed fog distances. Compose regional settings with every time preset. Try pale cloud-filtered Salento, depth-separated Medellín, cooler diffuse Bogotá, and clearer warm Cartagena. Keep foreground contrast and placement ghosts readable.

Complexity is low. Expected visual gain is medium. Runtime cost is parameter changes and occasional gradient regeneration. Reuse the existing fog and hemisphere light. No volumetrics, moving cloud particles, or continuous weather loop.

Verify each region in all three light presets at the same camera pose. Include low quality and a placement ghost. Do not use globally reduced exposure to simulate cloudy weather. Check repeated preset switching does not grow texture counts after warm-up.

### 8. Add regional terrain context only if the first pass needs it

Source basis is [UNESCO's coffee hills](https://whc.unesco.org/en/list/1121), [AMVA's valley topography](https://www.metropol.gov.co/ambiental/calidad-del-aire/documents/pigeca/pigeca-aprobado-dic-2017.pdf), [the Eastern Hills](https://www.ambientebogota.gov.co/es/cerros-orientales1), and [EPA's coastal water system](https://epacartagenaambienteurbano.wordpress.com/tag/cienaga-de-la-virgen/). The observed problem is an empty gradient beyond the diorama. Optional noninteractive low-poly silhouettes can suggest coffee ridges, opposing Aburrá slopes, a Bogotá ridge on one world-space side, or a low coastal horizon. Keep them visually separate from legal frontier cells.

Complexity is medium to high because growth, orbit, and picking need handling. Expected visual gain is medium and uncertain at the normal downward camera angle. Runtime cost is additional triangles and draw calls. Static opaque meshes without shadows are preferable to alpha layers. Defer this until regional props and colors have been reviewed.

Verify a full camera orbit, maximum zoom-out, mobile portrait, and a developed board. Background geometry must not cover frontier markers or receive gameplay raycasts. Confirm core elevation snapshots are unchanged.

## Determinism, painterly treatment, and acceptance

Use the current seeded integer `random` helper. Derive independent visual choices from region, coordinates, existing tile variation, and a named salt per purpose. Avoid one global generator whose output depends on tile traversal. Do not consume the Rust deck or reward streams. If stronger run-specific variation requires the run seed, pass it through renderer context and include it in relevant cache identities.

Canonicalize variant inputs before both cache lookup and geometry construction. The existing palm cache key uses `variation % 3`, but its constructor receives the full variation. That is a source-level cache collision risk if reused across multiple palm-bearing tiles. A new persistent regional system must not let the first tile rendered choose the shared palm's shape. Compare fresh kits composing the same tile set in opposite orders, including variants 0 and 3. Compare transformed geometry, colors, and surface attributes by tile, not insertion order or object IDs.

For a painterly result, first change canopy silhouettes, clustered spacing, and broad vertex-color masses. Keep irregularity deterministic. Use the current foliage surface for restrained detail. An extra full-screen paint filter would affect buildings and add fill cost, so it is outside this brief. Low-quality screenshots must retain regional identity without procedural patterns.

Preserve `decorate` and expand [the existing decoration-clearance test](../../web/tests/tiles.test.ts) when adding names. Its current regular expression recognizes existing tree, shrub, palm, bench, lamp, rock, and bougainvillea keys. Unrecognized new species keys could silently escape that test. Keep [ground seam tests](../../web/tests/ground.test.ts), cached geometry reuse, and tile geometry budgets as acceptance gates.

The existing [capture script](../../tools/capture.mjs) provides starter seeds 2 for Medellín, 1 for Salento, 4 for Bogotá, and 3 for Cartagena. Confirm each snapshot's region before comparison. Capture starter, developed board, forest detail, and water detail at a fixed pose and viewport. Starter-only shots cannot prove recommendation 1. Use the debug API's `autoplay`, `focus`, `view`, and `light` controls for developed captures. Record actual placements because autoplay can finish a run early.

After implementation, run `npm test -- web/tests/tiles.test.ts web/tests/ground.test.ts web/tests/batches.test.ts` and the existing gameplay screenshot suite. Compare fixed-seed command replays before and after for unchanged gameplay snapshots. For performance, compare matching board states, viewport, quality, device, and renderer. Record `drawCalls`, `triangles`, `cachedGeometries`, `batchCount`, `reconcileMs`, and memory after repeated rebuilds. Do not infer runtime cost from triangles alone or transfer SwiftShader timings to hardware GPUs.

Preferred order is persistent regional vegetation, ground masses, atmosphere, then optional distant terrain. The Type System Discipline principle favors the existing `Region` union with a complete region profile rather than string checks spread across new generators. The Prove It Works principle limits this report to source observations and identified evidence. New visual gains remain predictions until the named captures and behavior checks are run.
