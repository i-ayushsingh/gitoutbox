# AGENTS.md — GitOutbox

Local-first, Windows-first desktop Git scheduling utility for bursty developers.
"Prepare work now. Ship it on your schedule."

This file is the architectural + Git safety contract for coding agents. It
overrides generic simplicity/laziness advice when the two conflict. Source of
truth for product behavior: `GitOutbox_AI_Build_Spec.md`. For desktop testing
strategy: `GITOUTBOX_DOCS_MANIFEST.md` + the project `gitoutbox-*` skills.

## Stack

- Tauri 2 (desktop shell, IPC, tray, lifecycle)
- React + TypeScript + Vite (presentation)
- Tailwind CSS (styling via design tokens)
- SQLite (durable source of truth)
- Rust backend (`src-tauri`) + pure-logic core crate (`gitoutbox-core`)
- Lucide icons, accessible headless primitives

## Architecture restatement

- React owns presentation and interaction only.
- Rust owns repository inspection, Git execution, durable scheduling,
  fingerprints, retries, logging, state transitions, repository locks, and
  tray lifecycle.
- `gitoutbox-core` is a **pure-std Rust crate with no native dependencies**. It
  holds all testable Git/scheduler/safety logic so it can be unit/integration
  tested without the Tauri/MSVC toolchain. `src-tauri` wraps it with Tauri
  commands and adds SQLite (rusqlite) persistence.
- SQLite is the durable source of truth. An in-memory timer is never the only
  scheduler source of truth.
- The local Git CLI is the Git source of truth. Git is invoked via
  `std::process::Command` with **argument arrays** — never shell string
  concatenation. Output is parsed from `git status --porcelain=v2 -z` (NUL-
  separated, correct for spaces/Unicode paths).
- The local Git CLI is the Git source of truth.

## IPC contract

Frontend calls Rust via `@tauri-apps/api` `invoke`. Commands are thin wrappers
that delegate to `gitoutbox_core` (for inspection) or the SQLite layer (for
durable state). No scheduler-critical Git execution lives in React.

## Git safety invariants (never weaken, not even for a demo)

1. Never `git add .` / `-A` / a directory glob in scheduled execution.
2. Stage only the explicit assigned paths for the commit group.
3. After staging, verify staged paths exactly equal expected assigned paths;
   abort the commit if they differ.
4. Detect unrelated pre-staged paths before executing; pause, never absorb.
5. Never auto-checkout a branch, reset user work, stash user work, or force
   push.
6. Validate file fingerprints before execution; mismatch → `Needs review`,
   pause, notify, commit nothing.
7. Validate current branch == target branch before execution; mismatch →
   pause, state active vs target, do not switch.
8. Pause immediately on merge/rebase/cherry-pick/revert/other unsafe Git op.
9. Commit only when there are actual assigned changes and a non-empty message.
10. No credential collection, no token storage. Use the user's existing Git
    auth. Sanitize logs and remote URLs; never log secrets or URLs with
    embedded credentials.
11. Never upload repository contents or diffs.
12. Do not bypass Git hooks by default.
13. On restart, if an item is `Validating/Staging/Committing/Pushing`, inspect
    actual repository state before deciding anything. Never blindly rerun or
    duplicate a commit.
14. Every error must state: what happened, whether a commit was created, and
    whether anything was pushed (spec Error UX, §34).

## Five highest-risk engineering areas

1. **Exact-path staging + staged-path verification** — the core safety gate.
   Must prove `git add <explicit paths>` only, then prove the index contains
   exactly those paths before commit. Highest blast radius if wrong.
2. **Fingerprint gating** — prevents silently committing content that changed
   after scheduling. Content hash + state/path metadata for deleted/renamed.
3. **Branch + unsafe-op detection** — pause (not switch) on mismatch or
   in-progress merge/rebase/cherry-pick/revert.
4. **Durable scheduler + crash/restart recovery** — SQLite is truth; on restart
   inspect repo state and never duplicate a commit.
5. **Tray lifecycle + missed-schedule policy + force-exit warning** — background
   execution must survive window close; external kill must be recovered on next
   launch via the missed-schedule policy.

## Exact vertical implementation order

- Phase 1 — Scaffold, design tokens, shell, SQLite, Git check, repository
  picker, status list.
- Phase 2 — File selection, commit groups, multi-file groups, manual messages,
  templates, persistence.
- Phase 3 — Four schedule modes, even/variable distribution, Shuffle Schedule,
  preview, queue editing.
- Phase 4 — Durable worker, branch checks, fingerprints, exact-path staging,
  staged-path verification, commit, push, retries, activity events.
- Phase 5 — Tray, exit warning, missed-schedule recovery, notifications.
- Phase 6 — Empty/error/loading states, Windows scaling, Git failure tests,
  crash/restart recovery, README.

### Phase 1 internal order

1. Scaffold (toolchain configs, Tauri conf, vite, tailwind, tsconfig).
2. `gitoutbox-core` git service + change detection + tests (foundation).
3. SQLite migrations + connection + repositories persistence.
4. Tauri commands: git check / inspect / status, repositories.
5. Design tokens + app shell + left rail.
6. Onboarding git-check screen.
7. Repository picker + repository list.
8. Changes / status list view.

## Testing layers

- Rust unit/integration (`gitoutbox-core`): Git check, status parsing for all
  four change types, operation-in-progress detection, spaces/Unicode paths.
- React/component: isolated rendering & interaction.
- Tauri mock-runtime: IPC command wiring where appropriate.
- Desktop E2E (WebDriverIO + Tauri service, Windows): tray, notifications,
  lifecycle.
- Browser preview: visual iteration only, never a correctness signal.

## Definition of Done

Tracked as a checked/unchecked list in `docs/BUILD_STATUS.md`.
