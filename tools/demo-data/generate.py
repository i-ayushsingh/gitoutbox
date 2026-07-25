#!/usr/bin/env python3
"""
GitOutbox Demo Data Generator (Standalone Development Utility).

Populates a GitOutbox SQLite database with realistic repositories, draft commits,
conventional commit messages, execution logs, activity history, and templates.

Usage:
    python generate.py [--db PATH] [--preset small|medium|large] [--reset] [--validate-only]

Examples:
    # Generate medium preset (~100 drafts) on auto-detected local database:
    python generate.py

    # Generate small preset (~20 drafts) and reset existing tables:
    python generate.py --preset small --reset

    # Generate large preset (~1000 drafts) on custom database file:
    python generate.py --preset large --db /path/to/custom_gitoutbox.db --reset

    # Run database integrity validation only:
    python generate.py --validate-only
"""

import os
import sys
import json
import random
import sqlite3
import argparse
import time
from datetime import datetime, timedelta

# Import helper data sets
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from helpers.data_sets import (
    AUTHORS,
    REPOSITORIES_POOL,
    COMMIT_SCOPES,
    COMMIT_ACTIONS,
    TEMPLATES,
    FAILURES,
)

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS repositories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    path       TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS queues (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    target_branch TEXT NOT NULL,
    execution_mode TEXT NOT NULL,
    status        TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id       INTEGER NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    commit_message TEXT NOT NULL,
    target_branch  TEXT NOT NULL,
    execution_mode TEXT NOT NULL,
    scheduled_time INTEGER,
    status         TEXT NOT NULL,
    retry_count    INTEGER NOT NULL DEFAULT 0,
    last_error     TEXT,
    commit_hash    TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_item_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_item_id INTEGER NOT NULL REFERENCES queue_items(id) ON DELETE CASCADE,
    path          TEXT NOT NULL,
    original_path TEXT,
    change_type   TEXT NOT NULL,
    fingerprint   TEXT
);

CREATE TABLE IF NOT EXISTS commit_templates (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    template TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            INTEGER NOT NULL,
    level         TEXT NOT NULL,
    repository_id INTEGER REFERENCES repositories(id) ON DELETE SET NULL,
    queue_id      INTEGER,
    queue_item_id INTEGER,
    event_type    TEXT NOT NULL,
    message       TEXT NOT NULL,
    metadata      TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

def detect_db_path():
    """Dynamically detect local GitOutbox SQLite database path across OS platforms."""
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        if appdata:
            dir_path = os.path.join(appdata, "app.gitoutbox.desktop")
            os.makedirs(dir_path, exist_ok=True)
            return os.path.join(dir_path, "gitoutbox.db")
    elif sys.platform == "darwin":
        home = os.path.expanduser("~")
        dir_path = os.path.join(home, "Library", "Application Support", "app.gitoutbox.desktop")
        os.makedirs(dir_path, exist_ok=True)
        return os.path.join(dir_path, "gitoutbox.db")
    else:
        home = os.path.expanduser("~")
        dir_path = os.path.join(home, ".config", "app.gitoutbox.desktop")
        os.makedirs(dir_path, exist_ok=True)
        return os.path.join(dir_path, "gitoutbox.db")

    return os.path.join(os.path.dirname(__file__), "gitoutbox.db")

def load_config():
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "active_preset": "medium",
        "presets": {
            "small": {"repositories": {"min": 3, "max": 5}, "drafts": {"min": 18, "max": 25}, "activities": {"min": 25, "max": 40}},
            "medium": {"repositories": {"min": 6, "max": 9}, "drafts": {"min": 80, "max": 120}, "activities": {"min": 100, "max": 200}},
            "large": {"repositories": {"min": 10, "max": 15}, "drafts": {"min": 850, "max": 1150}, "activities": {"min": 1000, "max": 1500}}
        }
    }

def generate_random_hash():
    hex_chars = "0123456789abcdef"
    return "".join(random.choice(hex_chars) for _ in range(40))

