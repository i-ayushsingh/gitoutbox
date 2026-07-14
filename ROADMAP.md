# GitOutbox Roadmap

This document outlines the planned direction and milestones for GitOutbox. As a local-first desktop Git assistant, the roadmap focuses on strengthening reliability, optimizing developer workflow integrations, and providing rich monitoring without introducing external dependencies or SaaS requirements.

---

## Near-Term (v0.2.0)

*Focus: User Experience, tray responsiveness, and installer optimization.*

* **Enhanced Tray Feedback**: Visual status indicator in the Windows tray showing current worker state (e.g. idle, staging, committing, pushing, paused).
* **Detailed Conflict Previews**: In the repository view, show the specific conflicting edits or index mismatches when an item transitions to `Needs Review` due to fingerprint mismatches.
* **Tauri Installer Improvements**: Optimize MSI/NSIS installation sizes and support auto-launch on startup toggle in the settings UI (via `tauri-plugin-autostart`).
* **Post-Commit Hooks Configuration**: Provide settings to toggle whether local Git commit hooks (`pre-commit`, `commit-msg`, etc.) are bypassed or respected during scheduled execution.

---

## Mid-Term (v0.3.0)

*Focus: Scriptability and advanced staging controls.*

* **Pre-Execution Shell Hooks**: Allow users to run local build/linter scripts prior to scheduling. If the shell script exits with a non-zero code, execution halts and the queue item transitions to `Needs Review` (preventing broken builds from being committed).
* **Multi-Branch Target Queues**: Allow different queue items in the same repository to target different local branches (validating workspace state and prompting branch shifts if needed).
* **Visual Git Diff Previews**: Built-in diff view to inspect changes on files before adding them to draft commit groups.
* **Custom SQLite Database Paths**: Allow developers to change the location of the persistent database (`gitoutbox.db`) to enable backup sync across local folders.

---

## Long-Term (v0.4.0 & beyond)

*Focus: Multi-platform expansion and advanced orchestration.*

* **macOS & Linux Support**: Bundle and compile installers for macOS (.app/.dmg) and Linux (.deb/.rpm), mapping native notification and tray features.
* **Scheduled Pull Sync**: Periodically pull upstream branches on idle to ensure local repositories stay up to date before scheduled commit staging runs.
* **Interactive Command Line Tool**: A companion CLI (`gitoutbox-cli`) that allows developers to query, queue, and monitor drafts directly from their terminal workspaces.
