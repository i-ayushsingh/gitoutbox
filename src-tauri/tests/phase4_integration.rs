use gitoutbox_core::executor;
use gitoutbox_lib::{db::{Db, QueueItemFile}, execution, ExecutionLocks};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_dir(label: &str) -> PathBuf {
    let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let p = std::env::temp_dir().join(format!("gitoutbox-phase4-{label}-{n}"));
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

fn schedule_one(db: &Db, repo: &Path, message: &str, mode: &str, path: &str) -> (i64, i64) {
    db.set_execution_mode(mode).unwrap();
    let r = db.add_repository(repo.to_str().unwrap(), "test").unwrap();
    let id = db.create_queue_item(r.id, "main", "group", message, &[QueueItemFile {
        path: path.to_string(), original_path: None, change_type: "modified".into(),
    }]).unwrap();
    db.schedule_items_with_fingerprints(r.id, &[(id, 1000)], repo.to_str().unwrap()).unwrap();
    (r.id, id)
}

fn raw_status(db: &Db, id: i64) -> (String, Option<String>, i64) {
    let conn = db.0.lock().unwrap();
    conn.query_row("SELECT status, commit_hash, retry_count FROM queue_items WHERE id = ?1", [id], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?))
    }).unwrap()
}

fn hook_path(remote: &Path, name: &str) -> PathBuf { remote.join("hooks").join(name) }

fn install_post_receive_counter(remote: &Path, counter: &Path) {
    let p = counter.to_string_lossy().replace('\\', "/");
    std::fs::write(hook_path(remote, "post-receive"), format!("#!/bin/sh\necho 1 >> '{}'\n", p)).unwrap();
}

fn install_reject_hook(remote: &Path) {
    std::fs::write(hook_path(remote, "pre-receive"), "#!/bin/sh\nexit 1\n").unwrap();
}

fn remove_hook(remote: &Path, name: &str) { let _ = std::fs::remove_file(hook_path(remote, name)); }

#[test]
fn crash_before_commit_reopens_and_returns_to_safe_retry_state() {
    let (repo, _) = baseline_repo("crash-before");
    let path = db_path("crash-before-db");
    std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
    let (rid, id) = {
        let db = Db::open(&path).unwrap();
        schedule_one(&db, &repo, "feat: before", "commit_only", "a.txt")
    };
    let before = {
        let db = Db::open(&path).unwrap();
        let head = executor::get_head_hash(&repo).unwrap();
        db.begin_execution(id).unwrap();
        db.persist_pre_commit_head(id, &head).unwrap();
        head
    };
    let db = Db::open(&path).unwrap();
    let result = db.reconcile_all_on_startup().unwrap();
    assert_eq!(result, vec![(id, "Scheduled".into())]);
    assert_eq!(executor::get_head_hash(&repo).unwrap(), before);
    assert_eq!(raw_status(&db, id).0, "Scheduled");
    assert_eq!(db.get_queue_item_repo_id(id).unwrap(), rid);
}

#[test]
fn commit_succeeded_hash_missing_is_attributed_after_reopen() {
    let (repo, _) = baseline_repo("crash-after-commit");
    let path = db_path("crash-after-commit-db");
    std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
    let (_, id) = {
        let db = Db::open(&path).unwrap();
        schedule_one(&db, &repo, "feat: multiline\n\nbody", "commit_only", "a.txt")
    };
    let pre = executor::get_head_hash(&repo).unwrap();
    {
        let db = Db::open(&path).unwrap();
        db.begin_execution(id).unwrap();
        db.persist_pre_commit_head(id, &pre).unwrap();
    }
    executor::stage_assigned_paths(&repo, &["a.txt".into()]).unwrap();
    let hash = executor::create_commit(&repo, "feat: multiline\n\nbody").unwrap();
    let reopened = Db::open(&path).unwrap();
    assert_eq!(reopened.reconcile_all_on_startup().unwrap(), vec![(id, "Completed".into())]);
    let (status, persisted, _) = raw_status(&reopened, id);
    assert_eq!(status, "Completed");
    assert_eq!(persisted.as_deref(), Some(hash.as_str()));
    assert_eq!(executor::get_head_hash(&repo).unwrap(), hash);
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "2");
}

