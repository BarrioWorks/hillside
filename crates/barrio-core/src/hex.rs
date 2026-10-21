//! Flat-top hexagons in axial coordinates `(q, r)`, after Amit Patel's "Hexagonal Grids" (Red Blob Games).
//!
//! World position of a hex with circumradius `s`: `x = 1.5 s q`, `z = √3 s (r + q / 2)`.
//! Edge `i` faces the neighbor `DIRECTIONS[i]`, whose outward normal points at `30° + 60° i` from +X
//! toward +Z. Turning a tile by one rotation step moves its edge `i` to edge `i + 1`.

use serde::{Deserialize, Serialize};

pub const SIDES: usize = 6;

#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, Deserialize, Serialize,
)]
pub struct Hex {
    pub q: i32,
    pub r: i32,
}

/// Neighbor offsets indexed by edge.
pub const DIRECTIONS: [Hex; SIDES] = [
    Hex::new(1, 0),
    Hex::new(0, 1),
    Hex::new(-1, 1),
    Hex::new(-1, 0),
    Hex::new(0, -1),
    Hex::new(1, -1),
];

impl Hex {
    pub const ORIGIN: Hex = Hex::new(0, 0);

    pub const fn new(q: i32, r: i32) -> Self {
        Self { q, r }
    }

    /// The implicit third cube coordinate; `q + r + s == 0`.
    pub const fn s(self) -> i32 {
        -self.q - self.r
    }

    pub fn neighbor(self, edge: usize) -> Hex {
        let d = DIRECTIONS[edge % SIDES];
        Hex::new(self.q + d.q, self.r + d.r)
    }

    pub fn neighbors(self) -> impl Iterator<Item = (usize, Hex)> {
        (0..SIDES).map(move |edge| (edge, self.neighbor(edge)))
    }

    pub fn distance(self, other: Hex) -> u32 {
        // Widened so coordinates anywhere in i32 cannot overflow.
        let dq = i64::from(self.q) - i64::from(other.q);
        let dr = i64::from(self.r) - i64::from(other.r);
        let ds = -dq - dr;
        let farthest = dq
            .unsigned_abs()
            .max(dr.unsigned_abs())
            .max(ds.unsigned_abs());
        u32::try_from(farthest).unwrap_or(u32::MAX)
    }

    pub fn length(self) -> u32 {
        self.distance(Hex::ORIGIN)
    }

    /// Rotates about the origin by `steps` sixths of a turn, in the same sense as edge rotation.
    pub fn rotate(self, steps: u32) -> Hex {
        let (mut x, mut y, mut z) = (self.q, self.r, self.s());
        for _ in 0..steps % 6 {
            (x, y, z) = (-y, -z, -x);
        }
        let _ = z;
        Hex::new(x, y)
    }

    /// Every hex within `radius` of the origin, ring by ring from the center outward.
    pub fn spiral(radius: u32) -> Vec<Hex> {
        let mut cells = vec![Hex::ORIGIN];
        for ring in 1..=radius as i32 {
            // Start at the ring's corner along edge 4 and walk each side.
            let mut hex = Hex::new(DIRECTIONS[4].q * ring, DIRECTIONS[4].r * ring);
            for side in 0..SIDES {
                for _ in 0..ring {
                    cells.push(hex);
                    hex = hex.neighbor(side);
                }
            }
        }
        cells
    }

    /// Unit-circumradius world position `(x, z)`.
    pub fn center(self) -> (f64, f64) {
        let (q, r) = (f64::from(self.q), f64::from(self.r));
        (1.5 * q, 3f64.sqrt() * (r + q / 2.0))
    }
}

/// The edge on the neighboring tile that touches edge `edge` of this tile.
pub const fn opposite(edge: usize) -> usize {
    (edge + 3) % SIDES
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neighbors_are_six_distinct_unit_steps_with_opposites() {
        let center = Hex::new(3, -2);
        let neighbors: Vec<_> = center.neighbors().map(|(_, hex)| hex).collect();
        assert_eq!(neighbors.len(), 6);
        for (edge, hex) in center.neighbors() {
            assert_eq!(center.distance(hex), 1);
            assert_eq!(hex.neighbor(opposite(edge)), center);
            assert_eq!(hex.q + hex.r + hex.s(), 0);
        }
        let unique: std::collections::HashSet<_> = neighbors.iter().collect();
        assert_eq!(unique.len(), 6);
    }

    #[test]
    fn edge_normals_point_at_thirty_plus_sixty_degrees() {
        for (edge, hex) in Hex::ORIGIN.neighbors() {
            let (x, z) = hex.center();
            let angle = z.atan2(x).to_degrees().rem_euclid(360.0);
            assert!(
                (angle - (30.0 + 60.0 * edge as f64)).abs() < 1e-9,
                "{edge}: {angle}"
            );
            // Neighbor centers sit at twice the inradius.
            assert!(((x * x + z * z).sqrt() - 3f64.sqrt()).abs() < 1e-9);
        }
    }

    #[test]
    fn rotation_by_one_step_maps_each_direction_to_the_next() {
        for edge in 0..SIDES {
            assert_eq!(DIRECTIONS[edge].rotate(1), DIRECTIONS[(edge + 1) % SIDES]);
            assert_eq!(DIRECTIONS[edge].rotate(6), DIRECTIONS[edge]);
        }
        let hex = Hex::new(2, -1);
        assert_eq!(hex.rotate(3), Hex::new(-2, 1));
        assert_eq!(hex.rotate(2).rotate(4), hex);
    }

    #[test]
    fn spiral_covers_a_disc_exactly_once_in_ring_order() {
        for radius in 0..6 {
            let cells = Hex::spiral(radius);
            assert_eq!(cells.len(), (3 * radius * (radius + 1) + 1) as usize);
            let unique: std::collections::HashSet<_> = cells.iter().collect();
            assert_eq!(unique.len(), cells.len());
            assert!(cells
                .windows(2)
                .all(|pair| pair[0].length() <= pair[1].length()));
            assert!(cells.iter().all(|hex| hex.length() <= radius));
        }
    }

    #[test]
    fn distance_is_symmetric_and_obeys_the_triangle_inequality() {
        let cells = Hex::spiral(3);
        for &a in &cells {
            for &b in &cells {
                assert_eq!(a.distance(b), b.distance(a));
                assert_eq!(a.distance(b) == 0, a == b);
                for &c in cells.iter().step_by(7) {
                    assert!(a.distance(c) <= a.distance(b) + b.distance(c));
                }
            }
        }
    }
}
