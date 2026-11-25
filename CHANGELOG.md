# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## v0.2.1 (2026-11-25)

This maintenance and reliability release fixes critical commit-recovery, branch-scoping, and UI state bugs, wires desktop lifecycle and notification preferences to the Rust backend, and replaces the placeholder update check with a real GitHub Releases check.

### Fixed

- **Safe Reschedule & Unschedule Recovery**: Preserved `commit_hash` during `reschedule_item` (routing committed items to `PushPending` for push-only recovery instead of re-committing) and blocked `unschedule_items` from reverting already-committed items back to `Draft`.
- **Branch-Scoped Push Completion**: Scoped `complete_all_push_pending` by `(repository_id, target_branch)` so pushing one branch no longer marks `PushPending` items on other branches as `Completed`.
- **Draft Edit Guard**: Restricted `update_queue_item` and `update_queue_item_full` to `Draft` items only, preventing accidental edits to scheduled, executing, or completed items.
- **Paused Retry Error Reporting**: Updated `retry_paused_items` to aggregate and surface execution errors instead of silently swallowing them.
- **Repository ID Mapping**: Added `repository_id` to `QueueItem` / `QueueItemDto` and updated `App.tsx` (`handleReviewPaused`, `TodayView`, `AllQueuesView`) to match repositories by `repository_id` instead of `queue_id`.
- **Recovery UX in Drafts View**: Added `PushPending` and `Running` status grouping/badges, exposed `Retry Now` and `Reschedule` actions on `Paused` / `PushPending` cards, restricted `Edit Message & Files` to `Draft` items, and disabled bulk `Schedule Selected` when non-drafts are selected.
- **Repo Tab Auto-Switch**: Limited automatic switching to the `Drafts` tab for paused items to once per repository visit so users aren't pulled away from `Changes` on queue refreshes.
- **Multi-Day Schedule Date Parsing**: Parsed `YYYY-MM-DD` dates in local time instead of UTC midnight in `ScheduleComposer`, fixing an off-by-one day shift in negative UTC offsets.
- **Git Environment Details**: Populated `git_path` and `default_branch` in `git_check` to match the frontend `GitCheck` contract.

### Changed

- **Persisted Desktop & Notification Preferences**: Added `AppPreferences` (`get_app_preferences` / `set_app_preferences`) in SQLite and wired `autostart` (Windows Run key), `start_minimized`, `close_to_tray`, `minimize_to_tray`, and granular notification toggles (`notify_commit`, `notify_push`, `notify_failure`, `notify_missed`, `notify_update`) in the Rust backend.
- **Real Update Check & Accurate Retry Policy Text**: Replaced the simulated `setTimeout` update check in Settings with a live GitHub Releases API check against `v0.2.1`, and aligned the Retry Policy UI description with the backend (`3 push retries`, `30s → 120s` backoff).

---

## v0.2.0 (2026-07-25)

The official v0.2.0 release brings complete desktop UX polish, dedicated Git & Scheduler management views, redesigned event timeline activity logs, structured status queue management, and a Developer Demo Data Generator.

### Added

- **Dedicated Git Management View**: Added Git executable path, installed Git version badge, authentication status indicator, default branch details, user email, and last scan timestamp.
- **Dedicated Scheduler Management View**: Added real-time scheduler state status (`Running`, `Paused`, `Stopped`), active/pending item breakdown, retry policy metrics, and next execution timer.
- **Developer Demo Data Generator**: Added standalone developer utility in `tools/demo-data/` (`generate.py` / `generate.js`) with volume presets (`small`, `medium`, `large`), dynamic database detection, realistic commit profiles, and database integrity validation (`--validate-only`).
- **Raw System Logs Tab**: Added dedicated low-level log tab in Activity view with level filtering (`ALL`, `INFO`, `WARNING`, `ERROR`) and one-click copy to clipboard.
- **Diagnostic Utilities**: Added one-click actions in Settings to open application data folder, open database location, export logs, reset onboarding, and clear cache.
- **Categorized Settings Navigation**: Organized settings into 8 dedicated sections (`General`, `Git`, `Scheduler`, `Execution`, `Notifications`, `Updates`, `Advanced`, `About`).

### Changed

- **Structured Queue Management**: Redesigned Drafts view to organize commits by lifecycle state (`All`, `Pending`, `Scheduled`, `Executing`, `Completed`, `Failed`, `Skipped`, `Archived`) with multi-selection actions and expandable file drawers.
- **Simplified Activity Event Timeline**: Replaced noisy low-level execution logs with a clean, high-level user activity timeline featuring structured event categories (`Repository Added`, `Draft Created`, `Scheduled`, `Executed`, `Push Completed`, `Execution Failed`, `Rescheduled`).
- **Icon Asset Optimization**: Trimmed transparent margins from icon artwork to achieve ~92-95% canvas coverage across all Windows taskbar, window titlebar, and system tray scales.
- **Scroll Container Layout Polish**: Added `pb-20` bottom padding buffer across all main view scroll containers, preventing items from being clipped at the bottom of lists.

### Fixed

