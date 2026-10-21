mod catalog;
mod terrain;
mod world;

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use catalog::CATALOG;
use terrain::{Generator, CELL_COUNT, DEPTH, WIDTH};
use world::{Preview, Structure, World};

const SAVE_VERSION: u32 = 1;
const MAX_SAVE_BYTES: usize = 256 * 1024;
const MAX_COMMAND_BYTES: usize = 4096;
const HISTORY_LIMIT: usize = 64;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Cell {
    x: u32,
    z: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot<'a> {
    seed: u32,
    width: u32,
    depth: u32,
    cells: Vec<Cell>,
    structures: &'a [Structure],
    can_undo: bool,
    can_redo: bool,
    connected: usize,
    revision: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult<'a> {
    ok: bool,
    message: String,
    snapshot: Snapshot<'a>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Command {
    Place {
        kind: String,
        x: u32,
        z: u32,
        rotation: u32,
    },
    Remove {
        x: u32,
        z: u32,
    },
    Undo {},
    Redo {},
    Reset {
        seed: u32,
    },
    Benchmark {},
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Save {
    version: u32,
    terrain_id: String,
    seed: u32,
    width: u32,
    depth: u32,
    next_id: u32,
    structures: Vec<Structure>,
}

#[wasm_bindgen]
pub struct Game {
    world: World,
    undo: Vec<World>,
    redo: Vec<World>,
    next_id: u32,
    revision: u32,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> Self {
        let mut next_id = 1;
        Self {
            world: World::starter(seed, &mut next_id),
            undo: Vec::new(),
            redo: Vec::new(),
            next_id,
            revision: 0,
        }
    }

    pub fn snapshot(&self) -> String {
        json(&self.snapshot_value())
    }

    pub fn catalog(&self) -> String {
        json(&CATALOG)
    }

    pub fn preview(&self, kind: &str, x: f64, z: f64, rotation: f64) -> String {
        let result = match (whole_number(x), whole_number(z), whole_number(rotation)) {
            (Some(x), Some(z), Some(rotation)) => self.world.preview(kind, x, z, rotation),
            _ => Preview::invalid("Choose whole-number coordinates and a rotation from 0 to 3."),
        };
        json(&result)
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
            Ok(message) => self.result(true, message),
            Err(message) => self.result(false, message),
        }
    }

    pub fn save(&self) -> String {
        json(&Save {
            version: SAVE_VERSION,
            terrain_id: self.world.generator.id().into(),
            seed: self.world.seed,
            width: WIDTH,
            depth: DEPTH,
            next_id: self
                .world
                .structures
                .iter()
                .map(|structure| structure.id + 1)
                .fold(self.next_id, u32::max),
            structures: self.world.structures.clone(),
        })
    }

    pub fn load(&mut self, input: &str) -> String {
        match validate_save(input) {
            Ok((world, next_id)) => {
                self.replace(world);
                self.next_id = self.next_id.max(next_id);
                self.result(true, "Neighborhood loaded.")
            }
            Err(message) => self.result(false, message),
        }
    }
}

