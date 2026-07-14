# Scheduler & Spacing Engine

The scheduling core is implemented entirely in Rust under the [gitoutbox-core](file:///c:/Projects/Gitlater/crates/gitoutbox-core) crate. Keeping the scheduler decoupled from Tauri makes it unit-testable and independent of UI rendering.

---

## 1. Scheduling Input & Output

The scheduling engine expects a configuration struct defining:
* The target schedule mode and distribution style.
* The number of draft items to schedule.
* Constraints like start/end times, interval durations, active days, and a minimum gap size.
* An optional PRNG seed.

It outputs a list of assignments, pairing each item index with an Epoch timestamp.

---

## 2. Scheduling Modes

### Exact Mode
Each item is assigned a specific, manually chosen timestamp. The engine validates that the timestamps are unique and in chronological order.

### Interval Mode
Takes a start time and a fixed duration interval (e.g. 3600 seconds). Items are scheduled sequentially:
$$\text{Time}_i = \text{Start} + (i \times \text{Interval})$$

### Window Mode
Distributes items within a single contiguous window (defined by a start and end time on a target day).
* **Even Distribution**: Spates items equally across the window:
  $$\text{Gap} = \frac{\text{End} - \text{Start}}{\text{Item Count} + 1}$$
  $$\text{Time}_i = \text{Start} + ((i + 1) \times \text{Gap})$$
* **Variable Distribution**: Generates non-uniform spacing. It uses a seeded Pseudo-Random Number Generator (PRNG) to ensure schedule generation is deterministic (so the same seed always produces the exact same schedule). It respects the `min_gap_seconds` constraint.

### Multi-Day Mode
Schedules items across multiple days. The input contains a list of active days, each configured with:
* A daily active window start offset (e.g. 09:00 AM).
* A daily active window end offset (e.g. 05:00 PM).
* The number of items allocated to that day.

The engine processes each day independently, distributing the day's assigned items within that day's window using either **Even** or **Variable** spacing.

---

## 3. Spacing Distributions

### Even Spacing
Guarantees identical time gaps between commits. This is useful for predictable, uniform deliveries.

### Variable Spacing
Simulates a natural human coding rhythm by generating varying gaps between commits.
1. A deterministic seed is generated or provided.
2. The engine uses a seeded PRNG (`Lcg` or similar simple algorithm) to select random offsets within the window boundary.
3. It enforces a strict minimum gap size (`min_gap_seconds`) to prevent commits from being scheduled too close to each other.
4. If the item count is too high to satisfy the minimum gap size within the window, the engine returns a `WindowTooSmall` error.

---

## 4. Shuffle Schedule

The "Shuffle" feature in the frontend requests the scheduler to regenerate assignments using a fresh random seed. This allows users to immediately randomize the layout of their queue if they are unsatisfied with the initial distribution preview.
