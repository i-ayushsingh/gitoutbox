//! Tauri command wrappers. Thin: they delegate to `gitoutbox_core` (inspection)
//! and the SQLite layer (durable state). No scheduler-critical Git logic here.

use serde::Serialize;
use std::path::Path;
use tauri::State;

use crate::db::{Db, Repository};
use gitoutbox_core as core;

#[derive(Serialize)]
pub struct GitCheck {
    pub installed: bool,
    pub version: Option<String>,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
}

#[derive(Serialize)]
pub struct ChangeDto {
    pub path: String,
    pub filename: String,
    pub directory: String,
    pub original_path: Option<String>,
    pub change_type: String,
    pub staged: bool,
}

#[derive(Serialize)]
pub struct RepoStatus {
    pub path: String,
    pub current_branch: Option<String>,
    pub operation_in_progress: Option<String>,
    pub changes: Vec<ChangeDto>,
}

fn change_type_str(t: core::ChangeType) -> &'static str {
    match t {
        core::ChangeType::Untracked => "untracked",
        core::ChangeType::Modified => "modified",
        core::ChangeType::Deleted => "deleted",
        core::ChangeType::Renamed => "renamed",
    }
}

fn to_dto(c: &core::Change) -> ChangeDto {
    ChangeDto {
        path: c.path.clone(),
        filename: c.filename().to_string(),
        directory: c.directory().to_string(),
        original_path: c.original_path.clone(),
        change_type: change_type_str(c.change_type).to_string(),
        staged: c.staged,
    }
}

#[tauri::command]
pub async fn git_check() -> GitCheck {
    if !core::check_git_installed() {
        return GitCheck { installed: false, version: None, user_name: None, user_email: None };
    }
    let version = core::git_version().ok();
    let identity = core::git_identity().unwrap_or(core::GitIdentity { name: None, email: None });
    GitCheck {
        installed: true,
        version,
        user_name: identity.name,
        user_email: identity.email,
    }
}

#[tauri::command]
pub async fn inspect_repository(path: String) -> Result<RepoStatus, String> {
    let p = Path::new(&path);
    let info = core::inspect_repository(p).map_err(|e| e.to_string())?;
    let changes = core::get_status(p).map_err(|e| e.to_string())?;
    Ok(RepoStatus {
        path,
        current_branch: info.current_branch,
        operation_in_progress: info.operation_in_progress,
        changes: changes.iter().map(to_dto).collect(),
    })
}

#[tauri::command]
pub async fn get_status(path: String) -> Result<Vec<ChangeDto>, String> {
    let changes = core::get_status(Path::new(&path)).map_err(|e| e.to_string())?;
    Ok(changes.iter().map(to_dto).collect())
}

#[derive(Serialize)]
pub struct AddRepositoryResult {
    pub repository: Repository,
    /// True when the path was already in the database (no new row created,
    /// duplicate prevention preserved). The UI shows "already added".
    pub already_exists: bool,
}

#[tauri::command]
pub async fn add_repository(db: State<'_, Db>, path: String) -> Result<AddRepositoryResult, String> {
    let p = Path::new(&path);
    // Validate it is a real work tree before persisting.
    core::inspect_repository(p).map_err(|e| e.to_string())?;
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    // `add_repository` is idempotent on path (ON CONFLICT updates name, no
    // duplicate row). Detect the no-insert case to surface feedback.
    let existing = db
        .list_repositories()
        .unwrap_or_default()
        .into_iter()
        .find(|r| r.path == path);
    let repository = db.add_repository(&path, &name).map_err(|e| e.to_string())?;
    let already_exists = existing.map(|e| e.id == repository.id).unwrap_or(false);
    Ok(AddRepositoryResult { repository, already_exists })
}

