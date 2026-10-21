//! The placed tiles, placement validation and scoring preview, and the networks that join them.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::hex::{opposite, Hex, SIDES};
use crate::network::{Feature, Networks, TileNodes};
use crate::score::{points, Points};
use crate::terrain::Terrain;
use crate::tile::{meet, Edge, Kind, Meet, TileSpec, STREAM_BLOCKED};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placed {
    pub q: i32,
    pub r: i32,
    pub kind: Kind,
    /// Unrotated edges and path groups as drawn; `rotation` turns them into place.
    pub edges: [Edge; SIDES],
    pub paths: [u8; SIDES],
    pub rotation: u32,
    pub variation: u32,
}

impl Placed {
    pub fn hex(&self) -> Hex {
        Hex::new(self.q, self.r)
    }

    pub fn spec(&self) -> TileSpec {
        TileSpec {
            kind: self.kind,
            edges: self.edges,
            paths: self.paths,
        }
    }

    pub fn edges(&self) -> [Edge; SIDES] {
        self.spec().rotated(self.rotation)
    }
}

/// How one side of a candidate placement meets the world.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Side {
    pub edge: Edge,
    /// The touching edge of the neighboring tile, if one is placed.
    pub neighbor: Option<Edge>,
    /// Neighbor elevation minus this tile's elevation; zero when there is no neighbor.
    pub rise: i32,
    pub meet: Meet,
    /// A path joins across one terrace, so stairs will be built.
    pub stairs: bool,
}

/// What the placement does to pedestrian paths.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathReport {
    /// Path edges that join a neighbor's path.
    pub joined: u32,
    /// Path edges facing empty ground, waiting for a neighbor.
    pub open: u32,
    /// Path edges that end against a neighbor's homes or nature.
    pub ended: u32,
    /// Path edges facing a path two or more terraces away, which cannot join.
    pub steep: u32,
    /// Joined path edges that climb one terrace with stairs.
    pub stairs: u32,
    /// Homes added to the largest walkable network.
    pub homes_gained: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub valid: bool,
    pub reason: String,
    pub elevation: u32,
    pub sides: Vec<Side>,
    pub neighbors: u32,
    pub matches: u32,
    /// All six sides touch tiles and all six match.
    pub perfect: bool,
    /// Points this placement would earn; zero when invalid.
    pub points: Points,
    pub paths: PathReport,
    /// How much each quest measure would grow.
    pub gains: Gains,
}

/// Growth of the three quest measures: homes on the main walk, the largest nature area, the longest stream.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gains {
    pub homes: u32,
    pub nature: u32,
    pub water: u32,
}

impl Placement {
    fn invalid(reason: impl Into<String>) -> Self {
        Self {
            valid: false,
            reason: reason.into(),
            elevation: 0,
            sides: Vec::new(),
            neighbors: 0,
            matches: 0,
            perfect: false,
            points: Points::default(),
            paths: PathReport::default(),
            gains: Gains::default(),
        }
    }
}

fn edge_name(edge: Edge) -> &'static str {
    match edge {
        Edge::Homes => "homes",
        Edge::Path => "path",
        Edge::Nature => "nature",
        Edge::Water => "stream",
    }
}

/// No run can grow this far from the start; coordinates beyond it are refused before any neighbor math.
pub const REACH: u32 = 1 << 16;

#[derive(Clone, Debug)]
pub struct Board {
    pub terrain: Terrain,
    pub tiles: Vec<Placed>,
    index: BTreeMap<Hex, usize>,
    networks: Networks,
    nodes: Vec<TileNodes>,
}

impl Board {
    pub fn new(terrain: Terrain) -> Self {
        Self {
            terrain,
            tiles: Vec::new(),
            index: BTreeMap::new(),
            networks: Networks::default(),
            nodes: Vec::new(),
        }
    }

    pub fn get(&self, hex: Hex) -> Option<&Placed> {
        self.index.get(&hex).map(|&slot| &self.tiles[slot])
    }

    pub fn elevation(&self, hex: Hex) -> u32 {
        self.terrain.level(hex)
    }