def validate_database(conn):
    """Integrity check verifying foreign keys, hashes, error fields, and orphaned records."""
    cursor = conn.cursor()
    errors = []

    # 1. Orphaned queue items (queue_id missing in queues)
    cursor.execute("""
        SELECT COUNT(*) FROM queue_items qi
        LEFT JOIN queues q ON q.id = qi.queue_id
        WHERE q.id IS NULL
    """)
    orphaned_items = cursor.fetchone()[0]
    if orphaned_items > 0:
        errors.append(f"Found {orphaned_items} orphaned queue items (missing queue)")

    # 2. Orphaned queue item files (queue_item_id missing in queue_items)
    cursor.execute("""
        SELECT COUNT(*) FROM queue_item_files qif
        LEFT JOIN queue_items qi ON qi.id = qif.queue_item_id
        WHERE qi.id IS NULL
    """)
    orphaned_files = cursor.fetchone()[0]
    if orphaned_files > 0:
        errors.append(f"Found {orphaned_files} orphaned queue item files (missing draft item)")

    # 3. Orphaned activity events (repository_id missing in repositories)
    cursor.execute("""
        SELECT COUNT(*) FROM activity_events ae
        LEFT JOIN repositories r ON r.id = ae.repository_id
        WHERE ae.repository_id IS NOT NULL AND r.id IS NULL
    """)
    orphaned_events = cursor.fetchone()[0]
    if orphaned_events > 0:
        errors.append(f"Found {orphaned_events} activity events referencing missing repository")

    # 4. Completed commits without hashes
    cursor.execute("""
        SELECT COUNT(*) FROM queue_items
        WHERE status = 'Completed' AND (commit_hash IS NULL OR LENGTH(commit_hash) != 40)
    """)
    invalid_completed = cursor.fetchone()[0]
    if invalid_completed > 0:
        errors.append(f"Found {invalid_completed} Completed items missing valid 40-character commit hashes")

    # 5. Failed commits without error details
    cursor.execute("""
        SELECT COUNT(*) FROM queue_items
        WHERE status = 'Failed' AND (last_error IS NULL OR retry_count = 0)
    """)
    invalid_failed = cursor.fetchone()[0]
    if invalid_failed > 0:
        errors.append(f"Found {invalid_failed} Failed items missing last_error or retry count")

    print("\n--------------------------------------------------")
    print("🔍 Database Integrity Validation Summary Report:")
    if not errors:
        print("   [OK] All foreign key relations valid")
        print("   [OK] 0 Orphaned queue items / files / events")
        print("   [OK] 100% Completed commits have valid 40-char hashes")
        print("   [OK] 100% Failed commits have error messages and retry counts")
        print("   [OK] Database Integrity Check PASSED Successfully!")
    else:
        print("   [FAIL] Validation Errors Found:")
        for err in errors:
            print(f"      • {err}")
    print("--------------------------------------------------\n")
    return len(errors) == 0

