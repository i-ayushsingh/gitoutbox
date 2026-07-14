//! Scheduling engine (spec §10, §11). Pure-std, independently testable.
//!
//! Four scheduling modes: Exact, Window, Interval, Multi-day.
//! Two distribution modes: Even, Variable.
//! Variable distribution uses a seeded PRNG for deterministic testability.

use std::fmt;

/// Scheduling mode as defined in spec §10.
#[derive(Debug, Clone, PartialEq)]
pub enum ScheduleMode {
    /// Specific date/time per item (spec §10 "Exact").
    Exact,
    /// Distribute items inside a start/end window (spec §10 "Window").
    Window,
    /// Start time + fixed interval between items (spec §10 "Interval").
    Interval,
    /// Distribute across multiple days with daily windows (spec §10 "Multi-day").
    MultiDay,
}

/// Distribution mode for Window and Multi-day modes.
#[derive(Debug, Clone, PartialEq)]
pub enum Distribution {
    /// Evenly spaced timestamps.
    Even,
    /// Non-uniform natural-looking spacing using seeded randomness.
    Variable,
}

/// A scheduled assignment: item index → timestamp (UTC seconds since epoch).
#[derive(Debug, Clone, PartialEq)]
pub struct ScheduleAssignment {
    pub item_index: usize,
    pub scheduled_time: i64,
}

/// Input for the scheduling engine.
#[derive(Debug, Clone)]
pub struct ScheduleInput {
    pub mode: ScheduleMode,
    pub distribution: Distribution,
    pub item_count: usize,
    /// For Exact mode: per-item timestamps (must match item_count).
    pub exact_times: Vec<i64>,
    /// For Window mode: start and end time (UTC seconds).
    pub window_start: i64,
    pub window_end: i64,
    /// For Interval mode: start time and interval in seconds.
    pub interval_start: i64,
    pub interval_seconds: i64,
    /// For Multi-day mode: per-day configuration.
    pub days: Vec<DayConfig>,
    /// Minimum gap between items in seconds (Variable distribution).
    pub min_gap_seconds: i64,
    /// Optional seed for deterministic Variable distribution.
    pub seed: Option<u64>,
}

/// Configuration for one day in Multi-day scheduling.
#[derive(Debug, Clone)]
pub struct DayConfig {
    /// Day start (UTC seconds, midnight or user-chosen start).
    pub day_start: i64,
    /// Window start offset from day_start (seconds from midnight).
    pub window_start_offset: i64,
    /// Window end offset from day_start (seconds from midnight).
    pub window_end_offset: i64,
    /// Number of items to schedule on this day.
    pub item_count: usize,
}

/// Output from the scheduling engine.
#[derive(Debug, Clone)]
pub struct ScheduleOutput {
    pub assignments: Vec<ScheduleAssignment>,
}

/// Errors from the scheduling engine.
#[derive(Debug, Clone, PartialEq)]
pub enum ScheduleError {
    EmptyInput,
    InvalidMode(String),
    InvalidTime(String),
    WindowTooSmall(String),
    IntervalTooSmall(String),
    TooManyItems(String),
    ExactTimeCountMismatch { expected: usize, got: usize },
    DayAllocationMismatch { expected: usize, got: usize },
    DuplicateTimestamp(i64),
    OutOfWindow { time: i64, start: i64, end: i64 },
}

impl fmt::Display for ScheduleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyInput => write!(f, "No items to schedule"),
            Self::InvalidMode(m) => write!(f, "Invalid mode: {m}"),
            Self::InvalidTime(m) => write!(f, "Invalid time: {m}"),
            Self::WindowTooSmall(m) => write!(f, "Window too small: {m}"),
            Self::IntervalTooSmall(m) => write!(f, "Interval too small: {m}"),
            Self::TooManyItems(m) => write!(f, "Too many items: {m}"),
            Self::ExactTimeCountMismatch { expected, got } => {
                write!(f, "Expected {expected} exact times, got {got}")
            }
            Self::DayAllocationMismatch { expected, got } => {
                write!(f, "Day allocations sum to {got}, expected {expected}")
            }
            Self::DuplicateTimestamp(t) => write!(f, "Duplicate timestamp: {t}"),
            Self::OutOfWindow { time, start, end } => {
                write!(f, "Time {time} outside window [{start}, {end}]")
            }
        }
    }
}

