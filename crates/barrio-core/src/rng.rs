//! Integer random streams. Every random choice in the rules comes from a seed and a named stream, so a run
//! replays exactly on any platform.

/// SplitMix64: small, fast, and the same everywhere.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rng(u64);

/// Stream salts. Separate streams keep, for example, reward tiles from shifting the starting deck.
pub const DECK: u64 = 0x6465_636b;
pub const REWARDS: u64 = 0x7265_7761;
pub const REGION: u64 = 0x7265_6769;

impl Rng {
    /// A stream for `seed`. Seed and stream are each hashed before they combine, so indexed streams such as
    /// rewards never land on another seed's stream.
    pub fn new(seed: u32, stream: u64) -> Self {
        let mut rng = Self(hash(hash(u64::from(seed)) ^ stream));
        rng.next_u64();
        rng
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// A number in `0..bound`; `bound` must be positive.
    pub fn below(&mut self, bound: u32) -> u32 {
        // The multiply-shift reduction is unbiased enough for game choices and stays integer-only.
        (((self.next_u64() >> 32) * u64::from(bound)) >> 32) as u32
    }

    /// Picks an index by integer weights.
    pub fn weighted(&mut self, weights: &[u32]) -> usize {
        let total: u32 = weights.iter().sum();
        let mut pick = self.below(total);
        for (index, &weight) in weights.iter().enumerate() {
            if pick < weight {
                return index;
            }
            pick -= weight;
        }
        weights.len() - 1
    }

    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for last in (1..items.len()).rev() {
            let pick = self.below(last as u32 + 1) as usize;
            items.swap(last, pick);
        }
    }
}

/// The SplitMix64 finalizer: a bijection on u64 that scrambles every bit.
fn hash(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9e37_79b9_7f4a_7c15);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streams_are_reproducible_and_independent() {
        let a: Vec<_> = (0..20)
            .map({
                let mut rng = Rng::new(7, DECK);
                move |_| rng.next_u64()
            })
            .collect();
        let b: Vec<_> = (0..20)
            .map({
                let mut rng = Rng::new(7, DECK);
                move |_| rng.next_u64()
            })
            .collect();
        let c: Vec<_> = (0..20)
            .map({
                let mut rng = Rng::new(7, REWARDS);
                move |_| rng.next_u64()
            })
            .collect();
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn seeds_and_streams_never_alias() {
        let first = |seed, stream| Rng::new(seed, stream).next_u64();
        assert_ne!(first(0, REWARDS ^ (1 << 40)), first(256, REWARDS));
        let mut seen = std::collections::BTreeSet::new();
        for seed in 0..64 {
            for index in 0..64u64 {
                assert!(seen.insert(first(seed, REWARDS ^ (index << 40))));
            }
        }
    }

    #[test]
    fn below_stays_in_range_and_covers_it() {
        let mut rng = Rng::new(1, DECK);
        let mut seen = [0u32; 6];
        for _ in 0..6000 {
            seen[rng.below(6) as usize] += 1;
        }
        assert!(
            seen.iter().all(|&count| (800..1200).contains(&count)),
            "{seen:?}"
        );
    }
}