def run_generator(db_path, preset_name="medium", reset=False, validate_only=False):
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    print("GitOutbox Developer Demo Data Generator")
    print(f"Target Database: {db_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    if validate_only:
        validate_database(conn)
        conn.close()
        return

    # Ensure schema exists
    cursor.executescript(SCHEMA_SQL)

    if reset:
        print("[*] Resetting existing database tables...")
        cursor.execute("DELETE FROM queue_item_files;")
        cursor.execute("DELETE FROM queue_items;")
        cursor.execute("DELETE FROM queues;")
        cursor.execute("DELETE FROM activity_events;")
        cursor.execute("DELETE FROM repositories;")
        cursor.execute("DELETE FROM commit_templates;")
        cursor.execute("DELETE FROM settings;")
        conn.commit()

    config = load_config()
    presets = config.get("presets", {})
    preset_cfg = presets.get(preset_name, presets.get("medium", {
        "repositories": {"min": 6, "max": 9},
        "drafts": {"min": 80, "max": 120},
        "activities": {"min": 100, "max": 200}
    }))

    target_repos = random.randint(preset_cfg["repositories"]["min"], preset_cfg["repositories"]["max"])
    target_drafts = random.randint(preset_cfg["drafts"]["min"], preset_cfg["drafts"]["max"])

    print(f"Preset Selected: '{preset_name.upper()}' -> Generating {target_repos} repositories & {target_drafts} draft commits...")

    now_ts = int(time.time())

    # 1. Repositories & Default Queues
    selected_repos_def = random.sample(REPOSITORIES_POOL, k=min(target_repos, len(REPOSITORIES_POOL)))
    repo_ids = []
    queue_ids = {}

    print("[+] Generating Repositories...")

    for r_def in selected_repos_def:
        cursor.execute("SELECT id FROM repositories WHERE path = ?", (r_def["path"],))
        row = cursor.fetchone()
        if row:
            r_id = row[0]
        else:
            cursor.execute(
                "INSERT INTO repositories (path, name, created_at) VALUES (?, ?, ?)",
                (r_def["path"], r_def["name"], now_ts - random.randint(86400 * 5, 86400 * 45))
            )
            r_id = cursor.lastrowid

            # Log Repository Added Event
            cursor.execute(
                "INSERT INTO activity_events (ts, level, repository_id, event_type, message, metadata) VALUES (?, 'info', ?, 'repo_added', ?, ?)",
                (
                    now_ts - random.randint(86400 * 5, 86400 * 45),
                    r_id,
                    f"Added repository '{r_def['name']}'",
                    json.dumps({"remote_url": r_def["remote_url"], "default_branch": r_def["default_branch"]})
                )
            )

        repo_ids.append((r_id, r_def))

        # Default Queue
        cursor.execute("SELECT id FROM queues WHERE repository_id = ?", (r_id,))
        q_row = cursor.fetchone()
        if q_row:
            q_id = q_row[0]
        else:
            cursor.execute(
                "INSERT INTO queues (repository_id, name, target_branch, execution_mode, status, created_at, updated_at) VALUES (?, 'Draft', ?, 'commit_only', 'Draft', ?, ?)",
                (r_id, r_def["default_branch"], now_ts, now_ts)
            )
            q_id = cursor.lastrowid
        queue_ids[r_id] = q_id

    # 2. Seed Commit Templates
    print("[+] Seeding Commit Templates...")
    for name, tpl in TEMPLATES:
        cursor.execute("SELECT id FROM commit_templates WHERE name = ?", (name,))
        if not cursor.fetchone():
            cursor.execute("INSERT INTO commit_templates (name, template) VALUES (?, ?)", (name, tpl))

    # 3. Draft Commits & File Assignments
    print(f"[+] Generating {target_drafts} Draft Commits...")

    statuses = ["Draft", "Scheduled", "Executing", "Completed", "Failed", "Skipped"]
    weights = [0.25, 0.35, 0.05, 0.25, 0.07, 0.03]

    now_dt = datetime.now()
    time_windows = [
        now_dt - timedelta(days=1),                     # Yesterday
        now_dt,                                         # Today
        now_dt + timedelta(days=1),                     # Tomorrow
        now_dt + timedelta(days=random.randint(2, 6)),   # This Week
        now_dt + timedelta(days=random.randint(7, 14)),  # Next Week
    ]

    items_created = 0
    for i in range(target_drafts):
        r_id, r_def = random.choice(repo_ids)
        q_id = queue_ids[r_id]
        status = random.choices(statuses, weights=weights, k=1)[0]
        author = random.choice(AUTHORS)

        type_prefix, action_desc = random.choice(COMMIT_ACTIONS)
        scope = random.choice(COMMIT_SCOPES) if random.random() > 0.4 else ""
        scope_str = f"({scope})" if scope else ""

        commit_msg = f"{type_prefix}{scope_str}: {action_desc}"
        title = commit_msg.split("\n")[0]

        target_branch = random.choice([r_def["default_branch"], "develop", "feature/auth-v2", "fix/tray-icon"])
        exec_mode = random.choice(["commit_only", "commit_and_push"])

        window_dt = random.choice(time_windows)
        hour = random.randint(9, 18)
        minute = random.choice([0, 15, 30, 45])
        scheduled_dt = window_dt.replace(hour=hour, minute=minute, second=0)
        scheduled_ts = int(scheduled_dt.timestamp())

        created_ts = scheduled_ts - random.randint(3600, 86400 * 3)
        updated_ts = scheduled_ts

        commit_hash = None
        last_error = None
        retry_count = 0
        exec_duration_ms = random.randint(150, 4200)

        if status == "Completed":
            commit_hash = generate_random_hash()
            updated_ts = scheduled_ts + random.randint(2, 180)
        elif status == "Failed":
            last_error = random.choice(FAILURES)
            retry_count = random.randint(1, 3)
            updated_ts = scheduled_ts + random.randint(5, 90)

        cursor.execute(
            """INSERT INTO queue_items (
                queue_id, title, commit_message, target_branch, execution_mode,
                scheduled_time, status, retry_count, last_error, commit_hash,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                q_id, title, commit_msg, target_branch, exec_mode,
                scheduled_ts if status != "Draft" else None,
                status, retry_count, last_error, commit_hash,
                created_ts, updated_ts
            )
        )
        item_id = cursor.lastrowid
        items_created += 1

        # Queue Item Files with random additions / deletions
        sample_files = random.sample(r_def["files"], k=random.randint(1, min(4, len(r_def["files"]))))
        for f_path in sample_files:
            c_type = random.choice(["modified", "untracked", "deleted", "renamed"])
            orig_path = f_path + ".bak" if c_type == "renamed" else None
            fingerprint = f"hash_{generate_random_hash()[:12]}"
            cursor.execute(
                "INSERT INTO queue_item_files (queue_item_id, path, original_path, change_type, fingerprint) VALUES (?, ?, ?, ?, ?)",
                (item_id, f_path, orig_path, c_type, fingerprint)
            )

        # Correlated Activity Events
        meta_dict = {
            "author_name": author["name"],
            "author_email": author["email"],
            "commit_message": commit_msg,
            "additions": random.randint(2, 120),
            "deletions": random.randint(0, 45),
            "duration_ms": exec_duration_ms
        }
        if commit_hash:
            meta_dict["commit_hash"] = commit_hash

        meta_json = json.dumps(meta_dict)

        if status == "Draft":
            cursor.execute(
                "INSERT INTO activity_events (ts, level, repository_id, queue_id, queue_item_id, event_type, message, metadata) VALUES (?, 'info', ?, ?, ?, 'draft_created', ?, ?)",
                (created_ts, r_id, q_id, item_id, f"Created draft commit: {title}", meta_json)
            )
        elif status == "Scheduled":
            cursor.execute(
                "INSERT INTO activity_events (ts, level, repository_id, queue_id, queue_item_id, event_type, message, metadata) VALUES (?, 'info', ?, ?, ?, 'commit_scheduled', ?, ?)",
                (created_ts, r_id, q_id, item_id, f"Scheduled commit '{title}' for {scheduled_dt.strftime('%b %d, %H:%M')}", meta_json)
            )
        elif status == "Completed":
            cursor.execute(
                "INSERT INTO activity_events (ts, level, repository_id, queue_id, queue_item_id, event_type, message, metadata) VALUES (?, 'info', ?, ?, ?, 'commit_executed', ?, ?)",
                (updated_ts, r_id, q_id, item_id, f"Successfully executed commit '{title}'", meta_json)
            )
        elif status == "Failed":
            cursor.execute(
                "INSERT INTO activity_events (ts, level, repository_id, queue_id, queue_item_id, event_type, message, metadata) VALUES (?, 'error', ?, ?, ?, 'execution_failed', ?, ?)",
                (updated_ts, r_id, q_id, item_id, f"Failed execution for '{title}': {last_error}", meta_json)
            )

    # 4. Settings Seeding
    print("[+] Seeding Settings...")
    settings_data = [
        ("execution_mode", "commit_only"),
        ("missed_schedule_policy", "run_immediately"),
        ("autostart", "0"),
        ("auto_update_check", "1")
    ]
    for k, v in settings_data:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, v))

    conn.commit()

    print("\n[OK] Demo Data Generation Complete!")
    print(f"   * Preset: {preset_name.upper()}")
    print(f"   * Repositories Created: {len(selected_repos_def)}")
    print(f"   * Draft Commits Created: {items_created}")
    print(f"   * Commit Templates Seeded: {len(TEMPLATES)}")
    print(f"   * Database file ready at: {db_path}\n")

    # Run Integrity Validation
    validate_database(conn)
    conn.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GitOutbox Demo Data Generator")
    parser.add_argument("--db", type=str, default=detect_db_path(), help="Path to SQLite database file")
    parser.add_argument("--preset", type=str, choices=["small", "medium", "large"], default="medium", help="Generation volume preset")
    parser.add_argument("--reset", action="store_true", help="Clear existing records before populating")
    parser.add_argument("--validate-only", action="store_true", help="Run database integrity validation without generating data")
    args = parser.parse_args()

    run_generator(args.db, preset_name=args.preset, reset=args.reset, validate_only=args.validate_only)