impl std::error::Error for ScheduleError {}

/// Simple seeded PRNG (linear congruential generator).
/// Deterministic: same seed → same sequence. Good enough for schedule jitter.
struct SeededRng {
    state: u64,
}

impl SeededRng {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        // LCG parameters from Numerical Recipes
        self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.state
    }

    /// Random f64 in [0, 1).
    fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Main scheduling entry point.
pub fn generate_schedule(input: &ScheduleInput) -> Result<ScheduleOutput, ScheduleError> {
    if input.item_count == 0 {
        return Err(ScheduleError::EmptyInput);
    }

    match input.mode {
        ScheduleMode::Exact => schedule_exact(input),
        ScheduleMode::Window => schedule_window(input),
        ScheduleMode::Interval => schedule_interval(input),
        ScheduleMode::MultiDay => schedule_multiday(input),
    }
}

/// Exact mode: assign explicit per-item timestamps.
fn schedule_exact(input: &ScheduleInput) -> Result<ScheduleOutput, ScheduleError> {
    if input.exact_times.len() != input.item_count {
        return Err(ScheduleError::ExactTimeCountMismatch {
            expected: input.item_count,
            got: input.exact_times.len(),
        });
    }

    let assignments: Vec<ScheduleAssignment> = input
        .exact_times
        .iter()
        .enumerate()
        .map(|(i, &t)| ScheduleAssignment {
            item_index: i,
            scheduled_time: t,
        })
        .collect();

    // Validate chronological order and no duplicates.
    for i in 1..assignments.len() {
        if assignments[i].scheduled_time <= assignments[i - 1].scheduled_time {
            return Err(ScheduleError::DuplicateTimestamp(assignments[i].scheduled_time));
        }
    }

    Ok(ScheduleOutput { assignments })
}

/// Window mode: distribute items inside [window_start, window_end].
fn schedule_window(input: &ScheduleInput) -> Result<ScheduleOutput, ScheduleError> {
    if input.window_start >= input.window_end {
        return Err(ScheduleError::InvalidTime(
            "Window start must be before end".into(),
        ));
    }

    let n = input.item_count;

    if n == 1 {
        // Single item: place at window start.
        return Ok(ScheduleOutput {
            assignments: vec![ScheduleAssignment {
                item_index: 0,
                scheduled_time: input.window_start,
            }],
        });
    }

    match input.distribution {
        Distribution::Even => distribute_even(input.window_start, input.window_end, n),
        Distribution::Variable => distribute_variable(
            input.window_start,
            input.window_end,
            n,
            input.min_gap_seconds.max(60), // at least 1 minute default
            input.seed.unwrap_or(42),
        ),
    }
}

/// Interval mode: start time + fixed interval.
fn schedule_interval(input: &ScheduleInput) -> Result<ScheduleOutput, ScheduleError> {
    if input.interval_seconds <= 0 {
        return Err(ScheduleError::IntervalTooSmall(
            "Interval must be positive".into(),
        ));
    }

    let assignments: Vec<ScheduleAssignment> = (0..input.item_count)
        .map(|i| ScheduleAssignment {
            item_index: i,
            scheduled_time: input.interval_start + (i as i64) * input.interval_seconds,
        })
        .collect();

    Ok(ScheduleOutput { assignments })
}

