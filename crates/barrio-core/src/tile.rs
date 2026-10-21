//! Tile kinds, their six edges, the path links inside each tile, and the rules for how two touching
//! edges meet. Edge data lives here, apart from any geometry; the renderer draws from it.

use serde::{Deserialize, Serialize};

use crate::hex::SIDES;

/// What runs along one side of a tile.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Edge {
    /// House fronts. Each homes edge is one home.
    Homes,
    /// A pedestrian path or stair that continues onto the next tile.
    Path,
    /// Gardens, slopes, and trees.
    Nature,
    /// A quebrada, the mountain stream that runs down the hillside.
    Water,
}

pub const EDGES: [Edge; 4] = [Edge::Homes, Edge::Path, Edge::Nature, Edge::Water];

/// Deck families. The deck is generated from family shares, then a kind and template inside each.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Family {
    Residential,
    Nature,
    Landscape,
    Water,
    Community,
    /// The starting tile; never drawn.
    Landmark,
}

/// The kind of neighborhood piece a tile carries. Kinds decide what renders.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// Homes along a path.
    Casas,
    /// A corner shop among homes.
    Tienda,
    /// A small paved square where paths meet.
    Plaza,
    /// A planted park with a few benches.
    Parque,
    /// A small chapel on its own plaza.
    Capilla,
    /// Hillside woodland.
    Monte,
    /// A path between gardens.
    Sendero,
    /// A stream between green banks.
    Quebrada,
    /// The starting settlement; the region decides how it looks.
    Inicio,
}

pub const KINDS: [Kind; 9] = [
    Kind::Casas,
    Kind::Tienda,
    Kind::Plaza,
    Kind::Parque,
    Kind::Capilla,
    Kind::Monte,
    Kind::Sendero,
    Kind::Quebrada,
    Kind::Inicio,
];

impl Kind {
    pub fn family(self) -> Family {
        match self {
            Kind::Casas => Family::Residential,
            Kind::Tienda | Kind::Plaza | Kind::Parque | Kind::Capilla => Family::Community,
            Kind::Monte => Family::Nature,
            Kind::Sendero => Family::Landscape,
            Kind::Quebrada => Family::Water,
            Kind::Inicio => Family::Landmark,
        }
    }
}

/// A tile in its unrotated orientation.
///
/// `paths[side]` names the path group a path edge belongs to (1, 2, …); zero for other edges. Path edges in
/// the same group are joined inside the tile; edges in different groups are separate walks that only meet
/// through other tiles. Nature edges of a tile form one area and water edges one stream.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TileSpec {
    pub kind: Kind,
    pub edges: [Edge; SIDES],
    pub paths: [u8; SIDES],
}

/// Turns a per-side array by `rotation` sixth-turns: unrotated side `i` faces direction `i + rotation`.
pub fn turn<T: Copy>(sides: &[T; SIDES], rotation: u32) -> [T; SIDES] {
    std::array::from_fn(|side| sides[(side + SIDES - rotation as usize % SIDES) % SIDES])
}

/// Reflects a per-side array across the axis through side 0.
pub fn mirror<T: Copy>(sides: &[T; SIDES]) -> [T; SIDES] {
    std::array::from_fn(|side| sides[(SIDES - side) % SIDES])
}

impl TileSpec {
    /// Builds a tile from a pattern such as `"PHHPNN"` (Homes, Path, Nature, Water) and path groups such as
    /// `"100100"`. Panics on malformed patterns; templates are fixed data checked by tests.
    pub fn parse(kind: Kind, edges: &str, paths: &str) -> Self {
        let edges: Vec<Edge> = edges
            .chars()
            .map(|letter| match letter {
                'H' => Edge::Homes,
                'P' => Edge::Path,
                'N' => Edge::Nature,
                'W' => Edge::Water,
                _ => panic!("unknown edge letter {letter}"),
            })
            .collect();
        let paths: Vec<u8> = paths
            .chars()
            .map(|digit| digit.to_digit(10).expect("path group digit") as u8)
            .collect();
        Self {
            kind,
            edges: edges.try_into().expect("six edges"),
            paths: paths.try_into().expect("six path groups"),
        }
    }

    /// Edges after `rotation` sixth-turns.
    pub fn rotated(&self, rotation: u32) -> [Edge; SIDES] {
        turn(&self.edges, rotation)
    }

    /// Path groups after `rotation` sixth-turns.
    pub fn rotated_paths(&self, rotation: u32) -> [u8; SIDES] {
        turn(&self.paths, rotation)
    }

    pub fn mirrored(&self) -> Self {
        Self {
            kind: self.kind,
            edges: mirror(&self.edges),
            paths: mirror(&self.paths),
        }
    }

