//! One Classic run: the world, the deck, the score, and the ordered steps of a placement.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

use crate::board::{Board, Placed, Placement};
use crate::deck::{self, CAP};
use crate::hex::{Hex, SIDES};
use crate::quest::{Quest, Quests, Reach};
use crate::region::Region;
use crate::rng::{self, Rng};
use crate::score::{label, Points};
use crate::terrain::{mix, Terrain};
use crate::tile::{meadow, spring, Edge, TileSpec};

/// Score milestones. The last one is victory.
pub const MILESTONES: [(u32, &str); 3] = [
    (1000, "Settlement"),
    (3000, "Community"),
    (6000, "Thriving Barrio"),
];
pub const VICTORY: u32 = MILESTONES[MILESTONES.len() - 1].0;

/// Why a run ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum End {
    /// No playable tiles remained after the last placement's rewards.
    DeckEmpty,
    /// The player chose to finish after reaching victory.
    Finished,
}

/// A quest that a placement completed, and what it paid.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Completion {
    pub quest: Quest,
    /// Reward tiles added to the deck.
    pub tiles_added: u32,
    /// Reward tiles lost because the deck was full.
    pub tiles_discarded: u32,
}

/// A player decision. A run is its seed plus these, replayed in order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
    Place {
        q: i32,
        r: i32,
        rotation: u32,
    },
    Skip {},
    /// Ends a victorious run early to see the results.
    Finish {},
}

/// What the safety rule did when a tile could not be placed anywhere.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Recovery {
    /// The unplaceable tile traded places with the first playable tile behind it.
    Swapped,
    /// No tile in the deck fit anywhere, so the current tile became a spring or a meadow that does.
    Replaced,
}

/// The outcome of the last placement, for feedback.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub q: i32,
    pub r: i32,
    pub points: Points,
    pub label: Option<&'static str>,
    pub completed: Vec<Completion>,
    /// Points from completed quests, on top of `points`.
    pub quest_points: u32,
    /// A milestone this placement reached, if any.
    pub milestone: Option<&'static str>,
    /// This placement reached victory, which happens once per run.
    pub victory: bool,
}

#[derive(Clone, Debug)]
pub struct Run {
    pub seed: u32,
    pub region: Region,
    pub board: Board,
    /// Playable tiles, current first.
    pub deck: VecDeque<TileSpec>,
    pub score: u32,
    pub placements: u32,
    pub skip_used: bool,
    /// Reward tiles drawn so far; the next reward is `deck::reward(seed, rewards)`.
    pub rewards: u32,
    /// Times the safety rule had to act.
    pub recoveries: u32,
    pub actions: Vec<Action>,
    pub last: Option<Outcome>,
    /// What the safety rule did after the most recent action (or at the start), if anything.
    pub recovery: Option<Recovery>,
    pub quests: Quests,
    /// Milestones reached, counting from zero.
    pub milestones: usize,
    /// The placement that reached victory.
    pub victory_at: Option<u32>,
    /// Reward tiles lost to the deck cap over the run.
    pub discarded: u32,
    pub end: Option<End>,
}

pub fn variation(seed: u32, hex: Hex, serial: u32) -> u32 {
    mix(seed
        ^ (hex.q as u32).wrapping_mul(0x85eb_ca6b)
        ^ (hex.r as u32).wrapping_mul(0xc2b2_ae35)
        ^ serial)
        % 16
}

impl Run {
    /// A new run: one starting settlement at the origin, a full deck, no points.
    pub fn new(seed: u32) -> Self {
        let region = Region::of(seed);
        let mut board = Board::new(Terrain::hillside(seed, region));
        let start = region.start();
        let mut turn = Rng::new(seed, rng::REGION ^ 0x7475_726e);
        let rotation = turn.below(SIDES as u32);
        board.insert(Placed {
            q: 0,
            r: 0,
            kind: start.kind,
            edges: start.edges,
            paths: start.paths,
            rotation,
            variation: variation(seed, Hex::ORIGIN, 0),
        });
        let mut run = Self {
            seed,
            region,
            board,
            deck: deck::starting(seed).into(),
            score: 0,
            placements: 0,
            skip_used: false,
            rewards: 0,
            recoveries: 0,
            actions: Vec::new(),
            last: None,
            recovery: None,
            quests: Quests::default(),
            milestones: 0,
            victory_at: None,
            discarded: 0,
            end: None,
        };
        run.quests = Quests::start(&run.board.stats(), run.reach());
        run.advance(false);
        run
    }