#[test]
fn push_required_crash_recovery_becomes_push_pending_without_recommit() {
    let (repo, _) = baseline_repo("crash-push");
    let path = db_path("crash-push-db");
    std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
    let (_, id) = { let db = Db::open(&path).unwrap(); schedule_one(&db, &repo, "feat: push", "commit_and_push", "a.txt") };
    let pre = executor::get_head_hash(&repo).unwrap();
    { let db = Db::open(&path).unwrap(); db.begin_execution(id).unwrap(); db.persist_pre_commit_head(id, &pre).unwrap(); }
    executor::stage_assigned_paths(&repo, &["a.txt".into()]).unwrap();
    let hash = executor::create_commit(&repo, "feat: push").unwrap();
    let reopened = Db::open(&path).unwrap();
    assert_eq!(reopened.reconcile_all_on_startup().unwrap(), vec![(id, "PushPending".into())]);
    assert_eq!(raw_status(&reopened, id).1.as_deref(), Some(hash.as_str()));
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "2");
}

#[test]
fn unrelated_head_is_ambiguous_and_never_recommitted() {
    let (repo, _) = baseline_repo("ambiguous");
    let path = db_path("ambiguous-db");
    std::fs::write(repo.join("a.txt"), "assigned\n").unwrap();
    let (_, id) = { let db = Db::open(&path).unwrap(); schedule_one(&db, &repo, "feat: assigned", "commit_only", "a.txt") };
    let pre = executor::get_head_hash(&repo).unwrap();
    { let db = Db::open(&path).unwrap(); db.begin_execution(id).unwrap(); db.persist_pre_commit_head(id, &pre).unwrap(); }
    std::fs::write(repo.join("unrelated.txt"), "other\n").unwrap();
    git(&repo, &["add", "unrelated.txt"]);
    git(&repo, &["commit", "-m", "unrelated"]);
    let reopened = Db::open(&path).unwrap();
    reopened.reconcile_all_on_startup().unwrap();
    let item = reopened.get_queue_item(id).unwrap();
    assert_eq!(item.status, "Paused");
    let conn = reopened.0.lock().unwrap();
    let err: String = conn.query_row("SELECT last_error FROM queue_items WHERE id = ?1", [id], |r| r.get(0)).unwrap();
    assert!(err.contains("RECOVERY_AMBIGUOUS"));
}

#[test]
fn push_at_end_real_remote_has_three_commits_and_one_push() {
    let (repo, remote) = baseline_repo("push-at-end");
    let counter = repo.parent().unwrap().join("push-count");
    install_post_receive_counter(&remote, &counter);
    let path = db_path("push-at-end-db");
    let mut ids = Vec::new();
    {
        let db = Db::open(&path).unwrap();
        db.set_execution_mode("push_at_end").unwrap();
        let r = db.add_repository(repo.to_str().unwrap(), "test").unwrap();
        for i in 1..=3 {
            let file = format!("file{i}.txt");
            std::fs::write(repo.join(&file), format!("change {i}\n")).unwrap();
            ids.push(db.create_queue_item(r.id, "main", &format!("g{i}"), &format!("feat: file {i}"), &[QueueItemFile {
                path: file, original_path: None, change_type: "modified".into(),
            }]).unwrap());
        }
        db.schedule_items_with_fingerprints(r.id, &ids.iter().map(|id| (*id, 1000 + *id)).collect::<Vec<_>>(), repo.to_str().unwrap()).unwrap();
        let result = execution::execute_batch(&db, &ExecutionLocks::new(), &ids, repo.to_str().unwrap()).unwrap();
        assert_eq!(result.len(), 3);
        assert!(ids.iter().all(|id| db.get_queue_item(*id).unwrap().status == "Completed"));
        assert_eq!(result.iter().map(|(_, h)| h).collect::<std::collections::HashSet<_>>().len(), 3);
    }
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "4");
    assert_eq!(std::fs::read_to_string(&counter).unwrap().lines().count(), 1);
    let db = Db::open(&path).unwrap();
    assert!(execution::execute_batch(&db, &ExecutionLocks::new(), &ids, repo.to_str().unwrap()).is_err());
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "4");
    assert_eq!(std::fs::read_to_string(&counter).unwrap().lines().count(), 1);
}

#[test]
fn push_failure_is_push_pending_then_push_only_retry() {
    let (repo, remote) = baseline_repo("push-retry");
    install_reject_hook(&remote);
    let path = db_path("push-retry-db");
    std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
    let (_, id) = { let db = Db::open(&path).unwrap(); schedule_one(&db, &repo, "feat: retry", "commit_and_push", "a.txt") };
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();
    assert!(execution::execute_item(&db, &locks, id, repo.to_str().unwrap()).is_err());
    let (status, hash, _) = raw_status(&db, id);
    assert_eq!(status, "PushPending");
    let hash = hash.unwrap();
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "2");
    remove_hook(&remote, "pre-receive");
    assert_eq!(execution::execute_item(&db, &locks, id, repo.to_str().unwrap()).unwrap(), hash);
    assert_eq!(raw_status(&db, id).0, "Completed");
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "2");
    assert_eq!(git(&remote, &["rev-list", "--count", "main"]), "2");
}

