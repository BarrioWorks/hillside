use std::collections::HashSet;

use barrio_core::Game;
use serde_json::{json, Value};

fn snapshot(game: &Game) -> Value {
    serde_json::from_str(&game.snapshot()).unwrap()
}

fn command(game: &mut Game, command: Value) -> Value {
    serde_json::from_str(&game.command(&command.to_string())).unwrap()
}

fn save(game: &Game) -> Value {
    serde_json::from_str(&game.save()).unwrap()
}

fn load(game: &mut Game, save: &Value) -> Value {
    serde_json::from_str(&game.load(&save.to_string())).unwrap()
}

fn empty_save(seed: u32) -> Value {
    json!({"version":1,"terrainId":"hillside-v1","seed":seed,"width":32,"depth":32,"nextId":1,"structures":[]})
}

fn empty(seed: u32) -> Game {
    let mut game = Game::new(seed);
    assert_eq!(load(&mut game, &empty_save(seed))["ok"], true);
    game
}

fn preview(game: &Game, kind: &str, x: u32, z: u32, rotation: u32) -> Value {
    serde_json::from_str(&game.preview(kind, x.into(), z.into(), rotation.into())).unwrap()
}

fn place(game: &mut Game, kind: &str, x: u32, z: u32, rotation: u32) -> Value {
    let result = command(
        game,
        json!({"type":"place","kind":kind,"x":x,"z":z,"rotation":rotation}),
    );
    assert_eq!(result["ok"], true, "{result}");
    result
}

fn height(state: &Value, x: u32, z: u32) -> u64 {
    state["cells"][(z * 32 + x) as usize]["height"]
        .as_u64()
        .unwrap()
}

fn stairs_location(state: &Value) -> (u32, u32) {
    let x = 4;
    let z = (2..30)
        .find(|&z| {
            height(state, x, z - 1) == height(state, x, z) + 1
                && height(state, x, z + 2) == height(state, x, z)
                && height(state, x, z - 2) == height(state, x, z - 1)
        })
        .unwrap();
    (x, z)
}

#[test]
fn api_matches_camel_case_contract_and_complete_catalog() {
    let game = Game::new(42);
    let state = snapshot(&game);
    let keys: HashSet<_> = state
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        HashSet::from([
            "seed",
            "width",
            "depth",
            "cells",
            "structures",
            "canUndo",
            "canRedo",
            "connected",
            "revision"
        ])
    );
    assert_eq!(state["canUndo"], false);
    assert_eq!(state["canRedo"], false);
    let catalog: Value = serde_json::from_str(&game.catalog()).unwrap();
    assert_eq!(catalog.as_array().unwrap().len(), 11);
    let ids: HashSet<_> = catalog
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids,
        HashSet::from([
            "casa", "tienda", "torre", "terraza", "taller", "esquina", "path", "stairs", "tree",
            "planter", "bench"
        ])
    );
    assert_eq!(
        catalog
            .as_array()
            .unwrap()
            .iter()
            .filter(|entry| entry["category"] == "building")
            .count(),
        6
    );
    assert!(state["connected"].as_u64().unwrap() >= 10);
}

#[test]
fn terrain_is_deterministic_seeded_terraced_and_bounded() {
    let game = Game::new(123);
    assert_eq!(game.snapshot(), Game::new(123).snapshot());
    let state = snapshot(&game);
    assert_eq!(state["width"], 32);
    assert_eq!(state["depth"], 32);
    assert_eq!(state["cells"].as_array().unwrap().len(), 1024);
    let mut levels = HashSet::new();
    let mut flat_squares = 0;
    for z in 0..32 {
        for x in 0..32 {
            let h = height(&state, x, z);
            levels.insert(h);
            assert!(h <= 5);
            if x < 31 {
                assert!(h.abs_diff(height(&state, x + 1, z)) <= 1);
            }
            if z < 31 {
                assert!(h.abs_diff(height(&state, x, z + 1)) <= 1);
            }
            if x < 31
                && z < 31
                && [(x + 1, z), (x, z + 1), (x + 1, z + 1)]
                    .iter()
                    .all(|&(x, z)| height(&state, x, z) == h)
            {
                flat_squares += 1;
            }
        }
    }
    assert_eq!(levels.len(), 6);
    assert!(flat_squares > 500);
    let maps: HashSet<_> = (0..64)
        .map(|seed| snapshot(&Game::new(seed))["cells"].to_string())
        .collect();
    assert!(maps.len() > 20);
}

