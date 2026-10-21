use std::collections::{HashSet, VecDeque};

use serde::{Deserialize, Serialize};

use crate::catalog::{definition, footprint, Category};
use crate::terrain::{self, facing, index, neighbor, Generator, CELL_COUNT, DEPTH, WIDTH};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Structure {
    pub id: u32,
    pub kind: String,
    pub x: u32,
    pub z: u32,
    pub rotation: u32,
    pub variation: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub valid: bool,
    pub reason: String,
    pub height: u32,
    pub width: u32,
    pub depth: u32,
}

impl Preview {
    pub fn invalid(reason: &str) -> Self {
        Self {
            valid: false,
            reason: reason.into(),
            height: 0,
            width: 0,
            depth: 0,
        }
    }
}

#[derive(Clone)]
pub struct World {
    pub seed: u32,
    pub generator: Generator,
    pub heights: [u8; CELL_COUNT],
    pub structures: Vec<Structure>,
    occupancy: [Option<usize>; CELL_COUNT],
}

impl World {
    pub fn empty(seed: u32) -> Self {
        Self::with_terrain(seed, Generator::LATEST)
    }

    pub fn with_terrain(seed: u32, generator: Generator) -> Self {
        Self {
            seed,
            generator,
            heights: generator.generate(seed),
            structures: Vec::new(),
            occupancy: [None; CELL_COUNT],
        }
    }

    pub fn height(&self, x: u32, z: u32) -> u32 {
        u32::from(self.heights[index(x, z)])
    }

    pub fn preview(&self, kind: &str, x: u32, z: u32, rotation: u32) -> Preview {
        let Some(def) = definition(kind) else {
            return Preview::invalid("Choose a building, path, stairs, or prop from the palette.");
        };
        if rotation > 3 {
            return Preview::invalid("Rotation must be 0, 1, 2, or 3.");
        }
        let (width, depth) = footprint(def, rotation);
        let mut result = Preview {
            valid: false,
            reason: String::new(),
            height: 0,
            width,
            depth,
        };
        if x >= WIDTH || z >= DEPTH || width > WIDTH - x || depth > DEPTH - z {
            result.reason = "Keep the whole footprint inside the neighborhood.".into();
            return result;
        }
        result.height = self.height(x, z);
        for tile_z in z..z + depth {
            for tile_x in x..x + width {
                if self.occupancy[index(tile_x, tile_z)].is_some() {
                    result.reason = "There is already something in this space.".into();
                    return result;
                }
                if self.height(tile_x, tile_z) != result.height {
                    result.reason = "This footprint needs a flat terrace. Try rotating it.".into();
                    return result;
                }
            }
        }
        if def.category == Category::Stairs {
            let (dx, dz) = facing(rotation);
            let upper = neighbor(x, z, dx, dz);
            let lower = neighbor(x, z, -dx, -dz);
            if !upper.is_some_and(|(x, z)| self.height(x, z) == result.height + 1)
                || !lower.is_some_and(|(x, z)| self.height(x, z) == result.height)
            {
                result.reason =
                    "Face the stairs uphill at a single terrace step, with flat space behind."
                        .into();
                return result;
            }
        }
        result.valid = true;
        result.reason = "Ready to place.".into();
        result
    }

    pub fn insert(&mut self, structure: Structure) {
        let def = definition(&structure.kind).expect("validated catalog entry");
        let (width, depth) = footprint(def, structure.rotation);
        let slot = self.structures.len();
        for z in structure.z..structure.z + depth {
            for x in structure.x..structure.x + width {
                self.occupancy[index(x, z)] = Some(slot);
            }
        }
        self.structures.push(structure);
    }

    pub fn add(&mut self, kind: &str, x: u32, z: u32, rotation: u32, next_id: &mut u32) -> bool {
        if !self.preview(kind, x, z, rotation).valid || *next_id == u32::MAX {
            return false;
        }
        let kind_hash = kind.bytes().fold(0_u32, |hash, byte| {
            hash.wrapping_mul(31).wrapping_add(u32::from(byte))
        });
        let variation = terrain::mix(self.seed ^ (x << 16) ^ (z << 8) ^ rotation ^ kind_hash) % 16;
        self.insert(Structure {
            id: *next_id,
            kind: kind.into(),
            x,
            z,
            rotation,
            variation,
        });
        *next_id += 1;
        true
    }