#[test]
fn push_retry_exhaustion_pauses_with_persisted_retry_count() {
    let (repo, remote) = baseline_repo("push-exhaust");
    install_reject_hook(&remote);
    let path = db_path("push-exhaust-db");
    std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
    let (_, id) = { let db = Db::open(&path).unwrap(); schedule_one(&db, &repo, "feat: exhausted", "commit_and_push", "a.txt") };
    let db = Db::open(&path).unwrap();
    let locks = ExecutionLocks::new();
    assert!(execution::execute_item(&db, &locks, id, repo.to_str().unwrap()).is_err());
    for _ in 0..3 { assert!(execution::execute_item(&db, &locks, id, repo.to_str().unwrap()).is_err()); }
    let (status, _, retries) = raw_status(&db, id);
    assert_eq!(status, "Paused");
    assert_eq!(retries, 3);
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "2");
}

#[test]
fn pre_commit_evidence_persistence_failure_blocks_commit() {
    let (repo, _) = baseline_repo("prehead-fail");
    let path = db_path("prehead-fail-db");
    std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
    let (_, id) = { let db = Db::open(&path).unwrap(); schedule_one(&db, &repo, "feat: evidence", "commit_only", "a.txt") };
    let db = Db::open(&path).unwrap();
    db.begin_execution(id).unwrap();
    db.0.lock().unwrap().pragma_update(None, "query_only", "ON").unwrap();
    assert!(execution::execute_item(&db, &ExecutionLocks::new(), id, repo.to_str().unwrap()).is_err());
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "1");
}

#[test]
fn item_and_batch_share_branch_preflight_and_repository_identity_gate() {
    let (repo, other) = baseline_repo("preflight-parity");
    let path = db_path("preflight-parity-db");
    std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
    let (_, id) = { let db = Db::open(&path).unwrap(); schedule_one(&db, &repo, "feat: parity", "push_at_end", "a.txt") };
    let db = Db::open(&path).unwrap();
    assert!(execution::execute_item(&db, &ExecutionLocks::new(), id, other.to_str().unwrap()).is_err());
    assert_eq!(db.get_queue_item(id).unwrap().status, "Paused");
    db.retry_execution(id).unwrap();
    git(&repo, &["checkout", "-b", "wrong"]);
    assert!(execution::execute_batch(&db, &ExecutionLocks::new(), &[id], repo.to_str().unwrap()).is_err());
    assert_eq!(db.get_queue_item(id).unwrap().status, "Paused");
}

#[test]
fn execution_paths_contain_no_broad_reset_cleanup() {
    let source = include_str!("../src/execution.rs");
    let commands = include_str!("../src/commands.rs");
    assert!(!source.contains("reset_index_to_head"));
    assert!(!source.contains("git reset"));
    assert!(!commands.contains("reset_index_to_head"));
    assert!(!commands.contains("git reset"));
}

#[test]
fn verify_staged_fingerprints_e2e_untracked() {
    let (repo, _) = baseline_repo("e2e-untracked");
    let path = db_path("e2e-untracked-db");
    let db = Db::open(&path).unwrap();
    db.set_execution_mode("commit_only").unwrap();
    let r = db.add_repository(repo.to_str().unwrap(), "test").unwrap();

    std::fs::write(repo.join("new.txt"), "untracked content\n").unwrap();

    let id = db.create_queue_item(r.id, "main", "group", "feat: add untracked", &[QueueItemFile {
        path: "new.txt".to_string(), original_path: None, change_type: "untracked".into(),
    }]).unwrap();

    db.schedule_items_with_fingerprints(r.id, &[(id, 1000)], repo.to_str().unwrap()).unwrap();
    
    let locks = ExecutionLocks::new();
    let commit_hash = execution::execute_item(&db, &locks, id, repo.to_str().unwrap()).unwrap();
    
    assert!(!commit_hash.is_empty());
    assert_eq!(raw_status(&db, id).0, "Completed");
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "2");
}