#[test]
fn starters_have_all_buildings_valid_stairs_props_and_stable_variations() {
    for seed in 0..48 {
        let game = Game::new(seed);
        let state = snapshot(&game);
        let kinds: HashSet<_> = state["structures"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["kind"].as_str().unwrap())
            .collect();
        for kind in [
            "casa", "tienda", "torre", "terraza", "taller", "esquina", "path", "stairs", "tree",
            "planter", "bench",
        ] {
            assert!(kinds.contains(kind), "missing {kind} at seed {seed}");
        }
        let mut other = empty(seed);
        assert_eq!(load(&mut other, &save(&game))["ok"], true);
        assert_eq!(state["structures"], snapshot(&other)["structures"]);
        assert_eq!(state["connected"], snapshot(&other)["connected"]);
        assert_eq!(
            state["structures"],
            snapshot(&Game::new(seed))["structures"]
        );
    }
}

#[test]
fn footprints_rotate_collide_and_remove_from_every_occupied_cell() {
    for (rotation, width, depth) in [(0, 2, 1), (1, 1, 2), (2, 2, 1), (3, 1, 2)] {
        let mut game = empty(7);
        let p = preview(&game, "tienda", 4, 10, rotation);
        assert_eq!(p["width"], width);
        assert_eq!(p["depth"], depth);
        assert_eq!(p["valid"], true);
        place(&mut game, "tienda", 4, 10, rotation);
        for z in 10..10 + depth {
            for x in 4..4 + width {
                assert_eq!(preview(&game, "casa", x, z, 0)["valid"], false);
            }
        }
        let removed = command(
            &mut game,
            json!({"type":"remove","x":4+width-1,"z":10+depth-1}),
        );
        assert_eq!(removed["ok"], true);
        assert!(snapshot(&game)["structures"].as_array().unwrap().is_empty());
        assert_eq!(preview(&game, "tienda", 4, 10, rotation)["valid"], true);
    }
    let mut game = empty(0);
    place(&mut game, "terraza", 4, 10, 0);
    assert_eq!(preview(&game, "torre", 5, 11, 0)["valid"], false);
    assert_eq!(preview(&game, "tienda", 31, 10, 0)["valid"], false);
    assert_eq!(preview(&game, "tienda", 31, 10, 1)["valid"], true);
    assert_eq!(preview(&game, "esquina", 31, 10, 1)["valid"], false);
}

#[test]
fn buildings_reject_slopes_and_previews_reject_invalid_numeric_input() {
    let mut game = empty(11);
    let state = snapshot(&game);
    let (x, z) = stairs_location(&state);
    let p = preview(&game, "terraza", x, z - 1, 0);
    assert_eq!(p["valid"], false);
    assert!(p["reason"].as_str().unwrap().contains("flat"));
    for (x, z, r) in [
        (-1.0, 0.0, 0.0),
        (0.5, 0.0, 0.0),
        (0.0, f64::NAN, 0.0),
        (0.0, 0.0, 0.5),
        (0.0, 0.0, 4.0),
        (f64::INFINITY, 0.0, 0.0),
        (f64::from(u32::MAX), 0.0, 0.0),
    ] {
        let p: Value = serde_json::from_str(&game.preview("casa", x, z, r)).unwrap();
        assert_eq!(p["valid"], false);
    }
    let before = game.snapshot();
    for action in [
        json!({"type":"place","kind":"casa","x":-1,"z":0,"rotation":0}),
        json!({"type":"place","kind":"casa","x":0.5,"z":0,"rotation":0}),
        json!({"type":"place","kind":"unknown","x":0,"z":0,"rotation":0}),
        json!({"type":"place","kind":"casa","x":4294967295_u32,"z":0,"rotation":0}),
        json!({"type":"place","kind":"casa","x":0,"z":0,"rotation":4}),
        json!({"type":"remove","x":4294967295_u32,"z":0}),
        json!({"type":"fly"}),
        json!({"type":"undo","extra":true}),
    ] {
        assert_eq!(command(&mut game, action)["ok"], false);
        assert_eq!(game.snapshot(), before);
    }
}