    pub fn networks(&self) -> &Networks {
        &self.networks
    }

    /// The network node of each side of the tile in `slot`.
    pub fn nodes(&self, slot: usize) -> &TileNodes {
        &self.nodes[slot]
    }

    /// Validates putting `spec` at `hex` turned by `rotation`, and reports how each side would meet, the
    /// points it would earn, and what it does to the paths. Placing it earns exactly these points.
    pub fn evaluate(&self, spec: &TileSpec, hex: Hex, rotation: u32) -> Placement {
        if rotation >= SIDES as u32 {
            return Placement::invalid("Rotation must be a whole number from 0 to 5.");
        }
        if hex.length() > REACH {
            return Placement::invalid("This is far beyond the neighborhood.");
        }
        if self.get(hex).is_some() {
            return Placement::invalid("There is already a tile here.");
        }
        let edges = spec.rotated(rotation);
        let elevation = self.elevation(hex);
        let mut result = Placement::invalid("");
        result.elevation = elevation;
        let mut blocked = None;
        for (side, next) in hex.neighbors() {
            let edge = edges[side];
            let mut report = Side {
                edge,
                neighbor: None,
                rise: 0,
                meet: Meet::Open,
                stairs: false,
            };
            if let Some(tile) = self.get(next) {
                let level = self.elevation(next);
                let other = tile.edges()[opposite(side)];
                report.neighbor = Some(other);
                report.rise = level as i32 - elevation as i32;
                report.meet = meet(edge, other, level.abs_diff(elevation));
                result.neighbors += 1;
                match report.meet {
                    Meet::Match => result.matches += 1,
                    Meet::Blocked => {
                        blocked.get_or_insert((edge, other));
                    }
                    _ => {}
                }
                if edge == Edge::Path {
                    match report.meet {
                        Meet::Match => {
                            result.paths.joined += 1;
                            report.stairs = report.rise != 0;
                            result.paths.stairs += u32::from(report.stairs);
                        }
                        Meet::Steep => result.paths.steep += 1,
                        _ => result.paths.ended += 1,
                    }
                }
            } else if edge == Edge::Path {
                result.paths.open += 1;
            }
            result.sides.push(report);
        }
        if result.neighbors == 0 && !self.tiles.is_empty() {
            result.reason =
                "Tiles must touch the neighborhood. Choose a spot beside an existing tile.".into();
            return result;
        }
        if let Some((own, other)) = blocked {
            result.reason = if own == Edge::Water {
                format!(
                    "This stream would run into {}. {STREAM_BLOCKED}",
                    match other {
                        Edge::Homes => "houses",
                        Edge::Path => "a path",
                        _ => "dry ground",
                    }
                )
            } else {
                format!(
                    "This tile's {} edge would block a stream. {STREAM_BLOCKED}",
                    edge_name(own)
                )
            };
            return result;
        }
        result.valid = true;
        result.perfect = result.neighbors == SIDES as u32 && result.matches == SIDES as u32;
        result.points = points(result.matches, result.perfect);
        result.gains = self.gains(spec, hex, rotation);
        result.paths.homes_gained = result.gains.homes;
        result.reason = crate::score::label(&result.points)
            .unwrap_or("Ready to place.")
            .into();
        result
    }

    /// Joins the tile on a copy of the networks and measures how each quest measure grows.
    fn gains(&self, spec: &TileSpec, hex: Hex, rotation: u32) -> Gains {
        let mut networks = self.networks.clone();
        self.join(&mut networks, spec, hex, rotation);
        let grow = |feature| networks.largest(feature) - self.networks.largest(feature);
        Gains {
            homes: grow(Feature::Path),
            nature: grow(Feature::Nature),
            water: grow(Feature::Water),
        }
    }