    pub fn at(&self, x: u32, z: u32) -> Option<usize> {
        if x >= WIDTH || z >= DEPTH {
            None
        } else {
            self.occupancy[index(x, z)]
        }
    }

    pub fn remove(&mut self, slot: usize) {
        self.structures.remove(slot);
        self.occupancy.fill(None);
        for (slot, structure) in self.structures.iter().enumerate() {
            let def = definition(&structure.kind).expect("validated catalog entry");
            let (width, depth) = footprint(def, structure.rotation);
            for z in structure.z..structure.z + depth {
                for x in structure.x..structure.x + width {
                    self.occupancy[index(x, z)] = Some(slot);
                }
            }
        }
    }

    fn edge_height(&self, structure: &Structure, dx: i32, dz: i32) -> Option<u32> {
        let height = self.height(structure.x, structure.z);
        if structure.kind == "stairs" {
            let (forward_x, forward_z) = facing(structure.rotation);
            if (dx, dz) == (forward_x, forward_z) {
                Some(height + 1)
            } else if (dx, dz) == (-forward_x, -forward_z) {
                Some(height)
            } else {
                None
            }
        } else {
            Some(height)
        }
    }

    pub fn connected(&self) -> usize {
        let mut visited = vec![false; self.structures.len()];
        let mut largest = 0;
        for (start, structure) in self.structures.iter().enumerate() {
            if visited[start] || !matches!(structure.kind.as_str(), "path" | "stairs") {
                continue;
            }
            visited[start] = true;
            let mut queue = VecDeque::from([start]);
            let mut buildings = HashSet::new();
            while let Some(slot) = queue.pop_front() {
                let source = &self.structures[slot];
                for (dx, dz) in [(0, 1), (1, 0), (0, -1), (-1, 0)] {
                    let Some((x, z)) = neighbor(source.x, source.z, dx, dz) else {
                        continue;
                    };
                    let Some(target_slot) = self.at(x, z) else {
                        continue;
                    };
                    let target = &self.structures[target_slot];
                    if self.edge_height(source, dx, dz).is_none()
                        || self.edge_height(source, dx, dz) != self.edge_height(target, -dx, -dz)
                    {
                        continue;
                    }
                    match definition(&target.kind)
                        .expect("validated catalog entry")
                        .category
                    {
                        Category::Building => {
                            buildings.insert(target.id);
                        }
                        Category::Path | Category::Stairs => {
                            if !visited[target_slot] {
                                visited[target_slot] = true;
                                queue.push_back(target_slot);
                            }
                        }
                        Category::Prop => {}
                    }
                }
            }
            largest = largest.max(buildings.len());
        }
        largest
    }

    /// A dense, terrain-adaptive starter: a stair spine up the slope, three cross streets that step
    /// with the contours, and homes packed along both sides facing the street.
    pub fn starter(seed: u32, next_id: &mut u32) -> Self {
        let mut world = Self::empty(seed);
        let street = |world: &mut Self, x: u32, z: u32, rotations: [u32; 2], next_id: &mut u32| {
            if !rotations
                .iter()
                .any(|&rotation| world.add("stairs", x, z, rotation, next_id))
            {
                world.add("path", x, z, 0, next_id);
            }
        };
        for z in 3..30 {
            street(&mut world, 15, z, [2, 0], next_id);
        }
        let rows = [8, 15, 22];
        for z in rows {
            for x in 4..28 {
                if x != 15 {
                    street(&mut world, x, z, [1, 3], next_id);
                }
            }
        }
        let kinds = [
            "casa", "tienda", "esquina", "torre", "casa", "terraza", "taller", "casa", "esquina",
            "tienda", "casa", "torre", "casa", "esquina", "casa", "terraza",
        ];
        let mut lots: Vec<(u32, u32, u32)> = Vec::new();
        for z in 3..30 {
            lots.push((14, z, 1));
            lots.push((16, z, 3));
        }
        for z in rows {
            for x in 4..28 {
                if x != 15 {
                    lots.push((x, z - 1, 0));
                    lots.push((x, z + 1, 2));
                }
            }
        }
        // Dense near the spine, thinning toward the edges, with occasional gaps left for gardens.
        lots.sort_by_key(|&(x, z, _)| x.abs_diff(15) * 2 + z.abs_diff(15) / 2);
        let mut placed = 0;
        for (x, z, facing_street) in lots {
            if placed >= 46 || terrain::mix(seed ^ (x << 12) ^ (z << 4)).is_multiple_of(7) {
                continue;
            }
            let kind = kinds[placed % kinds.len()];
            let def = definition(kind).expect("starter kinds are in the catalog");
            for turn in [0, 1, 3, 2] {
                let rotation = (facing_street + turn) % 4;
                let (width, depth) = footprint(def, rotation);
                // Anchor the footprint so its front edge, not its corner, meets the street.
                let (ox, oz) = match rotation {
                    0 => (x, z.saturating_sub(depth - 1)),
                    1 => (x.saturating_sub(width - 1), z),
                    _ => (x, z),
                };
                if world.add(kind, ox, oz, rotation, next_id) {
                    placed += 1;
                    break;
                }
            }
        }
        let props = ["tree", "planter", "bench", "tree", "tree", "planter"];
        let mut prop = 0;
        for z in rows {
            for x in [6, 10, 20, 24, 12, 18] {
                for dz in [1, 2] {
                    if prop < 16 && world.add(props[prop % props.len()], x, z + dz, 0, next_id) {
                        prop += 1;
                        break;
                    }
                }
            }
        }
        world
    }

