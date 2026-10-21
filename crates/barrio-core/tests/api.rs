use std::collections::HashSet;

use barrio_core::Game;
use serde_json::{json, Value};

fn parse(text: String) -> Value {
    serde_json::from_str(&text).unwrap()
}

fn snapshot(game: &Game) -> Value {
    parse(game.snapshot())
}

fn command(game: &mut Game, command: Value) -> Value {
    parse(game.command(&command.to_string()))
}

fn preview(game: &Game, q: i64, r: i64, rotation: u32) -> Value {
    parse(game.preview(q as f64, r as f64, rotation.into()))
}

/// The first valid frontier placement for the current tile.
fn valid_move(game: &Game) -> (i64, i64, u32) {
    let state = snapshot(game);
    for spot in state["frontier"].as_array().unwrap() {
        let (q, r) = (spot["q"].as_i64().unwrap(), spot["r"].as_i64().unwrap());
        for rotation in 0..6 {
            if preview(game, q, r, rotation)["valid"] == true {
                return (q, r, rotation);
            }
        }
    }
    panic!("no valid move");
}

fn place(game: &mut Game, (q, r, rotation): (i64, i64, u32)) -> Value {
    command(
        game,
        json!({"type": "place", "q": q, "r": r, "rotation": rotation}),
    )
}

