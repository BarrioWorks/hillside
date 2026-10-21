//! Placement points. One pure function used by both the preview and the award.

use serde::Serialize;

pub const BASE: u32 = 10;
pub const PER_MATCH: u32 = 20;
pub const PERFECT: u32 = 60;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Points {
    pub base: u32,
    pub matches: u32,
    pub match_points: u32,
    pub perfect: bool,
    pub perfect_bonus: u32,
    pub total: u32,
}

/// Points for a valid placement that creates `matches` new matching edges. `perfect` means all six sides
/// touch tiles and all six match.
pub fn points(matches: u32, perfect: bool) -> Points {
    let match_points = PER_MATCH * matches;
    let perfect_bonus = if perfect { PERFECT } else { 0 };
    Points {
        base: BASE,
        matches,
        match_points,
        perfect,
        perfect_bonus,
        total: BASE + match_points + perfect_bonus,
    }
}

/// Short feedback shown beside the points, if the placement deserves one.
pub fn label(points: &Points) -> Option<&'static str> {
    if points.perfect {
        Some("Perfect placement")
    } else if points.matches >= 4 {
        Some("Great connection")
    } else if points.matches == 3 {
        Some("Good connection")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoring_follows_the_classic_table() {
        assert_eq!(points(0, false).total, 10);
        assert_eq!(points(2, false).total, 50);
        assert_eq!(points(4, false).total, 90);
        assert_eq!(points(6, true).total, 190);
        for matches in 0..=6 {
            let p = points(matches, matches == 6);
            assert_eq!(p.total, p.base + p.match_points + p.perfect_bonus);
            assert!(p.total >= BASE && p.total <= 190);
        }
    }
}
