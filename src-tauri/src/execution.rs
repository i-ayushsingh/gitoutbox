//! Shared Phase 4 execution orchestration.
//!
//! This module is deliberately independent of Tauri's `State` wrapper so the
//! backend integration suite can exercise the same path used by IPC commands.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::db::{Db, QueueItem, QueueItemContext};
use crate::ExecutionLocks;
use gitoutbox_core::{executor, git as core_git};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Operation {
    Commit,
    PushOnly,
}

struct Preflight {
    context: QueueItemContext,
    repo_root: PathBuf,
    assigned_paths: Vec<String>,
}

fn mode_for(item: &QueueItem, db: &Db) -> String {
    if item.execution_mode == "commit" {
        db.get_execution_mode()
    } else {
        item.execution_mode.clone()
    }
}

fn requires_push(mode: &str) -> bool {
    matches!(mode, "commit_and_push" | "push_at_end" | "push")
}

fn identity_path(context: &QueueItemContext, supplied: &str) -> Result<PathBuf, String> {
    let persisted = std::fs::canonicalize(&context.repository.path)
        .map_err(|e| format!("Persisted repository is unavailable: {e}"))?;
    let supplied = std::fs::canonicalize(supplied)
        .map_err(|e| format!("Supplied repository is unavailable: {e}"))?;
    if persisted != supplied {
        return Err(format!(
            "Repository identity mismatch: queue targets '{}', supplied '{}'",
            persisted.display(),
            supplied.display()
        ));
    }
    Ok(supplied)
}

fn event(db: &Db, repo_id: i64, item_id: Option<i64>, kind: &str, message: &str) {
    let _ = db.add_activity_event("info", Some(repo_id), item_id, kind, message, None);
}

fn error_event(db: &Db, repo_id: i64, item_id: Option<i64>, kind: &str, message: &str) {
    let _ = db.add_activity_event("error", Some(repo_id), item_id, kind, message, None);
}

fn paused_error<T>(db: &Db, repo_id: i64, item_id: i64, kind: &str, reason: String) -> Result<T, String> {
    let message = format!("{reason} Commit created: no. Pushed: no. GitOutbox paused the item. Review the repository state and retry after resolving the issue.");
    let _ = db.pause_execution(item_id, &message);
    error_event(db, repo_id, Some(item_id), kind, &message);
    Err(message)
}

fn preflight(
    db: &Db,
    context: QueueItemContext,
    supplied_path: &str,
    operation: Operation,
) -> Result<Preflight, String> {
    let repo_root = identity_path(&context, supplied_path)?;
    let item = &context.item;
    let executable = match operation {
        Operation::Commit => matches!(item.status.as_str(), "Scheduled" | "Paused" | "Running"),
        Operation::PushOnly => matches!(item.status.as_str(), "PushPending" | "Paused"),
    };
    if !executable {
        return Err(format!("Item {} is not executable for this operation (status: {})", item.id, item.status));
    }
    if item.commit_message.trim().is_empty() {
        return Err("Commit message is empty".into());
    }
    if item.files.is_empty() {
        return Err("No assigned files".into());
    }
    core_git::inspect_repository(&repo_root)
        .map_err(|e| format!("Repository validation failed: {e}"))?;
    let current_branch = core_git::get_current_branch(&repo_root)
        .map_err(|e| format!("Current branch query failed: {e}"))?;
    if current_branch != item.target_branch {
        return Err(format!(
            "Branch mismatch: expected '{}', current '{}'",
            item.target_branch, current_branch
        ));
    }
    let unsafe_operation = core_git::is_operation_in_progress(&repo_root)
        .map_err(|e| format!("Unsafe-operation inspection failed: {e}"))?;
    if let Some(operation) = unsafe_operation {
        return Err(format!("Unsafe Git operation in progress: {operation}"));
    }

    let assigned_paths: Vec<String> = item.files.iter().map(|file| file.path.clone()).collect();
    executor::validate_all_paths(&repo_root, &assigned_paths)
        .map_err(|e| format!("Path validation failed: {e}"))?;
    let expected = db
        .get_item_fingerprints(item.id)
        .map_err(|e| format!("Fingerprint state query failed: {e}"))?;
    if expected.len() != item.files.len() || expected.iter().any(Option::is_none) {
        return Err("MISSING_EXPECTED_FINGERPRINT: every assigned file must have a scheduling-time fingerprint".into());
    }
    let details: Vec<core_git::FileForFingerprint> = item
        .files
        .iter()
        .map(|file| core_git::FileForFingerprint {
            path: file.path.clone(),
            change_type: file.change_type.clone(),
            original_path: file.original_path.clone(),
        })
        .collect();
    executor::validate_fingerprints(&repo_root, &details, &expected)
        .map_err(|e| format!("Fingerprint validation failed: {e}"))?;

    if operation == Operation::Commit {
        let status = core_git::get_status(&repo_root)
            .map_err(|e| format!("Git status query failed: {e}"))?;
        let changed: HashSet<String> = status
            .into_iter()
            .flat_map(|change| [Some(change.path), change.original_path])
            .flatten()
            .collect();
        if assigned_paths.iter().any(|path| !changed.contains(path)) {
            return Err("Assigned file has no current Git change".into());
        }
    }
    executor::check_pre_staged_strict(&repo_root, &assigned_paths)?;
    Ok(Preflight { context, repo_root, assigned_paths })
}

