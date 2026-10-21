mod board;
mod deck;
mod hex;
mod network;
pub mod play;
mod quest;
mod region;
mod rng;
mod run;
mod score;
mod terrain;
mod tile;

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

pub use board::{Board, Placed, Placement, Stats};
pub use hex::{Hex, DIRECTIONS};
pub use play::Policy;
pub use quest::{Quest, QuestFamily, QuestState, Tier};
pub use region::{Region, REGIONS};
pub use rng::Rng;
pub use run::{Action, End, Run, MILESTONES, VICTORY};
pub use tile::{meet, Edge, Family, Kind, Meet, TileSpec, EDGES, KINDS};

use hex::SIDES;
use tile::entrances;

const SAVE_VERSION: u32 = 3;
/// The rules a save or high score was made under. Change it whenever scoring or generation changes.
pub const RULES: &str = "classic-2";
const MAX_SAVE_BYTES: usize = 256 * 1024;
const MAX_COMMAND_BYTES: usize = 4096;
/// More actions than any run can take: the deck never holds more than the cap, and rewards are finite.
const MAX_ACTIONS: usize = 1000;
const MAX_AUTOPLAY: u32 = 400;
/// Tiles shown after the current one.
const UPCOMING: usize = 2;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TileView {
    q: i32,
    r: i32,
    kind: Kind,
    family: Family,
    /// Edges as placed, already rotated, indexed by direction.
    edges: [Edge; SIDES],
    /// Path group per side, rotated; zero where there is no path.
    paths: [u8; SIDES],
    /// The path group each home's entrance opens onto, per side, rotated.
    entrances: [Option<u8>; SIDES],
    /// Network id per side: path, nature and water edges, and for homes the walk their entrance
    /// opens onto; None for a home with no entrance path.
    networks: [Option<u32>; SIDES],
    /// How each side meets its neighbor now; the renderer draws joins, stairs and path ends from this.
    meets: [Meet; SIDES],
    rotation: u32,
    variation: u32,
    elevation: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Spot {
    q: i32,
    r: i32,
    elevation: u32,
    /// Whether the current tile fits here in some rotation.
    playable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HandTile {
    kind: Kind,
    family: Family,
    edges: [Edge; SIDES],
    paths: [u8; SIDES],
    entrances: [Option<u8>; SIDES],
}

impl From<&TileSpec> for HandTile {
    fn from(spec: &TileSpec) -> Self {
        Self {
            kind: spec.kind,
            family: spec.kind.family(),
            edges: spec.edges,
            paths: spec.paths,
            entrances: spec.entrances(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MilestoneView {
    name: &'static str,
    score: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QuestsView {
    /// Up to three quests still on the ladder: active, or set aside while out of reach.
    current: Vec<Quest>,
    /// Completed quests in order.
    history: Vec<Quest>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    rules: &'static str,
    seed: u32,
    region: Region,
    region_name: &'static str,
    tiles: Vec<TileView>,
    frontier: Vec<Spot>,
    current: Option<HandTile>,
    upcoming: Vec<HandTile>,
    remaining: u32,
    can_skip: bool,
    skip_used: bool,
    score: u32,
    placements: u32,
    finished: bool,
    end: Option<End>,
    /// The highest milestone reached and the next one to reach.
    milestone: Option<&'static str>,
    next_milestone: Option<MilestoneView>,
    victory: bool,
    victory_at: Option<u32>,
    quests: QuestsView,
    /// Reward tiles earned so far, and how many the deck cap discarded.
    rewards: u32,
    discarded: u32,
    cap: u32,
    recoveries: u32,
    /// What the safety rule did after the last action: `swapped` or `replaced`.
    recovery: Option<run::Recovery>,
    last: Option<run::Outcome>,
    stats: Stats,
    revision: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult {
    ok: bool,
    message: String,
    snapshot: Snapshot,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewResult {
    #[serde(flatten)]
    placement: Placement,
    /// Rotations of the current tile that are valid at this spot.
    valid_rotations: Vec<u32>,
    /// The visual variation the tile would get here, so the preview matches the placed tile.
    variation: u32,
    /// Quests this placement would complete, found by applying it to a copy of the run.
    completes: Vec<Quest>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Command {
    Place {
        q: i32,
        r: i32,
        rotation: u32,
    },
    Skip {},
    /// Ends a victorious run early.
    Finish {},
    NewGame {
        seed: u32,
    },
    /// Places up to `count` tiles with a computer player (greedy unless `policy` names another); used for
    /// demonstrations, captures and benchmarks.
    Autoplay {
        count: u32,
        policy: Option<String>,
    },
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Save {
    version: u32,
    rules: String,
    seed: u32,
    actions: Vec<Action>,
}

#[derive(Deserialize)]
struct SaveVersion {
    version: u32,
}

#[wasm_bindgen]
pub struct Game {
    run: Run,
    revision: u32,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> Self {
        Self {
            run: Run::new(seed),
            revision: 0,
        }
    }

    pub fn snapshot(&self) -> String {
        json(&self.snapshot_value())
    }

    /// Evaluates placing the current tile at `(q, r)` with `rotation`.
    pub fn preview(&self, q: f64, r: f64, rotation: f64) -> String {
        let (Some(q), Some(r), Some(rotation)) = (integer(q), integer(r), integer(rotation)) else {
            let mut placement = self.run.preview(Hex::ORIGIN, 0);
            placement.valid = false;
            placement.reason = if integer(q).is_some() && integer(r).is_some() {
                "Rotation must be a whole number from 0 to 5."
            } else {
                "Coordinates must be whole numbers."
            }
            .into();
            return json(&PreviewResult {
                placement,
                valid_rotations: Vec::new(),
                variation: 0,
                completes: Vec::new(),
            });
        };
        let rotation = u32::try_from(rotation).unwrap_or(u32::MAX);
        let hex = Hex::new(q, r);
        let board = &self.run.board;
        let placement = self.run.preview(hex, rotation);
        let completes = if placement.valid {
            // A valid preview always places; if it ever did not, report no quests rather than abort.
            let mut trial = self.run.clone();
            match trial.apply(Action::Place { q, r, rotation }) {
                Ok(()) => trial
                    .last
                    .map(|last| last.completed.into_iter().map(|done| done.quest).collect())
                    .unwrap_or_default(),
                Err(_) => Vec::new(),
            }
        } else {
            Vec::new()
        };
        json(&PreviewResult {
            placement,
            completes,
            valid_rotations: match self.run.current() {
                Some(spec) => (0..SIDES as u32)
                    .filter(|&turn| board.evaluate_legality(spec, hex, turn))
                    .collect(),
                None => Vec::new(),
            },
            variation: run::variation(self.run.seed, hex, board.tiles.len() as u32),
        })
    }

    pub fn command(&mut self, input: &str) -> String {
        if input.len() > MAX_COMMAND_BYTES {
            return self.result(false, "This action is too large.");
        }
        let Ok(command) = serde_json::from_str::<Command>(input) else {
            return self.result(
                false,
                "This action is not valid. Use a known action and whole-number coordinates.",
            );
        };
        match self.execute(command) {
            Ok(message) => {
                self.revision = self.revision.wrapping_add(1);
                self.result(true, message)
            }
            Err(message) => self.result(false, message),
        }
    }

    pub fn save(&self) -> String {
        json(&Save {
            version: SAVE_VERSION,
            rules: RULES.into(),
            seed: self.run.seed,
            actions: self.run.actions.clone(),
        })
    }

    /// Restores a saved run exactly by replaying its actions.
    pub fn load(&mut self, input: &str) -> String {
        match replay(input) {
            Ok(run) => {
                self.run = run;
                self.revision = self.revision.wrapping_add(1);
                self.result(true, "Welcome back to your neighborhood.")
            }
            Err(message) => self.result(false, message),
        }
    }

    /// Same as `load`; kept for the autosave path.
    pub fn restore(&mut self, input: &str) -> String {
        self.load(input)
    }
}

impl Game {
    fn snapshot_value(&self) -> Snapshot {
        let run = &self.run;
        let board = &run.board;
        let networks = board.networks();
        let current = run.current();
        Snapshot {
            rules: RULES,
            seed: run.seed,
            region: run.region,
            region_name: run.region.name(),
            tiles: board
                .tiles
                .iter()
                .enumerate()
                .map(|(slot, tile)| {
                    let spec = tile.spec();
                    let edges = spec.rotated(tile.rotation);
                    let paths = spec.rotated_paths(tile.rotation);
                    let entrances = entrances(&edges, &paths);
                    let nodes = board.nodes(slot);
                    TileView {
                        q: tile.q,
                        r: tile.r,
                        kind: tile.kind,
                        family: tile.kind.family(),
                        edges,
                        paths,
                        entrances,
                        networks: std::array::from_fn(|side| {
                            let node = nodes[side].or_else(|| {
                                let group = entrances[side]?;
                                (0..SIDES)
                                    .find(|&path| edges[path] == Edge::Path && paths[path] == group)
                                    .and_then(|path| nodes[path])
                            });
                            node.map(|node| networks.network(node))
                        }),
                        meets: board.meets(slot),
                        rotation: tile.rotation,
                        variation: tile.variation,
                        elevation: board.elevation(tile.hex()),
                    }
                })
                .collect(),
            frontier: board
                .frontier()
                .into_iter()
                .map(|hex| Spot {
                    q: hex.q,
                    r: hex.r,
                    elevation: board.elevation(hex),
                    playable: current.is_some_and(|spec| {
                        (0..SIDES as u32).any(|turn| board.evaluate_legality(spec, hex, turn))
                    }),
                })
                .collect(),
            current: current.map(HandTile::from),
            upcoming: run
                .deck
                .iter()
                .skip(1)
                .take(UPCOMING)
                .map(HandTile::from)
                .collect(),
            remaining: run.deck.len() as u32,
            can_skip: run.can_skip(),
            skip_used: run.skip_used,
            score: run.score,
            placements: run.placements,
            finished: run.finished(),
            end: run.end,
            milestone: run.milestone(),
            next_milestone: MILESTONES
                .get(run.milestones)
                .map(|&(score, name)| MilestoneView { name, score }),
            victory: run.victory_at.is_some(),
            victory_at: run.victory_at,
            quests: QuestsView {
                current: run.quests.current.clone(),
                history: run.quests.history.clone(),
            },
            rewards: run.rewards,
            discarded: run.discarded,
            cap: deck::CAP,
            recoveries: run.recoveries,
            recovery: run.recovery,
            last: run.last.clone(),
            stats: board.stats(),
            revision: self.revision,
        }
    }

    fn result(&self, ok: bool, message: impl Into<String>) -> String {
        json(&CommandResult {
            ok,
            message: message.into(),
            snapshot: self.snapshot_value(),
        })
    }

    fn execute(&mut self, command: Command) -> Result<String, String> {
        match command {
            Command::Place { q, r, rotation } => {
                self.run.apply(Action::Place { q, r, rotation })?;
                Ok(placement_message(&self.run))
            }
            Command::Finish {} => {
                self.run.apply(Action::Finish {})?;
                Ok("Run finished. Here is your neighborhood.".into())
            }
            Command::Skip {} => {
                self.run.apply(Action::Skip {})?;
                Ok("Tile moved to the back of the deck.".into())
            }
            Command::NewGame { seed } => {
                self.run = Run::new(seed);
                Ok(format!("A new neighborhood in {}.", self.run.region.name()))
            }
            Command::Autoplay { count, policy } => {
                let policy = match policy.as_deref() {
                    None => Policy::Greedy,
                    Some(name) => play::POLICIES
                        .into_iter()
                        .find(|policy| policy.name() == name)
                        .ok_or_else(|| format!("There is no player called {name}."))?,
                };
                if count == 0 || count > MAX_AUTOPLAY {
                    return Err(format!(
                        "Autoplay places between 1 and {MAX_AUTOPLAY} tiles."
                    ));
                }
                let mut rng = Rng::new(self.run.seed ^ self.run.placements, 0x6175_746f);
                let mut placed = 0;
                while placed < count {
                    let Some(action) = play::choose(&self.run, policy, &mut rng) else {
                        break;
                    };
                    self.run
                        .apply(action)
                        .expect("the player only picks legal moves");
                    placed += 1;
                }
                if placed == 0 {
                    return Err("There are no tiles left to place.".into());
                }
                Ok("The neighborhood grew.".into())
            }
        }
    }
}

/// The toast after a placement: its points, then any quests, milestone, victory, and the end of the run.
fn placement_message(run: &Run) -> String {
    let last = run.last.as_ref().expect("a placement records its outcome");
    let mut message = match last.label {
        Some(label) => format!("+{} · {label}", last.points.total),
        None => format!("+{}", last.points.total),
    };
    let plural = |count: u32| if count == 1 { "tile" } else { "tiles" };
    for done in &last.completed {
        message.push_str(&format!(
            " Quest complete: +{} and +{} {}.",
            done.quest.points,
            done.tiles_added,
            plural(done.tiles_added)
        ));
        if done.tiles_discarded > 0 {
            message.push_str(&format!(
                " The deck is full, so {} reward {} discarded.",
                done.tiles_discarded,
                if done.tiles_discarded == 1 {
                    "tile was"
                } else {
                    "tiles were"
                }
            ));
        }
    }
    if last.victory {
        message.push_str(" Thriving Barrio! You reached victory.");
    } else if let Some(name) = last.milestone {
        message.push_str(&format!(" Milestone reached: {name}."));
    }
    if run.end == Some(End::DeckEmpty) {
        message.push_str(" The deck is empty: the run is complete.");
    }
    message
}

fn integer(value: f64) -> Option<i32> {
    (value.is_finite()
        && value.fract() == 0.0
        && value >= f64::from(i32::MIN)
        && value <= f64::from(i32::MAX))
    .then_some(value as i32)
}

fn json(value: &impl Serialize) -> String {
    serde_json::to_string(value).expect("game data contains only finite JSON values")
}

/// Validates a save by replaying it through the rules: every action must be legal when it happens.
fn replay(input: &str) -> Result<Run, String> {
    if input.len() > MAX_SAVE_BYTES {
        return Err(
            "This file is too large. Neighborhood files must be smaller than 256 KB.".into(),
        );
    }
    let invalid = || "This file is not a valid Barrio neighborhood.".to_string();
    let version: SaveVersion = serde_json::from_str(input).map_err(|_| invalid())?;
    match version.version {
        1 => {
            return Err(
                "This neighborhood was built on the original square hillside, which Classic \
                        cannot load. Your file has not been changed."
                    .into(),
            )
        }
        2 => {
            return Err(
                "This neighborhood comes from the earlier free-building version, which had no \
                        deck or score, so Classic cannot load it. Your file has not been changed."
                    .into(),
            )
        }
        SAVE_VERSION => {}
        _ => return Err("This neighborhood uses an unsupported save version.".into()),
    }
    let save: Save = serde_json::from_str(input).map_err(|_| invalid())?;
    if save.rules != RULES {
        return Err(format!(
            "This run was played under different rules ({}) and cannot be replayed exactly.",
            save.rules
        ));
    }
    if save.actions.len() > MAX_ACTIONS {
        return Err("This file has too many actions.".into());
    }
    let mut run = Run::new(save.seed);
    for (index, action) in save.actions.iter().enumerate() {
        run.apply(*action).map_err(|reason| {
            format!(
                "Cannot load this neighborhood: move {} is not allowed. {reason}",
                index + 1
            )
        })?;
    }
    Ok(run)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::Terrain;

    fn insert(game: &mut Game, hex: Hex, edges: &str, paths: &str, rotation: u32) {
        let spec = TileSpec::parse(Kind::Casas, edges, paths);
        game.run.board.insert(Placed {
            q: hex.q,
            r: hex.r,
            kind: spec.kind,
            edges: spec.edges,
            paths: spec.paths,
            rotation,
            variation: 0,
        });
    }

    #[test]
    fn home_snapshot_networks_follow_entrances_and_later_merges() {
        for rotation in 0..6 {
            let mut game = Game::new(1);
            game.run.board = Board::new(Terrain::flat(2));
            insert(
                &mut game,
                Hex::new(-1, 0).rotate(rotation),
                "PHHPHN",
                "100100",
                rotation,
            );
            insert(
                &mut game,
                Hex::new(1, 0).rotate(rotation),
                "PHHPHN",
                "100100",
                rotation,
            );
            insert(
                &mut game,
                Hex::new(0, 2).rotate(rotation),
                "HHHHHH",
                "000000",
                rotation,
            );
            let state = game.snapshot_value();
            let side = |side: usize| (side + rotation as usize) % SIDES;
            let main = state.tiles[0].networks[side(0)];
            let isolated = state.tiles[1].networks[side(3)];
            assert!(main.is_some());
            assert!(isolated.is_some());
            assert_ne!(main, isolated);
            for tile in &state.tiles[..2] {
                for home in [1, 2, 4] {
                    assert_eq!(tile.networks[side(home)], tile.networks[side(0)]);
                }
            }
            assert_eq!(state.tiles[2].networks, [None; SIDES]);
            assert_eq!(state.stats.homes_connected, 3);
            insert(&mut game, Hex::ORIGIN, "PNNPNN", "100100", rotation);
            let state = game.snapshot_value();
            let joined = state.tiles[3].networks[side(0)];
            for tile in &state.tiles[..2] {
                for home in [1, 2, 4] {
                    assert_eq!(tile.networks[side(home)], joined);
                }
            }
            assert_eq!(state.tiles[2].networks, [None; SIDES]);
            assert_eq!(state.stats.homes_connected, 6);
        }
    }

    #[test]
    fn home_snapshot_networks_distinguish_two_walks_on_one_tile() {
        for rotation in 0..6 {
            let mut game = Game::new(1);
            game.run.board = Board::new(Terrain::flat(2));
            insert(&mut game, Hex::ORIGIN, "PHHPHH", "100200", rotation);
            let state = game.snapshot_value();
            let tile = &state.tiles[0];
            let side = |side: usize| (side + rotation as usize) % SIDES;
            assert_ne!(tile.networks[side(0)], tile.networks[side(3)]);
            for (home, path) in [(1, 0), (2, 3), (4, 3), (5, 0)] {
                assert_eq!(tile.networks[side(home)], tile.networks[side(path)]);
            }
        }
    }
}