    pub fn benchmark(seed: u32, next_id: &mut u32) -> Self {
        let mut world = Self::empty(seed);
        for z in 0..DEPTH {
            for x in 0..WIDTH {
                let kind = if x % 4 == 0 {
                    if z > 0 && world.height(x, z - 1) == world.height(x, z) + 1 {
                        "stairs"
                    } else {
                        "path"
                    }
                } else {
                    match terrain::mix(seed ^ (x << 16) ^ z) % 10 {
                        0 => "tree",
                        1 => "bench",
                        2..=4 => "torre",
                        _ => "casa",
                    }
                };
                world.add(kind, x, z, if kind == "stairs" { 2 } else { 0 }, next_id);
            }
        }
        world
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_stair_rotations_connect_their_two_landings_and_exclude_the_sides() {
        for rotation in 0..4 {
            let mut world = World::empty(1);
            world.heights.fill(1);
            let (x, z) = (16, 16);
            let (dx, dz) = facing(rotation);
            let (upper_x, upper_z) = neighbor(x, z, dx, dz).unwrap();
            let (lower_x, lower_z) = neighbor(x, z, -dx, -dz).unwrap();
            let (upper_home_x, upper_home_z) = neighbor(x, z, dx * 2, dz * 2).unwrap();
            let (lower_home_x, lower_home_z) = neighbor(x, z, -dx * 2, -dz * 2).unwrap();
            let (side_x, side_z) = neighbor(x, z, dz, -dx).unwrap();
            world.heights[index(upper_x, upper_z)] = 2;
            world.heights[index(upper_home_x, upper_home_z)] = 2;
            for candidate in 0..4 {
                assert_eq!(
                    world.preview("stairs", x, z, candidate).valid,
                    candidate == rotation
                );
            }
            let mut next_id = 1;
            assert!(world.add("path", upper_x, upper_z, 0, &mut next_id));
            assert!(world.add("path", lower_x, lower_z, 0, &mut next_id));
            assert!(world.add("casa", upper_home_x, upper_home_z, 0, &mut next_id));
            assert!(world.add("casa", lower_home_x, lower_home_z, 0, &mut next_id));
            assert!(world.add("casa", side_x, side_z, 0, &mut next_id));
            assert_eq!(world.connected(), 1);
            assert!(world.add("stairs", x, z, rotation, &mut next_id));
            assert_eq!(world.connected(), 2);
        }
    }

    #[test]
    fn stairs_reject_two_height_steps_and_missing_landings() {
        let mut world = World::empty(0);
        world.heights.fill(1);
        world.heights[index(16, 17)] = 3;
        assert!(!world.preview("stairs", 16, 16, 0).valid);
        world.heights[index(16, 17)] = 2;
        assert!(world.preview("stairs", 16, 16, 0).valid);
        world.heights[index(16, 15)] = 0;
        assert!(!world.preview("stairs", 16, 16, 0).valid);
        world.heights[index(16, 1)] = 2;
        assert!(!world.preview("stairs", 16, 0, 0).valid);
    }
}
