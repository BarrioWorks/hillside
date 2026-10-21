//! Computer players used for autoplay, simulations, and tests. Every policy is deterministic given its
//! random stream, so a simulation over seeds replays exactly.

use crate::board::Placement;
use crate::hex::{Hex, SIDES};
use crate::quest::QuestFamily;
use crate::rng::Rng;
use crate::run::{Action, Run};
use crate::tile::Edge;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Policy {
    /// Any legal placement, uniformly.
    Random,
    /// The placement worth the most points now.
    Greedy,
    /// The placement that advances active quests most, then points.
    Quest,
    /// Points and quest progress together, keeping the world compact and streams closed.
    Balanced,
    /// Balanced, looking one tile ahead at the next visible tile. A stand-in for a careful player.
    Planner,
}

pub const POLICIES: [Policy; 5] = [
    Policy::Random,
    Policy::Greedy,
    Policy::Quest,
    Policy::Balanced,
    Policy::Planner,
];

impl Policy {
    pub fn name(self) -> &'static str {
        match self {
            Policy::Random => "random",
            Policy::Greedy => "greedy",
            Policy::Quest => "quest",
            Policy::Balanced => "balanced",
            Policy::Planner => "planner",
        }
    }
}

type Move = (Hex, u32, Placement);

/// Every legal placement of the current tile, with its preview.
pub fn moves(run: &Run) -> Vec<Move> {
    let Some(spec) = run.current().filter(|_| !run.finished()) else {
        return Vec::new();
    };
    run.board
        .frontier()
        .into_iter()
        .flat_map(|hex| (0..SIDES as u32).map(move |rotation| (hex, rotation)))
        .filter(|&(hex, rotation)| run.board.evaluate_legality(spec, hex, rotation))
        .map(|(hex, rotation)| (hex, rotation, run.board.evaluate(spec, hex, rotation)))
        .collect()
}

/// Progress a placement makes on active quests, each capped at what the quest still needs, plus a share of
/// the quest's reward when it would complete.
fn quest_value(run: &Run, placement: &Placement) -> f64 {
    let mut value = 0.0;
    for quest in run.quests.active() {
        let gain = match quest.family {
            QuestFamily::Residential => placement.gains.homes,
            QuestFamily::Nature => placement.gains.nature,
            QuestFamily::Water => placement.gains.water,
        };
        if gain == 0 {
            continue;
        }
        let needed = quest.target.saturating_sub(quest.progress).max(1);
        value +=
            f64::from(gain.min(needed)) * f64::from(quest.points) / f64::from(quest.target.max(1));
        if quest.progress + gain >= quest.target {
            value += f64::from(quest.points) * 0.5 + f64::from(quest.tiles) * 40.0;
        }
    }
    value
}

/// Water edges a placement leaves open toward empty ground: holes only water can fill later.
fn open_water(run: &Run, hex: Hex, placement: &Placement) -> u32 {
    placement
        .sides
        .iter()
        .enumerate()
        .filter(|(side, report)| {
            report.edge == Edge::Water && run.board.get(hex.neighbor(*side)).is_none()
        })
        .count() as u32
}

fn value(run: &Run, policy: Policy, (hex, _, placement): &Move) -> f64 {
    let points = f64::from(placement.points.total);
    match policy {
        Policy::Random => 0.0,
        Policy::Greedy => points,
        Policy::Quest => points * 0.3 + quest_value(run, placement) * 2.0,
        Policy::Balanced | Policy::Planner => {
            points + quest_value(run, placement) + f64::from(placement.neighbors) * 4.0
                - f64::from(open_water(run, *hex, placement)) * 6.0
                - f64::from(placement.paths.ended) * 3.0
        }
    }
}

/// A stable tie-break, so equal moves are chosen by seed rather than by iteration order alone.
fn tie(hex: Hex, rotation: u32, salt: u64) -> u64 {
    ((u64::from(hex.q as u32) << 32) | u64::from(hex.r as u32)).wrapping_mul(0x9e37_79b9_7f4a_7c15)
        ^ salt
        ^ u64::from(rotation)
}