    pub fn homes(&self) -> u32 {
        self.edges
            .iter()
            .filter(|&&edge| edge == Edge::Homes)
            .count() as u32
    }

    /// The path group each home's entrance opens onto, by side; `None` for sides without a home and for
    /// homes on a tile with no path at all. Each home uses the nearest path edge around the tile, preferring
    /// side `i + step` on a tie (clockwise on screen in the default view), so the choice turns with the tile.
    pub fn entrances(&self) -> [Option<u8>; SIDES] {
        entrances(&self.edges, &self.paths)
    }
}

/// Entrances for rotated or unrotated per-side data; see `TileSpec::entrances`.
pub fn entrances(edges: &[Edge; SIDES], paths: &[u8; SIDES]) -> [Option<u8>; SIDES] {
    std::array::from_fn(|side| {
        if edges[side] != Edge::Homes {
            return None;
        }
        (1..=SIDES / 2).find_map(|step| {
            let after = (side + step) % SIDES;
            let before = (side + SIDES - step) % SIDES;
            [after, before]
                .into_iter()
                .find(|&other| paths[other] != 0)
                .map(|other| paths[other])
        })
    })
}

/// How a side of a placement meets its neighbor.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Meet {
    /// No neighbor yet; water left here is an open stream end.
    Open,
    /// Same edge on both sides: it scores and, for paths and water, joins the networks.
    Match,
    /// Different edges that may touch: allowed, but nothing joins and nothing scores.
    Differ,
    /// Two paths a cliff apart: allowed, but they cannot join, so they do not match.
    Steep,
    /// Water against anything but water: the placement is refused.
    Blocked,
}

/// Elevation difference at which paths can no longer join with stairs.
pub const CLIFF: u32 = 2;

/// Classifies a meeting between `own` and `other` across a boundary with elevation difference `rise`.
pub fn meet(own: Edge, other: Edge, rise: u32) -> Meet {
    use Edge::*;
    match (own, other) {
        (Water, Water) => Meet::Match,
        (Water, _) | (_, Water) => Meet::Blocked,
        (Path, Path) if rise >= CLIFF => Meet::Steep,
        _ if own == other => Meet::Match,
        _ => Meet::Differ,
    }
}

pub const STREAM_BLOCKED: &str =
    "Water must flow into water. Turn the tile so streams meet streams and land meets land.";

/// Unrotated templates per kind: an edge pattern and its path groups. The deck rotates and mirrors these.
/// Groups never interleave around the tile, so walks inside one tile never cross.
pub fn templates(kind: Kind) -> Vec<TileSpec> {
    let list: &[(&str, &str)] = match kind {
        Kind::Casas => &[
            ("PHHPHN", "100100"),
            ("PHPHHH", "101000"),
            ("PPHHNH", "110000"),
            ("PHHHHN", "100000"),
            ("PHHPHH", "100200"),
            ("PHPHPH", "101010"),
            ("PHNPHH", "100100"),
            ("HPHHNN", "010000"),
        ],
        Kind::Tienda => &[("PHPHHN", "101000"), ("PPHHNH", "110000")],
        Kind::Plaza => &[
            ("PPHPPH", "110110"),
            ("PNPNPN", "101010"),
            ("PHPPNP", "101101"),
        ],
        Kind::Parque => &[
            ("PNNPNN", "100100"),
            ("PNNNNN", "100000"),
            ("PNPNNN", "101000"),
        ],
        Kind::Capilla => &[("PHPNPN", "101010")],
        Kind::Monte => &[
            ("NNNNNN", "000000"),
            ("NNNNNP", "000001"),
            ("NNNNNH", "000000"),
        ],
        Kind::Sendero => &[
            ("PNNPNN", "100100"),
            ("PNPNNN", "101000"),
            ("PPNNNN", "110000"),
            ("PNNNHN", "100000"),
            ("PNNPNN", "100200"),
        ],
        Kind::Quebrada => &[
            ("WNNWNN", "000000"),
            ("WNWNNN", "000000"),
            ("WWNNNN", "000000"),
            ("WNNWNP", "000001"),
        ],
        Kind::Inicio => &[("PHHPNN", "100100")],
    };
    list.iter()
        .map(|(edges, paths)| TileSpec::parse(kind, edges, paths))
        .collect()
}

/// A tile whose only water edge is a spring and every other edge nature. The safety rule uses it.
pub fn spring() -> TileSpec {
    TileSpec::parse(Kind::Quebrada, "WNNNNN", "000000")
}

