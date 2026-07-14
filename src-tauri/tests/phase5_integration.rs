use gitoutbox_core::executor;
use gitoutbox_lib::{
    db::{Db, QueueItemFile},
    handle_missed_schedules,
    tick_scheduler,
    ExecutionLocks,
};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_dir(label: &str) -> PathBuf {
    let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let p = std::env::temp_dir().join(format!("gitoutbox-phase5-{label}-{n}"));
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn git(repo: &Path, args: &[&str]) -> String {
    let out = Command::new("git").args(args).current_dir(repo).output().unwrap();
    assert!(out.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn init_repo(path: &Path) {
    std::fs::create_dir_all(path).unwrap();
    git(path, &["init", "-b", "main"]);
    git(path, &["config", "user.name", "GitOutbox Test"]);
    git(path, &["config", "user.email", "gitoutbox-test@example.invalid"]);
    git(path, &["config", "commit.gpgsign", "false"]);
}

fn baseline_repo(label: &str) -> (PathBuf, PathBuf) {
    let root = unique_dir(label);
    let repo = root.join("work");
    let remote = root.join("remote.git");
    init_repo(&repo);
    std::fs::create_dir_all(&remote).unwrap();
    git(&remote, &["init", "--bare"]);
    std::fs::write(repo.join("baseline.txt"), "baseline\n").unwrap();
    git(&repo, &["add", "baseline.txt"]);
    git(&repo, &["commit", "-m", "baseline"]);
    git(&repo, &["remote", "add", "origin", remote.to_str().unwrap()]);
    git(&repo, &["push", "-u", "origin", "main"]);
    (repo, remote)
}

fn db_path(label: &str) -> PathBuf {
    unique_dir(label).join("state.sqlite")
}

fn schedule_item(db: &Db, repo: &Path, message: &str, execution_mode: &str, path: &str, scheduled_time: i64) -> (i64, i64) {
    let r = db.add_repository(repo.to_str().unwrap(), "test").unwrap();
    let id = db.create_queue_item(r.id, "main", "group", message, &[QueueItemFile {
        path: path.to_string(), original_path: None, change_type: "modified".into(),
    }]).unwrap();
    db.schedule_items_with_fingerprints(r.id, &[(id, scheduled_time)], repo.to_str().unwrap()).unwrap();
    // Override execution mode if it's not the default
    if execution_mode != "commit" {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "UPDATE queue_items SET execution_mode = ?1 WHERE id = ?2",
            (execution_mode, id),
        ).unwrap();
    }
    (r.id, id)
}

fn raw_status(db: &Db, id: i64) -> (String, Option<String>, i64, Option<i64>) {
    let conn = db.0.lock().unwrap();
    conn.query_row("SELECT status, commit_hash, retry_count, scheduled_time FROM queue_items WHERE id = ?1", [id], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
    }).unwrap()
}

#[test]
fn due_commit_only_item_executes_exactly_once() {
    let (repo, _) = baseline_repo("due-commit-only");
    let path = db_path("due-commit-only-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
    // Schedule in the past so it's due
    let (_rid, id) = schedule_item(&db, &repo, "feat: a", "commit", "a.txt", 1000);
    db.set_execution_mode("commit_only").unwrap();

    // Execute first tick
    tick_scheduler(&db, &locks, None);
    let (status, hash, _, _) = raw_status(&db, id);
    assert_eq!(status, "Completed");
    assert!(hash.is_some());

    // Modify a.txt again to see if it executes again on next tick (it should NOT, because status is Completed)
    std::fs::write(repo.join("a.txt"), "changed again\n").unwrap();
    tick_scheduler(&db, &locks, None);
    let (status2, hash2, _, _) = raw_status(&db, id);
    assert_eq!(status2, "Completed");
    assert_eq!(hash, hash2);
}

#[test]
fn future_item_does_not_execute_early() {
    let (repo, _) = baseline_repo("future-item");
    let path = db_path("future-item-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
    // Schedule way in the future
    let far_future = gitoutbox_lib::now_secs() + 10000;
    let (_rid, id) = schedule_item(&db, &repo, "feat: future", "commit", "a.txt", far_future);
    db.set_execution_mode("commit_only").unwrap();

    tick_scheduler(&db, &locks, None);
    let (status, hash, _, _) = raw_status(&db, id);
    assert_eq!(status, "Scheduled");
    assert!(hash.is_none());
}

#[test]
fn missed_schedule_policy_skip() {
    let (repo, _) = baseline_repo("ms-skip");
    let path = db_path("ms-skip-db");
    let db = Db::open(&path).unwrap();
    
    db.set_missed_schedule_policy("skip").unwrap();
    let (_rid, id) = schedule_item(&db, &repo, "feat: skip", "commit", "a.txt", 1000);

    handle_missed_schedules(&db, None);
    let (status, _, _, _) = raw_status(&db, id);
    assert_eq!(status, "Skipped");
}

#[test]
fn missed_schedule_policy_ask() {
    let (repo, _) = baseline_repo("ms-ask");
    let path = db_path("ms-ask-db");
    let db = Db::open(&path).unwrap();
    
    db.set_missed_schedule_policy("ask").unwrap();
    let (_rid, id) = schedule_item(&db, &repo, "feat: ask", "commit", "a.txt", 1000);

    handle_missed_schedules(&db, None);
    let (status, _, _, _) = raw_status(&db, id);
    assert_eq!(status, "Paused");
    
    // Ensure the last error notes the missed schedule
    let conn = db.0.lock().unwrap();
    let err: String = conn.query_row("SELECT last_error FROM queue_items WHERE id = ?1", [id], |r| r.get(0)).unwrap();
    assert!(err.contains("MISSED_SCHEDULE"));
}

#[test]
fn missed_schedule_policy_redistribute() {
    let (repo, _) = baseline_repo("ms-redistribute");
    let path = db_path("ms-redistribute-db");
    let db = Db::open(&path).unwrap();
    
    db.set_missed_schedule_policy("redistribute").unwrap();
    let (_rid, id1) = schedule_item(&db, &repo, "feat: red1", "commit", "a.txt", 1000);
    let (_rid, id2) = schedule_item(&db, &repo, "feat: red2", "commit", "b.txt", 1100);

    handle_missed_schedules(&db, None);

    let (_, _, _, time1) = raw_status(&db, id1);
    let (_, _, _, time2) = raw_status(&db, id2);
    let now = gitoutbox_lib::now_secs();
    
    // Times should be shifted into the future, and relative gap (100 seconds) preserved
    assert!(time1.unwrap() >= now + 50);
    assert_eq!(time2.unwrap() - time1.unwrap(), 100);
}

#[test]
fn fingerprint_mismatch_pauses_without_committing() {
    let (repo, _) = baseline_repo("fingerprint-mismatch");
    let path = db_path("fingerprint-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
    let (_rid, id) = schedule_item(&db, &repo, "feat: mismatch", "commit", "a.txt", 1000);
    db.set_execution_mode("commit_only").unwrap();

    // Modify a.txt outside GitOutbox to cause fingerprint mismatch
    std::fs::write(repo.join("a.txt"), "tampered content\n").unwrap();

    tick_scheduler(&db, &locks, None);
    let (status, hash, _, _) = raw_status(&db, id);
    assert_eq!(status, "Paused");
    assert!(hash.is_none());
}

#[test]
fn branch_mismatch_pauses_without_committing() {
    let (repo, _) = baseline_repo("branch-mismatch");
    let path = db_path("branch-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
    let (_rid, id) = schedule_item(&db, &repo, "feat: mismatch", "commit", "a.txt", 1000);
    db.set_execution_mode("commit_only").unwrap();

    // Switch branch to something else
    git(&repo, &["checkout", "-b", "other-branch"]);

    tick_scheduler(&db, &locks, None);
    let (status, hash, _, _) = raw_status(&db, id);
    assert_eq!(status, "Paused");
    assert!(hash.is_none());
}

#[test]
fn two_due_items_execute_sequentially_without_duplication() {
    let (repo, _) = baseline_repo("two-due");
    let path = db_path("two-due-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo.join("a.txt"), "changed a\n").unwrap();
    std::fs::write(repo.join("b.txt"), "changed b\n").unwrap();

    let (_rid, id1) = schedule_item(&db, &repo, "feat: a", "commit", "a.txt", 1000);
    let (_rid, id2) = schedule_item(&db, &repo, "feat: b", "commit", "b.txt", 1001);
    db.set_execution_mode("commit_only").unwrap();

    tick_scheduler(&db, &locks, None);

    let (status1, hash1, _, _) = raw_status(&db, id1);
    let (status2, hash2, _, _) = raw_status(&db, id2);
    assert_eq!(status1, "Completed");
    assert_eq!(status2, "Completed");
    assert!(hash1.is_some());
    assert!(hash2.is_some());
    assert_ne!(hash1, hash2);
}

#[test]
fn multiple_repositories_execute_independently() {
    let (repo1, _) = baseline_repo("multi-repo1");
    let (repo2, _) = baseline_repo("multi-repo2");
    let path = db_path("multi-repo-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo1.join("a.txt"), "changed a\n").unwrap();
    std::fs::write(repo2.join("b.txt"), "changed b\n").unwrap();

    let (_rid1, id1) = schedule_item(&db, &repo1, "feat: a", "commit", "a.txt", 1000);
    let (_rid2, id2) = schedule_item(&db, &repo2, "feat: b", "commit", "b.txt", 1001);
    db.set_execution_mode("commit_only").unwrap();

    tick_scheduler(&db, &locks, None);

    let (status1, hash1, _, _) = raw_status(&db, id1);
    let (status2, hash2, _, _) = raw_status(&db, id2);
    assert_eq!(status1, "Completed");
    assert_eq!(status2, "Completed");
    assert!(hash1.is_some());
    assert!(hash2.is_some());
}

#[test]
fn commit_and_push_uses_push_semantics() {
    let (repo, remote) = baseline_repo("commit-push");
    let path = db_path("commit-push-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo.join("a.txt"), "changed a\n").unwrap();
    let (_rid, id) = schedule_item(&db, &repo, "feat: a", "commit_and_push", "a.txt", 1000);

    tick_scheduler(&db, &locks, None);

    let events = db.list_activity_events(100).unwrap();
    println!("--- EVENTS ---");
    for e in events {
        println!("[{}] {} (item: {:?})", e.level, e.message, e.queue_item_id);
    }

    let (status, hash, _, _) = raw_status(&db, id);
    assert_eq!(status, "Completed");
    assert!(hash.is_some());

    // Check remote got the commit
    let remote_head = git(&remote, &["rev-parse", "main"]);
    assert_eq!(remote_head, hash.unwrap());
}

#[test]
fn push_at_end_batch_commits_all_then_pushes() {
    let (repo, remote) = baseline_repo("push-at-end");
    let path = db_path("push-at-end-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo.join("a.txt"), "changed a\n").unwrap();
    std::fs::write(repo.join("b.txt"), "changed b\n").unwrap();

    let (_rid, id1) = schedule_item(&db, &repo, "feat: a", "push_at_end", "a.txt", 1000);
    let (_rid, id2) = schedule_item(&db, &repo, "feat: b", "push_at_end", "b.txt", 1001);

    tick_scheduler(&db, &locks, None);

    let (status1, _hash1, _, _) = raw_status(&db, id1);
    let (status2, hash2, _, _) = raw_status(&db, id2);
    assert_eq!(status1, "Completed");
    assert_eq!(status2, "Completed");

    // Remote HEAD must match the second commit hash
    let remote_head = git(&remote, &["rev-parse", "main"]);
    assert_eq!(remote_head, hash2.unwrap());
}

#[test]
fn restart_reconciliation_before_tick() {
    let (repo, _) = baseline_repo("restart-recon");
    let path = db_path("restart-recon-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo.join("a.txt"), "changed a\n").unwrap();
    let (_rid, id) = schedule_item(&db, &repo, "feat: recon", "commit_only", "a.txt", 1000);

    // Simulate crash in the middle of execution:
    let head = executor::get_head_hash(&repo).unwrap();
    db.begin_execution(id).unwrap();
    db.persist_pre_commit_head(id, &head).unwrap();

    // Re-open DB and run reconciliation
    let db2 = Db::open(&path).unwrap();
    let reconciled = db2.reconcile_all_on_startup().unwrap();
    assert_eq!(reconciled, vec![(id, "Scheduled".into())]);

    // Tick scheduler
    tick_scheduler(&db2, &locks, None);
    let (status, hash, _, _) = raw_status(&db2, id);
    assert_eq!(status, "Completed");
    assert!(hash.is_some());
}

#[test]
fn push_pending_is_not_recommitted_but_retried() {
    let (repo, remote) = baseline_repo("push-pending-retry");
    let path = db_path("push-pending-retry-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo.join("a.txt"), "changed a\n").unwrap();
    let (_rid, id) = schedule_item(&db, &repo, "feat: a", "commit_and_push", "a.txt", 1000);

    // Cause a push failure by installing a reject hook on remote
    let remote_hooks = remote.join("hooks");
    std::fs::create_dir_all(&remote_hooks).unwrap();
    std::fs::write(remote_hooks.join("pre-receive"), "#!/bin/sh\nexit 1\n").unwrap();

    tick_scheduler(&db, &locks, None);
 
    let (status, hash, retry_count, _) = raw_status(&db, id);
    assert_eq!(status, "PushPending");
    assert!(hash.is_some());
    assert_eq!(retry_count, 0); // Initial push failure does not increment retry_count
 
    // Tick again with push still failing (triggers first retry)
    {
        let conn = db.0.lock().unwrap();
        conn.execute("UPDATE queue_items SET updated_at = 0 WHERE id = ?1", [id]).unwrap();
    }
    tick_scheduler(&db, &locks, None);
    let (status_retry, _, retry_count_retry, _) = raw_status(&db, id);
    assert_eq!(status_retry, "PushPending");
    assert_eq!(retry_count_retry, 1);
 
    // Remove reject hook
    let _ = std::fs::remove_file(remote_hooks.join("pre-receive"));
 
    // Tick again (needs backoff override or we simulate elapsed time)
    // To bypass the 30-second backoff in tests, we can manually reset the updated_at timestamp in SQLite.
    {
        let conn = db.0.lock().unwrap();
        conn.execute("UPDATE queue_items SET updated_at = 0 WHERE id = ?1", [id]).unwrap();
    }
 
    tick_scheduler(&db, &locks, None);
 
    let (status2, hash2, _, _) = raw_status(&db, id);
    assert_eq!(status2, "Completed");
    assert_eq!(hash, hash2); // Verify NO new commit was created!
}
 
#[test]
fn removed_repository_does_not_execute() {
    let (repo, _) = baseline_repo("removed-repo");
    let path = db_path("removed-repo-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();
 
    std::fs::write(repo.join("a.txt"), "changed a\n").unwrap();
    let (rid, id) = schedule_item(&db, &repo, "feat: a", "commit", "a.txt", 1000);
    db.set_execution_mode("commit_only").unwrap();
 
    // Remove repository from DB
    db.remove_repository(rid).unwrap();
 
    tick_scheduler(&db, &locks, None);
 
    // The item should be deleted from DB due to ON DELETE CASCADE
    let conn = db.0.lock().unwrap();
    let res = conn.query_row("SELECT id FROM queue_items WHERE id = ?1", [id], |_| Ok(()));
    assert!(matches!(res, Err(rusqlite::Error::QueryReturnedNoRows)));
}

#[test]
fn push_at_end_semantics_deferred_push() {
    let (repo, remote) = baseline_repo("push-at-end-defer");
    let path = db_path("push-at-end-defer-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo.join("a.txt"), "changed a\n").unwrap();
    std::fs::write(repo.join("b.txt"), "changed b\n").unwrap();

    let (_rid, id1) = schedule_item(&db, &repo, "feat: a", "push_at_end", "a.txt", 1000);
    let (_rid, id2) = schedule_item(&db, &repo, "feat: b", "push_at_end", "b.txt", 1200);

    // 1. Tick at 1050 (first item due, second item NOT due)
    {
        let conn = db.0.lock().unwrap();
        // Set scheduled_time of id2 to far future
        conn.execute("UPDATE queue_items SET scheduled_time = 2000000000 WHERE id = ?1", [id2]).unwrap();
    }

    tick_scheduler(&db, &locks, None);

    let (status1, hash1, _, _) = raw_status(&db, id1);
    let (status2, hash2, _, _) = raw_status(&db, id2);
    // First item is PushPending (committed but push is deferred)
    assert_eq!(status1, "PushPending");
    assert!(hash1.is_some());
    // Second item remains Scheduled
    assert_eq!(status2, "Scheduled");
    assert!(hash2.is_none());

    // Remote HEAD must not have the first commit (it wasn't pushed yet!)
    let remote_head = git(&remote, &["rev-parse", "main"]);
    assert_ne!(remote_head, hash1.clone().unwrap());

    // 2. Tick at 2_000_000_100 (both items due)
    {
        let conn = db.0.lock().unwrap();
        // Set scheduled_time of id2 to 1001 (so both are due now)
        conn.execute("UPDATE queue_items SET scheduled_time = 1001 WHERE id = ?1", [id2]).unwrap();
    }

    tick_scheduler(&db, &locks, None);

    let (status1_after, _hash1_after, _, _) = raw_status(&db, id1);
    let (status2_after, hash2_after, _, _) = raw_status(&db, id2);
    // After first tick, id1 completes its push retry, but id2 is not executed yet
    assert_eq!(status1_after, "Completed");
    assert_eq!(status2_after, "Scheduled");
    assert!(hash2_after.is_none());

    // 3. Tick again (id2 is now executed and pushed)
    tick_scheduler(&db, &locks, None);

    let (status1_final, _, _, _) = raw_status(&db, id1);
    let (status2_final, hash2_final, _, _) = raw_status(&db, id2);
    assert_eq!(status1_final, "Completed");
    assert_eq!(status2_final, "Completed");
    assert!(hash2_final.is_some());

    // Remote HEAD must now match the second commit hash (both pushed!)
    let remote_head_after = git(&remote, &["rev-parse", "main"]);
    assert_eq!(remote_head_after, hash2_final.unwrap());
}

#[test]
fn edit_scheduled_item_recaptures_fingerprints() {
    let (repo, _) = baseline_repo("edit-scheduled");
    let path = db_path("edit-scheduled-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo.join("a.txt"), "changed a\n").unwrap();
    let (_rid, id) = schedule_item(&db, &repo, "feat: original", "commit_only", "a.txt", 1000);

    // Initial fingerprint should be present
    let orig_fps = db.get_item_fingerprints(id).unwrap();
    assert!(orig_fps[0].is_some());

    // Modify a.txt and update the scheduled item
    std::fs::write(repo.join("a.txt"), "changed again\n").unwrap();
    let files = vec![QueueItemFile {
        path: "a.txt".to_string(),
        original_path: None,
        change_type: "modified".to_string(),
    }];
    db.update_queue_item_full(id, "feat: modified message", "main", &files).unwrap();

    // Verify fingerprints were updated/recaptured
    let new_fps = db.get_item_fingerprints(id).unwrap();
    assert!(new_fps[0].is_some());
    assert_ne!(orig_fps[0], new_fps[0]);

    // Tick scheduler and verify it executes successfully with no fingerprint errors
    tick_scheduler(&db, &locks, None);
    let (status, hash, _, _) = raw_status(&db, id);
    assert_eq!(status, "Completed");
    assert!(hash.is_some());
}

#[test]
fn file_ownership_active_statuses() {
    let (repo, _) = baseline_repo("file-ownership-active");
    let path = db_path("file-ownership-active-db");
    let db = Db::open(&path).unwrap();

    let r = db.add_repository(repo.to_str().unwrap(), "test").unwrap();
    let files = vec![QueueItemFile {
        path: "a.txt".to_string(),
        original_path: None,
        change_type: "modified".to_string(),
    }];
    let id1 = db.create_queue_item(r.id, "main", "group", "feat: first", &files).unwrap();

    // Change status of first item to Paused, Running, then PushPending and verify second item creation is rejected!
    for status in &["Paused", "Running", "PushPending"] {
        {
            let conn = db.0.lock().unwrap();
            conn.execute(
                "UPDATE queue_items SET status = ?1 WHERE id = ?2",
                (status, id1),
            ).unwrap();
        }
        let res = db.create_queue_item(r.id, "main", "group", "feat: second", &files);
        assert!(res.is_err(), "Creation of duplicate file assignment should fail when first item is {}", status);
    }
}

#[test]
fn fingerprint_mismatch_aborts_commit_and_unstages() {
    let (repo, _) = baseline_repo("fingerprint-mismatch");
    let path = db_path("fingerprint-mismatch-db");
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();

    std::fs::write(repo.join("a.txt"), "original content\n").unwrap();
    let (_rid, id) = schedule_item(&db, &repo, "feat: a", "commit_only", "a.txt", 1000);

    // Change the file content in the worktree
    std::fs::write(repo.join("a.txt"), "raced content change\n").unwrap();

    tick_scheduler(&db, &locks, None);

    let (status, hash, _, _) = raw_status(&db, id);
    assert_eq!(status, "Paused");
    assert!(hash.is_none());

    let status_output = git(&repo, &["status", "--porcelain"]);
    assert!(status_output.contains("a.txt"));
}