fn stage_and_commit(db: &Db, preflight: &Preflight) -> Result<String, String> {
    let repo_id = preflight.context.repository.id;
    let item_id = preflight.context.item.id;
    event(db, repo_id, Some(item_id), "staging_started", "Staging assigned paths");
    executor::stage_assigned_paths(&preflight.repo_root, &preflight.assigned_paths)
        .map_err(|e| format!("Staging failed: {e}"))?;

    // Check fingerprints on staged contents before committing (TOCTOU protection)
    let expected = db.get_item_fingerprints(item_id)
        .map_err(|e| format!("Fingerprint state query failed: {e}"))?;
    let details: Vec<gitoutbox_core::git::FileForFingerprint> = preflight.context.item.files.iter().map(|file| {
        gitoutbox_core::git::FileForFingerprint {
            path: file.path.clone(),
            change_type: file.change_type.clone(),
            original_path: file.original_path.clone(),
        }
    }).collect();
    if let Err(e) = executor::verify_staged_fingerprints(&preflight.repo_root, &details, &expected) {
        let _ = executor::unstage_paths(&preflight.repo_root, &preflight.assigned_paths);
        return Err(format!("Fingerprint validation after staging failed: {e}"));
    }

    executor::verify_staged_paths(&preflight.repo_root, &preflight.assigned_paths)
        .map_err(|e| format!("Staged path verification failed: {e}"))?;
    event(db, repo_id, Some(item_id), "staging_completed", "Staged paths verified");

    let pre_head = executor::get_head_hash(&preflight.repo_root)
        .map_err(|e| format!("Cannot determine pre-commit HEAD: {e}"))?;
    db.persist_pre_commit_head(item_id, &pre_head)
        .map_err(|e| format!("Cannot persist pre-commit recovery evidence: {e}"))?;

    let commit_hash = executor::create_commit(&preflight.repo_root, &preflight.context.item.commit_message)
        .map_err(|e| format!("Commit failed: {e}"))?;
    db.persist_commit_hash(item_id, &commit_hash)
        .map_err(|e| format!("Commit was created ({commit_hash}) but commit hash persistence failed: {e}"))?;
    event(
        db,
        repo_id,
        Some(item_id),
        "commit_created",
        &format!("Commit created: {commit_hash}"),
    );
    Ok(commit_hash)
}

fn acquire_lock(locks: &ExecutionLocks, repo_id: i64) -> Result<std::sync::Arc<std::sync::Mutex<()>>, String> {
    Ok(locks.get_lock(repo_id))
}

fn push_one(db: &Db, repo_id: i64, item_id: i64, repo_root: &Path, hash: &str) -> Result<(), String> {
    event(db, repo_id, Some(item_id), "push_started", "Pushing configured upstream");
    match executor::push_current_branch(repo_root) {
        Ok(_) => {
            event(db, repo_id, Some(item_id), "push_succeeded", &format!("Pushed commit {hash}"));
            Ok(())
        }
        Err(error) => Err(format!("Push failed: {error}")),
    }
}