impl Game {
    fn snapshot_value(&self) -> Snapshot<'_> {
        Snapshot {
            seed: self.world.seed,
            width: WIDTH,
            depth: DEPTH,
            cells: self
                .world
                .heights
                .iter()
                .enumerate()
                .map(|(index, &height)| Cell {
                    x: index as u32 % WIDTH,
                    z: index as u32 / WIDTH,
                    height: u32::from(height),
                })
                .collect(),
            structures: &self.world.structures,
            can_undo: !self.undo.is_empty(),
            can_redo: !self.redo.is_empty(),
            connected: self.world.connected(),
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

    fn replace(&mut self, world: World) {
        let previous = std::mem::replace(&mut self.world, world);
        push_history(&mut self.undo, previous);
        self.redo.clear();
        self.revision = self.revision.wrapping_add(1);
    }

    fn allocation_start(&self, count: u32) -> u32 {
        let mut ids: Vec<_> = std::iter::once(&self.world)
            .chain(&self.undo)
            .chain(&self.redo)
            .flat_map(|world| world.structures.iter().map(|structure| structure.id))
            .collect();
        ids.sort_unstable();
        let find_range = |mut start: u32| {
            for &id in &ids {
                if id < start {
                    continue;
                }
                if id - start >= count {
                    break;
                }
                start = id + 1;
            }
            start.checked_add(count).map(|_| start)
        };
        find_range(self.next_id)
            .or_else(|| find_range(1))
            // Bounded history and board size leave room for a full board of fresh IDs.
            .expect("bounded worlds cannot exhaust u32 placement identifiers")
    }

    fn execute(&mut self, command: Command) -> Result<&'static str, String> {
        match command {
            Command::Place {
                kind,
                x,
                z,
                rotation,
            } => {
                let preview = self.world.preview(&kind, x, z, rotation);
                if !preview.valid {
                    return Err(preview.reason);
                }
                self.next_id = self.allocation_start(1);
                let mut next = self.world.clone();
                next.add(&kind, x, z, rotation, &mut self.next_id);
                self.replace(next);
                Ok("Placed.")
            }
            Command::Remove { x, z } => {
                let Some(slot) = self.world.at(x, z) else {
                    return Err("There is nothing here to remove.".into());
                };
                let mut next = self.world.clone();
                next.remove(slot);
                self.replace(next);
                Ok("Removed.")
            }
            Command::Undo {} => {
                let Some(previous) = self.undo.pop() else {
                    return Err("There is nothing to undo yet.".into());
                };
                push_history(&mut self.redo, std::mem::replace(&mut self.world, previous));
                self.revision = self.revision.wrapping_add(1);
                Ok("Undone.")
            }
            Command::Redo {} => {
                let Some(next) = self.redo.pop() else {
                    return Err("There is nothing to redo yet.".into());
                };
                push_history(&mut self.undo, std::mem::replace(&mut self.world, next));
                self.revision = self.revision.wrapping_add(1);
                Ok("Redone.")
            }
            Command::Reset { seed } => {
                self.next_id = self.allocation_start(CELL_COUNT as u32);
                let world = World::starter(seed, &mut self.next_id);
                self.replace(world);
                Ok("A new neighborhood is ready.")
            }
            Command::Benchmark {} => {
                self.next_id = self.allocation_start(CELL_COUNT as u32);
                let world = World::benchmark(self.world.seed, &mut self.next_id);
                self.replace(world);
                Ok("Benchmark neighborhood ready.")
            }
        }
    }
}

fn whole_number(value: f64) -> Option<u32> {
    (value.is_finite() && value >= 0.0 && value <= f64::from(u32::MAX) && value.fract() == 0.0)
        .then_some(value as u32)
}

fn json(value: &impl Serialize) -> String {
    serde_json::to_string(value).expect("game data contains only finite JSON values")
}

fn push_history(history: &mut Vec<World>, world: World) {
    if history.len() == HISTORY_LIMIT {
        history.remove(0);
    }
    history.push(world);
}

fn validate_save(input: &str) -> Result<(World, u32), String> {
    if input.len() > MAX_SAVE_BYTES {
        return Err(
            "This file is too large. Neighborhood files must be smaller than 256 KB.".into(),
        );
    }
    let save: Save = serde_json::from_str(input)
        .map_err(|_| "This file is not a valid Barrio neighborhood.".to_string())?;
    if save.version != SAVE_VERSION {
        return Err("This neighborhood uses an unsupported save version.".into());
    }
    let Some(generator) = Generator::parse(&save.terrain_id) else {
        return Err("This neighborhood uses an unsupported terrain type.".into());
    };
    if save.width != WIDTH || save.depth != DEPTH {
        return Err("Neighborhoods must use a 32 by 32 hillside.".into());
    }
    if save.structures.len() > CELL_COUNT {
        return Err("This file contains too many structures.".into());
    }
    if save.next_id == 0 {
        return Err("This file has an invalid next placement identifier.".into());
    }
    let mut ids = HashSet::new();
    let mut world = World::with_terrain(save.seed, generator);
    for structure in save.structures {
        if structure.id == 0 || structure.id >= save.next_id || !ids.insert(structure.id) {
            return Err("This file has duplicate or invalid placement identifiers.".into());
        }
        if structure.variation >= 16 {
            return Err("This file has an unknown visual variation.".into());
        }
        let preview = world.preview(
            &structure.kind,
            structure.x,
            structure.z,
            structure.rotation,
        );
        if !preview.valid {
            return Err(format!("Cannot load this neighborhood. {}", preview.reason));
        }
        world.insert(structure);
    }
    Ok((world, save.next_id))
}
