//! The four Colombian regions. Regions share every rule; they change the hillside's shape, the starting
//! settlement, and (in the renderer) palette and materials.

use serde::{Deserialize, Serialize};

use crate::rng::{self, Rng};
use crate::tile::{Kind, TileSpec};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Region {
    /// Aburrá Valley comunas: steep self-built hillsides climbed by stairs.
    Medellin,
    /// Eje Cafetero: rolling coffee country with fincas.
    Salento,
    /// Caribbean coast: flat ground, courtyards, lagoons.
    Cartagena,
    /// The Sabana against the Eastern Hills: a plain that rises on one side.
    Bogota,
}

pub const REGIONS: [Region; 4] = [
    Region::Medellin,
    Region::Salento,
    Region::Cartagena,
    Region::Bogota,
];

/// Hillside shape: `level = base + uphill * slope + relief`, floored and clamped to `0..=ceiling`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shape {
    pub base: f64,
    pub slope: f64,
    pub broad: f64,
    pub fine: f64,
    pub ceiling: u8,
}

impl Region {
    /// The run's region, chosen from the seed on its own random stream.
    pub fn of(seed: u32) -> Self {
        REGIONS[Rng::new(seed, rng::REGION).below(REGIONS.len() as u32) as usize]
    }

    pub fn name(self) -> &'static str {
        match self {
            Region::Medellin => "Medellín",
            Region::Salento => "Salento",
            Region::Cartagena => "Cartagena",
            Region::Bogota => "Bogotá",
        }
    }

    pub fn shape(self) -> Shape {
        match self {
            Region::Medellin => Shape {
                base: 3.4,
                slope: 0.42,
                broad: 2.6,
                fine: 0.9,
                ceiling: 7,
            },
            Region::Salento => Shape {
                base: 3.0,
                slope: 0.2,
                broad: 3.0,
                fine: 0.6,
                ceiling: 6,
            },
            Region::Cartagena => Shape {
                base: 0.7,
                slope: 0.05,
                broad: 1.1,
                fine: 0.3,
                ceiling: 2,
            },
            Region::Bogota => Shape {
                base: 1.4,
                slope: 0.3,
                broad: 1.2,
                fine: 0.4,
                ceiling: 5,
            },
        }
    }

    /// The starting settlement. It has paths leading out and no water, so the first tile always has room.
    pub fn start(self) -> TileSpec {
        let (edges, paths) = match self {
            // Two homes on a stair street that runs straight through.
            Region::Medellin => ("PHHPNN", "100100"),
            // A farmhouse on a bending lane, gardens all around.
            Region::Salento => ("PNHNNP", "100001"),
            // A courtyard house entered from two lanes, with palms.
            Region::Cartagena => ("PHHNPN", "100010"),
            // A brick house beside a public path.
            Region::Bogota => ("PHNPNN", "100100"),
        };
        TileSpec::parse(Kind::Inicio, edges, paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile::Edge;

    #[test]
    fn every_region_is_chosen_by_some_seed_and_choice_is_stable() {
        let mut seen = std::collections::BTreeSet::new();
        for seed in 0..200 {
            assert_eq!(Region::of(seed), Region::of(seed));
            seen.insert(format!("{:?}", Region::of(seed)));
        }
        assert_eq!(seen.len(), 4);
    }

    #[test]
    fn starts_have_homes_paths_out_and_no_water() {
        for region in REGIONS {
            let start = region.start();
            assert!(start.homes() >= 1);
            assert!(
                start
                    .edges
                    .iter()
                    .filter(|&&edge| edge == Edge::Path)
                    .count()
                    >= 2
            );
            assert!(!start.edges.contains(&Edge::Water));
            assert!(start.entrances().iter().flatten().count() as u32 == start.homes());
        }
    }
}