fn best(run: &Run, policy: Policy, options: Vec<Move>, salt: u64) -> Option<Move> {
    options.into_iter().max_by(|a, b| {
        value(run, policy, a)
            .total_cmp(&value(run, policy, b))
            .then_with(|| b.0.length().cmp(&a.0.length()))
            .then_with(|| tie(a.0, a.1, salt).cmp(&tie(b.0, b.1, salt)))
    })
}

/// The planner's choice: the six best balanced moves, each scored by its own value, any quest points it
/// earns, and the best balanced reply for the tile that comes next.
fn plan(run: &Run, options: Vec<Move>, salt: u64) -> Move {
    let mut ranked: Vec<(f64, Move)> = options
        .into_iter()
        .map(|option| (value(run, Policy::Balanced, &option), option))
        .collect();
    ranked.sort_by(|a, b| {
        b.0.total_cmp(&a.0)
            .then_with(|| tie(b.1 .0, b.1 .1, salt).cmp(&tie(a.1 .0, a.1 .1, salt)))
    });
    ranked.truncate(6);
    ranked
        .into_iter()
        .map(|(own, option)| {
            let mut next = run.clone();
            let before = next.score;
            next.apply(Action::Place {
                q: option.0.q,
                r: option.0.r,
                rotation: option.1,
            })
            .expect("legal moves place");
            let quest_points = f64::from(next.score - before - option.2.points.total);
            let reply = best(&next, Policy::Balanced, moves(&next), salt)
                .map(|reply| value(&next, Policy::Balanced, &reply))
                .unwrap_or(0.0);
            (own + quest_points * 0.5 + reply * 0.6, option)
        })
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, option)| option)
        .expect("ranked is not empty")
}

pub fn choose(run: &Run, policy: Policy, rng: &mut Rng) -> Option<Action> {
    let options = moves(run);
    if options.is_empty() {
        return None;
    }
    let salt = rng.next_u64();
    let (hex, rotation, _) = match policy {
        Policy::Random => options[rng.below(options.len() as u32) as usize].clone(),
        Policy::Planner => plan(run, options, salt),
        _ => best(run, policy, options, salt).expect("options is not empty"),
    };
    Some(Action::Place {
        q: hex.q,
        r: hex.r,
        rotation,
    })
}

/// Plays a whole run with one policy.
pub fn play(seed: u32, policy: Policy) -> Run {
    let mut run = Run::new(seed);
    let mut rng = Rng::new(seed, 0x706c_6179 ^ policy as u64);
    while let Some(action) = choose(&run, policy, &mut rng) {
        run.apply(action)
            .expect("the player only picks legal moves");
    }
    run
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deliberate_play_beats_random_play() {
        let (mut greedy, mut balanced, mut random) = (0, 0, 0);
        for seed in 0..30 {
            greedy += play(seed, Policy::Greedy).score;
            balanced += play(seed, Policy::Balanced).score;
            random += play(seed, Policy::Random).score;
        }
        assert!(greedy > random * 3 / 2, "greedy {greedy} random {random}");
        assert!(
            balanced > random * 3 / 2,
            "balanced {balanced} random {random}"
        );
    }

    #[test]
    fn runs_end_when_the_deck_is_empty_and_stay_connected() {
        for seed in [1, 2026, 77] {
            for policy in POLICIES {
                let run = play(seed, policy);
                assert!(run.finished());
                assert_eq!(run.board.tiles.len() as u32, 1 + run.placements);
                assert!(run.placements >= 30);
                assert!(run.board.contiguous());
            }
        }
    }

    #[test]
    fn the_same_seed_and_policy_replay_identically() {
        for policy in POLICIES {
            let a = play(9, policy);
            let b = play(9, policy);
            assert_eq!(a.actions, b.actions, "{}", policy.name());
            assert_eq!(a.score, b.score);
        }
    }
}