/// Multi-day: distribute across multiple days with daily windows.
fn schedule_multiday(input: &ScheduleInput) -> Result<ScheduleOutput, ScheduleError> {
    if input.days.is_empty() {
        return Err(ScheduleError::InvalidMode(
            "Multi-day requires at least one day".into(),
        ));
    }

    let total_allocated: usize = input.days.iter().map(|d| d.item_count).sum();
    if total_allocated != input.item_count {
        return Err(ScheduleError::DayAllocationMismatch {
            expected: input.item_count,
            got: total_allocated,
        });
    }

    // Validate each day.
    for day in &input.days {
        if day.window_start_offset >= day.window_end_offset {
            return Err(ScheduleError::InvalidTime(
                "Day window start must be before end".into(),
            ));
        }
    }

    let mut assignments = Vec::new();
    let mut global_index = 0;
    let seed = input.seed.unwrap_or(42);

    for (day_idx, day) in input.days.iter().enumerate() {
        if day.item_count == 0 {
            continue;
        }

        let window_start = day.day_start + day.window_start_offset;
        let window_end = day.day_start + day.window_end_offset;

        let day_assignments = match input.distribution {
            Distribution::Even => distribute_even(window_start, window_end, day.item_count)?,
            Distribution::Variable => distribute_variable(
                window_start,
                window_end,
                day.item_count,
                input.min_gap_seconds.max(60),
                seed.wrapping_add(day_idx as u64),
            )?,
        };

        for mut a in day_assignments.assignments {
            a.item_index = global_index;
            assignments.push(a);
            global_index += 1;
        }
    }

    Ok(ScheduleOutput { assignments })
}

/// Even distribution: n items between start and end, inclusive of endpoints.
fn distribute_even(start: i64, end: i64, n: usize) -> Result<ScheduleOutput, ScheduleError> {
    if n == 0 {
        return Err(ScheduleError::EmptyInput);
    }
    if start >= end {
        return Err(ScheduleError::InvalidTime(
            "Start must be before end for distribution".into(),
        ));
    }

    if n == 1 {
        return Ok(ScheduleOutput {
            assignments: vec![ScheduleAssignment {
                item_index: 0,
                scheduled_time: start,
            }],
        });
    }

    let duration = end - start;
    // Step = duration / (n - 1) so that first= start, last = end.
    // Use integer division; resolve any rounding by clamping.
    let step = duration / (n as i64 - 1);

    let assignments: Vec<ScheduleAssignment> = (0..n)
        .map(|i| {
            let time = start + (i as i64) * step;
            // Clamp to end for the last item (handles rounding).
            let time = if i == n - 1 { end } else { time.min(end) };
            ScheduleAssignment {
                item_index: i,
                scheduled_time: time,
            }
        })
        .collect();

    // Validate no duplicates (can happen if step rounds to 0).
    for i in 1..assignments.len() {
        if assignments[i].scheduled_time <= assignments[i - 1].scheduled_time {
            return Err(ScheduleError::WindowTooSmall(
                "Window too small for this many items with even distribution".into(),
            ));
        }
    }

    Ok(ScheduleOutput { assignments })
}

