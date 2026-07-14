//! End-to-end Phase 2 test: inspect a *real* temporary repo, turn its detected
//! changes into a commit group, and prove it persists durably. Uses the same
//! `gitoutbox_core` + `Db` path the Tauri commands use.

use std::path::Path;
use std::process::Command;

use gitoutbox_lib::db::{Db, QueueItemFile};
use gitoutbox_core::{get_status, inspect_repository};

fn temp_repo(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "gitoutbox-ph2-{}-{}-{}",
        tag,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    git(&dir, &["init", "-b", "main"]);
    git(&dir, &["config", "user.name", "Tester"]);
    git(&dir, &["config", "user.email", "t@example.com"]);
    git(&dir, &["config", "commit.gpgsign", "false"]);
    dir
}

fn git(dir: &Path, args: &[&str]) {
    let s = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git available");
    assert!(s.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&s.stderr));
}

fn db() -> Db {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    gitoutbox_lib::db::migrate_test(&c);
    Db(std::sync::Arc::new(std::sync::Mutex::new(c)))
}

#[test]
fn inspect_then_persist_commit_group() {
    let repo = temp_repo("e2e");
    std::fs::write(repo.join("a.rs"), "fn a() {}\n").unwrap();
    std::fs::write(repo.join("b.rs"), "fn b() {}\n").unwrap();
    // Establish an initial commit so HEAD is a real branch (unborn HEAD has no
    // branch name yet — realistic repos have history).
    git(&repo, &["add", "-A"]);
    git(&repo, &["commit", "-m", "init"]);
    // Now introduce changes to group (modified + new untracked).
    std::fs::write(repo.join("a.rs"), "fn a() { return 1; }\n").unwrap();
    std::fs::write(repo.join("c.rs"), "fn c() {}\n").unwrap();

    // 1) inspect a real repo
    let info = inspect_repository(&repo).expect("work tree");
    assert_eq!(info.current_branch.as_deref(), Some("main"));

    // 2) detect changes via the real Git CLI
    let changes = get_status(&repo).expect("status");
    assert_eq!(changes.len(), 2);

    // 3) persist them as one multi-file commit group
    let files: Vec<QueueItemFile> = changes
        .iter()
        .map(|c| QueueItemFile {
            path: c.path.clone(),
            original_path: c.original_path.clone(),
            change_type: match c.change_type {
                gitoutbox_core::ChangeType::Untracked => "untracked",
                gitoutbox_core::ChangeType::Modified => "modified",
                gitoutbox_core::ChangeType::Deleted => "deleted",
                gitoutbox_core::ChangeType::Renamed => "renamed",
            }
            .to_string(),
        })
        .collect();

    let store = db();
    let repo_id = store.add_repository(repo.to_str().unwrap(), "e2e").unwrap().id;
    let item_id = store
        .create_queue_item(repo_id, "main", "Add a and b", "feat: add modules", &files)
        .unwrap();

    // 4) prove durable persistence (new read, real data)
    let items = store.list_queue_items(repo_id).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, item_id);
    assert_eq!(items[0].commit_message, "feat: add modules");
    assert_eq!(items[0].status, "Draft");
    assert_eq!(items[0].files.len(), 2);
    assert!(items[0].files.iter().any(|f| f.path == "c.rs" && f.change_type == "untracked"));
    assert!(items[0].files.iter().any(|f| f.path == "a.rs" && f.change_type == "modified"));
}