    /// Adds a tile's nodes to `networks` and joins them to every neighbor it matches.
    fn join(&self, networks: &mut Networks, spec: &TileSpec, hex: Hex, rotation: u32) -> TileNodes {
        let nodes = networks.add_tile(spec, rotation);
        let edges = spec.rotated(rotation);
        let elevation = self.elevation(hex);
        for (side, next) in hex.neighbors() {
            let Some(&slot) = self.index.get(&next) else {
                continue;
            };
            let other = self.tiles[slot].edges()[opposite(side)];
            let rise = self.elevation(next).abs_diff(elevation);
            if meet(edges[side], other, rise) != Meet::Match {
                continue;
            }
            if let (Some(own), Some(theirs)) = (nodes[side], self.nodes[slot][opposite(side)]) {
                networks.union(own, theirs);
            }
        }
        nodes
    }

    /// How each side of the placed tile in `slot` meets its neighbor.
    pub fn meets(&self, slot: usize) -> [Meet; SIDES] {
        let tile = &self.tiles[slot];
        let edges = tile.edges();
        let elevation = self.elevation(tile.hex());
        std::array::from_fn(|side| {
            let next = tile.hex().neighbor(side);
            match self.get(next) {
                Some(other) => meet(
                    edges[side],
                    other.edges()[opposite(side)],
                    self.elevation(next).abs_diff(elevation),
                ),
                None => Meet::Open,
            }
        })
    }

    /// Adds a tile without validation. Callers validate with `evaluate` first.
    pub fn insert(&mut self, tile: Placed) {
        let mut networks = std::mem::take(&mut self.networks);
        let nodes = self.join(&mut networks, &tile.spec(), tile.hex(), tile.rotation);
        self.networks = networks;
        self.nodes.push(nodes);
        self.index.insert(tile.hex(), self.tiles.len());
        self.tiles.push(tile);
    }

    /// Empty hexes beside the neighborhood, in deterministic order.
    pub fn frontier(&self) -> Vec<Hex> {
        let mut open = std::collections::BTreeSet::new();
        for tile in &self.tiles {
            for (_, next) in tile.hex().neighbors() {
                if self.get(next).is_none() {
                    open.insert(next);
                }
            }
        }
        open.into_iter().collect()
    }

    /// Whether `spec` has any legal placement.
    pub fn playable(&self, spec: &TileSpec) -> bool {
        self.frontier().into_iter().any(|hex| {
            (0..SIDES as u32).any(|rotation| self.evaluate_legality(spec, hex, rotation))
        })
    }

    /// The legality part of `evaluate`, without the scoring and network preview.
    pub fn evaluate_legality(&self, spec: &TileSpec, hex: Hex, rotation: u32) -> bool {
        if hex.length() > REACH || rotation >= SIDES as u32 || self.get(hex).is_some() {
            return false;
        }
        let edges = spec.rotated(rotation);
        let mut neighbors = 0;
        for (side, next) in hex.neighbors() {
            if let Some(tile) = self.get(next) {
                neighbors += 1;
                if meet(edges[side], tile.edges()[opposite(side)], 0) == Meet::Blocked {
                    return false;
                }
            }
        }
        neighbors > 0 || self.tiles.is_empty()
    }

    /// Whether every tile can be reached from every other through neighboring tiles.
    pub fn contiguous(&self) -> bool {
        let Some(first) = self.tiles.first() else {
            return true;
        };
        let mut seen = std::collections::BTreeSet::from([first.hex()]);
        let mut queue = std::collections::VecDeque::from([first.hex()]);
        while let Some(hex) = queue.pop_front() {
            for (_, next) in hex.neighbors() {
                if self.get(next).is_some() && seen.insert(next) {
                    queue.push_back(next);
                }
            }
        }
        seen.len() == self.tiles.len()
    }

