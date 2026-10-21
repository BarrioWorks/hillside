//! The hidden hillside under the neighborhood. Every hex has an elevation decided by the seed and the
//! region; placing a tile reveals the ground at that spot. The ground is unbounded, so the neighborhood can
//! always grow outward, and computed on demand, so it costs nothing to store or to replay.

use crate::hex::{Hex, DIRECTIONS};
use crate::region::{Region, Shape};

pub fn mix(mut value: u32) -> u32 {
    value = (value ^ (value >> 16)).wrapping_mul(0x7feb_352d);
    value = (value ^ (value >> 15)).wrapping_mul(0x846c_a68b);
    value ^ (value >> 16)
}

fn lattice(seed: u32, x: i32, z: i32) -> f64 {
    let hash =
        mix(seed ^ (x as u32).wrapping_mul(0x27d4_eb2d) ^ (z as u32).wrapping_mul(0x1656_67b1));
    f64::from(hash & 0xffff) / 65535.0
}

fn smooth_noise(seed: u32, x: f64, z: f64) -> f64 {
    let (ix, iz) = (x.floor() as i32, z.floor() as i32);
    let (fx, fz) = (x - x.floor(), z - z.floor());
    let (sx, sz) = (fx * fx * (3.0 - 2.0 * fx), fz * fz * (3.0 - 2.0 * fz));
    let top = lattice(seed, ix, iz) * (1.0 - sx) + lattice(seed, ix + 1, iz) * sx;
    let bottom = lattice(seed, ix, iz + 1) * (1.0 - sx) + lattice(seed, ix + 1, iz + 1) * sx;
    top * (1.0 - sz) + bottom * sz
}

#[derive(Clone, Debug, PartialEq)]
pub struct Terrain {
    seed: u32,
    shape: Shape,
    /// Unit vector pointing downhill.
    downhill: (f64, f64),
    /// Fixed levels for tests; consulted before the generator.
    fixed: Option<std::collections::BTreeMap<Hex, u8>>,
    flat: Option<u8>,
}

impl Terrain {
    /// The region's hillside: the ground rises away from a seeded downhill direction, with rolling relief.
    pub fn hillside(seed: u32, region: Region) -> Self {
        let (dx, dz) = DIRECTIONS[(mix(seed ^ 0xa5a5) % 6) as usize].center();
        let length = (dx * dx + dz * dz).sqrt();
        Self {
            seed,
            shape: region.shape(),
            downhill: (dx / length, dz / length),
            fixed: None,
            flat: None,
        }
    }

    /// Flat ground at one level, for tests.
    pub fn flat(level: u8) -> Self {
        Self {
            seed: 0,
            shape: Region::Cartagena.shape(),
            downhill: (1.0, 0.0),
            fixed: Some(Default::default()),
            flat: Some(level),
        }
    }

    pub fn level(&self, hex: Hex) -> u32 {
        if let Some(level) = self.fixed.as_ref().and_then(|fixed| fixed.get(&hex)) {
            return u32::from(*level);
        }
        if let Some(level) = self.flat {
            return u32::from(level);
        }
        let (x, z) = hex.center();
        let shape = &self.shape;
        // Distance uphill in hex-center units.
        let uphill = -(x * self.downhill.0 + z * self.downhill.1) / 3f64.sqrt();
        let relief = (smooth_noise(self.seed, x / 7.0, z / 7.0) - 0.5) * shape.broad
            + (smooth_noise(self.seed ^ 0x5bd1_e995, x / 3.0, z / 3.0) - 0.5) * shape.fine;
        let level = shape.base + uphill * shape.slope + relief;
        level.floor().clamp(0.0, f64::from(shape.ceiling)) as u32
    }

    /// Overrides one level; for tests on flat ground.
    pub fn set(&mut self, hex: Hex, level: u8) {
        self.fixed
            .get_or_insert_with(Default::default)
            .insert(hex, level);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::region::REGIONS;

    #[test]
    fn hillsides_are_deterministic_and_vary_by_seed() {
        let a = Terrain::hillside(7, Region::Medellin);
        let b = Terrain::hillside(7, Region::Medellin);
        let c = Terrain::hillside(8, Region::Medellin);
        let levels = |t: &Terrain| {
            Hex::spiral(6)
                .into_iter()
                .map(|hex| t.level(hex))
                .collect::<Vec<_>>()
        };
        assert_eq!(levels(&a), levels(&b));
        assert_ne!(levels(&a), levels(&c));
    }

    #[test]
    fn regions_have_their_own_relief() {
        let spread = |region: Region| {
            let mut total = 0;
            for seed in 0..20 {
                let terrain = Terrain::hillside(seed, region);
                let levels: Vec<_> = Hex::spiral(5)
                    .into_iter()
                    .map(|hex| terrain.level(hex))
                    .collect();
                total += levels.iter().max().unwrap() - levels.iter().min().unwrap();
            }
            total
        };
        assert!(spread(Region::Medellin) > spread(Region::Cartagena) * 2);
        for region in REGIONS {
            let terrain = Terrain::hillside(3, region);
            for hex in Hex::spiral(12) {
                assert!(terrain.level(hex) <= u32::from(region.shape().ceiling));
            }
        }
    }

    #[test]
    fn ground_continues_far_from_the_start() {
        let terrain = Terrain::hillside(1, Region::Medellin);
        let far = Hex::new(500, -200);
        assert_eq!(terrain.level(far), terrain.level(far));
    }

    #[test]
    fn overrides_win_on_flat_ground() {
        let mut terrain = Terrain::flat(2);
        terrain.set(Hex::new(1, 0), 4);
        assert_eq!(terrain.level(Hex::new(1, 0)), 4);
        assert_eq!(terrain.level(Hex::new(0, 1)), 2);
    }
}