#[test]
fn snapshot_matches_the_camel_case_contract() {
    let state = snapshot(&Game::new(42));
    let keys: HashSet<_> = state
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        HashSet::from([
            "rules",
            "seed",
            "region",
            "regionName",
            "tiles",
            "frontier",
            "current",
            "upcoming",
            "remaining",
            "canSkip",
            "skipUsed",
            "score",
            "placements",
            "finished",
            "end",
            "milestone",
            "nextMilestone",
            "victory",
            "victoryAt",
            "quests",
            "rewards",
            "discarded",
            "cap",
            "recoveries",
            "recovery",
            "last",
            "stats",
            "revision",
        ])
    );
    let ids: Vec<_> = state["quests"]["current"]
        .as_array()
        .unwrap()
        .iter()
        .map(|quest| quest["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, ["residential-small", "nature-small", "water-small"]);
    assert_eq!(
        state["nextMilestone"],
        json!({"name": "Settlement", "score": 1000})
    );
    assert_eq!(state["cap"], 60);
    let tile = &state["tiles"][0];
    for key in [
        "q",
        "r",
        "kind",
        "family",
        "edges",
        "paths",
        "entrances",
        "networks",
        "meets",
        "rotation",
        "variation",
        "elevation",
    ] {
        assert!(tile.get(key).is_some(), "tile is missing {key}");
    }
    assert_eq!(tile["networks"].as_array().unwrap().len(), 6);
    assert_eq!(tile["networks"][1], tile["networks"][0]);
    assert_eq!(tile["networks"][2], tile["networks"][3]);
    assert!(tile["networks"][1].is_u64());
    assert_eq!(state["rules"], "classic-2");
}

#[test]
fn a_new_game_shows_one_tile_six_spots_and_a_full_deck() {
    for seed in [0, 1, 7, 2026, 99_999] {
        let state = snapshot(&Game::new(seed));
        assert_eq!(state["tiles"].as_array().unwrap().len(), 1);
        assert_eq!(state["tiles"][0]["kind"], "inicio");
        assert_eq!(state["frontier"].as_array().unwrap().len(), 6);
        assert_eq!(state["remaining"], 30);
        assert_eq!(state["upcoming"].as_array().unwrap().len(), 2);
        assert_eq!(state["score"], 0);
        assert!(state["frontier"]
            .as_array()
            .unwrap()
            .iter()
            .any(|spot| spot["playable"] == true));
    }
}

#[test]
fn the_same_seed_replays_the_same_run() {
    let mut a = Game::new(31);
    let mut b = Game::new(31);
    assert_eq!(a.snapshot(), b.snapshot());
    command(&mut a, json!({"type": "autoplay", "count": 12}));
    command(&mut b, json!({"type": "autoplay", "count": 12}));
    assert_eq!(a.snapshot(), b.snapshot());
    assert_ne!(Game::new(31).snapshot(), Game::new(32).snapshot());
}

#[test]
fn placing_awards_the_previewed_points_and_advances_the_deck() {
    let mut game = Game::new(5);
    let before = snapshot(&game);
    let spot = valid_move(&game);
    let expected = preview(&game, spot.0, spot.1, spot.2);
    let result = place(&mut game, spot);
    assert_eq!(result["ok"], true, "{}", result["message"]);
    let after = &result["snapshot"];
    assert_eq!(after["score"], expected["points"]["total"]);
    assert_eq!(after["remaining"], 29);
    assert_eq!(after["current"], before["upcoming"][0]);
    assert_eq!(after["last"]["points"], expected["points"]);
    assert!(result["message"].as_str().unwrap().starts_with('+'));
}

#[test]
fn invalid_placements_explain_the_rule_and_change_nothing() {
    let mut game = Game::new(8);
    let before = game.snapshot();
    for (q, r, rotation, words) in [
        (0, 0, 0, "already"),
        (5, 5, 0, "touch"),
        (1, 0, 6, "Rotation"),
    ] {
        let result = place(&mut game, (q, r, rotation));
        assert_eq!(result["ok"], false);
        assert!(
            result["message"].as_str().unwrap().contains(words),
            "{}",
            result["message"]
        );
    }
    for bad in [
        json!({"type": "place", "q": 1.5, "r": 0, "rotation": 0}),
        json!({"type": "undo"}),
        json!({"type": "teleport"}),
    ] {
        assert_eq!(command(&mut game, bad)["ok"], false);
    }
    assert_eq!(game.snapshot(), before);
}

#[test]
fn preview_reports_sides_points_paths_and_valid_rotations() {
    let game = Game::new(12);
    let spot = valid_move(&game);
    let result = preview(&game, spot.0, spot.1, spot.2);
    assert_eq!(result["sides"].as_array().unwrap().len(), 6);
    assert!(result["validRotations"]
        .as_array()
        .unwrap()
        .contains(&json!(spot.2)));
    for key in [
        "base",
        "matches",
        "matchPoints",
        "perfect",
        "perfectBonus",
        "total",
    ] {
        assert!(result["points"].get(key).is_some());
    }
    for key in ["joined", "open", "ended", "steep", "stairs", "homesGained"] {
        assert!(result["paths"].get(key).is_some());
    }
    let odd = parse(game.preview(f64::NAN, 0.0, 0.0));
    assert_eq!(odd["valid"], false);
    let far = parse(game.preview(2_147_483_647.0, -2_147_483_648.0, 0.0));
    assert_eq!(far["valid"], false);
}

#[test]
fn the_skip_moves_one_tile_back_once() {
    let mut game = Game::new(3);
    let before = snapshot(&game);
    let result = command(&mut game, json!({"type": "skip"}));
    assert_eq!(result["ok"], true);
    let after = &result["snapshot"];
    assert_eq!(after["current"], before["upcoming"][0]);
    assert_eq!(after["remaining"], 30);
    assert_eq!(after["score"], 0);
    assert_eq!(after["canSkip"], false);
    assert_eq!(command(&mut game, json!({"type": "skip"}))["ok"], false);
}

#[test]
fn a_run_finishes_when_the_deck_is_empty_and_refuses_more_tiles() {
    let mut game = Game::new(2026);
    let result = command(&mut game, json!({"type": "autoplay", "count": 400}));
    assert_eq!(result["ok"], true);
    let state = &result["snapshot"];
    assert_eq!(state["finished"], true);
    assert_eq!(state["remaining"], 0);
    assert!(state["current"].is_null());
    assert_eq!(state["end"], "deckEmpty");
    let placements = state["placements"].as_u64().unwrap();
    assert_eq!(
        state["tiles"].as_array().unwrap().len() as u64,
        placements + 1
    );
    // Every placement used a starting or reward tile, and every reward came from a completed quest.
    let earned: u64 = state["quests"]["history"]
        .as_array()
        .unwrap()
        .iter()
        .map(|quest| quest["tiles"].as_u64().unwrap())
        .sum();
    assert_eq!(
        placements,
        30 + earned - state["discarded"].as_u64().unwrap()
    );
    assert_eq!(state["rewards"].as_u64().unwrap(), earned);
    let more = command(&mut game, json!({"type": "autoplay", "count": 1}));
    assert_eq!(more["ok"], false);
    assert_eq!(place(&mut game, (40, 0, 0))["ok"], false);
}

#[test]
fn saves_replay_to_the_identical_state() {
    let mut game = Game::new(77);
    command(&mut game, json!({"type": "skip"}));
    command(&mut game, json!({"type": "autoplay", "count": 17}));
    let save = game.save();
    let saved: Value = serde_json::from_str(&save).unwrap();
    assert_eq!(saved["version"], 3);
    assert_eq!(saved["actions"].as_array().unwrap().len(), 18);
    let mut other = Game::new(1);
    let loaded = parse(other.load(&save));
    assert_eq!(loaded["ok"], true, "{}", loaded["message"]);
    let strip = |mut state: Value| {
        state.as_object_mut().unwrap().remove("revision");
        state
    };
    assert_eq!(strip(snapshot(&other)), strip(snapshot(&game)));
    assert_eq!(other.save(), save);
}

#[test]
fn older_and_damaged_saves_are_refused_without_changing_the_run() {
    let mut game = Game::new(4);
    command(&mut game, json!({"type": "autoplay", "count": 3}));
    let before = game.snapshot();
    let square = json!({"version": 1, "seed": 1}).to_string();
    let free =
        json!({"version": 2, "generator": "hex-hillside-v1", "seed": 1, "draws": 0, "tiles": []})
            .to_string();
    assert!(parse(game.load(&square))["message"]
        .as_str()
        .unwrap()
        .contains("square"));
    assert!(parse(game.load(&free))["message"]
        .as_str()
        .unwrap()
        .contains("free-building"));
    let other_rules =
        json!({"version": 3, "rules": "classic-0", "seed": 4, "actions": []}).to_string();
    assert!(parse(game.load(&other_rules))["message"]
        .as_str()
        .unwrap()
        .contains("different rules"));
    let illegal = json!({"version": 3, "rules": "classic-2", "seed": 4, "actions": [{"type": "place", "q": 9, "r": 9, "rotation": 0}]}).to_string();
    assert!(parse(game.load(&illegal))["message"]
        .as_str()
        .unwrap()
        .contains("move 1"));
    let two_skips = json!({"version": 3, "rules": "classic-2", "seed": 4, "actions": [{"type": "skip"}, {"type": "skip"}]}).to_string();
    assert_eq!(parse(game.load(&two_skips))["ok"], false);
    for broken in ["", "{", "null", "[]", &"x".repeat(300_000)] {
        assert_eq!(parse(game.load(broken))["ok"], false);
    }
    assert_eq!(game.snapshot(), before);
}

#[test]
fn previews_list_the_quests_a_placement_would_complete() {
    // Find a placement that completes a quest, check the preview names it, then place it.
    for seed in 0..40 {
        let mut game = Game::new(seed);
        for _ in 0..30 {
            let state = snapshot(&game);
            if state["finished"] == true {
                break;
            }
            for spot in state["frontier"].as_array().unwrap() {
                let (q, r) = (spot["q"].as_i64().unwrap(), spot["r"].as_i64().unwrap());
                for rotation in 0..6 {
                    let preview = preview(&game, q, r, rotation);
                    let completes = preview["completes"].as_array().unwrap().clone();
                    if preview["valid"] != true || completes.is_empty() {
                        continue;
                    }
                    let score = state["score"].as_u64().unwrap();
                    let result = place(&mut game, (q, r, rotation));
                    let last = &result["snapshot"]["last"];
                    let completed: Vec<_> = last["completed"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|done| done["quest"]["id"].clone())
                        .collect();
                    let expected: Vec<_> =
                        completes.iter().map(|quest| quest["id"].clone()).collect();
                    assert_eq!(completed, expected);
                    let bonus: u64 = completes
                        .iter()
                        .map(|quest| quest["points"].as_u64().unwrap())
                        .sum();
                    assert_eq!(
                        result["snapshot"]["score"].as_u64().unwrap(),
                        score + preview["points"]["total"].as_u64().unwrap() + bonus
                    );
                    assert!(result["message"]
                        .as_str()
                        .unwrap()
                        .contains("Quest complete"));
                    return;
                }
            }
            command(&mut game, json!({"type": "autoplay", "count": 1}));
        }
    }
    panic!("no seed offered a quest-completing placement");
}

#[test]
fn a_finished_run_previews_as_over_and_never_aborts() {
    // Play with the planner until victory, finish, then preview every open spot.
    for seed in 0..20 {
        let mut game = Game::new(seed);
        loop {
            let state = command(
                &mut game,
                json!({"type": "autoplay", "count": 1, "policy": "planner"}),
            );
            if state["snapshot"]["victory"] == true || state["ok"] == false {
                break;
            }
        }
        if snapshot(&game)["victory"] != true {
            continue;
        }
        assert_eq!(command(&mut game, json!({"type": "finish"}))["ok"], true);
        let state = snapshot(&game);
        assert_eq!(state["end"], "finished");
        for spot in state["frontier"].as_array().unwrap() {
            for rotation in 0..6 {
                let result = preview(
                    &game,
                    spot["q"].as_i64().unwrap(),
                    spot["r"].as_i64().unwrap(),
                    rotation,
                );
                assert_eq!(result["valid"], false);
                assert!(result["reason"].as_str().unwrap().contains("over"));
            }
        }
        assert_eq!(
            command(&mut game, json!({"type": "newGame", "seed": 1}))["ok"],
            true
        );
        return;
    }
    panic!("no seed reached victory with the planner");
}

#[test]
fn finishing_early_needs_victory() {
    let mut game = Game::new(6);
    let refused = command(&mut game, json!({"type": "finish"}));
    assert_eq!(refused["ok"], false);
    assert!(refused["message"].as_str().unwrap().contains("6000"));
    assert_eq!(refused["snapshot"]["finished"], false);
}

#[test]
fn every_region_appears_across_seeds() {
    let regions: HashSet<String> = (0..60)
        .map(|seed| {
            snapshot(&Game::new(seed))["region"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    assert_eq!(
        regions,
        HashSet::from(["medellin", "salento", "cartagena", "bogota"].map(String::from))
    );
}

fn canonical_partition(ids: impl IntoIterator<Item = Option<u64>>) -> Vec<Option<usize>> {
    let mut labels = std::collections::HashMap::new();
    ids.into_iter()
        .map(|id| {
            id.map(|id| {
                let next = labels.len();
                *labels.entry(id).or_insert(next)
            })
        })
        .collect()
}

fn snapshot_partition(state: &Value) -> Vec<Option<usize>> {
    canonical_partition(state["tiles"].as_array().unwrap().iter().flat_map(|tile| {
        tile["networks"]
            .as_array()
            .unwrap()
            .iter()
            .map(Value::as_u64)
    }))
}

#[test]
fn save_load_preserves_network_partitions_and_connected_homes() {
    let mut game = Game::new(77);
    assert_eq!(
        command(&mut game, json!({"type": "autoplay", "count": 40}))["ok"],
        true
    );
    let before = snapshot(&game);
    let mut loaded = Game::new(1);
    assert_eq!(parse(loaded.load(&game.save()))["ok"], true);
    let after = snapshot(&loaded);
    let positions = |state: &Value| {
        state["tiles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tile| (tile["q"].clone(), tile["r"].clone()))
            .collect::<Vec<_>>()
    };
    assert_eq!(positions(&before), positions(&after));
    assert_eq!(snapshot_partition(&before), snapshot_partition(&after));
    assert_eq!(
        before["stats"]["homesConnected"],
        after["stats"]["homesConnected"]
    );
}

#[test]
fn seeded_walk_and_entrance_partitions_match_an_independent_bfs() {
    use std::collections::{HashMap, VecDeque};

    for seed in 1..=10 {
        let mut game = Game::new(seed);
        assert_eq!(
            command(&mut game, json!({"type": "autoplay", "count": 40}))["ok"],
            true
        );
        let state = snapshot(&game);
        let tiles = state["tiles"].as_array().unwrap();
        let positions: HashMap<_, _> = tiles
            .iter()
            .enumerate()
            .map(|(slot, tile)| {
                (
                    (tile["q"].as_i64().unwrap(), tile["r"].as_i64().unwrap()),
                    slot,
                )
            })
            .collect();
        let mut graph = HashMap::<(usize, u64), Vec<(usize, u64)>>::new();
        for (slot, tile) in tiles.iter().enumerate() {
            for (side, direction) in barrio_core::DIRECTIONS.iter().enumerate() {
                if tile["edges"][side] != "path" {
                    continue;
                }
                let own = (slot, tile["paths"][side].as_u64().unwrap());
                graph.entry(own).or_default();
                let neighbor = (
                    tile["q"].as_i64().unwrap() + i64::from(direction.q),
                    tile["r"].as_i64().unwrap() + i64::from(direction.r),
                );
                let Some(&other_slot) = positions.get(&neighbor) else {
                    continue;
                };
                let other = &tiles[other_slot];
                let facing = (side + 3) % 6;
                let rise = tile["elevation"]
                    .as_u64()
                    .unwrap()
                    .abs_diff(other["elevation"].as_u64().unwrap());
                if other["edges"][facing] == "path" && rise <= 1 {
                    graph
                        .entry(own)
                        .or_default()
                        .push((other_slot, other["paths"][facing].as_u64().unwrap()));
                    assert_eq!(tile["meets"][side], "match");
                    assert!(tile["networks"][side].is_u64());
                    assert_eq!(
                        tile["networks"][side], other["networks"][facing],
                        "seed {seed}, tile {slot}, side {side}"
                    );
                }
            }
        }
        let mut components = HashMap::new();
        for &start in graph.keys() {
            if components.contains_key(&start) {
                continue;
            }
            let label = components.len() as u64;
            components.insert(start, label);
            let mut queue = VecDeque::from([start]);
            while let Some(node) = queue.pop_front() {
                for &next in &graph[&node] {
                    if let std::collections::hash_map::Entry::Vacant(entry) = components.entry(next)
                    {
                        entry.insert(label);
                        queue.push_back(next);
                    }
                }
            }
        }
        let mut expected = Vec::new();
        let mut observed = Vec::new();
        let mut homes = HashMap::<u64, u64>::new();
        for (slot, tile) in tiles.iter().enumerate() {
            for side in 0..6 {
                let group = match tile["edges"][side].as_str().unwrap() {
                    "path" => tile["paths"][side].as_u64(),
                    "homes" => tile["entrances"][side].as_u64(),
                    _ => continue,
                };
                let component = group.map(|group| components[&(slot, group)]);
                expected.push(component);
                observed.push(tile["networks"][side].as_u64());
                if tile["edges"][side] == "homes" {
                    if let Some(component) = component {
                        *homes.entry(component).or_default() += 1;
                    }
                }
            }
        }
        assert_eq!(
            canonical_partition(observed),
            canonical_partition(expected),
            "seed {seed}"
        );
        assert_eq!(
            state["stats"]["homesConnected"].as_u64().unwrap(),
            homes.values().copied().max().unwrap_or(0),
            "seed {seed}"
        );
    }
}
