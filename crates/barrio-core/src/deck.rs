//! The finite tile supply: a 30-tile starting deck built from family shares, and reward tiles drawn from a
//! separate random stream so earning them never reorders the deck.

use crate::rng::{self, Rng};
use crate::tile::{templates, Family, Kind, TileSpec};

pub const STARTING_TILES: u32 = 30;
/// The most playable tiles the deck may hold; rewards beyond it are discarded.
pub const CAP: u32 = 60;

/// Family shares in percent, in the order ties are broken.
pub const SHARES: [(Family, u32); 5] = [
    (Family::Residential, 35),
    (Family::Nature, 25),
    (Family::Landscape, 20),
    (Family::Water, 10),
    (Family::Community, 10),
];

/// Tiles per family for a deck of `total`, by largest remainder: every family gets the floor of its share,
/// then leftover tiles go to the largest fractional parts, ties to the family listed first.
pub fn family_counts(total: u32) -> [(Family, u32); 5] {
    let mut counts = SHARES.map(|(family, share)| (family, total * share / 100));
    let assigned: u32 = counts.iter().map(|(_, count)| count).sum();
    let mut order: Vec<usize> = (0..SHARES.len()).collect();
    order.sort_by_key(|&index| std::cmp::Reverse((total * SHARES[index].1) % 100));
    for &index in order.iter().take((total - assigned) as usize) {
        counts[index].1 += 1;
    }
    counts
}

fn kind(family: Family, rng: &mut Rng) -> Kind {
    match family {
        Family::Residential => Kind::Casas,
        Family::Nature => Kind::Monte,
        Family::Landscape => Kind::Sendero,
        Family::Water => Kind::Quebrada,
        Family::Community => {
            const KINDS: [Kind; 4] = [Kind::Tienda, Kind::Plaza, Kind::Parque, Kind::Capilla];
            KINDS[rng.weighted(&[3, 3, 3, 1])]
        }
        Family::Landmark => Kind::Inicio,
    }
}

/// One tile of `family`: a kind, one of its templates, mirrored half the time.
fn make(family: Family, rng: &mut Rng) -> TileSpec {
    let kind = kind(family, rng);
    let options = templates(kind);
    let spec = options[rng.below(options.len() as u32) as usize];
    if rng.below(2) == 1 {
        spec.mirrored()
    } else {
        spec
    }
}

/// The seed's starting deck, front first.
pub fn starting(seed: u32) -> Vec<TileSpec> {
    let mut families: Vec<Family> = family_counts(STARTING_TILES)
        .iter()
        .flat_map(|&(family, count)| std::iter::repeat_n(family, count as usize))
        .collect();
    let mut rng = Rng::new(seed, rng::DECK);
    rng.shuffle(&mut families);
    families
        .into_iter()
        .map(|family| make(family, &mut rng))
        .collect()
}

/// The `index`th reward tile of a run. Each reward has its own stream, so its tile depends only on the seed
/// and how many rewards came before it.
pub fn reward(seed: u32, index: u32) -> TileSpec {
    let mut rng = Rng::new(seed, rng::REWARDS ^ (u64::from(index) << 40));
    let weights = SHARES.map(|(_, share)| share);
    make(SHARES[rng.weighted(&weights)].0, &mut rng)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding_gives_exactly_thirty_with_the_documented_split() {
        let counts = family_counts(30);
        assert_eq!(counts.iter().map(|(_, count)| count).sum::<u32>(), 30);
        assert_eq!(counts.map(|(_, count)| count), [11, 7, 6, 3, 3]);
        for total in 1..=80 {
            assert_eq!(
                family_counts(total).iter().map(|(_, c)| c).sum::<u32>(),
                total
            );
        }
    }

    #[test]
    fn decks_are_reproducible_seeded_and_follow_the_split() {
        assert_eq!(starting(11), starting(11));
        assert_ne!(starting(11), starting(12));
        for seed in 0..50 {
            let deck = starting(seed);
            assert_eq!(deck.len(), 30);
            for (family, count) in family_counts(30) {
                let found = deck
                    .iter()
                    .filter(|tile| tile.kind.family() == family)
                    .count() as u32;
                assert_eq!(found, count, "seed {seed} {family:?}");
            }
            assert!(deck.iter().all(|tile| tile.kind != Kind::Inicio));
        }
    }

    #[test]
    fn rewards_come_from_their_own_stream() {
        assert_eq!(reward(5, 3), reward(5, 3));
        let rewards: Vec<_> = (0..40).map(|index| reward(5, index)).collect();
        assert!(rewards.windows(2).any(|pair| pair[0] != pair[1]));
        // Drawing rewards never touches the starting deck.
        assert_eq!(starting(5), starting(5));
    }
}