#[test]
fn stairs_face_one_step_uphill_and_connect_path_networks_across_elevations() {
    let mut game = empty(5);
    let state = snapshot(&game);
    let (x, z) = stairs_location(&state);
    for rotation in 0..4 {
        assert_eq!(
            preview(&game, "stairs", x, z, rotation)["valid"],
            rotation == 2
        );
    }
    assert_eq!(preview(&game, "stairs", x, 10, 0)["valid"], false);
    place(&mut game, "path", x, z + 1, 0);
    place(&mut game, "casa", x, z + 2, 0);
    place(&mut game, "path", x, z - 1, 0);
    place(&mut game, "casa", x, z - 2, 0);
    assert_eq!(snapshot(&game)["connected"], 1);
    place(&mut game, "path", x, z, 0);
    assert_eq!(snapshot(&game)["connected"], 1);
    command(&mut game, json!({"type":"remove","x":x,"z":z}));
    place(&mut game, "stairs", x, z, 2);
    assert_eq!(snapshot(&game)["connected"], 2);
    command(&mut game, json!({"type":"remove","x":x,"z":z-1}));
    assert_eq!(snapshot(&game)["connected"], 1);
    command(&mut game, json!({"type":"undo"}));
    assert_eq!(snapshot(&game)["connected"], 2);
}

#[test]
fn connectivity_counts_each_multicell_building_once_and_excludes_props() {
    let mut game = empty(0);
    place(&mut game, "terraza", 4, 10, 0);
    place(&mut game, "path", 4, 12, 0);
    place(&mut game, "path", 5, 12, 0);
    place(&mut game, "bench", 6, 12, 0);
    assert_eq!(snapshot(&game)["connected"], 1);
}

#[test]
fn save_load_roundtrip_is_versioned_and_atomic() {
    let mut game = Game::new(888);
    let serialized = game.save();
    let original = snapshot(&game);
    let result: Value = serde_json::from_str(&game.load(&serialized)).unwrap();
    assert_eq!(result["ok"], true);
    assert_eq!(game.save(), serialized);
    assert_eq!(snapshot(&game)["structures"], original["structures"]);
    assert_eq!(snapshot(&game)["cells"], original["cells"]);
    assert_eq!(snapshot(&game)["connected"], original["connected"]);
    assert_eq!(snapshot(&game)["revision"], 1);
    assert_eq!(save(&game)["version"], 1);
    assert_eq!(save(&game)["terrainId"], "hillside-v2");
    let mut other = Game::new(33);
    assert_eq!(load(&mut other, &save(&game))["ok"], true);
    assert_eq!(
        snapshot(&other)["structures"],
        snapshot(&game)["structures"]
    );
    assert_eq!(snapshot(&other)["cells"], snapshot(&game)["cells"]);
}

#[test]
fn legacy_banded_saves_keep_their_original_terrain() {
    let mut legacy = Game::new(7);
    assert_eq!(load(&mut legacy, &empty_save(7))["ok"], true);
    assert_eq!(save(&legacy)["terrainId"], "hillside-v1");
    let state = snapshot(&legacy);
    for z in 0..32 {
        for x in 0..32 {
            assert_eq!(height(&state, x, z), height(&state, x - x % 8, z));
        }
    }
    assert_ne!(state["cells"], snapshot(&Game::new(7))["cells"]);
    command(&mut legacy, json!({"type":"reset","seed":7}));
    assert_eq!(save(&legacy)["terrainId"], "hillside-v2");
}