pub fn execute_item(db: &Db, locks: &ExecutionLocks, item_id: i64, repository_path: &str) -> Result<String, String> {
    let initial = db.get_queue_item_context(item_id).map_err(|e| e.to_string())?;
    if !matches!(initial.item.status.as_str(), "Scheduled" | "Paused" | "PushPending") {
        return Err(format!("Item {item_id} is not executable (status: {})", initial.item.status));
    }
    let lock = acquire_lock(locks, initial.repository.id)?;
    let _guard = lock.lock().map_err(|_| "Repository execution lock is poisoned".to_string())?;
    let context = db.get_queue_item_context(item_id).map_err(|e| e.to_string())?;
    let mode = mode_for(&context.item, db);

    let push_only_recovery = context.item.status == "PushPending"
        || (context.item.status == "Paused"
            && context.item.commit_hash.is_some()
            && requires_push(&mode));
    if push_only_recovery {
        let hash = context.item.commit_hash.clone().ok_or_else(|| "PushPending item has no persisted commit hash".to_string())?;
        event(db, context.repository.id, Some(item_id), "execution_started", "Push-only execution started");
        let checked = preflight(db, context.clone(), repository_path, Operation::PushOnly)
            .map_err(|reason| {
                let message = format!("Push retry preflight failed: {reason} Commit created: yes ({hash}). Pushed: no. Item remains PushPending or is paused.");
                let _ = db.pause_execution(item_id, &message);
                error_event(db, context.repository.id, Some(item_id), "preflight_failed", &message);
                message
            })?;
        event(db, checked.context.repository.id, Some(item_id), "push_retry", &format!("Retrying push-only for {hash}"));
        match push_one(db, checked.context.repository.id, item_id, &checked.repo_root, &hash) {
            Ok(()) => {
                db.complete_execution(item_id, &hash).map_err(|e| e.to_string())?;
                db.complete_all_push_pending(checked.context.repository.id).map_err(|e| e.to_string())?;
                event(db, checked.context.repository.id, Some(item_id), "completed", &format!("Push succeeded for {hash}; no recommit performed"));
                Ok(hash)
            }
            Err(error) => {
                let next = db.record_push_retry_failure(item_id, &error).map_err(|e| e.to_string())?;
                let status = if next >= 3 { "Paused" } else { "PushPending" };
                let message = format!("{error} Commit created: yes ({hash}). Pushed: no. Retry {next} of 3; state is {status}.");
                if next >= 3 {
                    let _ = db.pause_execution(item_id, &message);
                }
                error_event(db, checked.context.repository.id, Some(item_id), if next >= 3 { "retry_exhausted" } else { "push_failed" }, &message);
                Err(message)
            }
        }
    } else {
        db.begin_execution(item_id).map_err(|e| e.to_string())?;
        event(db, context.repository.id, Some(item_id), "execution_started", "Execution started");
        let preflight = match preflight(db, context.clone(), repository_path, Operation::Commit) {
            Ok(value) => value,
            Err(reason) => return paused_error(db, context.repository.id, item_id, "preflight_failed", format!("Preflight failed: {reason}")),
        };
        let hash = match stage_and_commit(db, &preflight) {
            Ok(hash) => hash,
            Err(reason) => return paused_error(db, context.repository.id, item_id, "execution_failed", reason),
        };
        if requires_push(&mode) {
            let has_future = db.has_future_push_at_end_items(context.repository.id, context.item.scheduled_time.unwrap_or(0))
                .map_err(|e| e.to_string())?;
            if mode == "push_at_end" && has_future {
                db.set_push_pending(item_id, &hash).map_err(|e| e.to_string())?;
                event(db, context.repository.id, Some(item_id), "push_deferred", &format!("Commit created: {hash}; push deferred because future push-at-end items are scheduled."));
                return Ok(hash);
            }

            if let Err(error) = push_one(db, context.repository.id, item_id, &preflight.repo_root, &hash) {
                db.set_push_pending(item_id, &hash).map_err(|e| e.to_string())?;
                let message = format!("{error} Commit created: yes ({hash}). Pushed: no. State is PushPending; retry is push-only.");
                error_event(db, context.repository.id, Some(item_id), "push_failed", &message);
                return Err(message);
            }
        }
        db.complete_execution(item_id, &hash).map_err(|e| e.to_string())?;
        if requires_push(&mode) {
            db.complete_all_push_pending(context.repository.id).map_err(|e| e.to_string())?;
        }
        event(db, context.repository.id, Some(item_id), "completed", &format!("Completed commit {hash}"));
        Ok(hash)
    }
}

