# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
