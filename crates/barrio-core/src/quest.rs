//! Quests: three families, each climbing small → medium → large. Quests measure the board after a placement
//! and pay once. The ladder is finite, which bounds how many tiles a run can ever hold.

use serde::Serialize;

use crate::board::Stats;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QuestFamily {
    /// Homes on the main walk: the walk with the most homes.
    Residential,
    /// Tiles in the largest connected nature area.
    Nature,
    /// Tiles in the longest connected stream.
    Water,
}

pub const FAMILIES: [QuestFamily; 3] = [
    QuestFamily::Residential,
    QuestFamily::Nature,
    QuestFamily::Water,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Tier {
    Small,
    Medium,
    Large,
}

/// What one rung of the ladder asks for and pays.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rung {
    pub target: u32,
    pub points: u32,
    pub tiles: u32,
}

/// The ladder. The brief's values, except two balance changes measured with the simulator
/// (docs/classic-gameplay.md, "Balance"): water targets 3/5/8 instead of 4/8/15, because water is a tenth
/// of the tiles, and small quests pay 3 tiles instead of 2. Change `RULES` in lib.rs whenever this changes.
pub fn rung(family: QuestFamily, tier: Tier) -> Rung {
    let target = match (family, tier) {
        (QuestFamily::Residential | QuestFamily::Nature, Tier::Small) => 5,
        (QuestFamily::Residential | QuestFamily::Nature, Tier::Medium) => 12,
        (QuestFamily::Residential | QuestFamily::Nature, Tier::Large) => 25,
        (QuestFamily::Water, Tier::Small) => 3,
        (QuestFamily::Water, Tier::Medium) => 5,
        (QuestFamily::Water, Tier::Large) => 8,
    };
    let (points, tiles) = match tier {
        Tier::Small => (150, 3),
        Tier::Medium => (350, 3),
        Tier::Large => (750, 5),
    };
    Rung {
        target,
        points,
        tiles,
    }
}

impl QuestFamily {
    pub fn measure(self, stats: &Stats) -> u32 {
        match self {
            QuestFamily::Residential => stats.homes_connected,
            QuestFamily::Nature => stats.largest_nature,
            QuestFamily::Water => stats.largest_water,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            QuestFamily::Residential => "residential",
            QuestFamily::Nature => "nature",
            QuestFamily::Water => "water",
        }
    }
}

