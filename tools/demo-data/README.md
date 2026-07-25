# GitOutbox Developer Demo Data Generator

A reusable developer utility for populating GitOutbox's SQLite database (`gitoutbox.db`) with realistic repositories, draft commits, activity history, execution logs, and templates.

This generator is strictly a **development utility** used for:
- Local UI/UX development and testing
- QA testing & bug reproductions
- Performance testing with small (~20), medium (~100), or large (~1000) queue items
- Generating app screenshots and demo videos

---

## 📁 Directory Structure

```text
tools/demo-data/
├── .gitignore              # Ignores __pycache__, *.pyc, *.db, *.sql
├── README.md               # Developer documentation & integration guide
├── generate.py             # Main standalone Python generator (0 external dependencies)
├── generate.js             # Node.js generator script equivalent
├── config.json             # Range configuration and volume presets (small/medium/large)
└── helpers/
    └── data_sets.py        # Conventional commits, authors, repos, file trees, failures
```

---

## 🚀 How to Run the Generator

### Option 1: Python Standard Library (Recommended - Zero Dependencies)

#### Volume Presets

- **Small** (~20 drafts, 3-5 repos):
  ```bash
  python tools/demo-data/generate.py --preset small --reset
  ```

- **Medium** (~100 drafts, 6-9 repos - Default):
  ```bash
  python tools/demo-data/generate.py --preset medium --reset
  ```

- **Large** (~1000 drafts, 10-15 repos - Performance Testing):
  ```bash
  python tools/demo-data/generate.py --preset large --reset
  ```

#### Dynamic Cross-Platform Database Detection

The generator automatically detects the local GitOutbox SQLite database across operating systems:
- **Windows**: `%APPDATA%\app.gitoutbox.desktop\gitoutbox.db`
- **macOS**: `~/Library/Application Support/app.gitoutbox.desktop/gitoutbox.db`
- **Linux**: `~/.config/app.gitoutbox.desktop/gitoutbox.db`

To explicitly specify a custom database file:

```bash
python tools/demo-data/generate.py --db /path/to/custom_gitoutbox.db --reset
```

#### Run Validation Only

To verify an existing database without modifying any data:

```bash
python tools/demo-data/generate.py --validate-only
```

---

### Option 2: Node.js Utility

Generate SQL seed statements:

```bash
node tools/demo-data/generate.js --preset medium
```

---

## ⚙️ Configuration & Ranges (`config.json`)

Instead of fixed constants, generation counts are randomly sampled within configurable ranges per preset:

```json
{
  "active_preset": "medium",
  "presets": {
    "small": {
      "repositories": { "min": 3, "max": 5 },
      "drafts": { "min": 18, "max": 25 },
      "activities": { "min": 25, "max": 40 }
    },
    "medium": {
      "repositories": { "min": 6, "max": 9 },
      "drafts": { "min": 80, "max": 120 },
      "activities": { "min": 100, "max": 200 }
    },
    "large": {
      "repositories": { "min": 10, "max": 15 },
      "drafts": { "min": 850, "max": 1150 },
      "activities": { "min": 1000, "max": 1500 }
    }
  }
}
```

---

## 🎲 Rich Randomization & Metadata

Every execution generates a unique dataset by randomizing:
- **Repositories**: Sampled from a rich pool of 10+ realistic repos with remote URLs, default branches, and file structures.
- **Commit Authors**: Assigned realistic names and emails (`Ayush Singh <ayush@example.com>`, `Jane Doe <...>`, etc.).
- **Conventional Commits**: Dynamically assembled with scopes (`feat(ui): ...`, `fix(db): ...`, `refactor(core): ...`).
- **Commits & Files**: Random additions (`+4` to `+140`), deletions (`-1` to `-45`), change types (`modified`, `untracked`, `deleted`, `renamed`), and execution durations (`150ms` to `4200ms`).
- **Timestamps**: Spans `Yesterday`, `Today`, `Tomorrow`, `This Week`, `Next Week`.

---

## 🔍 Database Integrity Validation

Every run concludes with an automatic integrity check verifying:
1. **Foreign Key Relations**: 0 orphaned queue items, files, or activity events.
2. **Completed Items**: 100% of Completed items contain valid 40-character hex commit hashes.
3. **Failed Items**: 100% of Failed items contain detailed error logs and retry counts > 0.
