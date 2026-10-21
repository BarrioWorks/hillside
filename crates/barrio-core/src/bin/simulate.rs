//! Headless balance simulation: plays seeded Classic runs with several policies and reports scores, quests,
//! tile supply, run length, victory rates, and matching edges. Deterministic: the same arguments always
//! produce the same report.
//!
//! cargo run --release --bin simulate -- [--seeds N] [--first S] [--out path.json] [--policies a,b]

use std::collections::BTreeMap;

use barrio_core::play::{self, Policy, POLICIES};
use barrio_core::{QuestFamily, Tier, RULES, VICTORY};
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunReport {
    seed: u32,
    region: String,
    score: u32,
    placement_points: u32,
    quest_points: u32,
    perfects: u32,
    placements: u32,
    quests: u32,
    quest_ids: Vec<String>,
    tiles_earned: u32,
    tiles_discarded: u32,
    unusable_events: u32,
    victory: bool,
    victory_at: Option<u32>,
    milestones: usize,
    /// Placements with 0..=6 matching edges.
    matches: [u32; 7],
    /// Tiles left in the deck after each placement.
    remaining: Vec<u32>,
    homes_connected: u32,
    largest_nature: u32,
    largest_water: u32,
}

fn simulate(seed: u32, policy: Policy) -> RunReport {
    let mut run = barrio_core::Run::new(seed);
    let mut rng = barrio_core::Rng::new(seed, 0x706c_6179 ^ policy as u64);
    let mut report = RunReport {
        seed,
        region: format!("{:?}", run.region),
        score: 0,
        placement_points: 0,
        quest_points: 0,
        perfects: 0,
        placements: 0,
        quests: 0,
        quest_ids: Vec::new(),
        tiles_earned: 0,
        tiles_discarded: 0,
        unusable_events: 0,
        victory: false,
        victory_at: None,
        milestones: 0,
        matches: [0; 7],
        remaining: Vec::new(),
        homes_connected: 0,
        largest_nature: 0,
        largest_water: 0,
    };
    while let Some(action) = play::choose(&run, policy, &mut rng) {
        run.apply(action).expect("policies pick legal moves");
        let last = run.last.as_ref().expect("a placement records its outcome");
        report.placement_points += last.points.total;
        report.quest_points += last.quest_points;
        report.perfects += u32::from(last.points.perfect);
        report.matches[last.points.matches as usize] += 1;
        report.remaining.push(run.deck.len() as u32);
    }
    let stats = run.board.stats();
    report.score = run.score;
    report.placements = run.placements;
    report.quests = run.quests.history.len() as u32;
    report.quest_ids = run
        .quests
        .history
        .iter()
        .map(|quest| quest.id.clone())
        .collect();
    report.tiles_earned = run.rewards;
    report.tiles_discarded = run.discarded;
    report.unusable_events = run.recoveries;
    report.victory = run.victory_at.is_some();
    report.victory_at = run.victory_at;
    report.milestones = run.milestones;
    report.homes_connected = stats.homes_connected;
    report.largest_nature = stats.largest_nature;
    report.largest_water = stats.largest_water;
    assert_eq!(report.score, report.placement_points + report.quest_points);
    report
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    policy: &'static str,
    runs: usize,
    score: Spread,
    placements: Spread,
    quests_mean: f64,
    quest_completion_rate: BTreeMap<String, f64>,
    tiles_earned_mean: f64,
    tiles_discarded_total: u32,
    unusable_events_total: u32,
    unusable_rate_per_placement: f64,
    victory_rate: f64,
    milestone_rates: [f64; 3],
    victory_at: Option<Spread>,
    matches_per_placement: f64,
    match_histogram: [u32; 7],
    perfects_mean: f64,
    quest_share_of_score: f64,
    /// Mean tiles left in the deck after placement n (runs that ended earlier count as zero).
    remaining_curve: Vec<f64>,
    /// The first seeds this policy won, for demonstrations.
    victory_seeds: Vec<u32>,
}

#[derive(Serialize)]
struct Spread {
    min: u32,
    p10: u32,
    p50: u32,
    p90: u32,
    max: u32,
    mean: f64,
}

fn spread(values: &[u32]) -> Spread {
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let at = |q: f64| sorted[((sorted.len() - 1) as f64 * q).round() as usize];
    Spread {
        min: sorted[0],
        p10: at(0.1),
        p50: at(0.5),
        p90: at(0.9),
        max: sorted[sorted.len() - 1],
        mean: values.iter().map(|&v| f64::from(v)).sum::<f64>() / values.len() as f64,
    }
}