/// Variable distribution: non-uniform natural-looking spacing.
/// Follows spec §11 algorithm: convert to minutes, reserve gaps, generate
/// random weights, normalize, convert to timestamps.
fn distribute_variable(
    start: i64,
    end: i64,
    n: usize,
    min_gap_secs: i64,
    seed: u64,
) -> Result<ScheduleOutput, ScheduleError> {
    if n == 0 {
        return Err(ScheduleError::EmptyInput);
    }
    if start >= end {
        return Err(ScheduleError::InvalidTime(
            "Start must be before end for distribution".into(),
        ));
    }

    if n == 1 {
        return Ok(ScheduleOutput {
            assignments: vec![ScheduleAssignment {
                item_index: 0,
                scheduled_time: start,
            }],
        });
    }

    let duration = end - start;
    let min_gap_total = min_gap_secs * (n as i64 - 1);

    if min_gap_total >= duration {
        return Err(ScheduleError::WindowTooSmall(format!(
            "Minimum gaps ({min_gap_total}s) consume the entire window ({duration}s)"
        )));
    }

    let free_seconds = duration - min_gap_total;

    // We need n-1 gaps between n items. Generate n+1 random weights:
    // leading slack, n-1 internal gaps, trailing slack.
    let num_weights = n + 1;
    let mut rng = SeededRng::new(seed);
    let weights: Vec<f64> = (0..num_weights).map(|_| rng.next_f64() + 0.01).collect();
    let total_weight: f64 = weights.iter().sum();

    // Distribute free_seconds across the n+1 slots proportionally.
    let slots: Vec<i64> = weights
        .iter()
        .map(|w| ((w / total_weight) * free_seconds as f64).round() as i64)
        .collect();

    // Build cumulative offsets: slot[0] is leading slack, then each item gets
    // slot[i] + min_gap as the gap to the next item.
    let mut timestamps = Vec::with_capacity(n);
    let mut current = start + slots[0]; // first item after leading slack

    for i in 0..n {
        timestamps.push(current);
        if i < n - 1 {
            // Next item = current + min_gap + internal slot
            current += min_gap_secs + slots[i + 1];
        }
    }

    // Resolve rounding collisions: ensure strictly increasing.
    for i in 1..timestamps.len() {
        if timestamps[i] <= timestamps[i - 1] {
            timestamps[i] = timestamps[i - 1] + 1;
        }
    }

    // Validate all inside window.
    for &t in &timestamps {
        if t < start || t > end {
            return Err(ScheduleError::OutOfWindow {
                time: t,
                start,
                end,
            });
        }
    }

    let assignments: Vec<ScheduleAssignment> = timestamps
        .into_iter()
        .enumerate()
        .map(|(i, t)| ScheduleAssignment {
            item_index: i,
            scheduled_time: t,
        })
        .collect();

    Ok(ScheduleOutput { assignments })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(h: i64, m: i64) -> i64 {
        // Convenience: hours and minutes to seconds offset from midnight.
        h * 3600 + m * 60
    }

    #[test]
    fn exact_single_item() {
        let input = ScheduleInput {
            mode: ScheduleMode::Exact,
            distribution: Distribution::Even,
            item_count: 1,
            exact_times: vec![1000],
            window_start: 0,
            window_end: 0,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 1);
        assert_eq!(out.assignments[0].scheduled_time, 1000);
    }

    #[test]
    fn exact_multiple_items() {
        let input = ScheduleInput {
            mode: ScheduleMode::Exact,
            distribution: Distribution::Even,
            item_count: 3,
            exact_times: vec![100, 200, 300],
            window_start: 0,
            window_end: 0,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 3);
        assert_eq!(out.assignments[0].scheduled_time, 100);
        assert_eq!(out.assignments[1].scheduled_time, 200);
        assert_eq!(out.assignments[2].scheduled_time, 300);
    }

    #[test]
    fn exact_rejects_non_chronological() {
        let input = ScheduleInput {
            mode: ScheduleMode::Exact,
            distribution: Distribution::Even,
            item_count: 2,
            exact_times: vec![200, 100],
            window_start: 0,
            window_end: 0,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        assert!(generate_schedule(&input).is_err());
    }

    #[test]
    fn exact_rejects_count_mismatch() {
        let input = ScheduleInput {
            mode: ScheduleMode::Exact,
            distribution: Distribution::Even,
            item_count: 3,
            exact_times: vec![100, 200],
            window_start: 0,
            window_end: 0,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        assert_eq!(
            generate_schedule(&input).unwrap_err(),
            ScheduleError::ExactTimeCountMismatch { expected: 3, got: 2 }
        );
    }

    #[test]
    fn window_even_distribution() {
        let start = ts(17, 0); // 5:00 PM
        let end = ts(19, 0); // 7:00 PM
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Even,
            item_count: 5,
            exact_times: vec![],
            window_start: start,
            window_end: end,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 5);
        // First = start, last = end
        assert_eq!(out.assignments[0].scheduled_time, start);
        assert_eq!(out.assignments[4].scheduled_time, end);
        // All increasing
        for i in 1..out.assignments.len() {
            assert!(out.assignments[i].scheduled_time > out.assignments[i - 1].scheduled_time);
        }
        // All inside window
        for a in &out.assignments {
            assert!(a.scheduled_time >= start && a.scheduled_time <= end);
        }
    }

    #[test]
    fn window_even_single_item() {
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Even,
            item_count: 1,
            exact_times: vec![],
            window_start: 100,
            window_end: 200,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 1);
        assert_eq!(out.assignments[0].scheduled_time, 100);
    }

    #[test]
    fn window_variable_distribution() {
        let start = ts(17, 0);
        let end = ts(19, 0);
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Variable,
            item_count: 5,
            exact_times: vec![],
            window_start: start,
            window_end: end,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 60,
            seed: Some(12345),
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 5);
        // All inside window
        for a in &out.assignments {
            assert!(a.scheduled_time >= start && a.scheduled_time <= end);
        }
        // Strictly increasing
        for i in 1..out.assignments.len() {
            assert!(out.assignments[i].scheduled_time > out.assignments[i - 1].scheduled_time);
        }
    }

    #[test]
    fn window_variable_deterministic() {
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Variable,
            item_count: 10,
            exact_times: vec![],
            window_start: ts(9, 0),
            window_end: ts(17, 0),
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 60,
            seed: Some(999),
        };
        let out1 = generate_schedule(&input).unwrap();
        let out2 = generate_schedule(&input).unwrap();
        assert_eq!(out1.assignments, out2.assignments);
    }

    #[test]
    fn window_variable_different_seeds() {
        let base = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Variable,
            item_count: 10,
            exact_times: vec![],
            window_start: ts(9, 0),
            window_end: ts(17, 0),
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 60,
            seed: None,
        };
        let mut input1 = base.clone();
        input1.seed = Some(1);
        let mut input2 = base;
        input2.seed = Some(2);
        let out1 = generate_schedule(&input1).unwrap();
        let out2 = generate_schedule(&input2).unwrap();
        // Different seeds should produce different schedules (with high probability).
        assert_ne!(out1.assignments, out2.assignments);
    }

    #[test]
    fn interval_basic() {
        let input = ScheduleInput {
            mode: ScheduleMode::Interval,
            distribution: Distribution::Even,
            item_count: 4,
            exact_times: vec![],
            window_start: 0,
            window_end: 0,
            interval_start: 1000,
            interval_seconds: 300,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 4);
        assert_eq!(out.assignments[0].scheduled_time, 1000);
        assert_eq!(out.assignments[1].scheduled_time, 1300);
        assert_eq!(out.assignments[2].scheduled_time, 1600);
        assert_eq!(out.assignments[3].scheduled_time, 1900);
    }

    #[test]
    fn interval_rejects_zero_interval() {
        let input = ScheduleInput {
            mode: ScheduleMode::Interval,
            distribution: Distribution::Even,
            item_count: 2,
            exact_times: vec![],
            window_start: 0,
            window_end: 0,
            interval_start: 1000,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        assert!(generate_schedule(&input).is_err());
    }

    #[test]
    fn multiday_basic() {
        let day1_start = 1000000;
        let day2_start = 1000000 + 86400;
        let input = ScheduleInput {
            mode: ScheduleMode::MultiDay,
            distribution: Distribution::Even,
            item_count: 5,
            exact_times: vec![],
            window_start: 0,
            window_end: 0,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![
                DayConfig {
                    day_start: day1_start,
                    window_start_offset: ts(17, 0),
                    window_end_offset: ts(19, 0),
                    item_count: 3,
                },
                DayConfig {
                    day_start: day2_start,
                    window_start_offset: ts(17, 0),
                    window_end_offset: ts(19, 0),
                    item_count: 2,
                },
            ],
            min_gap_seconds: 0,
            seed: None,
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 5);
        // First 3 on day 1
        for i in 0..3 {
            assert!(out.assignments[i].scheduled_time >= day1_start + ts(17, 0));
            assert!(out.assignments[i].scheduled_time <= day1_start + ts(19, 0));
        }
        // Last 2 on day 2
        for i in 3..5 {
            assert!(out.assignments[i].scheduled_time >= day2_start + ts(17, 0));
            assert!(out.assignments[i].scheduled_time <= day2_start + ts(19, 0));
        }
    }

    #[test]
    fn multiday_rejects_allocation_mismatch() {
        let input = ScheduleInput {
            mode: ScheduleMode::MultiDay,
            distribution: Distribution::Even,
            item_count: 10,
            exact_times: vec![],
            window_start: 0,
            window_end: 0,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![
                DayConfig {
                    day_start: 1000000,
                    window_start_offset: 0,
                    window_end_offset: 3600,
                    item_count: 3,
                },
                DayConfig {
                    day_start: 1000000 + 86400,
                    window_start_offset: 0,
                    window_end_offset: 3600,
                    item_count: 4,
                },
            ],
            min_gap_seconds: 0,
            seed: None,
        };
        assert_eq!(
            generate_schedule(&input).unwrap_err(),
            ScheduleError::DayAllocationMismatch {
                expected: 10,
                got: 7
            }
        );
    }

    #[test]
    fn empty_input_rejected() {
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Even,
            item_count: 0,
            exact_times: vec![],
            window_start: 0,
            window_end: 100,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        assert_eq!(generate_schedule(&input).unwrap_err(), ScheduleError::EmptyInput);
    }

    #[test]
    fn window_rejects_start_equals_end() {
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Even,
            item_count: 2,
            exact_times: vec![],
            window_start: 100,
            window_end: 100,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        assert!(generate_schedule(&input).is_err());
    }

    #[test]
    fn window_rejects_start_after_end() {
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Even,
            item_count: 2,
            exact_times: vec![],
            window_start: 200,
            window_end: 100,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        assert!(generate_schedule(&input).is_err());
    }

    #[test]
    fn even_57_items() {
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Even,
            item_count: 57,
            exact_times: vec![],
            window_start: ts(17, 0),
            window_end: ts(19, 0),
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 57);
        assert_eq!(out.assignments[0].scheduled_time, ts(17, 0));
        assert_eq!(out.assignments[56].scheduled_time, ts(19, 0));
        for i in 1..57 {
            assert!(out.assignments[i].scheduled_time > out.assignments[i - 1].scheduled_time);
        }
    }

    #[test]
    fn variable_57_items() {
        let start = ts(17, 0);
        let end = ts(19, 0);
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Variable,
            item_count: 57,
            exact_times: vec![],
            window_start: start,
            window_end: end,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 60,
            seed: Some(42),
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 57);
        for a in &out.assignments {
            assert!(a.scheduled_time >= start && a.scheduled_time <= end);
        }
        for i in 1..57 {
            assert!(out.assignments[i].scheduled_time > out.assignments[i - 1].scheduled_time);
        }
    }

    #[test]
    fn variable_250_items() {
        let start = ts(9, 0);
        let end = ts(17, 0);
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Variable,
            item_count: 250,
            exact_times: vec![],
            window_start: start,
            window_end: end,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 10,
            seed: Some(777),
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 250);
        for a in &out.assignments {
            assert!(a.scheduled_time >= start && a.scheduled_time <= end);
        }
        for i in 1..250 {
            assert!(out.assignments[i].scheduled_time > out.assignments[i - 1].scheduled_time);
        }
    }

    #[test]
    fn even_250_items() {
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Even,
            item_count: 250,
            exact_times: vec![],
            window_start: ts(9, 0),
            window_end: ts(17, 0),
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 250);
        for i in 1..250 {
            assert!(out.assignments[i].scheduled_time > out.assignments[i - 1].scheduled_time);
        }
    }

    #[test]
    fn multiday_57_items_3_days() {
        let base = 1000000;
        let input = ScheduleInput {
            mode: ScheduleMode::MultiDay,
            distribution: Distribution::Even,
            item_count: 57,
            exact_times: vec![],
            window_start: 0,
            window_end: 0,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![
                DayConfig {
                    day_start: base,
                    window_start_offset: ts(17, 0),
                    window_end_offset: ts(19, 0),
                    item_count: 18,
                },
                DayConfig {
                    day_start: base + 86400,
                    window_start_offset: ts(17, 0),
                    window_end_offset: ts(19, 0),
                    item_count: 20,
                },
                DayConfig {
                    day_start: base + 2 * 86400,
                    window_start_offset: ts(17, 0),
                    window_end_offset: ts(19, 0),
                    item_count: 19,
                },
            ],
            min_gap_seconds: 0,
            seed: None,
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 57);
        // Day 1: 18 items
        for i in 0..18 {
            assert!(out.assignments[i].scheduled_time >= base + ts(17, 0));
            assert!(out.assignments[i].scheduled_time <= base + ts(19, 0));
        }
        // Day 2: 20 items
        for i in 18..38 {
            assert!(out.assignments[i].scheduled_time >= base + 86400 + ts(17, 0));
            assert!(out.assignments[i].scheduled_time <= base + 86400 + ts(19, 0));
        }
        // Day 3: 19 items
        for i in 38..57 {
            assert!(out.assignments[i].scheduled_time >= base + 2 * 86400 + ts(17, 0));
            assert!(out.assignments[i].scheduled_time <= base + 2 * 86400 + ts(19, 0));
        }
    }

    #[test]
    fn no_duplicate_timestamps() {
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Variable,
            item_count: 57,
            exact_times: vec![],
            window_start: ts(17, 0),
            window_end: ts(19, 0),
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 60,
            seed: Some(42),
        };
        let out = generate_schedule(&input).unwrap();
        let mut times: Vec<i64> = out.assignments.iter().map(|a| a.scheduled_time).collect();
        let len_before = times.len();
        times.sort();
        times.dedup();
        assert_eq!(times.len(), len_before, "duplicate timestamps found");
    }

    #[test]
    fn stable_ordering() {
        // Items should be assigned in input order (0, 1, 2, ...).
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Even,
            item_count: 10,
            exact_times: vec![],
            window_start: 0,
            window_end: 10000,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        let out = generate_schedule(&input).unwrap();
        for (i, a) in out.assignments.iter().enumerate() {
            assert_eq!(a.item_index, i);
        }
    }

    #[test]
    fn variable_too_small_window_rejected() {
        // 10 items, 60s min gap, but window is only 60s → not enough room.
        let input = ScheduleInput {
            mode: ScheduleMode::Window,
            distribution: Distribution::Variable,
            item_count: 10,
            exact_times: vec![],
            window_start: 0,
            window_end: 60,
            interval_start: 0,
            interval_seconds: 0,
            days: vec![],
            min_gap_seconds: 60,
            seed: Some(1),
        };
        assert!(generate_schedule(&input).is_err());
    }

    #[test]
    fn interval_2_items() {
        let input = ScheduleInput {
            mode: ScheduleMode::Interval,
            distribution: Distribution::Even,
            item_count: 2,
            exact_times: vec![],
            window_start: 0,
            window_end: 0,
            interval_start: 5000,
            interval_seconds: 600,
            days: vec![],
            min_gap_seconds: 0,
            seed: None,
        };
        let out = generate_schedule(&input).unwrap();
        assert_eq!(out.assignments.len(), 2);
        assert_eq!(out.assignments[0].scheduled_time, 5000);
        assert_eq!(out.assignments[1].scheduled_time, 5600);
    }
}