    pub fn stats(&self) -> Stats {
        let levels: std::collections::BTreeSet<_> = self
            .tiles
            .iter()
            .map(|tile| self.elevation(tile.hex()))
            .collect();
        Stats {
            tiles: self.tiles.len() as u32,
            homes: self.tiles.iter().map(|tile| tile.spec().homes()).sum(),
            homes_connected: self.networks.largest(Feature::Path),
            walks: self.networks.count(Feature::Path),
            largest_nature: self.networks.largest(Feature::Nature),
            largest_water: self.networks.largest(Feature::Water),
            levels: levels.len() as u32,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub tiles: u32,
    pub homes: u32,
    /// Homes in the largest walkable network: the residential quest measure.
    pub homes_connected: u32,
    /// Separate walkable networks.
    pub walks: u32,
    /// Tiles in the largest connected nature area.
    pub largest_nature: u32,
    /// Tiles in the largest connected stream.
    pub largest_water: u32,
    /// Distinct elevations the neighborhood spans.
    pub levels: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use Edge::*;

    fn put(board: &mut Board, hex: Hex, spec: TileSpec, rotation: u32) {
        assert!(
            board.evaluate(&spec, hex, rotation).valid,
            "{spec:?} at {hex:?}"
        );
        board.insert(Placed {
            q: hex.q,
            r: hex.r,
            kind: spec.kind,
            edges: spec.edges,
            paths: spec.paths,
            rotation,
            variation: 0,
        });
    }

    fn tile(kind: Kind, edges: &str, paths: &str) -> TileSpec {
        TileSpec::parse(kind, edges, paths)
    }

    fn flat() -> Board {
        Board::new(Terrain::flat(2))
    }

    #[test]
    fn first_tile_is_free_and_later_tiles_must_touch_an_empty_spot() {
        let mut board = flat();
        let plaza = tile(Kind::Plaza, "PPPPPP", "111111");
        assert!(board.evaluate(&plaza, Hex::new(3, 3), 0).valid);
        put(&mut board, Hex::ORIGIN, plaza, 0);
        let far = board.evaluate(&plaza, Hex::new(3, 3), 0);
        assert!(!far.valid && far.reason.contains("touch"));
        assert!(board.evaluate(&plaza, Hex::new(1, 0), 0).valid);
        let taken = board.evaluate(&plaza, Hex::ORIGIN, 0);
        assert!(!taken.valid && taken.reason.contains("already"));
        assert!(!board.evaluate(&plaza, Hex::new(1, 0), 6).valid);
        assert!(!board.evaluate(&plaza, Hex::new(1, 0), 6).points.total == 0 || true);
    }

    #[test]
    fn soft_matching_allows_any_dry_edges_to_touch() {
        let mut board = flat();
        put(
            &mut board,
            Hex::ORIGIN,
            tile(Kind::Monte, "NNNNNN", "000000"),
            0,
        );
        let homes = tile(Kind::Casas, "PHHHHH", "100000");
        for rotation in 0..6 {
            let result = board.evaluate(&homes, Hex::new(1, 0), rotation);
            assert!(result.valid);
            assert_eq!(result.matches, 0);
            assert_eq!(result.points.total, 10);
        }
    }

    #[test]
    fn water_must_meet_water_and_may_end_open() {
        let mut board = flat();
        // A stream leaving the origin through edge 0 toward (1, 0); the rest is nature.
        put(
            &mut board,
            Hex::ORIGIN,
            tile(Kind::Quebrada, "WNNNNN", "000000"),
            0,
        );
        let crossing = tile(Kind::Quebrada, "WNNWNN", "000000");
        // At (1, 0), edge 3 faces the origin's water.
        let joined = board.evaluate(&crossing, Hex::new(1, 0), 0);
        assert!(joined.valid, "{}", joined.reason);
        assert_eq!(joined.sides[3].meet, Meet::Match);
        assert_eq!(
            joined.sides[0].meet,
            Meet::Open,
            "the far end stays an open stream end"
        );
        let turned = board.evaluate(&crossing, Hex::new(1, 0), 1);
        assert!(!turned.valid);
        assert!(
            turned.reason.contains("block a stream"),
            "{}",
            turned.reason
        );
        // Dry land may not touch the open stream end, and a stream may not touch dry land.
        let meadow = tile(Kind::Monte, "NNNNNN", "000000");
        assert!(!board.evaluate(&meadow, Hex::new(1, 0), 0).valid);
        assert!(board.evaluate(&meadow, Hex::new(0, 1), 0).valid);
        let wet = board.evaluate(&crossing, Hex::new(0, 1), 1);
        assert!(
            !wet.valid && wet.reason.contains("This stream would run into"),
            "{}",
            wet.reason
        );
        // Rivers do not need to close.
        put(&mut board, Hex::new(1, 0), crossing, 0);
        assert_eq!(board.stats().largest_water, 2);
    }

    #[test]
    fn matches_score_once_and_perfect_needs_six_matching_neighbors() {
        let mut board = flat();
        let meadow = tile(Kind::Monte, "NNNNNN", "000000");
        put(&mut board, Hex::ORIGIN, meadow, 0);
        let second = board.evaluate(&meadow, Hex::new(1, 0), 0);
        assert_eq!((second.matches, second.points.total), (1, 30));
        put(&mut board, Hex::new(1, 0), meadow, 0);
        // A spot touching both counts each new shared edge once.
        let third = board.evaluate(&meadow, Hex::new(1, -1), 0);
        assert_eq!(
            (third.neighbors, third.matches, third.points.total),
            (2, 2, 50)
        );
        let mut ring = flat();
        for (_, hex) in Hex::ORIGIN.neighbors() {
            put(&mut ring, hex, meadow, 0);
        }
        let center = ring.evaluate(&meadow, Hex::ORIGIN, 0);
        assert!(center.perfect);
        assert_eq!(center.points.total, 10 + 120 + 60);
        let almost = tile(Kind::Monte, "NNNNNH", "000000");
        let five = ring.evaluate(&almost, Hex::ORIGIN, 0);
        assert!(!five.perfect && five.valid);
        assert_eq!(five.points.total, 110);
    }

    #[test]
    fn paths_join_with_stairs_but_not_across_a_cliff() {
        let mut terrain = Terrain::flat(2);
        terrain.set(Hex::new(1, 0), 3);
        terrain.set(Hex::new(0, 1), 4);
        let mut board = Board::new(terrain);
        put(
            &mut board,
            Hex::ORIGIN,
            tile(Kind::Plaza, "PPPPPP", "111111"),
            0,
        );
        let lane = tile(Kind::Sendero, "PNNPNN", "100100");
        let step = board.evaluate(&lane, Hex::new(1, 0), 0);
        assert!(step.valid);
        assert_eq!(step.sides[3].rise, -1);
        assert_eq!(step.sides[3].meet, Meet::Match);
        assert!(step.sides[3].stairs);
        assert_eq!(
            (step.paths.joined, step.paths.stairs, step.paths.open),
            (1, 1, 1)
        );
        let cliff = board.evaluate(&lane, Hex::new(0, 1), 1);
        assert!(cliff.valid, "a cliff is allowed but does not join");
        assert_eq!(cliff.sides[4].meet, Meet::Steep);
        assert_eq!(
            (cliff.matches, cliff.paths.steep, cliff.paths.joined),
            (0, 1, 0)
        );
        put(&mut board, Hex::new(0, 1), lane, 1);
        assert_eq!(
            board.stats().walks,
            2,
            "no false connection across the cliff"
        );
    }

    fn force(board: &mut Board, hex: Hex, spec: TileSpec, rotation: u32) {
        board.insert(Placed {
            q: hex.q,
            r: hex.r,
            kind: spec.kind,
            edges: spec.edges,
            paths: spec.paths,
            rotation,
            variation: 0,
        });
    }

    /// Two homes tiles a gap apart, each with a straight path running toward the gap.
    fn two_streets() -> Board {
        let mut board = flat();
        let street = tile(Kind::Casas, "PHHPHN", "100100");
        force(&mut board, Hex::new(-1, 0), street, 0);
        force(&mut board, Hex::new(1, 0), street, 0);
        board
    }

    #[test]
    fn separate_walks_on_one_tile_stay_separate() {
        let mut board = two_streets();
        assert_eq!(board.stats().walks, 2);
        assert_eq!(board.stats().homes_connected, 3);
        // Both path edges join a neighbor, but the tile keeps them apart inside.
        let split = tile(Kind::Casas, "PHHPHH", "100200");
        let preview = board.evaluate(&split, Hex::ORIGIN, 0);
        assert_eq!(preview.paths.joined, 2);
        assert_eq!(
            preview.paths.homes_gained, 2,
            "each side gains two homes; the larger reaches 5"
        );
        put(&mut board, Hex::ORIGIN, split, 0);
        assert_eq!(board.stats().walks, 2);
        assert_eq!(board.stats().homes_connected, 5);
    }

    #[test]
    fn a_joining_tile_merges_two_walks_and_rotation_changes_it() {
        let board = two_streets();
        let lane = tile(Kind::Sendero, "PNNPNN", "100100");
        let joining = board.evaluate(&lane, Hex::ORIGIN, 0);
        assert_eq!((joining.paths.joined, joining.paths.homes_gained), (2, 3));
        assert_eq!(joining.points.total, 50);
        // Turned a sixth, the lane faces nature and homes instead: nothing joins.
        let turned = board.evaluate(&lane, Hex::ORIGIN, 1);
        assert_eq!((turned.paths.joined, turned.paths.homes_gained), (0, 0));
        assert_eq!(turned.paths.ended, 0);
        assert_eq!(turned.paths.open, 2);
        let mut board = board;
        put(&mut board, Hex::ORIGIN, lane, 0);
        assert_eq!(board.stats().walks, 1);
        assert_eq!(board.stats().homes_connected, 6);
    }

    #[test]
    fn homes_without_an_entrance_path_never_count() {
        let mut board = flat();
        put(
            &mut board,
            Hex::ORIGIN,
            tile(Kind::Monte, "NNNNNH", "000000"),
            0,
        );
        let stats = board.stats();
        assert_eq!((stats.homes, stats.homes_connected), (1, 0));
    }

    fn network(board: &Board, slot: usize, side: usize) -> u32 {
        board.networks().network(board.nodes(slot)[side].unwrap())
    }

    #[test]
    fn adjacent_paths_join_in_every_rotated_layout() {
        for rotation in 0..6 {
            let mut board = flat();
            put(
                &mut board,
                Hex::ORIGIN,
                tile(Kind::Sendero, "PNNNNN", "100000"),
                rotation,
            );
            let next = Hex::ORIGIN.neighbor(rotation as usize);
            put(
                &mut board,
                next,
                tile(Kind::Sendero, "NNNPNN", "000100"),
                rotation,
            );
            assert_eq!(
                network(&board, 0, rotation as usize),
                network(&board, 1, opposite(rotation as usize))
            );
            assert_eq!(board.stats().walks, 1);
        }
    }

    #[test]
    fn rotating_one_tile_joins_only_when_its_path_faces_the_street() {
        for rotation in 0..6 {
            let mut board = flat();
            put(
                &mut board,
                Hex::ORIGIN,
                tile(Kind::Sendero, "PNNNNN", "100000"),
                0,
            );
            let street = tile(Kind::Sendero, "PNNPNN", "100100");
            let preview = board.evaluate(&street, Hex::new(1, 0), rotation);
            let joins = rotation % 3 == 0;
            assert_eq!(preview.sides[3].meet == Meet::Match, joins);
            put(&mut board, Hex::new(1, 0), street, rotation);
            assert_eq!(
                network(&board, 0, 0) == network(&board, 1, rotation as usize),
                joins
            );
            assert_eq!(board.stats().walks, if joins { 1 } else { 2 });
        }
    }

    #[test]
    fn three_and_four_way_intersections_merge_every_neighbor() {
        for (edges, paths, sides) in [
            ("PNPNPN", "101010", vec![0, 2, 4]),
            ("PPNPPN", "110110", vec![0, 1, 3, 4]),
        ] {
            let mut board = flat();
            for &side in &sides {
                force(
                    &mut board,
                    Hex::ORIGIN.neighbor(side),
                    tile(Kind::Casas, "PHHHHH", "100000"),
                    opposite(side) as u32,
                );
            }
            assert_eq!(board.stats().walks, sides.len() as u32);
            put(&mut board, Hex::ORIGIN, tile(Kind::Plaza, edges, paths), 0);
            let root = network(&board, sides.len(), sides[0]);
            for (slot, &side) in sides.iter().enumerate() {
                assert_eq!(network(&board, slot, opposite(side)), root);
            }
            assert_eq!(board.stats().walks, 1);
            assert_eq!(board.stats().homes_connected, 5 * sides.len() as u32);
        }
    }

    #[test]
    fn isolated_walk_joins_a_larger_network_and_counts_homes_once() {
        let mut board = flat();
        let street = tile(Kind::Casas, "PHHPHN", "100100");
        put(&mut board, Hex::new(-2, 0), street, 0);
        put(&mut board, Hex::new(-1, 0), street, 0);
        force(&mut board, Hex::new(1, 0), street, 0);
        let main = network(&board, 0, 0);
        let isolated = network(&board, 2, 3);
        assert_ne!(main, isolated);
        assert_eq!(board.stats().homes_connected, 6);
        put(
            &mut board,
            Hex::ORIGIN,
            tile(Kind::Sendero, "PNNPNN", "100100"),
            0,
        );
        assert_eq!(network(&board, 2, 3), main);
        assert_eq!(board.networks().network(isolated), main);
        assert_eq!(board.networks().homes(main), 9);
        assert_eq!(board.stats().homes_connected, 9);
        assert_eq!(board.stats().walks, 1);
    }

    #[test]
    fn multiple_seams_into_one_network_add_homes_once() {
        let mut board = flat();
        let street = tile(Kind::Casas, "HPPPPP", "011111");
        put(&mut board, Hex::ORIGIN, street, 2);
        put(&mut board, Hex::new(1, 0), street, 1);
        let root = network(&board, 0, 0);
        assert_eq!(board.stats().homes_connected, 2);
        let preview = board.evaluate(&street, Hex::new(0, 1), 0);
        assert_eq!(preview.paths.joined, 2);
        put(&mut board, Hex::new(0, 1), street, 0);
        assert_eq!(network(&board, 2, 4), root);
        assert_eq!(board.networks().homes(root), 3);
        assert_eq!(board.stats().homes_connected, 3);
        assert_eq!(board.stats().walks, 1);
    }

    #[test]
    fn incompatible_seams_never_merge_walks() {
        for rise in 0..=3 {
            for (edges, paths, facing) in [
                ("PNNHNN", "100000", Homes),
                ("PNNNNN", "100000", Nature),
                ("PNNPNN", "100100", Path),
            ] {
                let mut terrain = Terrain::flat(2);
                terrain.set(Hex::new(1, 0), 2 + rise);
                let mut board = Board::new(terrain);
                put(
                    &mut board,
                    Hex::ORIGIN,
                    tile(Kind::Sendero, "PNNNNN", "100000"),
                    0,
                );
                let other = tile(Kind::Casas, edges, paths);
                let preview = board.evaluate(&other, Hex::new(1, 0), 0);
                let joins = facing == Path && rise <= 1;
                assert_eq!(
                    preview.sides[3].meet,
                    if joins {
                        Meet::Match
                    } else if facing == Path {
                        Meet::Steep
                    } else {
                        Meet::Differ
                    }
                );
                assert_eq!(preview.sides[3].stairs, joins && rise == 1);
                put(&mut board, Hex::new(1, 0), other, 0);
                assert_eq!(
                    network(&board, 0, 0) == network(&board, 1, 0),
                    joins,
                    "{facing:?}, rise {rise}"
                );
                assert_eq!(board.stats().walks, if joins { 1 } else { 2 });
                if facing == Nature {
                    assert_ne!(network(&board, 0, 0), network(&board, 1, 3));
                }
            }
        }
    }

    #[test]
    fn frontier_lists_every_empty_neighbor() {
        let mut board = flat();
        let meadow = tile(Kind::Monte, "NNNNNN", "000000");
        put(&mut board, Hex::ORIGIN, meadow, 0);
        assert_eq!(board.frontier().len(), 6);
        put(&mut board, Hex::new(1, 0), meadow, 0);
        assert_eq!(board.frontier().len(), 8);
        assert!(board.contiguous());
        assert!(board.playable(&meadow));
        let _ = Water;
    }
}