#[test]
fn unsupported_or_missing_terrain_is_rejected_atomically() {
    let mut game = Game::new(2026);
    command(&mut game, json!({"type":"benchmark"}));
    command(&mut game, json!({"type":"undo"}));
    let before_snapshot = game.snapshot();
    let before_save = save(&game);
    let mut unsupported = before_save.clone();
    unsupported["terrainId"] = json!("hillside-v9");
    let result = load(&mut game, &unsupported);
    assert_eq!(result["ok"], false);
    assert!(result["message"]
        .as_str()
        .unwrap()
        .contains("unsupported terrain"));
    assert_eq!(game.snapshot(), before_snapshot);
    assert_eq!(save(&game), before_save);
    let mut missing = before_save.clone();
    missing.as_object_mut().unwrap().remove("terrainId");
    assert_eq!(load(&mut game, &missing)["ok"], false);
    assert_eq!(game.snapshot(), before_snapshot);
    assert_eq!(save(&game), before_save);
    assert_eq!(snapshot(&game)["canRedo"], true);
}

#[test]
fn malformed_saves_never_change_world_history_allocator_or_revision() {
    let mut game = Game::new(18);
    place(&mut game, "casa", 4, 10, 0);
    assert_eq!(command(&mut game, json!({"type":"undo"}))["ok"], true);
    let valid = save(&game);
    let before = game.snapshot();
    let mut cases = Vec::new();
    for (key, value) in [
        ("version", json!(2)),
        ("width", json!(31)),
        ("depth", json!(64)),
        ("nextId", json!(0)),
        ("nextId", json!(-1)),
        ("nextId", json!(0.5)),
        ("nextId", json!(4294967296_u64)),
        ("seed", json!(-1)),
        ("seed", json!(0.5)),
        ("seed", json!(4294967296_u64)),
        ("cells", json!([])),
    ] {
        let mut bad = valid.clone();
        bad[key] = value;
        cases.push(bad);
    }
    for (key, value) in [
        ("id", json!(0)),
        ("id", valid["nextId"].clone()),
        ("kind", json!("unknown")),
        ("x", json!(32)),
        ("x", json!(4294967295_u32)),
        ("z", json!(-1)),
        ("rotation", json!(4)),
        ("variation", json!(16)),
        ("height", json!(999)),
    ] {
        let mut bad = valid.clone();
        bad["structures"][0][key] = value;
        cases.push(bad);
    }
    let mut duplicate = valid.clone();
    let item = duplicate["structures"][0].clone();
    duplicate["structures"]
        .as_array_mut()
        .unwrap()
        .push(item.clone());
    cases.push(duplicate);
    let mut overlap = valid.clone();
    let mut item2 = item.clone();
    item2["id"] = json!(100_000);
    overlap["nextId"] = json!(100_001);
    overlap["structures"].as_array_mut().unwrap().push(item2);
    cases.push(overlap);
    let mut crowded = valid.clone();
    crowded["structures"] = json!(vec![item; 1025]);
    cases.push(crowded);
    for (id, next_id) in [(u32::MAX, u32::MAX), (u32::MAX - 1, u32::MAX - 1)] {
        let mut bad = valid.clone();
        bad["structures"][0]["id"] = json!(id);
        bad["nextId"] = json!(next_id);
        cases.push(bad);
    }
    for bad in cases {
        assert_eq!(load(&mut game, &bad)["ok"], false, "accepted {bad}");
        assert_eq!(game.snapshot(), before);
        assert_eq!(save(&game), valid);
    }
    for bad in [
        "".to_string(),
        "{".to_string(),
        "null".to_string(),
        "[]".to_string(),
        " ".repeat(256 * 1024 + 1),
    ] {
        let result: Value = serde_json::from_str(&game.load(&bad)).unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(game.snapshot(), before);
    }
}

