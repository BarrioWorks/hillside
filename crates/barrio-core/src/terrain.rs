pub const WIDTH: u32 = 32;
pub const DEPTH: u32 = 32;
pub const CELL_COUNT: usize = (WIDTH * DEPTH) as usize;
pub const TERRAIN_ID: &str = "hillside-v1";

pub fn mix(mut value: u32) -> u32 {
    value = (value ^ (value >> 16)).wrapping_mul(0x7feb_352d);
    value = (value ^ (value >> 15)).wrapping_mul(0x846c_a68b);
    value ^ (value >> 16)
}

pub fn generate(seed: u32) -> [u8; CELL_COUNT] {
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