- **Branding Consistency**: Removed duplicate header logos alongside the native window titlebar.
- **Scheduler Tray Commands**: Added IPC handlers allowing the user to pause or resume the background scheduler directly from the Windows system tray menu.

---

## v0.1.2 (2026-07-25)

This update is focused on first-time user experience, onboarding, branding consistency, and desktop polish for the public launch.

### Improvements & Polish

- **Icon Asset Optimization**: Removed excessive transparent padding from app icons and generated crisp multi-resolution icon assets across all standard Windows sizes (`.ico` and `.png`).
- **4-Screen Onboarding Flow**: Replaced single-check screen with an interactive 4-screen onboarding experience (Welcome, System Check, How GitOutbox Works, You're Ready).
- **First-Launch Zero-Repo State**: Replaced confusing "Nothing scheduled today" screen with a centered `No repositories yet` empty state featuring a prominent `[ Add Repository ]` CTA.
- **Branding Consistency**: Streamlined LeftRail and view headers to eliminate duplicate logo branding alongside native window title bars.
- **Windows SmartScreen Guide**: Added step-by-step documentation (`docs/SMARTSCREEN_GUIDE.md`) explaining how to bypass Windows SmartScreen warnings ("More info" → "Run anyway").
- **Onboarding Replay**: Added option in Settings to revisit the onboarding flow at any time.

---

## v0.1.1 (2026-07-15)

This patch release fixes two production issues discovered during the first real-world overnight execution.

### Bug Fixes

- **Fingerprint Verification**: Fixed a variant comparison issue where untracked files successfully staging turned into `Modified` variants, causing staged fingerprint validation to fail.
- **Paused Recovery Workflow**: Added a complete recovery system for paused scheduled items, allowing users to Retry, Reschedule, Return to Draft, or Delete paused items individually or in bulk.
- **Startup Attention Banner**: Added a top-level startup banner reminding the user if there are paused items requiring their review.

---

## v0.1.0 (2026-07-15)

This is the initial release of GitOutbox, a local-first desktop Git scheduling utility for Windows.

### Major Features

- **Draft Queue Management**: Create, view, edit, and delete draft commits before scheduling them.
- **Schedule Composer Dialog**: Complete visual scheduler panel supporting exact timestamp, interval gaps, daily windows, and multi-day allocations.
- **Commit Templates**: Local templates configuration with dynamic variable resolution (`{filename}`, `{directory}`, etc.) evaluated per-file.
- **System Tray Operation**: The application hides to the system tray and runs background tasks on window close. Exiting while queues are active prompts a force-exit warning.
- **Repository List & Picker**: Manage multiple local Git repositories with independent queues, status tracking, and active operations.

### Git Safety

- **Exact-Path Staging**: Restricts staging strictly to the files assigned to the draft commit (no folder or wildcard staging).
- **Index Verification**: Asserts that the staged index matches the assigned file set exactly; rolls back the staging on mismatch.
- **Fingerprint Protection**: Records file state and content hashes at scheduling time; blocks execution if files were modified in the workspace since creation.
- **Pre-staged Protection**: Detects pre-staged files in the target repository and pauses execution to prevent absorbing unrelated user work.
- **Workspace Verification**: Fails closed if the target branch does not match current workspace branch, or if a rebase, merge, bisect, cherry-pick, or revert is in progress.

### Scheduler

- **Spacing Distributions**: Spacing options for Window and Multi-day modes:
  - **Even spacing**: Equal spacing between commits within the active timeframe.
  - **Variable spacing**: Natural-looking gaps generated using a seeded PRNG for predictability in test environments.
- **Shuffle Schedule**: Instantly regenerate/re-allocate schedule assignments.

### Execution Engine

- **Delivery Modes**: Supported commit and push options:
  - **Commit Only**: Creates local commit, no push.
  - **Commit and Push**: Commits and immediately pushes each item.
  - **Push at End**: Commits scheduled items individually, and runs a single push operation after the final queued item finishes.
- **Error Backoff & Retry**: Failed operations trigger up to 3 retries using exponential backoff before transitioning the item to `Paused` and triggering system notices.

### Templates

- **Dynamic Resolvers**: Synthesizer resolves 8 variables (`{filename}`, `{stem}`, `{extension}`, `{directory}`, `{path}`, `{repo}`, `{branch}`, `{file_count}`) on a single-file or multi-file draft context.
- **Templates CRUD**: Dedicated templates settings manager with live synthetic preview.

### Activity Log

- **Log Audits**: Local persistent database logs recording every scheduling action, preflight validation success, commit creation (with hash details), push execution, and paused failure trace.

### Packaging & Builds

- **Windows Installers**: Added compilation scripts generating MSI and NSIS installers.

### Known Limitations

- **Staging**: No partial staging or line-by-chunk staging (GitOutbox acts on whole file paths only).
- **Git Authentication**: GitOutbox relies on existing system Git credentials and SSH keys; it does not collect or manage private keys or OAuth credentials.
- **Platform support**: Initial release v0.1.0 is optimized and tested for Windows desktop environments.
