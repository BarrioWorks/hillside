pub const WIDTH: u32 = 32;
pub const DEPTH: u32 = 32;
pub const CELL_COUNT: usize = (WIDTH * DEPTH) as usize;

/// Terrain generators by save identifier. New neighborhoods use the latest; older saves keep theirs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Generator {
    /// Straight terrace bands, the original prototype hillside.
    Bands,
    /// Contour terraces: a slope plus smooth seeded relief, quantized into single steps.
    Contours,
}

impl Generator {
    pub const LATEST: Generator = Generator::Contours;

    pub fn id(self) -> &'static str {
        match self {
            Generator::Bands => "hillside-v1",
            Generator::Contours => "hillside-v2",
        }
    }

    pub fn parse(id: &str) -> Option<Self> {
        [Generator::Bands, Generator::Contours]
            .into_iter()
            .find(|generator| generator.id() == id)
    }

    pub fn generate(self, seed: u32) -> [u8; CELL_COUNT] {
        match self {
            Generator::Bands => bands(seed),
            Generator::Contours => contours(seed),
        }
    }
}

pub fn mix(mut value: u32) -> u32 {
    value = (value ^ (value >> 16)).wrapping_mul(0x7feb_352d);
    value = (value ^ (value >> 15)).wrapping_mul(0x846c_a68b);
    value ^ (value >> 16)
}

fn bands(seed: u32) -> [u8; CELL_COUNT] {
    let offsets: [u32; 4] = std::array::from_fn(|band| {
        mix(seed.wrapping_add((band as u32).wrapping_mul(0x9e37_79b9))) % 3
    });
    std::array::from_fn(|index| {
        let x = index as u32 % WIDTH;
        let z = index as u32 / WIDTH;
        ((DEPTH - 1 - z + offsets[(x / 8) as usize]) / 6) as u8
    })
}

pub fn index(x: u32, z: u32) -> usize {
    (z * WIDTH + x) as usize
}

pub fn facing(rotation: u32) -> (i32, i32) {
    match rotation {
        0 => (0, 1),
        1 => (1, 0),
        2 => (0, -1),
        3 => (-1, 0),
        _ => unreachable!("rotation is validated at the boundary"),
    }
}

pub fn neighbor(x: u32, z: u32, dx: i32, dz: i32) -> Option<(u32, u32)> {
    let x = x as i64 + i64::from(dx);
    let z = z as i64 + i64::from(dz);
    (x >= 0 && z >= 0 && x < i64::from(WIDTH) && z < i64::from(DEPTH))
        .then_some((x as u32, z as u32))
}

fn lattice(seed: u32, x: i32, z: i32) -> f32 {
    let hash =
        mix(seed ^ (x as u32).wrapping_mul(0x27d4_eb2d) ^ (z as u32).wrapping_mul(0x1656_67b1));
    (hash & 0xffff) as f32 / 65535.0
}

fn smooth_noise(seed: u32, x: f32, z: f32) -> f32 {
    let (ix, iz) = (x.floor() as i32, z.floor() as i32);
    let (fx, fz) = (x - x.floor(), z - z.floor());
    let (sx, sz) = (fx * fx * (3.0 - 2.0 * fx), fz * fz * (3.0 - 2.0 * fz));
    let top = lattice(seed, ix, iz) * (1.0 - sx) + lattice(seed, ix + 1, iz) * sx;
    let bottom = lattice(seed, ix, iz + 1) * (1.0 - sx) + lattice(seed, ix + 1, iz + 1) * sx;
    top * (1.0 - sz) + bottom * sz
}

fn contours(seed: u32) -> [u8; CELL_COUNT] {
    let mut heights: [u8; CELL_COUNT] = std::array::from_fn(|index| {
        let x = (index as u32 % WIDTH) as f32;
        let z = (index as u32 / WIDTH) as f32;
        let slope = (DEPTH as f32 - 1.0 - z) / (DEPTH as f32 - 1.0) * 5.7;
        let relief = (smooth_noise(seed, x / 9.0, z / 9.0) - 0.5) * 2.2
            + (smooth_noise(seed ^ 0x5bd1_e995, x / 4.5, z / 4.5) - 0.5) * 0.5;
        (slope + relief + 0.25).floor().clamp(0.0, 5.0) as u8
    });
    // Neighboring terraces differ by at most one step so stairs can always connect them.
    loop {
        let mut changed = false;
        for z in 0..DEPTH {
            for x in 0..WIDTH {
                let here = heights[index(x, z)];
                for (dx, dz) in [(0, 1), (1, 0), (0, -1), (-1, 0)] {
                    if let Some((nx, nz)) = neighbor(x, z, dx, dz) {
                        let limit = heights[index(nx, nz)] + 1;
                        if here > limit {
                            heights[index(x, z)] = limit;
                            changed = true;
                        }
                    }
                }
            }
        }
        if !changed {
            return heights;
        }
    }
}