#[test]
fn verify_staged_fingerprints_e2e_modified() {
    let (repo, _) = baseline_repo("e2e-modified");
    let path = db_path("e2e-modified-db");
    let db = Db::open(&path).unwrap();
    db.set_execution_mode("commit_only").unwrap();
    let r = db.add_repository(repo.to_str().unwrap(), "test").unwrap();

    std::fs::write(repo.join("baseline.txt"), "modified baseline\n").unwrap();

    let id = db.create_queue_item(r.id, "main", "group", "feat: modify file", &[QueueItemFile {
        path: "baseline.txt".to_string(), original_path: None, change_type: "modified".into(),
    }]).unwrap();

    db.schedule_items_with_fingerprints(r.id, &[(id, 1000)], repo.to_str().unwrap()).unwrap();
    
    let locks = ExecutionLocks::new();
    let commit_hash = execution::execute_item(&db, &locks, id, repo.to_str().unwrap()).unwrap();
    
    assert!(!commit_hash.is_empty());
    assert_eq!(raw_status(&db, id).0, "Completed");
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "2");
}

#[test]
fn verify_staged_fingerprints_e2e_deleted() {
    let (repo, _) = baseline_repo("e2e-deleted");
    let path = db_path("e2e-deleted-db");
    let db = Db::open(&path).unwrap();
    db.set_execution_mode("commit_only").unwrap();
    let r = db.add_repository(repo.to_str().unwrap(), "test").unwrap();

    std::fs::remove_file(repo.join("baseline.txt")).unwrap();

    let id = db.create_queue_item(r.id, "main", "group", "feat: delete file", &[QueueItemFile {
        path: "baseline.txt".to_string(), original_path: None, change_type: "deleted".into(),
    }]).unwrap();

    db.schedule_items_with_fingerprints(r.id, &[(id, 1000)], repo.to_str().unwrap()).unwrap();
    
    let locks = ExecutionLocks::new();
    let commit_hash = execution::execute_item(&db, &locks, id, repo.to_str().unwrap()).unwrap();
    
    assert!(!commit_hash.is_empty());
    assert_eq!(raw_status(&db, id).0, "Completed");
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "2");
}

#[test]
fn verify_staged_fingerprints_e2e_renamed() {
    let (repo, _) = baseline_repo("e2e-renamed");
    let path = db_path("e2e-renamed-db");
    let db = Db::open(&path).unwrap();
    db.set_execution_mode("commit_only").unwrap();
    let r = db.add_repository(repo.to_str().unwrap(), "test").unwrap();

    std::fs::rename(repo.join("baseline.txt"), repo.join("renamed.txt")).unwrap();

    let id = db.create_queue_item(r.id, "main", "group", "feat: rename file", &[QueueItemFile {
        path: "renamed.txt".to_string(), original_path: Some("baseline.txt".to_string()), change_type: "renamed".into(),
    }]).unwrap();

    db.schedule_items_with_fingerprints(r.id, &[(id, 1000)], repo.to_str().unwrap()).unwrap();
    
    let locks = ExecutionLocks::new();
    let commit_hash = execution::execute_item(&db, &locks, id, repo.to_str().unwrap()).unwrap();
    
    assert!(!commit_hash.is_empty());
    assert_eq!(raw_status(&db, id).0, "Completed");
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "2");
}

#[test]
fn verify_multiple_new_files_manual_regression() {
    let (repo, _) = baseline_repo("manual-regression");
    let path = db_path("manual-regression-db");
    let db = Db::open(&path).unwrap();
    db.set_execution_mode("commit_only").unwrap();
    let r = db.add_repository(repo.to_str().unwrap(), "test").unwrap();

    // Create multiple newly-added files
    std::fs::write(repo.join("file_a.txt"), "content a\n").unwrap();
    std::fs::write(repo.join("file_b.txt"), "content b\n").unwrap();

    // Schedule them in one item
    let id = db.create_queue_item(r.id, "main", "group", "feat: add multiple files", &[
        QueueItemFile { path: "file_a.txt".to_string(), original_path: None, change_type: "untracked".into() },
        QueueItemFile { path: "file_b.txt".to_string(), original_path: None, change_type: "untracked".into() },
    ]).unwrap();

    db.schedule_items_with_fingerprints(r.id, &[(id, 1000)], repo.to_str().unwrap()).unwrap();
    
    let locks = ExecutionLocks::new();
    let commit_hash = execution::execute_item(&db, &locks, id, repo.to_str().unwrap()).unwrap();
    
    assert!(!commit_hash.is_empty());
    
    // Verify item is completed
    assert_eq!(raw_status(&db, id).0, "Completed");
    
    // Verify only one commit was created (baseline is 1, plus this 1 = 2)
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "2");
    
    // Verify staged files are empty now
    let out = git(&repo, &["status", "--porcelain"]);
    assert!(out.is_empty(), "Expected clean worktree, got: {}", out);
}