    pub fn current(&self) -> Option<&TileSpec> {
        self.deck.front()
    }

    pub fn finished(&self) -> bool {
        self.end.is_some()
    }

    pub fn can_skip(&self) -> bool {
        !self.finished() && !self.skip_used && self.deck.len() > 1
    }

    /// The most each quest family could still reach: everything placed plus everything left in the deck.
    /// Reward tiles not yet earned are not counted.
    pub fn reach(&self) -> Reach {
        let mut reach = Reach::default();
        let mut add = |spec: &TileSpec| {
            reach.homes += spec.entrances().iter().flatten().count() as u32;
            reach.nature += u32::from(spec.edges.contains(&Edge::Nature));
            reach.water += u32::from(spec.edges.contains(&Edge::Water));
        };
        self.board.tiles.iter().for_each(|tile| add(&tile.spec()));
        self.deck.iter().for_each(&mut add);
        reach
    }

    /// The highest milestone reached, if any.
    pub fn milestone(&self) -> Option<&'static str> {
        self.milestones
            .checked_sub(1)
            .map(|index| MILESTONES[index].1)
    }

    pub fn preview(&self, hex: Hex, rotation: u32) -> Placement {
        match self.current().filter(|_| !self.finished()) {
            Some(spec) => self.board.evaluate(spec, hex, rotation),
            None => Placement {
                valid: false,
                reason: "This run is over. Start a new game or replay the seed.".into(),
                ..self.board.evaluate(&meadow(), Hex::ORIGIN, 0)
            },
        }
    }

    /// The safety rule, then a fresh look at quest reach: a replacement tile changes what the deck holds.
    fn advance(&mut self, after_skip: bool) {
        self.recovery = self.ensure_playable(after_skip);
        if self.recovery == Some(Recovery::Replaced) {
            self.quests.check_reach(self.reach());
        }
    }

    pub fn apply(&mut self, action: Action) -> Result<(), String> {
        match action {
            Action::Place { q, r, rotation } => self.place(Hex::new(q, r), rotation),
            Action::Skip {} => self.skip(),
            Action::Finish {} => self.finish(),
        }
    }

    /// Ends a victorious run by choice. The world, score and history stay for the results.
    fn finish(&mut self) -> Result<(), String> {
        if self.finished() {
            return Err("This run is already over.".into());
        }
        if self.victory_at.is_none() {
            return Err(format!(
                "A run can be finished early only after reaching {VICTORY} points."
            ));
        }
        self.end = Some(End::Finished);
        self.actions.push(Action::Finish {});
        self.recovery = None;
        Ok(())
    }

    /// Places the current tile. The steps run in a fixed order and the run changes only if all succeed.
    fn place(&mut self, hex: Hex, rotation: u32) -> Result<(), String> {
        // 1. Validate.
        if self.finished() {
            return Err("This run is over. Start a new game or replay the seed.".into());
        }
        let Some(&spec) = self.current() else {
            return Err("The run is over: there are no tiles left to place.".into());
        };
        let placement = self.board.evaluate(&spec, hex, rotation);
        if !placement.valid {
            return Err(placement.reason);
        }
        let before = self.board.stats();
        // 2. Consume the tile.
        self.deck.pop_front();
        // 3. Update the world and its networks.
        self.board.insert(Placed {
            q: hex.q,
            r: hex.r,
            kind: spec.kind,
            edges: spec.edges,
            paths: spec.paths,
            rotation,
            variation: variation(self.seed, hex, self.board.tiles.len() as u32),
        });
        // 4. Placement points, exactly as previewed.
        let points = placement.points;
        self.placements += 1;
        // 5. Quest progress, measured on the updated networks.
        let after = self.board.stats();
        let finished = self.quests.resolve(&before, &after, self.placements);
        // 6. Rewards, each paid once.
        let completed: Vec<Completion> =
            finished.into_iter().map(|quest| self.pay(quest)).collect();
        let quest_points = completed.iter().map(|done| done.quest.points).sum::<u32>();
        self.quests.check_reach(self.reach());
        // 7. Score and supply.
        self.score += points.total + quest_points;
        self.actions.push(Action::Place {
            q: hex.q,
            r: hex.r,
            rotation,
        });
        // 8. Milestones, victory (once), and game over.
        let reached = MILESTONES
            .iter()
            .take_while(|(threshold, _)| self.score >= *threshold)
            .count();
        let milestone = (reached > self.milestones).then(|| MILESTONES[reached - 1].1);
        self.milestones = self.milestones.max(reached);
        let victory = self.victory_at.is_none() && self.score >= VICTORY;
        if victory {
            self.victory_at = Some(self.placements);
        }
        if self.deck.is_empty() {
            self.end = Some(End::DeckEmpty);
        }
        // 9. Advance: the next tile must have somewhere to go.
        self.advance(false);
        self.last = Some(Outcome {
            q: hex.q,
            r: hex.r,
            points,
            label: label(&points),
            completed,
            quest_points,
            milestone,
            victory,
        });
        Ok(())
    }

    /// Pays a completed quest's tiles: drawn from the reward stream in order and appended to the back of the
    /// deck, so the tiles already in it keep their order. Tiles beyond the cap are drawn but discarded.
    /// The quest's points are added by the caller with the placement's.
    fn pay(&mut self, quest: Quest) -> Completion {
        let mut added = 0;
        for _ in 0..quest.tiles {
            let tile = deck::reward(self.seed, self.rewards);
            self.rewards += 1;
            if (self.deck.len() as u32) < CAP {
                self.deck.push_back(tile);
                added += 1;
            }
        }
        self.discarded += quest.tiles - added;
        Completion {
            tiles_discarded: quest.tiles - added,
            tiles_added: added,
            quest,
        }
    }

    /// Moves the current tile to the back of the deck, once per run.
    fn skip(&mut self) -> Result<(), String> {
        if self.finished() {
            return Err("This run is over.".into());
        }
        if self.skip_used {
            return Err("The skip has already been used this run.".into());
        }
        if self.deck.len() <= 1 {
            return Err("There is no other tile to skip to.".into());
        }
        let tile = self.deck.pop_front().expect("deck has two or more tiles");
        self.deck.push_back(tile);
        self.skip_used = true;
        self.actions.push(Action::Skip {});
        self.advance(true);
        Ok(())
    }

    /// The safety rule. If the current tile has no legal placement, it trades places with the first playable
    /// tile behind it. Right after a skip, the skipped tile (now last) is not a candidate, so a skip is never
    /// silently undone. If no candidate is playable, the current tile becomes a spring or a meadow, chosen
    /// to fit beside the outermost tile, where the spot is always free and has exactly one neighbor.
    fn ensure_playable(&mut self, after_skip: bool) -> Option<Recovery> {
        let current = *self.deck.front()?;
        if self.board.playable(&current) {
            return None;
        }
        self.recoveries += 1;
        let candidates = 1..self.deck.len() - usize::from(after_skip);
        if let Some(index) = candidates
            .into_iter()
            .find(|&index| self.board.playable(&self.deck[index]))
        {
            self.deck.swap(0, index);
            return Some(Recovery::Swapped);
        }
        let outermost = self
            .board
            .tiles
            .iter()
            .max_by_key(|tile| (tile.q, tile.r))
            .expect("a run always has its starting tile");
        // The spot east of the outermost tile touches only that tile, through its edge 0.
        self.deck[0] = if outermost.edges()[0] == Edge::Water {
            spring()
        } else {
            meadow()
        };
        debug_assert!(self.board.playable(&self.deck[0]));
        Some(Recovery::Replaced)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile::Kind;

    fn first_valid(run: &Run) -> Action {
        for hex in run.board.frontier() {
            for rotation in 0..6 {
                if run.preview(hex, rotation).valid {
                    return Action::Place {
                        q: hex.q,
                        r: hex.r,
                        rotation,
                    };
                }
            }
        }
        panic!("no valid move");
    }

    #[test]
    fn a_run_starts_with_one_tile_thirty_in_the_deck_and_no_points() {
        for seed in 0..40 {
            let run = Run::new(seed);
            assert_eq!(run.board.tiles.len(), 1);
            assert_eq!(run.board.tiles[0].kind, Kind::Inicio);
            assert_eq!(run.deck.len(), 30);
            assert_eq!(run.score, 0);
            assert_eq!(run.board.frontier().len(), 6);
        }
    }

    #[test]
    fn placing_awards_exactly_the_previewed_points() {
        for seed in 0..30 {
            let mut run = Run::new(seed);
            while !run.finished() {
                let action = first_valid(&run);
                let Action::Place { q, r, rotation } = action else {
                    unreachable!()
                };
                let preview = run.preview(Hex::new(q, r), rotation);
                let before = run.score;
                run.apply(action).unwrap();
                let last = run.last.as_ref().unwrap();
                assert_eq!(last.points, preview.points);
                // Quest points come on top of the previewed placement points, never instead of them.
                assert_eq!(run.score - before, preview.points.total + last.quest_points);
                let paid: u32 = last.completed.iter().map(|done| done.quest.points).sum();
                assert_eq!(last.quest_points, paid);
            }
            let quest_total: u32 = run.quests.history.iter().map(|quest| quest.points).sum();
            let reward_tiles: u32 = run.quests.history.iter().map(|quest| quest.tiles).sum();
            assert_eq!(run.placements, 30 + reward_tiles - run.discarded);
            assert_eq!(run.rewards, reward_tiles);
            assert!(run.score >= quest_total + 10 * run.placements);
        }
    }

    #[test]
    fn quests_pay_once_add_reward_tiles_at_the_back_and_keep_history() {
        let mut run = Run::new(12);
        let mut rng = Rng::new(12, 5);
        let mut seen = std::collections::BTreeSet::new();
        while !run.finished() {
            let deck_before: Vec<_> = run.deck.iter().skip(1).copied().collect();
            let rewards_before = run.rewards;
            let action = crate::play::choose(&run, crate::play::Policy::Greedy, &mut rng).unwrap();
            run.apply(action).unwrap();
            let last = run.last.as_ref().unwrap();
            // The tiles already in the deck keep their order; rewards only append.
            let deck_after: Vec<_> = run.deck.iter().copied().collect();
            assert_eq!(
                &deck_after[..deck_before.len().min(deck_after.len())],
                &deck_before[..deck_before.len().min(deck_after.len())]
            );
            for (offset, done) in last.completed.iter().enumerate() {
                assert!(
                    seen.insert(done.quest.id.clone()),
                    "{} paid twice",
                    done.quest.id
                );
                assert_eq!(done.quest.completed_at, Some(run.placements));
                let _ = offset;
            }
            let earned: u32 = last.completed.iter().map(|done| done.quest.tiles).sum();
            assert_eq!(run.rewards - rewards_before, earned);
            for index in rewards_before..run.rewards {
                assert!(run.deck.contains(&deck::reward(12, index)));
            }
        }
        assert!(!seen.is_empty(), "the greedy run completed no quest");
        assert_eq!(run.quests.history.len(), seen.len());
    }

    #[test]
    fn rewards_beyond_the_cap_are_discarded_with_a_count() {
        let mut run = Run::new(3);
        while run.deck.len() < CAP as usize - 1 {
            run.deck.push_back(meadow());
        }
        let quest = run.quests.current[0].clone();
        let done = run.pay(quest.clone());
        assert_eq!(
            (done.tiles_added, done.tiles_discarded),
            (1, quest.tiles - 1)
        );
        assert_eq!(run.deck.len() as u32, CAP);
        assert_eq!(run.deck.back(), Some(&deck::reward(3, 0)));
        assert_eq!(
            run.rewards, quest.tiles,
            "discarded tiles still use their place in the reward stream"
        );
        assert_eq!(run.discarded, quest.tiles - 1);
        let full = run.pay(quest.clone());
        assert_eq!((full.tiles_added, full.tiles_discarded), (0, quest.tiles));
    }

    #[test]
    fn victory_triggers_once_and_play_continues_until_finished() {
        let mut run = Run::new(21);
        run.score = VICTORY - 10;
        let mut rng = Rng::new(21, 8);
        let action = crate::play::choose(&run, crate::play::Policy::Greedy, &mut rng).unwrap();
        run.apply(action).unwrap();
        let last = run.last.as_ref().unwrap();
        assert!(last.victory);
        assert_eq!(last.milestone, Some("Thriving Barrio"));
        assert_eq!(run.victory_at, Some(1));
        assert!(!run.finished(), "victory does not end the run");
        let world = run.board.tiles.len();
        let action = crate::play::choose(&run, crate::play::Policy::Greedy, &mut rng).unwrap();
        run.apply(action).unwrap();
        assert!(!run.last.as_ref().unwrap().victory, "victory fires once");
        assert_eq!(
            run.board.tiles.len(),
            world + 1,
            "the world, deck and score carry on"
        );
        let score = run.score;
        run.apply(Action::Finish {}).unwrap();
        assert_eq!(run.end, Some(End::Finished));
        assert_eq!(run.score, score);
        assert!(run.apply(Action::Skip {}).is_err());
        assert!(run.apply(Action::Finish {}).is_err());
        let any = run.board.frontier()[0];
        assert!(run
            .apply(Action::Place {
                q: any.q,
                r: any.r,
                rotation: 0
            })
            .is_err());
    }

    #[test]
    fn milestones_are_reported_once_each_in_order() {
        let mut run = Run::new(30);
        let mut rng = Rng::new(30, 2);
        let mut reached = Vec::new();
        while !run.finished() {
            let action = crate::play::choose(&run, crate::play::Policy::Greedy, &mut rng).unwrap();
            run.apply(action).unwrap();
            reached.extend(run.last.as_ref().unwrap().milestone);
        }
        let expected: Vec<_> = MILESTONES
            .iter()
            .take(run.milestones)
            .map(|(_, name)| *name)
            .collect();
        assert_eq!(reached, expected);
        assert!(run.milestones >= 1, "a greedy run reaches Settlement");
    }

    #[test]
    fn invalid_actions_change_nothing() {
        let mut run = Run::new(3);
        let before = (run.deck.clone(), run.score, run.board.tiles.len());
        assert!(run
            .apply(Action::Place {
                q: 5,
                r: 5,
                rotation: 0
            })
            .is_err());
        assert!(run
            .apply(Action::Place {
                q: 0,
                r: 0,
                rotation: 0
            })
            .is_err());
        assert!(run
            .apply(Action::Place {
                q: 1,
                r: 0,
                rotation: 9
            })
            .is_err());
        assert_eq!(before, (run.deck.clone(), run.score, run.board.tiles.len()));
        assert!(run.actions.is_empty());
    }

    #[test]
    fn skip_moves_the_tile_to_the_back_once_and_creates_nothing() {
        let mut run = Run::new(9);
        let deck: Vec<_> = run.deck.iter().copied().collect();
        assert!(run.can_skip());
        run.apply(Action::Skip {}).unwrap();
        assert_eq!(run.deck.len(), 30);
        assert_eq!(run.score, 0);
        let after: Vec<_> = run.deck.iter().copied().collect();
        assert_eq!(after[29], deck[0]);
        assert_eq!(after[..29], deck[1..]);
        assert!(run.apply(Action::Skip {}).is_err());
        assert!(!run.can_skip());
    }

    #[test]
    fn skip_is_unavailable_with_one_tile_left() {
        let mut run = Run::new(4);
        while run.deck.len() > 1 {
            let action = first_valid(&run);
            run.apply(action).unwrap();
        }
        assert!(!run.can_skip());
        assert!(run.apply(Action::Skip {}).is_err());
    }

    #[test]
    fn the_safety_rule_always_leaves_a_playable_tile() {
        // Surround the start with open stream ends so dry tiles have few places, then check every state.
        for seed in 0..200 {
            let mut run = Run::new(seed);
            let mut pick = Rng::new(seed, 99);
            while let Some(spec) = run.current().copied() {
                assert!(run.board.playable(&spec), "seed {seed}");
                let moves: Vec<Action> = run
                    .board
                    .frontier()
                    .into_iter()
                    .flat_map(|hex| (0..6).map(move |rotation| (hex, rotation)))
                    .filter(|&(hex, rotation)| run.board.evaluate_legality(&spec, hex, rotation))
                    .map(|(hex, rotation)| Action::Place {
                        q: hex.q,
                        r: hex.r,
                        rotation,
                    })
                    .collect();
                let action = moves[pick.below(moves.len() as u32) as usize];
                run.apply(action).unwrap();
            }
        }
    }

    #[test]
    fn replacement_fits_beside_the_outermost_tile_even_when_every_edge_is_water() {
        let mut run = Run::new(1);
        // Rebuild the world as a single all-water lake so no dry tile can go anywhere.
        let mut board = Board::new(Terrain::flat(1));
        let lake = TileSpec::parse(Kind::Quebrada, "WWWWWW", "000000");
        board.insert(Placed {
            q: 0,
            r: 0,
            kind: lake.kind,
            edges: lake.edges,
            paths: lake.paths,
            rotation: 0,
            variation: 0,
        });
        run.board = board;
        run.deck = VecDeque::from(vec![
            meadow(),
            TileSpec::parse(Kind::Casas, "PHHPHN", "100100"),
        ]);
        assert_eq!(run.ensure_playable(false), Some(Recovery::Replaced));
        assert_eq!(run.deck[0], spring());
        assert!(run.board.playable(&run.deck[0]));
        assert_eq!(run.deck.len(), 2, "replacement conserves the tile count");
    }
}
