# Barrio Builder strategy redesign

Status: research complete, Phase 1 (hexagonal foundation) implemented. Recorded 2026-10-21.

This document records what four parallel research and audit tasks found, what was decided because of each finding, how Phase 1 implements those decisions, and what the later phases must deliver. Every finding maps to a code change, a test, or an explicit decision. Findings that only apply to later phases are recorded as decisions with the file or constant they will change.

## Contents

1. [Baseline](#1-baseline)
2. [Gameplay research](#2-gameplay-research)
3. [Visual research](#3-visual-research)
4. [Colombian geography](#4-colombian-geography)
5. [Technical architecture](#5-technical-architecture)
6. [Risks](#6-risks)
7. [Acceptance criteria by phase](#7-acceptance-criteria-by-phase)
8. [Phase 1 report](#8-phase-1-report)

## 1. Baseline

Recorded before any change, on the clean tree at commit `0c9fdc5`.

| Area | Baseline |
| --- | --- |
| Rust tests | 19 passed (2 unit tests in `world.rs`, 17 API tests in `tests/api.rs`) |
| Vitest | 23 passed in 4 files |
| Playwright | 9 passed, including 2 pixel baselines |
| Starter scene, low tier | `renderMs` median 528 ms and 589 ms in two runs (load 2.5 and 5.4), 84 draw calls, 196,191 triangles, 157 structures |
| Starter scene, high tier | 783 ms (load 4.4) |
| Starter build | about 600 ms of scene construction, 4.3 s to ready |
| Core, release WASM in Node | starter world 0.18 ms, snapshot 0.53 ms (37 KB, mostly 1,024 cells), 1,024-structure benchmark 1.25 ms |
| 500-structure stress scene | 1,313 ms low tier, committed in `docs/benchmarks/ab/` |

The host has no GPU. All render numbers are SwiftShader software rasterization and are valid only for A/B comparison on this host ([performance notes](performance.md)).

## 2. Gameplay research

### Findings

Sources are fan guides, reviews and interviews. No first-party rule reference for Dorfromantik was available (the official wiki returned HTTP 402), so its numbers are unverified and none are copied.

- **Dorfromantik.** You draw a tile from a stack, rotate it, and place it beside existing tiles. Rivers and rails must connect; other terrain may mismatch and simply scores less ([whatsericplaying](https://whatsericplaying.com/2024/01/01/dorfromantik/), [Pegasus board game](https://pegasus.de/en/Dorfromantik-The-Board-Game-Game-of-the-Year-2023/51240E)). A placement where all six edges match lights up and adds tiles ([Gamequarter](https://www.gamequarter.be/reviews/dorfromantik/), [gamepretty](https://gamepretty.com/dorfromantik-beginners-guide-quests-rewards-tile-placement/)). Quests give tiles; a failed quest costs nothing. The run ends when the stack is empty ([Steam](https://store.steampowered.com/app/1455840/Dorfromantik/)). The team set out to make "something to unwind with after a stressful day" ([GOG interview](https://gog.com/news/binterview_toukana_interactive_tells_us_more_about_dorfromantikb)).
- **Islanders.** Each building scores from what lies within its radius, shown live before placing. Effects are asymmetric: mansions lose points near circuses, walls gain from mansions. Score thresholds unlock a choice of two building packs ([Games Asylum](https://www.gamesasylum.com/2021/09/02/islanders-console-edition/), [Indie Hell Zone](https://indiehellzone.com/2020/07/21/islanders/)).
- **Mini Metro and Mini Motorways.** Limited network pieces, a weekly choice of two upgrades, and a network that becomes harder to manage as it grows ([Mini Motorways](https://en.wikipedia.org/wiki/Mini_Motorways), [Giant Bomb interview](https://giantbomb.com/users/3929/articles/interview-peter-curry-co-creator-of-mini-metro)).
- **Townscaper** has no goal and is "more of a toy than a game" ([Bloomberg](https://www.bloomberg.com/news/articles/2020-07-24/the-video-game-where-you-build-an-empty-town)). That is the failure mode of the current Barrio sandbox.
- **Carcassonne, Kingdomino, Cascadia.** Completed features score during play ([Carcassonne](https://en.wikipedia.org/wiki/Carcassonne_(board_game))). Region size multiplies value ([Kingdomino](https://en.wikipedia.org/wiki/Kingdomino)). Largest habitat corridors score, and scoring cards vary per game ([Cascadia](https://en.wikipedia.org/wiki/Cascadia_(board_game))).

What makes them enjoyable: tiles are both score and clock; failure is soft; outcomes are previewable before committing; a few hard constraints sit inside a forgiving system; asymmetric adjacency removes any universally good spot.

### Decisions

| Finding | Decision | Where |
| --- | --- | --- |
| A few hard constraints inside a soft system | Four edge types: `green`, `path`, `built`, `water`. Only two rules refuse a placement: water must meet water or a green bank, and two paths cannot join across a two-level cliff. Everything else is allowed and scored. | `crates/barrio-core/src/tile.rs` `meet`, tests `streams_only_continue_into_streams_or_green_banks`, `paths_connect_across_one_terrace_but_not_a_cliff`, `meeting_rules_are_symmetric` |
| Natural neighbors should not count as mismatches | Three grades: `match` (same type), `fit` (path with house front, stream with garden), `clash` (anything else). | `tile.rs` `Meet`, board test `clean_placement_needs_every_touching_edge_to_belong` |
| Perfect placement as a payoff moment | `clean`: every touching edge matches or fits. `perfect`: all six sides touch tiles and are clean. Phase 1 shows both and plays a chime; Phase 2 attaches tile rewards. | `board.rs` `Placement`, test `perfect_placement_closes_a_ring_of_six_fitting_neighbors`, `web/src/sound.ts` `perfect` |
| Previewable outcomes | The preview reports all six sides, the neighbor edge, rise, grade, and which rotations are valid. The ghost colors each edge. | `board.rs` `evaluate`, `lib.rs` `preview` with `validRotations`, `web/src/render/world.ts` `showGhost` |
| Networks are the strategic core of Mini Metro and Motorways | Paths form networks across tiles; stairs join them across one terrace. Phase 1 reports networks, the largest network, and homes joined to the chapel. | `board.rs` `networks`, `stats`, test `networks_follow_shared_path_edges_and_stairs` |
| Undo must not become a redraw | The tile supply is a pure function of seed and draw index. Undo restores the board and the draw count together. | `deck.rs` `draw`, API test `undo_restores_the_board_and_the_hand_so_tiles_cannot_be_redrawn` |
| Tiles as score and clock (Phase 2) | Finite deck of 24 drawn tiles plus the opening. Rewards: +1 tile for a clean placement touching three or more tiles, +1 more for a perfect one, and `3 + floor(target / 5)` (at most 7) per objective. Tuning targets for greedy play: 0.80 to 0.90 tiles gained per tile placed over placements 30 to 100, with nothing above 1.05. | Phase 2: `deck.rs`, new `rules.rs` constants |
| Asymmetric adjacency (Phase 2) | Resources are computed from the board, never accumulated by waiting. Homes give Population only when joined to the network. A tienda next to green costs Nature but earns Community. A taller next to homes costs Community. Green regions score superlinearly. | Phase 2: new `economy.rs`, one fixture test per rule |
| Short and long goals (Phase 2) | Three deterministic objective archetypes: grow a green region to N tiles, join a landmark to the chapel network, close a block of house fronts within a size window. Failure has no penalty. | Phase 2: new `objectives.rs` |
| Soft failure | The run ends only when the deck is empty. No timers, no energy. | Phase 2 |
| Sweepable rules | Every number above is a named constant so a simulator can sweep it. | Phase 2 and 5 |

The greedy player in `play.rs` (`best_move`) is the first of three planned simulation bots. Phase 2 adds `random_legal` and an objective-aware planner. Their metrics are listed under [Risks](#6-risks).

## 3. Visual research

### Findings

Toukana built mood boards from landscape painting and photography and aimed for "an ideal and harmonic interpretation of the real-world landscapes" with a "painted look and haptic aesthetics" that resemble board games ([Game Developer interview](https://www.gamedeveloper.com/business/sparking-joy-through-tile-placement-in-idyllic-village-builder-i-dorfromantik-i-)). The team cites impressionist landscape painting, wooden toys, and Islanders ([GameBusiness.jp](https://www.gamebusiness.jp/article/2022/05/18/20112.html)). No published palette values or shader details exist. Townscaper's coherence comes from a small palette chosen up front ([MCV](https://www.mcvuk.com/business-news/when-we-made-townscaper/)). Catlike Coding's hex map tutorial gives a standard blend: a solid core at 75% of the radius, bridges that grade into the neighbor's color, and three-color averages at corners ([Hex Map 2](https://catlikecoding.com/unity/tutorials/hex-map/part-2/)).

Diagnosis of the current look, from screenshots and code:

1. Grass `#96b47f` under a warm sun reads close to lime, and the shader varies it by only ±7%.
2. `terracotta #b5603f`, `brick #b8613f` and `burntOrange #c9733a` are nearly identical, so clusters merge into one orange mass. `PLASTER` has 13 entries and no white anchor.
3. The outer soil `#a8643f` and the dark base slab form a heavy red-brown band.
4. Fog starts at 60 units with the camera about 54 units away, so there is almost no atmospheric depth.
5. Trees alternate two saturated greens, evenly spread.
6. There is no water to balance the warm palette.
7. Brand Blue and Coral do not appear in the world. That is correct and stays so.

### Decisions

| Finding | Decision | Where |
| --- | --- | --- |
| Hex blending recipe | Each tile top has a solid core at 70% of the radius. Outer corners average the tones of every tile at the same level that shares them. Tiles at different levels never blend; a wall separates them. | Phase 1: `web/src/render/ground.ts` `groundGeometry`, Vitest ground tests |
| Muted landscape palette, candidate A "Sage valley" | New ground tones: meadow `#94a679`, light `#adbb8c`, low `#7d9168`, lawn `#a2b47f`, forest floor `#7f9468`. Skirt gradient `#b8946c` → `#977656` → `#6d5848`, replacing the dark slab. Retaining stone `#bdb3a1`, coping `#d3cbbb`, walkway `#cdbd9d`, water `#6fb7b4` with foam `#eaf2ea`. | Phase 1: `web/src/render/palette.ts` |
| Heavy base band | Exposed sides reach a shared base a fixed 0.9 units below the lowest tile, so the island has one consistent depth that follows the neighborhood. | Phase 1: `hex.ts` `SKIRT`, `ground.ts` |
| Earth banks vs masonry | Terraces meeting at house fronts or paths get stone walls with coping. Gardens meeting gardens get a planted earth bank. | Phase 1: `ground.ts` side loop |
| No water | Streams (`quebrada`) are a tile kind with their own hard rule and a water surface with a foam rim. | Phase 1: `tile.rs`, `tiles.ts`, `material.ts` surface 16 |
| Plaster palette | Replace the 13-entry `PLASTER` list with nine colors weighted 35% light, 35% warm, 30% cool, whitewash at double weight. Separate terracotta from brick. Brick on under 25% of buildings. | Phase 3: `palette.ts` `PLASTER`, `TRIM`, `architecture.ts` `style` |
| Tree uniformity | Three crown tones (`crownLight`, `crownMid`, `crownDeep`, added in Phase 1 and used by shrubs) chosen per tree; trees in clusters of 3 to 7; density falling toward non-forest edges. | Phase 1 partial: `tiles.ts` forest sectors. Phase 3: `models.ts` `tree` |
| Atmosphere | Fog near and far computed from camera distance and island radius; a height fade toward the horizon color; `sun.shadow.intensity = 0.7`. | Phase 3: `lighting.ts`, `material.ts` |
| Brand accents | Brand Blue and Coral stay under 3% of world pixels: placement feedback, objective markers, some trim. The edge markers use Hillside Green `#168667` for joined edges and Coral `#F05D50` for forbidden ones. | Phase 1: `world.ts` `MEET_COLORS`. Phase 3: `TRIM` |

Phase 1 changes only the ground, skirt, path, stair and water colors. Building plaster, trees, lighting and fog are Phase 3, so visual comparisons can separate the two changes.

## 4. Colombian geography

### Findings

| | Medellín, Aburrá Valley | Eje Cafetero, Salento | Cartagena, Caribbean coast | Bogotá, Eastern Hills |
| --- | --- | --- | --- | --- |
| Terrain | Valley floor about 1,495 m; comunas climb the sides; quebradas cut down to the river ([Medellín](https://en.wikipedia.org/wiki/Medell%C3%ADn), [Alcaldía](https://www.medellin.gov.co/es/sala-de-prensa/noticias/medellin-celebra-los-168-anos-de-su-arbol-mas-antiguo-una-ceiba-en-la-playa-que-es-huella-viva-de-la-historia-de-la-ciudad/)) | Town at 1,895 m on a plateau above the Quindío valley; Cocora 1,800 to 2,400 m ([Salento](https://en.wikipedia.org/wiki/Salento,_Quindío), [Cocora](https://en.wikipedia.org/wiki/Cocora_Valley)) | About 2 m; bay, Ciénaga de la Virgen lagoon with mangroves; La Popa about 150 m ([Cartagena](https://en.wikipedia.org/wiki/Cartagena,_Colombia), [El Universal](https://www.eluniversal.com.co/cartagena/2026/05/20/siembran-3000-mangles-en-la-boquilla-para-recuperar-la-cienaga-de-la-virgen/)) | Flat Sabana at 2,640 m against hills rising to 3,550 m ([Bogotá](https://en.wikipedia.org/wiki/Bogot%C3%A1), [Eastern Hills](https://en.wikipedia.org/wiki/Eastern_Hills,_Bogot%C3%A1)) |
| Climate | About 22 °C, 2,238 mm rain, two wet seasons | About 17 °C, cloud forest and mist | About 30 °C, Aw, 1,074 mm | About 13 °C, Cfb, often overcast |
| Vegetation | Yellow and pink guayacán, mango, urapán; ceibas on quebradas ([El Colombiano](https://www.elcolombiano.com/medellin/guayacanes-florecieron-en-medellin-a-pesar-de-las-lluvias-FG33242430)) | Wax palm, the national tree ([Bernal & Sanín](https://revistas.udistrital.edu.co/index.php/colfor/article/download/3959/5891/17578)); guadua; coffee under plantain shade | Bougainvillea, mangroves, coconut palms ([ANI](https://www.ani.gov.co/w/gobierno-nacional-ratifica-conservaci%C3%B3n-de-ci%C3%A9naga-de-la-virgen-con-siembra-masiva-en-34-hect%C3%A1reas-de-manglar)) | Páramo with frailejones above 3,000 m; planted eucalyptus and pine ([El Espectador](https://www.elespectador.com/bogota/mitos-sobre-los-pinos-y-eucaliptos-en-los-cerros-orientales-article-704027/)) |
| Settlement | Dense self-built hillside reached by stairs; upgrades added walkways, lookouts, Metrocable (2004) and the Comuna 13 escalators (2011) ([Holcim Foundation](https://holcimfoundation.org/projects/urban-integration-of-an-informal-area-medellin), [Metrocable](https://en.wikipedia.org/wiki/Metrocable_(Medell%C3%ADn))) | Grid around Plaza de Bolívar; 250 steps to the Alto de la Cruz mirador; dispersed fincas in the UNESCO coffee landscape ([Coffee Cultural Landscape](https://en.wikipedia.org/wiki/Coffee_Cultural_Landscape_of_Colombia)) | Walled city with compact blocks around plazas; Getsemaní; informal growth around the lagoon | La Candelaria colonial grid; southern and eastern hills largely self-built ([ZEF](https://blog.zef.de/?p=8805)) |
| Architecture | Brick with zinc roofs; unreinforced masonry with heavy concrete slabs ([Kavilando](https://www.ojs.kavilando.org/index.php/kavilando/article/download/30/19/82)) | Bahareque, a guadua and timber frame filled with earth, cited for the UNESCO inscription ([UNAL](https://bffrepositorio.unal.edu.co/server/api/core/bitstreams/ad21346a-ac8c-4cc1-88f9-90879603f1c5/content)); colorful balconies ([colombia.travel](https://colombia.travel/en/salento)) | Patio houses; the two-storey casa alta with a timber street balcony ([Barrera](https://100libroslibres.com/alvaro-barrera-arquitectura-y-restauracion-la-casa-colonial-cartagenera)); pastel colonial facades | Exposed red brick from Sabana clay, from popular barrios to Salmona ([Bloomberg Línea](https://www.bloomberglinea.com/2023/03/26/la-revolucion-del-ladrillo-en-bogota-como-este-material-democratizo-la-visual-de-la-ciudad/)); Candelaria courtyard houses with clay-tile roofs ([Monocle](https://monocle.com/travel/la-candelaria-bogota-colombia-guide/)) |

Some widely photographed details had no written source: Medellín's exposed-brick prevalence and rebar stubs, Salento's white walls with saturated trim, Cartagena's coral stone. They are marked uncited and treated as lower-confidence input.

Comuna 13's murals and public infrastructure belong to a history of community organizing. Following [BRAND.md](../BRAND.md), the game draws on the architecture without copying murals or reducing that history to decoration.

### Decisions

All regions share the same rules, tile kinds and edge types. Regions change only terrain parameters, ground palette, building material mix, vegetation set and the opening landmark.

| Parameter (Phase 4, `terrain.rs` and a new `region.rs`) | Medellín | Salento | Cartagena | Bogotá |
| --- | --- | --- | --- | --- |
| Levels used (0 to 7) | 2 to 7, one-sided valley slope | 2 to 6, rounded ridges | 0 to 2, La Popa variant up to 4 | 2 flat, rising to 6 or 7 at one edge |
| Slope per tile | 0.42 (Phase 1 value) | 0.3 with stronger relief | 0.05 | 0.05, then 0.8 near the hills |
| Water | 1 or 2 quebradas | river valley and streams | lagoon edge, 25 to 40% of tiles may be water | 1 or 2 narrow streams |
| Building mix | 65% exposed brick, 25% painted, 10% block | 70% bahareque or plaster with saturated trim | 55% lime plaster, 30% block, 15% timber | 60% exposed brick, 25% whitewashed adobe, 15% block |
| Vegetation | guayacán (yellow, pink), mango, banana | wax palm, guadua, coffee rows | coconut palm, almendro, bougainvillea, mangrove | eucalyptus, pine, frailejón on top levels |
| Opening landmark | Metrocable station with a stair segment | plaza church or a finca | balconied casa alta by a rampart | Candelaria chapel |

Phase 1 implements one hillside generator, `hex-hillside-v1`, tuned for Medellín: levels 0 to 7, about one terrace every two and a half tiles, seeded relief, and a chapel opening. Phase 4 adds the other three as new generator identifiers so existing saves never change shape.

## 5. Technical architecture

### Audit summary

The Rust core is a deterministic 32 × 32 square grid: `terrain.rs` (fixed arrays, four-neighbor smoothing), `world.rs` (rectangular footprints, flat-terrace rule, stair facing), `catalog.rs` (width and depth per kind). Three.js renders an orthographic miniature through `StructureBatches`, which instances every repeated geometry. The building generator `architecture.ts` builds rectangular houses from a shape grammar. The square-grid assumption ran through the Rust core, the terrain mesh, picking, the camera limits, the controller, the UI palette and every test.

| Subsystem | Verdict | Outcome in Phase 1 |
| --- | --- | --- |
| Renderer setup, quality tiers, shared material, `Builder`, `StructureBatches` | Retain | Unchanged except a water surface |
| Building generator `architecture.ts` | Retain and wrap | Unchanged. Houses are built as 1 × 1 lots and placed two to four per tile at 0.78 scale |
| Lighting | Retain, small refactor | `Lighting.frame` refits the shadow volume as the neighborhood grows |
| Camera and controls | Refactor | Frames the tiles' bounds; sixth-turn rotation; pan limited to the neighborhood |
| Square terrain mesh and picking | Replace | `ground.ts` and an instanced hex picking disc |
| Rust terrain, world, catalog | Replace | `hex.rs`, `tile.rs`, `terrain.rs`, `board.rs`, `deck.rs`, `play.rs` |
| `lib.rs` Game, history, save validation | Refactor | Same JSON command boundary, history and atomic load; new state and save version |
| Square decor (`decor.ts`), contact sheet (`thumbnails.ts`), `ModelLibrary` | Remove | Removed; see limitations |
| UI shell, toasts, dialogs, persistence, sound, input | Retain | Building palette replaced by the tile hand |

No new framework was introduced.

### Hex geometry

- **Orientation: flat-top.** Edge `i` faces the neighbor `DIRECTIONS[i]` along `30° + 60° i` from +X toward +Z. Rotating a tile one step moves edge `i` to `i + 1`.
- **Coordinates: axial `(q, r)`,** with the cube coordinate `s = -q - r` used for distance and rotation. World position for circumradius `s`: `x = 1.5 s q`, `z = √3 s (r + q/2)` ([Red Blob Games](https://www.redblobgames.com/grids/hexagons/)).
- **Camera.** The orientation was chosen after rendering both default azimuths (screenshots `02-after-20`, corner-on, and `06-edge-view`, edge-on, of the same neighborhood). Looking straight across an edge showed retaining walls head-on but flattened house facades into single planes, because houses face edge normals. Looking along a corner (azimuth 30°) turns every wall and facade 30° to the viewer, so buildings show two faces and the island's skirt reads as a faceted diorama. The home view is corner-on. View rotation is in sixth turns so that relation never changes. The tile drawings in the hand turn with the camera.
- **Scale.** Circumradius 2 world units, terrace height 0.6. A 1 × 1 house at 0.78 scale fits in each of the six sectors without crossing the hex boundary.

The flat-top geometry is identical in `crates/barrio-core/src/hex.rs` and `web/src/render/hex.ts`. Tests on both sides check the edge-normal angles, neighbor distances and rotation.

### Tile model

A placed tile stores `q`, `r`, `kind`, the six edges as drawn, `rotation` and a visual `variation`. Everything else is derived:

| Layer | Source |
| --- | --- |
| Terrain type | `kind` (ground tone and vegetation density) |
| Elevation | the seeded hillside at `(q, r)`; tiles never change the ground |
| Six edge types | `edges` rotated by `rotation` |
| Structures | houses on `built` edges, a shop on the first `built` edge of a tienda, the chapel on a capilla |
| Vegetation | trees and shrubs on `green` edges, dense on monte |
| Paths and infrastructure | ribbons on `path` edges, a hub, stairs where a path climbs one terrace, dead-end planters |
| Resource effects | Phase 2, computed from kind, edges and networks |
| Landmarks | `capilla` in Phase 1; regional landmarks in Phase 4 |
| Decoration seed | `variation`, a hash of seed, position and placement order |

A tile is not one house. A casas tile carries two to five houses.

Kinds: `casas`, `tienda`, `plaza`, `parque`, `monte`, `quebrada`, `sendero`, and the opening landmark `capilla`. Each kind has a few edge templates; the supply mirrors half its draws so asymmetric templates come in both hands.

### Placement rules

`Board::evaluate` is the only placement check, shared by preview, placement, save validation and the simulation player. In order:

1. Rotation is 0 to 5.
2. The hex is inside the world disc (radius 14, 631 hexes).
3. The hex is empty.
4. The hex touches at least one tile (the first tile may go anywhere).
5. No touching edge pair is forbidden: water against a path or house front, or two paths across a two-level cliff.

Each rule has its own explanatory message, shown at the pointer.

### Elevation

The hillside is a seeded heightfield over the whole disc, levels 0 to 7, smoothed so neighbors differ by at most two levels. A one-level difference is a terrace: paths join it with stairs, which the renderer places on the lower tile. A two-level difference is a cliff: paths cannot join it, though gardens and houses may sit beside it. Placing a tile reveals the ground at that spot; the ground never changes.

### Connectivity

Two neighboring tiles are linked when both touching edges are paths and their elevations differ by less than two. A tile's own path edges always join at its center. Networks are found by breadth-first search in placement order, so network identifiers are deterministic. Homes count as joined when their tile is in the chapel's network.

### Supply

`deck::draw(seed, index)` is a pure function. The game stores only how many tiles were drawn, so the hand is reproducible, undo returns the same tile, and a save never has to store the deck. Phase 1 has an unlimited supply. Phase 2 adds a finite count and rewards without changing the world representation, which also keeps a future Creative mode possible.

### Save format and existing saves

- New saves are version 2: `{version, generator: "hex-hillside-v1", seed, draws, tiles[]}`, with tiles in placement order. Loading replays the neighborhood: the first tiles must equal the seed's opening, tile `n` after the opening must be supply draw `n`, each must pass `Board::evaluate` at the moment it was placed, its variation must match, and `draws` must equal the number of tiles placed. A hand-edited file therefore cannot invent tiles, rewind the supply, or bypass a rule. Loading is atomic: any failure leaves the current game untouched.
- Restoring the autosave on startup uses `Game::restore`, which starts with no history. Importing a file uses `Game::load`, which can be undone.
- **Version 1 square-grid saves are not converted.** A square terraced sandbox has no faithful mapping onto hex tiles with a supply and future resources; converting would invent game state. Importing one shows: "This neighborhood was built on the original square hillside. Barrio Builder now grows on hexagonal tiles, and square neighborhoods cannot be converted. Your file has not been changed."
- Storage keys moved to `barrio.autosave.v2` and `barrio.saved.v2`. The v1 keys are never read as games and never overwritten. If one exists, the menu offers "Download my square neighborhood", and a first-launch message explains where it went.
- Generator identifiers version the terrain. Any change to `Terrain::hillside` output needs a new identifier.

### Rendering

| Layer | Approach |
| --- | --- |
| Ground | One merged mesh rebuilt on each change (208 triangles for the opening, 1,606 at 55 tiles): blended tops, masonry or earth walls between terraces, a soil skirt to a shared base. No square slab remains. |
| Tile contents | `TileKit.compose` returns parts with shared, cached geometry. Each part goes through `StructureBatches`, so repeated houses, trees and path layouts are instanced. |
| Picking | One instanced hex disc per tile and frontier hex. |
| Frontier | Outline segments at each open hex's own elevation. |
| Preview | Translucent tile contents, a plinth, an outline, and a colored marker per touching edge. |
| Animation | The existing drop-and-settle with a hexagonal landing ring. |

The tile signature includes each neighbor's facing edge and elevation, so a tile rebuilds only when its stairs or dead ends change.

### Module map

| Concern | Rust | TypeScript |
| --- | --- | --- |
| Hex coordinates and neighbors | `hex.rs` | `render/hex.ts` |
| Tile kinds, edges, compatibility | `tile.rs` | `domain.ts` schemas, `rotateEdges` |
| Terrain | `terrain.rs` | `render/ground.ts` |
| Placement validation, networks, stats | `board.rs` | via `CorePort.preview` |
| Supply | `deck.rs` | hand tray in `ui.ts`, `tileArt.ts` |
| Opening and simulation player | `play.rs` | `autoplay` command |
| Game, history, save | `lib.rs` | `core.ts`, `controller.ts`, `persistence.ts` |
| Resources, objectives (Phase 2) | `economy.rs`, `objectives.rs` | objective and resource panels |
| Regions (Phase 4) | `region.rs` | region palettes |

## 6. Risks

| Risk | Detection | Mitigation |
| --- | --- | --- |
| Snowballing or endless runs (Phase 2) | Simulated replenishment ratio over placements 30 to 100: p95 for the planner under 1.05; p99 run length under 400 | Objective targets rise every 40 tiles |
| Runs that end too soon | Median greedy run at least 50 placements, random at least 30 | Tune starting deck and reward constants |
| Dead tiles: no legal placement | Count `no legal placement` events over 1,000 seeds. Phase 1: the greedy test places 60 tiles on three seeds without a dead tile, and openings always offer at least two spots | Phase 2: allow setting a tile aside for a small cost if the count is nonzero |
| Unreachable objectives | Completion rate per archetype in simulation; reachability check when an objective appears | Archetypes chosen from the board's current state |
| Dominant strategy | Planner vs single-resource bot; planner should win at least 80% of seeds | Balance bonus `3 × min(resources)` |
| Generator drift breaks saves | Golden-seed tests (`hillsides_are_deterministic_and_vary_by_seed`, opening reproducibility tests) | New generator identifier for any change |
| Render cost grows with trees | Triangles grow about 4,000 per tile, mostly tree crowns (422,192 at 105 tiles) | Phase 3: shared lower-detail crowns, fewer trees per forest sector; Phase 5: profiling with `tools/profile-layers.mjs` |
| Snapshot size | 1.5 KB at the opening, 9 KB at 55 tiles, 16 KB at 100 tiles (the square grid sent 37 KB) | Send static data once if it grows past 100 KB |
| Touch placement without hover | The first tap previews; a second tap on the same spot places | Covered in Phase 5 mobile tests |
| Cultural flattening | Review against the cited sources per region | Regions differ in more than color; no copied murals |

## 7. Acceptance criteria by phase

### Phase 1, hexagonal foundation

- [x] Axial grid with six-direction adjacency, tested in Rust and TypeScript.
- [x] Placement and six-step rotation with explained refusals.
- [x] Hex terrain rendering with continuous blended tops, walls, banks and stairs.
- [x] An irregular boundary that grows with the tiles, with no square slab or margin.
- [x] Unit tests for neighbors, edge rotation, placement validity, path connectivity, elevation constraints, supply reproducibility, opening reproducibility and save/load equivalence.
- [x] A playable demonstration with placeholder tiles.
- [x] Deliberate handling of existing saves.

### Phase 2, one complete strategic loop

- Finite deck, four resources computed from the board, three objective archetypes, tile rewards, score, and an end when the deck is empty.
- One fixture test per adjacency rule and objective; deck exhaustion test.
- Simulation over at least 1,000 seeds with three bots and the thresholds in [Risks](#6-risks).
- A full run, from new game to the ending, completed in the browser.

### Phase 3, environmental art direction

- Plaster, tree, lighting and fog changes from [Visual research](#3-visual-research).
- Before and after captures at gameplay zoom.
- Render cost no worse than Phase 1 at 55 tiles on the same host.

### Phase 4, Colombian regions

- Four presets with separate generator identifiers. Medellín is polished and validated first.
- Twenty seeds per region checked automatically: valid expansions, no overlapping structures, joined opening homes, valid starting objectives, and a captured contact sheet reviewed for balance.

### Phase 5, interface, polish and balancing

- Objective and resource panels, placement animation, tutorial for the first three decisions, sound, save migration notes, mobile placement tests, profiling, and balance from simulations.

## 8. Phase 1 report

### What changed

- **Rules (Rust).** The square grid was replaced by a flat-top hex world: axial coordinates, tile kinds with six edges, placement validation with two hard rules, a seeded hillside with terraces and cliffs, path networks with stairs, a seeded supply, a compact chapel opening, and a greedy player behind an `autoplay` command.
- **Rendering.** A continuous hex ground mesh, tile composition that reuses the existing houses, trees and material, stairs and streams, frontier outlines, hex picking, a ghost preview with edge markers, a corner-on camera with sixth-turn rotation, and shadow framing that follows the neighborhood.
- **Interface.** The building palette and remove tool are gone. The bottom tray shows the tile in hand, drawn as six edge sectors that turn with the camera, the next two tiles, rotate buttons, and the tile's name and description. The pointer note explains each refusal and suggests turning the tile when another rotation fits. The top chip shows tiles placed and homes joined to the chapel. Touch uses tap to preview and tap again to place.
- **Saves.** Version 2 saves and v2 storage keys; v1 saves are refused with an explanation and kept downloadable.

### Files

New: `crates/barrio-core/src/{hex,tile,board,deck,play}.rs`, `web/src/render/{hex,ground,tiles}.ts`, `web/src/tileArt.ts`, this document.

Rewritten: `crates/barrio-core/src/{lib,terrain}.rs`, `crates/barrio-core/tests/api.rs`, `web/src/{domain,core,controller,ui,main,persistence}.ts`, `web/src/render/world.ts`, `tools/{capture,benchmark,benchmark-core,verify-wasm}.mjs`.

Changed: `web/src/render/{lighting,material,palette,models}.ts`, `web/src/sound.ts`, `web/src/style.css`, `tools/profile-layers.mjs`.

Removed: `crates/barrio-core/src/{world,catalog}.rs`, `web/src/render/{terrain,decor,thumbnails}.ts`.

### Code review

An independent review of the Phase 1 change found six defects, all fixed with regression tests:

| Defect | Fix | Test |
| --- | --- | --- |
| After a reload, Undo replaced the restored neighborhood with the default opening and autosaved it | `Game::restore` for startup, with empty history | `restoring_an_autosave_leaves_nothing_to_undo`, controller test `restores the autosave without history` |
| A hand-edited save could contain any tiles, several chapels, or a rewound `draws` | Saves are replayed against the opening and the seeded supply | `saves_must_replay_the_seeded_supply` |
| Coordinates near the `i32` limits overflowed hex distance (a panic in debug builds) | Distance computed in `i64` | `previews_predict_the_placed_variation_and_survive_extreme_coordinates` |
| `draws` near the `u32` limit overflowed | Bounded by the replay rule | `saves_must_replay_the_seeded_supply` |
| The preview showed different houses and trees from the tile that landed | The core reports the variation a placement would receive | same as the coordinate test |
| The menu offered the older of two square saves | Prefer the square autosave | controller test `prefers the newer square-grid autosave` |

The review also led to clearing the touch "armed" spot whenever the board or rotation changes, separating storage errors from autosave errors, keeping forest trees inside their hex, and skipping empty path layers.

### Tests executed

| Suite | Command | Result |
| --- | --- | --- |
| Rust unit and API | `cargo test --workspace` | 39 passed (26 unit, 13 API) |
| Rust lint and format | `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all -- --check` | clean |
| WASM integration | `node tools/verify-wasm.mjs` | passed |
| TypeScript | `npx tsc --noEmit`, `npm run lint` | clean |
| Vitest | `npx vitest run` | 130 passed in 7 files: hex math, ground continuity, tile composition, controller, batching, input, and a 20-seed simulation of 50 placements each |
| Playwright on the production build | `npx playwright test` | 7 passed: place and undo, the hand tray, a refused spot, persistence across reload, camera turns, and visual baselines of the opening and a 55-tile neighborhood |

Coverage of the brief's test list: hex neighbors (`hex.rs`, `hex.test.ts`), edge rotation (`tile.rs`, `hex.test.ts`), placement validity and elevation constraints (`board.rs`, API tests), path connectivity (`networks_follow_shared_path_edges_and_stairs`), region seed reproducibility (opening and terrain determinism tests, simulation test), save and load equivalence (API and simulation tests). Resources, objectives and deck exhaustion are Phase 2.

### Screenshots

Captured from the production build with `tools/capture.mjs` into [`docs/screenshots/hex/`](screenshots/hex/). Each PNG has a JSON file of renderer metrics beside it.

| Shot | Shows |
| --- | --- |
| [01-opening](screenshots/hex/01-opening.png) | The seed 2026 Medellín-style opening: chapel, homes on its paths, a stream, and a path leading out |
| [02-after-20](screenshots/hex/02-after-20.png) | The same neighborhood after 20 placements |
| [03-fifty-tiles](screenshots/hex/03-fifty-tiles.png) | 55 connected tiles across six levels |
| [04-fifty-detail](screenshots/hex/04-fifty-detail.png) | Close view of retaining walls, stairs, banks, and houses on terraces |
| [05-gameplay-ui](screenshots/hex/05-gameplay-ui.png) | Normal play: the ghost tile with edge markers, the fit note, and the hand tray |
| [06-edge-view](screenshots/hex/06-edge-view.png) | The rejected edge-on camera, for comparison with 02 |
| [07-evening](screenshots/hex/07-evening.png) | The evening preset on 55 tiles |
| [08-mobile](screenshots/hex/08-mobile.png) | 390 × 844 layout |
| [09-other-seed](screenshots/hex/09-other-seed.png) | Seed 7 after 30 placements |

[`compare/hex-phase1.jpg`](screenshots/compare/hex-phase1.jpg) puts the previous full diorama beside the 55-tile hex neighborhood. A second geographical region is Phase 4.

### Measured performance

Production build, SwiftShader, 1440 × 900, pixel ratio 1, seed 2026 grown with autoplay. The host was shared, with a one-minute load average of 4.3 to 8.8 during the runs, recorded per scene in [`hex-scenes-low.json`](benchmarks/hex-scenes-low.json) and [`hex-scenes-high.json`](benchmarks/hex-scenes-high.json).

| Tiles | Render, low tier | Render, high tier | Draw calls | Triangles | GPU geometries | Scene build | Placement |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | 92 ms | 123 ms | 29 | 12,706 | 30 | 169 ms | 14.0 ms |
| 25 | 202 ms | 318 ms | 71 | 96,228 | 73 | 363 ms | 9.7 ms |
| 55 | 296 ms | 496 ms | 104 | 214,796 | 106 | 624 ms | 8.7 ms |
| 105 | 489 ms | 693 ms | 126 | 422,042 | 128 | 739 ms | 15.9 ms |

- **Render** is the median of `renderer.render` plus a one-pixel readback per frame. **Scene build** is the first full reconcile after growth. **Placement** is the place command through Rust validation, snapshot parsing and the synchronous scene update, low tier, excluding the next frame.
- **Hover preview** of one spot takes 0.1 ms. Draw calls grow with variety, not tile count, because repeated houses and trees are instanced.
- **Memory:** ten undo and redo cycles of five tiles left GPU geometry counts within 2 of the start, and the tile geometry cache did not grow.
- **Core in Node, release WASM** ([`core-wasm.json`](benchmarks/core-wasm.json), medians of 11 seeds): opening generation 0.16 ms, a preview of every frontier hex at all six rotations 1.27 ms, one placement 0.13 ms, 100 greedy placements 12.5 ms.
- **Against the baseline:** the old starter scene (157 structures, 196,191 triangles) rendered at 528 to 589 ms on the low tier. The 55-tile hex neighborhood has a similar triangle count and rendered at 296 ms. The scenes differ and the host load differed, so this is an indication, not a claim of speedup.
- **Not measured:** hardware GPU frame rates and physical mobile devices. This host has no GPU.

### Known limitations

- The supply is unlimited and there are no resources, objectives or score yet. That is Phase 2.
- Only the Medellín-style hillside exists.
- Square-grid street decor (motorcycles, poles, cables) and the building contact sheet were removed with the square grid. Phase 3 brings decor back on hex lots.
- Green-to-green terrace changes use a vertical planted earth bank, not a true slope.
- Streams are straight channels that end at the tile center when only one edge carries water; they do not yet flow down terraces.
- The greedy player leaves many small path networks. It shows the rules work, not good play.
- Render numbers come from a software rasterizer on a shared, loaded host.
- Triangles grow by about 4,000 per tile, mostly tree crowns. Forest-heavy neighborhoods past 100 tiles will need lower-detail crowns (Phase 3).
- The production bundle is 717 KB (195 KB gzipped) in one chunk; Vite warns above 500 KB.

### Next bounded step

Phase 2: add `economy.rs`, `objectives.rs` and a finite deck with tile rewards, all as pure functions of the board. Add the simulation harness with three bots, then the objective and resource panels. The world representation and save format gain fields but do not change shape.