#[test]
fn test_paused_recovery_draft_and_reschedule() {
    let (repo, _) = baseline_repo("paused-recovery");
    let path = db_path("paused-recovery-db");
    let db = Db::open(&path).unwrap();
    db.set_execution_mode("commit_only").unwrap();
    let r = db.add_repository(repo.to_str().unwrap(), "test").unwrap();

    std::fs::write(repo.join("file_recovery.txt"), "hello recovery\n").unwrap();

    let id = db.create_queue_item(r.id, "main", "group", "feat: recovery test", &[
        QueueItemFile { path: "file_recovery.txt".to_string(), original_path: None, change_type: "untracked".into() },
    ]).unwrap();

    db.schedule_items_with_fingerprints(r.id, &[(id, 1000)], repo.to_str().unwrap()).unwrap();

    // Directly update status to Paused and set error in DB to simulate failure
    {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "UPDATE queue_items SET status = 'Paused', retry_count = 3, last_error = 'Some simulated staging error' WHERE id = ?1",
            [id],
        ).unwrap();
    }

    // Verify it is Paused and has the error
    let item = db.get_queue_item(id).unwrap();
    assert_eq!(item.status, "Paused");
    assert_eq!(item.last_error.as_deref(), Some("Some simulated staging error"));

    // 1. Test Reschedule
    db.reschedule_item(id, 2000).unwrap();
    let item = db.get_queue_item(id).unwrap();
    assert_eq!(item.status, "Scheduled");
    assert_eq!(item.scheduled_time, Some(2000));
    assert_eq!(item.last_error, None);
    {
        let conn = db.0.lock().unwrap();
        let retry_count: i64 = conn.query_row(
            "SELECT retry_count FROM queue_items WHERE id = ?1",
            [id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(retry_count, 0);
    }

    // Transition back to Paused for next test
    {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "UPDATE queue_items SET status = 'Paused', retry_count = 3, last_error = 'Another error' WHERE id = ?1",
            [id],
        ).unwrap();
    }

    // 2. Test Return to Draft
    db.unschedule_items(&[id]).unwrap();
    let item = db.get_queue_item(id).unwrap();
    assert_eq!(item.status, "Draft");
    assert_eq!(item.scheduled_time, None);
    assert_eq!(item.last_error, None);

    // Verify fingerprints are cleared in DB
    {
        let conn = db.0.lock().unwrap();
        let fingerprint: Option<String> = conn.query_row(
            "SELECT fingerprint FROM queue_item_files WHERE queue_item_id = ?1",
            [id],
            |r| r.get(0),
        ).unwrap();
        assert!(fingerprint.is_none());
    }
}

#[test]
fn test_paused_bulk_retry() {
    let (repo, _) = baseline_repo("paused-bulk");
    let path = db_path("paused-bulk-db");
    let db = Db::open(&path).unwrap();
    db.set_execution_mode("commit_only").unwrap();
    let r = db.add_repository(repo.to_str().unwrap(), "test").unwrap();

    std::fs::write(repo.join("file_bulk_1.txt"), "hello bulk 1\n").unwrap();
    std::fs::write(repo.join("file_bulk_2.txt"), "hello bulk 2\n").unwrap();

    let id1 = db.create_queue_item(r.id, "main", "group", "feat: bulk 1", &[
        QueueItemFile { path: "file_bulk_1.txt".to_string(), original_path: None, change_type: "untracked".into() },
    ]).unwrap();
    let id2 = db.create_queue_item(r.id, "main", "group", "feat: bulk 2", &[
        QueueItemFile { path: "file_bulk_2.txt".to_string(), original_path: None, change_type: "untracked".into() },
    ]).unwrap();

    db.schedule_items_with_fingerprints(r.id, &[(id1, 1000), (id2, 1001)], repo.to_str().unwrap()).unwrap();

    // Simulate failure by setting status to Paused
    {
        let conn = db.0.lock().unwrap();
        conn.execute("UPDATE queue_items SET status = 'Paused', last_error = 'Staging error' WHERE id = ?1", [id1]).unwrap();
        conn.execute("UPDATE queue_items SET status = 'Paused', last_error = 'Fingerprint error' WHERE id = ?1", [id2]).unwrap();
    }

    // Call execution logic sequentially (like retry_paused_items command)
    let locks = ExecutionLocks::new();
    let _ = execution::execute_item(&db, &locks, id1, repo.to_str().unwrap());
    let _ = execution::execute_item(&db, &locks, id2, repo.to_str().unwrap());

    // Verify both succeeded and transitioned to Completed
    assert_eq!(raw_status(&db, id1).0, "Completed");
    assert_eq!(raw_status(&db, id2).0, "Completed");

    // Verify commits exist in git history (baseline is 1, plus 2 = 3)
    assert_eq!(git(&repo, &["rev-list", "--count", "HEAD"]), "3");
}