pub fn execute_batch(db: &Db, locks: &ExecutionLocks, item_ids: &[i64], repository_path: &str) -> Result<Vec<(i64, String)>, String> {
    if item_ids.is_empty() {
        return Ok(Vec::new());
    }
    let first = db.get_queue_item_context(item_ids[0]).map_err(|e| e.to_string())?;
    if mode_for(&first.item, db) != "push_at_end" {
        return Err("Batch orchestration requires execution mode push_at_end".into());
    }
    let lock = acquire_lock(locks, first.repository.id)?;
    let _guard = lock.lock().map_err(|_| "Repository execution lock is poisoned".to_string())?;
    event(db, first.repository.id, None, "batch_started", &format!("Batch started for {} items", item_ids.len()));

    let mut committed: Vec<(i64, String)> = Vec::new();
    let mut push_root: Option<PathBuf> = None;
    for (index, item_id) in item_ids.iter().copied().enumerate() {
        let context = db.get_queue_item_context(item_id).map_err(|e| e.to_string())?;
        if context.repository.id != first.repository.id {
            return Err(format!("Item {item_id} belongs to a different repository"));
        }
        if !matches!(context.item.status.as_str(), "Scheduled" | "Paused") {
            return Err(format!("Item {item_id} is not executable (status: {})", context.item.status));
        }
        db.begin_execution(item_id).map_err(|e| e.to_string())?;
        let preflight = match preflight(db, context.clone(), repository_path, Operation::Commit) {
            Ok(value) => value,
            Err(reason) => {
                let message = format!("Batch item {item_id} preflight failed: {reason}");
                let _ = db.pause_execution(item_id, &message);
                for remaining in item_ids.iter().skip(index + 1) {
                    let _ = db.pause_execution(*remaining, "Batch stopped before execution; earlier item failed preflight");
                }
                for (committed_id, hash) in &committed {
                    let _ = db.set_push_pending(*committed_id, hash);
                }
                error_event(db, first.repository.id, Some(item_id), "batch_item_failed", &message);
                return Err(message);
            }
        };
        if push_root.is_none() {
            push_root = Some(preflight.repo_root.clone());
        }
        match stage_and_commit(db, &preflight) {
            Ok(hash) => committed.push((item_id, hash)),
            Err(reason) => {
                let message = format!("Batch item {item_id} failed: {reason}");
                let _ = db.pause_execution(item_id, &message);
                for remaining in item_ids.iter().skip(index + 1) {
                    let _ = db.pause_execution(*remaining, "Batch stopped before execution; earlier item failed");
                }
                for (committed_id, hash) in &committed {
                    let _ = db.set_push_pending(*committed_id, hash);
                }
                error_event(db, first.repository.id, Some(item_id), "batch_item_failed", &message);
                return Err(message);
            }
        }
    }

    let mut max_scheduled_time = 0;
    for &item_id in item_ids {
        if let Ok(item) = db.get_queue_item(item_id) {
            if let Some(t) = item.scheduled_time {
                if t > max_scheduled_time {
                    max_scheduled_time = t;
                }
            }
        }
    }
    let has_future = db.has_future_push_at_end_items(first.repository.id, max_scheduled_time)
        .map_err(|e| e.to_string())?;
    if has_future {
        for (item_id, hash) in &committed {
            db.set_push_pending(*item_id, hash).map_err(|e| e.to_string())?;
        }
        event(db, first.repository.id, None, "push_deferred", &format!("Batch of {} commits created; push deferred because future push-at-end items are scheduled.", committed.len()));
        return Ok(committed);
    }

    event(db, first.repository.id, None, "push_started", "Push-at-end: one push after all commits");
    match executor::push_current_branch(push_root.as_deref().unwrap_or_else(|| Path::new(repository_path))) {
        Ok(_) => {
            for (item_id, hash) in &committed {
                db.complete_execution(*item_id, hash).map_err(|e| e.to_string())?;
            }
            db.complete_all_push_pending(first.repository.id).map_err(|e| e.to_string())?;
            event(db, first.repository.id, None, "push_succeeded", &format!("Push-at-end succeeded for {} commits", committed.len()));
            Ok(committed)
        }
        Err(error) => {
            for (item_id, hash) in &committed {
                db.set_push_pending(*item_id, hash).map_err(|e| e.to_string())?;
            }
            let message = format!("Push-at-end failed: {error} Commit created: yes for {} items. Pushed: no. All committed items are PushPending.", committed.len());
            error_event(db, first.repository.id, None, "push_failed", &message);
            Err(message)
        }
    }
}