#[tauri::command]
pub async fn list_repositories(db: State<'_, Db>) -> Result<Vec<Repository>, String> {
    db.list_repositories().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_repository(db: State<'_, Db>, id: i64) -> Result<(), String> {
    db.remove_repository(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn count_draft_items(db: State<'_, Db>, repository_id: i64) -> Result<i64, String> {
    db.count_draft_items(repository_id).map_err(|e| e.to_string())
}

// --- Phase 2: draft commits (durable queue persistence) ---

#[derive(Serialize)]
pub struct TemplateDto {
    pub name: String,
    pub template: String,
}

fn template_to_dto(t: crate::db::Template) -> TemplateDto {
    TemplateDto { name: t.name, template: t.template }
}

#[tauri::command]
pub async fn list_templates(db: State<'_, Db>) -> Result<Vec<TemplateDto>, String> {
    db.list_templates().map(|ts| ts.into_iter().map(template_to_dto).collect()).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn create_template(db: State<'_, Db>, name: String, template: String) -> Result<(), String> {
    db.create_template(&name, &template).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn update_template(db: State<'_, Db>, name: String, template: String) -> Result<(), String> {
    db.update_template(&name, &template).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn duplicate_template(db: State<'_, Db>, source_name: String) -> Result<String, String> {
    db.duplicate_template(&source_name).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn delete_template(db: State<'_, Db>, name: String) -> Result<(), String> {
    db.delete_template(&name).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct QueueItemFileDto {
    pub path: String,
    pub original_path: Option<String>,
    pub change_type: String,
}

#[derive(Serialize)]
pub struct QueueItemDto {
    pub id: i64,
    pub queue_id: i64,
    pub title: String,
    pub commit_message: String,
    pub target_branch: String,
    pub execution_mode: String,
    pub status: String,
    pub scheduled_time: Option<i64>,
    pub commit_hash: Option<String>,
    pub files: Vec<QueueItemFileDto>,
    pub updated_at: i64,
}

#[derive(Serialize)]
pub struct AssignedFileDto {
    pub path: String,
    pub item_id: i64,
    pub commit_message: String,
}

#[derive(Serialize)]
pub struct BatchResultDto {
    pub created_ids: Vec<i64>,
    pub count: usize,
}

#[derive(Serialize)]
pub struct FileConflictDto {
    pub path: String,
    pub existing_item_id: i64,
    pub existing_message: String,
}

fn item_file_to_dto(f: crate::db::QueueItemFile) -> QueueItemFileDto {
    QueueItemFileDto { path: f.path, original_path: f.original_path, change_type: f.change_type }
}

fn item_to_dto(i: crate::db::QueueItem) -> QueueItemDto {
    QueueItemDto {
        id: i.id,
        queue_id: i.queue_id,
        title: i.title,
        commit_message: i.commit_message,
        target_branch: i.target_branch,
        execution_mode: i.execution_mode,
        status: i.status,
        scheduled_time: i.scheduled_time,
        commit_hash: i.commit_hash,
        files: i.files.into_iter().map(item_file_to_dto).collect(),
        updated_at: i.updated_at,
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn create_queue_item(
    db: State<'_, Db>,
    repository_id: i64,
    target_branch: String,
    files: Vec<crate::db::QueueItemFile>,
    title: String,
    commit_message: String,
) -> Result<i64, String> {
    db.create_queue_item(repository_id, &target_branch, &title, &commit_message, &files)
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn batch_create_queue_items(
    db: State<'_, Db>,
    repository_id: i64,
    target_branch: String,
    items: Vec<crate::db::BatchItem>,
) -> Result<BatchResultDto, String> {
    db.batch_create_queue_items(repository_id, &target_branch, &items)
        .map(|r| BatchResultDto { created_ids: r.created_ids, count: r.count })
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_queue_item(db: State<'_, Db>, id: i64) -> Result<QueueItemDto, String> {
    db.get_queue_item(id).map(item_to_dto).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn list_queue_items(db: State<'_, Db>, repository_id: i64) -> Result<Vec<QueueItemDto>, String> {
    db.list_queue_items(repository_id)
        .map(|is| is.into_iter().map(item_to_dto).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn list_assigned_files(db: State<'_, Db>, repository_id: i64) -> Result<Vec<AssignedFileDto>, String> {
    db.list_assigned_files(repository_id)
        .map(|fs| {
            fs.into_iter()
                .map(|(path, item_id, commit_message)| AssignedFileDto { path, item_id, commit_message })
                .collect()
        })
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn check_file_conflicts(
    db: State<'_, Db>,
    repository_id: i64,
    paths: Vec<String>,
) -> Result<Vec<FileConflictDto>, String> {
    db.check_file_conflicts(repository_id, &paths)
        .map(|cs| {
            cs.into_iter()
                .map(|c| FileConflictDto {
                    path: c.path,
                    existing_item_id: c.existing_item_id,
                    existing_message: c.existing_message,
                })
                .collect()
        })
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn update_queue_item(
    db: State<'_, Db>,
    id: i64,
    title: String,
    commit_message: String,
) -> Result<(), String> {
    db.update_queue_item(id, &title, &commit_message).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn update_queue_item_full(
    db: State<'_, Db>,
    id: i64,
    commit_message: String,
    target_branch: String,
    files: Vec<crate::db::QueueItemFile>,
) -> Result<(), String> {
    db.update_queue_item_full(id, &commit_message, &target_branch, &files)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_queue_item(db: State<'_, Db>, id: i64) -> Result<(), String> {
    db.remove_queue_item(id).map_err(|e| e.to_string())
}

/// Open a directory in Windows Explorer. Uses argument array (no shell
/// concatenation). Paths with spaces and Unicode work correctly.
#[tauri::command]
pub async fn open_in_explorer(path: String) -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open Explorer: {}", e))?;
    Ok(())
}

// --- Phase 3: scheduling ---

#[derive(serde::Deserialize)]
pub struct ScheduleAssignmentInput {
    pub item_id: i64,
    pub scheduled_time: i64,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn schedule_items(
    db: State<'_, Db>,
    repository_id: i64,
    assignments: Vec<ScheduleAssignmentInput>,
    repo_path: String,
) -> Result<(), String> {
    let pairs: Vec<(i64, i64)> = assignments.iter().map(|a| (a.item_id, a.scheduled_time)).collect();
    db.schedule_items_with_fingerprints(repository_id, &pairs, &repo_path)
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn unschedule_items(
    db: State<'_, Db>,
    item_ids: Vec<i64>,
) -> Result<(), String> {
    db.unschedule_items(&item_ids).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn list_scheduled_items(
    db: State<'_, Db>,
    repository_id: i64,
    from_time: i64,
    to_time: i64,
) -> Result<Vec<QueueItemDto>, String> {
    db.list_scheduled_items(repository_id, from_time, to_time)
        .map(|is| is.into_iter().map(item_to_dto).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn list_all_scheduled_items(
    db: State<'_, Db>,
    from_time: Option<i64>,
    to_time: Option<i64>,
) -> Result<Vec<QueueItemDto>, String> {
    db.list_all_scheduled_items(from_time, to_time)
        .map(|is| is.into_iter().map(item_to_dto).collect())
        .map_err(|e| e.to_string())
}

// --- Phase 4: execution, activity, reschedule ---

#[derive(Serialize)]
pub struct ActivityEventDto {
    pub id: i64,
    pub ts: i64,
    pub level: String,
    pub repository_id: Option<i64>,
    pub queue_item_id: Option<i64>,
    pub event_type: String,
    pub message: String,
    pub metadata: Option<String>,
    pub commit_message: Option<String>,
    pub commit_hash: Option<String>,
}

fn activity_to_dto(e: crate::db::ActivityEvent) -> ActivityEventDto {
    ActivityEventDto {
        id: e.id,
        ts: e.ts,
        level: e.level,
        repository_id: e.repository_id,
        queue_item_id: e.queue_item_id,
        event_type: e.event_type,
        message: e.message,
        metadata: e.metadata,
        commit_message: e.commit_message,
        commit_hash: e.commit_hash,
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn list_activity_events(db: State<'_, Db>, limit: Option<i64>) -> Result<Vec<ActivityEventDto>, String> {
    db.list_activity_events(limit.unwrap_or(100))
        .map(|es| es.into_iter().map(activity_to_dto).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_execution_mode(db: State<'_, Db>) -> Result<String, String> {
    Ok(db.get_execution_mode())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn set_execution_mode(db: State<'_, Db>, mode: String) -> Result<(), String> {
    if !["commit_only", "commit_and_push", "push_at_end"].contains(&mode.as_str()) {
        return Err(format!("Invalid execution mode: {mode}"));
    }
    db.set_execution_mode(&mode).map_err(|e| e.to_string())
}

/// Execute one item through the shared Phase 4 orchestration.
#[tauri::command(rename_all = "snake_case")]
pub async fn execute_item(
    db: State<'_, Db>,
    locks: State<'_, crate::ExecutionLocks>,
    item_id: i64,
    repository_path: String,
) -> Result<String, String> {
    crate::execution::execute_item(&db, &locks, item_id, &repository_path)
}

/// Execute a push-at-end batch through the shared Phase 4 orchestration.
#[tauri::command(rename_all = "snake_case")]
pub async fn execute_batch(
    db: State<'_, Db>,
    locks: State<'_, crate::ExecutionLocks>,
    item_ids: Vec<i64>,
    repository_path: String,
) -> Result<Vec<(i64, String)>, String> {
    crate::execution::execute_batch(&db, &locks, &item_ids, &repository_path)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn reschedule_item(
    db: State<'_, Db>,
    item_id: i64,
    new_time: i64,
) -> Result<(), String> {
    db.reschedule_item(item_id, new_time).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn capture_fingerprints(
    db: State<'_, Db>,
    item_id: i64,
    repository_path: String,
) -> Result<(), String> {
    use gitoutbox_core::executor;

    let repo_root = std::path::Path::new(&repository_path);
    let file_details = db.get_item_file_details(item_id).map_err(|e| e.to_string())?;
    let paths: Vec<String> = file_details.iter().map(|f| f.path.clone()).collect();
    let change_types: Vec<String> = file_details.iter().map(|f| f.change_type.clone()).collect();
    let original_paths: Vec<Option<String>> = file_details.iter().map(|f| f.original_path.clone()).collect();
    let fps = executor::compute_fingerprints(repo_root, &paths, &change_types, &original_paths);
    let stored: Vec<Option<String>> = fps.iter().map(|f| f.as_ref().map(|fp| fp.to_stored())).collect();
    db.capture_fingerprints_str(item_id, &stored).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_missed_schedule_policy(db: State<'_, Db>) -> Result<String, String> {
    Ok(db.get_missed_schedule_policy())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn set_missed_schedule_policy(db: State<'_, Db>, policy: String) -> Result<(), String> {
    if !["run_immediately", "skip", "ask", "redistribute"].contains(&policy.as_str()) {
        return Err(format!("Invalid missed schedule policy: {policy}"));
    }
    db.set_missed_schedule_policy(&policy).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
pub struct DayConfigInput {
    pub day_start: i64,
    pub window_start_offset: i64,
    pub window_end_offset: i64,
    pub item_count: usize,
}

#[derive(serde::Deserialize)]
pub struct GenerateScheduleInput {
    pub mode: String,
    pub distribution: String,
    pub item_count: usize,
    pub exact_times: Vec<i64>,
    pub window_start: i64,
    pub window_end: i64,
    pub interval_start: i64,
    pub interval_seconds: i64,
    pub days: Vec<DayConfigInput>,
    pub min_gap_seconds: i64,
    pub seed: Option<u64>,
}

#[derive(serde::Serialize)]
pub struct ScheduleAssignmentDto {
    pub item_index: usize,
    pub scheduled_time: i64,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn compute_schedule(input: GenerateScheduleInput) -> Result<Vec<ScheduleAssignmentDto>, String> {
    use gitoutbox_core::scheduler::{ScheduleMode, Distribution, DayConfig, ScheduleInput, generate_schedule};

    let mode = match input.mode.as_str() {
        "exact" => ScheduleMode::Exact,
        "window" => ScheduleMode::Window,
        "interval" => ScheduleMode::Interval,
        "multiday" => ScheduleMode::MultiDay,
        _ => return Err(format!("Invalid mode: {}", input.mode)),
    };
    let distribution = match input.distribution.as_str() {
        "even" => Distribution::Even,
        "variable" => Distribution::Variable,
        _ => return Err(format!("Invalid distribution: {}", input.distribution)),
    };
    let days = input.days.into_iter().map(|d| DayConfig {
        day_start: d.day_start,
        window_start_offset: d.window_start_offset,
        window_end_offset: d.window_end_offset,
        item_count: d.item_count,
    }).collect();

    let schedule_input = ScheduleInput {
        mode,
        distribution,
        item_count: input.item_count,
        exact_times: input.exact_times,
        window_start: input.window_start,
        window_end: input.window_end,
        interval_start: input.interval_start,
        interval_seconds: input.interval_seconds,
        days,
        min_gap_seconds: input.min_gap_seconds,
        seed: input.seed,
    };

    let output = generate_schedule(&schedule_input).map_err(|e| e.to_string())?;
    Ok(output.assignments.into_iter().map(|a| ScheduleAssignmentDto {
        item_index: a.item_index,
        scheduled_time: a.scheduled_time,
    }).collect())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn count_scheduled_items(db: State<'_, Db>, repository_id: i64) -> Result<i64, String> {
    db.count_scheduled_items(repository_id).map_err(|e| e.to_string())
}

