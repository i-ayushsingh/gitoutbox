# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