fn summarize(policy: Policy, runs: &[RunReport]) -> Summary {
    let n = runs.len() as f64;
    let scores: Vec<u32> = runs.iter().map(|run| run.score).collect();
    let placements: Vec<u32> = runs.iter().map(|run| run.placements).collect();
    let victories: Vec<u32> = runs.iter().filter_map(|run| run.victory_at).collect();
    let mut histogram = [0; 7];
    for run in runs {
        for (bucket, count) in run.matches.iter().enumerate() {
            histogram[bucket] += count;
        }
    }
    let total_placements: u32 = placements.iter().sum();
    let matched: u32 = histogram
        .iter()
        .enumerate()
        .map(|(m, c)| m as u32 * c)
        .sum();
    let mut completion = BTreeMap::new();
    for family in [
        QuestFamily::Residential,
        QuestFamily::Nature,
        QuestFamily::Water,
    ] {
        for tier in [Tier::Small, Tier::Medium, Tier::Large] {
            let id = format!("{}-{}", family.name(), tier.name());
            let done = runs
                .iter()
                .filter(|run| run.quest_ids.contains(&id))
                .count();
            completion.insert(id, done as f64 / n);
        }
    }
    let longest = runs
        .iter()
        .map(|run| run.remaining.len())
        .max()
        .unwrap_or(0);
    let remaining_curve = (0..longest)
        .map(|step| {
            runs.iter()
                .map(|run| f64::from(*run.remaining.get(step).unwrap_or(&0)))
                .sum::<f64>()
                / n
        })
        .collect();
    let unusable: u32 = runs.iter().map(|run| run.unusable_events).sum();
    Summary {
        policy: policy.name(),
        runs: runs.len(),
        score: spread(&scores),
        placements: spread(&placements),
        quests_mean: runs.iter().map(|run| f64::from(run.quests)).sum::<f64>() / n,
        quest_completion_rate: completion,
        tiles_earned_mean: runs
            .iter()
            .map(|run| f64::from(run.tiles_earned))
            .sum::<f64>()
            / n,
        tiles_discarded_total: runs.iter().map(|run| run.tiles_discarded).sum(),
        unusable_events_total: unusable,
        unusable_rate_per_placement: f64::from(unusable) / f64::from(total_placements.max(1)),
        victory_rate: victories.len() as f64 / n,
        milestone_rates: [1, 2, 3]
            .map(|m| runs.iter().filter(|run| run.milestones >= m).count() as f64 / n),
        victory_at: (!victories.is_empty()).then(|| spread(&victories)),
        matches_per_placement: f64::from(matched) / f64::from(total_placements.max(1)),
        match_histogram: histogram,
        perfects_mean: runs.iter().map(|run| f64::from(run.perfects)).sum::<f64>() / n,
        quest_share_of_score: runs
            .iter()
            .map(|run| f64::from(run.quest_points))
            .sum::<f64>()
            / scores.iter().map(|&s| f64::from(s)).sum::<f64>().max(1.0),
        remaining_curve,
        victory_seeds: runs
            .iter()
            .filter(|run| run.victory)
            .map(|run| run.seed)
            .take(20)
            .collect(),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let seeds: u32 = arg("--seeds").and_then(|v| v.parse().ok()).unwrap_or(1000);
    let first: u32 = arg("--first").and_then(|v| v.parse().ok()).unwrap_or(0);
    let policies: Vec<Policy> = match arg("--policies") {
        Some(list) => POLICIES
            .into_iter()
            .filter(|policy| list.split(',').any(|name| name == policy.name()))
            .collect(),
        None => POLICIES.to_vec(),
    };
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    let started = std::time::Instant::now();
    let mut summaries = Vec::new();
    let mut samples = BTreeMap::new();
    for policy in policies {
        let policy_start = std::time::Instant::now();
        let chunks: Vec<Vec<u32>> = (0..threads as u32)
            .map(|t| {
                (first..first + seeds)
                    .filter(|s| s % threads as u32 == t)
                    .collect()
            })
            .collect();
        let mut runs: Vec<RunReport> = std::thread::scope(|scope| {
            let handles: Vec<_> = chunks
                .iter()
                .map(|chunk| {
                    scope.spawn(move || {
                        chunk
                            .iter()
                            .map(|&seed| simulate(seed, policy))
                            .collect::<Vec<_>>()
                    })
                })
                .collect();
            handles
                .into_iter()
                .flat_map(|handle| handle.join().expect("simulation thread"))
                .collect()
        });
        runs.sort_by_key(|run| run.seed);
        let summary = summarize(policy, &runs);
        eprintln!(
            "{:<9} {:>5} runs  score p10/p50/p90 {:>5}/{:>5}/{:>5}  placements p50 {:>3} (max {:>3})  quests {:.2}  earned {:.1}  victory {:>5.1}%  matches {:.2}  {:.1}s",
            summary.policy,
            summary.runs,
            summary.score.p10,
            summary.score.p50,
            summary.score.p90,
            summary.placements.p50,
            summary.placements.max,
            summary.quests_mean,
            summary.tiles_earned_mean,
            summary.victory_rate * 100.0,
            summary.matches_per_placement,
            policy_start.elapsed().as_secs_f64()
        );
        samples.insert(policy.name(), runs.into_iter().take(5).collect::<Vec<_>>());
        summaries.push(summary);
    }
    let report = serde_json::json!({
        "rules": RULES,
        "victory": VICTORY,
        "seeds": { "first": first, "count": seeds },
        "method": "Each policy plays every seed's run to the end of its deck through the real rules (Run::apply). Policies are deterministic given (seed, policy). Scores are the run's final score; quest completion rates are the share of runs that completed each ladder rung.",
        "elapsedSeconds": started.elapsed().as_secs_f64(),
        "summaries": summaries,
        "samples": samples,
    });
    let text = serde_json::to_string_pretty(&report).expect("report serializes");
    match arg("--out") {
        Some(path) => std::fs::write(&path, format!("{text}\n")).expect("write report"),
        None => println!("{text}"),
    }
}