impl Tier {
    pub fn name(self) -> &'static str {
        match self {
            Tier::Small => "small",
            Tier::Medium => "medium",
            Tier::Large => "large",
        }
    }

    fn next(self) -> Option<Tier> {
        match self {
            Tier::Small => Some(Tier::Medium),
            Tier::Medium => Some(Tier::Large),
            Tier::Large => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QuestState {
    Active,
    /// The board and the deck together cannot reach the target. It returns, unchanged, if rewards make it
    /// reachable again. Setting a quest aside pays nothing.
    OutOfReach,
    Completed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quest {
    /// Stable id, such as `water-medium`. Each id appears at most once per run.
    pub id: String,
    pub family: QuestFamily,
    pub tier: Tier,
    pub target: u32,
    pub points: u32,
    pub tiles: u32,
    pub progress: u32,
    pub state: QuestState,
    /// The placement that completed it, counting from one.
    pub completed_at: Option<u32>,
}

impl Quest {
    fn new(family: QuestFamily, tier: Tier, progress: u32) -> Self {
        let Rung {
            target,
            points,
            tiles,
        } = rung(family, tier);
        Self {
            id: format!("{}-{}", family.name(), tier.name()),
            family,
            tier,
            target,
            points,
            tiles,
            progress,
            state: QuestState::Active,
            completed_at: None,
        }
    }
}

/// How far each family could still grow: everything already placed plus everything left in the deck.
/// Joining separate networks can bring all of it together, so this is an honest upper bound.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Reach {
    pub homes: u32,
    pub nature: u32,
    pub water: u32,
}

impl Reach {
    fn of(self, family: QuestFamily) -> u32 {
        match family {
            QuestFamily::Residential => self.homes,
            QuestFamily::Nature => self.nature,
            QuestFamily::Water => self.water,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Quests {
    /// One quest per family that still has a rung to climb, in family order.
    pub current: Vec<Quest>,
    /// Completed quests, in the order they completed.
    pub history: Vec<Quest>,
}

impl Quests {
    /// Small quests for every family, measured against the starting board.
    pub fn start(stats: &Stats, reach: Reach) -> Self {
        let mut quests = Self {
            current: FAMILIES
                .iter()
                .map(|&family| Quest::new(family, Tier::Small, family.measure(stats)))
                .collect(),
            history: Vec::new(),
        };
        quests.check_reach(reach);
        quests
    }

    /// Resolves one placement. A quest completes when the placement raised its measure and the measure now
    /// meets the target. Each family completes at most one rung per placement; the next rung starts after,
    /// measured from the new board, and can only complete on a later placement that raises it again.
    pub fn resolve(&mut self, before: &Stats, after: &Stats, placement: u32) -> Vec<Quest> {
        let mut completed = Vec::new();
        for quest in &mut self.current {
            let (was, now) = (quest.family.measure(before), quest.family.measure(after));
            quest.progress = now;
            if quest.state == QuestState::Active && now > was && now >= quest.target {
                quest.state = QuestState::Completed;
                quest.completed_at = Some(placement);
                completed.push(quest.clone());
            }
        }
        for done in &completed {
            let slot = self
                .current
                .iter()
                .position(|quest| quest.id == done.id)
                .expect("completed quests come from the current list");
            let finished = self.current.remove(slot);
            if let Some(tier) = finished.tier.next() {
                self.current.insert(
                    slot,
                    Quest::new(finished.family, tier, finished.family.measure(after)),
                );
            }
            self.history.push(finished);
        }
        completed
    }

    /// Sets aside quests the run can no longer reach, and brings back any it can reach again.
    pub fn check_reach(&mut self, reach: Reach) {
        for quest in &mut self.current {
            let reachable = reach.of(quest.family) >= quest.target;
            quest.state = match (quest.state, reachable) {
                (QuestState::Active, false) => QuestState::OutOfReach,
                (QuestState::OutOfReach, true) => QuestState::Active,
                (state, _) => state,
            };
        }
    }

    pub fn active(&self) -> impl Iterator<Item = &Quest> {
        self.current
            .iter()
            .filter(|quest| quest.state == QuestState::Active)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats(homes: u32, nature: u32, water: u32) -> Stats {
        Stats {
            tiles: 0,
            homes,
            homes_connected: homes,
            walks: 0,
            largest_nature: nature,
            largest_water: water,
            levels: 1,
        }
    }

    const PLENTY: Reach = Reach {
        homes: 100,
        nature: 100,
        water: 100,
    };

    #[test]
    fn runs_start_with_three_small_quests_with_stable_ids() {
        let quests = Quests::start(&stats(2, 1, 0), PLENTY);
        let ids: Vec<_> = quests
            .current
            .iter()
            .map(|quest| quest.id.as_str())
            .collect();
        assert_eq!(ids, ["residential-small", "nature-small", "water-small"]);
        assert_eq!(quests.current[0].progress, 2);
        assert!(quests.history.is_empty());
    }

    #[test]
    fn a_quest_pays_once_and_the_next_rung_needs_another_placement() {
        let mut quests = Quests::start(&stats(2, 1, 0), PLENTY);
        let done = quests.resolve(&stats(2, 1, 0), &stats(13, 1, 0), 4);
        assert_eq!(
            done.len(),
            1,
            "only the small rung completes, even though 13 also meets medium"
        );
        assert_eq!(done[0].id, "residential-small");
        assert_eq!(done[0].completed_at, Some(4));
        assert_eq!(quests.current[0].id, "residential-medium");
        assert_eq!(quests.current[0].progress, 13);
        // The unchanged board pays nothing more.
        assert!(quests
            .resolve(&stats(13, 1, 0), &stats(13, 1, 0), 5)
            .is_empty());
        // A placement that raises the measure completes the medium rung, already past its target.
        let done = quests.resolve(&stats(13, 1, 0), &stats(14, 1, 0), 6);
        assert_eq!(done[0].id, "residential-medium");
        assert_eq!(quests.history.len(), 2);
    }

    #[test]
    fn the_ladder_is_finite_and_every_id_completes_at_most_once() {
        let mut quests = Quests::start(&stats(0, 0, 0), PLENTY);
        let mut paid = Vec::new();
        for step in 0..60u32 {
            let before = stats(step, step, step);
            let after = stats(step + 1, step + 1, step + 1);
            paid.extend(
                quests
                    .resolve(&before, &after, step + 1)
                    .into_iter()
                    .map(|quest| quest.id),
            );
        }
        assert_eq!(paid.len(), 9);
        let unique: std::collections::BTreeSet<_> = paid.iter().collect();
        assert_eq!(unique.len(), 9);
        assert!(quests.current.is_empty());
        let tiles: u32 = quests.history.iter().map(|quest| quest.tiles).sum();
        let points: u32 = quests.history.iter().map(|quest| quest.points).sum();
        assert_eq!((tiles, points), (33, 3750));
    }

    #[test]
    fn out_of_reach_quests_wait_without_reward_and_return_when_reachable() {
        let mut quests = Quests::start(
            &stats(0, 0, 0),
            Reach {
                homes: 50,
                nature: 50,
                water: 2,
            },
        );
        assert_eq!(quests.current[2].state, QuestState::OutOfReach);
        assert_eq!(quests.active().count(), 2);
        assert!(
            quests
                .resolve(&stats(0, 0, 0), &stats(0, 0, 4), 1)
                .is_empty(),
            "set aside quests never pay, even when the measure passes the target"
        );
        quests.check_reach(Reach {
            homes: 50,
            nature: 50,
            water: 6,
        });
        assert_eq!(quests.current[2].state, QuestState::Active);
        assert_eq!(
            quests.resolve(&stats(0, 0, 4), &stats(0, 0, 5), 2)[0].id,
            "water-small"
        );
    }
}
