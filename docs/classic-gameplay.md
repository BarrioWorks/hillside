# Barrio Classic: gameplay specification

Classic is the strategy mode of Barrio Builder. It is played as a seeded run:
- **Start:** one settlement tile in a Colombian region.
- **Supply:** a finite deck. Quests add tiles to it.
- **Goal:** a high score. Victory comes at 6,000 points.

The Rust crate `crates/barrio-core` owns every rule. The Three.js client only draws and asks.

This document is the source of truth for rules and tuning. Each research finding below is tied to a code change, a test, or an explicit decision. When a balancing rule changes, this document changes in the same commit.

Contents:
1. [Phase 0: research and audit](#1-phase-0-research-and-audit)
2. [Rules, Milestone 1](#2-rules-milestone-1)
3. [Path construction](#3-path-construction)
4. [Quests, rewards, victory, and game over](#4-quests-rewards-victory-and-game-over)
5. [Milestone reports](#5-milestone-reports)

## 1. Phase 0: research and audit

Four subagents worked in parallel:
- **Gameplay research:** Dorfromantik's documented systems. Sources: Steam page, Wikipedia, a developer reply, fan guides, and player threads.
- **Technical audit:** the Phase 1 hex code.
- **Art direction:** a review of the in-engine screenshots and render code.
- **Balance:** a Python prototype that simulated 4,200 runs under the brief's numbers, then single-lever variants of 1,000 seeds each.

Their raw reports are summarized here. No Dorfromantik quest text, tile set, data file, or art was copied.

### Gameplay findings

| # | Finding (source) | Barrio decision | Where |
| --- | --- | --- | --- |
| G1 | Tiles touch at least one placed tile and rotate freely. Only rivers and rails must connect; other edges may mismatch at a lower score ([Steam](https://store.steampowered.com/app/1455840/Dorfromantik/), [developer reply](https://steamcommunity.com/app/1455840/discussions/0/4615641483009433506)). | Soft matching: any two dry edges may touch. Water must meet water, and dry land may not touch water. This is stricter than Dorfromantik, which lets lakes touch land. | `tile::meet`; tests `meeting_rules_are_symmetric_and_water_only_meets_water`, `soft_matching_allows_any_dry_edges_to_touch` |
| G2 | No river tile has exactly one water edge (developer reply). Players dump unusable river tiles on the rim ([thread](https://steamcommunity.com/app/1455840/discussions/0/5879990700802037174)). | Every template keeps a dry edge, and no template is all water. A single-edge spring exists because a stream may end open. | `tile::templates`; test `templates_are_well_formed` |
| G3 | Perfect placement means all six neighbors match (Wikipedia, [guide](https://gamepretty.com/dorfromantik-beginners-guide-quests-rewards-tile-placement/)). | +60 only when the placed tile has six neighbors and all six edges match. A neighbor that becomes complete later does not score again. | `Board::evaluate`; test `matches_score_once_and_perfect_needs_six_matching_neighbors` |
| G4 | Each matching side scores, and the score only rises (guide). | +10 per placement and +20 per new matching edge. Edges already matched are never counted again, because only the new tile's sides are evaluated. | `score::points`; Rust and web tests that preview equals award |
| G5 | Quests come in "at least" and "exact" types. Only exact quests fail, by overshooting ([guide](https://itemlevel.net/dorfromantik-all-about-quests-guide/)). | All Classic quests are "at least". No exact or close-the-area quests in v1. | Milestone 2, `quest.rs` |
| G6 | About three quests count at a time. Failing one costs nothing (guides). | At most three active quests, one per family. No penalty when a quest is set aside. | Milestone 2 |
| G7 | The stack is visible three deep. Only the top tile can be played (Wikipedia). | Show the current tile and the next two. Only the current tile can be placed. | `Snapshot.current`, `upcoming`; UI hand |
| G8 | The plane is unbounded. A similar game soft-locked on an unplaceable tile ([report](https://itch.io/post/5945237)). | The ground is unbounded and computed on demand. A constructive safety rule always leaves a playable tile (see 2.6). | `terrain.rs`, `Run::ensure_playable` |
| G9 | Critics praise low stakes but note little tension ([Wargamer](https://www.wargamer.com/dorfromantik-board-game/review)). | Milestones and a 6,000-point victory add a goal without a timer. Victory is verified by simulation, not assumed. | Milestones 2 and 4 |
| G10 | Players complain about unreadable holes, invisible rewards, and confusing stack counts (thread, report). | Blocked spots get a dashed rim. Every refusal names its rule. The deck count is exact, and reward and cap feedback is explicit. | UI, `Board::evaluate` reasons |
| G11 | Dorfromantik has an undo. | **Classic has no undo.** The one skip is the only take-back, and a deterministic run cannot be explored and then rewritten. Undo and redo are removed from the core and UI. | `lib.rs` commands; API test `invalid_placements_explain_the_rule_and_change_nothing` |

### Technical findings

| # | Finding | Decision | Where |
| --- | --- | --- | --- |
| T1 | Rule logic was duplicated in TypeScript: stair and dead-end detection in `tiles.ts`, and three different "perfect" thresholds in UI, sound, and Rust. | Rust sends per-side meets for every placed tile and preview. The renderer draws stairs, dead ends, and cliffs from them. The client computes no rule. | `TileView.meets`, `Placement.sides`, `tiles.ts pathEnd` |
| T2 | Paths were a star: one spoke per path edge into a hub, so every tile was one network node. | Path groups per tile and union-find nodes per group. Walkways are drawn as curves between the edges of each group. | `network.rs`, `tiles.ts walks` |
| T3 | Houses were placed per built edge with no tie to any path. | Each home's entrance opens onto a specific path group, by the nearest-path rule. The house faces that walk and gets a stoop to it. A home counts only when its walk is connected. | `tile::entrances`, `TileKit.compose` |
| T4 | Undo history must restore every new field, and undo after game over could revive a finished run. | Removed with undo (G11). | — |
| T5 | v2 saves store tiles. Validating them requires replaying the opening and supply. | v3 saves are an action log `{version, rules, seed, actions}` that is replayed through `Run::apply`. Loading a run is the same code path as playing it. v1 and v2 saves are refused with an explanation and stay downloadable. | `lib.rs replay`; API tests `saves_replay_to_the_identical_state`, `older_and_damaged_saves_are_refused_without_changing_the_run` |
| T6 | 30 × 35% is not a whole number of tiles. | Largest-remainder rounding, ties to the family listed first: 11 / 7 / 6 / 3 / 3. | `deck::family_counts`; test `rounding_gives_exactly_thirty_with_the_documented_split` |
| T7 | The first launch always used seed 2026. | A new player gets a random seed. `?seed=` still pins one. | `main.ts` |
| T8 | Terrain uses floating point. | Only IEEE add, multiply, floor, and sqrt are used, which are deterministic in WASM and native code. Golden determinism tests run in both. All random choices in the rules use the integer SplitMix64 streams in `rng.rs`. | `terrain.rs`, `rng.rs` |
| T9 | Tools assumed over 100 tiles. | Benchmarks, captures, and core timings now measure runs of 0 to 30 placements. | `tools/*.mjs` |

### Art direction findings

The full list, with hex values, is in the art report. Milestone 1 applied the items that placement depends on. The rest are scheduled for Milestones 3 and 4.

| # | Finding (screenshot) | Decision | Status |
| --- | --- | --- | --- |
| A1 | Frontier outlines were 1 px lines that read as a wireframe grid and cut across soil (Phase 1 shots 01, 03, 05). | Show flat rims only on empty spots beside the world. A cream rim 0.09 wide at 0.42 opacity, with a 0.08 fill, marks spots where the current tile fits. A dashed muted-red rim marks spots where no rotation fits. Shape, not just color, carries the state. | Done (`rimGeometry`, `fillGeometry`) |
| A2 | The hover ghost was milky and see-through. Edge bars sat on roofs. | Hashed alpha at 0.85 with depth writes, a faint ground disc, and a solid ribbon outline. Edge markers sit on the seam: solid teal for a join, faint bars for open path and stream ends, and crosses for refused or steep sides. | Done |
| A3 | The invalid state used loud coral and relied on color alone. | A dashed `#b8442f` rim, a centered cross, contents at 0.3, and the specific rule in the chip. | Done |
| A4 | Rivers were keyholes: a pond plus a stub on every tile. | One curved channel between water edges, with banks. Ponds only at springs or junctions. A cascade where a stream drops a terrace. | Done |
| A5 | Paths were straight spokes that kinked at every center. | Quadratic curves whose ends meet the edge squarely, so neighbors join without kinks. Landings where three or more meet. Doorsteps at single ends. | Done |
| A6 | Ground tones per kind made a patchwork. | One meadow tone, forest slightly darker, jitter narrowed to ±1.5%, and the blend core lowered from 0.7 to 0.5. | Done |
| A7 | 37% of trees bloomed, so canopies outshone landmarks. | One bloom variant in ten. Saturation stays on buildings. | Done |
| A8 | Houses faced the tile center with their backs to the paths. | Houses face their entrance walk and are pushed out of the walkway's way. | Done |
| A9 | Contact shadows, lighting, and region tints. | Deferred to the visual polish milestone. | Milestone 4 |
| A10 | Framing ignored the open spots and could hide them under the HUD. | Framing includes the frontier, sits above center (0.06 of the height, 0.1 on portrait), and a single tile is seen from a little higher. | Done |

### Balance findings

These come from the Python prototype. Milestone 4 replaces it with a Rust simulator run on the real rules.

| # | Finding | Decision |
| --- | --- | --- |
| B1 | Under the brief's numbers, no simulated policy won any of 4,200 runs. Greedy p50 was about 2,600 and the one-tile look-ahead planner about 3,040. | Re-measured on the real rules with the Rust simulator (4.5): the planner won 0.5%. Confirmed, so balance changed. |
| B2 | The water ladder 4/8/15 is nearly unreachable when water is 10% of tiles. The large tiers of 25 lock out victory. | The Rust simulation confirmed the water bottleneck. The prototype's full set made victory too easy (59%). Shipped the smallest change that meets the targets instead: water 3/5/8 and 3 tiles for small quests (4.5). |
| B3 | Repeating the large quest **with** tile rewards can feed itself, because one water tile counts for both water and nature. One run reached 93 placements. | **Termination rule:** reward tiles come only from the nine ladder quests (three families × three tiers). A run holds at most 30 + 33 tiles, so it lasts at most 63 placements plus one skip. |
| B4 | A tile with both water and dry edges can always go somewhere. The cell east of the easternmost tile touches only that tile. | Proven and tested (2.6). The prototype hit 0 unplaceable tiles in about 2.2 million placements. The Rust safety rule still exists and is tested against a forced worst case. |
| B5 | Perfect placements almost never happen in growing blobs. | Kept as a rare surprise. It is not a balance lever. |

## 2. Rules, Milestone 1

### 2.1 Start

- The region is chosen from the seed on its own random stream: Medellín, Salento, Cartagena, or Bogotá.
- The region sets the hillside shape:
  - Medellín is steep, up to 7 terraces.
  - Salento is rolling.
  - Cartagena is nearly flat, at most 2.
  - Bogotá is a plain rising to one side.
- The region also sets the starting settlement. Each start has two or more path edges leading out, one or two homes, and no water.

| Region | Start tile (edges, path groups) | Look |
| --- | --- | --- |
| Medellín | `PHHPNN` · `100100` | Two brick homes on a raised forecourt, steps down to a stair street with a lamp |
| Salento | `PNHNNP` · `100001` | A whitewashed finca with colored veranda trim, two wax palms, and a bending lane |
| Cartagena | `PHHNPN` · `100010` | An ochre courtyard house with a wooden balcony and bougainvillea, a second house, and palms |
| Bogotá | `PHNPNN` · `100100` | A brick residence beside a straight public path, with a bench and lamp |

- The start tile sits at the origin with a seeded rotation.
- It is not drawn from the deck and earns no points. Its homes and paths count toward quests.

### 2.2 Edges, matching, and legality

- Each tile has six ordered edges, each `homes`, `path`, `nature`, or `water`.
- Edge `i` faces axial direction `i`. Rotating by `r` moves edge `i` to `i + r`.
- Path edges carry a group number. Path edges in the same group are joined inside the tile. Different groups are separate walks.
- Nature edges form one area per tile, and water edges form one stream.

A placement is legal when all of the following hold:
1. The spot is empty.
2. It touches at least one placed tile.
3. No water edge faces an occupied non-water edge, and no dry edge faces an occupied water edge. A water edge facing an empty spot is an open stream end.
4. The rotation is between 0 and 5. Coordinates beyond 65,536 from the start are refused before any neighbor math.

How two touching edges meet (`tile::meet`):

| Own / other | Same type | Different dry types | Water and dry |
| --- | --- | --- | --- |
| Rise 0 or 1 | **match** | differ (allowed) | **blocked** (refused) |
| Rise 2 or more | match, except path–path is **steep** (allowed, not a match, no join) | differ | blocked |

- **Decision on cliffs:** a path facing a path two or more terraces away is allowed, but it does not match, score, or join. The renderer ends the walk at a railing.
- With this rule, water is the only reason a placement is refused. That removes the cliff as a source of stuck tiles.

### 2.3 Score

```text
points = 10 + 20 × matches + (60 if six neighbors and six matches)
```

- `score::points` is the only implementation.
- `Board::evaluate` computes the preview with it. `Run::place` re-evaluates through the same function and awards exactly the previewed `Points`.
- Only the new tile's sides are evaluated, so a shared edge is counted once: by the tile that creates it.
- Feedback labels:
  - three matches: "Good connection"
  - four or more: "Great connection"
  - perfect: "Perfect placement"
  - otherwise only the points are shown, for example "+50".

### 2.4 Deck

- 30 tiles per run. Families are split 11 residential, 7 nature, 6 landscape, 3 water, and 3 community.
- The families are shuffled on the run's deck stream. Each tile then picks a kind and a template, and is mirrored half the time.
- Community kinds are tienda, plaza, and parque, plus a rare capilla.
- The HUD shows the current tile, the next two, and the remaining count. Only the current tile can be placed.
- **Skip:** once per run, the current tile moves to the back of the deck. Nothing is created, removed, or scored. Skip is unavailable with one tile left.
- Reward tiles (Milestone 2) come from a separate stream indexed by reward count, so earning them never reorders the deck.

### 2.5 Placement order

`Run::place` runs these steps in order:
1. Validate.
2. Consume the tile.
3. Insert it and update the networks.
4. Award the previewed points.
5. *(Milestone 2)* Update quest progress, resolve rewards, and apply the cap.
6. Add the score and record the action.
7. Ensure the next tile is playable, or finish the run when the deck is empty.

If validation fails, nothing changes. The Rust test `invalid_actions_change_nothing` and the API test `invalid_placements_explain_the_rule_and_change_nothing` check this.

### 2.6 Never stuck

**Lemma.** Let T be the placed tile with the largest `(q, r)`. Then the spot east of T, at `T + (1, 0)`, has T as its only placed neighbor:
- Each of its other neighbors has a larger `q`, or the same `q` with a larger `r`.
- The ground is unbounded, so that spot always exists.

**Safety rule** (`Run::ensure_playable`). It runs after every action. If the current tile has no legal placement:
1. It trades places with the first playable tile behind it in the deck.
2. If no tile in the deck is playable, it is replaced by a meadow. If T's east edge is water, it is replaced by a spring that has one water edge.

Both replacements fit at the lemma's spot. The tile count is unchanged, and the event is counted in `recoveries` and reported in the snapshot's `recovery` field.

Right after a skip, the skipped tile, now at the back, is not a candidate for the swap. A skip is therefore never silently undone.

Tests:
- `the_safety_rule_always_leaves_a_playable_tile`: 200 seeds of random legal play.
- `replacement_fits_beside_the_outermost_tile_even_when_every_edge_is_water`: a forced all-water world.

### 2.7 Saves and versions

- **Format:** `{"version": 3, "rules": "classic-2", "seed": n, "actions": [{"type": "place", ...} | {"type": "skip"}]}`.
- **Loading:** a save is loaded by replaying every action through the rules. Any illegal step refuses the whole file, and the current run is left unchanged.
- **Rules changes:** `RULES` must change whenever scoring, the deck, or generation changes. A save made under other rules is refused with an explanation.
- **Older saves:** v1 (square sandbox) and v2 (free hex building) saves are refused with an explanation. They are never overwritten and can be downloaded from the menu.

## 3. Path construction

The player decides where neighborhoods connect. The engine decides how their paths are built.

### Logical network

- **Anchors:** each path edge has exactly one anchor, at the edge midpoint. Matching anchors are paired across the shared edge with no slot bookkeeping.
- **Groups:** each tile stores which anchors connect inside it (`TileSpec.paths`). Groups never interleave around the tile, so walks inside one tile never cross. The `templates_are_well_formed` test enforces this.
- **Entrances:** each home opens onto the path group of the nearest path edge around the tile. On a tie it prefers side `i + step`, which is clockwise on screen in the default view. The rule turns and mirrors with the tile (test `homes_open_onto_the_nearest_path_and_turn_with_the_tile`). A home on a tile with no path has no entrance and never counts.
- **Network updates:** `network.rs` keeps a union-find whose nodes are (tile, path group), (tile, nature area) and (tile, stream). Placing a tile adds its nodes and joins every matched side. Tiles are never removed, so the incremental update is exact.
- **Residential measure:** homes in the walk that has the most homes.
- **Preview report:** `Placement.paths` reports the path edges that will join, stay open, end against homes or nature, or face a cliff, plus stairs built and homes gained on the main walk. The preview runs the same join on a cloned network.

### Automatic geometry

`tiles.ts` draws walks from `walks()`, using the group data and the per-side meets from Rust:
- **Two edges:** one quadratic curve whose control point is the tile center. Each end leaves its edge midpoint perpendicular to the edge, so neighbors join without a kink or gap.
- **Three or more edges:** curves into a small paved landing.
- **One edge:** a lane in to a doorstep.
- **Stairs:** a joined path one terrace below its neighbor stops 0.8 short of the edge and climbs five risers with stone cheeks to the neighbor's level.
- **Dead end:** a path that faces homes or nature ends at a planter. Its walk really does end there.
- **Steep side:** a path that faces a path two terraces away ends at a railing, and nothing is drawn across the gap.
- **Houses:** each house turns to face the nearest point of its entrance walk, gets a stoop to it, and is pushed back until it clears the walkway. Trees, shrubs, benches and rocks are skipped where they would sit on a walkway.
- **Caching:** surface geometry is cached by edges, groups, and meets. The same tile always produces the same geometry.

Acceptance tests are in Rust (`board.rs`) and `web/tests/tiles.test.ts`. They cover:
- connection and rotation
- separate groups
- unreached homes
- stairs, cliffs, and merges
- seam alignment
- building clearance
- determinism

## 4. Quests, rewards, victory, and game over

### 4.1 Quests

There are three quest families, each measured on the board after every placement:

| Family | Measure | Small | Medium | Large |
| --- | --- | --- | --- | --- |
| Residential | Homes in the walk with the most homes (a home counts once a path reaches its door) | 5 | 12 | 25 |
| Nature | Tiles in the largest connected nature area | 5 | 12 | 25 |
| Water | Tiles in the longest connected stream | **3** | **5** | **8** |

| Rung | Points | Tiles |
| --- | --- | --- |
| Small | 150 | **3** |
| Medium | 350 | 3 |
| Large | 750 | 5 |

Bold values differ from the brief; see 4.5.

- **Slots:** at most three quests are active, one per family. Every run starts with the three small quests (`Quests::start`).
- **Completion:** a quest completes on a placement that raised its measure, when the measure then meets the target. A board that does not change pays nothing. A family completes at most one rung per placement.
- **Payment:** a completed quest pays once and keeps its stable id (`water-medium`) and the placement number in the history.
- **Next rung:** the next rung of the same family starts after the placement resolves, measured from the new board. Even if it is already met, it completes only on a later placement that raises the measure again.
- **Finite ladder:** a family retires after its large quest. A run can complete at most nine quests, for 3,750 points and 33 reward tiles, so it holds at most 63 tiles. Identical small quests are never generated.
- **Out of reach:** each family's reach is everything placed plus everything left in the deck. For residential that means homes with an entrance path; for nature and water, tiles with such an edge. A quest whose target is beyond its reach is set aside: it shows a dashed card, pays nothing, and cannot complete. It returns unchanged as soon as reward tiles bring it back within reach. `check_reach` runs after rewards are resolved. This is the only replacement rule, it is deterministic, and it never grants anything.

Tests:
- Rust: `quest::tests::*`, `run::tests::quests_pay_once_add_reward_tiles_at_the_back_and_keep_history`, and `tests/api.rs previews_list_the_quests_a_placement_would_complete`.
- Web: `quests.test.ts` (39 tests on the real core) and `panels.test.ts`.

### 4.2 Rewards and the deck cap

- Each reward tile is `deck::reward(seed, n)`, the n-th draw from its own seeded stream. Rewards are appended to the back of the deck, so tiles already in the deck keep their order.
- Earning, preview cloning, replay, or skipping never changes which tile a given reward index is. The test `seeds_and_streams_never_alias` covers this.
- At most 60 tiles may remain in the deck. A reward beyond that is still drawn, so later rewards keep their place in the stream, but it is discarded. It is counted in `discarded` and named in the toast ("The deck is full, so 1 reward tile was discarded"). Test: `rewards_beyond_the_cap_are_discarded_with_a_count`.
- With the shipped ladder the cap cannot be reached in practice: at most 30 + 33 − placements tiles can remain, and 0 discards occurred in 5,000 simulated runs. It is kept and tested as a guard.

### 4.3 Placement order

`Run::place` runs the brief's order exactly:
1. Validate.
2. Consume the tile.
3. Insert it and update the networks.
4. Award the previewed placement points.
5. Update quest progress.
6. Pay rewards (`pay`).
7. Add placement and quest points, then check quest reach.
8. Check milestones, victory, and game over.
9. Apply the safety rule for the next tile.

A refused placement changes nothing. The preview's `completes` list comes from applying the placement to a copy of the run, so it names exactly the quests the placement completes.

### 4.4 Milestones, victory, and the end of a run

- **Milestones:** 1,000 Settlement, 3,000 Community, and 6,000 Thriving Barrio. Each is reported once, in order, by the placement that reaches it.
- **Victory:**
  - Reaching 6,000 sets `victoryAt` once and shows a short celebration with "Continue building" and "Finish and view results".
  - Continuing keeps the world, deck, quests, and score.
  - `finish` is accepted only after victory. It ends the run with `end: "finished"` and is recorded in the save.
- **Game over:**
  - When the deck is empty after the last placement's rewards, the run ends with `end: "deckEmpty"`.
  - The world stays for inspection.
  - The results show:
    - total score
    - highest milestone
    - tiles placed
    - connected homes
    - quests completed
    - the largest nature area and the longest stream
    - region and seed
    - the personal best
  - The actions are New game, Replay seed, View neighborhood, and Share screenshot. Share uses the Web Share API with the PNG, or downloads it.
- **Personal bests:**
  - Bests are stored locally under `barrio.best.<rules>`, so a rules change starts a fresh record.
  - Only a live transition to the end of a run records a best. Loading or restoring a finished run claims no record and shows the stored best.
  - The victory celebration likewise appears only after a live placement, never after a reload.

### 4.5 Balance

**Method.** `cargo run --release --bin simulate -- --seeds 1000 --out docs/benchmarks/classic-balance.json` plays every seed's run to the end through the real rules (`Run::apply`). It uses five deterministic policies:
- **Random:** a uniform legal placement.
- **Greedy:** immediate points.
- **Quest-focused:** quest progress first.
- **Balanced:** points, quest progress, compactness, and few open streams.
- **Planner:** balanced, plus a look-ahead at the next visible tile, standing in for a careful player.

The simulator records:
- score
- placements
- completed quests per rung
- tiles earned and discarded
- unusable-tile events
- victory and milestone rates
- the matching-edge histogram
- the remaining-deck curve

Identical arguments produce identical JSON. All 5 × 1,000 runs take 22 s on this host.

**Brief numbers** (`docs/benchmarks/classic-balance-brief.json`):

| Policy | Score p50 / p90 | Victory | Placements p50 |
| --- | --- | --- | --- |
| Random | 1,010 / 1,180 | 0% | 34 |
| Greedy | 4,080 / 4,490 | 0% | 45 |
| Quest | 4,430 / 5,410 | 0.2% | 47 |
| Planner | 5,100 / 5,470 | 0.5% | 50 |

The water ladder was the blocker. The planner completed water-small in 67% of runs, water-medium in 3%, and water-large never, because water is 10% of the deck: about 3 tiles plus rewards. Victory was effectively out of reach for deliberate play.

**Variants** (1,000 seeds each, random / greedy / quest / planner victory rates):

| Variant | Greedy | Quest | Planner | Placements p50 |
| --- | --- | --- | --- | --- |
| Water 3/5/8 | 1.1% | 4.2% | 11.6% | 52 |
| Water 3/6/10 | 0.4% | 1.0% | 4.2% | 52 |
| Reward tiles 3/4/6 only | 0.5% | 4.0% | 5.9% | 57 |
| Water 3/5/8, large tiers 20 | 2.0% | 7.9% | 16.5% | 52 |
| **Water 3/5/8, small reward 3 tiles** | **2.9%** | **24.6%** | **37.0%** | **55** |
| Water 3/5/8, rewards 2/4/6 | 3.2% | 30.3% | 40.1% | 56 |
| Water 3/5/8, rewards 3/4/6 | 3.9% | 36.0% | 46.2% | 59 |
| Prototype's set: targets 4/10/20, 5/10/20 and 3/5/8, rewards 3/4/6 | 8.5% | 49.5% | 59.1% | 63 |

**Decision:** the smallest change that meets every target is water targets 3/5/8 plus one more reward tile for small quests. It changes two numbers on the ladder and nothing in scoring, the deck, or milestones. `RULES` became `classic-2`.

Final results (`docs/benchmarks/classic-balance.json`):

| Policy | Score p10 / p50 / p90 | Placements p50 (max) | Quests | Tiles earned | Victory | Matches per placement |
| --- | --- | --- | --- | --- | --- | --- |
| Random | 760 / 1,060 / 1,260 | 36 (42) | 1.6 | 4.7 | 0% | 0.63 |
| Greedy | 3,220 / 4,500 / 5,260 | 50 (63) | 5.5 | 18.5 | 2.9% | 2.16 |
| Quest | 4,460 / 5,320 / 6,120 | 53 (63) | 7.0 | 24.0 | 24.6% | 2.13 |
| Balanced | 4,420 / 5,320 / 6,060 | 55 (63) | 7.0 | 24.1 | 20.0% | 2.08 |
| Planner | 4,540 / 5,600 / 6,220 | 55 (63) | 7.2 | 24.9 | 37.0% | 2.18 |

How the final results compare with the targets:
- **Random is far worse than deliberate play:** about 20% of the planner's median, and it never wins.
- **Victory needs skill but not perfection:** greedy play that ignores quests wins 2.9%. Quest-aware play wins 20–37%. A one-tile look-ahead wins about one run in three.
- **A competent player has a realistic path:** every deliberate policy reaches Community in 95–100% of runs.
- **Runs are not infinite:** they last at most 63 placements, a hard bound from the finite ladder plus one skip. The median is 50–55 placements, about 21–23 minutes at 25 seconds each. That assumed pace must be checked by playtesting; the simulator cannot measure real session length or enjoyment.
- **Unusable-tile events:** 0 in about 250,000 simulated placements.
- **Perfect placements** stay rare, at under 0.01 per run, as finding B5 predicted.
- **Quest points** make up 41–47% of deliberate scores.

Real players plan merges and paths better than these bots, so win rates should be re-checked after playtests before tuning further.

## 5. Milestone reports

### Milestone 1: playable placement

Status: complete and verified on 2026-10-21. Not committed.

#### Implemented

- **Run start:** one region start tile at the origin, a 30-tile seeded deck, and the next two tiles visible. Regions are chosen by seed, with region-shaped hillsides and four composed starting settlements.
- **Edges and legality:** homes, path, nature, and water, with soft matching and strict water continuity. A path facing a path across a cliff is allowed but does not join. Every refusal gives a specific reason.
- **Rotation:** six rotations. Preview and award go through the same Rust function and are always equal.
- **Score and feedback:**
  - Score is 10 per tile, 20 per match, and 60 for a perfect placement.
  - After placing, "+50" or "+90 · Great connection" rises from the tile. With reduced motion it stays still and fades.
- **Placement indicators:**
  - Quiet rims mark open spots, and dashed rims mark spots where the tile fits in no rotation.
  - Hovering shows a ghost tile with edge markers and a chip: base, matches, perfect, total, and what happens to the paths.
  - An invalid spot shows a dashed rim, a cross, and the rule that refused it.
- **Path network (amendment):**
  - Path groups and home entrances are stored on each tile.
  - A union-find network updates per placement.
  - The preview reports joins, open ends, dead ends, steep sides, stairs, and homes gained.
  - Walks are drawn as curves from the same data, with stairs, planters at dead ends, railings at cliffs, stoops to doors, and houses kept clear of walkways.
- **Rivers:** continuous curved channels with banks, springs at single edges, and cascades at terrace drops.
- **Deck rules:** one skip per run. The safety rule means a run can never get stuck. A finished run shows a results panel with New game, Replay seed, and View neighborhood.
- **Saves:** v3 saves are action logs that replay through the rules. v1 and v2 saves, and unreadable autosaves, are refused, kept, and offered for download.
- **Removed:** undo and redo, by decision G11.

#### Files

| Area | Files |
| --- | --- |
| New Rust modules | `crates/barrio-core/src/{rng,region,network,score,run}.rs` |
| Rewritten Rust | `tile.rs`, `board.rs`, `deck.rs`, `terrain.rs`, `play.rs`, `lib.rs`, and `tests/api.rs` |
| Milestone 2 draft, not yet wired into runs | `quest.rs` |
| Web, rewritten | `domain.ts`, `ui.ts`, `tileArt.ts`, `persistence.ts`, `render/tiles.ts` |
| Web, modified | `controller.ts`, `main.ts`, `style.css`, `render/world.ts`, `render/ground.ts`, `render/palette.ts` |
| Tests, rewritten by the test-design subagent and reviewed | `web/tests/{core-fixture,hex,simulation,controller,tiles,ground,batches,game.spec}.ts` |
| Tests, new | `web/tests/ui.test.ts` |
| Tools | `capture.mjs`, `benchmark.mjs`, `benchmark-core.mjs`, `verify-wasm.mjs`, `profile-layers.mjs` |
| Docs | this file, README |

#### Reviews and fixes

**Test-design subagent.** It found two issues, both fixed and now covered by strict tests:
- The Cartagena courtyard reached 7–9 cm into the neighboring hex. The casona was redesigned with a side patio, and every part now stays within the hex.
- Curved strips met the shared edge about 2° off square. Strip ends now use the true edge normal, and strip corners land on the seam within 1e-5.

**Code-review subagent.** It found no scoring, legality, network, or rendering bugs. Its randomized probes covered:
- 400 seeds of random play, recomputing points and homes independently
- legality against `playable`
- NaN and huge inputs

It reported nine lower-severity issues, all fixed:
- **Replay seed:** Replay seed and imported seeds of 1,000,000 or more changed the run. Seeds are now kept exactly, and only fresh seeds are shortened.
- **Recovery reporting:** recovery events were lost on skips and at the start. They are now reported in a dedicated `recovery` field, and the controller explains them in the toast.
- **Skip:** a skip could be silently undone by the safety rule. The skipped tile is now excluded from the swap.
- **Random streams:** reward streams could alias another seed's stream. `Rng::new` now hashes seed and stream separately, with test `seeds_and_streams_never_alias`. This changes every deck, so screenshots and baselines were regenerated.
- **Path groups:** a path group above 3 would have panicked. Groups now have ten slots.
- **Wrong message:** a huge rotation reported a coordinate error. It now gives the rotation message.
- **URL seeds:** `?seed=` values of 0 or 2³² and above are now handled.
- **Unreadable autosave:** an autosave that could not be restored was overwritten. It is now kept aside and offered from the menu, with test `keeps an autosave it cannot restore aside`.
- **Docs:** the entrance tie-break was documented as counterclockwise. The docs now say clockwise on screen.

#### Tests executed

All run from the repo root on 2026-10-21 after the fixes.

| Check | Result |
| --- | --- |
| `cargo test` | 59 passed: 48 unit (tile, board, network, score, deck, rng, region, terrain, run, play, quest draft) and 11 API |
| `cargo fmt --check` | clean |
| `cargo clippy --all-targets` | no errors. 19 dead-code warnings from the unwired Milestone 2 draft (`quest.rs`, `deck::reward`, `CAP`); `-D warnings` will pass once Milestone 2 wires them in |
| `npx vitest run` | 94 passed in 8 files |
| `npx tsc --noEmit` | clean |
| `npm run lint` (Biome) | clean |
| `npx playwright test` (production build, SwiftShader) | 9 passed, including two regenerated visual baselines |
| `node tools/verify-wasm.mjs` | passed |

Coverage of the brief's test list so far:
1. Hex coordinates and adjacency
2. Rotation and edge mapping
3. Soft matching
4. Water continuity and open stream ends
5. Preview equals award
6. Perfect detection
7. Network calculation
10. Deck generation and conservation
11. Skip
15. Deck exhaustion
16. Save and load equivalence
17. Seed replay
18. Rules-version compatibility
19. Legal-placement recovery
20. Scoring invariants

The rest arrive with Milestone 2: items 8, 9, 12, 13 and 14.

The path amendment's ten acceptance checks are covered by these tests:

| # | Check | Tests |
| --- | --- | --- |
| 1 | Logical and visual join | `a_joining_tile_merges_two_walks_and_rotation_changes_it`; seam alignment in `tiles.test.ts` |
| 2 | Rotation | the same Rust test; rotation test in `tiles.test.ts` |
| 3 | Separate groups | `separate_walks_on_one_tile_stay_separate`; group distance test |
| 4 | Homes without entrances | `homes_without_an_entrance_path_never_count` |
| 5 | Stairs | `paths_join_with_stairs_but_not_across_a_cliff`; stair end test |
| 6 | Cliffs | the same Rust test; cliff end test |
| 7 | Merges update the measure | `homes_gained` tests; the review's brute-force probe |
| 8 | Seams | alignment test for all six sides and five walk shapes |
| 9 | Building clearance | about 22,000 building placements, minimum 0.686 |
| 10 | Determinism | identical geometry from two kits |

#### Screenshots

These are in-engine captures from `node tools/capture.mjs docs/screenshots/classic`, with SwiftShader at 1440×900 and the high tier. Each PNG has a JSON file with its run state and renderer metrics.

| Shot | Shows |
| --- | --- |
| [01](screenshots/classic/01-start-medellin.png) [02](screenshots/classic/02-start-salento.png) [03](screenshots/classic/03-start-bogota.png) [04](screenshots/classic/04-start-cartagena.png) | The four regional one-tile starts |
| [05-opening-ui](screenshots/classic/05-opening-ui.png) | A one-tile world with its six open spots and the HUD |
| [06-hover-preview](screenshots/classic/06-hover-preview.png) | Ghost tile, edge markers, and the points chip |
| [07-invalid-hover](screenshots/classic/07-invalid-hover.png) | A refused spot: dashed rim, cross, and the water rule named |
| [08-placed-feedback](screenshots/classic/08-placed-feedback.png) | Floating points after a placement |
| [09-ten-tiles](screenshots/classic/09-ten-tiles.png), [10-thirty-tiles](screenshots/classic/10-thirty-tiles.png) | 11 and 31 tiles |
| [11-run-complete](screenshots/classic/11-run-complete.png) | The results panel when the deck is empty |
| [12-paths-joined](screenshots/classic/12-paths-joined.png) | Two residential tiles joined by path |
| [13-three-way-crossing](screenshots/classic/13-three-way-crossing.png) | A three-way pedestrian junction |
| [14-hillside-stairs](screenshots/classic/14-hillside-stairs.png) | Stairs between terraces |
| [15-walks-before-joining](screenshots/classic/15-walks-before-joining.png), [16-walks-after-joining](screenshots/classic/16-walks-after-joining.png) | Two walks, then one. The run state goes from 8 walks to 7, with "+4 homes on the main walk" |
| [17-mobile](screenshots/classic/17-mobile.png) | 390×844 portrait |

#### Measured results

**Rules (release WASM in Node, 11 seeds, median).** The data is in `benchmarks/core-wasm.json`.

| Operation | Median |
| --- | --- |
| New run | 0.04 ms |
| Preview of every open spot × 6 rotations | 0.60 ms |
| One placement with its snapshot | 0.10 ms |
| Greedy play of a whole deck | 5.5 ms |
| Loading a finished save, by full replay | 0.61 ms |

**Rendering (`benchmarks/classic-scenes-{low,high}.json`).** SwiftShader with no GPU, at a load average of 5.9–8.2 caused by other processes. These numbers are for comparison only; they are not frame rates.

| Tiles | Low tier, render | High tier, render | Draw calls | Triangles | Placement latency |
| --- | --- | --- | --- | --- | --- |
| 1 | 59 ms | 66 ms | 15 | 3,030 | 14–20 ms |
| 11 | 129 ms | 160 ms | 56 | 42,128 | 13 ms |
| 21 | 163 ms | 239 ms | 82 | 82,726 | 6–12 ms |
| 31 | 234 ms | 297 ms | 100 | 125,400 | the deck is empty |

- A hover preview takes 0.1–0.2 ms.
- Renderer geometries are unchanged across ten regrown runs at every size, for example 102 → 102 at 31 tiles.
- A full deck has about half the triangles of Phase 1's 55-tile scene.

**Balance (simulated, not tuned).**
- The greedy bot scores about 1,500–1,600 per seed with no quests.
- The Python prototype predicts that quests under the brief's numbers add about 1,000.
- Milestone 4 measures this on the real rules.

#### Known limitations

- Quests, rewards, milestones, victory, game over with personal bests, and Share are Milestone 2. Until then, a run ends at 30 placements with a basic results panel.
- The ghost uses hashed transparency, which looks grainy under SwiftShader's sampling.
- The preview chip can cover a neighboring spot.
- On narrow portrait screens, the island sits small above the tray.
- Contact shadows, lighting, and region palettes are scheduled for visual polish.
- The Medellín start draws its stairs as steps down from a raised forecourt. The street itself stays flat.
- `tests/tiles.test.ts` reads `TileKit`'s private cache to identify building parts.

#### Next bounded step

Milestone 2, which was done next and is reported below.

### Milestones 2–4: the complete loop, the interface, and balance

Status: complete and verified on 2026-10-21. Not committed. The three milestones were built in order and are reported together because they were verified together.

#### Implemented

**Milestone 2, the complete game loop:**
- Quests: three families, ladders, stable ids, one-time payment, history, and out-of-reach handling (4.1).
- Rewards: tiles from a separate stream are appended to the back of the deck. The cap of 60 is enforced, with feedback (4.2).
- The nine-step placement order (4.3).
- Milestones, one-time victory, Continue and Finish, game over, personal bests per rules version, and Share screenshot (4.4).
- Previews list the quests a placement would complete, with their rewards.

**Milestone 3, the interface:**
- **Top left:** identity, region, and seed.
- **Top center:** the score, with a milestone bar and the next milestone.
- **Left edge:** a quest panel. Each card shows its goal, rung, progress bar, count, and reward. Rising progress pulses, and a completed quest flashes, then gives way to its successor. Out-of-reach quests have a dashed card. On narrow screens the panel becomes a strip of three above the tray.
- **Bottom:** the current tile, the next two, the tiles left, rotate, and Skip.
- **Preview chip:** anchored beside the hovered hex, so the ghost and its edge markers stay visible.
- **Floating text:** points rise from the tile, followed by quest and milestone lines. They are kept clear of the scoreboard and tray.
- **Victory and results:** a victory celebration and a full results panel. The tray hides while the results are open.
- **Keyboard:** the arrow keys move between open spots in the pressed direction and Enter places. `R`, `Shift R`, and `S` work as before.
- **Accessibility:** validity is never shown by color alone; it always has a dashed rim, a cross, and text. Labels sit on solid cream surfaces. Reduced motion keeps floaters still and fades them, and quest cards get an outline instead of animation.
- **Ghost:** translucent with depth writes, no longer dithered.

**Milestone 4, balance and release readiness:**
- The headless simulator and the balance decision (4.5).
- Visual polish:
  - region tints for meadow and afternoon sky
  - contact pads that ground buildings
  - the art review's palette, outline, river, and path items from Milestone 1
- Two code reviews and two test-design passes, described below.

#### Files

| Area | Files |
| --- | --- |
| New Rust | `quest.rs` (wired in), `bin/simulate.rs` |
| Changed Rust | `run.rs` (pipeline, `pay`, `finish`, milestones, end), `board.rs` (`Gains`), `play.rs` (five policies), `lib.rs` (snapshot, `completes`, `finish`, autoplay policy), `rng.rs`, `tests/api.rs` |
| Changed web | `domain.ts`, `controller.ts`, `persistence.ts`, `ui.ts`, `main.ts`, `icons.ts`, `style.css`, `render/world.ts`, `render/lighting.ts`, `render/ground.ts`, `render/tiles.ts`, `render/palette.ts` |
| New tests | `web/tests/quests.test.ts`, `web/tests/panels.test.ts` |
| Changed tests | `simulation`, `controller`, `ui`, and `game.spec` |
| Tools | `capture.mjs` (quest-completion, victory, and results moments found by real planner play), `benchmark.mjs` (cache-warm memory check) |
| Benchmark data | `docs/benchmarks/classic-balance.json` and `classic-balance-brief.json` |


#### Reviews and fixes

**Test-design subagent (Milestone 2 tests).** It wrote `quests.test.ts` and `panels.test.ts`, extended the controller, simulation, UI and end-to-end tests, and found two bugs. Both are fixed and have regression tests:
- Loading a finished run claimed a "new personal best". A load now shows the stored best and claims nothing.
- The victory celebration came back after a reload. It now appears only right after the live placement that reached victory.

**Code-review subagent (Milestones 2–4).** It found one critical issue, two medium issues, and five low-severity issues. All are fixed.

- **Critical: previewing a spot after Finish crashed the WASM core.** The cloned trial placement panicked under `panic = "abort"`, and the game object was unusable afterwards.
  - `Run::preview` now reports a finished run as over, and `Game::preview` never panics.
  - The client stops previewing and keyboard stepping once a run ends.
  - API test: `a_finished_run_previews_as_over_and_never_aborts`.
- **Medium: Finish was reachable only from the one-time victory panel**, and Replay seed could suppress that panel. The scoreboard now has a lasting "Finish run" control after victory and a "Results" control after "View neighborhood". The celebration is keyed per winning placement. Covered by a new panel test.
- **Low, all fixed:**
  - Quest reach is re-checked after a replacement recovery.
  - Quest-card animations reset between runs.
  - Cancelling the share sheet no longer downloads.
  - Game keys wait while an overlay is open.

The review also confirmed:
- Each quest id pays once.
- Nothing pays from an unchanged board.
- The placement order matches the spec.
- The reach upper bound is honest.
- The 63-placement bound holds.
- The zod schemas match the Rust serde names.
- The simulator's accounting is correct.

#### Tests executed

All run from the repo root on 2026-10-21 after the fixes.

| Check | Result |
| --- | --- |
| `cargo test` | 67 passed: 53 unit and 14 API |
| `cargo fmt --check` | clean |
| `cargo clippy --all-targets -- -D warnings` | clean |
| `npx vitest run` | 159 passed in 10 files |
| `npx tsc --noEmit` | clean |
| Biome | clean |
| `npx playwright test` (production build, SwiftShader) | 10 passed, with two regenerated visual baselines |
| `node tools/verify-wasm.mjs` | passed |
| Simulator | 5 policies × 1,000 seeds; identical output on rerun |

The brief's twenty test areas are now all covered.

| # | Area | Tests |
| --- | --- | --- |
| 1–7 | Placement rules | Milestone 1 tests (above) |
| 8 | Quest progress and one-time rewards | `quests.test.ts`; `run::tests::quests_pay_once…` |
| 9 | Completion and replacement | ladder tests; out-of-reach tests; panel successor test |
| 10 | Deck generation and conservation | placements = 30 + rewards − discarded, in Rust, API and web tests |
| 11 | Skip | Rust, API and web tests |
| 12 | Reward tiles | `rewards_beyond_the_cap…`; append order and separate-stream tests |
| 13 | Victory triggering | `victory_triggers_once…` |
| 14 | Play after victory | the same Rust test, plus panel tests |
| 15 | Exhaustion and finalization | API and web end-of-deck tests |
| 16 | Save and load equivalence | API and web tests |
| 17 | Seed replay | API and web tests |
| 18 | Rules-version compatibility | `classic-0` refused; bests separated by rules |
| 19 | Legal-placement recovery | safety-rule tests |
| 20 | Scoring invariants | score = placement points + quest points, checked on every placement in Rust, the simulator and the web |

The exploit and loop checks are:
- An unchanged board pays nothing.
- A refused action changes nothing.
- Replaying a save gives the same result.
- A loaded finished run cannot be extended or re-paid.
- The finite ladder bounds a run at 63 placements.

#### Screenshots

The images in `docs/screenshots/classic/` are in-engine captures made with `node tools/capture.mjs docs/screenshots/classic`. Milestone 1's shots 01–17 were recaptured under `classic-2`.

| Shot | Shows |
| --- | --- |
| [01–04](screenshots/classic/01-start-medellin.png) | The four regional one-tile starts, with region tints |
| [05-opening-ui](screenshots/classic/05-opening-ui.png) | One tile, its open spots, the quest panel, and the milestone bar |
| [06-hover-preview](screenshots/classic/06-hover-preview.png) | Ghost tile with the chip anchored beside it |
| [07-invalid-hover](screenshots/classic/07-invalid-hover.png) | A refused spot |
| [09-ten-tiles](screenshots/classic/09-ten-tiles.png), [10-thirty-tiles](screenshots/classic/10-thirty-tiles.png) | 11 and 31 tiles |
| [11-run-complete](screenshots/classic/11-run-complete.png) | A finished greedy run: deck empty, 45 tiles, Community reached, full results, and a personal best |
| [12–16](screenshots/classic/12-paths-joined.png) | Path evidence: a joined pair, a three-way crossing with stairs, hillside stairs, and walks before and after joining |
| [17-mobile](screenshots/classic/17-mobile.png) | 390×844, with the quest strip above the tray |
| [18-quest-complete](screenshots/classic/18-quest-complete.png) | A placement completing "Connect 12 homes": the done card, floating rewards, and the toast |
| [19-victory](screenshots/classic/19-victory.png) | A real planner run on seed 0 reaching 6,000, and the celebration |
| [20-results-after-victory](screenshots/classic/20-results-after-victory.png) | The same run finished from the celebration |

#### Measured results

**Balance:** see 4.5. The planner wins 37%, quest-focused play 25%, greedy 2.9%, and random 0%. Runs last 50–55 placements at the median and 63 at most, with 0 unusable tiles.

**Rules (release WASM in Node, median of 11 seeds, load 5–9).** The data is in `benchmarks/core-wasm.json`.

| Operation | Median | Note |
| --- | --- | --- |
| New run | 0.05 ms | |
| Preview of every open spot × 6 rotations | 1.4 ms | Was 0.6 ms in Milestone 1; each preview now measures all three quest gains on a copied network |
| One placement | 0.19 ms | |
| Greedy play of a whole run | 17 ms | Runs now last about 45 placements |
| Loading a finished save | 1.7 ms | |

A hover preview, which also runs the quest-completion trial, stays under 1 ms.

**Rendering (`benchmarks/classic-scenes-{low,high}.json`).** SwiftShader with no GPU, at a load average of 6–9 caused by other processes. Compare these only with each other.

| Placements | Low tier, render | High tier, render | Draw calls | Triangles | Placement latency |
| --- | --- | --- | --- | --- | --- |
| 0 | 68 ms | 79 ms | 16 | 3,062 | 18–20 ms |
| 10 | 145 ms | 180 ms | 61 | 36,658 | 36–42 ms (first use of new tile layouts) |
| 20 | 223 ms | 264 ms | 86 | 76,352 | 10–11 ms |
| 30 | 296 ms | 417 ms | 107 | 116,614 | 11 ms |

Renderer memory was unchanged across ten regrown runs at every size. These render times are higher than Milestone 1's at the same scene sizes. The load was higher too (6–9 against 2–8), and the scenes add only about 16 contact pads, so the difference is mostly load, not an established regression. A clean A/B on a quiet host is a remaining task.

#### Known limitations

**Not yet established:**
- Real session length and enjoyment can't come from the simulator. The 21–23 minute estimate assumes 25 seconds per placement.
- Human win rates are unknown. Real players plan better than the bots, so win rates may come out above 37%.
- Neither has been playtested. **The game should not be called ready until they are.**

**Visual:**
- Contact pads sit under buildings only.
- Paths, water and building colors are shared across regions; only the meadow and afternoon sky are tinted.
- In shot 14, a tall tower partly hides the stairs. Shot 13 shows a clear staircase.

**Placement rules:**
- Perfect placements almost never happen (fewer than 0.01 per run). They are kept as a rare surprise; they are not a balance lever.
- The deck cap of 60 cannot be reached with the shipped ladder. It is tested directly as a guard.

**Interface:**
- Keyboard placement chooses spots by screen direction. It has not been tested with screen readers.
- The share sheet depends on the browser. Safari may fall back to a download.

**Process:**
- The `tests/tiles.test.ts` cache coupling noted in Milestone 1 remains.
- Nothing is committed yet. The working tree holds Phase 1 and all four Classic milestones.

#### Remaining work

1. Playtest with real players to measure session length, the first three placements' learning curve, and the actual win rate. Retune only from those results, following 4.5.
2. Run a clean render A/B on a quiet host or a GPU device, and set frame-rate targets.
3. Finish the per-region palette for paths, water and materials, and add more regional start-tile variety.
4. Commit in reviewable steps: Phase 1 hex, then the Classic rules core, then the client, then balance.