#[test]
fn undo_redo_restore_exact_placements_and_new_edits_clear_redo() {
    let mut game = empty(77);
    let first = place(&mut game, "tienda", 4, 10, 0)["snapshot"]["structures"].clone();
    let first_id = first[0]["id"].as_u64().unwrap();
    command(&mut game, json!({"type":"remove","x":5,"z":10}));
    assert!(snapshot(&game)["structures"].as_array().unwrap().is_empty());
    command(&mut game, json!({"type":"undo"}));
    assert_eq!(snapshot(&game)["structures"], first);
    assert_eq!(snapshot(&game)["canRedo"], true);
    command(&mut game, json!({"type":"redo"}));
    assert!(snapshot(&game)["structures"].as_array().unwrap().is_empty());
    command(&mut game, json!({"type":"undo"}));
    command(&mut game, json!({"type":"undo"}));
    place(&mut game, "casa", 4, 10, 0);
    assert!(snapshot(&game)["structures"][0]["id"].as_u64().unwrap() > first_id);
    assert_eq!(snapshot(&game)["canRedo"], false);
    assert_eq!(command(&mut game, json!({"type":"redo"}))["ok"], false);
}

#[test]
fn reset_and_load_are_undoable_and_reset_regenerates_seeded_terrain() {
    let mut game = Game::new(17);
    let before = snapshot(&game);
    assert_eq!(
        command(&mut game, json!({"type":"reset","seed":123}))["ok"],
        true
    );
    assert_eq!(snapshot(&game)["cells"], snapshot(&Game::new(123))["cells"]);
    assert_eq!(snapshot(&game)["seed"], 123);
    assert_ne!(snapshot(&game)["structures"], before["structures"]);
    command(&mut game, json!({"type":"undo"}));
    assert_eq!(snapshot(&game)["structures"], before["structures"]);
    assert_eq!(snapshot(&game)["cells"], before["cells"]);
    assert_eq!(load(&mut game, &empty_save(999))["ok"], true);
    assert!(snapshot(&game)["structures"].as_array().unwrap().is_empty());
    command(&mut game, json!({"type":"undo"}));
    assert_eq!(snapshot(&game)["structures"], before["structures"]);
    assert_eq!(snapshot(&game)["seed"], 17);
}

#[test]
fn history_is_bounded_and_failed_edits_preserve_redo() {
    let mut game = empty(2);
    for _ in 0..40 {
        place(&mut game, "casa", 4, 10, 0);
        command(&mut game, json!({"type":"remove","x":4,"z":10}));
    }
    let mut count = 0;
    while snapshot(&game)["canUndo"] == true {
        assert_eq!(command(&mut game, json!({"type":"undo"}))["ok"], true);
        count += 1;
    }
    assert_eq!(count, 64);
    let before = game.snapshot();
    assert_eq!(
        command(&mut game, json!({"type":"remove","x":31,"z":31}))["ok"],
        false
    );
    assert_eq!(game.snapshot(), before);
    assert_eq!(snapshot(&game)["canRedo"], true);
}

#[test]
fn benchmark_generates_over_500_valid_deterministic_structures_and_can_be_undone() {
    let mut game = Game::new(2026);
    let before = snapshot(&game)["structures"].clone();
    let result = command(&mut game, json!({"type":"benchmark"}));
    assert_eq!(result["ok"], true);
    let state = snapshot(&game);
    let structures = state["structures"].as_array().unwrap();
    assert!(structures.len() >= 1000);
    let houses = structures
        .iter()
        .filter(|s| s["kind"] == "casa" || s["kind"] == "torre")
        .count();
    assert!(houses >= 500, "only {houses} buildings");
    let mut other = Game::new(2026);
    command(&mut other, json!({"type":"benchmark"}));
    assert_eq!(snapshot(&other)["structures"], state["structures"]);
    assert_eq!(load(&mut other, &save(&game))["ok"], true);
    assert_eq!(snapshot(&other)["structures"], state["structures"]);
    assert!(game.save().len() < 256 * 1024);
    command(&mut game, json!({"type":"undo"}));
    assert_eq!(snapshot(&game)["structures"], before);
    command(&mut game, json!({"type":"redo"}));
    assert_eq!(snapshot(&game)["structures"], state["structures"]);
}

