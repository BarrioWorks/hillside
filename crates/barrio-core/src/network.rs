//! Connected networks, kept up to date one tile at a time with a union-find.
//!
//! Nodes are the connected parts of each tile: one per path group, one for its nature area, one for its
//! stream. Placing a tile adds its nodes and joins them to the neighbors it matches. Paths join only across
//! one terrace or less; nature and water join at any height. Tiles are never removed, so union-find is exact.

use serde::Serialize;

use crate::hex::SIDES;
use crate::tile::{Edge, TileSpec};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Feature {
    Path,
    Nature,
    Water,
}

/// The node ids of one tile: per side, the node that side's edge belongs to (`None` for homes edges).
pub type TileNodes = [Option<u32>; SIDES];

#[derive(Clone, Debug, Default)]
pub struct Networks {
    parent: Vec<u32>,
    feature: Vec<Option<Feature>>,
    /// Per root: homes reached and tiles (nodes) joined.
    homes: Vec<u32>,
    size: Vec<u32>,
}

impl Networks {
    fn root(&self, mut node: u32) -> u32 {
        while self.parent[node as usize] != node {
            node = self.parent[node as usize];
        }
        node
    }

    fn make(&mut self, feature: Feature, homes: u32) -> u32 {
        let id = self.parent.len() as u32;
        self.parent.push(id);
        self.feature.push(Some(feature));
        self.homes.push(homes);
        self.size.push(1);
        id
    }

    pub fn union(&mut self, a: u32, b: u32) {
        let (a, b) = (self.root(a), self.root(b));
        if a == b {
            return;
        }
        // Join the smaller tree under the larger; ties go to the older root so ids stay stable.
        let (big, small) = if (self.size[a as usize], b) >= (self.size[b as usize], a) {
            (a, b)
        } else {
            (b, a)
        };
        self.parent[small as usize] = big;
        self.size[big as usize] += self.size[small as usize];
        self.homes[big as usize] += self.homes[small as usize];
    }

    /// Adds a placed tile's nodes, rotated as placed. Returns the node of each side.
    pub fn add_tile(&mut self, spec: &TileSpec, rotation: u32) -> TileNodes {
        let edges = spec.rotated(rotation);
        let paths = spec.rotated_paths(rotation);
        let entrances = crate::tile::entrances(&edges, &paths);
        let mut nodes: TileNodes = [None; SIDES];
        // Groups are decimal digits in templates, so ten slots cover every group number.
        let mut groups: [Option<u32>; 10] = [None; 10];
        let mut nature = None;
        let mut water = None;
        for side in 0..SIDES {
            nodes[side] = match edges[side] {
                Edge::Path => {
                    let group = paths[side] as usize;
                    Some(*groups[group].get_or_insert_with(|| {
                        let homes = entrances
                            .iter()
                            .filter(|&&door| door == Some(group as u8))
                            .count();
                        self.make(Feature::Path, homes as u32)
                    }))
                }
                Edge::Nature => Some(*nature.get_or_insert_with(|| self.make(Feature::Nature, 0))),
                Edge::Water => Some(*water.get_or_insert_with(|| self.make(Feature::Water, 0))),
                Edge::Homes => None,
            };
        }
        nodes
    }

    /// A stable id for the network a node belongs to.
    pub fn network(&self, node: u32) -> u32 {
        self.root(node)
    }

    pub fn homes(&self, node: u32) -> u32 {
        self.homes[self.root(node) as usize]
    }

    pub fn size(&self, node: u32) -> u32 {
        self.size[self.root(node) as usize]
    }

    /// The largest network of a feature by its measure: homes for paths, tiles for nature and water.
    pub fn largest(&self, feature: Feature) -> u32 {
        (0..self.parent.len() as u32)
            .filter(|&node| {
                self.parent[node as usize] == node && self.feature[node as usize] == Some(feature)
            })
            .map(|root| match feature {
                Feature::Path => self.homes[root as usize],
                _ => self.size[root as usize],
            })
            .max()
            .unwrap_or(0)
    }

    pub fn count(&self, feature: Feature) -> u32 {
        (0..self.parent.len() as u32)
            .filter(|&node| {
                self.parent[node as usize] == node && self.feature[node as usize] == Some(feature)
            })
            .count() as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile::Kind;

    #[test]
    fn a_tile_gets_one_node_per_path_group_and_one_per_area() {
        let mut networks = Networks::default();
        let spec = TileSpec::parse(Kind::Casas, "PHHPHH", "100200");
        let nodes = networks.add_tile(&spec, 0);
        assert_ne!(
            nodes[0], nodes[3],
            "separate walks stay separate inside the tile"
        );
        assert_eq!(nodes[1], None);
        // Homes 1 and 5 open onto walk 1; homes 2 and 4 onto walk 2.
        assert_eq!(networks.homes(nodes[0].unwrap()), 2);
        assert_eq!(networks.homes(nodes[3].unwrap()), 2);
        let park = TileSpec::parse(Kind::Parque, "PNNPNN", "100100");
        let nodes = networks.add_tile(&park, 0);
        assert_eq!(nodes[0], nodes[3]);
        assert_eq!(nodes[1], nodes[5], "nature on a tile is one area");
    }

    #[test]
    fn union_merges_homes_and_sizes() {
        let mut networks = Networks::default();
        let spec = TileSpec::parse(Kind::Casas, "PHHPHN", "100100");
        let a = networks.add_tile(&spec, 0)[0].unwrap();
        let b = networks.add_tile(&spec, 0)[3].unwrap();
        assert_eq!(networks.largest(Feature::Path), 3);
        networks.union(a, b);
        assert_eq!(networks.homes(a), 6);
        assert_eq!(networks.size(b), 2);
        assert_eq!(networks.network(a), networks.network(b));
        assert_eq!(networks.largest(Feature::Path), 6);
        networks.union(b, a);
        assert_eq!(networks.homes(a), 6, "joining twice counts nothing twice");
    }
}