/// An all-nature tile. The safety rule uses it.
pub fn meadow() -> TileSpec {
    TileSpec::parse(Kind::Monte, "NNNNNN", "000000")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_templates() -> Vec<TileSpec> {
        KINDS.iter().flat_map(|&kind| templates(kind)).collect()
    }

    #[test]
    fn rotation_moves_each_edge_one_side_per_step() {
        let spec = TileSpec::parse(Kind::Casas, "PHNNNW", "100000");
        assert_eq!(spec.rotated(0), spec.edges);
        let once = spec.rotated(1);
        assert_eq!(once[1], Edge::Path);
        assert_eq!(once[0], Edge::Water);
        assert_eq!(spec.rotated_paths(1)[1], 1);
        for rotation in 0..6 {
            let turned = spec.rotated(rotation);
            for side in 0..SIDES {
                assert_eq!(turned[(side + rotation as usize) % SIDES], spec.edges[side]);
            }
        }
        assert_eq!(spec.rotated(6), spec.edges);
    }

    #[test]
    fn meeting_rules_are_symmetric_and_water_only_meets_water() {
        for a in EDGES {
            for b in EDGES {
                for rise in 0..4 {
                    assert_eq!(meet(a, b, rise), meet(b, a, rise), "{a:?} {b:?} {rise}");
                    let water = a == Edge::Water || b == Edge::Water;
                    let result = meet(a, b, rise);
                    assert_eq!(result == Meet::Blocked, water && a != b);
                }
            }
        }
        assert_eq!(meet(Edge::Water, Edge::Water, 3), Meet::Match);
        assert_eq!(meet(Edge::Nature, Edge::Water, 0), Meet::Blocked);
        assert_eq!(meet(Edge::Homes, Edge::Path, 0), Meet::Differ);
        assert_eq!(meet(Edge::Nature, Edge::Nature, 3), Meet::Match);
    }

    #[test]
    fn paths_join_across_one_terrace_but_not_a_cliff() {
        assert_eq!(meet(Edge::Path, Edge::Path, 0), Meet::Match);
        assert_eq!(meet(Edge::Path, Edge::Path, 1), Meet::Match);
        assert_eq!(meet(Edge::Path, Edge::Path, 2), Meet::Steep);
        assert_eq!(meet(Edge::Path, Edge::Nature, 2), Meet::Differ);
    }

    #[test]
    fn templates_are_well_formed() {
        for spec in all_templates() {
            let name = format!("{spec:?}");
            // Every tile keeps a dry edge, so it can always sit beside dry land.
            assert!(
                spec.edges.contains(&Edge::Nature)
                    || spec.edges.contains(&Edge::Homes)
                    || spec.edges.contains(&Edge::Path),
                "{name}"
            );
            for side in 0..SIDES {
                assert_eq!(
                    spec.edges[side] == Edge::Path,
                    spec.paths[side] != 0,
                    "{name}"
                );
            }
            // Path groups never interleave: walking around the tile, once a group is left it never returns
            // after another group has started.
            let order: Vec<u8> = spec
                .paths
                .iter()
                .copied()
                .filter(|&group| group != 0)
                .collect();
            for a in 1..=3 {
                for b in 1..=3 {
                    if a == b {
                        continue;
                    }
                    let mut pattern = order
                        .iter()
                        .filter(|&&g| g == a || g == b)
                        .copied()
                        .collect::<Vec<_>>();
                    pattern.dedup();
                    // Allow wraparound: a, b, a is fine when it closes the circle.
                    if pattern.first() == pattern.last() && pattern.len() > 1 {
                        pattern.pop();
                    }
                    assert!(pattern.len() <= 2, "{name} interleaves groups {a} and {b}");
                }
            }
            // Water tiles keep at least one dry edge and residential tiles reach a path.
            if spec.kind.family() == Family::Residential {
                assert!(spec.edges.contains(&Edge::Path), "{name}");
            }
        }
    }

    #[test]
    fn homes_open_onto_the_nearest_path_and_turn_with_the_tile() {
        let spec = TileSpec::parse(Kind::Casas, "PHHPHH", "100200");
        assert_eq!(
            spec.entrances(),
            [None, Some(1), Some(2), None, Some(2), Some(1)]
        );
        let lonely = TileSpec::parse(Kind::Monte, "NNNNNH", "000000");
        assert_eq!(lonely.entrances(), [None; SIDES]);
        for spec in all_templates() {
            for rotation in 0..6 {
                let turned = entrances(&spec.rotated(rotation), &spec.rotated_paths(rotation));
                assert_eq!(turned, turn(&spec.entrances(), rotation));
            }
        }
    }

    #[test]
    fn mirroring_twice_restores_the_tile() {
        for spec in all_templates() {
            assert_eq!(spec.mirrored().mirrored(), spec);
            assert_eq!(spec.mirrored().homes(), spec.homes());
        }
    }
}