#[test]
fn imported_allocator_cannot_poison_edits_after_load_undo_or_clean_load() {
    for next_id in [u32::MAX, u32::MAX - 1, u32::MAX - 1023, u32::MAX - 1024] {
        for recovery in ["direct", "undo", "clean load"] {
            for action in [
                json!({"type":"place","kind":"casa","x":4,"z":10,"rotation":0}),
                json!({"type":"reset","seed":4}),
                json!({"type":"benchmark"}),
            ] {
                let mut game = Game::new(1);
                let clean = save(&game);
                let mut file = clean.clone();
                file["nextId"] = json!(next_id);
                assert_eq!(load(&mut game, &file)["ok"], true);
                match recovery {
                    "undo" => assert_eq!(command(&mut game, json!({"type":"undo"}))["ok"], true),
                    "clean load" => assert_eq!(load(&mut game, &clean)["ok"], true),
                    _ => {}
                }
                assert_eq!(snapshot(&game)["structures"], clean["structures"]);
                let result = command(&mut game, action.clone());
                assert_eq!(
                    result["ok"], true,
                    "{next_id}, {recovery}, {action}: {}",
                    result["message"]
                );
                let structures = result["snapshot"]["structures"].as_array().unwrap();
                let ids: HashSet<_> = structures
                    .iter()
                    .map(|item| item["id"].as_u64().unwrap())
                    .collect();
                assert_eq!(ids.len(), structures.len());
                if action["type"] != "place" {
                    for item in clean["structures"].as_array().unwrap() {
                        assert!(!ids.contains(&item["id"].as_u64().unwrap()));
                    }
                }
                let mut clone = Game::new(9);
                assert_eq!(load(&mut clone, &save(&game))["ok"], true);
                assert_eq!(
                    snapshot(&clone)["structures"],
                    snapshot(&game)["structures"]
                );
            }
        }
    }
}

#[test]
fn allocator_wrap_preserves_boundary_ids_and_reserves_undo_and_redo_structures() {
    let mut game = empty(1);
    let starter_ids: HashSet<_> = snapshot(&Game::new(1))["structures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_u64().unwrap())
        .collect();
    let mut file = empty_save(1);
    file["nextId"] = json!(u32::MAX - 1);
    file["structures"] = json!([
        {"id":u32::MAX-2,"kind":"torre","x":6,"z":10,"rotation":0,"variation":3}
    ]);
    assert_eq!(load(&mut game, &file)["ok"], true);
    let first = place(&mut game, "casa", 4, 10, 0)["snapshot"]["structures"].clone();
    assert_eq!(first[1]["id"], u32::MAX - 1);
    let wrapped = place(&mut game, "bench", 5, 10, 0)["snapshot"]["structures"].clone();
    let wrapped_id = wrapped[2]["id"].as_u64().unwrap();
    assert!(!starter_ids.contains(&wrapped_id));
    assert!(wrapped_id < u64::from(u32::MAX - 2));
    let mut clone = Game::new(99);
    assert_eq!(load(&mut clone, &save(&game))["ok"], true);
    assert_eq!(snapshot(&clone)["structures"], wrapped);
    assert_eq!(command(&mut game, json!({"type":"undo"}))["ok"], true);
    assert_eq!(snapshot(&game)["structures"], first);
    assert_eq!(command(&mut game, json!({"type":"redo"}))["ok"], true);
    assert_eq!(snapshot(&game)["structures"], wrapped);
    assert_eq!(command(&mut game, json!({"type":"undo"}))["ok"], true);
    let mut high_cursor = save(&game);
    high_cursor["nextId"] = json!(u32::MAX);
    high_cursor["structures"]
        .as_array_mut()
        .unwrap()
        .push(wrapped[2].clone());
    assert_eq!(load(&mut game, &high_cursor)["ok"], true);
    assert_eq!(command(&mut game, json!({"type":"undo"}))["ok"], true);
    assert_eq!(snapshot(&game)["structures"], first);
    assert_eq!(snapshot(&game)["canRedo"], true);
    let after = place(&mut game, "tree", 5, 10, 0)["snapshot"]["structures"].clone();
    let new_id = after[2]["id"].as_u64().unwrap();
    assert!(!starter_ids.contains(&new_id));
    assert_ne!(new_id, wrapped_id);
    assert_eq!(after[0], first[0]);
    assert_eq!(after[1], first[1]);
    assert_eq!(snapshot(&game)["canRedo"], false);
}
