# Architecture Documentation

GitOutbox is built as a multi-tier local application, combining a Rust core, a SQLite database, a Tauri desktop wrapper, and a React + TypeScript frontend.

---

## 1. Repository Layout

```
├── .agents/                    # Codex project-scoped agent skills and rules
├── .opencode/                  # OpenCode project-scoped agent configuration
├── crates/
│   └── gitoutbox-core/         # Pure Rust logic crate (independently testable)
│       ├── src/
│       │   ├── change.rs       # git status porcelain v2 parsing
│       │   ├── executor.rs     # Git command wrappers (stage, commit, push)
│       │   ├── git.rs          # Low-level process executors and preflights
│       │   ├── scheduler.rs    # Core scheduling and spacing algorithms
│       │   └── template.rs     # String template variable expansion
│       └── tests/              # Real-temp-repo integration test suites
├── src/                        # React + TypeScript presentation layer
│   ├── app/                    # Main App entrypoint and global views wiring
│   ├── assets/                 # Brand assets and logos
│   ├── components/             # Reusable UI components (RepoView, Composer, etc.)
│   └── lib/                    # Frontend helpers (IPC wrappers, selection, templates)
├── src-tauri/                  # Tauri app configuration and native integrations
│   ├── capabilities/           # Window and API permission capability definitions
│   ├── gen/                    # Generated desktop build settings
│   ├── icons/                  # Desktop build and installer icons
│   └── src/
│       ├── commands.rs         # Tauri IPC endpoints registered for frontend use
│       ├── db.rs               # SQLite schemas, connections, and CRUD query layer
│       ├── execution.rs        # Background tick executor loop
│       ├── lib.rs              # App builder registry, missed-policy triggers, tray
│       └── main.rs             # Crate entrypoint
├── tests/                      # Frontend lifecycle integration tests
└── Internal development workspace/ # Private dev context files (gitignored)
```

---

## 2. Frontend Layer (React & Vite)

* **Technologies**: React 18, Vite, TypeScript, Tailwind CSS v4, Lucide React icons.
* **Role**: Presentation and interaction only. The UI owns no core logic regarding Git staging or scheduling timers. It reflects database state (polled or notified) and translates user actions into IPC calls via `invoke`.
* **State Management**: Keyed states (such as active repository selection) are isolated at the App level to prevent state leaking when switching repositories.

---

## 3. Backend Crate (`gitoutbox-core`)

* **Role**: A pure-Rust library compiled without native dependencies. It can be built and tested on any platform containing a standard Git installation.
* **Responsibilities**:
  * Runs low-level shell commands targeting the local Git CLI via `std::process::Command` using argument arrays (preventing shell injection).
  * Parses NUL-terminated Porcelain v2 outputs (`git status --porcelain=v2 -z`).
  * Runs math engines for scheduling distributions.
  * Resolves commit message templates.

---

## 4. Persistent Database (SQLite)

* **Role**: The single source of truth for repository queues, active states, templates, and history logs. GitOutbox never relies on transient in-memory states or background threads to store schedules.
* **Implementation**: Uses `rusqlite` with bundled SQLite C source compiling statically into the binary.
* **Schema**: Consists of 7 tables mapping `repositories`, `queue_items`, `queue_item_files`, `commit_templates`, `activity_events`, `settings`, and migrations. Supports database transactions and cascades.

---

## 5. Scheduler & Spacing Engine

* **Implementation**: Located in [crates/gitoutbox-core/src/scheduler.rs](file:///c:/Projects/Gitlater/crates/gitoutbox-core/src/scheduler.rs).
* **Operation**: Resolves arbitrary draft sizes and item counts into deterministic Epoch timestamps based on four modes (Exact, Window, Interval, MultiDay) and spacing metrics (Even, Variable).

---

## 6. Execution Engine

* **Implementation**: Located in [src-tauri/src/execution.rs](file:///c:/Projects/Gitlater/src-tauri/src/execution.rs).
* **Operation**: A background thread runs a tick loop checking SQLite database queues. When an item is due:
  1. It checks the per-repo serialization lock.
  2. Runs preflight checks (workspace branch, merge states, file fingerprints).
  3. Stages assigned files specifically.
  4. Verifies index match.
  5. Commits and/or pushes.
  6. Handles retries or logs errors.

---

## 7. Inter-Process Communication (IPC)

* Tauri's `tauri::command` deserializer passes command parameters to Rust handlers.
* Commands mapped in [src-tauri/src/commands.rs](file:///c:/Projects/Gitlater/src-tauri/src/commands.rs) are annotated with `#[tauri::command(rename_all = "snake_case")]` to match the frontend JSON serialization shapes.

---

## 8. Activity Logging System

* Log events are written to the `activity_events` database table using structured levels (`info`, `warn`, `error`).
* Errors write comprehensive warnings documenting exactly what failed, whether the commit was created, and whether anything was pushed.
