# Contributing to GitOutbox

Thank you for your interest in contributing to GitOutbox! This document outlines development setup, coding standards, safety invariants, and repository guidelines.

---

## Repository Structure

GitOutbox is organized as a cargo workspace containing the Tauri application shell and a core Rust library:
* **[src/](file:///c:/Projects/Gitlater/src)**: React + TypeScript frontend code.
* **[src-tauri/](file:///c:/Projects/Gitlater/src-tauri)**: Tauri application configuration, desktop integration hooks, tray management, and SQLite database persistence.
* **[crates/gitoutbox-core/](file:///c:/Projects/Gitlater/crates/gitoutbox-core)**: Pure-standard Rust library containing all logic for Git CLI interaction, scheduling algorithms, and preflight safety checks. This crate has no native system dependencies.
* **[tests/](file:///c:/Projects/Gitlater/tests)**: Node.js TSX integration and React hook-order lifecycle tests.

---

## Development Setup

### System Prerequisites
To build and test GitOutbox locally, make sure you have the following installed:
* **Node.js**: v20+ or v24+ (and `npm` v10+)
* **Rust & Cargo**: Rust 1.75+ or 1.96+ (host `x86_64-pc-windows-msvc` for Windows packaging)
* **Git**: Git 2.25+ installed and on system PATH
* **MSVC Build Tools**: Required for compiling Tauri's Rust dependencies on Windows

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/i-ayushsingh/gitoutbox.git
   cd gitoutbox
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```

### Running Locally
To launch GitOutbox in development mode (with hot-reloading frontend and Rust recompilation):
```bash
npm run dev
```
*(This triggers `vite` for the web interface and starts the Tauri desktop runner).*

### Running Tests
Make sure all tests pass before submitting any pull request:

* **Rust tests** (includes core logic and integration mock repositories):
  ```bash
  cargo test --all
  ```
* **Frontend tests** (includes TSX templates, selection, and composer hook checks):
  ```bash
  npm test
  ```

---

## Coding Standards

### Architecture Separation
* **Frontend (React)**: Handles presentation, styling, UI layouts, and user events only. No critical Git command execution or scheduler logic should live here.
* **Backend (Tauri/Rust)**: Owns repository locking, database access, background schedule ticks, systems notifications, and tray events.
* **Core Crate (`gitoutbox-core`)**: Houses all testable Git/safety logic. Keep it standard-library only so it compiles and tests instantly without Tauri.

### Git CLI Invocations
* **Always** use argument arrays (`std::process::Command::args`) when executing Git commands. Never use shell string concatenation to prevent injection vulnerabilities.
* Parse changes from `git status --porcelain=v2 -z` (NUL-terminated output) to handle spaces and Unicode characters reliably.

---

## Git Safety Expectations

All contributions modifying Git staging or execution must adhere strictly to the following safety invariants:
1. **No Wildcard Staging**: Staging must target *explicit file paths only*. Do not implement `git add .` or `git add -A`.
2. **Staged-path Verification**: After staging files, inspect the Git index to verify that it contains *exactly* the assigned paths. If there is a mismatch, roll back immediately and abort.
3. **No Destructive Operations**: Never run resets, checkouts, stashing, or force pushes on the user's active branch.
4. **Preflight Checking**: Always check if a merge, rebase, cherry-pick, revert, or bisect is in progress, and pause execution if found.
5. **Fail Closed**: Any error in branch validation, file state, or fingerprint checks must fail closed (i.e. commit nothing, pause the item, and alert the user).

---

## Pull Request Guidelines

1. **Format**: Format Rust code with `cargo fmt` and TypeScript files with Prettier.
2. **Lint**: Ensure `cargo check` and `tsc --noEmit` compile without warnings.
3. **Branching**: Commit your changes to a feature branch (`feature/your-change`) and open a pull request against `main`.
4. **Testing**: Write unit or integration tests for new features. Ensure existing tests continue to pass.
